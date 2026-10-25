import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssembly, restoreJoints } from '../src/game/assembly.js';
import { ASSEMBLED, setItem } from '../src/game/item.js';
import { STATE } from '../src/game/fasteners.js';
import type { SavedJoint } from '../src/game/roomSave.js';
import { PLATE_GROOVE_L, RUNNER_END } from './support/railParts.js';
import type { FastenerKind } from '../tools/validate/lib/vocabulary.js';

// restoreJoints (1.9.9.1): a saved joint list goes back through the fastener machine's own
// events, and what lands must equal what was saved. The pairs are the packs' own assembled
// joints, so the connectors and the `through`/`captured` parts are real.

vi.mock('../src/game/item.js', async (original) => (await import('./support/railParts.js')).withRails(await original()));

afterEach(() => setItem('johnny'));

const typeOf = (id: string) => id.replace(/-\d+$/, '');
const fresh = () => createAssembly(typeOf);

/** The first joint of `kind` the current pack assembles, as a saved joint in the given fastener state. */
function saved(kind: FastenerKind, state: SavedJoint['fastener']['state'], progress: number, pick: (j: (typeof ASSEMBLED.joints)[number]) => boolean = () => true): SavedJoint {
  const j = ASSEMBLED.joints.find((c) => c.kind === kind && pick(c));
  if (!j) throw new Error(`no ${kind} joint`);
  return {
    hardware: j.hardware,
    hardwareConnector: j.hardwareConnector,
    host: j.host,
    hostConnector: j.hostConnector,
    kind: j.kind,
    mover: j.mover,
    fastener: { state, progress },
    through: j.through,
    captured: j.captured,
  };
}

const fieldForField = (joints: ReturnType<typeof restoreJoints>): SavedJoint[] =>
  joints.map((j) => ({
    hardware: j.hardware,
    hardwareConnector: j.hardwareConnector,
    host: j.host,
    hostConnector: j.hostConnector,
    kind: j.kind,
    mover: j.mover,
    fastener: { state: j.fastener.state, progress: j.fastener.progress },
    through: j.through,
    captured: j.captured,
  }));

describe('restoreJoints on JOHNNY', () => {
  it('presses a dowel, or leaves it seated', () => {
    const pressed = saved('dowel', STATE.PRESSED, 1);
    const seated = saved('dowel', STATE.SEATED, 0);
    expect(fieldForField(restoreJoints(fresh(), [pressed]))).toEqual([pressed]);
    expect(fieldForField(restoreJoints(fresh(), [seated]))).toEqual([seated]);
  });

  it('presses a back fitting and keeps the part behind it', () => {
    const fitting = saved('fitting', STATE.PRESSED, 1);
    expect(fitting.through).not.toBeNull();
    expect(fieldForField(restoreJoints(fresh(), [fitting]))).toEqual([fitting]);
  });

  it('screws a bolt home, backs it off, or turns it partway in', () => {
    for (const [state, progress] of [
      [STATE.SCREWED, 1],
      [STATE.SCREWED, 0.5],
      [STATE.SEATED, 0.3],
    ] as const) {
      const bolt = saved('bolt', state, progress);
      const [joint] = restoreJoints(fresh(), [bolt]);
      expect(joint.fastener.state).toBe(state);
      expect(joint.fastener.progress).toBeCloseTo(progress, 9);
    }
  });

  const lockedCam = () => {
    const cam = saved('cam', STATE.LOCKED, 1, (j) => j.captured !== null);
    const bolt = saved('bolt', STATE.SCREWED, 1, (j) => j.hardware === cam.captured);
    return { cam, bolt };
  };

  it('locks a cam on the bolt it caught, bolt first', () => {
    const { cam, bolt } = lockedCam();
    expect(fieldForField(restoreJoints(fresh(), [bolt, cam]))).toEqual([bolt, cam]);
  });

  it('locks a cam on its bolt whichever record comes first, and returns them in saved order', () => {
    const { cam, bolt } = lockedCam();
    const joints = restoreJoints(fresh(), [cam, bolt]);
    expect(fieldForField(joints)).toEqual([cam, bolt]);
    expect(joints[0].fastener.state).toBe(STATE.LOCKED);
  });

  it('turns a cam onto nothing: seated at 1, no capture', () => {
    const cam = { ...saved('cam', STATE.SEATED, 1), captured: null };
    expect(fieldForField(restoreJoints(fresh(), [cam]))).toEqual([cam]);
  });

  it('skips a tool joint: not returned, not in the assembly', () => {
    const assembly = fresh();
    const dowel = saved('dowel', STATE.PRESSED, 1);
    const tool: SavedJoint = { ...dowel, kind: 'tool', fastener: { state: STATE.SEATED, progress: 0 } };
    const joints = restoreJoints(assembly, [tool, dowel]);
    expect(joints).toHaveLength(1);
    expect(assembly.all()).toHaveLength(1);
  });

  it('throws naming the joint when the machine cannot land the saved state', () => {
    const lonely = { ...saved('cam', STATE.LOCKED, 1), captured: null };
    expect(() => restoreJoints(fresh(), [lonely])).toThrow(/restore: joint .*→.* landed seated\/1, saved locked\/1/);
  });

  it('throws on a saved state that is not a place its kind can rest', () => {
    const impossible = saved('bolt', STATE.SCREWED, 0);
    expect(() => restoreJoints(fresh(), [impossible])).toThrow(/restore: joint/);
  });
});

describe('restoreJoints on BLANK', () => {
  it('screws a stud home', () => {
    setItem('blank');
    const stud = saved('stud', STATE.SCREWED, 1);
    expect(fieldForField(restoreJoints(fresh(), [stud]))).toEqual([stud]);
  });
});

describe('restoreJoints on OVERKALL', () => {
  it('drives a screw home and keeps the part it passes through', () => {
    setItem('overkall');
    const screw = saved('screw', STATE.SCREWED, 1);
    expect(screw.through).not.toBeNull();
    expect(fieldForField(restoreJoints(fresh(), [screw]))).toEqual([screw]);
  });
});

describe('restoreJoints on a slide', () => {
  const slide = (state: SavedJoint['fastener']['state'], progress: number): SavedJoint => ({
    hardware: 'runner-1',
    hardwareConnector: RUNNER_END,
    host: 'plate-1',
    hostConnector: PLATE_GROOVE_L,
    kind: 'slide',
    mover: 'plate-1',
    fastener: { state, progress },
    through: null,
    captured: null,
  });

  it('keeps a slide on its runners as seat leaves it, with no event', () => {
    const on = slide(STATE.PRESSED, 1);
    const assembly = fresh();
    expect(fieldForField(restoreJoints(assembly, [on]))).toEqual([on]);
    expect(assembly.get(1)!.fastener).toEqual({ kind: 'slide', state: STATE.PRESSED, progress: 1 });
  });

  it('lands a slide pulled off as seated', () => {
    const off = slide(STATE.SEATED, 0);
    expect(fieldForField(restoreJoints(fresh(), [off]))).toEqual([off]);
  });

  it('refuses a slide screwed, naming the joint', () => {
    expect(() => restoreJoints(fresh(), [slide(STATE.SCREWED, 1)])).toThrow('runner-1→plate-1');
  });
});
