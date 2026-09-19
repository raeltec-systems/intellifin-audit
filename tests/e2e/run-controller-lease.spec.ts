import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { performPause, pauseRun, raiseEscalation } from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunsUnitOfWork,
  PostgresWaitRepository,
  SystemClock,
  type Sql,
} from '@intellifin/infrastructure';

import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * Controller control is a durable fence around Resume, exercised through two real
 * authenticated contexts. The stale request is held at the actual Next Server Action
 * boundary while the owner releases and reacquires the lease, then forwarded unchanged.
 */

const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const leaseAt = (): string => new Date(Date.now() + 60 * 60 * 1000).toISOString();

type RoleRow = { readonly role: string; readonly assigned_by: string | null; readonly assigned_at: string | null };
type LeaseRow = { readonly epoch: number; readonly holder_id: string | null; readonly expires_at: Date | string | null };
type RunRow = { readonly run_id: string; readonly revision: number; readonly state: string };

const runs: string[] = [];
let sql: Sql;
let adminId = '';
let originalAdminRole: RoleRow | null = null;

/** Next serializes Server Action arguments as a JSON array; keep the body private. */
function actionFields(postData: string | null): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(postData ?? 'null');
    const fields: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
    return fields !== null && typeof fields === 'object' && !Array.isArray(fields)
      ? fields as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function readLease(runId: string): Promise<LeaseRow | null> {
  const [row] = await sql<LeaseRow[]>`
    SELECT epoch,holder_id,expires_at FROM run_control_lease WHERE run_id=${runId}`;
  return row ?? null;
}

async function seedRun(state: 'RUNNING' | 'AWAITING_AUDITOR'): Promise<string> {
  const [auditor] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('The controller lease journey requires the seeded Auditor.');
  const runId = ids.next();
  const at = new Date().toISOString();
  const day = String(runs.length + 1).padStart(2, '0');
  await sql`INSERT INTO audit_run(
      request_token,run_id,correlation_id,procedure_id,version_id,version_number,
      procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
    VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Controller lease journey',
      ${`2026-08-${day}`},${`2026-08-${day}`},${state},'STANDARD',${auditor.id},${`controller-lease-${runId}`},'auditor',${at})`;
  runs.push(runId);
  // These are the truthful stage checkpoints of a Run whose worker is holding it. The
  // surface reads them while deciding which lifecycle controls are eligible.
  await sql`INSERT INTO population_execution(
      run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
    VALUES(${runId},1,'POPULATION_READY',1,${at},${at},${leaseAt()},'session-1',${ids.next()})`;
  await sql`INSERT INTO run_execution(
      run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
    VALUES(${runId},1,'EXECUTING',1,${at},${at},${at},${leaseAt()},${ids.next()})`;
  return runId;
}

async function pauseSeededRun(runId: string, auditorId: string): Promise<string> {
  const db = createDb(sql);
  const requested = await pauseRun({
    roles: new DrizzleRoleRepository(db),
    unitOfWork: new PostgresRunsUnitOfWork(db),
    repository: new PostgresWaitRepository(db),
    ids,
    clock: new SystemClock(),
  }, { session: { userId: auditorId, sessionId: 'controller-lease-fixture' }, request: { runId } });
  if (!requested.ok) throw new Error(`Controller lease fixture could not request pause: ${requested.reason}`);

  return new PostgresWaitRepository(db).transaction(runId, async (context) => {
    const run = context.run;
    const request = run?.pauseRequest;
    if (!run || request === null || request === undefined) throw new Error('Controller lease fixture pause marker was not persisted.');
    await context.saveRunState('PAUSED');
    const wait = await performPause(context as never, {
      run,
      request,
      waitId: ids.next(),
      at: new Date().toISOString(),
    });
    return wait.waitId;
  });
}

async function openEscalation(runId: string): Promise<string> {
  const raised = await raiseEscalation({
    repository: new PostgresWaitRepository(createDb(sql)),
    ids,
    clock: new SystemClock(),
  }, {
    runId,
    kind: 'choose-candidate',
    options: [
      { id: 'candidate-a', label: 'Synthetic candidate A' },
      { id: 'candidate-b', label: 'Synthetic candidate B' },
      { id: 'mark-ambiguous', label: 'Mark the record ambiguous' },
    ],
    stepId: 'controller-lease-step',
    supportingEvidenceIds: [],
  });
  if (!raised.ok) throw new Error(`Controller lease fixture could not open its Escalation: ${raised.reason}`);
  return raised.wait.waitId;
}

async function cleanupRun(runId: string): Promise<void> {
  await sql`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
  await sql`DELETE FROM notification WHERE run_id=${runId}`;
  await sql`DELETE FROM run_wait WHERE run_id=${runId}`;
  await sql`DELETE FROM run_result_review WHERE run_id=${runId}`;
  await sql`DELETE FROM run_result WHERE run_id=${runId}`;
  await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
  await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
  await sql`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
  await sql`DELETE FROM run_tool_action WHERE run_id=${runId}`;
  await sql`DELETE FROM run_agent_turn WHERE run_id=${runId}`;
  await sql`DELETE FROM run_agent_work WHERE run_id=${runId}`;
  await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
  await sql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
  await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
  await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
  await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
  await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
  await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
  await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
  await sql`DELETE FROM run_execution WHERE run_id=${runId}`;
  await sql`DELETE FROM population_row WHERE run_id=${runId}`;
  await sql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
  await sql`DELETE FROM population_evidence WHERE run_id=${runId}`;
  await sql`DELETE FROM population_execution WHERE run_id=${runId}`;
  await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
  await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
  await sql`DELETE FROM run_initiation_request WHERE run_id=${runId} OR refused_run_id=${runId}`;
  // The lease is a retained child fence and is removed only by the aggregate cascade.
  await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
}

async function assertA11y(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false, caret: 'initial' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function closeContext(context: BrowserContext): Promise<void> {
  await context.close();
}

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the controller lease journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 8 });
  const [auditor] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  const [admin] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email=${ACCOUNTS.administrator.email}`;
  if (!auditor || !admin) throw new Error('Seed the synthetic Auditor and Administrator before the controller lease journey.');
  adminId = admin.id;
  originalAdminRole = (await sql<RoleRow[]>`SELECT role,assigned_by,assigned_at::text AS assigned_at FROM user_role WHERE user_id=${adminId}`)[0] ?? null;
  if (originalAdminRole === null) throw new Error('The controller lease contender requires the seeded Administrator role.');
  const version = activeRunVersion(procedureId, versionId, auditor.id);
  await new PostgresProceduresUnitOfWork(createDb(sql)).execute(async context => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });
});

test.afterAll(async () => {
  let failure: unknown;
  try {
    if (sql) {
      for (const runId of runs) await cleanupRun(runId);
      await sql`DELETE FROM procedure_version WHERE version_id=${versionId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
    }
  } catch (error) {
    failure = error;
  } finally {
    if (sql) await sql.end({ timeout: 5 });
  }
  if (failure) throw failure;
});

test.describe('durable Run controller lease', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('serializes Resume across contexts, fences stale requests, and leaves eligible controls lease-free', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    const [auditor] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
    if (!auditor) throw new Error('The controller lease journey requires the seeded Auditor.');
    const pausedRunId = await seedRun('RUNNING');
    const runningRunId = await seedRun('RUNNING');
    const escalationRunId = await seedRun('RUNNING');
    const waitId = await pauseSeededRun(pausedRunId, auditor.id);
    const escalationWaitId = await openEscalation(escalationRunId);
    const initialRun = (await sql<RunRow[]>`SELECT run_id,revision,state FROM audit_run WHERE run_id=${pausedRunId}`)[0];
    if (!initialRun) throw new Error('The controller lease fixture Run was not stored.');

    await sql`UPDATE user_role SET role='audit-manager' WHERE user_id=${adminId}`;
    let holderContext: BrowserContext | undefined;
    let contenderContext: BrowserContext | undefined;
    let holderPage!: Page;
    let stalePage!: Page;
    let contenderPage!: Page;
    let releaseStaleResume: (() => void) | undefined;
    let staleResumeCaptured = false;
    let stalePostReadyResolve: (() => void) | undefined;
    const stalePostReady = new Promise<void>((resolve) => { stalePostReadyResolve = resolve; });

    try {
      holderContext = await browser.newContext({ baseURL, storageState: AUTH_STATE.auditor });
      contenderContext = await browser.newContext({ baseURL, storageState: AUTH_STATE.administrator });
      holderPage = await holderContext.newPage();
      stalePage = await holderContext.newPage();
      contenderPage = await contenderContext.newPage();

      // The Running control remains eligible without any controller row. This is the
      // exact Pause control path. Steering can offer acquisition alongside it, but
      // an unowned lease must never disable the independent safety control.
      await holderPage.goto(`/runs/${runningRunId}`);
      await expect(holderPage.locator('#run-pause[data-client-ready=true]')).toBeVisible();
      const pause = holderPage.getByRole('button', { name: 'Pause', exact: true });
      await expect(pause).toBeVisible();
      await expect(pause).not.toHaveAttribute('aria-disabled', 'true');
      await expect(holderPage.getByRole('region', { name: 'Run controller', exact: true })).toBeVisible();
      expect(await readLease(runningRunId)).toBeNull();

      // A durable Escalation answer also stays available without the Resume lease.
      await holderPage.goto(`/runs/${escalationRunId}`);
      await expect(holderPage.getByRole('heading', { name: 'Open Escalation', exact: true })).toBeVisible();
      const answer = holderPage.getByRole('button', { name: 'Select candidate 1', exact: true });
      await expect(answer).toBeVisible();
      await expect(answer).not.toHaveAttribute('aria-disabled', 'true');
      await expect(holderPage.getByRole('region', { name: 'Run controller', exact: true })).toBeVisible();
      const [openWait] = await sql<{ wait_id: string; closed_at: string | null }[]>`SELECT wait_id,closed_at FROM run_wait WHERE run_id=${escalationRunId}`;
      expect(openWait).toMatchObject({ wait_id: escalationWaitId, closed_at: null });

      await holderPage.goto(`/runs/${pausedRunId}`);
      await expect(holderPage.locator('#run-pause[data-client-ready=true]')).toBeVisible();
      const holderController = holderPage.getByRole('region', { name: 'Run controller', exact: true });
      await expect(holderController.getByRole('button', { name: 'Acquire control', exact: true })).toBeVisible();
      await expect(holderPage.getByRole('button', { name: 'Resume', exact: true })).toHaveAttribute('aria-disabled', 'true');
      await expect(holderController.getByRole('button', { name: 'Acquire control', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
      await holderController.getByRole('button', { name: 'Acquire control', exact: true }).click();
      await expect(holderController).toContainText('You control this Run.');
      const firstLease = await readLease(pausedRunId);
      expect(firstLease).toMatchObject({ epoch: 1, holder_id: auditor.id });
      expect(firstLease?.expires_at).not.toBeNull();
      if (firstLease === null) throw new Error('The first controller lease was not persisted.');
      const staleEpoch = firstLease.epoch;
      const staleRevision = initialRun.revision;
      await expect(holderPage.getByRole('button', { name: 'Resume', exact: true })).not.toHaveAttribute('aria-disabled', 'true');

      // The second context is a separately authenticated Audit Manager. Its Acquire
      // control is visibly blocked by the live holder, and the durable row is unchanged.
      await contenderPage.goto(`/runs/${pausedRunId}`);
      const contenderController = contenderPage.getByRole('region', { name: 'Run controller', exact: true });
      await expect(contenderController).toContainText('Current controller:');
      const contenderAcquire = contenderController.getByRole('button', { name: 'Acquire control', exact: true });
      await expect(contenderAcquire).toHaveAttribute('aria-disabled', 'true');
      await expect(contenderAcquire).toHaveAccessibleDescription('The current controller must release control or let the lease expire.');
      await contenderAcquire.focus();
      await contenderAcquire.press('Enter');
      expect(await readLease(pausedRunId)).toMatchObject({ epoch: 1, holder_id: auditor.id });

      // The stale tab captures the first epoch and the server-rendered Run revision. Its
      // request is held at the real Server Action POST so the owner can advance the fence.
      await stalePage.goto(`/runs/${pausedRunId}`);
      const staleController = stalePage.getByRole('region', { name: 'Run controller', exact: true });
      await expect(staleController).toContainText('You control this Run.');
      await expect(stalePage.getByRole('button', { name: 'Resume', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
      await stalePage.route('**/*', async route => {
        const request = route.request();
        const headers = request.headers();
        const fields = actionFields(request.postData());
        const isStaleResume = fields !== null && fields.runId === pausedRunId &&
          fields.expectedControlEpoch === staleEpoch && fields.expectedRunRevision === staleRevision;
        if (!staleResumeCaptured && request.method() === 'POST' && headers['next-action'] !== undefined && isStaleResume) {
          staleResumeCaptured = true;
          stalePostReadyResolve?.();
          await new Promise<void>((resolve) => { releaseStaleResume = resolve; });
        }
        await route.continue();
      });
      await stalePage.getByRole('button', { name: 'Resume', exact: true }).click();
      const resumeDialog = stalePage.getByRole('dialog');
      await expect(resumeDialog).toBeVisible();
      await expect(resumeDialog.getByRole('heading', { name: 'Resume this Run?', exact: true })).toBeVisible();
      const staleSubmit = resumeDialog.getByRole('button', { name: 'Resume Run', exact: true }).click();
      await stalePostReady;
      expect(staleResumeCaptured).toBe(true);

      // The owner releases (epoch 2) and reacquires (epoch 3), both through the live UI.
      await holderController.getByRole('button', { name: 'Release control', exact: true }).click();
      await expect(holderController).toContainText('No auditor currently holds control.');
      expect(await readLease(pausedRunId)).toMatchObject({ epoch: 2, holder_id: null, expires_at: null });
      await holderController.getByRole('button', { name: 'Acquire control', exact: true }).click();
      await expect(holderController).toContainText('You control this Run.');
      expect(await readLease(pausedRunId)).toMatchObject({ epoch: 3, holder_id: auditor.id });

      // Forward the unchanged stale request. The lease fence refuses it before the wait
      // close, so the paused state, revision and open wait remain durable.
      releaseStaleResume?.();
      await staleSubmit;
      await expect(stalePage.getByText('Your control lease changed or expired. Reload the Run before confirming Resume.', { exact: true })).toBeVisible();
      const [afterStale] = await sql<RunRow[]>`SELECT run_id,revision,state FROM audit_run WHERE run_id=${pausedRunId}`;
      expect(afterStale).toMatchObject({ run_id: pausedRunId, revision: initialRun.revision, state: 'PAUSED' });
      const [stillOpen] = await sql<{ wait_id: string; closed_at: string | null; closure_kind: string | null }[]>`
        SELECT wait_id,closed_at,closure_kind FROM run_wait WHERE run_id=${pausedRunId} AND wait_id=${waitId}`;
      expect(stillOpen).toMatchObject({ wait_id: waitId, closed_at: null, closure_kind: null });
      expect(await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${pausedRunId} AND event_type='lifecycle.run-resumed'`).toHaveLength(0);
      const leaseEvents = await sql<{ event_type: string; payload: { epoch: number; holderId: string | null } }[]>`
        SELECT event_type,payload FROM audit_events
        WHERE aggregate_id=${pausedRunId}
          AND event_type IN ('lifecycle.run-control-lease-acquired','lifecycle.run-control-lease-released')
        ORDER BY sequence`;
      expect(leaseEvents.map(event => event.event_type)).toEqual([
        'lifecycle.run-control-lease-acquired',
        'lifecycle.run-control-lease-released',
        'lifecycle.run-control-lease-acquired',
      ]);
      expect(leaseEvents.map(event => event.payload.epoch)).toEqual([1, 2, 3]);

      await capture(holderPage, testInfo, 'run-controller-lease-1440x900');
      await assertA11y(holderPage);
    } finally {
      releaseStaleResume?.();
      // Restore the shared identity before browser teardown: a timed-out context may
      // already be closed, and its cleanup must never leak the temporary manager role.
      if (originalAdminRole !== null) {
        await sql`UPDATE user_role SET role=${originalAdminRole.role},assigned_by=${originalAdminRole.assigned_by},assigned_at=${originalAdminRole.assigned_at}::timestamptz WHERE user_id=${adminId}`;
      }
      await Promise.allSettled([holderContext, contenderContext]
        .filter((context): context is BrowserContext => context !== undefined)
        .map(closeContext));
    }
  });
});
