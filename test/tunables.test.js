import { afterEach, describe, expect, it, vi } from 'vitest';
import { FASTENER, SNAP } from '../src/constants.js';
import { createTunables, LIVE_KNOBS, PROFILE_FORMAT } from '../src/game/tunables.js';

const fake = () => {
  const object = { a: 1, b: 10 };
  const knobs = {
    'g.a': { object, prop: 'a', min: 0, max: 2, step: 0.1, unit: 'm', group: 'g', desc: 'a' },
    'g.b': { object, prop: 'b', min: 5, max: 20, step: 1, unit: '', group: 'g', desc: 'b' },
  };
  return { object, tunables: createTunables(knobs) };
};

describe('LIVE_KNOBS', () => {
  it.each(Object.entries(LIVE_KNOBS))('%s is a group.name key over a real constant inside its own range', (key, knob) => {
    expect(key).toMatch(/^[a-z]+\.[a-z][A-Za-z]*$/);
    expect(key.split('.')[0]).toBe(knob.group);
    expect(typeof knob.object[knob.prop]).toBe('number');
    expect(knob.min).toBeLessThan(knob.max);
    expect(knob.step).toBeGreaterThan(0);
    expect(knob.object[knob.prop]).toBeGreaterThanOrEqual(knob.min);
    expect(knob.object[knob.prop]).toBeLessThanOrEqual(knob.max);
    expect(knob.desc.length).toBeGreaterThan(0);
    expect(typeof knob.unit).toBe('string');
  });

  // Shared contract (1.0.0 R6): the Godot build uses these names verbatim. A rename here is
  // a profile format bump, never a quiet edit.
  it('publishes exactly the contract key set', () => {
    expect(Object.keys(LIVE_KNOBS)).toEqual([
      'snap.maxDistance',
      'snap.maxAngle',
      'snap.assistStrength',
      'gesture.hoverLift',
      'gesture.liftRate',
      'gesture.detentStep',
      'joint.angularPlay',
      'joint.playDamping',
      'physics.linearDamping',
      'physics.angularDamping',
      'physics.friction',
      'render.maxPixelRatio',
      'render.fpsFloor',
      'render.fpsWindow',
      'haptics.seatMs',
      'haptics.lockMs',
    ]);
  });
});

describe('createTunables over the real constants', () => {
  const tunables = createTunables();
  afterEach(() => tunables.reset());

  it('writes through to the shared constants object, read back from it', () => {
    tunables.set('joint.angularPlay', 7.5);
    expect(FASTENER.angularPlayDegrees).toBe(7.5);
    tunables.set('snap.maxDistance', 0.05);
    expect(SNAP.maxDistance).toBe(0.05);
  });

  it('reset puts the constants back as they were', () => {
    const before = SNAP.maxDistance;
    tunables.set('snap.maxDistance', 0.15);
    tunables.reset();
    expect(SNAP.maxDistance).toBe(before);
  });
});

describe('createTunables', () => {
  it('clamps every set into the schema range and returns what it applied', () => {
    const { object, tunables } = fake();
    expect(tunables.set('g.a', 99)).toBe(2);
    expect(object.a).toBe(2);
    expect(tunables.set('g.b', -3)).toBe(5);
    expect(object.b).toBe(5);
  });

  it('refuses unknown keys and non-numbers, leaving everything as it was', () => {
    const { object, tunables } = fake();
    expect(() => tunables.set('g.zzz', 1)).toThrow(/unknown knob/);
    expect(() => tunables.get('g.zzz')).toThrow(/unknown knob/);
    expect(() => tunables.set('g.a', NaN)).toThrow(/number/);
    expect(() => tunables.set('g.a', '1')).toThrow(/number/);
    expect(object).toEqual({ a: 1, b: 10 });
  });

  it('tells subscribers what changed — once per change, never for a no-op', () => {
    const { tunables } = fake();
    const heard = vi.fn();
    const stop = tunables.subscribe(heard);
    tunables.set('g.a', 1.5);
    tunables.set('g.a', 1.5);
    stop();
    tunables.set('g.a', 0.5);
    expect(heard.mock.calls).toEqual([['g.a', 1.5]]);
  });

  it('lists every knob with its value, default and schema', () => {
    const { tunables } = fake();
    tunables.set('g.a', 0.3);
    expect(tunables.list()[0]).toEqual({ key: 'g.a', value: 0.3, default: 1, min: 0, max: 2, step: 0.1, unit: 'm', group: 'g', desc: 'a' });
  });

  it('resets one knob or all of them to the defaults it was made with', () => {
    const { object, tunables } = fake();
    tunables.set('g.a', 0.2);
    tunables.set('g.b', 15);
    tunables.reset('g.a');
    expect(object).toEqual({ a: 1, b: 15 });
    tunables.reset();
    expect(object).toEqual({ a: 1, b: 10 });
  });

  it('round-trips a profile through JSON', () => {
    const { object, tunables } = fake();
    tunables.set('g.a', 0.4);
    tunables.set('g.b', 12);
    const saved = JSON.parse(JSON.stringify(tunables.toProfile()));
    expect(saved).toEqual({ format: PROFILE_FORMAT, knobs: { 'g.a': 0.4, 'g.b': 12 } });
    tunables.reset();
    expect(tunables.applyProfile(saved)).toEqual({ skipped: [] });
    expect(object).toEqual({ a: 0.4, b: 12 });
  });

  it("skips keys it doesn't have (another engine's) and clamps the rest", () => {
    const { object, tunables } = fake();
    const result = tunables.applyProfile({ format: PROFILE_FORMAT, knobs: { 'g.a': 50, 'godot.only': 3 } });
    expect(result).toEqual({ skipped: ['godot.only'] });
    expect(object.a).toBe(2);
  });

  it('applies a profile all or nothing, and refuses one of another format', () => {
    const { object, tunables } = fake();
    expect(() => tunables.applyProfile({ format: PROFILE_FORMAT, knobs: { 'g.a': 0.5, 'g.b': 'soft' } })).toThrow(/number/);
    expect(object).toEqual({ a: 1, b: 10 });
    expect(() => tunables.applyProfile({ format: 999, knobs: {} })).toThrow(/format/);
    expect(() => tunables.applyProfile(null)).toThrow(/format/);
  });
});
