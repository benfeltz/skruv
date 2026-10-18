import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { COLORS, LAYER, STAGE } from '../constants.js';
import { advance, phaseFromClock, skyColourAt } from '../game/skyCycle.js';
import type { Rgb } from '../game/skyCycle.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { floorBase, floorPlanks } from '../game/floorPlanks.js';
import type { Plank } from '../game/floorPlanks.js';
import { sizeAndCentre, stageBoxes, wallBox, wallPieces, windowBoxes, windowOpeningBoxes } from '../game/stageBoxes.js';
import type { StageBox, StageBoxName, WallName } from '../game/stageBoxes.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';
import { createInk, edgesGeometry, edgesOf, inkEdges } from './ink.js';
import { createScenery } from './scenery.js';
import { STAGE_WALLS, wallHidden } from './stageCutaway.js';

/**
 * The diorama: a base slab whose top is the floor, a back wall and a left wall with a window in it, and a low lip on
 * the front and right edges, every edge in ink. Built once; `update` only flips a wall's
 * visibility (its ink lines go with it) and keeps the line resolution current. The `Ink` it
 * owns is the game's: item worlds borrow it (src/main.ts).
 */
export function createRoom() {
  const group = new THREE.Group();
  group.name = 'room';

  const ink = createInk();
  const floor = new THREE.MeshStandardMaterial({ color: COLORS.floor });
  const wall = new THREE.MeshStandardMaterial({ color: COLORS.wall });
  const trim = new THREE.MeshStandardMaterial({ color: COLORS.trim });
  // One unlit material for every box's back panel: the cycle writes its colour once a frame.
  const skyMaterial = new THREE.MeshBasicMaterial({ color: COLORS.sky });

  const boxGeometry = (box: StageBox<string>) => {
    const { size, centre } = sizeAndCentre(box);
    return new THREE.BoxGeometry(...size).translate(...centre);
  };

  // One group per box: the mesh and its ink travel together, so hiding it hides both.
  const pieces = new Map<StageBoxName, THREE.Group>();
  const addPiece = (name: StageBoxName, piece: THREE.Group) => {
    piece.name = name;
    pieces.set(name, piece);
    group.add(piece);
  };

  // A plank's box, its tone written as a vertex colour on every vertex, so all the boards merge into one lit mesh.
  const plankColour = new THREE.Color();
  const plankGeometry = (plank: Plank) => {
    const geometry = boxGeometry({ name: 'slab', ...plank, outward: [0, 0, 0] });
    plankColour.setHex(STAGE.floor.tones[plank.tone]!);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: count }, () => [plankColour.r, plankColour.g, plankColour.b]).flat(), 3));
    return geometry;
  };

  // The slab is drawn as a base lowered by the planks' thickness under the planks, which top it at y = 0 over its whole
  // footprint; the collider is the undrawn slab, untouched. The planks' ink is every board's sharp edges, one draw.
  const buildFloor = (slab: StageBox<'slab'>) => {
    const baseGeometry = boxGeometry({ ...slab, ...floorBase(slab) });
    const base = new THREE.Mesh(baseGeometry, floor);
    base.name = 'slabBase';
    const planks = floorPlanks(slab).map(plankGeometry);
    const boards = new THREE.Mesh(mergeGeometries(planks)!, new THREE.MeshStandardMaterial({ vertexColors: true }));
    boards.name = 'floorPlanks';
    for (const mesh of [base, boards]) mesh.receiveShadow = true;
    const boardInk = mergeGeometries(planks.map((plank) => edgesOf(plank)))!;
    const floorInk = new LineSegments2(new LineSegmentsGeometry().setPositions(boardInk.getAttribute('position').array as Float32Array), ink.lines);
    floorInk.name = 'floorInk';
    const piece = new THREE.Group();
    piece.add(base, boards, inkEdges(edgesGeometry(baseGeometry), ink.lines), floorInk);
    return piece;
  };

  for (const box of stageBoxes()) {
    if (box.name.includes('Wall')) continue;
    if (box.name === 'slab') {
      addPiece(box.name, buildFloor(box as StageBox<'slab'>));
      continue;
    }
    const geometry = boxGeometry(box);
    const mesh = new THREE.Mesh(geometry, wall);
    mesh.receiveShadow = true;
    const piece = new THREE.Group();
    piece.add(mesh, inkEdges(edgesGeometry(geometry), ink.lines));
    addPiece(box.name, piece);
  }

  // Each wall is one group — its pieces merged into one mesh, the trim into another, one ink
  // for the whole, and a scenery box behind its windows — so the cutaway hides them together and a
  // wall costs a handful of draws. The ink is the wall's outline plus the openings' edges and
  // the trim's own edges, not each piece's: no seams where the pieces meet.
  const sceneries: ReturnType<typeof createScenery>[] = [];
  const buildWall = (name: WallName) => {
    const side = new THREE.Group();
    side.name = `${name}Wall`;
    const wallMesh = new THREE.Mesh(mergeGeometries(wallPieces(name).map(boxGeometry))!, wall);
    wallMesh.name = `${name}WallMesh`;
    const trimGeometry = mergeGeometries(windowBoxes(name).map(boxGeometry))!;
    const trimMesh = new THREE.Mesh(trimGeometry, trim);
    trimMesh.name = `${name}WindowTrim`;
    for (const mesh of [wallMesh, trimMesh]) mesh.receiveShadow = true;
    const inkGeometry = mergeGeometries([
      edgesOf(boxGeometry(wallBox(name))),
      ...windowOpeningBoxes(name).map((box) => edgesOf(boxGeometry(box))),
      edgesOf(trimGeometry),
    ])!;
    const wallInk = new LineSegments2(new LineSegmentsGeometry().setPositions(inkGeometry.getAttribute('position').array as Float32Array), ink.lines);
    wallInk.name = `${name}WallInk`;
    side.add(wallMesh, trimMesh, wallInk);
    // The scenery: a closed diorama box behind the openings, in the wall's group so the cutaway hides it with the wall.
    const scenery = createScenery(name, { ink: ink.lines, skyMaterial });
    side.add(scenery.group);
    sceneries.push(scenery);
    group.add(side);
    return side;
  };
  const backWall = buildWall('back');
  const leftWall = buildWall('left');

  // The whole room on its own layer: the main camera enables it, the detail inset's does not, so
  // its close-up shows the parts on paper (src/scene/inset.ts). The lights stay on layer 0 and light both.
  group.traverse((object) => object.layers.set(LAYER.room));

  // Reused every frame: the eye as a tuple and the canvas size, so the loop allocates nothing.
  const eyeAt: Vec3 = [0, 0, 0];
  const size = new THREE.Vector2();
  // The sky's phase lives here, mirrored into STAGE.sky.phase each frame; the knob moving it off the mirror is a scrub.
  let phase = phaseFromClock(new Date());
  let scrubbed = STAGE.sky.phase;
  let painted = NaN;
  const skyRgb: Rgb = [0, 0, 0];
  return {
    group,
    pieces,
    ink,
    leftWall,
    backWall,
    /**
     * Per frame: hide the walls the eye is behind; keep the ink's resolution at the canvas's
     * CSS size, so `INK.lineWidth` is the same on screen at any pixel ratio; turn the sky
     * on by `delta` seconds of game time.
     */
    update(eye: THREE.Vector3, renderer: THREE.WebGLRenderer, delta: number) {
      eye.toArray(eyeAt);
      backWall.visible = !wallHidden(eyeAt, STAGE_WALLS.back);
      leftWall.visible = !wallHidden(eyeAt, STAGE_WALLS.left);
      renderer.getSize(size);
      if (!size.equals(ink.lines.resolution)) ink.lines.resolution.copy(size);
      if (STAGE.sky.phase !== scrubbed) {
        scrubbed = STAGE.sky.phase;
        phase = scrubbed;
      }
      phase = advance(phase, delta, STAGE.sky.cycleMinutes);
      // The scrub reads the live phase, so setting it to where the sky already is changes nothing and anywhere else jumps.
      STAGE.sky.phase = scrubbed = phase;
      if (phase !== painted) {
        painted = phase;
        skyColourAt(phase, skyRgb);
        skyMaterial.color.setRGB(skyRgb[0], skyRgb[1], skyRgb[2], THREE.SRGBColorSpace);
      }
      for (const scenery of sceneries) scenery.update(phase, delta);
    },
  };
}
