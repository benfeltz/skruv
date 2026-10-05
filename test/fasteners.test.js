import { describe, expect, it } from 'vitest';
import { FASTENER } from '../src/constants.js';
import { CONNECTOR } from '../src/game/catalog.js';
import { COMPATIBLE } from '../src/game/snapMath.js';
import {
  canRelease,
  createFastener,
  isEngaged,
  isFastened,
  KIND,
  kindOf,
  STATE,
  transition,
} from '../src/game/fasteners.js';

const TAP = { type: 'tap' };
const PULL = { type: 'pull' };
const crank = (radians) => ({ type: 'crank', radians });
const run = (f, events, ctx) => events.reduce((acc, e) => transition(acc, e, ctx), f);

describe('kindOf', () => {
  it('names a kind for every fastener end in the compatibility table', () => {
    for (const end of Object.keys(COMPATIBLE)) expect(kindOf(end)).not.toBeNull();
  });

  it('calls both tool tips tools, and holes nothing', () => {
    expect(kindOf(CONNECTOR.WRENCH_TIP)).toBe(KIND.TOOL);
    expect(kindOf(CONNECTOR.SCREWDRIVER_TIP)).toBe(KIND.TOOL);
    expect(kindOf(CONNECTOR.DOWEL_HOLE)).toBeNull();
  });
});

describe.each([KIND.DOWEL, KIND.PIN])('%s: seated ⇄ pressed', (kind) => {
  it('presses on a tap and comes back out on a pull', () => {
    const pressed = transition(createFastener(kind), TAP);
    expect(pressed.state).toBe(STATE.PRESSED);
    expect(isFastened(pressed)).toBe(true);
    const pulled = transition(pressed, PULL);
    expect(pulled).toEqual(createFastener(kind));
  });

  it('ignores a second tap, a pull while seated, and any crank (same record back)', () => {
    const seated = createFastener(kind);
    expect(transition(seated, PULL)).toBe(seated);
    expect(transition(seated, crank(10))).toBe(seated);
    const pressed = transition(seated, TAP);
    expect(transition(pressed, TAP)).toBe(pressed);
  });
});

describe('nail: seated → driving → driven, pull resets', () => {
  it('accumulates a partial drive one tap at a time', () => {
    let f = createFastener(KIND.NAIL);
    for (let tap = 1; tap < FASTENER.tapsToDrive; tap++) {
      f = transition(f, TAP);
      expect(f.state).toBe(STATE.DRIVING);
      expect(f.progress).toBeCloseTo(tap / FASTENER.tapsToDrive);
      expect(isFastened(f)).toBe(true);
    }
    f = transition(f, TAP);
    expect(f).toMatchObject({ state: STATE.DRIVEN, progress: 1 });
    expect(transition(f, TAP)).toBe(f);
  });

  it('pulls out from part-driven or fully driven back to seated', () => {
    const part = transition(createFastener(KIND.NAIL), TAP);
    expect(transition(part, PULL)).toEqual(createFastener(KIND.NAIL));
    const full = run(createFastener(KIND.NAIL), Array(FASTENER.tapsToDrive).fill(TAP));
    expect(transition(full, PULL)).toEqual(createFastener(KIND.NAIL));
  });
});

describe('bolt: seated ⇄ screwed by signed crank', () => {
  const span = FASTENER.screwRadians;

  it('screws in on reaching full progress, and stays seated partway', () => {
    const half = transition(createFastener(KIND.BOLT), crank(span / 2));
    expect(half).toMatchObject({ state: STATE.SEATED, progress: 0.5 });
    expect(isFastened(half)).toBe(false);
    expect(isEngaged(half)).toBe(true);
    expect(transition(half, crank(span / 2)).state).toBe(STATE.SCREWED);
  });

  it('backs out only all the way to zero (hysteresis), then is plain seated again', () => {
    const screwed = transition(createFastener(KIND.BOLT), crank(span * 2));
    expect(screwed).toMatchObject({ state: STATE.SCREWED, progress: 1 });
    const backing = transition(screwed, crank(-span / 4));
    expect(backing).toMatchObject({ state: STATE.SCREWED, progress: 0.75 });
    expect(transition(backing, crank(-span))).toEqual(createFastener(KIND.BOLT));
  });

  it('cannot back out while a locked cam holds its head', () => {
    const screwed = transition(createFastener(KIND.BOLT), crank(span));
    expect(transition(screwed, crank(-span), { held: true })).toBe(screwed);
    expect(transition(screwed, crank(-span), { held: false }).state).toBe(STATE.SEATED);
  });

  it('ignores taps and pulls', () => {
    const f = createFastener(KIND.BOLT);
    expect(transition(f, TAP)).toBe(f);
    expect(transition(f, PULL)).toBe(f);
  });
});

describe('cam: seated ⇄ locked by quarter turn, lock gated on capture', () => {
  const quarter = FASTENER.quarterTurn;

  it('refuses to lock with no bolt head captured, though it still turns', () => {
    const turned = transition(createFastener(KIND.CAM), crank(quarter), { captured: false });
    expect(turned).toMatchObject({ state: STATE.SEATED, progress: 1 });
  });

  it('locks on a full quarter turn with a head captured', () => {
    const locked = transition(createFastener(KIND.CAM), crank(quarter), { captured: true });
    expect(locked).toMatchObject({ state: STATE.LOCKED, progress: 1 });
    expect(isFastened(locked)).toBe(true);
  });

  it('catches a head that came into reach after the turn, on a further turn at the stop', () => {
    const open = transition(createFastener(KIND.CAM), crank(quarter), { captured: false });
    expect(transition(open, crank(0.1), { captured: true }).state).toBe(STATE.LOCKED);
  });

  it('unlocks by turning back all the way', () => {
    const locked = transition(createFastener(KIND.CAM), crank(quarter), { captured: true });
    expect(transition(locked, crank(-quarter / 2)).state).toBe(STATE.LOCKED);
    expect(transition(locked, crank(-quarter))).toEqual(createFastener(KIND.CAM));
  });
});

describe('tool', () => {
  it('never fastens', () => {
    const f = createFastener(KIND.TOOL);
    for (const e of [TAP, PULL, crank(100)]) expect(transition(f, e)).toBe(f);
  });
});

describe('canRelease', () => {
  it('flips exactly when every fastener on the part is back to plain seated', () => {
    const dowel = transition(createFastener(KIND.DOWEL), TAP);
    const bolt = transition(createFastener(KIND.BOLT), crank(1));
    expect(canRelease([dowel, bolt])).toBe(false);
    expect(canRelease([transition(dowel, PULL), bolt])).toBe(false);
    expect(canRelease([transition(dowel, PULL), transition(bolt, crank(-1))])).toBe(true);
    expect(canRelease([])).toBe(true);
  });
});
