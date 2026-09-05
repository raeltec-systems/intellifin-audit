import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createDb, createSqlClient } from './client.js';
import { migrateRunsQueue } from '../runs/runs-unit-of-work.js';
import { migrateProceduresQueue } from '../procedures/derivation-queue.js';
import { assertPostgres18, readSchemaVersion } from './compat.js';
import { classifyTelemetryError, sanitizeTelemetryFields } from '../telemetry/sanitize.js';

/**
 * AD-15: the release pipeline's migrator. Web and worker never call this; they only
 * check the schema range and refuse to start outside it.
 *
 * This runs through postgres.js -- the same driver `apps/web` and `apps/worker` use --
 * rather than through `drizzle-kit migrate`, for two reasons:
 *
 *  1. `drizzle-kit migrate` connects with `pg`, which now treats `sslmode=require` as
 *     `verify-full`. Managed PostgreSQL that presents a self-signed certificate (the
 *     Railway image this PoC runs on) is then rejected with SELF_SIGNED_CERT_IN_CHAIN,
 *     even though the running services connect to that same database happily.
 *     postgres.js keeps libpq semantics: `require` encrypts without demanding a chain
 *     it cannot verify.
 *  2. drizzle-kit renders a progress spinner over its own stderr, so the driver's error
 *     never reaches the workflow log. A failed release must say why it failed.
 */

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

function log(level: 'info' | 'error', message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    service: 'migrate',
    message,
    ...sanitizeTelemetryFields(fields),
  });
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export async function runMigrations(databaseUrl: string): Promise<number> {
  const sql = createSqlClient(databaseUrl, { max: 1 });
  try {
    const major = await assertPostgres18(sql);
    log('info', 'Connected', { postgresMajor: major });
    await migrate(createDb(sql), { migrationsFolder: MIGRATIONS_FOLDER });
    await migrateProceduresQueue(createDb(sql));
    await migrateRunsQueue(createDb(sql));
    const version = await readSchemaVersion(sql);
    log('info', 'Migrations applied', { schemaVersion: version });
    return version ?? 0;
  } finally {
    await sql.end({ timeout: 10 });
  }
}

/**
 * `import.meta.main`, never `process.argv[1] === fileURLToPath(import.meta.url)`.
 *
 * Those two are not the same test. `import.meta.url` is the RESOLVED path; `argv[1]` is
 * the path as invoked. Run through a symlink — which is exactly what pnpm's
 * `node_modules` is, and what a `--prod deploy` tree gives you — they differ, the guard
 * is false, and the module loads and does NOTHING while exiting 0. For a release
 * migrator that is a deploy that reports success against an unmigrated database.
 */
const isEntryPoint = import.meta.main;

if (isEntryPoint) {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    log('error', 'Refusing to migrate', { reason: 'DATABASE_URL is required' });
    process.exit(1);
  }
  try {
    await runMigrations(databaseUrl);
  } catch (error) {
    log('error', 'Migration failed', {
      ...classifyTelemetryError(error),
    });
    process.exit(1);
  }
}
