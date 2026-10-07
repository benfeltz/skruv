import { describe, expect, it } from 'vitest';
import { createSessionBuffer, SESSION_FORMAT } from '../src/game/sessionBuffer.js';

const event = (seq) => ({ type: 'reset', t: seq * 10, seq });

describe('createSessionBuffer', () => {
  it('lists events oldest first before it fills', () => {
    const buffer = createSessionBuffer({ size: 3, session: 's', startedAt: 'x' });
    buffer.push(event(0));
    buffer.push(event(1));
    expect(buffer.events().map((e) => e.seq)).toEqual([0, 1]);
  });

  it('wraps: keeps the latest `size`, oldest first, and counts what it dropped', () => {
    const buffer = createSessionBuffer({ size: 3, session: 's', startedAt: 'x' });
    for (let i = 0; i < 7; i++) buffer.push(event(i));
    expect(buffer.events().map((e) => e.seq)).toEqual([4, 5, 6]);
    expect(buffer.toExport().dropped).toBe(4);
  });

  it('exports a stable document shape', () => {
    const buffer = createSessionBuffer({ size: 2, session: 'abc', startedAt: '2026-10-05T18:00:00.000Z' });
    buffer.push(event(0));
    const doc = JSON.parse(buffer.toExportJson());
    expect(Object.keys(doc)).toEqual(['format', 'session', 'startedAt', 'dropped', 'events']);
    expect(doc).toEqual({
      format: SESSION_FORMAT,
      session: 'abc',
      startedAt: '2026-10-05T18:00:00.000Z',
      dropped: 0,
      events: [event(0)],
    });
  });

  it('exactly full is not truncated', () => {
    const buffer = createSessionBuffer({ size: 2, session: 's', startedAt: 'x' });
    buffer.push(event(0));
    buffer.push(event(1));
    expect(buffer.events().map((e) => e.seq)).toEqual([0, 1]);
    expect(buffer.toExport().dropped).toBe(0);
  });
});
