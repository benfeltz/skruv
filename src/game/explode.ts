// Exploded step drawings: where everything a page adds sits when it is pulled out of the
// hole it goes into, along the leader lines back, and what each detail inset frames. Pure
// maths on the assembled poses; src/scene/bookletPages.ts only draws the result. Every
// distance is BOOKLET.explode / BOOKLET.inset.

import { BOOKLET } from '../constants.js';
import { add, connectorInWorld, rotateVector, rotationBetween, scale, sub } from '../../tools/validate/lib/geometry.js';
import type { Pose, Quat, Size, Vec3 } from '../../tools/validate/lib/geometry.js';
import { COMPATIBLE } from '../../tools/validate/lib/vocabulary.js';
import type { BuildStep, PartCount } from './bookletModel.js';
import type { Connector, GamePartType, InstanceId, Joint } from './item.js';

/** The assembled item an exploded drawing is worked out from: poses and derived joints. */
export interface ExplodeLayout {
  parts: readonly (Pose & { id: InstanceId; type: string })[];
  joints: readonly Joint[];
}

type PartTypes = Readonly<Record<string, Pick<GamePartType, 'partNumber' | 'size'> & { connectors: readonly Pick<Connector, 'position' | 'axis' | 'type'>[] }>>;

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
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

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
 * Returns each displaced id's offset, the floated fasteners' leaders and the ids pulled away.
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
  const pulled: InstanceId[] = [];
  for (const [id, sum] of pressedOn) {
    const length = Math.hypot(...sum);
    // Opposing joints cancel: nothing to pull away along.
    if (length > BOOKLET.explode.cancel) {
      offsets.set(id, scale(sum, BOOKLET.explode.part / length));
      pulled.push(id);
    }
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
  return { offsets, leaders, pulled };
}

/**
 * An install page's assembly held off its place: every member moves `BOOKLET.explode.assembly`
 * along `BOOKLET.explode.installDirection`, no leaders. `arrow` runs from the centre of the
 * members' box where it is held to the centre where it rests; null on any other page.
 */
export function installStep(step: Partial<Pick<BuildStep, 'install'>>, layout: ExplodeLayout, partTypes: PartTypes) {
  const offsets = new Map<InstanceId, Vec3>();
  if (!step.install) return { offsets, arrow: null };
  const { part } = lookups(layout, partTypes);
  const offset = scale(BOOKLET.explode.installDirection, BOOKLET.explode.assembly);
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const id of step.install.members) {
    offsets.set(id, offset);
    const { type, position, rotation } = part(id);
    const [sx, sy, sz] = partTypes[type].size;
    // The member's box corners in the world, to bound the whole assembly.
    for (const corner of [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z): Vec3 => [(x * sx) / 2, (y * sy) / 2, (z * sz) / 2])))) {
      const world = add(position, rotateVector(rotation, corner));
      for (const k of [0, 1, 2]) {
        lo[k] = Math.min(lo[k], world[k]);
        hi[k] = Math.max(hi[k], world[k]);
      }
    }
  }
  const centre = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2) as Vec3;
  return { offsets, arrow: [add(centre, offset), centre] as [Vec3, Vec3] };
}

/**
 * The solid arrow of a part pulled away by `offset`: from its held-off face to its seated face,
 * along the offset — the part's far face along the pull, so the arrow spans the gap exactly.
 */
function motionArrow(part: ExplodeLayout['parts'][number], offset: Vec3, partTypes: PartTypes): Leader {
  const length = Math.hypot(...offset);
  const direction = scale(offset, 1 / length);
  const seated = sub(part.position, scale(direction, extentAlong(partTypes[part.type].size, part.rotation, direction)));
  return [add(seated, offset), seated];
}

/**
 * The page's drawing: every part of `step.shown` at its pose with its separation offset
 * (an install page's members held off their place besides), the leaders from floated
 * fasteners back to their holes, each displaced part's offset, and the solid arrows: one per
 * part pulled away, then an install page's.
 */
export function explodeStep(step: Pick<BuildStep, 'joints' | 'pose' | 'shown'> & Partial<Pick<BuildStep, 'install'>>, layout: ExplodeLayout, partTypes: PartTypes) {
  const { offsets, leaders, pulled } = separation(step, layout, partTypes);
  const { part } = lookups(layout, partTypes);
  const arrows = pulled.map((id) => motionArrow(part(id), offsets.get(id)!, partTypes));
  const install = installStep(step, layout, partTypes);
  for (const [id, offset] of install.offsets) offsets.set(id, add(offsets.get(id) ?? ZERO, offset));
  if (install.arrow) arrows.push(install.arrow);
  const items = step.shown.map((id): ExplodedItem => {
    const { type, position, rotation } = part(id);
    return { id, type, position: add(position, offsets.get(id) ?? ZERO), rotation };
  });
  return { items, leaders, offsets, arrows };
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

/**
 * A tool posed on a joint's fastener: the tool's tip connector (its first whose type has a
 * compatible hole) mates the fastener's drive connector (the compatible one farthest out of the
 * hole's mouth — a double-ended stud has one at each end, and the one in the hole is buried),
 * axes opposed, held off along the drive's axis by `BOOKLET.action.hold` of the fastener's
 * longest side so the fastener shows under it. Null when the tool has no tip or the fastener
 * no connector the tip mates.
 */
export function toolOn(joint: Joint, tool: string, layout: ExplodeLayout, partTypes: PartTypes): ExplodedItem | null {
  const { part, hole } = lookups(layout, partTypes);
  const fastener = part(joint.hardware);
  const tip = partTypes[tool].connectors.find((c) => c.type in COMPATIBLE);
  if (!tip) return null;
  const outward = hole(joint).axis;
  const drives = partTypes[fastener.type].connectors.filter((c) => c.type === COMPATIBLE[tip.type]).map((c) => connectorInWorld(c, fastener));
  const world = drives.sort((a, b) => dot(b.position, outward) - dot(a.position, outward))[0];
  if (!world) return null;
  const rotation = rotationBetween(tip.axis, scale(world.axis, -1));
  const held = add(world.position, scale(world.axis, Math.max(...partTypes[fastener.type].size) * BOOKLET.action.hold));
  return { id: `tool:${tool}`, type: tool, position: sub(held, rotateVector(rotation, tip.position)), rotation };
}

/** How far a box of `size` posed at `rotation` reaches from its centre along unit `direction`. */
export function extentAlong(size: Size, rotation: Quat, direction: Vec3): number {
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return axes.reduce((sum, axis, k) => sum + (Math.abs(dot(direction, rotateVector(rotation, axis))) * size[k]) / 2, 0);
}

/** An action inset: a joint with its fastener seated and the tool on it, and where the ring arrow goes. */
export interface Action {
  /** Index into `layout.joints` of the joint the tool works. */
  joint: number;
  /** The host and the fastener at their seated poses, then the tool on the fastener. */
  items: ExplodedItem[];
  /** The box the inset frames: the tool's held tip, `BOOKLET.action.focus` of the larger of the fastener's longest side and the tool's cross-section either way. */
  focus: { min: Vec3; max: Vec3 };
  /** The hole's world axis, out of its mouth: the inset turns it as a detail inset does. */
  axis: Vec3;
  /** The ring arrow's centre: the tool's held tip, round its shaft. */
  ring: Vec3;
}

/** The action view of one joint with `tool` held on its seated fastener; null when the tool does not mate it. */
export function actionAt(jointIndex: number, tool: string, layout: ExplodeLayout, partTypes: PartTypes): Action | null {
  const { part, hole } = lookups(layout, partTypes);
  const joint = layout.joints[jointIndex];
  const posed = toolOn(joint, tool, layout, partTypes);
  if (!posed) return null;
  const tip = partTypes[tool].connectors.find((c) => c.type in COMPATIBLE)!;
  const ring = connectorInWorld(tip, posed).position;
  const [host, fastener] = [part(joint.host), part(joint.hardware)];
  // Wide enough for the fastener and for the tool's own cross-section, so the ring clears the shaft.
  const [, across] = [...partTypes[tool].size].sort((x, y) => x - y);
  const reach = Math.max(...partTypes[fastener.type].size, across) * BOOKLET.action.focus;
  return {
    joint: jointIndex,
    items: [host, fastener].map(({ id, type, position, rotation }) => ({ id, type, position, rotation })).concat(posed),
    focus: { min: ring.map((v) => v - reach) as Vec3, max: ring.map((v) => v + reach) as Vec3 },
    axis: hole(joint).axis,
    ring,
  };
}

/**
 * The page's action inset: on its first turned joint when it turns any, otherwise on the
 * first detail inset's joint (in `step.hardware` order) the tool mates; null without a tool
 * or a drivable joint.
 */
export function actionFor(step: Pick<BuildStep, 'joints' | 'turns' | 'hardware' | 'tool'>, layout: ExplodeLayout, partTypes: PartTypes): Action | null {
  const { tool } = step;
  if (!tool) return null;
  if (step.turns.length) return actionAt(step.turns[0], tool, layout, partTypes);
  for (const { joint } of insetsFor(step, layout, partTypes)) {
    const action = actionAt(joint, tool, layout, partTypes);
    if (action) return action;
  }
  return null;
}

/** A cam-turn page's sequence panels: the action view of each joint it turns, in order, at most `BOOKLET.sequence.max`. */
export function panelsFor(step: Pick<BuildStep, 'turns' | 'tool'>, layout: ExplodeLayout, partTypes: PartTypes): Action[] {
  const { tool } = step;
  if (!tool) return [];
  const panels = step.turns.slice(0, BOOKLET.sequence.max).map((i) => actionAt(i, tool, layout, partTypes));
  return panels.filter((panel): panel is Action => panel !== null);
}
