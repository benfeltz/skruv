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
import { KIND } from '../../tools/validate/lib/vocabulary.js';
import type { FastenerKind } from '../../tools/validate/lib/vocabulary.js';

export const STATE = Object.freeze({
  SEATED: 'seated',
  PRESSED: 'pressed',
  SCREWED: 'screwed',
  LOCKED: 'locked',
});

export type FastenerState = (typeof STATE)[keyof typeof STATE];

/** One seated pair's machine: its kind, where it stands, and how far home (0..1). */
export interface Fastener {
  kind: FastenerKind;
  state: FastenerState;
  progress: number;
}

/** What a machine is fed: a tap, a pull, or signed crank radians (positive tightens). */
export type FastenerEvent = { type: 'tap' } | { type: 'pull' } | { type: 'crank'; radians: number };

/** What the graph knows about a pair — see `transition`. */
export interface FastenerContext {
  captured?: boolean;
  held?: boolean;
}

interface TurnLimits {
  canFasten: boolean;
  canLoosen: boolean;
}

/** Kinds pushed home by a tap and pulled back out along their axis. */
export const isTapKind = (kind: FastenerKind) => kind === KIND.DOWEL || kind === KIND.PIN || kind === KIND.FITTING;

/** Kinds turned by a tool. */
export const isCrankKind = (kind: FastenerKind) => kind === KIND.BOLT || kind === KIND.CAM;

export const createFastener = (kind: FastenerKind): Fastener => ({ kind, state: STATE.SEATED, progress: 0 });

/** Past seated: the joint holds and physics should bond it. */
export const isFastened = (f: Fastener) => f.state !== STATE.SEATED;

/** Fastened, or partway in (a half-turned bolt grips its threads): the part is stuck. */
export const isEngaged = (f: Fastener) => isFastened(f) || f.progress > 0;

/** A part pulls free only when every fastener on it is back to plain seated. */
export const canRelease = (fasteners: Fastener[]) => fasteners.every((f) => !isEngaged(f));

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function tapPull(f: Fastener, type: FastenerEvent['type']): Fastener {
  if (type === 'tap' && f.state === STATE.SEATED) return { ...f, state: STATE.PRESSED, progress: 1 };
  if (type === 'pull' && f.state === STATE.PRESSED) return { ...f, state: STATE.SEATED, progress: 0 };
  return f;
}

// Turned fasteners hysterese: one fastens on reaching 1 and lets go only back at 0, so a
// jiggle at the end of a turn never flips it.
function turned(f: Fastener, radians: number, span: number, { canFasten, canLoosen }: TurnLimits, fastenedState: FastenerState): Fastener {
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
export function transition(f: Fastener, event: FastenerEvent, ctx: FastenerContext = {}): Fastener {
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
