import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

/**
 * Integration tests run against a real PostgreSQL 18 (AD-12). They require
 * `DATABASE_URL` and a database the release/CI migration job has already migrated —
 * these tests never migrate, exactly as the processes never do (AD-15).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@intellifin/domain': pkg('domain'),
      '@intellifin/application': pkg('application'),
      '@intellifin/infrastructure': pkg('infrastructure'),
    },
  },
  test: {
    environment: 'node',
    root: fileURLToPath(new URL('../../', import.meta.url)),
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    reporters: ['default'],
  },
});
