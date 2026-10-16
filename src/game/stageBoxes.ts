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

/** The two walls of the stage; each is cut round its windows. */
export type WallName = 'left' | 'back';
export const WALL_NAMES: readonly WallName[] = ['left', 'back'];

/** A wall's piece: below the windows, above them, or a pier between (or beside) them. */
export type WallPieceName = `${WallName}WallBelow` | `${WallName}WallAbove` | `${WallName}WallPier${number}`;

export type StageBoxName = 'slab' | 'frontLip' | 'rightLip' | WallPieceName;

/** The window's trim: casing round the opening, sill and apron under it, frame and meeting rail inside it. */
export type WindowPart = 'CasingLow' | 'CasingHigh' | 'CasingHead' | 'Sill' | 'Apron' | 'FrameBottom' | 'FrameTop' | 'FrameLow' | 'FrameHigh' | 'Rail';
export type WindowBoxName = `${WallName}Window${number}${WindowPart}`;

/** What the physics world holds: each wall is one solid box there. */
export type ColliderName = 'slab' | 'frontLip' | 'rightLip' | `${WallName}Wall`;

/** An axis-aligned box by its corners. `outward` is the way its invisible side may be thickened. */
export interface StageBox<Name extends string = StageBoxName> {
  name: Name;
  min: Vec3;
  max: Vec3;
  outward: Vec3;
}

/** One window opening: its extent along the wall and up. */
export interface Opening {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
}

/**
 * Where a wall stands, as axes: `along` is the axis it runs on, `across` the one through its
 * thickness; its inner face is at `inner` on `across` and the room lies in the + direction.
 */
interface WallSpec {
  along: 1 | 0 | 2;
  across: 0 | 2;
  inner: number;
  alongMin: number;
  alongMax: number;
  /** The room's extent along the wall, which the windows are spread over. */
  span: number;
  /** Yaw turning a plane's +z normal to face into the room. */
  yaw: number;
  outward: Vec3;
}

function wallSpec(name: WallName): WallSpec {
  const w = ROOM.width / 2;
  const d = ROOM.depth / 2;
  const { wallThickness: wt, lipThickness: lt } = STAGE;
  return name === 'left'
    ? { along: 2, across: 0, inner: -w, alongMin: -d, alongMax: d + lt, span: ROOM.depth, yaw: Math.PI / 2, outward: [-1, 0, 0] }
    : { along: 0, across: 2, inner: -d, alongMin: -w - wt, alongMax: w + lt, span: ROOM.width, yaw: 0, outward: [0, 0, -1] };
}

/** A box on a wall from its extent along it, up it, and through it (`c0`..`c1` on the across axis). */
function onWall<Name extends string>(name: Name, wall: WallSpec, a0: number, a1: number, y0: number, y1: number, c0: number, c1: number): StageBox<Name> {
  const min: Vec3 = [0, y0, 0];
  const max: Vec3 = [0, y1, 0];
  min[wall.along] = a0;
  max[wall.along] = a1;
  min[wall.across] = c0;
  max[wall.across] = c1;
  return { name, min, max, outward: [0, 0, 0] };
}

/** The window openings of a wall, evenly spaced over the room's extent along it. */
export function windowOpenings(name: WallName, win: typeof STAGE.window = STAGE.window): Opening[] {
  const { span } = wallSpec(name);
  const count = win.count[name];
  return Array.from({ length: count }, (_, i) => {
    const centre = (span * (i + 1)) / (count + 1) - span / 2;
    return { a0: centre - win.width / 2, a1: centre + win.width / 2, y0: win.sill, y1: win.sill + win.height };
  });
}

/** What stops the windows fitting in the walls — empty when they fit. Pure, so a tuned size is caught by a test. */
export function windowProblems(win: typeof STAGE.window = STAGE.window, wallHeight: number = STAGE.wallHeight): string[] {
  const problems: string[] = [];
  if (win.sill + win.height + win.casing > wallHeight) problems.push('the casing head rises above the wall top');
  if (win.sill - win.sillThickness - win.apron < 0) problems.push('the apron reaches below the floor');
  if (2 * win.frame + win.rail >= win.height || 2 * win.frame >= win.width) problems.push('the frame leaves no room for the sashes');
  for (const name of WALL_NAMES) {
    const pitch = wallSpec(name).span / (win.count[name] + 1);
    if (win.width + 2 * win.casing > pitch) problems.push(`the ${name} wall's windows and casings do not fit along it`);
  }
  return problems;
}

/** A wall before its openings are cut: one box, inner face on the room's edge. */
export function wallBox<Name extends WallName>(name: Name): StageBox<`${Name}Wall`> {
  const wall = wallSpec(name);
  const { wallThickness: wt, wallHeight } = STAGE;
  return { ...onWall(`${name}Wall` as const, wall, wall.alongMin, wall.alongMax, 0, wallHeight, wall.inner - wt, wall.inner), outward: wall.outward };
}

/** The openings through the wall's thickness, as boxes — the edges the ink draws round the holes. */
export function windowOpeningBoxes(name: WallName): StageBox<string>[] {
  const wall = wallSpec(name);
  return windowOpenings(name).map((o, i) => onWall(`${name}Opening${i}`, wall, o.a0, o.a1, o.y0, o.y1, wall.inner - STAGE.wallThickness, wall.inner));
}

/** A wall as the boxes round its openings: below, above, and a pier before, between and after the windows. */
export function wallPieces(name: WallName): StageBox<WallPieceName>[] {
  const wall = wallSpec(name);
  const { wallThickness: wt, wallHeight } = STAGE;
  const openings = windowOpenings(name);
  const { y0, y1 } = openings[0];
  const c0 = wall.inner - wt;
  const piece = <N extends WallPieceName>(n: N, a0: number, a1: number, lo: number, hi: number): StageBox<N> => ({
    ...onWall(n, wall, a0, a1, lo, hi, c0, wall.inner),
    outward: wall.outward,
  });
  const edges = [wall.alongMin, ...openings.flatMap((o) => [o.a0, o.a1]), wall.alongMax];
  const piers = openings.length + 1;
  return [
    piece(`${name}WallBelow`, wall.alongMin, wall.alongMax, 0, y0),
    piece(`${name}WallAbove`, wall.alongMin, wall.alongMax, y1, wallHeight),
    ...Array.from({ length: piers }, (_, i) => piece(`${name}WallPier${i}` as const, edges[2 * i], edges[2 * i + 1], y0, y1)),
  ];
}

/** The boxes of the stage (each wall as pieces round its windows), in metres, floor top at y = 0. */
export function stageBoxes(): StageBox[] {
  const problems = windowProblems();
  if (problems.length > 0) throw new Error(`STAGE.window does not fit the walls: ${problems.join('; ')}`);
  const w = ROOM.width / 2;
  const d = ROOM.depth / 2;
  const { wallThickness: wt, slabThickness: st, lipHeight, lipThickness: lt } = STAGE;
  const rest: StageBox[] = [
    { name: 'slab', min: [-w - wt, -st, -d - wt], max: [w + lt, 0, d + lt], outward: [0, -1, 0] },
    { name: 'frontLip', min: [-w, 0, d], max: [w + lt, lipHeight, d + lt], outward: [0, 0, 0] },
    { name: 'rightLip', min: [w, 0, -d], max: [w + lt, lipHeight, d], outward: [0, 0, 0] },
  ];
  return [...rest, ...WALL_NAMES.flatMap(wallPieces)];
}

/**
 * The trim boxes of one wall's windows, built from the openings: all visual, none a
 * collider. The casing, sill and apron stand on the wall's inner face, inside the floor's
 * footprint at window height; the frame and rail sit in the opening's reveal.
 */
export function windowBoxes(name: WallName): StageBox<WindowBoxName>[] {
  const wall = wallSpec(name);
  const win = STAGE.window;
  const out = wall.inner + win.casingProud;
  const sillOut = out + win.sillDepth;
  const frameIn = wall.inner;
  const frameOut = wall.inner - win.frameDepth;
  return windowOpenings(name).flatMap((o, i) => {
    const trim = (part: WindowPart, a0: number, a1: number, y0: number, y1: number, c0: number, c1: number) =>
      onWall<WindowBoxName>(`${name}Window${i}${part}`, wall, a0, a1, y0, y1, c0, c1);
    const sillBottom = o.y0 - win.sillThickness;
    const midY = (o.y0 + o.y1) / 2;
    return [
      trim('CasingLow', o.a0 - win.casing, o.a0, o.y0, o.y1, wall.inner, out),
      trim('CasingHigh', o.a1, o.a1 + win.casing, o.y0, o.y1, wall.inner, out),
      trim('CasingHead', o.a0 - win.casing, o.a1 + win.casing, o.y1, o.y1 + win.casing, wall.inner, out),
      trim('Sill', o.a0 - win.casing, o.a1 + win.casing, sillBottom, o.y0, wall.inner, sillOut),
      trim('Apron', o.a0, o.a1, sillBottom - win.apron, sillBottom, wall.inner, out),
      trim('FrameBottom', o.a0, o.a1, o.y0, o.y0 + win.frame, frameOut, frameIn),
      trim('FrameTop', o.a0, o.a1, o.y1 - win.frame, o.y1, frameOut, frameIn),
      trim('FrameLow', o.a0, o.a0 + win.frame, o.y0 + win.frame, o.y1 - win.frame, frameOut, frameIn),
      trim('FrameHigh', o.a1 - win.frame, o.a1, o.y0 + win.frame, o.y1 - win.frame, frameOut, frameIn),
      trim('Rail', o.a0 + win.frame, o.a1 - win.frame, midY - win.rail / 2, midY + win.rail / 2, frameOut, frameIn),
    ];
  });
}

/** The mouth of a wall's scenery box: a rectangle on the wall's outer face, turned to face the room. */
export interface SceneryMouth {
  /** The mouth's centre in the room's frame. */
  centre: Vec3;
  width: number;
  height: number;
  yaw: number;
  /** The wall-axis coordinate (world) of the centre, and +1 or -1 by which way the mouth's x runs along that axis. */
  alongCentre: number;
  alongSign: 1 | -1;
}

/**
 * The mouth of the scenery box behind a wall's windows: one rectangle on the wall's outer face spanning every opening
 * and `skyMargin` past them, never above the wall's top nor below the floor. The windows of a wall share the box.
 */
export function sceneryMouth(name: WallName): SceneryMouth {
  const wall = wallSpec(name);
  const { skyMargin } = STAGE.window;
  const openings = windowOpenings(name);
  const a0 = Math.min(...openings.map((o) => o.a0)) - skyMargin;
  const a1 = Math.max(...openings.map((o) => o.a1)) + skyMargin;
  // Never above the wall's top (a band hovering over the wall) nor below the floor.
  const top = Math.min(Math.max(...openings.map((o) => o.y1)) + skyMargin, STAGE.wallHeight);
  const bottom = Math.max(Math.min(...openings.map((o) => o.y0)) - skyMargin, 0);
  const alongCentre = (a0 + a1) / 2;
  const centre: Vec3 = [0, (top + bottom) / 2, 0];
  centre[wall.across] = wall.inner - STAGE.wallThickness;
  centre[wall.along] = alongCentre;
  // A plane turned by `yaw` about y carries its x axis to (cos yaw, 0, -sin yaw).
  const alongSign = Math.round(wall.along === 0 ? Math.cos(wall.yaw) : -Math.sin(wall.yaw)) as 1 | -1;
  return { centre, width: a1 - a0, height: top - bottom, yaw: wall.yaw, alongCentre, alongSign };
}

/** The box grown on its outward side until it is `thickness` thick there — where nothing is drawn. */
export function thickened<Name extends string>({ min, max, outward, ...rest }: StageBox<Name>, thickness: number): StageBox<Name> {
  const lo = min.map((v, i) => (outward[i] < 0 ? Math.min(v, max[i] - thickness) : v)) as Vec3;
  const hi = max.map((v, i) => (outward[i] > 0 ? Math.max(v, min[i] + thickness) : v)) as Vec3;
  return { ...rest, min: lo, max: hi, outward };
}

/**
 * The boxes the physics world holds: the slab and walls thickened on their invisible side
 * to `thickness` so a fast part cannot tunnel through, the walls carried up to
 * `ROOM.height` (the lift ceiling — a lifted part never goes over a wall), the lips exactly
 * as drawn so a part is stopped by what it sees. Each wall is ONE solid box across its
 * windows: the windows are closed and their trim has no colliders.
 */
export function colliderBoxes(thickness: number): StageBox<ColliderName>[] {
  const wall = <Name extends string>(box: StageBox<Name>): StageBox<Name> => {
    const solid = thickened(box, thickness);
    return { ...solid, max: [solid.max[0], ROOM.height, solid.max[2]] };
  };
  const drawn = stageBoxes();
  const named = (name: 'slab' | 'frontLip' | 'rightLip') => drawn.find((box) => box.name === name)! as StageBox<typeof name>;
  return [
    thickened(named('slab'), thickness),
    named('frontLip'),
    named('rightLip'),
    ...WALL_NAMES.map((name) => wall(wallBox(name))),
  ];
}

/** `[size, centre]` of a box. */
export function sizeAndCentre({ min, max }: Pick<StageBox<string>, 'min' | 'max'>): { size: Vec3; centre: Vec3 } {
  return {
    size: max.map((v, i) => v - min[i]) as Vec3,
    centre: max.map((v, i) => (v + min[i]) / 2) as Vec3,
  };
}
