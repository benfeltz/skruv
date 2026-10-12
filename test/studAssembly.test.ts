import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { FASTENER } from '../src/constants.js';
import { createAssembly, seatHome } from '../src/game/assembly.js';
import { STATE } from '../src/game/fasteners.js';
import { ASSEMBLED, setItem } from '../src/game/item.js';
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
