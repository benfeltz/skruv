import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONNECTOR, KIND } from '../tools/validate/lib/vocabulary.js';
import { FASTENER } from '../src/constants.js';
import { createAssembly, seatHome } from '../src/game/assembly.js';
import { STATE } from '../src/game/fasteners.js';
import { ASSEMBLED, setItem } from '../src/game/item.js';
import { isSeatTarget, isWorkable, seatedHardware } from '../src/game/toolTargets.js';
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
  // Stud 1 into the top by its first end, then a leg onto its second; the key on either hex.
  const STUD_IN_TOP = 0;
  const STUD_IN_LEG = 1;
  const HEX_AT_TOP_END = 2;
  const HEX_AT_LEG_END = 3;
  function bench() {
    const types = typeById();
    const assembly = createAssembly((id) => types.get(id) ?? id.replace(/-\d+$/, ''));
    const inTop = assembly.seat({ partA: 'doubleEndedStud-1', connectorA: STUD_IN_TOP, partB: 'top-1', connectorB: 0, mover: 'doubleEndedStud-1' });
    const inLeg = assembly.seat({ partA: 'doubleEndedStud-1', connectorA: STUD_IN_LEG, partB: 'leg-1', connectorB: 0, mover: 'leg-1' });
    return { assembly, inTop, inLeg };
  }

  it("turns the end the key is not in: the key on the leg end's hex drives the end in the top, and the other way round", () => {
    const { assembly, inTop, inLeg } = bench();
    assembly.seat({ partA: 'allenWrench-1', connectorA: 0, partB: 'doubleEndedStud-1', connectorB: HEX_AT_LEG_END, mover: 'allenWrench-1' });
    expect(assembly.crankTarget('allenWrench-1')!.target!.id).toBe(inTop.id);
    const other = bench();
    other.assembly.seat({ partA: 'allenWrench-1', connectorA: 0, partB: 'doubleEndedStud-1', connectorB: HEX_AT_TOP_END, mover: 'allenWrench-1' });
    expect(other.assembly.crankTarget('allenWrench-1')!.target!.id).toBe(other.inLeg.id);
    expect(inLeg.kind).toBe(KIND.STUD);
  });

  it('has nothing to turn with the key in the only seated end', () => {
    const types = typeById();
    const assembly = createAssembly((id) => types.get(id) ?? id.replace(/-\d+$/, ''));
    assembly.seat({ partA: 'doubleEndedStud-1', connectorA: STUD_IN_TOP, partB: 'top-1', connectorB: 0, mover: 'doubleEndedStud-1' });
    assembly.seat({ partA: 'allenWrench-1', connectorA: 0, partB: 'doubleEndedStud-1', connectorB: HEX_AT_TOP_END, mover: 'allenWrench-1' });
    expect(assembly.crankTarget('allenWrench-1')).toMatchObject({ target: null });
  });
});

describe("a stud's hex as a tool target", () => {
  const hex = { type: CONNECTOR.BOLT_HEAD, part: { id: 'doubleEndedStud-1' } };
  const none = () => null;

  it('is a seat target only once the stud is seated, workable until it is screwed home', () => {
    const types = typeById();
    const assembly = createAssembly((id) => types.get(id)!);
    expect(isSeatTarget(hex, seatedHardware(assembly.all()))).toBe(false);
    const joint = assembly.seat({ partA: 'doubleEndedStud-1', connectorA: 0, partB: 'top-1', connectorB: 0, mover: 'doubleEndedStud-1' });
    expect(isSeatTarget(hex, seatedHardware(assembly.all()))).toBe(true);
    expect(isWorkable(hex, assembly.all(), none)).toBe(true);
    assembly.drive(joint.id);
    expect(isWorkable(hex, assembly.all(), none)).toBe(false);
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
