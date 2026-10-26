/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The items this build lets you build, comma-separated (src/constants.ts CATALOG.pickable). */
  readonly VITE_PICKABLE?: string;
  /** 'off' builds the Metrics menu row and overlay out (src/main.ts); unset or anything else builds them in. */
  readonly VITE_METRICS?: string;
}
