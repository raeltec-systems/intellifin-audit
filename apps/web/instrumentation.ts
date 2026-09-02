import {
  ConfigError,
  UnsupportedDatabaseError,
  UnsupportedSchemaError,
} from '@intellifin/infrastructure';

/**
 * AD-11 and AD-15 run at boot, not lazily on the first request.
 *
 * Next.js calls `register()` once per server process. A permanent refusal — bad
 * configuration, the wrong PostgreSQL major, a schema outside this build's range —
 * exits the process non-zero so the platform sees a failed deploy instead of a
 * container that starts, answers 503, and looks healthy enough to keep.
 *
 * A transient failure (the database is still coming up) is logged and tolerated:
 * the process serves, `/api/health` answers 503, and the next request retries.
 */
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;

  const { getRuntime } = await import('./src/bootstrap');

  try {
    const runtime = await getRuntime();
    process.stdout.write(
      `${JSON.stringify({
        level: 'info',
        time: new Date().toISOString(),
        service: 'web',
        message: 'Startup checks passed',
        postgresMajor: runtime.postgresMajor,
        schemaVersion: runtime.schemaVersion,
        supportedSchemaRange: `${runtime.config.SCHEMA_RANGE_MIN}..${runtime.config.SCHEMA_RANGE_MAX}`,
      })}\n`,
    );
    return;
  } catch (error) {
    const permanent =
      error instanceof ConfigError ||
      error instanceof UnsupportedDatabaseError ||
      error instanceof UnsupportedSchemaError;

    process.stderr.write(
      `${JSON.stringify({
        level: 'error',
        time: new Date().toISOString(),
        service: 'web',
        message: permanent ? 'Refusing to start' : 'Startup checks deferred',
        reason: error instanceof Error ? error.message : String(error),
        supportedSchemaRange:
          error instanceof UnsupportedSchemaError ? error.supportedSchemaRange : null,
        foundSchemaVersion: error instanceof UnsupportedSchemaError ? error.found : null,
        foundPostgresMajor:
          error instanceof UnsupportedDatabaseError ? error.found : null,
      })}\n`,
    );

    if (permanent) {
      process.exit(1);
    }
  }
}
