// The detail inset's state: whether it shows, and the joint it frames. Pure — the router
// reports each frame what is offered and what is engaged, taps arrive as calls, and the
// panel (src/scene/insetPanel.ts) draws whatever this says.
//
//   hidden     nothing to show
//   offered    carried hardware is inside the aim zone of a workable seat: faint, framing that seat
//   active     parts engaged (a tool on a head, a dowel or fitting seated, not yet pressed home)
//   dismissed  put away by a tap outside; a tap on an engaged part brings it back

import type { PartId } from './assembly.js';
import type { FastenerKind } from '../../tools/validate/lib/vocabulary.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';

export type InsetState = 'hidden' | 'offered' | 'active' | 'dismissed';

/**
 * The joint the inset frames, as the router resolved it this frame: `centre` and `axis` of
 * the host's hole in the world. An offered seat (nothing seated yet) has `joint` -1 and
 * `hardware` the carried part.
 */
export interface InsetSubject {
  joint: number;
  kind: FastenerKind;
  hardware: PartId;
  host: PartId;
  tool: PartId | null;
  centre: Vec3;
  axis: Vec3;
}

/** What the router reports each frame. */
export interface InsetInput {
  /** The carried hardware's nearest workable seat inside the aim zone, or null. */
  offered: InsetSubject | null;
  /** Every seated tool turn's joint and every seated, not-yet-pressed tap-kind joint. */
  engaged: readonly InsetSubject[];
}

const keyOf = (s: InsetSubject) => (s.joint >= 0 ? `joint:${s.joint}` : `seat:${s.hardware}>${s.host}`);

// The next state, given what is on offer, what is engaged and whether the dismissed subject is still there.
// A carried part's offer outranks what is engaged; a dismissed inset stays put while its subject does.
function decide(state: InsetState, offered: boolean, engaged: boolean, dismissedHolds: boolean): InsetState {
  if (state === 'dismissed' && dismissedHolds) return 'dismissed';
  if (offered) return 'offered';
  if (engaged) return 'active';
  return 'hidden';
}

export function createInsetModel() {
  let state: InsetState = 'hidden';
  let subject: InsetSubject | null = null;
  // The engaged joints' keys, first seen first: the last is the most recently engaged.
  let order: string[] = [];

  // Keeps the keys still engaged in order and appends the newly engaged; returns the latest subject.
  function recency(engaged: readonly InsetSubject[]) {
    const byKey = new Map(engaged.map((s) => [keyOf(s), s]));
    order = [...order.filter((key) => byKey.has(key)), ...[...byKey.keys()].filter((key) => !order.includes(key))];
    return { byKey, latest: byKey.get(order[order.length - 1]) ?? null };
  }

  return {
    get state() {
      return state;
    },
    get subject() {
      return subject;
    },
    /** One frame: what is on offer and what is engaged, in. */
    step({ offered, engaged }: InsetInput) {
      const { byKey, latest } = recency(engaged);
      const held = state === 'dismissed' && subject ? (byKey.get(keyOf(subject)) ?? (offered && keyOf(offered) === keyOf(subject) ? offered : null)) : null;
      state = decide(state, offered !== null, latest !== null, held !== null);
      subject = state === 'dismissed' ? held : state === 'offered' ? offered : state === 'active' ? latest : null;
    },
    /** A tap outside the circle: put it away. Returns whether that changed anything. */
    tapOutside() {
      if (state !== 'offered' && state !== 'active') return false;
      state = 'dismissed';
      return true;
    },
    /** A tap on `part`: while dismissed, one on the subject's hardware, host or tool brings it back and is consumed. */
    tapOn(part: PartId) {
      if (state !== 'dismissed' || !subject) return false;
      if (part !== subject.hardware && part !== subject.host && part !== subject.tool) return false;
      state = 'active';
      return true;
    },
    reset() {
      state = 'hidden';
      subject = null;
      order = [];
    },
  };
}

export type InsetModel = ReturnType<typeof createInsetModel>;
