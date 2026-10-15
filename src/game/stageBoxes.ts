// Pure geometry of the diorama stage — no Three, no Rapier — so the drawn room and its
// colliders are built from the same boxes and Vitest covers them headlessly.
//
// Everything stands OUTSIDE the floor's footprint (|x| <= width/2, |z| <= depth/2), except
// the slab under y = 0, so the clamps that read ROOM (drag, lift, snap, respawn) are
// unchanged: the floor's top face is the slab's top face, at y = 0.

import { ROOM, STAGE } from '../constants.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';

/** The left wall is four boxes round the window's opening. */
export const LEFT_WALL_PIECES = ['leftWallBelow', 'leftWallAbove', 'leftWallFront', 'leftWallBack'] as const;
export type LeftWallPiece = (typeof LEFT_WALL_PIECES)[number];

export type StageBoxName = 'slab' | 'backWall' | LeftWallPiece | 'frontLip' | 'rightLip';

/** The window's trim: casing round the opening, sill and apron under it, frame and meeting rail inside it. */
export type WindowBoxName =
  | 'casingFront' | 'casingBack' | 'casingHead' | 'sill' | 'apron'
  | 'frameBottom' | 'frameTop' | 'frameFront' | 'frameBack' | 'rail';

/** What the physics world holds: the left wall's pieces are one solid `leftWall` there. */
export type ColliderName = Exclude<StageBoxName, LeftWallPiece> | 'leftWall';

/** An axis-aligned box by its corners. `outward` is the way its invisible side may be thickened. */
export interface StageBox<Name extends string = StageBoxName> {
  name: Name;
  min: Vec3;
  max: Vec3;
  outward: Vec3;
}

/** The window's opening in the left wall: its extent along the wall (z) and up (y). */
export function windowOpening() {
  const { width, height, sill } = STAGE.window;
  return { z0: -width / 2, z1: width / 2, y0: sill, y1: sill + height };
}

/** The six boxes of the stage (the left wall as four pieces), in metres, floor top at y = 0. */
export function stageBoxes(): StageBox[] {
  const w = ROOM.width / 2;
  const d = ROOM.depth / 2;
  const { wallThickness: wt, wallHeight, slabThickness: st, lipHeight, lipThickness: lt } = STAGE;
  const { z0, z1, y0, y1 } = windowOpening();
  const left = (name: LeftWallPiece, zMin: number, zMax: number, yMin: number, yMax: number): StageBox => ({
    name,
    min: [-w - wt, yMin, zMin],
    max: [-w, yMax, zMax],
    outward: [-1, 0, 0],
  });
  return [
    { name: 'slab', min: [-w - wt, -st, -d - wt], max: [w + lt, 0, d + lt], outward: [0, -1, 0] },
    { name: 'backWall', min: [-w - wt, 0, -d - wt], max: [w + lt, wallHeight, -d], outward: [0, 0, -1] },
    left('leftWallBelow', -d, d + lt, 0, y0),
    left('leftWallAbove', -d, d + lt, y1, wallHeight),
    left('leftWallFront', z1, d + lt, y0, y1),
    left('leftWallBack', -d, z0, y0, y1),
    { name: 'frontLip', min: [-w, 0, d], max: [w + lt, lipHeight, d + lt], outward: [0, 0, 0] },
    { name: 'rightLip', min: [w, 0, -d], max: [w + lt, lipHeight, d], outward: [0, 0, 0] },
  ];
}

/**
 * The window's trim boxes, built from the opening's rect: all visual, none a collider. The
 * casing, sill and apron stand on the wall's inner face (x = −width/2), inside the floor's
 * footprint at window height; the frame and rail sit in the opening's reveal.
 */
export function windowBoxes(): StageBox<WindowBoxName>[] {
  const w = ROOM.width / 2;
  const win = STAGE.window;
  const { z0, z1, y0, y1 } = windowOpening();
  const proud = win.casingProud;
  const trim = (name: WindowBoxName, x0: number, x1: number, zMin: number, zMax: number, yMin: number, yMax: number): StageBox<WindowBoxName> => ({
    name,
    min: [x0, yMin, zMin],
    max: [x1, yMax, zMax],
    outward: [0, 0, 0],
  });
  const casingOut = -w + proud;
  const sillTop = y0;
  const sillBottom = y0 - win.sillThickness;
  const frameIn = -w;
  const frameOut = -w - win.frameDepth;
  const midY = (y0 + y1) / 2;
  return [
    trim('casingBack', -w, casingOut, z0 - win.casing, z0, y0, y1),
    trim('casingFront', -w, casingOut, z1, z1 + win.casing, y0, y1),
    trim('casingHead', -w, casingOut, z0 - win.casing, z1 + win.casing, y1, y1 + win.casing),
    trim('sill', -w, casingOut + win.sillDepth, z0 - win.casing, z1 + win.casing, sillBottom, sillTop),
    trim('apron', -w, casingOut, z0, z1, sillBottom - win.apron, sillBottom),
    trim('frameBottom', frameOut, frameIn, z0, z1, y0, y0 + win.frame),
    trim('frameTop', frameOut, frameIn, z0, z1, y1 - win.frame, y1),
    trim('frameBack', frameOut, frameIn, z0, z0 + win.frame, y0 + win.frame, y1 - win.frame),
    trim('frameFront', frameOut, frameIn, z1 - win.frame, z1, y0 + win.frame, y1 - win.frame),
    trim('rail', frameOut, frameIn, z0 + win.frame, z1 - win.frame, midY - win.rail / 2, midY + win.rail / 2),
  ];
}

/** The fixed sky: a plane outside the opening facing the room (+x), by its centre and size. */
export function skyRect(): { centre: Vec3; width: number; height: number } {
  const { skyGap, skyMargin } = STAGE.window;
  const { z0, z1, y0, y1 } = windowOpening();
  const x = -ROOM.width / 2 - STAGE.wallThickness - skyGap;
  return {
    centre: [x, (y0 + y1) / 2, (z0 + z1) / 2],
    width: z1 - z0 + 2 * skyMargin,
    height: y1 - y0 + 2 * skyMargin,
  };
}

/** The box grown on its outward side until it is `thickness` thick there — where nothing is drawn. */
export function thickened<Name extends string>({ min, max, outward, ...rest }: StageBox<Name>, thickness: number): StageBox<Name> {
  const lo = min.map((v, i) => (outward[i] < 0 ? Math.min(v, max[i] - thickness) : v)) as Vec3;
  const hi = max.map((v, i) => (outward[i] > 0 ? Math.max(v, min[i] + thickness) : v)) as Vec3;
  return { ...rest, min: lo, max: hi, outward };
}

/**
 * The boxes the physics world holds: the drawn ones, the slab and walls thickened on their
 * invisible side to `thickness` so a fast part cannot tunnel through, the walls carried up
 * to `ROOM.height` (the lift ceiling — a lifted part never goes over a wall), the lips
 * exactly as drawn so a part is stopped by what it sees. The left wall is ONE solid box
 * across the window's opening: the window is closed and its trim has no colliders.
 */
export function colliderBoxes(thickness: number): StageBox<ColliderName>[] {
  const wall = (box: StageBox): StageBox => {
    const solid = thickened(box, thickness);
    return { ...solid, max: [solid.max[0], ROOM.height, solid.max[2]] };
  };
  const boxes = stageBoxes();
  const pieces = boxes.filter((box) => (LEFT_WALL_PIECES as readonly string[]).includes(box.name));
  // The pieces' bounding box: the wall as it was before the opening was cut.
  const leftWall: StageBox<ColliderName> = {
    ...wall({
      name: pieces[0].name,
      min: pieces.reduce((lo, p) => lo.map((v, i) => Math.min(v, p.min[i])) as Vec3, pieces[0].min),
      max: pieces.reduce((hi, p) => hi.map((v, i) => Math.max(v, p.max[i])) as Vec3, pieces[0].max),
      outward: pieces[0].outward,
    }),
    name: 'leftWall',
  };
  return [
    ...boxes.filter((box) => !pieces.includes(box)).map((box): StageBox<ColliderName> => {
      const name = box.name as Exclude<StageBoxName, LeftWallPiece>;
      if (name === 'slab') return { ...thickened(box, thickness), name };
      if (name === 'backWall') return { ...wall(box), name };
      return { ...box, name };
    }),
    leftWall,
  ];
}

/** `[size, centre]` of a box. */
export function sizeAndCentre({ min, max }: Pick<StageBox<string>, 'min' | 'max'>): { size: Vec3; centre: Vec3 } {
  return {
    size: max.map((v, i) => v - min[i]) as Vec3,
    centre: max.map((v, i) => (v + min[i]) / 2) as Vec3,
  };
}
