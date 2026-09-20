import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page, type Request, type TestInfo } from '@playwright/test';
import { acquireRunControlLease, releaseRunControlLease, performPause, pauseRun, raiseEscalation } from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunsUnitOfWork,
  PostgresRunControlLeaseRepository,
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

async function progressEvent(runId: string): Promise<void> {
  const event = await new PostgresRunsUnitOfWork(createDb(sql)).execute(context => context.auditEvents.append({
    actor: { type: 'system', id: 'renewal-fixture' }, source: 'worker', outcome: 'success',
    eventType: 'lifecycle.run-progressed', aggregateId: runId, correlationId: ids.next(),
    sessionId: 'renewal-progress', payload: {},
  }));
  await sql`SELECT pg_notify('run_timeline', ${JSON.stringify({ runId, sequence: event.sequence })})`;
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
  await sql.begin(async tx => {
  await tx`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
  await tx`DELETE FROM notification WHERE run_id=${runId}`;
  await tx`DELETE FROM run_wait WHERE run_id=${runId}`;
  await tx`DELETE FROM run_result_review WHERE run_id=${runId}`;
  await tx`DELETE FROM run_result WHERE run_id=${runId}`;
  await tx`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
  await tx`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
  await tx`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
  await tx`DELETE FROM run_tool_action WHERE run_id=${runId}`;
  await tx`DELETE FROM run_agent_turn WHERE run_id=${runId}`;
  await tx`DELETE FROM run_agent_work WHERE run_id=${runId}`;
  await tx`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
  await tx`DELETE FROM run_observation_check WHERE run_id=${runId}`;
  await tx`DELETE FROM run_observation WHERE run_id=${runId}`;
  await tx`DELETE FROM run_step_execution WHERE run_id=${runId}`;
  await tx`DELETE FROM run_session_step WHERE run_id=${runId}`;
  await tx`DELETE FROM run_work_item WHERE run_id=${runId}`;
  await tx`DELETE FROM run_gate_check WHERE run_id=${runId}`;
  await tx`DELETE FROM run_evidence WHERE run_id=${runId}`;
  await tx`DELETE FROM run_execution WHERE run_id=${runId}`;
  await tx`DELETE FROM population_row WHERE run_id=${runId}`;
  await tx`DELETE FROM population_snapshot WHERE run_id=${runId}`;
  await tx`DELETE FROM population_evidence WHERE run_id=${runId}`;
  await tx`DELETE FROM population_execution WHERE run_id=${runId}`;
  await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
  await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
  await tx`DELETE FROM run_initiation_request WHERE run_id=${runId} OR refused_run_id=${runId}`;
  // The lease is a retained child fence and is removed only by the aggregate cascade.
  await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
  });
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

  test('recovers the original renewal across state changes and reload after ownership changes', async ({ page }, testInfo) => {
    test.setTimeout(100_000);
    const runId = await seedRun('RUNNING');
    await page.goto(`/runs/${runId}/workspace`);
    const controller = page.getByRole('region', { name: 'Run controller', exact: true });
    await controller.getByRole('button', { name: 'Acquire control', exact: true }).click();
    await expect(controller).toContainText('You control this Run.');
    let dropped = false;
    const renewalBodies: string[] = [];
    let readRequests = 0;
    let holdRead = false;
    let releaseRead!: () => void;
    const readReleased = new Promise<void>(resolve => { releaseRead = resolve; });
    let readCaptured!: () => void;
    const readReady = new Promise<void>(resolve => { readCaptured = resolve; });
    await page.route(`**/api/runs/${runId}/control`, async route => {
      readRequests += 1;
      if (holdRead) {
        const response = await route.fetch(); readCaptured(); await readReleased;
        await route.fulfill({ response }); return;
      }
      await route.continue();
    });
    await page.route(`**/runs/${runId}/workspace`, async route => {
      const request = route.request();
      if (request.method() === 'POST' && request.headers()['next-action']) {
        const args: unknown = JSON.parse(request.postData() ?? 'null');
        if (Array.isArray(args) && args[0] === 'renew') {
          renewalBodies.push(request.postData()!);
          if (!dropped) {
            dropped = true;
            expect((await route.fetch()).status()).toBe(200);
            await route.abort('failed'); return;
          }
        }
      }
      await route.continue();
    });
    const work = new PostgresRunsUnitOfWork(createDb(sql));
    let stopped = false;
    const progress = (async () => {
      while (!stopped) {
        const event = await work.execute(context => context.auditEvents.append({
          actor: { type: 'system', id: 'renewal-fixture' }, source: 'worker', outcome: 'success',
          eventType: 'lifecycle.run-progressed', aggregateId: runId, correlationId: ids.next(),
          sessionId: 'renewal-progress', payload: {},
        }));
        await sql`SELECT pg_notify('run_timeline', ${JSON.stringify({ runId, sequence: event.sequence })})`;
        await new Promise(resolve => setTimeout(resolve, 2_000));
      }
    })();
    try {
      await expect(controller.getByRole('button', { name: 'Retry renewal', exact: true })).toBeVisible({ timeout: 40_000 });
      expect(readRequests).toBeGreaterThan(5);
      expect(dropped).toBe(true);
      await expect(controller).not.toContainText('You control this Run.');
      const beforeRetry = await sql`SELECT event_id,payload FROM audit_events WHERE aggregate_id=${runId}
        AND event_type='lifecycle.run-control-lease-renewed'`;
      expect(beforeRetry).toHaveLength(1);
      await openEscalation(runId);
      await expect(page.getByRole('heading', { name: 'Open Escalation', exact: true })).toBeVisible();
      await expect(controller.getByRole('button', { name: 'Retry renewal', exact: true })).toBeVisible();
      await page.reload();
      await expect(controller.getByRole('button', { name: 'Retry renewal', exact: true })).toBeVisible();
      const [auditor] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
      if (!auditor) throw new Error('Auditor missing');
      await sql`UPDATE user_role SET role='audit-manager' WHERE user_id=${adminId}`;
      const db = createDb(sql);
      const dependencies = { roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db),
        repository: new PostgresRunControlLeaseRepository(db), ids, allowEnrollment: true };
      expect(await releaseRunControlLease(dependencies, { session: { userId: auditor.id, sessionId: 'renewal-fixture' },
        request: { runId, expectedEpoch: 1 } })).toMatchObject({ ok: true });
      expect(await acquireRunControlLease(dependencies, { session: { userId: adminId, sessionId: 'renewal-fixture' },
        request: { runId, expectedEpoch: 2 } })).toMatchObject({ ok: true });
      const leaseBefore = await readLease(runId);
      holdRead = true;
      await controller.getByRole('button', { name: 'Retry renewal', exact: true }).click();
      await readReady;
      await expect(controller).not.toContainText('You control this Run.');
      await expect(controller).toContainText('Checking current Run control');
      releaseRead();
      await expect(controller).toContainText('Current controller:');
      expect(renewalBodies).toHaveLength(2);
      expect(renewalBodies[1]).toBe(renewalBodies[0]);
      expect(await readLease(runId)).toEqual(leaseBefore);
      expect(await sql`SELECT event_id,payload FROM audit_events WHERE aggregate_id=${runId}
        AND event_type='lifecycle.run-control-lease-renewed'`).toEqual(beforeRetry);
      await capture(page, testInfo, 'controller-renewal-recovered');
    } finally {
      releaseRead(); stopped = true; await progress;
      if (originalAdminRole) await sql`UPDATE user_role SET role=${originalAdminRole.role},assigned_by=${originalAdminRole.assigned_by},assigned_at=${originalAdminRole.assigned_at}::timestamptz WHERE user_id=${adminId}`;
    }
  });

  test('a routine heartbeat preserves an open Resume and blocks submission only during fresh verification', async ({ page }) => {
    test.setTimeout(70_000);
    const [auditor] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
    if (!auditor) throw new Error('Auditor missing');
    const runId = await seedRun('RUNNING');
    await pauseSeededRun(runId, auditor.id);
    await page.goto(`/runs/${runId}`);
    const controller = page.getByRole('region', { name: 'Run controller', exact: true });
    await controller.getByRole('button', { name: 'Acquire control', exact: true }).click();
    await expect(controller).toContainText('You control this Run.');
    let renewed = false;
    let releaseRead!: () => void;
    const released = new Promise<void>(resolve => { releaseRead = resolve; });
    let capturedRead!: () => void;
    const captured = new Promise<void>(resolve => { capturedRead = resolve; });
    await page.route(`**/api/runs/${runId}/control`, async route => {
      if (renewed) {
        const response = await route.fetch(); capturedRead(); await released;
        await route.fulfill({ response }); return;
      }
      await route.continue();
    });
    await page.route(`**/runs/${runId}`, async route => {
      const request = route.request();
      if (request.method() === 'POST' && request.headers()['next-action']) {
        const args: unknown = JSON.parse(request.postData() ?? 'null');
        if (Array.isArray(args) && args[0] === 'renew') renewed = true;
      }
      await route.continue();
    });
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Resume this Run?', exact: true });
    try {
      await captured;
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Resume Run', exact: true })).toHaveAttribute('aria-disabled', 'true');
      expect(await sql`SELECT state FROM audit_run WHERE run_id=${runId}`).toEqual([{ state: 'PAUSED' }]);
      releaseRead();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Resume Run', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
      await dialog.getByRole('button', { name: 'Go back', exact: true }).click();
      expect(await readLease(runId)).toMatchObject({ epoch: 1 });
    } finally { releaseRead(); }
  });

  test('a pending ownership read does not queue an independent safety Pause behind it', async ({ page }) => {
    const runId = await seedRun('RUNNING');
    await page.goto(`/runs/${runId}`);
    const controller = page.getByRole('region', { name: 'Run controller', exact: true });
    await controller.getByRole('button', { name: 'Acquire control', exact: true }).click();
    await expect(controller).toContainText('You control this Run.');
    let releaseRead!: () => void;
    let captureRead!: () => void;
    const released = new Promise<void>(resolve => { releaseRead = resolve; });
    const captured = new Promise<void>(resolve => { captureRead = resolve; });
    await page.route(`**/api/runs/${runId}/control`, async route => {
      const response = await route.fetch(); captureRead(); await released;
      await route.fulfill({ response });
    });
    try {
      await progressEvent(runId); await captured;
      await expect(controller).toContainText('Checking current Run control');
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Pause Run', exact: true }).click();
      // Assert the actual safety marker before releasing the held ownership response.
      await expect.poll(async () => (await sql`SELECT pause_requested_at IS NOT NULL AS requested
        FROM audit_run WHERE run_id=${runId}`)[0]?.requested).toBe(true);
      expect(await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${runId}
        AND event_type='lifecycle.run-pause-requested'`).toHaveLength(1);
    } finally { releaseRead(); }
  });

  test('counts delayed ownership delivery against server expiry even while a later read hangs', async ({ page }) => {
    const [auditor] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
    if (!auditor) throw new Error('Auditor missing');
    const runId = await seedRun('RUNNING');
    await pauseSeededRun(runId, auditor.id);
    await page.clock.install(); await page.clock.pauseAt(new Date());
    await page.goto(`/runs/${runId}`);
    const controller = page.getByRole('region', { name: 'Run controller', exact: true });
    await expect(controller).toContainText('No auditor currently holds control.');
    // Drain hydration/initial stream invalidation before introducing a delayed read.
    await page.clock.runFor(1_000);
    await expect(controller).toContainText('No auditor currently holds control.');
    let reads = 0;
    let releaseRead!: () => void;
    const released = new Promise<void>(resolve => { releaseRead = resolve; });
    let capturedRead!: () => void;
    const captured = new Promise<void>(resolve => { capturedRead = resolve; });
    const pendingRoutes: Array<() => Promise<void>> = [];
    await page.route(`**/api/runs/${runId}/control`, async route => {
      reads += 1;
      if (reads === 1) {
        // A full 120-second server lease already 108 seconds old; no production
        // duration is changed, and this genuine projection is delayed in transit.
        await sql`WITH stamp AS (SELECT clock_timestamp() AS at)
          INSERT INTO run_control_lease(run_id,epoch,holder_id,updated_at,expires_at)
          SELECT ${runId}::uuid,1,${auditor.id},at-interval '108 seconds',at+interval '12 seconds' FROM stamp`;
        const response = await route.fetch(); capturedRead(); await released;
        await route.fulfill({ response }); return;
      }
      await new Promise<void>(resolve => { pendingRoutes.push(async () => { await route.abort(); resolve(); }); });
    });
    try {
      await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await captured;
      await page.clock.runFor(7_000); releaseRead();
      await expect(controller).toContainText('You control this Run.');
      await progressEvent(runId);
      await page.clock.runFor(500);
      await expect.poll(() => reads).toBeGreaterThan(1);
      await page.clock.runFor(6_000);
      await expect(controller).toContainText('The last confirmed control lease expired.');
      await expect(controller).not.toContainText('You control this Run.');
      await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveAttribute('aria-disabled', 'true');
      await Promise.all(pendingRoutes.splice(0).map(release => release()));
      await page.unroute(`**/api/runs/${runId}/control`);
      await controller.getByRole('button', { name: 'Refresh control', exact: true }).click();
      await expect(controller).toHaveAttribute('data-control-ready', 'true');
      await expect(controller).not.toContainText('The last confirmed control lease expired.');
    } finally { releaseRead(); await Promise.all(pendingRoutes.map(release => release())); }
  });

  test('a late successful read cannot restore ownership or an open Resume after a newer read fails', async ({ page }) => {
    const [auditor] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
    if (!auditor) throw new Error('Auditor missing');
    const runId = await seedRun('RUNNING');
    await pauseSeededRun(runId, auditor.id);
    await page.goto(`/runs/${runId}`);
    const controller = page.getByRole('region', { name: 'Run controller', exact: true });
    await controller.getByRole('button', { name: 'Acquire control', exact: true }).click();
    await expect(controller).toContainText('You control this Run.');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Resume this Run?' })).toBeVisible();
    let readCount = 0;
    let releaseOld!: () => void;
    let capturedOld!: () => void;
    const captured = new Promise<void>(resolve => { capturedOld = resolve; });
    const released = new Promise<void>(resolve => { releaseOld = resolve; });
    let settledOld!: () => void;
    const settled = new Promise<void>(resolve => { settledOld = resolve; });
    await page.route(`**/api/runs/${runId}/control`, async route => {
      readCount += 1;
      if (readCount === 1) {
        const response = await route.fetch(); capturedOld();
        await released; await route.fulfill({ response }); settledOld(); return;
      }
      await route.abort('failed');
    });
    const visibility = async (value: 'hidden' | 'visible') => page.evaluate(state => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
      document.dispatchEvent(new Event('visibilitychange'));
    }, value);
    try {
      await visibility('hidden');
      await expect(page.getByRole('dialog', { name: 'Resume this Run?' })).toHaveCount(0);
      await visibility('visible'); await captured;
      await controller.getByRole('button', { name: 'Refresh control', exact: true }).click();
      await expect.poll(() => readCount).toBeGreaterThan(1);
      await expect(controller).not.toContainText('You control this Run.');
      releaseOld(); await settled;
      await expect(controller).toContainText('Run control is unavailable.');
      await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveAttribute('aria-disabled', 'true');
      expect(await sql`SELECT state FROM audit_run WHERE run_id=${runId}`).toEqual([{ state: 'PAUSED' }]);
    } finally { releaseOld(); }
  });

  test('keeps independent tabs fenced and withdraws hidden ownership until a fresh visible read', async ({ context, page }) => {
    test.setTimeout(100_000);
    const runId = await seedRun('RUNNING');
    await page.goto(`/runs/${runId}`);
    const first = page.getByRole('region', { name: 'Run controller', exact: true });
    await first.getByRole('button', { name: 'Acquire control', exact: true }).click();
    await expect(first).toContainText('You control this Run.');
    const secondPage = await context.newPage();
    try {
      await secondPage.goto(`/runs/${runId}`);
      const second = secondPage.getByRole('region', { name: 'Run controller', exact: true });
      await expect(second).toContainText('You control this Run.');
      // Drive the browser visibility boundary without relying on a window manager in CI.
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(first).not.toContainText('You control this Run.');
      await expect.poll(async () => (await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${runId}
        AND event_type='lifecycle.run-control-lease-renewed'`).length, { timeout: 40_000 }).toBe(1);
      expect(await readLease(runId)).toMatchObject({ epoch: 1 });
      await second.getByRole('button', { name: 'Release control', exact: true }).click();
      await expect(second).toContainText('No auditor currently holds control.');
      await second.getByRole('button', { name: 'Acquire control', exact: true }).click();
      await expect(second).toContainText('You control this Run.');
      expect(await readLease(runId)).toMatchObject({ epoch: 3 });
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(first).toContainText('You control this Run.');
      await expect.poll(async () => (await sql`SELECT payload FROM audit_events WHERE aggregate_id=${runId}
        AND event_type='lifecycle.run-control-lease-renewed' AND payload->>'expectedEpoch'='3'`).length,
        { timeout: 40_000 }).toBeGreaterThanOrEqual(2);
      const receipts = await sql<{ key: string }[]>`SELECT payload->>'requestKey' AS key FROM audit_events
        WHERE aggregate_id=${runId} AND event_type='lifecycle.run-control-lease-renewed'`;
      expect(new Set(receipts.map(receipt => receipt.key)).size).toBe(receipts.length);
      expect(await readLease(runId)).toMatchObject({ epoch: 3 });
    } finally { await secondPage.close(); }
  });

  for (const invalidation of ['failed ownership read', 'same actor new epoch'] as const) {
    test(`withdraws conversational Resume after ${invalidation} while Stop stays independent`, async ({ page }) => {
      const [auditor] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
      if (!auditor) throw new Error('Auditor missing');
      const runId = await seedRun('RUNNING');
      const waitId = await pauseSeededRun(runId, auditor.id);
      await page.goto(`/runs/${runId}/workspace`);
      const controller = page.getByRole('region', { name: 'Run controller', exact: true });
      await controller.getByRole('button', { name: 'Acquire control', exact: true }).click();
      await expect(controller).toContainText('You control this Run.');
      await page.getByLabel('Message the Run', { exact: true }).fill('Resume');
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect(page.locator('.run-conversation__composer-status')).toHaveText('Message accepted.');
      await page.getByRole('button', { name: 'Review Resume', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Resume this Run?', exact: true });
      await expect(dialog).toBeVisible();
      let confirmations = 0;
      let reads = 0;
      await page.route(`**/api/runs/${runId}/control`, async route => {
        reads += 1;
        if (invalidation === 'failed ownership read') { await route.abort('failed'); return; }
        await route.continue();
      });
      await page.route(`**/runs/${runId}/workspace`, async route => {
        const request = route.request();
        if (request.method() === 'POST' && request.headers()['next-action']) {
          const fields = actionFields(request.postData());
          if (fields?.runId === runId && fields.commandId) confirmations += 1;
        }
        await route.continue();
      });
      if (invalidation === 'same actor new epoch') {
        const db = createDb(sql);
        const dependencies = { roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db),
          repository: new PostgresRunControlLeaseRepository(db), ids, allowEnrollment: true };
        const session = { userId: auditor.id, sessionId: 'confirmation-epoch-fixture' };
        expect(await releaseRunControlLease(dependencies, { session, request: { runId, expectedEpoch: 1 } })).toMatchObject({ ok: true });
        expect(await acquireRunControlLease(dependencies, { session, request: { runId, expectedEpoch: 2 } })).toMatchObject({ ok: true });
      }
      await progressEvent(runId);
      await expect.poll(() => reads).toBeGreaterThan(0);
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Review Resume', exact: true })).toHaveCount(0);
      if (invalidation === 'same actor new epoch') {
        await expect(controller).toContainText('You control this Run.');
        expect(await readLease(runId)).toMatchObject({ epoch: 3, holder_id: auditor.id });
      } else await expect(controller).toContainText('Run control is unavailable.');
      expect(confirmations).toBe(0);
      expect(await sql`SELECT state FROM audit_run WHERE run_id=${runId}`).toEqual([{ state: 'PAUSED' }]);
      expect(await sql`SELECT closed_at FROM run_wait WHERE wait_id=${waitId}`).toEqual([{ closed_at: null }]);
      expect(await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-resumed'`).toHaveLength(0);
      // Lease-read failure must not borrow authority from, or disable, safety Stop.
      await page.getByLabel('Message the Run', { exact: true }).fill('Stop');
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await page.getByRole('button', { name: 'Review Stop', exact: true }).click();
      const stop = page.getByRole('dialog', { name: 'Stop this Run?', exact: true });
      await expect(stop.getByRole('button', { name: 'Stop Run', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
      await stop.getByRole('button', { name: 'Go back', exact: true }).click();
      expect(confirmations).toBe(0);
    });
  }

  test('recovers the same conversational Resume after the response is lost', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const [auditor] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
    if (!auditor) throw new Error('The Resume journey requires its synthetic Auditor.');
    const runId = await seedRun('RUNNING');
    const waitId = await pauseSeededRun(runId, auditor.id);
    await page.goto(`/runs/${runId}/workspace`);
    const controller = page.getByRole('region', { name: 'Run controller', exact: true });
    await controller.getByRole('button', { name: 'Acquire control', exact: true }).click();
    await expect(controller).toContainText('You control this Run.');
    await page.getByLabel('Message the Run', { exact: true }).fill('Resume');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.run-conversation__composer-status')).toHaveText('Message accepted.');
    const [proposal] = await sql<{ command_id: string; expected_run_revision: number }[]>`
      SELECT command_id,expected_run_revision FROM run_interaction_command WHERE run_id=${runId} AND kind='resume'`;
    if (!proposal) throw new Error('The conversation did not retain its Resume proposal.');
    await page.getByRole('button', { name: 'Review Resume', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Resume this Run?', exact: true });
    await expect(dialog).toContainText('Interrupted work restarts as a new attempt');
    await expect(dialog.getByRole('button', { name: 'Go back', exact: true })).toBeFocused();
    expect(await sql`SELECT closed_at FROM run_wait WHERE wait_id=${waitId}`).toEqual([{ closed_at: null }]);
    let dropped = false;
    let captured: Request | null = null;
    let forwardedStatus: number | null = null;
    await page.route(`**/runs/${runId}/workspace`, async route => {
      const request = route.request();
      const fields = actionFields(request.postData());
      if (!dropped && request.method() === 'POST' && request.headers()['next-action'] !== undefined &&
        fields?.runId === runId && fields.commandId === proposal.command_id) {
        dropped = true; captured = request;
        // Execute the real authenticated request, then lose only its response. The
        // retry must discover the existing effect instead of sending new inputs.
        const response = await route.fetch();
        forwardedStatus = response.status();
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await dialog.getByRole('button', { name: 'Resume Run', exact: true }).click();
    // Either the event refresh has reconciled the applied receipt, or the original
    // confirmation remains available to recover. Both preserve the same command.
    await expect.poll(async () => await dialog.count() === 0 ||
      (await dialog.textContent())?.includes('Retry this same confirmation')).toBe(true);
    expect(dropped).toBe(true);
    expect(forwardedStatus).toBe(200);
    expect(await sql`SELECT state,revision FROM audit_run WHERE run_id=${runId}`)
      .toEqual([{ state: 'RUNNING', revision: proposal.expected_run_revision + 1 }]);
    const beforeRetry = await sql`SELECT event_id,sequence FROM audit_events
      WHERE aggregate_id=${runId} AND event_type='lifecycle.run-resumed'`;
    expect(beforeRetry).toHaveLength(1);
    if (captured === null) throw new Error('The authenticated Resume confirmation was not captured.');
    const replay = await page.request.fetch(captured);
    expect(replay.status()).toBe(200);
    const replayBody = await replay.text();
    expect(replayBody).toContain('"commandId":"' + proposal.command_id + '"');
    expect(replayBody).toContain('"state":"applied"');
    expect(replayBody).toContain('"replayed":true');
    // Read the authoritative history after exact authenticated recovery. Do not keep
    // an already-applied modal artificially open against the live event projection.
    await progressEvent(runId);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Conversation history')).toContainText('Resume request: applied.');
    await page.reload();
    await expect(page.getByLabel('Conversation history')).toContainText('Resume request: applied.');
    expect(await sql`SELECT event_id,sequence FROM audit_events
      WHERE aggregate_id=${runId} AND event_type='lifecycle.run-resumed'`).toEqual(beforeRetry);
    expect(await sql`SELECT state FROM run_interaction_transition WHERE command_id=${proposal.command_id} ORDER BY sequence`)
      .toEqual([{ state: 'received' }, { state: 'interpreted' }, { state: 'applied' }]);
    expect(await sql`SELECT closure_kind,actor FROM run_wait WHERE wait_id=${waitId}`)
      .toEqual([{ closure_kind: 'resume', actor: auditor.id }]);
    await capture(page, testInfo, 'conversation-resume-recovered-1440x900');
    await assertA11y(page);
  });

  test('reconciles terminal Stop after a lost response and replays the exact authenticated request', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const [auditor] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
    if (!auditor) throw new Error('The Stop journey requires its synthetic Auditor.');
    const runId = await seedRun('RUNNING');
    const waitId = await pauseSeededRun(runId, auditor.id);
    await page.goto(`/runs/${runId}/workspace`);
    await page.getByLabel('Message the Run', { exact: true }).fill('Stop');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.run-conversation__composer-status')).toHaveText('Message accepted.');
    const [proposal] = await sql<{ command_id: string; expected_run_revision: number }[]>`
      SELECT command_id,expected_run_revision FROM run_interaction_command WHERE run_id=${runId} AND kind='stop'`;
    if (!proposal) throw new Error('The conversation did not retain its Stop proposal.');
    await page.getByRole('button', { name: 'Review Stop', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Stop this Run?', exact: true });
    await expect(dialog).toContainText('Cancellation cannot be undone');
    await expect(dialog.getByRole('button', { name: 'Go back', exact: true })).toBeFocused();
    expect(await sql`SELECT closed_at FROM run_wait WHERE wait_id=${waitId}`).toEqual([{ closed_at: null }]);
    let dropped = false;
    let captured: Request | null = null;
    let forwardedStatus: number | null = null;
    await page.route(`**/runs/${runId}/workspace`, async route => {
      const request = route.request();
      const fields = actionFields(request.postData());
      if (!dropped && request.method() === 'POST' && request.headers()['next-action'] !== undefined &&
        fields?.runId === runId && fields.commandId === proposal.command_id) {
        dropped = true; captured = request;
        // Execute the real authenticated request, then lose only its response. The
        // retry must discover the existing effect instead of sending new inputs.
        const response = await route.fetch();
        forwardedStatus = response.status();
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await dialog.getByRole('button', { name: 'Stop Run', exact: true }).click();
    // The committed terminal event closes LiveGate and remounts this subtree. Its
    // authoritative receipt resolves the unknown response without another UI action.
    await expect(page.getByLabel('Conversation history')).toContainText('Stop request: applied.');
    await expect(dialog).toHaveCount(0);
    expect(dropped).toBe(true);
    await expect.poll(() => forwardedStatus).toBe(200);
    expect(await sql`SELECT state FROM audit_run WHERE run_id=${runId}`)
      .toEqual([{ state: 'CANCELED' }]);
    const beforeRetry = await sql`SELECT event_id,sequence FROM audit_events
      WHERE aggregate_id=${runId} AND event_type='lifecycle.run-canceled'`;
    expect(beforeRetry).toHaveLength(1);
    if (captured === null) throw new Error('The authenticated Stop confirmation was not captured.');
    // The browser-context API keeps the authenticated request's original method,
    // headers and payload. A replay must recover its result despite the closed UI gate.
    const replay = await page.request.fetch(captured);
    expect(replay.status()).toBe(200);
    const replayBody = await replay.text();
    expect(replayBody).toContain('"commandId":"' + proposal.command_id + '"');
    expect(replayBody).toContain('"state":"applied"');
    expect(replayBody).toContain('"replayed":true');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Conversation history')).toContainText('Stop request: applied.');
    await page.reload();
    await expect(page.getByLabel('Conversation history')).toContainText('Stop request: applied.');
    expect(await sql`SELECT event_id,sequence FROM audit_events
      WHERE aggregate_id=${runId} AND event_type='lifecycle.run-canceled'`).toEqual(beforeRetry);
    expect(await sql`SELECT state FROM run_interaction_transition WHERE command_id=${proposal.command_id} ORDER BY sequence`)
      .toEqual([{ state: 'received' }, { state: 'interpreted' }, { state: 'applied' }]);
    expect(await sql`SELECT closed_at IS NOT NULL AS closed FROM run_wait WHERE wait_id=${waitId}`)
      .toEqual([{ closed: true }]);
    await capture(page, testInfo, 'conversation-stop-recovered-1440x900');
    await assertA11y(page);
  });

  test('retries the original queued Stop confirmation after a lost response while the Run remains live', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const [auditor] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
    if (!auditor) throw new Error('The Stop journey requires its synthetic Auditor.');
    const runId = await seedRun('RUNNING');
    await page.goto(`/runs/${runId}/workspace`);
    await page.getByLabel('Message the Run', { exact: true }).fill('Stop');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.run-conversation__composer-status')).toHaveText('Message accepted.');
    const [proposal] = await sql<{ command_id: string; expected_run_revision: number }[]>`
      SELECT command_id,expected_run_revision FROM run_interaction_command WHERE run_id=${runId} AND kind='stop'`;
    if (!proposal) throw new Error('The conversation did not retain its Stop proposal.');
    await page.getByRole('button', { name: 'Review Stop', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Stop this Run?', exact: true });
    await expect(dialog).toContainText('Cancellation cannot be undone');
    await expect(dialog.getByRole('button', { name: 'Go back', exact: true })).toBeFocused();
    let dropped = false;
    const dispatches: string[] = [];
    let forwardedStatus: number | null = null;
    await page.route(`**/runs/${runId}/workspace`, async route => {
      const request = route.request();
      const fields = actionFields(request.postData());
      if (request.method() === 'POST' && request.headers()['next-action'] !== undefined &&
        fields?.runId === runId && fields.commandId === proposal.command_id) dispatches.push(request.postData() ?? '');
      if (!dropped && request.method() === 'POST' && request.headers()['next-action'] !== undefined &&
        fields?.runId === runId && fields.commandId === proposal.command_id) {
        dropped = true;
        // Execute the real authenticated request, then lose only its response. The
        // retry must discover the existing effect instead of sending new inputs.
        const response = await route.fetch();
        forwardedStatus = response.status();
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await dialog.getByRole('button', { name: 'Stop Run', exact: true }).click();
    await expect(dialog).toContainText('Retry this same confirmation');
    expect(dropped).toBe(true);
    expect(forwardedStatus).toBe(200);
    expect(await sql`SELECT state FROM audit_run WHERE run_id=${runId}`)
      .toEqual([{ state: 'RUNNING' }]);
    const beforeRetry = await sql`SELECT event_id,sequence FROM audit_events
      WHERE aggregate_id=${runId} AND event_type='lifecycle.run-cancel-requested'`;
    expect(beforeRetry).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Stop Run', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(dispatches).toHaveLength(2);
    expect(dispatches[1]).toBe(dispatches[0]);
    await expect(page.getByLabel('Conversation history')).toContainText('Stop request: awaiting worker boundary.');
    await page.reload();
    await expect(page.getByLabel('Conversation history')).toContainText('Stop request: awaiting worker boundary.');
    expect(await sql`SELECT event_id,sequence FROM audit_events
      WHERE aggregate_id=${runId} AND event_type='lifecycle.run-cancel-requested'`).toEqual(beforeRetry);
    expect(await sql`SELECT state FROM run_interaction_transition WHERE command_id=${proposal.command_id} ORDER BY sequence`)
      .toEqual([{ state: 'received' }, { state: 'interpreted' }, { state: 'queued' }]);
    expect(await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-canceled'`).toHaveLength(0);
    await capture(page, testInfo, 'conversation-stop-queued-recovered-1440x900');
    await assertA11y(page);
  });

  test('refuses conversational Stop when the proposing auditor loses authority before confirmation', async ({ page }) => {
    const [auditor] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
    if (!auditor) throw new Error('Stop requires the synthetic auditor');
    const [role] = await sql<RoleRow[]>`SELECT role,assigned_by,assigned_at::text AS assigned_at FROM user_role WHERE user_id=${auditor.id}`;
    if (!role) throw new Error('Auditor role missing');
    const runId = await seedRun('RUNNING');
    await pauseSeededRun(runId, auditor.id);
    try {
      await page.goto(`/runs/${runId}/workspace`);
      await page.getByLabel('Message the Run', { exact: true }).fill('Stop');
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect(page.locator('.run-conversation__composer-status')).toHaveText('Message accepted.');
      await page.getByRole('button', { name: 'Review Stop', exact: true }).click();
      const [beforeDenial] = await sql`SELECT count(*)::integer AS n FROM audit_events WHERE actor_id=${auditor.id} AND event_type='security.denied'`;
      await sql`DELETE FROM user_role WHERE user_id=${auditor.id}`;
      await page.getByRole('dialog', { name: 'Stop this Run?', exact: true }).getByRole('button', { name: 'Stop Run', exact: true }).click();
      // An authorized-action refusal or refreshed denied page is truthful; neither can cancel.
      await expect.poll(async () => (await sql`SELECT count(*)::integer AS n FROM audit_events WHERE actor_id=${auditor.id}
        AND event_type='security.denied'`)[0]?.n ?? 0).toBeGreaterThan(Number(beforeDenial?.n ?? 0));
      expect(await sql`SELECT state,cancel_requested_at FROM audit_run WHERE run_id=${runId}`)
        .toEqual([{ state: 'PAUSED', cancel_requested_at: null }]);
    } finally {
      await sql`INSERT INTO user_role(user_id,role,assigned_by,assigned_at)
        VALUES (${auditor.id},${role.role},${role.assigned_by},${role.assigned_at}::timestamptz)
        ON CONFLICT (user_id) DO UPDATE SET role=EXCLUDED.role,assigned_by=EXCLUDED.assigned_by,assigned_at=EXCLUDED.assigned_at`;
    }
  });

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
