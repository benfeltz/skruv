// Live tuning: a curated set of feel knobs over the constants in src/constants.ts. Every
// module reads those constants objects' properties at use time, so a knob set here writes
// straight through to the shared object and the game feels it on its next read — no
// module reads through this registry. Values baked into live engine objects when they are
// made (damping and friction on bodies, play on joints, the renderer's pixel ratio) need
// an applier: the engine side subscribes and re-applies (src/physics/world.js `retune`).
// Pure: imports constants only.
//
// Knob keys are a shared contract (1.0.0 R6): the Godot build exposes the same names, so a
// feel profile saved here loads there and back. Keys are `group.name`, engine-neutral —
// never a JS object path — and units are the schema's, in the engine's own units; a key
// once published is renamed only with a profile format bump.

import { CAMERA, FASTENER, GESTURE, HAPTICS, PHYSICS, RENDER, SNAP, TUNE } from '../constants.js';

/** Bumped whenever a key is renamed or its unit changes, so old profiles stay readable. */
export const PROFILE_FORMAT = 1;

const DEGREE = Math.PI / 180;

/** One knob: the constants object and numeric property it writes through to, and how it is presented. */
export interface Knob {
  object: Record<string, unknown>;
  prop: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  group: string;
  desc: string;
}

/** `fn(key, value)`, told after every change. */
export type KnobSubscriber = (key: string, value: number) => void;

/** A saved feel profile: `{ format, knobs: { key: value } }`. */
export interface FeelProfile {
  format: number;
  knobs: Record<string, number>;
}

/**
 * key → `{ object, prop, min, max, step, unit, group, desc }`: the constants object and
 * property it writes through to, its range (every set is clamped into it), the slider
 * step, and how it is presented.
 */
export const LIVE_KNOBS: Readonly<Record<string, Knob>> = Object.freeze({
  'snap.maxDistance': {
    object: SNAP, prop: 'maxDistance', min: 0.01, max: 0.2, step: 0.005, unit: 'm', group: 'snap',
    desc: 'How near a connector must come to a free hole before a seat is offered',
  },
  'snap.maxAngle': {
    object: SNAP, prop: 'maxAngle', min: 5 * DEGREE, max: 90 * DEGREE, step: DEGREE, unit: 'rad', group: 'snap',
    desc: 'How far off-axis a seat is still offered',
  },
  'snap.assistStrength': {
    object: SNAP, prop: 'assistStrength', min: 0, max: 30, step: 0.5, unit: '1/s', group: 'snap',
    desc: 'How fast a held part eases into the seat on offer (0: no pull)',
  },
  'gesture.hoverLift': {
    object: GESTURE, prop: 'hoverLift', min: 0, max: 0.15, step: 0.005, unit: 'm', group: 'gesture',
    desc: 'How high a grabbed part rides above where it was picked up',
  },
  'gesture.liftRate': {
    object: GESTURE, prop: 'liftRate', min: 0.001, max: 0.012, step: 0.0005, unit: 'm/px', group: 'gesture',
    desc: 'Second-finger lift per CSS px of travel',
  },
  'gesture.detentStep': {
    object: GESTURE, prop: 'detentStep', min: 15 * DEGREE, max: 90 * DEGREE, step: 15 * DEGREE, unit: 'rad', group: 'gesture',
    desc: 'Rotate-gizmo detent',
  },
  'joint.angularPlay': {
    object: FASTENER, prop: 'angularPlayDegrees', min: 0, max: 15, step: 0.5, unit: 'deg', group: 'joint',
    desc: 'Angular play a dowel-stage joint slumps through before it stops',
  },
  'joint.playDamping': {
    object: FASTENER, prop: 'playDamping', min: 0, max: 5000, step: 50, unit: 'N·m·s/rad', group: 'joint',
    desc: 'Resistance to the slump: a sag, not a drop',
  },
  'physics.linearDamping': {
    object: PHYSICS, prop: 'linearDamping', min: 0, max: 2, step: 0.05, unit: '1/s', group: 'physics',
    desc: 'Bleeds off sliding so parts come to rest',
  },
  'physics.angularDamping': {
    object: PHYSICS, prop: 'angularDamping', min: 0, max: 2, step: 0.05, unit: '1/s', group: 'physics',
    desc: 'Bleeds off spin so parts come to rest',
  },
  'physics.friction': {
    object: PHYSICS, prop: 'friction', min: 0, max: 1.5, step: 0.05, unit: '', group: 'physics',
    desc: 'Grip between every part, the floor and the walls',
  },
  'render.maxPixelRatio': {
    object: RENDER, prop: 'maxPixelRatio', min: 0.5, max: 3, step: 0.25, unit: 'x', group: 'render',
    desc: 'Device pixel ratio cap: sharpness against fill rate',
  },
  'render.fpsFloor': {
    object: TUNE, prop: 'fpsFloor', min: 0, max: 120, step: 1, unit: 'fps', group: 'render',
    desc: 'Below this for render.fpsWindow, render every other frame (0: never)',
  },
  'render.fpsWindow': {
    object: TUNE, prop: 'fpsWindow', min: 0.5, max: 10, step: 0.5, unit: 's', group: 'render',
    desc: 'How long a frame rate must hold before the fallback engages or lets go',
  },
  'haptics.seatMs': {
    object: HAPTICS, prop: 'seatMs', min: 0, max: 50, step: 1, unit: 'ms', group: 'haptics',
    desc: 'Vibration when a part seats (Android; 0: off)',
  },
  'haptics.lockMs': {
    object: HAPTICS, prop: 'lockMs', min: 0, max: 80, step: 1, unit: 'ms', group: 'haptics',
    desc: 'Each tick of the double vibration when a cam lock locks (Android; 0: off)',
  },
  'camera.mobileStartScale': {
    object: CAMERA, prop: 'mobileStartScale', min: 1, max: 1.75, step: 0.05, unit: 'x', group: 'camera',
    desc: 'How much further out a phone starts than the desktop view (re-frames on change)',
  },
});

/**
 * A registry over `knobs` (LIVE_KNOBS by default). Defaults are the values the constants
 * hold when it is made.
 *   list()               `[{ key, value, default, min, max, step, unit, group, desc }]`
 *   get(key)             current value
 *   set(key, value)      clamps into range, writes through, tells subscribers; returns the
 *                        value applied. Unknown keys and non-numbers throw.
 *   reset(key?)          one knob, or every knob, back to its default
 *   subscribe(fn)        `fn(key, value)` after every change; returns the unsubscribe
 *   toProfile()          `{ format, knobs: { key: value } }` — every knob
 *   applyProfile(p)      sets each knob it names (all or nothing: a non-number anywhere
 *                        throws before any is set); keys this build doesn't have
 *                        (another engine's, a newer build's) are skipped and returned
 */
export function createTunables(knobs: Readonly<Record<string, Knob>> = LIVE_KNOBS) {
  // Every knob's property holds a number.
  const defaults = new Map(Object.entries(knobs).map(([key, { object, prop }]) => [key, object[prop] as number]));
  const subscribers = new Set<KnobSubscriber>();

  function knob(key: string) {
    if (!Object.hasOwn(knobs, key)) throw new Error(`unknown knob: ${key}`);
    return knobs[key];
  }

  const get = (key: string) => {
    const { object, prop } = knob(key);
    return object[prop] as number;
  };

  function set(key: string, value: unknown) {
    const { object, prop, min, max } = knob(key);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`knob ${key} takes a number, got ${value}`);
    const applied = Math.min(max, Math.max(min, value));
    if (object[prop] === applied) return applied;
    object[prop] = applied;
    for (const fn of [...subscribers]) fn(key, applied);
    return applied;
  }

  function reset(key?: string) {
    for (const k of key === undefined ? [...defaults.keys()] : [key]) set(k, defaults.get(k));
  }

  function subscribe(fn: KnobSubscriber) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  const list = () =>
    Object.entries(knobs).map(([key, { min, max, step, unit, group, desc }]) => ({
      key,
      value: get(key),
      default: defaults.get(key),
      min,
      max,
      step,
      unit,
      group,
      desc,
    }));

  const toProfile = (): FeelProfile => ({ format: PROFILE_FORMAT, knobs: Object.fromEntries(Object.keys(knobs).map((key) => [key, get(key)])) });

  function applyProfile(profile: { format?: unknown; knobs?: unknown } | null | undefined) {
    if (profile?.format !== PROFILE_FORMAT || typeof profile.knobs !== 'object' || profile.knobs === null) {
      throw new Error(`not a format ${PROFILE_FORMAT} feel profile`);
    }
    const entries = Object.entries(profile.knobs);
    const known = entries.filter(([key]) => Object.hasOwn(knobs, key));
    // All or nothing: a bad value anywhere leaves every knob as it was.
    const bad = known.find(([, value]) => typeof value !== 'number' || !Number.isFinite(value));
    if (bad) throw new Error(`knob ${bad[0]} takes a number, got ${bad[1]}`);
    for (const [key, value] of known) set(key, value);
    return { skipped: entries.filter(([key]) => !Object.hasOwn(knobs, key)).map(([key]) => key) };
  }

  return { list, get, set, reset, subscribe, toProfile, applyProfile };
}
