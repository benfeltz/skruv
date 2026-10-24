import { describe, expect, it } from 'vitest';
import { FAN } from '../src/constants.js';
import { fanLabel, pressOutcome, rowLength, spineEdges } from '../src/game/manualFan.js';

// 1.9.9.3, option B: the pocket's model, headless — the spine's edges, the row's length, the name.

describe("the spine's edges", () => {
  const room = 26;

  it('is empty with no world, and centres a lone edge', () => {
    expect(spineEdges(0, room, FAN)).toEqual([]);
    expect(spineEdges(1, room, FAN)).toEqual([(room - FAN.edge) / 2]);
  });

  it('steps the edges edgeStep apart while they fit, centred, in the room\'s order', () => {
    const [a, b] = spineEdges(2, room, FAN);
    expect(b - a).toBe(FAN.edgeStep);
    expect(a + (b + FAN.edge - a) / 2).toBeCloseTo(room / 2);
  });

  it('closes them up when the spine is too narrow, never past its sides', () => {
    for (const count of [3, 5, 12]) {
      const edges = spineEdges(count, room, FAN);
      expect(edges).toHaveLength(count);
      expect(edges[0]).toBeGreaterThanOrEqual(FAN.edgePad - 1e-9);
      expect(edges.at(-1)! + FAN.edge).toBeLessThanOrEqual(room - FAN.edgePad + 1e-9);
      for (let i = 1; i < count; i++) expect(edges[i]).toBeGreaterThan(edges[i - 1]);
    }
  });
});

describe('the row', () => {
  it('is a pitch per cover, no gap past the ends', () => {
    expect(rowLength(0, FAN)).toBe(0);
    expect(rowLength(1, FAN)).toBe(FAN.cover);
    expect(rowLength(3, FAN)).toBe(3 * FAN.cover + 2 * FAN.gap);
    // Pitch 64 (Ben's spec, 2026-10-23).
    expect(FAN.cover + FAN.gap).toBe(64);
  });

  it('names the pocket by its count', () => {
    expect(fanLabel(1)).toBe('1 manual in the room');
    expect(fanLabel(3)).toBe('3 manuals in the room');
  });
});

describe('a press on a cover', () => {
  const t = { tapMaxMs: 350, tapMaxDistance: 10, holdMs: 900 };
  const at = (heldMs: number, distance = 0) => pressOutcome({ heldMs, distance }, t);

  it('is a tap through the tap time, a cancel after it, a clear at the hold', () => {
    expect(at(0)).toBe('tap');
    expect(at(t.tapMaxMs)).toBe('tap');
    expect(at(t.tapMaxMs + 1)).toBe('cancel');
    expect(at(t.holdMs - 1)).toBe('cancel');
    expect(at(t.holdMs)).toBe('clear');
  });

  it('is none past the tap distance, whatever the time', () => {
    for (const ms of [0, t.tapMaxMs, t.tapMaxMs + 1, t.holdMs, t.holdMs * 2]) expect(at(ms, t.tapMaxDistance + 1)).toBe('none');
    expect(at(0, t.tapMaxDistance)).toBe('tap');
  });
});
