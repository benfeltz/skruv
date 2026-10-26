import { describe, expect, it } from 'vitest';
import type { ConnectorType } from '../tools/validate/lib/vocabulary.js';
import { areCompatible, COMPATIBLE, CONNECTOR, CONTRACT, isFastenerEnd, KIND, kindOf, passesThrough } from '../tools/validate/lib/vocabulary.js';

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

  it('sinks every fastener kind but the tool and the slide', () => {
    for (const kind of Object.values(KIND).filter((k) => k !== KIND.TOOL && k !== KIND.SLIDE)) expect(CONTRACT.sinkDepth[kind]).toBeGreaterThan(0);
    expect(CONTRACT.sinkDepth).not.toHaveProperty(KIND.TOOL);
    expect(CONTRACT.sinkDepth).not.toHaveProperty(KIND.SLIDE);
  });

  it('pairs a stud end with a stud hole, both ways, and runs the stud machine', () => {
    expect(kindOf(CONNECTOR.STUD_END)).toBe(KIND.STUD);
    expect(areCompatible(CONNECTOR.STUD_END, CONNECTOR.STUD_HOLE)).toBe(true);
    expect(areCompatible(CONNECTOR.STUD_HOLE, CONNECTOR.STUD_END)).toBe(true);
    expect(areCompatible(CONNECTOR.STUD_END, CONNECTOR.DOWEL_HOLE)).toBe(false);
    expect(CONTRACT.sinkDepth.stud).toBeGreaterThan(0);
  });

  it('pairs a screw thread with a screw hole, both ways, and runs the screw machine', () => {
    expect(kindOf(CONNECTOR.SCREW_THREAD)).toBe(KIND.SCREW);
    expect(areCompatible(CONNECTOR.SCREW_THREAD, CONNECTOR.SCREW_HOLE)).toBe(true);
    expect(areCompatible(CONNECTOR.SCREW_HOLE, CONNECTOR.SCREW_THREAD)).toBe(true);
    expect(areCompatible(CONNECTOR.SCREW_THREAD, CONNECTOR.STUD_HOLE)).toBe(false);
    expect(CONTRACT.sinkDepth.screw).toBeGreaterThan(0);
  });

  it('pairs a rail end with a groove as the sliding fit', () => {
    expect(areCompatible(CONNECTOR.RAIL_END, CONNECTOR.RAIL_GROOVE)).toBe(true);
    expect(areCompatible(CONNECTOR.RAIL_GROOVE, CONNECTOR.RAIL_END)).toBe(true);
    expect(kindOf(CONNECTOR.RAIL_END)).toBe(KIND.SLIDE);
    expect(isFastenerEnd(CONNECTOR.RAIL_END)).toBe(true);
    expect(isFastenerEnd(CONNECTOR.RAIL_GROOVE)).toBe(false);
    expect(passesThrough(KIND.SLIDE)).toBe(false);
  });

  it('passes through to the part behind for a fitting and a screw only', () => {
    expect(Object.values(KIND).filter(passesThrough)).toEqual([KIND.FITTING, KIND.SCREW]);
  });

  it('pairs within reach, and checks far tighter than it pairs', () => {
    expect(CONTRACT.mateTolerance).toBeLessThan(CONTRACT.mateReach);
    expect(CONTRACT.mateReach).toBeLessThan(CONTRACT.captureRadius);
  });
});
