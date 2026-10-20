import type { CapacitorConfig } from '@capacitor/cli';

// The Capacitor shell (Skruv Capacitor) of the web build at ../web. Bundled mode (default):
// the app serves ../web/dist from capacitor://localhost/. Live reload: set CAP_LIVE_URL to
// the Vite dev server on the LAN (`http://<mac-ip>:5173/`) before `cap sync`, and the shell
// loads that instead — HMR on the phone. Unset it and sync again to go back to the bundled
// build.
const live = process.env.CAP_LIVE_URL;

const config: CapacitorConfig = {
  appId: 'site.skruv.capacitor',
  appName: 'Skruv Capacitor',
  webDir: '../web/dist',
  server: live ? { url: live, cleartext: true } : {},
  ios: {
    // Safari Web Inspector can attach to the shell's WKWebView (overlay dump, console).
    webContentsDebuggingEnabled: true,
  },
};

export default config;
