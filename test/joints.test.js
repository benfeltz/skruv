import { describe, expect, it } from 'vitest';
import { deriveJoints } from '../tools/validate/lib/joints.js';
import { CONTRACT, KIND } from '../tools/validate/lib/vocabulary.js';

const IDENTITY = [0, 0, 0, 1];
const c = (type, position, axis) => ({ type, position, axis });

// Two boards edge to edge along x, a dowel across the seam; a third board holds a bolt
// whose head a cam in the second board's recess can reach.
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
  bolt: { size: [0.007, 0.02, 0.007], connectors: [c('boltThread', [0, -0.01, 0], [0, -1, 0]), c('boltHead', [0, 0.01, 0], [0, 1, 0])] },
  cam: { size: [0.015, 0.012, 0.015], connectors: [c('camLockBody', [0, -0.006, 0], [0, -1, 0]), c('camSlot', [0, 0.006, 0], [0, 1, 0])] },
};
// Dowel along x: its first end (local -y) turned to point at -x into board-1's +x hole.
const ALONG_X = [0, 0, -Math.SQRT1_2, Math.SQRT1_2];
const dowelSink = CONTRACT.sinkDepth.dowel;
function boards(gap = 0) {
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
  const bolt = (dz = 0) => ({
    id: 'bolt-1', type: 'bolt', role: 'hardware', position: [0.05, 0.01 - CONTRACT.sinkDepth.bolt + 0.01, 0.005 + dz], rotation: IDENTITY,
  });
  const cam = { id: 'cam-1', type: 'cam', role: 'hardware', position: [0.05, 0.01 - CONTRACT.sinkDepth.cam + 0.006, 0], rotation: IDENTITY };

  it('seats a cam and captures the bolt head within reach', () => {
    const joints = deriveJoints({ partTypes, assembled: [...boards(), bolt(), cam] });
    expect(joints.find((j) => j.kind === KIND.BOLT)).toMatchObject({ hardware: 'bolt-1', host: 'board-1', hostConnector: 3 });
    expect(joints.find((j) => j.kind === KIND.CAM)).toMatchObject({ hardware: 'cam-1', host: 'board-1', hostConnector: 2, captured: 'bolt-1' });
  });

  it('captures nothing when the only bolt is out of reach', () => {
    // The bolt moved along its hole's row: no longer seated, so no head to catch.
    const joints = deriveJoints({ partTypes, assembled: [...boards(), bolt(0.05), cam] });
    expect(joints.find((j) => j.kind === KIND.CAM).captured).toBeNull();
  });
});
