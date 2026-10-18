import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESET } from '../src/constants.js';
import { createResetButton } from '../src/ui/resetButton.js';
import { FakeElement, installFakeDom } from './support/fakeDom.js';

// 1.9.7.1.1 (phone finding): Repack is a press-and-hold with a bar that fills inside the
// button; it never grows or relabels. Driven on the fake DOM with fake timers; how the hold
// feels under a thumb is the phone pass.
beforeEach(() => {
  installFakeDom();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount() {
  const onReset = vi.fn();
  const reset = createResetButton({ onReset });
  const element = reset.element as unknown as FakeElement;
  const [fill, label] = element.children;
  return { reset, element, fill, label, onReset };
}

describe('the repack button', () => {
  it('does nothing on a tap that is let go early', () => {
    const { element, onReset } = mount();
    element.fire('pointerdown');
    vi.advanceTimersByTime(RESET.holdMs - 1);
    element.fire('pointerup');
    vi.advanceTimersByTime(RESET.holdMs);
    expect(onReset).not.toHaveBeenCalled();
  });

  it('repacks once when a hold reaches RESET.holdMs, and empties the bar', () => {
    const { element, fill, onReset } = mount();
    element.fire('pointerdown');
    expect(element.dataset.holding).toBe('true');
    expect(fill.style.transition).toBe(`width ${RESET.holdMs}ms linear`);
    expect(fill.style.width).not.toBe('0');
    vi.advanceTimersByTime(RESET.holdMs);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(element.dataset.holding).toBe('false');
    expect(fill.style.width).toBe('0');
    vi.advanceTimersByTime(RESET.holdMs * 2);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('empties the bar and repacks nothing when the press ends, leaves the button, is cancelled or the menu cancels it', () => {
    for (const end of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) {
      const { element, fill, onReset } = mount();
      element.fire('pointerdown');
      element.fire(end);
      vi.advanceTimersByTime(RESET.holdMs * 2);
      expect(onReset, end).not.toHaveBeenCalled();
      expect(fill.style.width, end).toBe('0');
    }
    const { reset, element, onReset } = mount();
    element.fire('pointerdown');
    reset.cancel();
    vi.advanceTimersByTime(RESET.holdMs * 2);
    expect(onReset).not.toHaveBeenCalled();
  });

  it('ignores a secondary mouse button, and a second pointerdown mid-hold does not restart it', () => {
    const { element, onReset } = mount();
    element.fire('pointerdown', { button: 2 });
    vi.advanceTimersByTime(RESET.holdMs * 2);
    expect(onReset).not.toHaveBeenCalled();
    element.fire('pointerdown');
    vi.advanceTimersByTime(RESET.holdMs / 2);
    element.fire('pointerdown');
    vi.advanceTimersByTime(RESET.holdMs / 2);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('holds from the keyboard too: Enter or Space held, released early cancels', () => {
    const { element, onReset } = mount();
    const press = (key: string, repeat = false) => (element.fire as (t: string, i: object) => void)('keydown', { key, repeat });
    press('Enter');
    element.fire('keyup');
    vi.advanceTimersByTime(RESET.holdMs * 2);
    expect(onReset).not.toHaveBeenCalled();
    press(' ');
    press(' ', true);
    vi.advanceTimersByTime(RESET.holdMs);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('never relabels or grows: one fixed label, no armed state', () => {
    const { element, label } = mount();
    element.fire('pointerdown');
    expect(label.textContent).toBe('Repack');
    expect(element.dataset.armed).toBeUndefined();
    vi.advanceTimersByTime(RESET.holdMs);
    expect(label.textContent).toBe('Repack');
  });

  it('stays in an open menu on a tap (menuStay), and swallows the long-press context menu', () => {
    const { element } = mount();
    expect(element.dataset.menuStay).toBe('true');
    const preventDefault = vi.fn();
    element.fire('contextmenu', { preventDefault } as never);
    expect(preventDefault).toHaveBeenCalled();
  });
});
