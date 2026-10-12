import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { TURN_RING } from '../src/constants.js';
import { createAssembly } from '../src/game/assembly.js';
import { arcLength, dialEngagements, dialHit, isHome, isStalled, pickDial, tightensClockwise } from '../src/game/turnRing.js';
import { createFastener, STATE } from '../src/game/fasteners.js';
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

// What the router passes: the graph's own answer for what a seated tool turns.
const turnedBy = (assembly: ReturnType<typeof createAssembly>) => (tool: { hardware: string }) => assembly.crankTarget(tool.hardware)?.target ?? null;

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
    expect(dialEngagements(assembly.all(), turnedBy(assembly))).toEqual([{ tool: key, target: bolt }]);
  });

  it('keeps the dial of a tool on a fastener that is home, for as long as the tool is on', () => {
    const { assembly, bolt, key } = bench();
    assembly.drive(bolt.id);
    expect(dialEngagements(assembly.all(), turnedBy(assembly))).toEqual([{ tool: key, target: assembly.get(bolt.id) }]);
    assembly.unseat(key.id);
    expect(dialEngagements(assembly.all(), turnedBy(assembly))).toEqual([]);
  });

  it('gives none with no tool seated', () => {
    const types: Record<string, string> = { panel: 'sidePanel', bolt: 'camLockBolt' };
    const assembly = createAssembly((id) => types[id]);
    assembly.seat({ partA: 'bolt', connectorA: 0, partB: 'panel', connectorB: 2, mover: 'bolt' });
    expect(dialEngagements(assembly.all(), turnedBy(assembly))).toEqual([]);
  });
});

describe('dialEngagements: a part turned by hand (1.9.2)', () => {
  beforeAll(() => setItem('blank'));
  afterAll(() => setItem('johnny'));

  // A stud in the top's first hole, a leg set onto its other end (the leg the part dragged), and a key.
  function bench() {
    const types: Record<string, string> = { top: 'top', stud: 'doubleEndedStud', leg: 'leg', key: 'allenWrench' };
    const assembly = createAssembly((id) => types[id]);
    const inTop = assembly.seat({ partA: 'stud', connectorA: 0, partB: 'top', connectorB: 0, mover: 'stud' });
    const inLeg = assembly.seat({ partA: 'stud', connectorA: 1, partB: 'leg', connectorB: 0, mover: 'leg' });
    return { assembly, inTop, inLeg };
  }

  it('gives a leg set onto its stud a toolless dial centred on its own hole — and the stud none', () => {
    const { assembly, inLeg } = bench();
    expect(dialEngagements(assembly.all(), turnedBy(assembly))).toEqual([{ tool: null, target: inLeg }]);
    // The dial's centre is the target's host connector: the leg's hole.
    expect(assembly.hostConnector(inLeg).type).toBe('studHole');
    expect(assembly.get(inLeg.id)!.host).toBe('leg');
  });

  it('gives a top set onto several studs one dial, on its first joint', () => {
    const types: Record<string, string> = { top: 'top', 'stud-1': 'doubleEndedStud', 'stud-2': 'doubleEndedStud' };
    const assembly = createAssembly((id) => types[id]);
    const first = assembly.seat({ partA: 'stud-1', connectorA: 0, partB: 'top', connectorB: 0, mover: 'top' });
    assembly.seat({ partA: 'stud-2', connectorA: 0, partB: 'top', connectorB: 1, mover: 'top' });
    expect(dialEngagements(assembly.all(), () => null)).toEqual([{ tool: null, target: first }]);
  });

  it('drops the dial once the leg is home', () => {
    const { assembly, inLeg } = bench();
    assembly.drive(inLeg.id);
    expect(dialEngagements(assembly.all(), turnedBy(assembly))).toEqual([]);
  });

  it('gives a part both a tool and a hand joint one dial: the key\'s, not a second for the hand', () => {
    // A top set onto a stud (the top the mover, so hand-turned), the key on the stud's free
    // hex: the key turns that very joint.
    const types: Record<string, string> = { top: 'top', stud: 'doubleEndedStud', key: 'allenWrench' };
    const assembly = createAssembly((id) => types[id]);
    const joint = assembly.seat({ partA: 'stud', connectorA: 0, partB: 'top', connectorB: 0, mover: 'top' });
    assembly.seat({ partA: 'key', connectorA: 0, partB: 'stud', connectorB: 3, mover: 'key' });
    expect(assembly.crankTarget('key')!.target!.id).toBe(joint.id);
    const dials = dialEngagements(assembly.all(), turnedBy(assembly));
    expect(dials).toHaveLength(1);
    expect(dials[0].tool).not.toBeNull();
    expect(dials[0].target.id).toBe(joint.id);
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
