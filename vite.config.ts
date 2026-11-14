import { defineConfig } from 'vitest/config';

// base './' so the build works from a GitHub Pages project subpath.
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['tests/**/*.test.ts'] },
});
