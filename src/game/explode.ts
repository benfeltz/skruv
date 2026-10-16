// Exploded step drawings: where everything a page adds sits when it is pulled out of the
// hole it goes into, along the leader lines back, and what each detail inset frames. Pure
// maths on the assembled poses; src/scene/bookletPages.ts only draws the result. Every
// distance is BOOKLET.explode / BOOKLET.inset.

import { BOOKLET } from '../constants.js';
import { add, connectorInWorld, scale } from '../../tools/validate/lib/geometry.js';
import type { Pose, Vec3 } from '../../tools/validate/lib/geometry.js';
import type { BuildStep, PartCount } from './bookletModel.js';
import type { Connector, GamePartType, InstanceId, Joint } from './item.js';

/** The assembled item an exploded drawing is worked out from: poses and derived joints. */
export interface ExplodeLayout {
  parts: readonly (Pose & { id: InstanceId; type: string })[];
  joints: readonly Joint[];
}

type PartTypes = Readonly<Record<string, Pick<GamePartType, 'partNumber' | 'size'> & { connectors: readonly Pick<Connector, 'position' | 'axis'>[] }>>;

/** One part as an exploded drawing places it. */
export interface ExplodedItem extends Pose {
  id: InstanceId;
  type: string;
}

/** A line from a floated fastener's seated spot to where it floats. */
export type Leader = [Vec3, Vec3];

/** A detail inset: one fastener type, one representative joint, a tight view of it. */
export interface Inset extends PartCount {
  /** Index into `layout.joints` of the joint it magnifies. */
  joint: number;
  /** The host part at its pose and the fastener floating out of it. */
  items: ExplodedItem[];
  /** The line from the fastener's seated spot to where it floats in the inset. */
  leader: Leader;
  /** The box the inset frames — the hole mouth and the floated fastener — in the main drawing's frame. */
  focus: { min: Vec3; max: Vec3 };
  /** The hole's world axis, out of its mouth: the way the fastener floats. */
  axis: Vec3;
  /** The hole's world position: where the inset's tail lands in the main drawing. */
  anchor: Vec3;
}

const ZERO: Vec3 = [0, 0, 0];

// A layout's parts by id, built once per layout.
const partsOf = new WeakMap<ExplodeLayout, ReadonlyMap<InstanceId, ExplodeLayout['parts'][number]>>();

// Look-ups over a layout: a part by id, and a joint's hole and fastener end in the world.
function lookups(layout: ExplodeLayout, partTypes: PartTypes) {
  let partById = partsOf.get(layout);
  if (!partById) partsOf.set(layout, (partById = new Map(layout.parts.map((p) => [p.id, p]))));
  const byId = partById;
  // Every id a joint names is a part of the layout.
  const part = (id: InstanceId) => byId.get(id)!;
  const hole = (j: Joint) => connectorInWorld(partTypes[part(j.host).type].connectors[j.hostConnector], part(j.host));
  const end = (j: Joint) => connectorInWorld(partTypes[part(j.hardware).type].connectors[j.hardwareConnector], part(j.hardware)).position;
  return { part, hole, end };
}

/**
 * THE SEPARATION RULE. Everything a page adds moves out of the hole it goes into, along
 * that hole's world axis (the axis points out of the hole's mouth):
 *   - a piece of hardware this page pushes in (the joint's `mover` is the hardware) floats
 *     out by `BOOKLET.explode.hardware`;
 *   - a part pressed onto hardware (the joint's `mover` is the host) is pulled away by
 *     `BOOKLET.explode.part`, against the axis, its direction the normalised average over
 *     every joint of the page that presses it on;
 *   - hardware that floats out of a part that is itself pulled away goes along with it;
 *     hardware already sitting only in pulled-away parts rides with them;
 *   - everything else — already-built parts, hardware seated earlier — stays put.
 * A loose-parts page (pose 'parts') fans its panels instead, so only hardware floats there.
 * Returns each displaced id's offset and the floated fasteners' leaders.
 */
export function separation(step: Pick<BuildStep, 'joints' | 'pose' | 'shown'>, layout: ExplodeLayout, partTypes: PartTypes) {
  const { hole, end } = lookups(layout, partTypes);
  const joints = step.joints.map((i) => layout.joints[i]);

  const pressedOn = new Map<InstanceId, Vec3>();
  if (step.pose !== 'parts') {
    for (const j of joints) {
      if (j.mover === j.hardware) continue;
      pressedOn.set(j.mover, add(pressedOn.get(j.mover) ?? ZERO, scale(hole(j).axis, -1)));
    }
  }
  const offsets = new Map<InstanceId, Vec3>();
  for (const [id, sum] of pressedOn) {
    const length = Math.hypot(...sum);
    // Opposing joints cancel: nothing to pull away along.
    if (length > BOOKLET.explode.cancel) offsets.set(id, scale(sum, BOOKLET.explode.part / length));
  }

  const leaders: Leader[] = [];
  const floated = new Set<InstanceId>();
  for (const j of joints) {
    if (j.mover !== j.hardware || floated.has(j.hardware)) continue;
    floated.add(j.hardware);
    // Seated in a part that is pulled away: the fastener goes along with it.
    const carried = offsets.get(j.host) ?? ZERO;
    const from = add(end(j), carried);
    const offset = add(carried, scale(hole(j).axis, BOOKLET.explode.hardware));
    offsets.set(j.hardware, offset);
    leaders.push([from, add(end(j), offset)]);
  }

  // Hardware seated earlier, only in pulled-away parts, rides with them.
  const shown = new Set(step.shown);
  const hostsOf = new Map<InstanceId, InstanceId[]>();
  for (const j of layout.joints) {
    if (!shown.has(j.host)) continue;
    const hosts = hostsOf.get(j.hardware);
    if (hosts) hosts.push(j.host);
    else hostsOf.set(j.hardware, [j.host]);
  }
  for (const id of step.shown) {
    const hosts = hostsOf.get(id) ?? [];
    if (offsets.has(id) || !hosts.length || !hosts.every((h) => offsets.has(h) && !floated.has(h))) continue;
    offsets.set(id, offsets.get(hosts[0])!);
  }
  return { offsets, leaders };
}

/**
 * The page's drawing: every part of `step.shown` at its pose with its separation offset,
 * the leaders from floated fasteners back to their holes, and each displaced part's offset.
 */
export function explodeStep(step: Pick<BuildStep, 'joints' | 'pose' | 'shown'>, layout: ExplodeLayout, partTypes: PartTypes) {
  const { offsets, leaders } = separation(step, layout, partTypes);
  const { part } = lookups(layout, partTypes);
  const items = step.shown.map((id): ExplodedItem => {
    const { type, position, rotation } = part(id);
    return { id, type, position: add(position, offsets.get(id) ?? ZERO), rotation };
  });
  return { items, leaders, offsets };
}

/**
 * Where a piece of hardware floats out of one hole: its fastener end's seated spot, and
 * the spot `BOOKLET.explode.hardware` out along the hole's axis. For a loose-parts page,
 * which lays each panel flat in a frame of its own and floats the hardware there.
 */
export function floatOut(joint: Joint, layout: ExplodeLayout, partTypes: PartTypes): Leader {
  const { hole, end } = lookups(layout, partTypes);
  return [end(joint), add(end(joint), scale(hole(joint).axis, BOOKLET.explode.hardware))];
}

/**
 * One detail inset per fastener type the page adds, in `step.hardware`'s order: its count
 * and part number, the first joint of that type the page seats (one it pushes the fastener in by, if any), the host at its pose with
 * the fastener floated out of it (by its own length's fraction, `BOOKLET.inset.float`), and
 * the box round the hole mouth and the floated fastener to frame.
 */
export function insetsFor(step: Pick<BuildStep, 'joints' | 'hardware'>, layout: ExplodeLayout, partTypes: PartTypes): Inset[] {
  const { part, hole, end } = lookups(layout, partTypes);
  const insets: Inset[] = [];
  for (const count of step.hardware) {
    // The joint the page pushes the fastener in by; a piece the page seats only by its second
    // end (a part pressed onto it) still counts, so any joint of its type will do.
    const ofType = step.joints.filter((i) => part(layout.joints[i].hardware).type === count.type);
    const index = ofType.find((i) => layout.joints[i].mover === layout.joints[i].hardware) ?? ofType[0];
    // `hardware` counts the pieces the page's own joints seat, so one exists.
    if (index === undefined) continue;
    const joint = layout.joints[index];
    const host = part(joint.host);
    const fastener = part(joint.hardware);
    const { position: anchor, axis } = hole(joint);
    // The inset floats the fastener a short way of its own, in its own length, not the page's
    // `explode.hardware`: close enough that the fastener and the host round the hole fill the
    // circle between them.
    const longest = Math.max(...partTypes[fastener.type].size);
    const lift = scale(axis, longest * BOOKLET.inset.float);
    const from = end(joint);
    const floated = add(fastener.position, lift);
    // Frame the hole mouth and the floated fastener, `focus` of the fastener's length to spare.
    const reach = longest * BOOKLET.inset.focus;
    const spots = [anchor, floated];
    const box = (pick: (...values: number[]) => number, sign: number): Vec3 => [0, 1, 2].map((k) => pick(...spots.map((spot) => spot[k] + sign * reach))) as Vec3;
    const focus = { min: box(Math.min, -1), max: box(Math.max, 1) };
    insets.push({
      ...count,
      joint: index,
      items: [
        { id: host.id, type: host.type, position: host.position, rotation: host.rotation },
        { id: fastener.id, type: fastener.type, position: floated, rotation: fastener.rotation },
      ],
      leader: [from, add(from, lift)],
      focus,
      axis,
      anchor,
    });
  }
  return insets;
}
