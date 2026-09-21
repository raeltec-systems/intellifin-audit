import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { BrowserContext, Page } from '@playwright/test';
import { cancelRun, performCancellation, NO_CREDENTIALS, type WorkspacePreviewMetadata } from '@intellifin/application';
import { registrationDigest, snapshotFromRegistration } from '@intellifin/domain';
import { createDb, createSqlClient, CryptoUuidV7Generator, PostgresProceduresUnitOfWork,
  DrizzleRoleRepository, PostgresRunCancellationRepository, PostgresRunsUnitOfWork,
  PostgresWorkspacePreviewStore, SystemClock } from '@intellifin/infrastructure';
import { PlaywrightBrowserExecution } from '@intellifin/infrastructure/browser';
import { ManifestCredentialResolver } from '@intellifin/infrastructure/credentials';
import { startWorkspacePreviewBroker } from '@intellifin/infrastructure/workspace-preview-broker';
import { activeRunVersion } from './active-run-version';
import { executablePlanInputs } from './executable-plan';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export interface ScreenshotMeasurement {
  kind: 'preview' | 'registered'; startedAt: number; completedAt: number;
  digest: string; bytes: number; page: Page;
}
interface LiveObservation { page: Page; context: BrowserContext }

/** Real compiled adapter/broker, real local Chromium, and real PostgreSQL. No model,
 * provider, alternate action implementation, fake timer, or substituted frame bytes.
 * Reflection is observation-only except delaying completion of the real screenshot.
 */
export async function createPreviewBrowserFixture(actorEmail: string) {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for preview browser proof');
  const targetDb = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(targetDb.hostname)
    || !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(targetDb.pathname.slice(1)))
    throw new Error('Preview proof requires an isolated local/CI test database');
  const secret = process.env['WORKSPACE_PREVIEW_SECRET'];
  const port = Number(process.env['WORKSPACE_PREVIEW_PORT'] ?? '4311');
  if (process.env['WORKSPACE_PREVIEW_MODE'] !== 'synthetic-local' || !secret || secret.length < 32
    || !Number.isInteger(port) || port < 1 || port > 65535 || process.env['NODE_ENV'] === 'production')
    throw new Error('Configure synthetic-local preview and the web/broker shared secret/port');
  if (['SOLARI_API_KEY', 'MODEL_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'].some(key => process.env[key]))
    throw new Error('Unset provider/model credentials before the loopback-only preview proof');

  const cleanup: Array<() => Promise<unknown>> = [];
  const close = async () => {
    const errors: unknown[] = [];
    for (const action of cleanup.splice(0).reverse()) {
      try { await action(); } catch (error) { errors.push(error); }
    }
    return errors;
  };
  const sql = createSqlClient(databaseUrl, { max: 8 });
  cleanup.push(() => sql.end({ timeout: 5 }));
  try {
    const db = createDb(sql), ids = new CryptoUuidV7Generator();
    const [actor] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email=${actorEmail}`;
    if (!actor) throw new Error('Seed the synthetic auditor before preview proof');
    const actorId = actor.id, runId = ids.next(), procedureId = ids.next(), versionId = ids.next();
    const originalSessions = await sql<{ id: string }[]>`SELECT id FROM auth_session WHERE user_id=${actorId}`;
    let disposableSessionId: string | undefined;
    // Restore revocations even after an assertion fails. These are existing synthetic accounts.
    cleanup.push(async () => {
      await sql`UPDATE user_role SET role='auditor' WHERE user_id=${actorId}`;
      if (disposableSessionId) await sql`DELETE FROM auth_session WHERE id=${disposableSessionId}`;
    });
    cleanup.push(async () => {
      await sql.begin(async tx => {
        await tx`DELETE FROM notification WHERE run_id=${runId}`;
        await tx`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
        await tx`DELETE FROM run_result WHERE run_id=${runId}`;
        await tx`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await tx`DELETE FROM run_execution WHERE run_id=${runId}`;
        await tx`DELETE FROM population_execution WHERE run_id=${runId}`;
        await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
      });
      await sql`DELETE FROM procedure_version WHERE version_id=${versionId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
    });
    const at = new Date().toISOString(), until = new Date(Date.now() + 3_600_000).toISOString();

    const token = `synthetic-preview-${randomUUID()}`;
    const credentialRef = 'cred://synthetic/preview-proof';
    const resolver = new ManifestCredentialResolver(new Map([[credentialRef, token]]));
    const requests: Array<{ method: string; path: string; authenticated: boolean }> = [];
    let loginGate: ReturnType<typeof deferred<void>> | null = null;
    let loginArrived: ReturnType<typeof deferred<void>> | null = null;
    let successfulPosts = 0;
    const target = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const authenticated = request.headers.cookie?.includes('preview-session=accepted') === true;
      requests.push({ method: request.method ?? 'GET', path: url.pathname, authenticated });
      response.setHeader('cache-control', 'no-store');
      if (request.method === 'POST' && url.pathname === '/target/sign-in') {
        let body = '';
        for await (const chunk of request) { body += String(chunk); if (body.length > 4096) break; }
        if (new URLSearchParams(body).get('credential') !== token) { response.writeHead(401); response.end(); return; }
        body = ''; successfulPosts++;
        loginArrived?.resolve();
        await loginGate?.promise;
        response.writeHead(303, { location: '/target/account', 'set-cookie': 'preview-session=accepted; Path=/; HttpOnly; SameSite=Lax' });
        response.end(); return;
      }
      response.setHeader('content-type', 'text/html; charset=utf-8');
      if (url.pathname !== '/target/public' && !authenticated) {
        response.end('<!doctype html><title>Private sign-in</title><link rel="icon" href="data:,"><form method="post" action="/target/sign-in"><label>Stored credential<input type="password" name="credential"></label><button type="submit">Sign in</button></form>'); return;
      }
      response.end(`<!doctype html><title>Exact agent Page</title><link rel="icon" href="data:,"><style>body{background:#d8edf7;color:#132e43;font:24px sans-serif}#marker{padding:32px;border:8px solid #267754}</style>
        ${authenticated ? '<p role="status" aria-label="Current signed-in account">Signed in as audit.readonly</p>' : ''}
        <div id="marker">Synthetic agent workspace ${runId}<br>Frame clock <span id="clock"></span></div>
        <script>setInterval(()=>document.getElementById('clock').textContent=String(Date.now()),100)</script>`);
    });
    await new Promise<void>((resolve, reject) => { target.once('error', reject); target.listen(0, '127.0.0.1', resolve); });
    cleanup.push(async () => {
      loginGate?.resolve();
      await new Promise<void>((resolve, reject) => { target.close(error => error ? reject(error) : resolve()); target.closeAllConnections(); });
    });
    const origin = `http://127.0.0.1:${(target.address() as { port: number }).port}/target`;
    const registration = { registrationId: ids.next(), displayName: 'Local preview target', kind: 'web' as const,
      allowedOrigins: [origin], applicationIdentity: '', credentialRef, permittedActions: ['navigate', 'read-attribute'] as const,
      attributeLabelPatterns: ['Parameter'], secondaryKey: '', authenticationDestination: `${origin}/sign-in` };
    const inputs = { ...executablePlanInputs(), targets: [snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) })],
      instructions: [{ registrationId: registration.registrationId, text: 'Inspect the synthetic local preview target.' }] };
    const version = activeRunVersion(procedureId, versionId, actorId, inputs);
    await new PostgresProceduresUnitOfWork(db).execute(async context => {
      await context.procedures.insertProcedure(version); await context.procedures.insertVersion(version);
    });
    await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
      procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Synthetic preview proof',
      '2026-08-01','2026-08-01','RUNNING','STANDARD',${actorId},'preview-fixture','auditor',${at})`;
    await sql`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
      VALUES(${runId},1,'POPULATION_READY',1,${at},${at},${until},'session-1',${ids.next()})`;
    await sql`INSERT INTO run_execution(run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
      VALUES(${runId},1,'EXECUTING',1,${at},${at},${at},${until},${ids.next()})`;
    const runtimeId = randomUUID(), store = new PostgresWorkspacePreviewStore(db);
    const execution = new PlaywrightBrowserExecution({ mode: 'local' }, { runtimeId, store });
    cleanup.push(() => execution.close());
    const workspace = await execution.create({ runId, policy: { allowedOrigins: [origin] }, timeoutMs: 15_000 });
    const ref = workspace.ref;
    await sql`INSERT INTO run_workspace(run_id,revision,status,attempts,step_id,workspace_id,mode,started_at,attempt_started_at,lease_until)
      VALUES(${runId},1,'OPEN',1,'session-1',${ref.workspaceId},'local',${at},${at},${until})`;
    await execution.perform(ref, { action: 'navigate', destination: `${origin}/public`, credential: null, capture: [] }, 10_000);
    const live = (Reflect.get(execution, 'live') as Map<string, LiveObservation>).get(ref.workspaceId);
    if (!live?.page) throw new Error('Actual adapter did not retain its Page');
    const page = live.page, context = live.context, viewport = page.viewportSize();
    const pageEvents: Page[] = [], viewportChanges: unknown[] = [], screenshots: ScreenshotMeasurement[] = [];
    context.on('page', value => pageEvents.push(value));
    const resize = page.setViewportSize.bind(page);
    page.setViewportSize = async value => { viewportChanges.push(value); await resize(value); };
    const screenshot = page.screenshot.bind(page);
    let screenshotGate: { kind: ScreenshotMeasurement['kind']; arrived: ReturnType<typeof deferred<Buffer>>; release: ReturnType<typeof deferred<void>> } | null = null;
    const gates: Array<ReturnType<typeof deferred<void>>> = [];
    page.screenshot = async options => {
      const startedAt = Date.now(), kind = options?.type === 'jpeg' ? 'preview' : 'registered';
      const bytes = await screenshot(options);
      screenshots.push({ kind, startedAt, completedAt: Date.now(), digest: digest(bytes), bytes: bytes.length, page });
      if (screenshotGate?.kind === kind) {
        const gate = screenshotGate; screenshotGate = null;
        gate.arrived.resolve(bytes); await gate.release.promise;
      }
      return bytes;
    };
    cleanup.push(async () => { for (const gate of gates) gate.resolve(); loginGate?.resolve(); });
    const stopBroker = await startWorkspacePreviewBroker({ port, secret, store, frames: execution });
    cleanup.push(stopBroker);
    const metadata = async (): Promise<WorkspacePreviewMetadata> => {
      const [row] = await sql<WorkspacePreviewMetadata[]>`SELECT run_id AS "runId",workspace_revision AS "workspaceRevision",runtime_id AS "runtimeId",
        privacy_epoch AS "privacyEpoch",mode,sequence,extract(epoch FROM captured_at)*1000 AS "capturedAt",
        extract(epoch FROM capture_completed_at)*1000 AS "captureCompletedAt",extract(epoch FROM expires_at)*1000 AS "expiresAt"
        FROM run_workspace_preview WHERE run_id=${runId}`;
      if (!row) throw new Error('Actual preview metadata is missing');
      return { ...row, capturedAt: row.capturedAt === null ? null : Number(row.capturedAt),
        captureCompletedAt: row.captureCompletedAt === null ? null : Number(row.captureCompletedAt), expiresAt: Number(row.expiresAt) };
    };
    return { sql, actorId, runId, ref, runtimeId, store, execution, page, context, viewport, pageEvents, viewportChanges,
      screenshots, requests, origin, metadata, close, successfulPosts: () => successfulPosts,
      holdScreenshot(kind: ScreenshotMeasurement['kind']) {
        if (screenshotGate) throw new Error('A screenshot gate is already armed');
        const gate = { kind, arrived: deferred<Buffer>(), release: deferred<void>() };
        gates.push(gate.release); screenshotGate = gate; return gate;
      },
      holdSignIn() { loginGate = deferred<void>(); loginArrived = deferred<void>(); return { arrived: loginArrived.promise, release: () => loginGate?.resolve() }; },
      async signIn() {
        const credential = await resolver.resolve(credentialRef, 1000);
        return execution.perform(ref, { action: 'navigate', destination: `${origin}/account`, authenticationDestination: `${origin}/sign-in`, credential }, 10_000);
      },
      captureRegistered() {
        return execution.perform(ref, { action: 'navigate', destination: `${origin}/public`, credential: null,
          capture: ['structural-snapshot', 'screenshot'] }, 10_000, NO_CREDENTIALS);
      },
      async expireRuntime() { await sql`UPDATE run_workspace_preview SET expires_at=clock_timestamp()-interval '1 second' WHERE run_id=${runId}`; },
      async replaceRuntime() {
        const replacement = { ...ref, workspaceId: ids.next() }, nextRuntime = randomUUID();
        await sql`UPDATE run_workspace SET revision=revision+1,workspace_id=${replacement.workspaceId} WHERE run_id=${runId}`;
        if (await store.claim(replacement, nextRuntime) !== 2) throw new Error('Replacement runtime was not admitted at its new revision');
        return nextRuntime;
      },
      async cancelAtWorkerBoundary() {
        const repository = new PostgresRunCancellationRepository(db), clock = new SystemClock();
        const requested = await cancelRun({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), repository, ids, clock },
          { session: { userId: actorId, sessionId: originalSessions[0]?.id ?? 'preview-fixture' }, request: { runId, reason: 'Complete the synthetic preview proof.' } });
        if (!requested.ok || !requested.pending) throw new Error('Fixture cancellation was not accepted at the worker boundary');
        await repository.transaction(runId, async context => {
          if (!context.run?.cancellation) throw new Error('Fixture cancellation marker is missing');
          await performCancellation(context, { run: context.run, request: context.run.cancellation,
            at: clock.now().toISOString(), plan: await context.frozenPlan(), source: 'worker' });
        });
      },
      async revokeRole() { await sql`UPDATE user_role SET role='poc-administrator' WHERE user_id=${actorId}`; },
      async expireNewSession() {
        const sessions = await sql<{ id: string }[]>`SELECT id FROM auth_session WHERE user_id=${actorId}`;
        const created = sessions.filter(session => !originalSessions.some(original => original.id === session.id));
        if (created.length !== 1) throw new Error('Session expiry proof requires exactly one disposable sign-in session');
        disposableSessionId = created[0]!.id;
        await sql`UPDATE auth_session SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${disposableSessionId}`;
      },
    };
  } catch (error) { await close(); throw error; }
}
export type PreviewBrowserFixture = Awaited<ReturnType<typeof createPreviewBrowserFixture>>;
