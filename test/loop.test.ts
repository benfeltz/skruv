import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoop } from '../src/scene/loop.js';

type Loop = ReturnType<typeof createLoop>;

// Manual rAF: frames only run when the test calls runFrame().
let pending: Map<number, FrameRequestCallback>;
let nextId: number;

beforeEach(() => {
  pending = new Map();
  nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function runFrame(time: number) {
  const callbacks = [...pending.values()];
  pending.clear();
  for (const cb of callbacks) cb(time);
}

describe('createLoop', () => {
  it('calls onFrame each frame with the clamped delta in seconds', () => {
    const onFrame = vi.fn();
    createLoop(onFrame).start();
    runFrame(1000);
    runFrame(1016);
    runFrame(5000);
    expect(onFrame).toHaveBeenCalledTimes(3);
    expect(onFrame.mock.calls[0][0]).toBe(0);
    expect(onFrame.mock.calls[1][0]).toBeCloseTo(0.016);
    expect(onFrame.mock.calls[2][0]).toBeLessThan(1);
  });

  it('passes the true delta alongside the clamped one, for frame-rate measurement', () => {
    const onFrame = vi.fn();
    createLoop(onFrame).start();
    runFrame(1000);
    runFrame(1100);
    expect(onFrame.mock.calls[1][1]).toBeCloseTo(0.1);
    expect(onFrame.mock.calls[1][0]).toBeLessThan(0.1);
  });

  it('stops when stop() is called from inside onFrame', () => {
    let loop: Loop;
    const onFrame = vi.fn(() => loop.stop());
    loop = createLoop(onFrame);
    loop.start();
    runFrame(0);
    runFrame(16);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(0);
  });

  it('keeps a single loop when stop() then start() run inside onFrame', () => {
    let loop: Loop;
    const onFrame = vi.fn(() => {
      loop.stop();
      loop.start();
    });
    loop = createLoop(onFrame);
    loop.start();
    runFrame(0);
    expect(pending.size).toBe(1);
  });
});
