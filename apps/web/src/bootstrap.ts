import {
  ConfigError,
  UnsupportedDatabaseError,
  UnsupportedSchemaError,
  SUPPORTED_SCHEMA_RANGE,
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
 * check, and it never migrates. `instrumentation.ts` drives it at boot so the
 * process refuses to come up misconfigured rather than discovering it on a request.
 */

export interface WebRuntime {
  readonly config: AppConfig;
  readonly sql: Sql;
  readonly schemaVersion: number;
  readonly postgresMajor: number;
  /** The range this build accepts, for logging. Fixed by the build, never by the environment. */
  readonly supportedSchemaRange: string;
}

let runtimePromise: Promise<WebRuntime> | undefined;

/**
 * A refusal this build will give identically forever: the environment is wrong, the
 * server is the wrong major, or the schema is outside the supported range. Retrying
 * cannot change any of them, so the answer is cached.
 *
 * Everything else — a connection reset, a database still starting, a network blip —
 * is transient and must NOT be cached, or one unlucky first request would wedge the
 * process into permanent 503s.
 */
export function isPermanentRefusal(error: unknown): boolean {
  return (
    error instanceof ConfigError ||
    error instanceof UnsupportedDatabaseError ||
    error instanceof UnsupportedSchemaError
  );
}

async function start(): Promise<WebRuntime> {
  const config = loadConfig();

  // This image is the web service. Started with the worker's environment it would
  // serve health checks for a process that is not the one being checked.
  if (config.SERVICE_NAME !== 'web') {
    throw new ConfigError([
      `SERVICE_NAME: must be "web" for this process, found "${config.SERVICE_NAME}"`,
    ]);
  }

  const sql = createSqlClient(config.DATABASE_URL);

  try {
    const postgresMajor = await assertPostgres18(sql);
    const schemaVersion = await assertSchemaSupported(sql);
    return {
      config,
      sql,
      schemaVersion,
      postgresMajor,
      supportedSchemaRange: SUPPORTED_SCHEMA_RANGE,
    };
  } catch (error) {
    await sql.end({ timeout: 5 }).catch(() => undefined);
    throw error;
  }
}

/**
 * Resolve the started runtime. A success and a permanent refusal are both cached;
 * a transient failure is forgotten so the next request tries again.
 */
export function getRuntime(): Promise<WebRuntime> {
  if (runtimePromise) return runtimePromise;

  const attempt: Promise<WebRuntime> = start().catch((error: unknown) => {
    if (!isPermanentRefusal(error) && runtimePromise === attempt) {
      runtimePromise = undefined;
    }
    throw error;
  });

  runtimePromise = attempt;
  return attempt;
}

/** Test seam: forget the cached runtime so the next call re-runs the asserts. */
export function resetRuntimeForTests(): void {
  runtimePromise = undefined;
}
