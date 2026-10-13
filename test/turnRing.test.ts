import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { FASTENER, TURN_RING } from '../src/constants.js';
import { createAssembly } from '../src/game/assembly.js';
import { arcLength, dialHit, gripOf, isDrawn, isTurnHome, turnProgress, isStalled, pickDial, tightensClockwise } from '../src/game/turnRing.js';
import { createFastener, isHome, STATE } from '../src/game/fasteners.js';
import { setItem } from '../src/game/item.js';

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

// One dial per turn (the graph's `Turn` record, test/turnOf.test.ts): which turns are drawn,
// how full, and whose press they are.
describe('dials of turns', () => {
  // A bolt seated in a panel, the key on it.
  function johnny() {
    const types: Record<string, string> = { panel: 'sidePanel', bolt: 'camLockBolt', key: 'allenWrench' };
    const assembly = createAssembly((id) => types[id]);
    const bolt = assembly.seat({ partA: 'bolt', connectorA: 0, partB: 'panel', connectorB: 2, mover: 'bolt' });
    assembly.seat({ partA: 'key', connectorA: 0, partB: 'bolt', connectorB: 1, mover: 'key' });
    return { assembly, bolt };
  }

  it("draws a tool's dial for as long as the tool is on, home or not, as the key's press", () => {
    const { assembly, bolt } = johnny();
    const [turn] = assembly.turns();
    expect(gripOf(turn)).toBe('key');
    expect([turnProgress(turn), isTurnHome(turn), isDrawn(turn, false)]).toEqual([0, false, true]);
    assembly.drive(bolt.id);
    const [home] = assembly.turns();
    expect([turnProgress(home), isTurnHome(home), isDrawn(home, false)]).toEqual([1, true, true]);
  });

  it('draws nothing for a part with no tool and no turn', () => {
    const types: Record<string, string> = { panel: 'sidePanel', bolt: 'camLockBolt' };
    const assembly = createAssembly((id) => types[id]);
    assembly.seat({ partA: 'bolt', connectorA: 0, partB: 'panel', connectorB: 2, mover: 'bolt' });
    expect(assembly.turns()).toEqual([]);
  });

  describe('turned by hand (1.9.2)', () => {
    beforeAll(() => setItem('blank'));
    afterAll(() => setItem('johnny'));

    // A stud in the top's first hole, a leg set onto its other end.
    function blank() {
      const types: Record<string, string> = { top: 'top', stud: 'doubleEndedStud', leg: 'leg' };
      const assembly = createAssembly((id) => types[id]);
      assembly.seat({ partA: 'stud', connectorA: 0, partB: 'top', connectorB: 0, mover: 'stud' });
      const inLeg = assembly.seat({ partA: 'stud', connectorA: 1, partB: 'leg', connectorB: 0, mover: 'leg' });
      return { assembly, inLeg };
    }
    const legTurn = (assembly: ReturnType<typeof blank>['assembly']) => assembly.turnOf('leg')!;

    it("is the leg's press, drawn while the leg is pressed — whatever its progress — and not otherwise", () => {
      const { assembly, inLeg } = blank();
      expect(gripOf(legTurn(assembly))).toBe('leg');
      expect(isDrawn(legTurn(assembly), true)).toBe(true);
      expect(isDrawn(legTurn(assembly), false)).toBe(false);
      assembly.apply(inLeg.id, { type: 'crank', radians: FASTENER.studRadians / 2 });
      expect(turnProgress(legTurn(assembly))).toBeCloseTo(0.5, 9);
      assembly.drive(inLeg.id);
      // Home on a stud that is not yet home in the top: the turn goes on into the top.
      expect(isDrawn(legTurn(assembly), true)).toBe(true);
      expect(turnProgress(legTurn(assembly))).toBe(0);
    });

    it('is drawn home too while pressed: the leg is circled to loosen it', () => {
      const { assembly, inLeg } = blank();
      for (const j of assembly.all()) assembly.drive(j.id);
      expect(assembly.get(inLeg.id)!.fastener.progress).toBe(1);
      const turn = legTurn(assembly);
      expect(isTurnHome(turn)).toBe(true);
      expect(isDrawn(turn, true)).toBe(true);
      expect(isDrawn(turn, false)).toBe(false);
    });

    it('draws no dial for a turn with nothing to turn: a key on a buried hex', () => {
      const types: Record<string, string> = { top: 'top', stud: 'doubleEndedStud', key: 'allenWrench' };
      const assembly = createAssembly((id) => types[id]);
      assembly.seat({ partA: 'stud', connectorA: 0, partB: 'top', connectorB: 0, mover: 'stud' });
      assembly.seat({ partA: 'key', connectorA: 0, partB: 'stud', connectorB: 2, mover: 'key' });
      const [turn] = assembly.turns();
      expect(turn.joints).toEqual([]);
      expect(isDrawn(turn, true)).toBe(false);
    });
  });
});

describe('isHome', () => {
  const bolt = createFastener(KIND.BOLT);

  it('is fastened and fully turned', () => {
    expect(isHome({ ...bolt, state: STATE.SCREWED, progress: 1 })).toBe(true);
  });

  it('is not a screwed bolt backed off partway, nor a full turn that never fastened', () => {
    expect(isHome({ ...bolt, state: STATE.SCREWED, progress: 0.8 })).toBe(false);
    expect(isHome({ ...bolt, progress: 1 })).toBe(false);
  });
});

describe('pickDial', () => {
  // Two dials 14 px apart, as JOHNNY's bolt head and cam recess sit on screen.
  const bolt = { name: 'bolt', centre: [500, 500] as [number, number], home: true };
  const cam = { name: 'cam', centre: [514, 500] as [number, number], home: false };
  const onCamRing = (angle: number): [number, number] => [cam.centre[0] + TURN_RING.radius * Math.cos(angle), cam.centre[1] + TURN_RING.radius * Math.sin(angle)];

  it('gives an overlapping press to the fastener still to go home, from any angle', () => {
    for (let a = 0; a < 2 * Math.PI; a += Math.PI / 6) expect(pickDial(onCamRing(a), [bolt, cam])?.name).toBe('cam');
  });

  it('gives it to the nearer ring line when both are still to go, or both home', () => {
    const live = { ...bolt, home: false };
    expect(pickDial(onCamRing(0), [live, cam])?.name).toBe('cam');
    expect(pickDial([bolt.centre[0] - TURN_RING.radius, 500], [live, cam])?.name).toBe('bolt');
    expect(pickDial(onCamRing(0), [bolt, { ...cam, home: true }])?.name).toBe('cam');
  });

  it('takes a home dial when it is the only band under the press', () => {
    expect(pickDial([bolt.centre[0] - TURN_RING.radius - TURN_RING.band + 2, 500], [bolt, cam])?.name).toBe('bolt');
  });

  it('is null off every band', () => {
    expect(pickDial([500, 500], [bolt, cam])).toBeNull();
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
