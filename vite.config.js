import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the project at /skruv/ — without this every asset 404s.
  base: '/skruv/',
  test: {
    include: ['test/**/*.test.js'],
  },
});
