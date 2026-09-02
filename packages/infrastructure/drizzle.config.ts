import { defineConfig } from 'drizzle-kit';

/**
 * AD-8 / AD-15: migrations are explicit, reviewed SQL files. `drizzle-kit migrate`
 * is invoked only by the release workflow and by CI against a throwaway database --
 * never by `apps/web` or `apps/worker` at startup.
 *
 * `DATABASE_URL` is required rather than defaulted. An empty credential silently
 * sends drizzle-kit at whatever a bare libpq connection resolves to, which during a
 * release is exactly the wrong database to guess at.
 */
const databaseUrl = process.env['DATABASE_URL'];

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for drizzle-kit');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: databaseUrl,
  },
});
