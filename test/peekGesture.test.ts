import { describe, expect, it } from 'vitest';
import { GESTURE } from '../src/constants.js';
import { peekNext } from '../src/game/peekGesture.js';
import type { PeekEvent, PeekState } from '../src/game/peekGesture.js';

const run = (events: PeekEvent[], from: PeekState = 'idle') => events.reduce((state, event) => peekNext(state, event, GESTURE.tapMaxDistance), from);

describe('the peek state machine', () => {
  it('a press that rests past the delay peeks, and its release ends it', () => {
    expect(run([{ type: 'press' }])).toBe('pressing');
    expect(run([{ type: 'press' }, { type: 'delay' }])).toBe('peeking');
    expect(run([{ type: 'press' }, { type: 'delay' }, { type: 'release' }])).toBe('idle');
  });

  it('a press released before the delay never peeks, and the late delay is ignored', () => {
    expect(run([{ type: 'press' }, { type: 'release' }])).toBe('idle');
    expect(run([{ type: 'press' }, { type: 'release' }, { type: 'delay' }])).toBe('idle');
  });

  it('a touch that moves past the tap distance first is a swipe, never a peek', () => {
    const swipe: PeekEvent[] = [{ type: 'press' }, { type: 'move', distance: GESTURE.tapMaxDistance + 1 }];
    expect(run(swipe)).toBe('idle');
    expect(run([...swipe, { type: 'delay' }])).toBe('idle');
  });

  it('wobble inside the tap distance does not cancel the peek', () => {
    expect(run([{ type: 'press' }, { type: 'move', distance: GESTURE.tapMaxDistance }, { type: 'delay' }])).toBe('peeking');
  });

  it('once peeking, the finger moving changes nothing — only the release does', () => {
    expect(run([{ type: 'move', distance: 500 }], 'peeking')).toBe('peeking');
    expect(run([{ type: 'release' }], 'peeking')).toBe('idle');
  });

  it('idle ignores everything but a press', () => {
    expect(run([{ type: 'move', distance: 500 }, { type: 'delay' }, { type: 'release' }])).toBe('idle');
  });
});
