// Hardware and tool shapes: what a universal piece looks like in place of its pack box.
// Pure: a part type's size and connectors in, plain primitives out (part-local, metres), so
// Vitest covers them headlessly; src/game/partMesh.ts builds them. Shapes are visual only —
// each primitive lies inside the pack box (the collider stays the box), every connector
// stays where the pack puts it, and every size is read off the box passed in.
//
// Keyed, like the hole decals (src/game/decals.ts), by the connector type that names the
// piece — its fastener end, or a tool's tip — so no item's part names appear here.

import { MODELS } from '../constants.js';
import { CONNECTOR } from '../../tools/validate/lib/vocabulary.js';
import type { ConnectorType } from '../../tools/validate/lib/vocabulary.js';
import type { Size, Vec3 } from '../../tools/validate/lib/geometry.js';
import type { Connector, GamePartType } from './item.js';

/** An index into a Vec3: the part-local axis a primitive runs along. */
export type Axis = 0 | 1 | 2;

/** A primitive's colour: the part's own pack colour, bare metal, or a dark recess. */
export type Tone = 'body' | 'metal' | 'dark';

interface Common {
  axis: Axis;
  /** Centre, part-local. */
  position: Vec3;
  /** Along `axis`. */
  length: number;
  tone: Tone;
}

/** A rod or disc round the axis (`sides` 6 is hexagonal), or a block `width` × `depth` across it. */
type Form = { shape: 'cylinder'; radius: number; sides: number } | { shape: 'box'; width: number; depth: number };

export type Primitive = Common & Form;

/** The two axes across `axis`, in order: a box primitive's `width` runs along the first. */
export const acrossOf = (axis: Axis): [Axis, Axis] => (axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]);

/** A primitive's half-extents along the part's axes (a cylinder's, by its circumradius). */
export function halfExtents(primitive: Primitive): Vec3 {
  const [u, v] = acrossOf(primitive.axis);
  const half: Vec3 = [0, 0, 0];
  half[primitive.axis] = primitive.length / 2;
  half[u] = primitive.shape === 'cylinder' ? primitive.radius : primitive.width / 2;
  half[v] = primitive.shape === 'cylinder' ? primitive.radius : primitive.depth / 2;
  return half;
}

const largestOf = (v: Vec3): Axis => {
  const [x, y, z] = v.map(Math.abs);
  return x >= y && x >= z ? 0 : y >= z ? 1 : 2;
};

/**
 * A straight piece running along its end connector's axis, measured from that end: `from`
 * and `to` are distances in from the end face (0 at the end, `length` at the far end), and
 * `place` puts a primitive between them on the piece's centreline.
 */
function straight(size: Size, end: Connector) {
  const axis = largestOf(end.axis);
  const length = size[axis];
  const sign = Math.sign(end.axis[axis]);
  const [u, v] = acrossOf(axis);
  const radius = Math.min(size[u], size[v]) / 2;
  const place = (from: number, to: number, form: Form, tone: Tone = 'body'): Primitive => {
    const position: Vec3 = [...end.position];
    position[axis] = sign * (length / 2 - (from + to) / 2);
    return { axis, position, length: to - from, tone, ...form };
  };
  const rod = (from: number, to: number, fraction: number, tone: Tone = 'body') =>
    place(from, to, { shape: 'cylinder', radius: radius * fraction, sides: MODELS.segments }, tone);
  return { length, radius, place, rod };
}

type Builder = (size: Size, end: Connector) => Primitive[];

// The Allen key: an L of hexagonal rod, its short leg along the tip's axis ending at the
// tip, its long leg across the box's far edge. The rod is thinner than the box, so the short
// leg sits just inside the tip connector's edge of the box.
const allenKey: Builder = (size, tip) => {
  const shortAxis = largestOf(tip.axis);
  const [u, v] = acrossOf(shortAxis);
  const thin = size[u] <= size[v] ? u : v;
  const longAxis = thin === u ? v : u;
  const radius = (size[thin] / 2) * MODELS.wrenchRod;
  const sign = Math.sign(tip.axis[shortAxis]);
  const rod = (axis: Axis, length: number, position: Vec3): Primitive => ({
    shape: 'cylinder',
    radius,
    sides: MODELS.hexSides,
    axis,
    position,
    length,
    tone: 'body',
  });
  const short: Vec3 = [...tip.position];
  short[shortAxis] = 0;
  short[longAxis] = tip.position[longAxis] - Math.sign(tip.position[longAxis]) * radius;
  const long: Vec3 = [...tip.position];
  long[longAxis] = 0;
  long[shortAxis] = -sign * (size[shortAxis] / 2 - radius);
  return [rod(shortAxis, size[shortAxis], short), rod(longAxis, size[longAxis], long)];
};

// The screwdriver: a flat metal blade at the tip, a thin metal shaft, and the handle in the
// pack's colour filling the box's width at the top.
const screwdriver: Builder = (size, tip) => {
  const { length, radius, place, rod } = straight(size, tip);
  const blade = length * MODELS.screwdriverBlade;
  const handle = length * (1 - MODELS.screwdriverHandle);
  const shaft = 2 * radius * MODELS.screwdriverShaft;
  return [
    place(0, blade, { shape: 'box', width: shaft, depth: shaft * MODELS.screwdriverBladeThickness }, 'metal'),
    rod(blade, handle, MODELS.screwdriverShaft, 'metal'),
    rod(handle, length, 1),
  ];
};

// A dowel: one wooden cylinder end to end.
const dowel: Builder = (size, end) => {
  const { length, rod } = straight(size, end);
  return [rod(0, length, 1)];
};

// A cam bolt: a threaded shaft from its thread end, and the head the box's full width.
const camBolt: Builder = (size, thread) => {
  const { length, rod } = straight(size, thread);
  const head = length * (1 - MODELS.boltCap);
  return [rod(0, head, MODELS.boltShaft), rod(head, length, 1)];
};

// A cam lock: a disc the box's diameter, and a dark slot across its top face.
const camLock: Builder = (size, body) => {
  const { length, radius, place, rod } = straight(size, body);
  const top = length * (1 - MODELS.driveSlotDepth);
  return [
    rod(0, top, 1),
    place(top, length, { shape: 'box', width: 2 * radius * MODELS.driveSlotLength, depth: 2 * radius * MODELS.driveSlotWidth }, 'dark'),
  ];
};

// A shelf pin: a short rod with a collar where the shelf rests on it.
const shelfPin: Builder = (size, tip) => {
  const { length, rod } = straight(size, tip);
  const collar = length * MODELS.pinCollarAt;
  return [rod(0, length, MODELS.pinRod), rod(collar, collar + length * MODELS.pinCollar, 1)];
};

// A back fitting: a plug, and the head the box's full width.
const backFitting: Builder = (size, tip) => {
  const { length, rod } = straight(size, tip);
  const head = length * (1 - MODELS.fittingHead);
  return [rod(0, head, MODELS.fittingShaft), rod(head, length, 1)];
};

// A double-ended stud: a plain rod end to end, with a dark hexagonal plug at each end for
// the hex socket the key goes in (each end carries a bolt-head connector of its own). The
// plugs are narrower than the rod, so they read as sockets sunk into its ends.
const studEnd: Builder = (size, end) => {
  const { length, radius, place, rod } = straight(size, end);
  const depth = length * MODELS.studSocketDepth;
  const plug = (from: number, to: number) =>
    place(from, to, { shape: 'cylinder', radius: radius * MODELS.studSocket, sides: MODELS.hexSides }, 'dark');
  return [plug(0, depth), rod(depth, length - depth, 1), plug(length - depth, length)];
};

// A wood screw: a thin metal thread from its tip, the head the box's full width, and a dark
// slot across the head's top face where the screwdriver goes in.
const woodScrew: Builder = (size, thread) => {
  const { length, radius, place, rod } = straight(size, thread);
  const head = length * (1 - MODELS.screwHead);
  const slot = length * (1 - MODELS.driveSlotDepth);
  return [
    rod(0, head, MODELS.screwShaft, 'metal'),
    rod(head, slot, 1),
    place(slot, length, { shape: 'box', width: 2 * radius * MODELS.driveSlotLength, depth: 2 * radius * MODELS.driveSlotWidth }, 'dark'),
  ];
};

const BUILDERS: Readonly<Partial<Record<ConnectorType, Builder>>> = Object.freeze({
  [CONNECTOR.WRENCH_TIP]: allenKey,
  [CONNECTOR.SCREWDRIVER_TIP]: screwdriver,
  [CONNECTOR.DOWEL_END]: dowel,
  [CONNECTOR.BOLT_THREAD]: camBolt,
  [CONNECTOR.CAM_LOCK_BODY]: camLock,
  [CONNECTOR.PIN_TIP]: shelfPin,
  [CONNECTOR.BACK_FITTING_TIP]: backFitting,
  [CONNECTOR.STUD_END]: studEnd,
  [CONNECTOR.SCREW_THREAD]: woodScrew,
});

/**
 * A universal piece's primitives, part-local, or null for anything else (panels, the box),
 * which keeps its box. The piece is named by its first connector with a shape.
 */
export function shapeOf({ size, connectors }: Pick<GamePartType, 'size' | 'connectors'>): Primitive[] | null {
  for (const connector of connectors) {
    const build = BUILDERS[connector.type];
    if (build) return build(size, connector);
  }
  return null;
}
