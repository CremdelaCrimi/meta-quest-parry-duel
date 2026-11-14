import { defineConfig } from 'vitest/config';

// base './' so the build works from a GitHub Pages project subpath.
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 800 },
  test: { include: ['tests/**/*.test.ts'] },
});
