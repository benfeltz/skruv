// The Capacitor shell's buzzer. The web buzzer plays navigator.vibrate, which iOS lacks, so
// the shell would be silent; here each cue (src/game/haptics.ts) plays as one of the haptics
// plugin's impact styles or its success notification. Cues cross this seam, never
// millisecond patterns. The engine spike's grab tick is its ancestor. Loaded by dynamic
// import from src/main.ts only inside the shell, so the web never fetches the plugin.

import { Capacitor } from '@capacitor/core';
import { Haptics as HapticsPlugin, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { nativeFor } from '../game/haptics.js';
import type { Buzzer, Haptics } from '../game/haptics.js';

interface Plugin {
  impact: (style: ImpactStyle) => Promise<void>;
  notify: (type: NotificationType) => Promise<void>;
}

/** A buzzer playing each cue through `impact`/`notify`; a failed haptic is dropped, never surfaced. */
export function createNativeBuzzer({ impact, notify }: Plugin): Buzzer {
  return (cue) => {
    const style = nativeFor(cue);
    if (style === null) return;
    let played: Promise<void>;
    switch (style) {
      case 'light':
        played = impact(ImpactStyle.Light);
        break;
      case 'medium':
        played = impact(ImpactStyle.Medium);
        break;
      case 'heavy':
        played = impact(ImpactStyle.Heavy);
        break;
      case 'success':
        played = notify(NotificationType.Success);
        break;
    }
    played.catch(() => {});
  };
}

/** Plugs the native buzzer into `haptics` inside the shell; false, plugin untouched, anywhere else. */
export async function connectNativeHaptics(haptics: Haptics): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  haptics.setBuzzer(
    createNativeBuzzer({
      impact: (style) => HapticsPlugin.impact({ style }),
      notify: (type) => HapticsPlugin.notification({ type }),
    }),
  );
  return true;
}
