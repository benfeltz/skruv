// Fastener state machines — one per seated connector pair, every one bidirectional:
// disassembly is the same interaction reversed (pull the dowel, back the bolt out, turn the
// cam open), never an abstract undo. Pure: plain records in, new records out — an event a
// machine ignores returns the very same record, so callers detect change by identity.
//
//   dowel, pin,  seated ⇄ pressed          tap / pull
//   back fitting
//   bolt         seated ⇄ screwed          signed crank progress (wrench)
//   cam          seated ⇄ locked           signed quarter turn (screwdriver), lock needs a
//                                          captured bolt head
//   tool         always seated             a tool on a head or slot fastens nothing
//
// Correctness never enters here: any type-compatible seated pair fastens.

import { FASTENER } from '../constants.js';
import { CONNECTOR } from './catalog.js';

export const KIND = Object.freeze({
  DOWEL: 'dowel',
  PIN: 'pin',
  // A push-pin back fitting: pressed through the back panel into whatever lies behind.
  FITTING: 'fitting',
  BOLT: 'bolt',
  CAM: 'cam',
  TOOL: 'tool',
});

export const STATE = Object.freeze({
  SEATED: 'seated',
  PRESSED: 'pressed',
  SCREWED: 'screwed',
  LOCKED: 'locked',
});

// Keyed by the fastener-end side of a pair (snapMath's COMPATIBLE keys).
const KIND_FOR_END = Object.freeze({
  [CONNECTOR.DOWEL_END]: KIND.DOWEL,
  [CONNECTOR.PIN_TIP]: KIND.PIN,
  [CONNECTOR.BACK_FITTING_TIP]: KIND.FITTING,
  [CONNECTOR.BOLT_THREAD]: KIND.BOLT,
  [CONNECTOR.CAM_LOCK_BODY]: KIND.CAM,
  [CONNECTOR.WRENCH_TIP]: KIND.TOOL,
  [CONNECTOR.SCREWDRIVER_TIP]: KIND.TOOL,
});

/** The fastener kind for a pair whose fastener end has connector type `endType`, or null. */
export const kindOf = (endType) => KIND_FOR_END[endType] ?? null;

/** Kinds pushed home by a tap and pulled back out along their axis. */
export const isTapKind = (kind) => kind === KIND.DOWEL || kind === KIND.PIN || kind === KIND.FITTING;

/** Kinds turned by a tool. */
export const isCrankKind = (kind) => kind === KIND.BOLT || kind === KIND.CAM;

export const createFastener = (kind) => ({ kind, state: STATE.SEATED, progress: 0 });

/** Past seated: the joint holds and physics should bond it. */
export const isFastened = (f) => f.state !== STATE.SEATED;

/** Fastened, or partway in (a half-turned bolt grips its threads): the part is stuck. */
export const isEngaged = (f) => isFastened(f) || f.progress > 0;

/** A part pulls free only when every fastener on it is back to plain seated. */
export const canRelease = (fasteners) => fasteners.every((f) => !isEngaged(f));

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function tapPull(f, type) {
  if (type === 'tap' && f.state === STATE.SEATED) return { ...f, state: STATE.PRESSED, progress: 1 };
  if (type === 'pull' && f.state === STATE.PRESSED) return { ...f, state: STATE.SEATED, progress: 0 };
  return f;
}

// Turned fasteners hysterese: one fastens on reaching 1 and lets go only back at 0, so a
// jiggle at the end of a turn never flips it.
function turned(f, radians, span, { canFasten, canLoosen }, fastenedState) {
  if (radians < 0 && !canLoosen) return f;
  const progress = clamp01(f.progress + radians / span);
  let { state } = f;
  // A turn pressed on at the end stop still fastens — a cam turned onto a bolt that only
  // now came within reach catches it.
  if (state === STATE.SEATED && progress === 1 && radians > 0 && canFasten) state = fastenedState;
  else if (state === fastenedState && progress === 0) state = STATE.SEATED;
  return progress === f.progress && state === f.state ? f : { ...f, state, progress };
}

/**
 * Next record for `event`: `{ type: 'tap' }`, `{ type: 'pull' }` or
 * `{ type: 'crank', radians }` (positive tightens). `ctx` carries what the graph knows:
 *   captured — a cam's recess has a screwed bolt head within reach (lock needs it)
 *   held     — a bolt's head is caught by a locked cam (it cannot back out)
 */
export function transition(f, event, ctx = {}) {
  switch (f.kind) {
    case KIND.DOWEL:
    case KIND.PIN:
    case KIND.FITTING:
      return tapPull(f, event.type);
    case KIND.BOLT:
      if (event.type !== 'crank') return f;
      return turned(f, event.radians, FASTENER.screwRadians, { canFasten: true, canLoosen: !ctx.held }, STATE.SCREWED);
    case KIND.CAM:
      if (event.type !== 'crank') return f;
      return turned(f, event.radians, FASTENER.quarterTurn, { canFasten: !!ctx.captured, canLoosen: true }, STATE.LOCKED);
    default:
      return f;
  }
}
