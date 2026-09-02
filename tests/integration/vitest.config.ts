import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

/** Subpath exports resolve to source too; without this they fall back to an unbuilt `dist`. */
const sub = (path: string) =>
  fileURLToPath(new URL(`../../packages/${path}.ts`, import.meta.url));

/**
 * Integration tests run against a real PostgreSQL 18 (AD-12). They require
 * `DATABASE_URL` and a database the release/CI migration job has already migrated —
 * these tests never migrate, exactly as the processes never do (AD-15).
 *
 * Locally, a missing `DATABASE_URL` skips them. In CI it must not: a silent skip
 * would report a green pipeline that proved nothing about the database at all.
 */
export default defineConfig(() => {
  if (process.env['CI'] && !process.env['DATABASE_URL']) {
    throw new Error(
      'DATABASE_URL is required to run the integration suite in CI. ' +
        'Without it every test skips and the job reports green having verified nothing.',
    );
  }

  return {
    resolve: {
      alias: {
        '@intellifin/domain': pkg('domain'),
        '@intellifin/application': pkg('application'),
        '@intellifin/infrastructure/migrate': sub('infrastructure/src/db/migrate'),
        '@intellifin/infrastructure/db': sub('infrastructure/src/db/index'),
        '@intellifin/infrastructure/probe-runner': sub('infrastructure/src/registrations/probe-runner'),
        '@intellifin/infrastructure/probe': sub('infrastructure/src/registrations/probe'),
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
  };
});
