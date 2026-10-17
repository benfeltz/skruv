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

export function createInsetModel() {
  let state: InsetState = 'hidden';
  let subject: InsetSubject | null = null;
  // The engaged joints' keys, first seen first: the last is the most recently engaged.
  let order: string[] = [];
  // Every subject the router reported last frame, by key.
  let known = new Map<string, InsetSubject>();
  // The keys a tap outside put away, while they last. Only these are put away: whatever is
  // newly offered or engaged afterwards shows, and a tap on one of them brings it back alone.
  const away = new Set<string>();

  // Keeps the keys still engaged in order and appends the newly engaged.
  function remember(engaged: ReadonlyMap<string, InsetSubject>) {
    order = [...order.filter((key) => engaged.has(key)), ...[...engaged.keys()].filter((key) => !order.includes(key))];
  }

  // The most recently engaged of the subjects not put away, or null.
  const latest = (engaged: ReadonlyMap<string, InsetSubject>) => {
    const key = order.findLast((k) => !away.has(k));
    return key === undefined ? null : (engaged.get(key) ?? null);
  };

  return {
    get state() {
      return state;
    },
    get subject() {
      return subject;
    },
    /**
     * One frame: what is on offer and what is engaged, in. A carried part's offer outranks
     * what is engaged; otherwise the most recently engaged shows. What was put away stays away
     * until it ends, and once all of it has the inset hides, so the next approach offers it again.
     */
    step({ offered, engaged }: InsetInput) {
      const engagedByKey = new Map(engaged.map((s) => [keyOf(s), s]));
      known = new Map(offered ? [[keyOf(offered), offered], ...engagedByKey] : engagedByKey);
      for (const key of away) if (!known.has(key)) away.delete(key);
      remember(engagedByKey);
      const next = latest(engagedByKey);
      if (offered && !away.has(keyOf(offered))) [state, subject] = ['offered', offered];
      else if (next) [state, subject] = ['active', next];
      else if (away.size > 0) [state, subject] = ['dismissed', known.get(order.findLast((k) => away.has(k)) ?? [...away][0]) ?? null];
      else [state, subject] = ['hidden', null];
    },
    /** A tap outside the circle: put away everything it shows or could. Returns whether that changed anything. */
    tapOutside() {
      if (state !== 'offered' && state !== 'active') return false;
      for (const key of known.keys()) away.add(key);
      state = 'dismissed';
      return true;
    },
    /** A tap on `part`: while dismissed, one on a part of a subject put away brings that subject back alone, and is consumed. */
    tapOn(part: PartId) {
      if (state !== 'dismissed') return false;
      const key = [...away].find((k) => {
        const s = known.get(k);
        return s !== undefined && (part === s.hardware || part === s.host || part === s.tool);
      });
      if (key === undefined) return false;
      away.delete(key);
      subject = known.get(key)!;
      state = subject.joint >= 0 ? 'active' : 'offered';
      return true;
    },
    reset() {
      state = 'hidden';
      subject = null;
      order = [];
      known = new Map();
      away.clear();
    },
  };
}

export type InsetModel = ReturnType<typeof createInsetModel>;
