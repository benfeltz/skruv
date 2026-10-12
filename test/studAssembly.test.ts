import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONNECTOR, KIND } from '../tools/validate/lib/vocabulary.js';
import { FASTENER } from '../src/constants.js';
import { createAssembly, seatHome } from '../src/game/assembly.js';
import { STATE } from '../src/game/fasteners.js';
import { ASSEMBLED, setItem } from '../src/game/item.js';
import { isSeatTarget, isWorkable, seatedHardware } from '../src/game/toolTargets.js';
import type { TurnedBy } from '../src/game/toolTargets.js';
import type { AssemblyJoint } from '../src/game/assembly.js';

// The stud machine in the assembly graph (1.9.2), on BLANK's real pack: seating, homing and
// bonding a double-ended stud. Item state is module-level, so BLANK is current for this file only.

beforeAll(() => setItem('blank'));
afterAll(() => setItem('johnny'));

const typeById = () => new Map(ASSEMBLED.parts.map((p) => [p.id, p.type]));
const pairOf = (j: { hardware: string; hardwareConnector: number; host: string; hostConnector: number; mover: string }) => ({
  partA: j.hardware,
  connectorA: j.hardwareConnector,
  partB: j.host,
  connectorB: j.hostConnector,
  mover: j.mover,
});

describe('a stud joint', () => {
  it('seats unfastened, and is driven home by the stud turn', () => {
    const types = typeById();
    const assembly = createAssembly((id) => types.get(id)!);
    const [first] = ASSEMBLED.joints;
    const joint = assembly.seat(pairOf(first));
    expect(joint.kind).toBe(KIND.STUD);
    expect(joint.fastener).toMatchObject({ state: STATE.SEATED, progress: 0 });
    expect(assembly.drive(joint.id)).toBe(true);
    expect(assembly.get(joint.id)!.fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
    // The span is the stud's own, not the bolt's: a bolt's worth of turn finishes it only while they match.
    expect(assembly.apply(joint.id, { type: 'crank', radians: -FASTENER.studRadians })).toBe(true);
    expect(assembly.get(joint.id)!.fastener.state).toBe(STATE.SEATED);
  });

  it('fastens every pair of the built BLANK, and bonds the legs rigid to the top', () => {
    const types = typeById();
    const assembly = createAssembly((id) => types.get(id)!);
    const joints: AssemblyJoint[] = seatHome(assembly, ASSEMBLED.joints.map(pairOf));
    expect(joints).toHaveLength(8);
    for (const j of joints) expect(j.fastener.state, `${j.hardware} in ${j.host}`).toBe(STATE.SCREWED);

    const poseOf = (id: string) => ASSEMBLED.parts.find((p) => p.id === id)!;
    const bridges = assembly.bonds(poseOf).filter((b) => b.key.startsWith('bridge:'));
    expect(bridges).toHaveLength(4);
    for (const bridge of bridges) expect(bridge.mode).toBe('rigid');
    // Every leg ends up in the top's compound.
    const compound = assembly.compoundOf('top-1');
    for (const p of ASSEMBLED.parts) expect(compound.has(p.id), p.id).toBe(true);
  });
});

describe('crankTarget on a two-ended stud', () => {
  const STUD_IN_TOP = 0;
  const STUD_IN_LEG = 1;
  const HEX_AT_TOP_END = 2;
  const HEX_AT_LEG_END = 3;
  function bench() {
    const types = typeById();
    const assembly = createAssembly((id) => types.get(id) ?? id.replace(/-\d+$/, ''));
    const inTop = assembly.seat({ partA: 'doubleEndedStud-1', connectorA: STUD_IN_TOP, partB: 'top-1', connectorB: 0, mover: 'doubleEndedStud-1' });
    return { assembly, inTop };
  }

  it("turns the end the key is not in: the key on the free end's hex drives the end in the top", () => {
    const { assembly, inTop } = bench();
    assembly.seat({ partA: 'allenWrench-1', connectorA: 0, partB: 'doubleEndedStud-1', connectorB: HEX_AT_LEG_END, mover: 'allenWrench-1' });
    expect(assembly.crankTarget('allenWrench-1')!.target!.id).toBe(inTop.id);
  });

  it('turns the other end when only that one is seated — whichever end is the free one', () => {
    const types = typeById();
    const assembly = createAssembly((id) => types.get(id) ?? id.replace(/-\d+$/, ''));
    const inLeg = assembly.seat({ partA: 'doubleEndedStud-1', connectorA: STUD_IN_LEG, partB: 'leg-1', connectorB: 0, mover: 'doubleEndedStud-1' });
    assembly.seat({ partA: 'allenWrench-1', connectorA: 0, partB: 'doubleEndedStud-1', connectorB: HEX_AT_TOP_END, mover: 'allenWrench-1' });
    expect(assembly.crankTarget('allenWrench-1')!.target!.id).toBe(inLeg.id);
  });

  it('has nothing to turn with the key in the hex of the only seated end — it is buried', () => {
    const { assembly } = bench();
    assembly.seat({ partA: 'allenWrench-1', connectorA: 0, partB: 'doubleEndedStud-1', connectorB: HEX_AT_TOP_END, mover: 'allenWrench-1' });
    expect(assembly.crankTarget('allenWrench-1')).toMatchObject({ target: null });
  });
});

describe("a stud's hex as a tool target", () => {
  const HEX_AT_TOP_END = 2;
  const HEX_AT_LEG_END = 3;
  const hex = (index: number) => ({ type: CONNECTOR.BOLT_HEAD, part: { id: 'doubleEndedStud-1' }, index });
  const none = () => null;

  function bench() {
    const types = typeById();
    return createAssembly((id) => types.get(id)!);
  }
  const turned = (assembly: ReturnType<typeof bench>): TurnedBy => (c) => assembly.turnedFrom(c.part.id, c.index);

  it('is a seat target only once the stud is seated, workable until it is screwed home', () => {
    const assembly = bench();
    expect(isSeatTarget(hex(HEX_AT_LEG_END), seatedHardware(assembly.all()))).toBe(false);
    const joint = assembly.seat({ partA: 'doubleEndedStud-1', connectorA: 0, partB: 'top-1', connectorB: 0, mover: 'doubleEndedStud-1' });
    expect(isSeatTarget(hex(HEX_AT_LEG_END), seatedHardware(assembly.all()))).toBe(true);
    expect(isWorkable(hex(HEX_AT_LEG_END), { captured: none, turnedBy: turned(assembly) })).toBe(true);
    assembly.drive(joint.id);
    expect(isWorkable(hex(HEX_AT_LEG_END), { captured: none, turnedBy: turned(assembly) })).toBe(false);
  });

  // Review: a hex at an end that is itself seated is buried — in the top, in the leg — and
  // no key reaches it, whatever the other end is doing.
  it('lights the free end hex by the seated end it would turn, and leaves a buried hex dark', () => {
    const assembly = bench();
    const inTop = assembly.seat({ partA: 'doubleEndedStud-1', connectorA: 0, partB: 'top-1', connectorB: 0, mover: 'doubleEndedStud-1' });
    expect(turned(assembly)(hex(HEX_AT_LEG_END))).toMatchObject({ id: inTop.id });
    expect(turned(assembly)(hex(HEX_AT_TOP_END))).toBeNull();
    expect(isWorkable(hex(HEX_AT_TOP_END), { captured: none, turnedBy: turned(assembly) })).toBe(false);
  });

  it('lights neither hex once both ends are seated, though the leg end is still to turn', () => {
    const assembly = bench();
    const inTop = assembly.seat({ partA: 'doubleEndedStud-1', connectorA: 0, partB: 'top-1', connectorB: 0, mover: 'doubleEndedStud-1' });
    assembly.seat({ partA: 'doubleEndedStud-1', connectorA: 1, partB: 'leg-1', connectorB: 0, mover: 'leg-1' });
    assembly.drive(inTop.id);
    for (const index of [HEX_AT_TOP_END, HEX_AT_LEG_END]) {
      expect(turned(assembly)(hex(index))).toBeNull();
      expect(isWorkable(hex(index), { captured: none, turnedBy: turned(assembly) })).toBe(false);
    }
  });

  it('names the hex that shares an end with the end — the connectors a seated end buries', () => {
    const assembly = bench();
    // studEnd-1 (0) with boltHead-1 (2); studEnd-2 (1) with boltHead-2 (3).
    expect(assembly.coincident('doubleEndedStud-1', 0)).toEqual([HEX_AT_TOP_END]);
    expect(assembly.coincident('doubleEndedStud-1', 1)).toEqual([HEX_AT_LEG_END]);
    // JOHNNY's bolt has none: its head is the far end of its thread.
    expect(assembly.coincident('top-1', 0)).toEqual([]);
  });
});

describe('a stud screwed into the leg first (review: unturnable joint)', () => {
  // The stud goes into the leg by the key (the stud the mover), then the leg is carried onto
  // the top: the joint into the top has the leg as its mover — neither hardware nor host.
  function bench() {
    const types = typeById();
    const assembly = createAssembly((id) => types.get(id)!);
    const inLeg = assembly.seat({ partA: 'doubleEndedStud-1', connectorA: 1, partB: 'leg-1', connectorB: 0, mover: 'doubleEndedStud-1' });
    assembly.drive(inLeg.id);
    const inTop = assembly.seat({ partA: 'doubleEndedStud-1', connectorA: 0, partB: 'top-1', connectorB: 0, mover: 'leg-1' });
    return { assembly, inLeg, inTop };
  }

  it('is turned by hand through the carried leg, which is the mover — not the stud, not the top', () => {
    const { assembly, inTop, inLeg } = bench();
    expect(assembly.handTarget('leg-1')).toMatchObject({ id: inTop.id });
    expect(assembly.handTarget('top-1')).toBeNull();
    expect(assembly.handTarget('doubleEndedStud-1')).toBeNull();
    // The key-turned joint into the leg is nobody's hand joint.
    expect(inLeg.mover).toBe('doubleEndedStud-1');
  });

  it('can be screwed home through the hand joint', () => {
    const { assembly, inTop } = bench();
    expect(assembly.apply(inTop.id, { type: 'crank', radians: FASTENER.studRadians })).toBe(true);
    expect(assembly.get(inTop.id)!.fastener.state).toBe(STATE.SCREWED);
  });
});

describe('restPose of a part set onto its stud by hand (review)', () => {
  it("puts the leg, not the stud, back at the stud's end: the leg's hole mouth where the screwed stud's end is", () => {
    const types = typeById();
    const assembly = createAssembly((id) => types.get(id)!);
    const joints = seatHome(assembly, ASSEMBLED.joints.map(pairOf));
    const legJoint = joints.find((j) => j.host === 'leg-1')!;
    const poseOf = (id: string) => ASSEMBLED.parts.find((p) => p.id === id)!;
    const rest = assembly.restPose(legJoint.id, poseOf);
    const home = poseOf('leg-1');
    // As built the leg touches the top; at the stud's mouth it stands one sink further off.
    expect(rest.position[0]).toBeCloseTo(home.position[0], 9);
    expect(rest.position[1]).toBeCloseTo(home.position[1] - FASTENER.sinkDepth.stud!, 9);
    expect(rest.position[2]).toBeCloseTo(home.position[2], 9);
    // And the stud's own joint still rests the stud, at the top's mouth: untouched by the hand rule.
    const studJoint = joints.find((j) => j.host === 'top-1' && j.hardware === 'doubleEndedStud-1')!;
    expect(assembly.restPose(studJoint.id, poseOf).position[1]).toBeCloseTo(poseOf('doubleEndedStud-1').position[1] - FASTENER.sinkDepth.stud!, 9);
  });
});
