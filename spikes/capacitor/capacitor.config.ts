import type { CapacitorConfig } from '@capacitor/cli';

// Engine spike 1.2 (branch-local, never merges): the root Vite build in an iOS shell.
// Bundled mode (default): the app serves ../../dist from inside the bundle and opens the
// spike slice. Live reload: set CAP_LIVE_URL to the Vite dev server on the LAN
// (`http://<mac-ip>:5173`) before `cap sync ios`, and the shell loads that instead — HMR
// on the phone. Unset it and sync again to go back to the bundled build.
const live = process.env.CAP_LIVE_URL;

const config: CapacitorConfig = {
  appId: 'site.skruv.spike',
  appName: 'Skruv Spike',
  webDir: '../../dist',
  server: {
    // Boots straight into the measured slice; the plain URL stays the teaser.
    appStartPath: '/?spike=assembled',
    ...(live ? { url: live, cleartext: true } : {}),
  },
  ios: {
    // Safari Web Inspector can attach to the shell's WKWebView (overlay dump, console).
    webContentsDebuggingEnabled: true,
  },
};

export default config;
