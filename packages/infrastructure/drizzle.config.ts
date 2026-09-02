import { defineConfig } from 'drizzle-kit';

/**
 * AD-8 / AD-15: migrations are explicit, reviewed SQL files. `drizzle-kit migrate`
 * is invoked only by the release workflow and by CI against a throwaway database —
 * never by `apps/web` or `apps/worker` at startup.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? '',
  },
});
