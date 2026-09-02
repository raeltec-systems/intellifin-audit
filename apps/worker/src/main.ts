import { hostname } from 'node:os';

import { createDb, createSqlClient, loadConfig } from '@intellifin/infrastructure';

import { createHeartbeatLoop, runStartupChecks, type LogLevel } from './startup.js';

/**
 * The worker composition root (AD-1, AD-11).
 *
 * Reads configuration once, runs the AD-11 PostgreSQL-major check and the AD-15
 * schema-range check, and only then starts beating. It never migrates: a database
 * outside the supported range makes the process exit non-zero before any work runs.
 */

/** How often the liveness row is refreshed. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

function log(level: LogLevel, message: string, extra: Record<string, unknown> = {}): void {
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

  // This image is the worker. Started with the web service's environment it would
  // quietly write heartbeats under the wrong identity, so refuse instead.
  if (config.SERVICE_NAME !== 'worker') {
    log('error', 'Refusing to start', {
      reason: `SERVICE_NAME must be "worker" for this process, found "${config.SERVICE_NAME}".`,
    });
    process.exit(1);
  }

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
    await runStartupChecks(config, sql, log);
  } catch {
    // runStartupChecks already logged the refusal, the declared range, and the
    // version it found. Nothing here is recoverable.
    await sql.end({ timeout: 5 }).catch(() => undefined);
    process.exit(1);
  }

  const loop = createHeartbeatLoop(db, host, log);
  await loop.beat();

  // The interval is the process's keep-alive; SIGTERM clears it and the process ends.
  interval = setInterval(() => void loop.beat(), HEARTBEAT_INTERVAL_MS);

  log('info', 'Heartbeat loop started', { hostname: host, intervalMs: HEARTBEAT_INTERVAL_MS });
}

void main().catch((error: unknown) => {
  log('error', 'Fatal worker error', {
    reason: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
