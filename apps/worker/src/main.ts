import { acquirePopulation, derivePlan, reconcilePlanDerivation, deliverNotifications } from '@intellifin/application';
import { hostname } from 'node:os';

import {
  ConfigError,
  PostgresPopulationRepository, startPopulationWorker, startPopulationRecovery, SystemClock,
  DrizzleNotificationRepository, InAppNotificationSender,
  createProceduresQueue, startProceduresWorker, startProceduresRecovery, createModelGateway, DrizzleProcedureRepository, PostgresProceduresUnitOfWork, CryptoUuidV7Generator,
  createDb,
  createSqlClient,
  createTelemetry,
  loadConfig,
} from '@intellifin/infrastructure';

// Not from the barrel: both make or hold the outbound side of an acquisition, and the
// web imports that barrel. See packages/infrastructure/src/index.ts.
import { HttpPopulationAcquisition } from '@intellifin/infrastructure/acquisition';
import { createS3EvidenceStore } from '@intellifin/infrastructure/evidence';

import { createHeartbeatLoop, populationExecution, runStartupChecks } from './startup.js';

/**
 * The worker composition root (AD-1, AD-11).
 *
 * Reads configuration once, runs the AD-11 PostgreSQL-major check and the AD-15
 * schema-range check, and only then starts beating. It never migrates: a database
 * outside the supported range makes the process exit non-zero before any work runs.
 */

/** How often the liveness row is refreshed. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

const telemetry = createTelemetry({ serviceName: 'worker' });

async function main(): Promise<void> {
  const config = loadConfig();
  telemetry.configureLevel(config.LOG_LEVEL);
  telemetry.configureSentry({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT,
    tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,
  });

  // This image is the worker. Started with the web service's environment it would
  // quietly write heartbeats under the wrong identity, so refuse instead.
  if (config.SERVICE_NAME !== 'worker') {
    telemetry.captureError(
      'Refusing to start',
      new ConfigError(['SERVICE_NAME: must be "worker" for this process']),
      { configKeys: 'SERVICE_NAME' },
    );
    process.exit(1);
  }

  const sql = createSqlClient(config.DATABASE_URL);
  const db = createDb(sql);
  const host = hostname();
  const queue = createProceduresQueue(db);
  queue.on('error', (error) => telemetry.captureError('Plan derivation queue failed', error, {}));

  let interval: NodeJS.Timeout | undefined;
  let notificationInterval: NodeJS.Timeout | undefined;
  let notificationDelivery: Promise<void> | undefined;
  let stopRecovery: (() => void) | undefined;
  let stopPopulationRecovery: (() => Promise<void>) | undefined;
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    telemetry.info('Shutting down', { signal });
    if (interval) clearInterval(interval);
    if (notificationInterval) clearInterval(notificationInterval);
    await notificationDelivery;
    stopRecovery?.();
    await stopPopulationRecovery?.();
    await queue.stop().catch(() => undefined);
    await sql.end({ timeout: 5 }).catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await runStartupChecks(sql, telemetry);
  } catch {
    // runStartupChecks already logged the refusal, the declared range, and the
    // version it found. Nothing here is recoverable.
    await queue.stop().catch(() => undefined);
    await sql.end({ timeout: 5 }).catch(() => undefined);
    process.exit(1);
  }

  const model = createModelGateway(config);
  const derivation = { repository: new DrizzleProcedureRepository(db), unitOfWork: new PostgresProceduresUnitOfWork(db), ids: new CryptoUuidV7Generator(), clock: { now: () => new Date() }, model };
  await startProceduresWorker(queue, (job, delivery) => derivePlan(derivation, job, delivery));
  stopRecovery = await startProceduresRecovery(db, (job) => reconcilePlanDerivation(derivation, job),
    () => telemetry.captureError('Plan derivation queue failed', new Error('Plan recovery failed'), {}));

  const evidence = populationExecution(config);
  if (evidence.enabled) {
    const populationRepository = new PostgresPopulationRepository(db);
    const population = { repository:populationRepository, acquisition:new HttpPopulationAcquisition(), store:createS3EvidenceStore(evidence.config), clock:new SystemClock(), ids:new CryptoUuidV7Generator() };
    await startPopulationWorker(queue,job=>acquirePopulation(population,job));
    stopPopulationRecovery=startPopulationRecovery(db,populationRepository,job=>acquirePopulation(population,job),()=>telemetry.captureError('Fatal worker error',new Error('Population recovery failed'),{}));
  } else {
    telemetry.info('Population execution disabled', { reason: evidence.reason });
  }

  const loop = createHeartbeatLoop(db, host, telemetry);
  const notifications = new DrizzleNotificationRepository(db);
  const sender = new InAppNotificationSender(db);
  const deliver = () => {
    if (notificationDelivery) return;
    notificationDelivery = deliverNotifications(notifications, sender)
      .catch(error => telemetry.captureError('Notification delivery failed', error, {}))
      .finally(() => { notificationDelivery = undefined; });
  };
  deliver();
  notificationInterval = setInterval(deliver, 1000);
  await loop.beat();

  // The interval is the process's keep-alive; SIGTERM clears it and the process ends.
  interval = setInterval(() => void loop.beat(), HEARTBEAT_INTERVAL_MS);

  telemetry.info('Heartbeat loop started', { hostname: host, intervalMs: HEARTBEAT_INTERVAL_MS });
}

void main().catch((error: unknown) => {
  // `loadConfig` throws before telemetry is configured, so a bad environment reaches
  // here. Name the variables that failed; sanitized telemetry drops the message.
  telemetry.captureError('Fatal worker error', error, {
    configKeys: error instanceof ConfigError ? error.keys : null,
  });
  process.exit(1);
});
