import { hostname } from 'node:os';

import {
  assertPostgres18,
  assertSchemaSupported,
  createDb,
  createSqlClient,
  loadConfig,
} from '@intellifin/infrastructure';

import { HEARTBEAT_INTERVAL_MS, upsertHeartbeat } from './heartbeat.js';

/**
 * The worker composition root (AD-1, AD-11).
 *
 * Reads configuration once, runs the AD-11 PostgreSQL-major check and the AD-15
 * schema-range check, and only then starts polling. It never migrates: a database
 * outside the supported range makes the process exit non-zero before any work runs.
 */

function log(level: 'info' | 'error', message: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    service: 'worker',
    message,
    ...extra,
  });
  if (level === 'error') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const sql = createSqlClient(config.DATABASE_URL);
  const db = createDb(sql);
  const host = hostname();

  let interval: NodeJS.Timeout | undefined;
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'Shutting down', { signal });
    if (interval) clearInterval(interval);
    await sql.end({ timeout: 5 }).catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    const postgresMajor = await assertPostgres18(sql);
    const schemaVersion = await assertSchemaSupported(
      sql,
      config.SCHEMA_RANGE_MIN,
      config.SCHEMA_RANGE_MAX,
    );
    log('info', 'Startup checks passed', { postgresMajor, schemaVersion });
  } catch (error) {
    log('error', 'Refusing to start', {
      reason: error instanceof Error ? error.message : String(error),
      supportedSchemaRange: `${config.SCHEMA_RANGE_MIN}..${config.SCHEMA_RANGE_MAX}`,
    });
    await sql.end({ timeout: 5 }).catch(() => undefined);
    process.exit(1);
  }

  const beat = async (): Promise<void> => {
    try {
      await upsertHeartbeat(db, host, new Date());
    } catch (error) {
      // A failed beat is logged and retried on the next tick; it never stops the loop.
      log('error', 'Heartbeat upsert failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await beat();
  // The interval is the process's keep-alive; SIGTERM clears it and the process ends.
  interval = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);

  log('info', 'Heartbeat loop started', { hostname: host, intervalMs: HEARTBEAT_INTERVAL_MS });
}

void main().catch((error: unknown) => {
  log('error', 'Fatal worker error', {
    reason: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
