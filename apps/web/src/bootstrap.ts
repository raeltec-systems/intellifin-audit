import {
  assertPostgres18,
  assertSchemaSupported,
  createSqlClient,
  loadConfig,
  type AppConfig,
  type Sql,
} from '@intellifin/infrastructure';

/**
 * The web composition root (AD-1, AD-11).
 *
 * This is the only place in `apps/web` that reads configuration or opens a database
 * connection. It runs the AD-11 PostgreSQL-major check and the AD-15 schema-range
 * check once, on the first request, and caches the outcome. It never migrates.
 *
 * A failed check is cached as a rejection so the process reports the same refusal
 * on every subsequent request rather than silently serving.
 */

export interface WebRuntime {
  readonly config: AppConfig;
  readonly sql: Sql;
  readonly schemaVersion: number;
  readonly postgresMajor: number;
}

let runtimePromise: Promise<WebRuntime> | undefined;

async function start(): Promise<WebRuntime> {
  const config = loadConfig();
  const sql = createSqlClient(config.DATABASE_URL);

  try {
    const postgresMajor = await assertPostgres18(sql);
    const schemaVersion = await assertSchemaSupported(
      sql,
      config.SCHEMA_RANGE_MIN,
      config.SCHEMA_RANGE_MAX,
    );
    return { config, sql, schemaVersion, postgresMajor };
  } catch (error) {
    await sql.end({ timeout: 5 }).catch(() => undefined);
    throw error;
  }
}

/** Resolve the started runtime, running the startup asserts exactly once. */
export function getRuntime(): Promise<WebRuntime> {
  runtimePromise ??= start();
  return runtimePromise;
}

/** Test seam: forget the cached runtime so the next call re-runs the asserts. */
export function resetRuntimeForTests(): void {
  runtimePromise = undefined;
}
