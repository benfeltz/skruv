import { defineConfig } from 'vitest/config';

// The suite is the repo's, not the web app's, so it does not ride on web/vite.config.ts.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
