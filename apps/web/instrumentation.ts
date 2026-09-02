import {
  ConfigError,
  UnsupportedDatabaseError,
  UnsupportedSchemaError,
  createTelemetry,
} from '@intellifin/infrastructure';

const telemetry = createTelemetry({ serviceName: 'web' });

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
    telemetry.configureLevel(runtime.config.LOG_LEVEL);
    telemetry.configureSentry({
      dsn: runtime.config.SENTRY_DSN,
      environment: runtime.config.SENTRY_ENVIRONMENT,
      tracesSampleRate: runtime.config.SENTRY_TRACES_SAMPLE_RATE,
    });
    telemetry.info('Startup checks passed', {
      postgresMajor: runtime.postgresMajor,
      schemaVersion: runtime.schemaVersion,
      supportedSchemaRange: `${runtime.config.SCHEMA_RANGE_MIN}..${runtime.config.SCHEMA_RANGE_MAX}`,
    });
    return;
  } catch (error) {
    const permanent =
      error instanceof ConfigError ||
      error instanceof UnsupportedDatabaseError ||
      error instanceof UnsupportedSchemaError;

    telemetry.captureError(permanent ? 'Refusing to start' : 'Startup checks deferred', error, {
      supportedSchemaRange:
        error instanceof UnsupportedSchemaError ? error.supportedSchemaRange : null,
      foundSchemaVersion: error instanceof UnsupportedSchemaError ? error.found : null,
      foundPostgresMajor: error instanceof UnsupportedDatabaseError ? error.found : null,
    });

    if (permanent) {
      process.exit(1);
    }
  }
}
