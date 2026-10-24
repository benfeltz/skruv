import { afterEach, describe, expect, it } from 'vitest';
import { ImpactStyle, NotificationType } from '@capacitor/haptics';
import { HAPTICS } from '../src/constants.js';
import { CUE } from '../src/game/haptics.js';
import { createNativeBuzzer } from '../src/shell/capacitorHaptics.js';

// The shell's buzzer, on fake plugin calls: the plugin itself is device-only.

const defaults = { ...HAPTICS };
afterEach(() => Object.assign(HAPTICS, defaults));

function fakes() {
  const calls: unknown[] = [];
  return {
    calls,
    impact: async (style: ImpactStyle) => void calls.push(['impact', style]),
    notify: async (type: NotificationType) => void calls.push(['notify', type]),
  };
}

describe('createNativeBuzzer', () => {
  it('plays a seat as a light impact and a lock as a heavy one', () => {
    const f = fakes();
    const buzz = createNativeBuzzer(f);
    buzz(CUE.SEAT);
    expect(f.calls).toEqual([['impact', ImpactStyle.Light]]);
    buzz(CUE.LOCK);
    expect(f.calls.at(-1)).toEqual(['impact', ImpactStyle.Heavy]);
  });

  it('plays a bolt home as the success notification, no impact', () => {
    const f = fakes();
    createNativeBuzzer(f)(CUE.HOME);
    expect(f.calls).toEqual([['notify', NotificationType.Success]]);
  });

  it('is silent for a cue whose knob is 0', () => {
    HAPTICS.tickMs = 0;
    const f = fakes();
    createNativeBuzzer(f)(CUE.TICK);
    expect(f.calls).toEqual([]);
  });

  it('swallows a rejected plugin call', async () => {
    const buzz = createNativeBuzzer({ impact: () => Promise.reject(new Error('no bridge')), notify: async () => {} });
    expect(() => buzz(CUE.SEAT)).not.toThrow();
    await Promise.resolve();
  });
});
