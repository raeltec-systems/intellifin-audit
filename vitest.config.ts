import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/** Root unit-test project. Integration tests need a real PostgreSQL 18 and live in
 * `tests/integration` behind their own config, so `pnpm test` stays offline. */
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
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'tests/integration/**'],
    reporters: ['default'],
  },
});
