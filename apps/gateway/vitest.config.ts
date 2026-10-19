import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@urumi/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  // PGlite (WASM Postgres) start-up plus argon2 work take several seconds per test when files run in
  // parallel; the 5 s / 10 s defaults time out under load, not on a hang.
  test: { include: ['test/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 30_000 },
});
