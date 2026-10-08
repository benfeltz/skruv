import { describe, expect, it } from 'vitest';
import { CONNECTOR } from '../tools/validate/lib/vocabulary.js';
import type { ConnectorType } from '../tools/validate/lib/vocabulary.js';
import { rotateVector } from '../tools/validate/lib/geometry.js';
import { DECAL } from '../src/constants.js';
import { PART_TYPES } from '../src/game/item.js';
import { decalPlacements, socketUnder } from '../src/game/decals.js';

const SOCKETS: ConnectorType[] = [
  CONNECTOR.DOWEL_HOLE,
  CONNECTOR.CAM_BOLT_HOLE,
  CONNECTOR.CAM_LOCK_RECESS,
  CONNECTOR.SHELF_PIN_HOLE,
  CONNECTOR.BACK_FITTING_HOLE,
];

describe('decalPlacements', () => {
  it('marks a side panel dowel hole with a disc on the inner face, facing along its axis', () => {
    const { connectors, size } = PART_TYPES.sidePanel;
    const index = connectors.findIndex((c) => c.type === CONNECTOR.DOWEL_HOLE);
    const decal = decalPlacements(connectors).find((d) => d.index === index)!;
    expect(decal.kind).toBe('hole');
    expect(decal.radius).toBe(DECAL.radius.dowelHole);
    // Inner face is +x, and the disc sits just proud of it.
    expect(decal.position[0]).toBeCloseTo(size[0] / 2 + DECAL.surfaceOffset, 9);
    expect(decal.position.slice(1)).toEqual(connectors[index].position.slice(1));
    rotateVector(decal.rotation, [0, 0, 1]).forEach((v, i) => expect(v).toBeCloseTo(connectors[index].axis[i], 9));
  });

  it('gives fastener ends and hardware-borne sockets no decal', () => {
    for (const type of ['dowel', 'camLockBolt', 'camLock', 'shelfPin', 'backFitting', 'allenWrench', 'screwdriver']) {
      expect(decalPlacements(PART_TYPES[type].connectors)).toEqual([]);
    }
  });

  it('marks a cam lock recess as its own kind', () => {
    const { connectors } = PART_TYPES.topBottomPanel;
    const recesses = decalPlacements(connectors).filter((d) => d.kind === 'recess');
    expect(recesses.length).toBe(connectors.filter((c) => c.type === CONNECTOR.CAM_LOCK_RECESS).length);
    for (const decal of recesses) {
      expect(connectors[decal.index].type).toBe(CONNECTOR.CAM_LOCK_RECESS);
      expect(decal.radius).toBe(DECAL.radius.camLockRecess);
    }
  });

  it('marks every socket on every panel exactly once, facing out of its hole', () => {
    for (const { connectors } of Object.values(PART_TYPES)) {
      const placements = decalPlacements(connectors);
      const sockets = connectors.flatMap((c, i) => (SOCKETS.includes(c.type) ? [i] : []));
      expect(placements.map((d) => d.index)).toEqual(sockets);
      for (const { index, rotation, radius } of placements) {
        expect(radius).toBeGreaterThan(0);
        rotateVector(rotation, [0, 0, 1]).forEach((v, i) => expect(v).toBeCloseTo(connectors[index].axis[i], 9));
      }
    }
  });

  it('turns the decal correctly onto an axis opposite its own normal', () => {
    const [decal] = decalPlacements([{ type: CONNECTOR.BACK_FITTING_HOLE, position: [0, 0, -0.01], axis: [0, 0, -1] }]);
    rotateVector(decal.rotation, [0, 0, 1]).forEach((v, i) => expect(v).toBeCloseTo([0, 0, -1][i], 9));
    expect(decal.position[2]).toBeCloseTo(-0.01 - DECAL.surfaceOffset, 9);
  });
});

describe('socketUnder (drop line over a hole)', () => {
  const a = { id: 'a', position: [0, 0.008, 0] };
  const b = { id: 'b', position: [0.18, 0.008, 0] };

  it('finds the hole the drop line lands on', () => {
    expect(socketUnder([0.004, 0.008, -0.003], [a, b], 0.012)).toBe(a);
    expect(socketUnder([0.175, 0.008, 0.002], [a, b], 0.012)).toBe(b);
  });

  it('finds nothing when the line lands on bare surface', () => {
    expect(socketUnder([0.05, 0.008, 0], [a, b], 0.012)).toBeNull();
    expect(socketUnder([0, 0, 0], [], 0.012)).toBeNull();
  });

  it('picks the nearer of two holes in reach', () => {
    const c = { id: 'c', position: [0.01, 0.008, 0] };
    expect(socketUnder([0.007, 0.008, 0], [a, c], 0.012)).toBe(c);
  });
});
