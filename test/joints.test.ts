import { describe, expect, it } from 'vitest';
import { deriveJoints } from '../tools/validate/lib/joints.js';
import { CONTRACT, KIND } from '../tools/validate/lib/vocabulary.js';
import type { AssembledPart, PartType } from '../tools/validate/lib/pack.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';
import type { ConnectorType } from '../tools/validate/lib/vocabulary.js';

const IDENTITY: Quat = [0, 0, 0, 1];
const c = (type: ConnectorType, position: Vec3, axis: Vec3) => ({ type, position, axis });

// Two boards edge to edge along x, a dowel across the seam; a third board holds a bolt
// whose head a cam in the second board's recess can reach.
// Only the geometry deriveJoints reads: no connector ids, part numbers, masses or colors.
const partTypes = {
  board: {
    size: [0.2, 0.02, 0.2],
    connectors: [
      c('dowelHole', [0.1, 0, 0], [1, 0, 0]),
      c('dowelHole', [-0.1, 0, 0], [-1, 0, 0]),
      c('camLockRecess', [0.05, 0.01, 0], [0, 1, 0]),
      c('camBoltHole', [0.05, 0.01, 0.005], [0, 1, 0]),
    ],
  },
  dowel: { size: [0.008, 0.03, 0.008], connectors: [c('dowelEnd', [0, -0.015, 0], [0, -1, 0]), c('dowelEnd', [0, 0.015, 0], [0, 1, 0])] },
  bolt: { size: [0.007, 0.02, 0.007], connectors: [c('boltThread', [0, -0.01, 0], [0, -1, 0]), c('hexSocket', [0, 0.01, 0], [0, 1, 0])] },
  cam: { size: [0.015, 0.012, 0.015], connectors: [c('camLockBody', [0, -0.006, 0], [0, -1, 0]), c('driveSlot', [0, 0.006, 0], [0, 1, 0])] },
} as unknown as Record<string, PartType>;
// Dowel along x: its first end (local -y) turned to point at -x into board-1's +x hole.
const ALONG_X: Quat = [0, 0, -Math.SQRT1_2, Math.SQRT1_2];
const dowelSink = CONTRACT.sinkDepth.dowel!;
function boards(gap = 0): AssembledPart[] {
  return [
    { id: 'board-1', type: 'board', role: 'left', position: [0, 0, 0], rotation: IDENTITY },
    { id: 'board-2', type: 'board', role: 'right', position: [0.2 + gap, 0, 0], rotation: IDENTITY },
    { id: 'dowel-1', type: 'dowel', role: 'hardware', position: [0.1 - dowelSink + 0.015, 0, 0], rotation: ALONG_X },
  ];
}

describe('deriveJoints', () => {
  it('joins a dowel between two panels: pushed into the first, the second pressed onto it', () => {
    const joints = deriveJoints({ partTypes, assembled: boards() });
    expect(joints).toEqual([
      { hardware: 'dowel-1', hardwareConnector: 0, host: 'board-1', hostConnector: 0, kind: KIND.DOWEL, mover: 'dowel-1', through: null, captured: null },
      { hardware: 'dowel-1', hardwareConnector: 1, host: 'board-2', hostConnector: 1, kind: KIND.DOWEL, mover: 'board-2', through: null, captured: null },
    ]);
  });

  it('does not join an end sitting off its seat by more than the reach', () => {
    const joints = deriveJoints({ partTypes, assembled: boards(CONTRACT.mateReach * 2) });
    expect(joints.map((j) => j.host)).toEqual(['board-1']);
  });

  // Board-1's recess at [0.05, 0.01, 0]; its bolt hole beside it, the bolt's head ~1 cm off.
  const bolt = (dz = 0): AssembledPart => ({
    id: 'bolt-1', type: 'bolt', role: 'hardware', position: [0.05, 0.01 - CONTRACT.sinkDepth.bolt! + 0.01, 0.005 + dz], rotation: IDENTITY,
  });
  const cam: AssembledPart = { id: 'cam-1', type: 'cam', role: 'hardware', position: [0.05, 0.01 - CONTRACT.sinkDepth.cam! + 0.006, 0], rotation: IDENTITY };

  it('seats a cam and captures the bolt head within reach', () => {
    const joints = deriveJoints({ partTypes, assembled: [...boards(), bolt(), cam] });
    expect(joints.find((j) => j.kind === KIND.BOLT)).toMatchObject({ hardware: 'bolt-1', host: 'board-1', hostConnector: 3 });
    expect(joints.find((j) => j.kind === KIND.CAM)).toMatchObject({ hardware: 'cam-1', host: 'board-1', hostConnector: 2, captured: 'bolt-1' });
  });

  it('captures nothing when the only bolt is out of reach', () => {
    // The bolt moved along its hole's row: no longer seated, so no head to catch.
    const joints = deriveJoints({ partTypes, assembled: [...boards(), bolt(0.05), cam] });
    expect(joints.find((j) => j.kind === KIND.CAM)!.captured).toBeNull();
  });

  describe('a double-ended stud', () => {
    const studTypes = {
      top: { size: [0.5, 0.05, 0.5], connectors: [c('studHole', [0, -0.025, 0], [0, -1, 0])] },
      leg: { size: [0.05, 0.4, 0.05], connectors: [c('studHole', [0, 0.2, 0], [0, 1, 0])] },
      stud: { size: [0.006, 0.04, 0.006], connectors: [c('studEnd', [0, 0.02, 0], [0, 1, 0]), c('studEnd', [0, -0.02, 0], [0, -1, 0])] },
    } as unknown as Record<string, PartType>;
    const sink = CONTRACT.sinkDepth.stud!;
    // Top at y 0.5 (underside 0.475); its hole's axis points down. The leg hangs below it.
    const top: AssembledPart = { id: 'top-1', type: 'top', role: 'top', position: [0, 0.5, 0], rotation: IDENTITY };
    const leg: AssembledPart = { id: 'leg-1', type: 'leg', role: 'leg', position: [0, 0.475 - 0.2, 0], rotation: IDENTITY };
    const stud: AssembledPart = { id: 'stud-1', type: 'stud', role: 'hardware', position: [0, 0.475, 0], rotation: IDENTITY };

    it('derives one stud joint for an end seated in the top', () => {
      const joints = deriveJoints({ partTypes: studTypes, assembled: [top, { ...stud, position: [0, 0.475 + sink - 0.02, 0] }] });
      expect(joints).toEqual([
        { hardware: 'stud-1', hardwareConnector: 0, host: 'top-1', hostConnector: 0, kind: KIND.STUD, mover: 'stud-1', through: null, captured: null },
      ]);
    });

    it('derives two joints when both ends are seated: the stud moves for the first, the leg for the second', () => {
      const joints = deriveJoints({ partTypes: studTypes, assembled: [top, leg, stud] });
      expect(joints.map((j) => [j.kind, j.hardwareConnector, j.host, j.mover])).toEqual([
        [KIND.STUD, 0, 'top-1', 'stud-1'],
        [KIND.STUD, 1, 'leg-1', 'leg-1'],
      ]);
    });
  });
});
