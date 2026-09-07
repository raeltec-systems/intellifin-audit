import { canExecuteWithoutAuditCredentials, executeEvaluationReviewCommand, acquirePopulation, executeAgentWorkItem, raiseEscalation, executeAdapterSteps, executeAgentSteps, derivePlan, provisionWorkspace, releaseWorkspace, reconcilePlanDerivation, stopUnexecutableRun, verifySealedPackage, type PopulationJob } from '@intellifin/application';
import { hostname } from 'node:os';

import {
  ConfigError,
  createExceptionFingerprinter, PostgresEvaluationReviewRepository, startEvaluationReviewWorker, startEvaluationReviewRecovery,
  PostgresWaitRepository, startWaitWorker, startWaitRecovery,
  PostgresAgentWorkRepository, PostgresPopulationRepository, PostgresAdapterExecutionRepository, PostgresAgentExecutionRepository, PostgresSealedPackageRepository,
  startPopulationWorker, startPopulationRecovery, startEvidenceIntegritySweep, startWorkspaceReaper,
  PostgresWorkspaceRepository, SystemClock,
  DrizzleNotificationRepository, InAppNotificationSender, startNotificationWorker,
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
import { PlaywrightBrowserExecution } from '@intellifin/infrastructure/browser';

import { adapterExtraction, agentExecution, agentModel, agentWorkspace, createHeartbeatLoop, populationExecution, runStartupChecks } from './startup.js';

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
  let stopNotificationDelivery: (() => Promise<void>) | undefined;
  let stopReviewRecovery: (() => Promise<void>) | undefined;
  let stopWaitRecovery: (() => Promise<void>) | undefined;
  let stopRecovery: (() => void) | undefined;
  let stopPopulationRecovery: (() => Promise<void>) | undefined;
  let stopIntegritySweep: (() => Promise<void>) | undefined;
  let stopWorkspaceReaper: (() => Promise<void>) | undefined;
  let closeBrowsers: (() => Promise<void>) | undefined;
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    telemetry.info('Shutting down', { signal });
    if (interval) clearInterval(interval);
    await stopNotificationDelivery?.();
    stopRecovery?.();
    await stopWaitRecovery?.();
    await stopReviewRecovery?.();
    await stopPopulationRecovery?.();
    await stopIntegritySweep?.();
    await stopWorkspaceReaper?.();
    // `solari.close()` is REQUIRED in Node and `browser.close()` is not enough: the client
    // keeps a loopback proxy server open for its connection-retry path, and that handle
    // keeps the event loop alive. A worker that closes only its browsers never exits.
    await closeBrowsers?.().catch(() => undefined);
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

  // The Agent Workspace (Story 4.1, AD-4). Composed HERE and nowhere else: the worker is
  // the only process that may drive a browser against a registered Target System, and the
  // only one that may hold the provider's API key at all — `no-browser-execution-in-web`
  // fails the build on any import of this module from the web.
  //
  // It is never disabled. Unlike population execution and adapter extraction, a workspace
  // does not need anything a deployment might not have provisioned: the local mode is the
  // same code path against a locally launched Chromium. What differs is the GUARANTEE, and
  // that is said once here and recorded on every workspace row.
  const provider = agentWorkspace(config);
  const browser = new PlaywrightBrowserExecution(provider.connection);
  closeBrowsers = () => browser.close();
  const workspace = {
    repository: new PostgresWorkspaceRepository(db),
    browser,
    clock: new SystemClock(),
    ids: new CryptoUuidV7Generator(),
  };
  telemetry.info('Agent Workspace mode selected', { mode: provider.connection.mode, reason: provider.reason });
  // NFR-5: a workspace whose Run has already ended and which nothing gave back. A release
  // is network I/O, so it cannot happen inside the transaction that ends the Run; a worker
  // that dies between the two leaves a browser held by nobody and, under Solari, a pool
  // slot held until the provider's own grace timer reaps it. Its own bounded read, one Run
  // at a time, stopping cleanly — the third sweep of that shape.
  stopWorkspaceReaper = startWorkspaceReaper(
    workspace.repository,
    (runId) => releaseWorkspace(workspace, runId),
    () => telemetry.captureError('Fatal worker error', new Error('Workspace reaper failed'), {}),
  );

  const evidence = populationExecution(config);
  const credentials = adapterExtraction(config);
  const agentCapability = agentExecution(config);
  const executionCapability = credentials.enabled ? credentials : agentCapability;
  if (!credentials.enabled) telemetry.info('Adapter extraction disabled', { reason: credentials.reason });
  if (!evidence.enabled) telemetry.info('Population execution disabled', { reason: evidence.reason });
  // Disabling a capability must also stop the work that depends on it from being STARTED,
  // and the web cannot make that decision: `EVIDENCE_S3_*` and `CREDENTIAL_TOKENS` are the
  // WORKER's environment, so the web's Initiate Run action neither knows nor should guess.
  // The worker therefore ALWAYS consumes the `runs` queue: a queue with no consumer is not
  // a capability that is "off", it is a Run that never moves and never says why.
  const populationRepository = new PostgresPopulationRepository(db);
  const clock = new SystemClock();
  const waits = new PostgresWaitRepository(db);
  await startWaitWorker(queue, waits, clock);
  stopWaitRecovery = startWaitRecovery(waits, clock, () => telemetry.error('Wait recovery failed'));
  // Human review is durable worker work even when acquisition or browser credentials
  // are unavailable. Only this process owns the fingerprint closure; the web enqueues
  // an actor-bound command and reports it as pending until this transaction commits.
  const reviewRepository = new PostgresEvaluationReviewRepository(db, {
    exceptions: config.EXCEPTION_FINGERPRINT_KEY === undefined ? undefined : createExceptionFingerprinter({
      keyId: config.EXCEPTION_FINGERPRINT_KEY_ID,
      key: config.EXCEPTION_FINGERPRINT_KEY,
    }),
  });
  const review = { repository: reviewRepository, clock, ids: new CryptoUuidV7Generator() };
  await startEvaluationReviewWorker(queue, (job) => executeEvaluationReviewCommand(review, job.commandId));
  stopReviewRecovery = startEvaluationReviewRecovery(db, () => telemetry.captureError('Fatal worker error', new Error('Evaluation review recovery failed'), {}));
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
    const adapter = executionCapability.enabled
      ? { repository:adapterRepository, reference:http, extraction:http,
          credentials:new ManifestCredentialResolver(executionCapability.credentials), store, clock, ids,
          // Story 3.7. The deployment's Exception fingerprint key, as a port that can USE
          // it — there is no field on it holding the key. There is no evaluation seam to
          // declare here and no corroboration seam either: both are built inside the stage
          // from the plan it is executing and the bytes it just froze, so a composition
          // root cannot register an adapter Observation as unjudged or unevaluated forever.
          exceptions:executionCapability.exceptions }
      : null;
    // One job carries a Run through both stages. An extraction retry is NOT propagated
    // to the queue: a redelivery re-verifies the population Evidence and can consume one
    // of that stage's four durable attempts, so a transient extraction failure would
    // spend the population's budget. It becomes a RETRY checkpoint instead, which the
    // extraction recovery sweep picks up.
    // Agent execution reuses the existing stage ports. The frozen public P-4 contract
    // can run with an empty credential manifest; every other plan retains the strict
    // adapter capability gate before authentication or extraction begins.
    const agentRepository = new PostgresAgentExecutionRepository(db);
    const agent = executionCapability.enabled
      ? {
          repository: agentRepository,
          browser,
          credentials: new ManifestCredentialResolver(executionCapability.credentials),
          clock,
          ids,
        }
      : null;
    const signIn = async (job: PopulationJob, workspaceReplaced = false): Promise<{ proceed: boolean }> => {
      if (!credentials.enabled && agent !== null) {
        // A missing audit credential manifest cannot disable an explicitly public P-4
        // target. This narrow exception is derived from the validated frozen plan, never
        // current registration state or retrieved page claims. All other plans retain
        // the existing named configuration refusal, including recovery deliveries.
        const publicPlan = await agentRepository.transaction(job.runId, async context =>
          canExecuteWithoutAuditCredentials(await context.frozenPlan()));
        if (!publicPlan) {
          await stopUnexecutableRun(stoppable, job, 'adapter-extraction-unconfigured');
          return { proceed: false };
        }
      }
      return agent === null ? { proceed: true }
        : executeAgentSteps(agent, job, { forceReauthentication: workspaceReplaced });
    };
    const workRepository = new PostgresAgentWorkRepository(db);
    const work = adapter === null ? null : {
      repository: workRepository, browser, model: agentModel(config), store, clock, ids,
      credentials: adapter.credentials, exceptions: adapter.exceptions,
      waits: { raiseEscalation: (input: Parameters<typeof raiseEscalation>[1]) => raiseEscalation({ repository: waits, clock, ids }, input) },
    };
    const inspect = async (job: PopulationJob): Promise<{ retry: boolean }> => {
      try {
        return work === null
          ? await stopUnexecutableRun(stoppable, job, 'adapter-extraction-unconfigured')
          : await executeAgentWorkItem(work, job);
      } finally {
        await releaseWorkspace(workspace, job.runId).catch(() =>
          telemetry.captureError('Fatal worker error', new Error('Workspace release failed'), {}));
      }
    };
    const handle = async (job: PopulationJob): Promise<{ retry: boolean }> => {
      // The FROZEN plan decides whether this Run gets a workspace at all: `create-workspace`
      // is emitted first exactly when a selected Target System is web or desktop, so an
      // adapter-only Run reaches nothing and is unchanged by Story 4.1.
      const provisioned = await provisionWorkspace(workspace, job);
      // A provisioning failure that has already exhausted the Session Step budget left the
      // Run `RUN_FAILED`, and `acquirePopulation` declines a Run in that state, so this
      // returns without a second branch saying the same thing.
      if (provisioned.retry) return { retry: true };
      try {
        const acquired = await acquirePopulation(population, job);
        if (acquired.retry) return acquired;
        // Story 3.3's stage cannot run on this deployment. Acknowledging the job here left
        // the Run RUNNING at POPULATION_READY with its Evidence frozen and nothing on either
        // sweep able to select it again — a Run stranded mid-flight, which is worse than one
        // that never started. It is stopped with a named diagnostic instead. The `finally`
        // below still gives the workspace back.
        if (adapter === null) return stopUnexecutableRun(stoppable, job, 'adapter-extraction-unconfigured');
        // Sign-in comes AFTER the population and BEFORE any Work Item, which is the order
        // the compiler froze. `proceed` is false while the agent phase is still working:
        // going on would hand the Run to a stage that refuses an agent plan by name and
        // would end a Run whose workspace and Target System were both healthy.
        if (!(await signIn(job, provisioned.workspaceReplaced === true)).proceed) return { retry: false };
        await executeAdapterSteps(adapter, job);
        return inspect(job);
      } finally {
        // Released at the Run's end. `releaseWorkspace` takes the whole decision from the
        // durable row inside a transaction, so this is a no-op for a Run still in flight and
        // for every Run that never had a workspace. The reaper is the backstop for a worker
        // that dies before reaching here.
        await releaseWorkspace(workspace, job.runId).catch(() =>
          telemetry.captureError('Fatal worker error', new Error('Workspace release failed'), {}),
        );
      }
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
        : async (job: PopulationJob) => {
            // A durable sign-in checkpoint cannot authenticate a replacement browser.
            // Recover provider identity first; only confirmed release/expiry allows a
            // replacement, which must repeat the approved access phase.
            const provisioned = await provisionWorkspace(workspace, job);
            if (provisioned.retry) return { retry: true };
            if (!(await signIn(job, provisioned.workspaceReplaced === true)).proceed) return { retry: false };
            await executeAdapterSteps(adapter, job);
            return inspect(job);
          };
      const stopAdapterRecovery = startPopulationRecovery(db,adapterRepository,recover,()=>telemetry.captureError('Fatal worker error',new Error('Adapter recovery failed'),{}));
      // And the agent phase's own, for the same reason one layer earlier: a sign-in that
      // wrote a RETRY checkpoint is deliberately not asking the queue for a redelivery,
      // because that would spend one of the population stage's four durable attempts.
      const stopAgentRecovery = startPopulationRecovery(db,agentRepository,job=>recover(job),()=>telemetry.captureError('Fatal worker error',new Error('Agent recovery failed'),{}));
      const stopWorkRecovery = startPopulationRecovery(db,workRepository,job=>recover(job),()=>telemetry.captureError('Fatal worker error',new Error('Agent work recovery failed'),{}));
      const stopPopulation = stopPopulationRecovery;
      stopPopulationRecovery = async () => { await stopWorkRecovery(); await stopAgentRecovery(); await stopAdapterRecovery(); await stopPopulation(); };
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
  stopNotificationDelivery = startNotificationWorker(
    notifications, sender,
    error => telemetry.captureError('Notification delivery failed', error, {}),
  );
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
