import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { FASTENER } from '../src/constants.js';
import { advancing, createAssembly, isUnderWay } from '../src/game/assembly.js';
import { STATE } from '../src/game/fasteners.js';
import { ASSEMBLED, setItem } from '../src/game/item.js';
import { isTurnHome, turnProgress } from '../src/game/turnRing.js';
import type { Assembly, AssemblyJoint, Turn } from '../src/game/assembly.js';

// The turn record (1.9.2, review round 5): everything a turn is — what it turns, what visibly
// turns and about what, what rides along, what is loose — resolved once by `assembly.turnOf`
// / `assembly.turns`. Headless, against the graph alone; test/turnRouter.test.ts runs the same
// six cases through the router. Every review finding of rounds 1–4 maps to one of them.
//
// BLANK's real pack. Stud connectors: 0 studEnd-1 and 2 its hex (boltHead-1), 1 studEnd-2 and
// 3 its hex (boltHead-2). A leg's one hole is 0; the top's four are 0..3.

const STUD_END_1 = 0;
const STUD_END_2 = 1;
const HEX_AT_END_2 = 3;
const LEG_HOLE = 0;
const SPAN = () => FASTENER.studRadians;

beforeAll(() => setItem('blank'));
afterAll(() => setItem('johnny'));

const typeOf = (id: string) => id.replace(/-\d+$/, '');
const ids = (joints: readonly AssemblyJoint[]) => joints.map((j) => j.id);
const poseOf = (id: string) => ASSEMBLED.parts.find((p) => p.id === id)!;
const turn = (assembly: Assembly, part: string) => assembly.turnOf(part)!;
const set = (assembly: Assembly, joint: AssemblyJoint, progress: number) =>
  assembly.apply(joint.id, { type: 'crank', radians: (progress - assembly.get(joint.id)!.fastener.progress) * SPAN() });
const home = (assembly: Assembly, joint: AssemblyJoint) => assembly.drive(joint.id);
// Each joint of the graph in at most one turn: the draw, the dial and the hold never meet twice.
const coverage = (assembly: Assembly) => assembly.turns().flatMap((t) => ids(t.joints));
const expectOnce = (assembly: Assembly) => {
  const all = coverage(assembly);
  expect(new Set(all).size).toBe(all.length);
};

// Stud `n` into top hole `n - 1` by its first end, pushed (keyed) by the stud itself.
const studIntoTop = (assembly: Assembly, n = 1) =>
  assembly.seat({ partA: `doubleEndedStud-${n}`, connectorA: STUD_END_1, partB: 'top-1', connectorB: n - 1, mover: `doubleEndedStud-${n}` });
// Leg `n` set onto stud `n`'s second end: the leg the part dragged.
const legOntoStud = (assembly: Assembly, n = 1) =>
  assembly.seat({ partA: `doubleEndedStud-${n}`, connectorA: STUD_END_2, partB: `leg-${n}`, connectorB: LEG_HOLE, mover: `leg-${n}` });

describe('1. a leg set onto a standing stud: circled home, loosened, tapped off', () => {
  function bench() {
    const assembly = createAssembly(typeOf);
    const inTop = studIntoTop(assembly);
    home(assembly, inTop);
    const inLeg = legOntoStud(assembly);
    return { assembly, inTop, inLeg };
  }

  it('is the leg\'s turn by hand: its own joint, about its hole, nothing riding, the leg loose at the stud\'s end', () => {
    const { assembly, inLeg } = bench();
    expect(isUnderWay(turn(assembly, 'leg-1'))).toBe(false);
    expect(turn(assembly, 'leg-1')).toEqual<Turn>({
      grip: { kind: 'hand', part: 'leg-1' },
      joints: [assembly.get(inLeg.id)!],
      turned: { part: 'leg-1', connector: LEG_HOLE, sense: 1, spins: true },
      riders: [],
      loose: { parts: ['leg-1'], restFrom: assembly.get(inLeg.id)! },
    });
    // The stud and the top are nobody's grip: the stud is keyed, the top's joint the stud's.
    expect(assembly.turnOf('doubleEndedStud-1')).toBeNull();
    expect(assembly.turnOf('top-1')).toBeNull();
    expectOnce(assembly);
  });

  it('circled home, takes in the stud beyond — home too — with the stud riding and nothing loose', () => {
    const { assembly, inTop, inLeg } = bench();
    expect(ids(advancing(turn(assembly, 'leg-1'), 1))).toEqual([inLeg.id]);
    home(assembly, inLeg);
    const t = turn(assembly, 'leg-1');
    expect(ids(t.joints)).toEqual([inLeg.id, inTop.id]);
    expect(t.riders).toEqual(['doubleEndedStud-1']);
    expect(t.loose).toBeNull();
    expect(isTurnHome(t)).toBe(true);
    // Fastened in place: under way — a drag loosens it.
    expect(isUnderWay(t)).toBe(true);
    expect(advancing(t, 1)).toEqual([]);
    expectOnce(assembly);
  });

  it('loosens the leg off its stud — never the stud out of the top — and at nothing the leg is loose again', () => {
    const { assembly, inTop, inLeg } = bench();
    home(assembly, inLeg);
    expect(ids(advancing(turn(assembly, 'leg-1'), -1))).toEqual([inLeg.id]);
    set(assembly, inLeg, 0.5);
    // Off home, the stud is no longer one piece with the leg: out of the turn, not riding.
    expect(turn(assembly, 'leg-1')).toMatchObject({ joints: [{ id: inLeg.id }], riders: [] });
    set(assembly, inLeg, 0);
    expect(turn(assembly, 'leg-1').loose).toEqual({ parts: ['leg-1'], restFrom: assembly.get(inLeg.id)! });
    expect(assembly.get(inTop.id)!.fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
  });

  it("rests the leg at the stud's end: one sink off where it is built", () => {
    const { assembly, inLeg } = bench();
    const rest = assembly.restPose(inLeg.id, poseOf, 'leg-1');
    const built = poseOf('leg-1');
    expect(rest.position[0]).toBeCloseTo(built.position[0], 9);
    expect(rest.position[1]).toBeCloseTo(built.position[1] - FASTENER.sinkDepth.stud!, 9);
    expect(rest.position[2]).toBeCloseTo(built.position[2], 9);
  });
});

describe('2. a leg screwed home onto a loose stud, carried onto the top', () => {
  function bench() {
    const assembly = createAssembly(typeOf);
    const inLeg = legOntoStud(assembly);
    home(assembly, inLeg);
    return { assembly, inLeg };
  }
  // Carried on: the stud's free end into the top, the leg (carrying it) the mover.
  const carryOn = (assembly: Assembly) =>
    assembly.seat({ partA: 'doubleEndedStud-1', connectorA: STUD_END_1, partB: 'top-1', connectorB: 0, mover: 'leg-1' });

  it('has no turn while there is nothing to turn into: the leg and its stud carry as one', () => {
    const { assembly } = bench();
    expect(assembly.turnOf('leg-1')).toBeNull();
    expect(assembly.turns()).toEqual([]);
    expect([...assembly.compoundOf('leg-1')].sort()).toEqual(['doubleEndedStud-1', 'leg-1']);
  });

  it('carried onto the top, turns the stud on in through the leg, the stud riding, the pair loose at the top\'s mouth', () => {
    const { assembly, inLeg } = bench();
    const inTop = carryOn(assembly);
    const t = turn(assembly, 'leg-1');
    expect(t).toEqual<Turn>({
      grip: { kind: 'hand', part: 'leg-1' },
      joints: [assembly.get(inLeg.id)!, assembly.get(inTop.id)!],
      turned: { part: 'leg-1', connector: LEG_HOLE, sense: 1, spins: true },
      riders: ['doubleEndedStud-1'],
      loose: { parts: ['leg-1', 'doubleEndedStud-1'], restFrom: assembly.get(inTop.id)! },
    });
    // The leg is already home on its stud: tightening goes on into the top. Nothing is
    // partway and the pair is loose: not under way — a drag carries it, a tap lifts it off.
    expect(ids(advancing(t, 1))).toEqual([inTop.id]);
    expect(isUnderWay(t)).toBe(false);
    expectOnce(assembly);
  });

  it('finishes into the top, then loosens the leg off its stud first, loose at the stud\'s end', () => {
    const { assembly, inLeg } = bench();
    const inTop = carryOn(assembly);
    home(assembly, inTop);
    expect(turn(assembly, 'leg-1').loose).toBeNull();
    expect(isTurnHome(turn(assembly, 'leg-1'))).toBe(true);
    expect(ids(advancing(turn(assembly, 'leg-1'), -1))).toEqual([inLeg.id]);
    set(assembly, inLeg, 0);
    expect(turn(assembly, 'leg-1').loose).toEqual({ parts: ['leg-1'], restFrom: assembly.get(inLeg.id)! });
  });

  it('rests the pair at the top\'s mouth, the stud and the leg it is in together', () => {
    const { assembly } = bench();
    const inTop = carryOn(assembly);
    const studRest = assembly.restPose(inTop.id, poseOf, 'doubleEndedStud-1');
    const legRest = assembly.restPose(inTop.id, poseOf, 'leg-1');
    const sink = FASTENER.sinkDepth.stud!;
    expect(studRest.position[1]).toBeCloseTo(poseOf('doubleEndedStud-1').position[1] - sink, 9);
    expect(legRest.position[1]).toBeCloseTo(poseOf('leg-1').position[1] - sink, 9);
  });
});

describe('3. a top dropped onto four standing studs', () => {
  function bench() {
    const assembly = createAssembly(typeOf);
    const onTop: AssemblyJoint[] = [];
    const inLegs: AssemblyJoint[] = [];
    for (let n = 1; n <= 4; n++) {
      const inLeg = assembly.seat({ partA: `doubleEndedStud-${n}`, connectorA: STUD_END_2, partB: `leg-${n}`, connectorB: LEG_HOLE, mover: `doubleEndedStud-${n}` });
      home(assembly, inLeg);
      inLegs.push(inLeg);
    }
    for (let n = 1; n <= 4; n++) onTop.push(assembly.seat({ partA: `doubleEndedStud-${n}`, connectorA: STUD_END_1, partB: 'top-1', connectorB: n - 1, mover: 'top-1' }));
    return { assembly, onTop, inLegs };
  }

  it('is one turn of the top: all four studs, about its first hole, the top loose on its first', () => {
    const { assembly, onTop } = bench();
    const t = turn(assembly, 'top-1');
    expect(t.grip).toEqual({ kind: 'hand', part: 'top-1' });
    expect(ids(t.joints)).toEqual(ids(onTop));
    // On four parallel studs the top cannot spin about any one: it only sinks.
    expect(t.turned).toEqual({ part: 'top-1', connector: 0, sense: 1, spins: false });
    expect(t.riders).toEqual([]);
    expect(t.loose).toEqual({ parts: ['top-1'], restFrom: assembly.get(onTop[0].id)! });
    expect(assembly.turns().filter((x) => x.grip.kind === 'hand')).toHaveLength(1);
    expect(ids(advancing(t, 1))).toEqual(ids(onTop));
    expectOnce(assembly);
  });

  it('turns the rest when one is home early', () => {
    const { assembly, onTop, inLegs } = bench();
    home(assembly, onTop[0]);
    const t = turn(assembly, 'top-1');
    // The first stud is one piece with the top now: its joint into the leg joins, riding.
    expect(ids(t.joints)).toEqual([...ids(onTop), inLegs[0].id]);
    expect(t.riders).toEqual(['doubleEndedStud-1']);
    expect(ids(advancing(t, 1))).toEqual(ids(onTop.slice(1)));
    expect(turnProgress(t)).toBe(0);
  });

  it('home on all four, is home; loosening turns all four off together', () => {
    const { assembly, onTop } = bench();
    for (const j of onTop) home(assembly, j);
    const t = turn(assembly, 'top-1');
    expect(isTurnHome(t)).toBe(true);
    expect(t.loose).toBeNull();
    expect(ids(advancing(t, -1))).toEqual(ids(onTop));
  });
});

describe('4. a stud half into the top with a leg screwed home on it', () => {
  function bench() {
    const assembly = createAssembly(typeOf);
    const inTop = studIntoTop(assembly);
    set(assembly, inTop, 0.5);
    const inLeg = legOntoStud(assembly);
    home(assembly, inLeg);
    return { assembly, inTop, inLeg };
  }

  it("is the leg's turn: its home joint and the stud's half one beyond, shown at the stud's half", () => {
    const { assembly, inTop, inLeg } = bench();
    const t = turn(assembly, 'leg-1');
    expect(ids(t.joints)).toEqual([inLeg.id, inTop.id]);
    expect(t.turned).toEqual({ part: 'leg-1', connector: LEG_HOLE, sense: 1, spins: true });
    expect(t.riders).toEqual(['doubleEndedStud-1']);
    expect(turnProgress(t)).toBeCloseTo(0.5, 9);
    expect(isTurnHome(t)).toBe(false);
    expect(ids(advancing(t, 1))).toEqual([inTop.id]);
    // Both hexes buried: no key reaches the stud — the leg is the only handle.
    expect(assembly.turnedFrom('doubleEndedStud-1', 2)).toBeNull();
    expect(assembly.turnedFrom('doubleEndedStud-1', HEX_AT_END_2)).toBeNull();
  });

  it('is home once the stud is finished through the leg', () => {
    const { assembly, inTop } = bench();
    home(assembly, inTop);
    expect(isTurnHome(turn(assembly, 'leg-1'))).toBe(true);
  });

  it('is loose with nothing fastened outside it: the pair, at the top\'s mouth', () => {
    const { assembly, inTop } = bench();
    // Half in, the stud is held by no fastened joint: the leg and stud are one loose unit.
    expect(turn(assembly, 'leg-1').loose).toEqual({ parts: ['leg-1', 'doubleEndedStud-1'], restFrom: assembly.get(inTop.id)! });
  });
});

describe('5. a key on a hand-seated stud', () => {
  // The top dropped onto a stud (the top the mover), then the key on the stud's free hex.
  function bench() {
    const assembly = createAssembly(typeOf);
    const joint = assembly.seat({ partA: 'doubleEndedStud-1', connectorA: STUD_END_1, partB: 'top-1', connectorB: 0, mover: 'top-1' });
    const key = assembly.seat({ partA: 'allenWrench-1', connectorA: 0, partB: 'doubleEndedStud-1', connectorB: HEX_AT_END_2, mover: 'allenWrench-1' });
    return { assembly, joint, key };
  }

  it("is the key's turn: the stud turning about the hex the key is in, the top not turning at all", () => {
    const { assembly, joint, key } = bench();
    expect(turn(assembly, 'allenWrench-1')).toEqual<Turn>({
      grip: { kind: 'tool', tool: assembly.get(key.id)! },
      joints: [assembly.get(joint.id)!],
      turned: { part: 'doubleEndedStud-1', connector: HEX_AT_END_2, sense: -1, spins: true },
      riders: [],
      // Loose, it is the top that moved into the seat: held at the stud's end, as by hand.
      loose: { parts: ['top-1'], restFrom: assembly.get(joint.id)! },
    });
    expect(assembly.turnOf('top-1')).toBeNull();
    expect(assembly.turns().map((t) => t.grip.kind)).toEqual(['tool']);
    expectOnce(assembly);
  });

  // Review round 5: a key backing out a joint a part was set onto holds that part, as the
  // hand would — not the tool path dropping it.
  it('leaves a leg the key backs off its stud loose at the stud\'s end, as the hand would', () => {
    const assembly = createAssembly(typeOf);
    const inLeg = legOntoStud(assembly);
    home(assembly, inLeg);
    // The stud loose, its first end free: the key on that end's hex turns the leg's joint.
    assembly.seat({ partA: 'allenWrench-1', connectorA: 0, partB: 'doubleEndedStud-1', connectorB: 2, mover: 'allenWrench-1' });
    expect(ids(turn(assembly, 'allenWrench-1').joints)).toEqual([inLeg.id]);
    expect(turn(assembly, 'allenWrench-1').loose).toBeNull();
    set(assembly, inLeg, 0);
    expect(turn(assembly, 'allenWrench-1').loose).toEqual({ parts: ['leg-1'], restFrom: assembly.get(inLeg.id)! });
  });

  it('hands the joint back to the top once the key is off', () => {
    const { assembly, joint, key } = bench();
    assembly.unseat(key.id);
    expect(turn(assembly, 'top-1')).toMatchObject({ grip: { kind: 'hand', part: 'top-1' }, joints: [{ id: joint.id }] });
  });

  it('has a key on a buried hex turn nothing — still the key\'s turn, its own', () => {
    const assembly = createAssembly(typeOf);
    studIntoTop(assembly);
    assembly.seat({ partA: 'allenWrench-1', connectorA: 0, partB: 'doubleEndedStud-1', connectorB: 2, mover: 'allenWrench-1' });
    expect(turn(assembly, 'allenWrench-1')).toMatchObject({ grip: { kind: 'tool' }, joints: [], loose: null });
  });
});

describe('6. JOHNNY: a bolt under the key, a cam under the screwdriver — as before', () => {
  beforeAll(() => setItem('johnny'));
  afterAll(() => setItem('blank'));
  const SIDE_CAM_BOLT_HOLE = 2;
  const SHELF_RECESS = 2;
  const BOLT_HEAD = 1;
  const CAM_SLOT = 1;

  function bench() {
    const assembly = createAssembly(typeOf);
    const bolt = assembly.seat({ partA: 'camLockBolt-1', connectorA: 0, partB: 'sidePanel-1', connectorB: SIDE_CAM_BOLT_HOLE, mover: 'camLockBolt-1' });
    const cam = assembly.seat({ partA: 'camLock-1', connectorA: 0, partB: 'topBottomPanel-1', connectorB: SHELF_RECESS, mover: 'camLock-1' });
    const key = assembly.seat({ partA: 'allenWrench-1', connectorA: 0, partB: 'camLockBolt-1', connectorB: BOLT_HEAD, mover: 'allenWrench-1' });
    const driver = assembly.seat({ partA: 'screwdriver-1', connectorA: 0, partB: 'camLock-1', connectorB: CAM_SLOT, mover: 'screwdriver-1' });
    return { assembly, bolt, cam, key, driver };
  }

  it('turns the bolt about its head, the bolt loose at its mouth until screwed', () => {
    const { assembly, bolt, key } = bench();
    expect(turn(assembly, 'allenWrench-1')).toEqual<Turn>({
      grip: { kind: 'tool', tool: assembly.get(key.id)! },
      joints: [assembly.get(bolt.id)!],
      turned: { part: 'camLockBolt-1', connector: BOLT_HEAD, sense: -1, spins: true },
      riders: [],
      loose: { parts: ['camLockBolt-1'], restFrom: assembly.get(bolt.id)! },
    });
    home(assembly, bolt);
    expect(turn(assembly, 'allenWrench-1').loose).toBeNull();
  });

  it('turns the cam about its slot, loose until locked', () => {
    const { assembly, cam, driver } = bench();
    expect(turn(assembly, 'screwdriver-1')).toEqual<Turn>({
      grip: { kind: 'tool', tool: assembly.get(driver.id)! },
      joints: [assembly.get(cam.id)!],
      turned: { part: 'camLock-1', connector: CAM_SLOT, sense: -1, spins: true },
      riders: [],
      loose: { parts: ['camLock-1'], restFrom: assembly.get(cam.id)! },
    });
  });

  it('has no hand turns, and no turn for a part without a tool', () => {
    const { assembly } = bench();
    expect(assembly.turns().map((t) => t.grip.kind)).toEqual(['tool', 'tool']);
    for (const part of ['camLockBolt-1', 'camLock-1', 'sidePanel-1', 'topBottomPanel-1']) expect(assembly.turnOf(part)).toBeNull();
    expect(KIND.BOLT).toBe('bolt');
  });
});
