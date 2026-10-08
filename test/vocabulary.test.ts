import { describe, expect, it } from 'vitest';
import type { ConnectorType } from '../tools/validate/lib/vocabulary.js';
import { areCompatible, COMPATIBLE, CONNECTOR, CONTRACT, isFastenerEnd, KIND, kindOf } from '../tools/validate/lib/vocabulary.js';

describe('Flatpack vocabulary', () => {
  it('freezes every name table and the contract', () => {
    for (const table of [CONNECTOR, COMPATIBLE, KIND, CONTRACT, CONTRACT.sinkDepth]) expect(Object.isFrozen(table)).toBe(true);
  });

  it('pairs only known connector types', () => {
    const known: Set<string> = new Set(Object.values(CONNECTOR));
    for (const [end, hole] of Object.entries(COMPATIBLE)) {
      expect(known.has(end)).toBe(true);
      expect(known.has(hole)).toBe(true);
    }
  });

  it('matches compatibility symmetrically', () => {
    for (const a of Object.values(CONNECTOR)) {
      for (const b of Object.values(CONNECTOR)) expect(areCompatible(a, b)).toBe(areCompatible(b, a));
    }
    expect(areCompatible(CONNECTOR.DOWEL_HOLE, CONNECTOR.DOWEL_END)).toBe(true);
    expect(areCompatible(CONNECTOR.DOWEL_HOLE, CONNECTOR.PIN_TIP)).toBe(false);
  });

  it('names a fastener kind for every fastener end, and none for a hole', () => {
    for (const end of Object.keys(COMPATIBLE) as ConnectorType[]) {
      expect(isFastenerEnd(end)).toBe(true);
      expect(Object.values(KIND)).toContain(kindOf(end));
    }
    for (const hole of Object.values(COMPATIBLE)) {
      expect(isFastenerEnd(hole)).toBe(false);
      expect(kindOf(hole)).toBeNull();
    }
  });

  it('sinks every fastener kind but the tool', () => {
    for (const kind of Object.values(KIND).filter((k) => k !== KIND.TOOL)) expect(CONTRACT.sinkDepth[kind]).toBeGreaterThan(0);
    expect(CONTRACT.sinkDepth).not.toHaveProperty(KIND.TOOL);
  });

  it('pairs within reach, and checks far tighter than it pairs', () => {
    expect(CONTRACT.mateTolerance).toBeLessThan(CONTRACT.mateReach);
    expect(CONTRACT.mateReach).toBeLessThan(CONTRACT.captureRadius);
  });
});
