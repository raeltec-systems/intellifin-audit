import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/** Subpath exports resolve to source too; without this they fall back to an unbuilt `dist`. */
const sub = (path: string) =>
  fileURLToPath(new URL(`./packages/${path}.ts`, import.meta.url));

/** Root unit-test project. Integration tests need a real PostgreSQL 18 and live in
 * `tests/integration` behind their own config, so `pnpm test` stays offline. */
export default defineConfig({
  // Next preserves JSX for its own compiler; SSR unit tests need an actual transform.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@intellifin/domain': pkg('domain'),
      '@intellifin/application': pkg('application'),
      '@intellifin/infrastructure/migrate': sub('infrastructure/src/db/migrate'),
      '@intellifin/infrastructure/db': sub('infrastructure/src/db/index'),
      '@intellifin/infrastructure/probe-runner': sub('infrastructure/src/registrations/probe-runner'),
      '@intellifin/infrastructure/probe': sub('infrastructure/src/registrations/probe'),
      '@intellifin/infrastructure/acquisition': sub('infrastructure/src/runs/population-acquisition-http'),
      '@intellifin/infrastructure/evidence': sub('infrastructure/src/evidence/s3-evidence-store'),
      '@intellifin/infrastructure': pkg('infrastructure'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/**/src/**/*.test.ts',
      // Next's app router puts route handlers and Server Actions under `app/`, not
      // `src/`. A Server Action is its own POST endpoint and needs its own test, so
      // that folder is part of the unit suite too. `.ts` only: this project runs in the
      // `node` environment with no DOM, so a `.test.tsx` here could not render anything
      // — a glob that cannot match is a promise of coverage that does not exist.
      'apps/**/app/**/*.test.ts',
      'tests/unit/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'tests/integration/**'],
    reporters: ['default'],
  },
});
