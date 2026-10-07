import { describe, expect, it } from 'vitest';
import { PICK } from '../src/constants.js';
import { PART_TYPES } from '../src/game/item.js';
import { isSmallPart, preferHit, rayBoxGap, rayBoxReach } from '../src/game/pickMath.js';

const panel = { id: 'sidePanel-1' };
const dowel = { id: 'dowel-1' };
const pin = { id: 'shelfPin-1' };

// At 1 m the finger covers PICK.fingerRadius metres either side of the ray.
const panelHit = { part: panel, point: [0, 0, 0], distance: 1 };
const proxy = (part, distance, miss) => ({ part, point: [0, 0, 0], distance, miss });

describe('preferHit', () => {
  it('picks the small part when the finger is over it, though the panel hit is behind', () => {
    const near = proxy(dowel, 0.98, PICK.fingerRadius * 0.98 * 0.5);
    expect(preferHit(panelHit, [near], PICK)).toBe(near);
  });

  it('keeps the panel when the finger is beside the hardware, not over it', () => {
    // Grabbing the panel ~10 cm from a dowel: the ray grazes its proxy but misses the dowel.
    const grazed = proxy(dowel, 0.98, 0.1);
    expect(preferHit(panelHit, [grazed], PICK)).toBe(panelHit);
    // Just outside the finger's reach still leaves the panel.
    const edge = proxy(dowel, 0.98, PICK.fingerRadius * 0.98 * 1.01);
    expect(preferHit(panelHit, [edge], PICK)).toBe(panelHit);
  });

  it('scales the finger with distance: the same miss is a hit far away, a miss up close', () => {
    const miss = PICK.fingerRadius * 1.6; // metres: within reach at 2 m, not at 0.5 m
    const far = { ...panelHit, distance: 3 };
    expect(preferHit(far, [proxy(dowel, 2, miss)], PICK).part).toBe(dowel);
    expect(preferHit(far, [proxy(dowel, 0.5, miss)], PICK)).toBe(far);
  });

  it('never picks hardware hidden behind the panel in front of it', () => {
    const behind = proxy(dowel, 1.2, 0);
    expect(preferHit(panelHit, [behind], PICK)).toBe(panelHit);
  });

  it('picks the part the finger is squarely on, not a grazed neighbour whose proxy is nearer', () => {
    const touched = proxy(dowel, 0.9, 0);
    const grazed = proxy(pin, 0.85, 0.004);
    expect(preferHit(panelHit, [touched, grazed], PICK)).toBe(touched);
    expect(preferHit(panelHit, [grazed, touched], PICK)).toBe(touched);
  });

  it('picks the nearer of two parts the ray goes straight through', () => {
    const front = { ...proxy(dowel, 0.86, 0), depth: 0.88 };
    const back = { ...proxy(pin, 0.84, 0), depth: 0.9 };
    expect(preferHit(panelHit, [back, front], PICK)).toBe(front);
  });

  it('keeps a direct hit on the small part itself as the real hit', () => {
    const direct = { part: dowel, point: [0, 0.01, 0], distance: 0.99 };
    expect(preferHit(direct, [proxy(dowel, 0.97, 0)], PICK)).toBe(direct);
  });

  it('takes the nearest proxy when nothing real is under the finger', () => {
    const a = proxy(dowel, 0.9, 0.5);
    const b = proxy(pin, 0.95, 0.5);
    expect(preferHit(null, [b, a], PICK)).toBe(a);
  });

  it('passes the real hit (or nothing) through when no proxy is hit', () => {
    expect(preferHit(panelHit, [], PICK)).toBe(panelHit);
    expect(preferHit(null, [], PICK)).toBeNull();
  });
});

describe('rayBoxGap', () => {
  const half = [0.004, 0.015, 0.004];

  it('is zero for a ray through the box', () => {
    expect(rayBoxGap([0, 0, -1], [0, 0, 1], half)).toBeCloseTo(0, 6);
  });

  it('measures how far a ray passes beside the box', () => {
    expect(rayBoxGap([0.024, 0, -1], [0, 0, 1], half)).toBeCloseTo(0.02, 6);
    // Past the end of a long box, the gap is to its end face.
    expect(rayBoxGap([0, 0.035, -1], [0, 0, 1], half)).toBeCloseTo(0.02, 6);
  });

  it('only looks forward along the ray', () => {
    expect(rayBoxGap([0, 0, 1], [0, 0, 1], half)).toBeCloseTo(1 - half[2], 6);
  });
});

describe('PICK sizing', () => {
  const longest = (type) => Math.max(...PART_TYPES[type].size);

  it('counts every fastener and tool as small, and no panel', () => {
    for (const type of ['dowel', 'camLockBolt', 'camLock', 'shelfPin', 'backFitting', 'allenWrench', 'screwdriver']) {
      expect(longest(type)).toBeLessThan(PICK.smallPartMax);
    }
    for (const type of ['sidePanel', 'topBottomPanel', 'fixedShelf', 'adjustableShelf', 'plinth', 'backPanel']) {
      expect(longest(type)).toBeGreaterThanOrEqual(PICK.smallPartMax);
    }
  });

  it('is the same cut-off the router and the sprue use', () => {
    for (const [type, { size }] of Object.entries(PART_TYPES)) {
      expect(isSmallPart(size, PICK)).toBe(longest(type) < PICK.smallPartMax);
    }
  });

  it('makes a proxy at least as fat as the finger is wide at arm’s length', () => {
    expect(PICK.proxyMinSize / 2).toBeGreaterThanOrEqual(PICK.fingerRadius * 0.5);
  });
});

describe('hidden hardware (1.4.1 review)', () => {
  it('never picks a fastener sunk in the panel, though its fat proxy pokes out in front', () => {
    // Proxy entered 4 mm before the panel face, but the dowel itself is 8 mm behind it.
    const sunk = { part: dowel, point: [0, 0, 0], distance: 0.996, miss: 0, depth: 1.008 };
    expect(preferHit(panelHit, [sunk], PICK)).toBe(panelHit);
  });

  it('still picks one standing proud of the panel', () => {
    const proud = { part: dowel, point: [0, 0, 0], distance: 0.97, miss: 0, depth: 0.985 };
    expect(preferHit(panelHit, [proud], PICK)).toBe(proud);
  });
});

describe('rayBoxReach', () => {
  const half = [0.004, 0.015, 0.004];

  it('reports where a ray through the box enters it', () => {
    const { miss, depth } = rayBoxReach([0, 0, -1], [0, 0, 1], half);
    expect(miss).toBe(0);
    expect(depth).toBeCloseTo(1 - half[2], 9);
  });

  it('reports the miss and where a passing ray comes closest', () => {
    const { miss, depth } = rayBoxReach([0.024, 0, -1], [0, 0, 1], half);
    expect(miss).toBeCloseTo(0.02, 6);
    expect(depth).toBeGreaterThan(1 - half[2] - 1e-6);
    expect(depth).toBeLessThan(1 + half[2] + 1e-6);
  });
});
