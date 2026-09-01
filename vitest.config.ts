import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@dae/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@dae/device-catalog': resolve(__dirname, 'packages/device-catalog/src/index.ts'),
      '@dae/engine': resolve(__dirname, 'packages/engine/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'apps/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    environmentMatchGlobs: [['apps/web/**', 'jsdom']],
  },
});
