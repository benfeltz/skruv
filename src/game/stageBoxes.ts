// Pure geometry of the diorama stage — no Three, no Rapier — so the drawn room and its
// colliders are built from the same boxes and Vitest covers them headlessly.
//
// Every box with a collider stands OUTSIDE the floor's footprint (|x| <= width/2,
// |z| <= depth/2), except the slab under y = 0, so the clamps that read ROOM (drag, lift,
// snap, respawn) are unchanged: the floor's top face is the slab's top face, at y = 0.
// The one exception is the window's trim (`windowBoxes`): visual only, no colliders, it
// stands up to casingProud + sillDepth inside the footprint at window height.

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

/** The stage's boxes that are not the left wall. */
type RestName = Exclude<StageBoxName, LeftWallPiece>;

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

/** What stops the window fitting in the wall — empty when it fits. Pure, so a tuned size is caught by a test. */
export function windowProblems(
  win: typeof STAGE.window = STAGE.window,
  wallHeight: number = STAGE.wallHeight,
  depth: number = ROOM.depth,
): string[] {
  const problems: string[] = [];
  const top = win.sill + win.height;
  if (win.width / 2 + win.casing > depth / 2) problems.push('the casing runs past the wall\'s ends');
  if (top + win.casing > wallHeight) problems.push('the casing head rises above the wall top');
  if (win.sill - win.sillThickness - win.apron < 0) problems.push('the apron reaches below the floor');
  if (2 * win.frame + win.rail >= win.height || 2 * win.frame >= win.width) problems.push('the frame leaves no room for the sashes');
  return problems;
}

/** The left wall before the opening is cut: one box on the room's left edge, inner face at x = −width/2. */
export function leftWallBox(): StageBox<'leftWall'> {
  const w = ROOM.width / 2;
  const d = ROOM.depth / 2;
  const { wallThickness: wt, wallHeight, lipThickness: lt } = STAGE;
  return { name: 'leftWall', min: [-w - wt, 0, -d], max: [-w, wallHeight, d + lt], outward: [-1, 0, 0] };
}

/** The opening through the wall's thickness, as a box — the edges the ink draws round the hole. */
export function windowOpeningBox(): StageBox<'opening'> {
  const { z0, z1, y0, y1 } = windowOpening();
  const { min, max } = leftWallBox();
  return { name: 'opening', min: [min[0], y0, z0], max: [max[0], y1, z1], outward: [0, 0, 0] };
}

/** The left wall as the four boxes round the opening, tiling `leftWallBox` minus `windowOpeningBox`. */
export function leftWallPieces(): StageBox<LeftWallPiece>[] {
  const { min, max, outward } = leftWallBox();
  const { z0, z1, y0, y1 } = windowOpening();
  const piece = (name: LeftWallPiece, zMin: number, zMax: number, yMin: number, yMax: number): StageBox<LeftWallPiece> => ({
    name,
    min: [min[0], yMin, zMin],
    max: [max[0], yMax, zMax],
    outward,
  });
  return [
    piece('leftWallBelow', min[2], max[2], min[1], y0),
    piece('leftWallAbove', min[2], max[2], y1, max[1]),
    piece('leftWallFront', z1, max[2], y0, y1),
    piece('leftWallBack', min[2], z0, y0, y1),
  ];
}

/** The six boxes of the stage (the left wall as four pieces), in metres, floor top at y = 0. */
export function stageBoxes(): StageBox[] {
  const problems = windowProblems();
  if (problems.length > 0) throw new Error(`STAGE.window does not fit the wall: ${problems.join('; ')}`);
  const w = ROOM.width / 2;
  const d = ROOM.depth / 2;
  const { wallThickness: wt, wallHeight, slabThickness: st, lipHeight, lipThickness: lt } = STAGE;
  const rest: StageBox<RestName>[] = [
    { name: 'slab', min: [-w - wt, -st, -d - wt], max: [w + lt, 0, d + lt], outward: [0, -1, 0] },
    { name: 'backWall', min: [-w - wt, 0, -d - wt], max: [w + lt, wallHeight, -d], outward: [0, 0, -1] },
    { name: 'frontLip', min: [-w, 0, d], max: [w + lt, lipHeight, d + lt], outward: [0, 0, 0] },
    { name: 'rightLip', min: [w, 0, -d], max: [w + lt, lipHeight, d], outward: [0, 0, 0] },
  ];
  return [...rest, ...leftWallPieces()];
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

/**
 * The fixed sky: a plane outside the opening facing the room (+x), by its centre and size.
 * It stands `skyGap` behind the wall and reaches `skyMargin` past the opening: a ray through
 * the reveal runs at most width/wallThickness sideways per metre, so margin ≥ gap × that
 * keeps the dark background out of the window at any view the reveal lets through.
 */
export function skyRect(): { centre: Vec3; width: number; height: number } {
  const { skyGap, skyMargin } = STAGE.window;
  const { z0, z1, y0, y1 } = windowOpening();
  const x = -ROOM.width / 2 - STAGE.wallThickness - skyGap;
  // Never above the wall's top (a band hovering over the wall) nor below the floor.
  const top = Math.min(y1 + skyMargin, STAGE.wallHeight);
  const bottom = Math.max(y0 - skyMargin, 0);
  return {
    centre: [x, (top + bottom) / 2, (z0 + z1) / 2],
    width: z1 - z0 + 2 * skyMargin,
    height: top - bottom,
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
  const wall = <Name extends string>(box: StageBox<Name>): StageBox<Name> => {
    const solid = thickened(box, thickness);
    return { ...solid, max: [solid.max[0], ROOM.height, solid.max[2]] };
  };
  return stageBoxes().flatMap((box): StageBox<ColliderName>[] => {
    switch (box.name) {
      case 'slab': return [thickened({ ...box, name: box.name }, thickness)];
      case 'backWall': return [wall({ ...box, name: box.name })];
      case 'frontLip':
      case 'rightLip': return [{ ...box, name: box.name }];
      default: return [];
    }
  }).concat(wall(leftWallBox()));
}

/** `[size, centre]` of a box. */
export function sizeAndCentre({ min, max }: Pick<StageBox<string>, 'min' | 'max'>): { size: Vec3; centre: Vec3 } {
  return {
    size: max.map((v, i) => v - min[i]) as Vec3,
    centre: max.map((v, i) => (v + min[i]) / 2) as Vec3,
  };
}
