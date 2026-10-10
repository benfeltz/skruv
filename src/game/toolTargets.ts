// Which tool connectors a fastener offers. Pure — joints and connector records in, sets and
// booleans out; geometry the graph doesn't hold (which bolt head a cam would catch) is
// injected by the caller.
//
//   seat target  a connector a tool may seat on at all: a bolt head or cam slot only once
//                its bolt or cam lock is seated in its hole — a tool on loose hardware is a
//                dead end (nothing turns)
//   workable     a seat target the tool can turn right now: an unscrewed seated bolt for
//                the Allen key; an unlocked seated cam lock with a screwed bolt in reach for
//                the screwdriver. Only these light up, which also teaches the build order.

import { CONNECTOR, KIND } from '../../tools/validate/lib/vocabulary.js';
import { isCrankKind, isFastened, STATE } from './fasteners.js';
import type { ConnectorType } from '../../tools/validate/lib/vocabulary.js';
import type { AssemblyJoint, PartId } from './assembly.js';

/** A tool's working end. */
export const TOOL_TIPS: readonly ConnectorType[] = Object.freeze([CONNECTOR.WRENCH_TIP, CONNECTOR.SCREWDRIVER_TIP]);

/** What a tool's tip seats on. */
export const TOOL_TARGETS: readonly ConnectorType[] = Object.freeze([CONNECTOR.BOLT_HEAD, CONNECTOR.CAM_SLOT]);

/** A connector as these rules read it: its type and the part it is on. */
export interface TargetConnector {
  type: ConnectorType;
  part: { id: PartId };
}

/** The bolt a cam lock would catch (`capture` over screwed bolt heads), or null. */
export type Captured = (cam: PartId) => PartId | null;

export const isToolTip = (type: ConnectorType) => TOOL_TIPS.includes(type);

export const isToolTarget = (type: ConnectorType) => TOOL_TARGETS.includes(type);

/** Hardware seated in its hole: the ids with a bolt or cam seat joint. */
export function seatedHardware(joints: Iterable<AssemblyJoint>) {
  const seated = new Set<PartId>();
  for (const j of joints) if (isCrankKind(j.kind)) seated.add(j.hardware);
  return seated;
}

/** Any connector but a tool target; a bolt head or cam slot only on seated hardware. */
export const isSeatTarget = (connector: TargetConnector, seated: ReadonlySet<PartId>) =>
  !isToolTarget(connector.type) || seated.has(connector.part.id);

/** A seat target the matching tool can turn right now — see the header. */
export function isWorkable(connector: TargetConnector, joints: Iterable<AssemblyJoint>, captured: Captured) {
  const seat = seatOf(connector, joints);
  if (!seat) return false;
  if (connector.type === CONNECTOR.BOLT_HEAD) return !isFastened(seat.fastener);
  return seat.fastener.state !== STATE.LOCKED && captured(seat.hardware) !== null;
}

// The bolt or cam seat joint a target connector's part sits in, or null (loose, or not a target).
function seatOf({ type, part }: TargetConnector, joints: Iterable<AssemblyJoint>) {
  const kind = type === CONNECTOR.BOLT_HEAD ? KIND.BOLT : type === CONNECTOR.CAM_SLOT ? KIND.CAM : null;
  if (!kind) return null;
  for (const j of joints) if (j.hardware === part.id && j.kind === kind) return j;
  return null;
}
