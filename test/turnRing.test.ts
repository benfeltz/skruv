import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { TURN_RING } from '../src/constants.js';
import { createAssembly } from '../src/game/assembly.js';
import { arcLength, dialEngagements, dialHit, isStalled, tightensClockwise } from '../src/game/turnRing.js';
import { createFastener, STATE } from '../src/game/fasteners.js';

// The turn ring's maths (1.8.2.2 step 1): headless, plain points and joints.

describe('dialHit', () => {
  const centre: [number, number] = [200, 300];
  const at = (r: number): [number, number] => [centre[0] + r, centre[1]];

  it('takes the band either side of the ring, edges included', () => {
    expect(dialHit(at(TURN_RING.radius), centre)).toBe(true);
    expect(dialHit(at(TURN_RING.radius - TURN_RING.band), centre)).toBe(true);
    expect(dialHit(at(TURN_RING.radius + TURN_RING.band), centre)).toBe(true);
  });

  it('misses just inside and just outside the band', () => {
    expect(dialHit(at(TURN_RING.radius - TURN_RING.band - 1), centre)).toBe(false);
    expect(dialHit(at(TURN_RING.radius + TURN_RING.band + 1), centre)).toBe(false);
  });

  it('never takes the middle, where the head and the tool are', () => {
    expect(dialHit(centre, centre)).toBe(false);
  });

  it('is round: the same on any bearing', () => {
    const a = Math.PI / 3;
    expect(dialHit([centre[0] + TURN_RING.radius * Math.cos(a), centre[1] + TURN_RING.radius * Math.sin(a)], centre)).toBe(true);
  });
});

describe('arcLength', () => {
  const full = 2 * Math.PI * TURN_RING.radius;

  it('is empty at 0, half round at 0.5, the whole ring at 1', () => {
    expect(arcLength(0)).toBe(0);
    expect(arcLength(0.5)).toBeCloseTo(full / 2, 9);
    expect(arcLength(1)).toBeCloseTo(full, 9);
  });

  it('clamps outside 0..1', () => {
    expect(arcLength(-0.2)).toBe(0);
    expect(arcLength(1.4)).toBeCloseTo(full, 9);
  });
});

describe('tightensClockwise', () => {
  const down = [0, -1, 0];

  it('points clockwise seen from the head, anticlockwise from the far side', () => {
    expect(tightensClockwise(down, [0, -1, 0.2])).toBe(true);
    expect(tightensClockwise(down, [0, 1, 0.2])).toBe(false);
  });
});

describe('dialEngagements', () => {
  // A bolt and a cam lock seated in a panel, each with its tool on it.
  function bench() {
    const types: Record<string, string> = { panel: 'sidePanel', bolt: 'camLockBolt', key: 'allenWrench', shelf: 'topBottomPanel', cam: 'camLock', driver: 'screwdriver' };
    const assembly = createAssembly((id) => types[id]);
    const bolt = assembly.seat({ partA: 'bolt', connectorA: 0, partB: 'panel', connectorB: 2, mover: 'bolt' });
    const key = assembly.seat({ partA: 'key', connectorA: 0, partB: 'bolt', connectorB: 1, mover: 'key' });
    return { assembly, bolt, key };
  }

  it('gives a tool on a fastener not yet home a dial', () => {
    const { assembly, bolt, key } = bench();
    expect(key.kind).toBe(KIND.TOOL);
    expect(dialEngagements(assembly.all())).toEqual([{ tool: key, target: bolt }]);
  });

  it('keeps the dial of a tool on a fastener that is home, for as long as the tool is on', () => {
    const { assembly, bolt, key } = bench();
    assembly.drive(bolt.id);
    expect(dialEngagements(assembly.all())).toEqual([{ tool: key, target: assembly.get(bolt.id) }]);
    assembly.unseat(key.id);
    expect(dialEngagements(assembly.all())).toEqual([]);
  });

  it('gives none with no tool seated', () => {
    const types: Record<string, string> = { panel: 'sidePanel', bolt: 'camLockBolt' };
    const assembly = createAssembly((id) => types[id]);
    assembly.seat({ partA: 'bolt', connectorA: 0, partB: 'panel', connectorB: 2, mover: 'bolt' });
    expect(dialEngagements(assembly.all())).toEqual([]);
  });
});

describe('isStalled', () => {
  const cam = createFastener(KIND.CAM);

  it('marks a full turn that is not home', () => {
    expect(isStalled({ ...cam, progress: 1 })).toBe(true);
  });

  it('never marks a fastener that is home, or one partway', () => {
    expect(isStalled({ ...cam, progress: 1, state: STATE.LOCKED })).toBe(false);
    expect(isStalled({ ...cam, progress: 0.5 })).toBe(false);
  });
});

describe('src/game/turnRing.ts', () => {
  it('is pure: no Three, Rapier or DOM', () => {
    const source = readFileSync(new URL('../src/game/turnRing.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from 'three'|rapier|document\.|window\./);
  });
});
