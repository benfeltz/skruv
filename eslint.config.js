import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The recommended sets only, flat config. A rule the tree genuinely fights is turned off
// here with a one-line reason — never with an inline disable.
export default defineConfig(
  // Engine spike 1.2 (branch-local): the shell's generated iOS project carries a copy of
  // dist/ (gitignored) — built output, not source. Its capacitor.config.ts stays linted.
  { ignores: ['dist/', '**/node_modules/', 'spikes/capacitor/ios/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  // The game runs in the browser.
  { files: ['src/**'], languageOptions: { globals: globals.browser } },
  // Tests, tools and configs run in Node.
  { files: ['test/**', 'tools/**', '*.config.{js,ts}'], languageOptions: { globals: globals.node } },
  // The test fake DOM walks parent chains starting from `this` — a cursor, not an alias.
  { files: ['test/bookletSplash.test.ts'], rules: { '@typescript-eslint/no-this-alias': 'off' } },
);
