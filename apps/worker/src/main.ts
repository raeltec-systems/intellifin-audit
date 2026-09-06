import { acquirePopulation, executeAdapterSteps, derivePlan, reconcilePlanDerivation, deliverNotifications, stopUnexecutableRun, verifySealedPackage, type PopulationJob } from '@intellifin/application';
import { hostname } from 'node:os';

import {
  ConfigError,
  PostgresPopulationRepository, PostgresAdapterExecutionRepository, PostgresSealedPackageRepository,
  startPopulationWorker, startPopulationRecovery, startEvidenceIntegritySweep, SystemClock,
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
import { HttpAdapterExtraction } from '@intellifin/infrastructure/extraction';
import { ManifestCredentialResolver } from '@intellifin/infrastructure/credentials';

import { adapterExtraction, createHeartbeatLoop, populationExecution, runStartupChecks } from './startup.js';

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
  let stopIntegritySweep: (() => Promise<void>) | undefined;
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
    await stopIntegritySweep?.();
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
  const credentials = adapterExtraction(config);
  if (!credentials.enabled) telemetry.info('Adapter extraction disabled', { reason: credentials.reason });
  if (!evidence.enabled) telemetry.info('Population execution disabled', { reason: evidence.reason });
  // Disabling a capability must also stop the work that depends on it from being STARTED,
  // and the web cannot make that decision: `EVIDENCE_S3_*` and `CREDENTIAL_TOKENS` are the
  // WORKER's environment, so the web's Initiate Run action neither knows nor should guess.
  // The worker therefore ALWAYS consumes the `runs` queue: a queue with no consumer is not
  // a capability that is "off", it is a Run that never moves and never says why.
  const populationRepository = new PostgresPopulationRepository(db);
  const clock = new SystemClock();
  const stoppable = { repository: populationRepository, clock };
  if (evidence.enabled) {
    const store = createS3EvidenceStore(evidence.config);
    const ids = new CryptoUuidV7Generator();
    const population = { repository:populationRepository, acquisition:new HttpPopulationAcquisition(), store, clock, ids };
    const adapterRepository = new PostgresAdapterExecutionRepository(db);
    // The extraction adapter and the resolver are composed HERE and nowhere else: the
    // worker is the only process AD-10 lets make an outbound call to a registered Target
    // System, and the only one that may hold an audit credential at all.
    const http = new HttpAdapterExtraction();
    const adapter = credentials.enabled
      ? { repository:adapterRepository, reference:http, extraction:http,
          credentials:new ManifestCredentialResolver(credentials.credentials), store, clock, ids,
          // Story 3.7. The deployment's Exception fingerprint key, as a port that can USE
          // it — there is no field on it holding the key. There is no evaluation seam to
          // declare here and no corroboration seam either: both are built inside the stage
          // from the plan it is executing and the bytes it just froze, so a composition
          // root cannot register an adapter Observation as unjudged or unevaluated forever.
          exceptions:credentials.exceptions }
      : null;
    // One job carries a Run through both stages. An extraction retry is NOT propagated
    // to the queue: a redelivery re-verifies the population Evidence and can consume one
    // of that stage's four durable attempts, so a transient extraction failure would
    // spend the population's budget. It becomes a RETRY checkpoint instead, which the
    // extraction recovery sweep picks up.
    const handle = async (job: PopulationJob): Promise<{ retry: boolean }> => {
      const acquired = await acquirePopulation(population, job);
      if (acquired.retry) return acquired;
      // Story 3.3's stage cannot run on this deployment. Acknowledging the job here left the
      // Run RUNNING at POPULATION_READY with its Evidence frozen and nothing on either sweep
      // able to select it again — a Run stranded mid-flight, which is worse than one that
      // never started. It is stopped with a named diagnostic instead.
      if (adapter === null) return stopUnexecutableRun(stoppable, job, 'adapter-extraction-unconfigured');
      await executeAdapterSteps(adapter, job);
      return { retry: false };
    };
    await startPopulationWorker(queue,handle);
    stopPopulationRecovery=startPopulationRecovery(db,populationRepository,handle,()=>telemetry.captureError('Fatal worker error',new Error('Population recovery failed'),{}));
    {
      // Its own sweep, on its own read: after POPULATION_READY the population sweep no
      // longer selects the Run, so a stalled extraction would be recovered by nothing. It
      // is installed whether or not extraction is configured, and that is the OTHER half of
      // the gap above: a Run left at POPULATION_READY by an earlier claim, before this
      // process restarted without a credential manifest, is selected by nothing else and
      // would stay RUNNING for ever. With extraction off, the sweep stops it instead.
      const recover = adapter === null
        ? (job: PopulationJob) => stopUnexecutableRun(stoppable, job, 'adapter-extraction-unconfigured')
        : (job: PopulationJob) => executeAdapterSteps(adapter, job);
      const stopAdapterRecovery = startPopulationRecovery(db,adapterRepository,recover,()=>telemetry.captureError('Fatal worker error',new Error('Adapter recovery failed'),{}));
      const stopPopulation = stopPopulationRecovery;
      stopPopulationRecovery = async () => { await stopAdapterRecovery(); await stopPopulation(); };
    }
    // The post-Run integrity check, given a caller at last (Story 3.5). `verifySealedPackage`
    // shipped with tests and nothing in the product calling it, so an object deleted or
    // altered after a Run terminated was never detected while the Run page went on saying
    // "registered and verified" in the present tense. Its own bounded read, its own rotating
    // cursor, and it changes no Run state, no seal and no artifact — the context it is handed
    // has no writer for any of them.
    const sealed = new PostgresSealedPackageRepository(db);
    stopIntegritySweep = startEvidenceIntegritySweep(
      sealed,
      (runId) => verifySealedPackage({ repository: sealed, store, clock, ids }, runId),
      () => telemetry.captureError('Fatal worker error', new Error('Evidence integrity sweep failed'), {}),
    );
  } else {
    // No object storage, so no Run can be executed at all — but the queue is still
    // consumed. A Run is stopped `RUN_FAILED` with a diagnostic an operator can act on and
    // an auditor can rerun from, rather than left QUEUED with nothing said about it. No
    // recovery sweep is installed: answering a job dispatched to this worker is one thing,
    // and going looking for work it cannot do is another.
    await startPopulationWorker(queue, (job: PopulationJob) =>
      stopUnexecutableRun(stoppable, job, 'evidence-store-unconfigured'),
    );
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
