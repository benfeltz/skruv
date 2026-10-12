/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The items this build lets you build, comma-separated (src/constants.ts CATALOG.pickable). */
  readonly VITE_PICKABLE?: string;
}
