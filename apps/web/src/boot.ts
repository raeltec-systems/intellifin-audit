import {
  ConfigError,
  UnsupportedDatabaseError,
  UnsupportedSchemaError,
} from '@intellifin/infrastructure';

import { getRuntime } from './bootstrap';
import { telemetry } from './telemetry';

/**
 * The Node.js half of `instrumentation.ts` (AD-11, AD-15).
 *
 * It lives in its own module so that the edge bundle Next builds for `middleware.ts`
 * never contains it. `process.exit`, Pino's stdout stream and postgres.js do not exist
 * on the edge; keeping them behind one dynamic import keeps that bundle honest instead
 * of merely unreachable.
 */
export async function runStartupChecks(): Promise<void> {
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
      supportedSchemaRange: runtime.supportedSchemaRange,
    });
    // Fail-closed is right and it is also indistinguishable, from the surface, from a
    // credential that really is write-capable: both answer "Audit credentials must be
    // read-only." So the deployment says once, here, that it has been told about no
    // credential at all.
    if (runtime.credentialCapabilityCount === 0) {
      telemetry.info('No credential capabilities declared', { configKeys: 'CREDENTIAL_CAPABILITIES' });
    }
    return;
  } catch (error) {
    const permanent =
      error instanceof ConfigError ||
      error instanceof UnsupportedDatabaseError ||
      error instanceof UnsupportedSchemaError;

    telemetry.captureError(permanent ? 'Refusing to start' : 'Startup checks deferred', error, {
      // Names only. Without this the log says "ConfigError" and nothing else.
      configKeys: error instanceof ConfigError ? error.keys : null,
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
