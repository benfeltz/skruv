import { Capacitor } from '@capacitor/core';
import { EVENT } from '../game/events.js';
import type { Bus } from '../game/events.js';

// Engine spike 1.2 (branch-local): a native haptic tick on every grab, through the
// Capacitor bridge. Loaded only under ?spike=assembled.

/**
 * In the native shell, ticks `@capacitor/haptics` on each grab and reports the grab →
 * bridge-resolved round trip (ms, the grab event's own timestamp to the impact call's
 * return) to `onRoundTrip`. Off the native shell it does nothing and never loads the plugin
 * — the one sanctioned guard: the plugin's web fallback would buzz Android browsers.
 */
export function connectSpikeHaptics({ events, onRoundTrip }: { events: Bus; onRoundTrip: (ms: number) => void }) {
  if (!Capacitor.isNativePlatform()) return;
  const plugin = import('@capacitor/haptics');
  events.on(EVENT.GRAB, ({ t }) => {
    plugin
      .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Medium }))
      .then(() => onRoundTrip(performance.now() - t));
  });
}
