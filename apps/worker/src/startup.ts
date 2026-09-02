import {
  UnsupportedSchemaError,
  assertPostgres18,
  assertSchemaSupported,
  upsertHeartbeat,
  type AppConfig,
  type Database,
  type Sql,
  type Telemetry,
} from '@intellifin/infrastructure';

/**
 * The worker's startup and loop mechanics, separated from `main.ts` so both can be
 * driven by a fake `sql`/`db` and a captured logger in a unit test. `main.ts` stays
 * a thin composition root: read config, wire, install signal handlers, exit.
 */

export type Logger = Pick<Telemetry, 'info' | 'error' | 'captureError'>;

export interface StartupResult {
  readonly postgresMajor: number;
  readonly schemaVersion: number;
}

/**
 * AD-11 (`server_version` is 18) and AD-15 (the applied schema is inside this
 * build's declared range). Logs the refusal with the declared range and the version
 * actually found, then rethrows so the caller decides how to die. Never migrates.
 */
export async function runStartupChecks(
  config: AppConfig,
  sql: Sql,
  telemetry: Logger,
): Promise<StartupResult> {
  const supportedSchemaRange = `${config.SCHEMA_RANGE_MIN}..${config.SCHEMA_RANGE_MAX}`;
  try {
    const postgresMajor = await assertPostgres18(sql);
    const schemaVersion = await assertSchemaSupported(
      sql,
      config.SCHEMA_RANGE_MIN,
      config.SCHEMA_RANGE_MAX,
    );
    telemetry.info('Startup checks passed', { postgresMajor, schemaVersion, supportedSchemaRange });
    return { postgresMajor, schemaVersion };
  } catch (error) {
    telemetry.captureError('Refusing to start', error, {
      supportedSchemaRange,
      foundSchemaVersion: error instanceof UnsupportedSchemaError ? error.found : null,
    });
    throw error;
  }
}

export interface HeartbeatLoop {
  /** Run one beat. Never throws; a failure is logged and the loop continues. */
  beat: () => Promise<void>;
  /** Beats skipped because the previous one was still running. Test/diagnostic seam. */
  skippedBeats: () => number;
}

/**
 * The liveness loop. A beat that outlives its tick must not overlap the next one:
 * a slow or wedged database would otherwise pile up connections until the pool is
 * exhausted, and a heartbeat that cannot finish is not made truer by starting again.
 */
export function createHeartbeatLoop(db: Database, host: string, telemetry: Logger): HeartbeatLoop {
  let inFlight = false;
  let skipped = 0;

  const beat = async (): Promise<void> => {
    if (inFlight) {
      skipped += 1;
      telemetry.info('Heartbeat skipped', {
        hostname: host,
        skippedBeats: skipped,
      });
      return;
    }

    inFlight = true;
    try {
      await upsertHeartbeat(db, host, new Date());
    } catch (error) {
      // A failed beat is logged and retried on the next tick; it never stops the loop.
      telemetry.captureError('Heartbeat upsert failed', error, {
        hostname: host,
      });
    } finally {
      inFlight = false;
    }
  };

  return { beat, skippedBeats: () => skipped };
}
