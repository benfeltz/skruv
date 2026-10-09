import type { CapacitorConfig } from '@capacitor/cli';

// Engine spike 1.2 (branch-local, never merges): the root Vite build in an iOS shell.
// Bundled mode (default): the app serves ../../dist from capacitor://localhost/, and that
// scheme alone opens the spike slice (src/game/spikeAssembled.ts — appStartPath is a file
// path in bundled mode, so it can't carry the query). Live reload: set CAP_LIVE_URL to the
// Vite dev server on the LAN, query included (`http://<mac-ip>:5173/?spike=assembled`),
// before `cap sync ios`, and the shell loads that instead — HMR on the phone. Unset it and
// sync again to go back to the bundled build.
const live = process.env.CAP_LIVE_URL;

const config: CapacitorConfig = {
  appId: 'site.skruv.spike',
  appName: 'Skruv Spike',
  webDir: '../../dist',
  server: live ? { url: live, cleartext: true } : {},
  ios: {
    // Safari Web Inspector can attach to the shell's WKWebView (overlay dump, console).
    webContentsDebuggingEnabled: true,
  },
};

export default config;
