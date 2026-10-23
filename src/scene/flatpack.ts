import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOX, COLORS } from '../constants.js';
import { PART_TYPES } from '../game/item.js';
import { baseRest, boxSlabs, lidRest, packedBox } from '../game/boxLayout.js';
import { createPartMesh } from '../game/partMesh.js';
import { edgesGeometry, inkEdges } from './ink.js';
import type { Ink } from './ink.js';
import type { Part } from '../game/partMesh.js';
import type { PhysicsWorld } from '../physics/world.js';
import type { Pose, Vec3 } from '../../tools/validate/lib/geometry.js';

/**
 * The box's solid, not its slabs: the outer block and the cavity it holds, so the edge pass draws
 * the corners, the rim and the inside corners and none of the seams where the slabs butt.
 */
function outlineOf(): THREE.BufferGeometry {
  const { inner: [width, height, length], wall, floor } = packedBox();
  const centre = (floor + height) / 2;
  return mergeGeometries([
    new THREE.BoxGeometry(width + 2 * wall, floor + height, length + 2 * wall),
    new THREE.BoxGeometry(width, height, length).translate(0, floor + height / 2 - centre, 0),
  ]);
}

/**
 * The flatpack the game opens on: an open-topped cardboard box lying on the floor — bottom
 * and four thin walls glued into one heavy dynamic body, so a panel slid out of it scrapes
 * over the wall the way a real one does and the empty box can be dragged aside — and its
 * lid closed on top. Both are normal physics parts (`{ id, type, mesh, body }`) for the
 * gesture router to grab like any other. The box and lid take the edge pass, like the room, for
 * their creases and folds; the parts take the hull. Builds once, at the box pose `at` (the room's
 * free spot); the poses are src/game/boxLayout.ts's.
 */
export function createFlatpack(physics: PhysicsWorld, ink: Ink, at: Pose): { base: Part; lid: Part } {
  const slabs = boxSlabs();
  const geometry = mergeGeometries(
    slabs.map(({ size, offset }) => new THREE.BoxGeometry(...size).translate(...offset)),
  );
  const box = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: COLORS.cardboard }));
  box.name = 'flatpack';
  box.castShadow = true;
  box.receiveShadow = true;
  box.add(inkEdges(edgesGeometry(outlineOf()), ink.lines));
  const rest = baseRest(at);
  // map keeps the length; TS widens a mapped tuple to number[].
  const boxBody = physics.register(box, {
    colliders: slabs.map(({ size, offset }) => ({ halfExtents: size.map((d) => d / 2) as Vec3, offset })),
    mass: BOX.mass,
    friction: BOX.friction,
    position: rest.position,
    rotation: rest.rotation,
  });

  const type = PART_TYPES.boxLid;
  const mesh = createPartMesh(type);
  mesh.add(inkEdges(edgesGeometry(mesh.geometry), ink.lines));
  const closed = lidRest(at);
  const body = physics.register(mesh, {
    halfExtents: type.size.map((d) => d / 2) as Vec3,
    // The lid has the pack's mass.
    mass: type.mass!,
    position: closed.position,
    rotation: closed.rotation,
  });

  return {
    base: { id: 'boxBase-1', type: 'boxBase', mesh: box, body: boxBody },
    lid: { id: 'boxLid-1', type: 'boxLid', mesh, body },
  };
}
