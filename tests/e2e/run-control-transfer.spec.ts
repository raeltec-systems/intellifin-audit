import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { cancelRun, performCancellation } from '@intellifin/application';
import { DrizzleRoleRepository, PostgresRunCancellationRepository, PostgresRunsUnitOfWork, SystemClock, createDb, createSqlClient, CryptoUuidV7Generator, PostgresProceduresUnitOfWork, type Sql } from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, PASSWORD, assertThrowawayDatabase, signIn } from './accounts';

const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const runId = ids.next();
const name = `Transfer Manager ${ids.next()}`;
const email = `transfer-${ids.next()}@synthetic.invalid`;
const otherEmail = `transfer-other-${ids.next()}@synthetic.invalid`;
let sql: Sql;
let auditorId = '';
let auditorName = '';
let retainedRecovery = '';
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the transfer browser journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 5 });
  const [auditor] = await sql<{ id: string; name: string }[]>`SELECT id,name FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the browser Auditor first.');
  auditorId = auditor.id; auditorName = auditor.name;
  const version = activeRunVersion(procedureId, versionId, auditorId);
  await new PostgresProceduresUnitOfWork(createDb(sql)).execute(async context => {
    await context.procedures.insertProcedure(version); await context.procedures.insertVersion(version);
  });
  const at = new Date().toISOString();
  const until = new Date(Date.now() + 3_600_000).toISOString();
  await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
    procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
    VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Manager transfer journey',
    '2026-08-01','2026-08-01','RUNNING','STANDARD',${auditorId},'transfer-fixture','auditor',${at})`;
  await sql`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
    VALUES(${runId},1,'POPULATION_READY',1,${at},${at},${until},'session-1',${ids.next()})`;
  await sql`INSERT INTO run_execution(run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
    VALUES(${runId},1,'EXECUTING',1,${at},${at},${at},${until},${ids.next()})`;
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    await sql.begin(async tx => {
      await tx`DELETE FROM notification WHERE run_id=${runId}`;
      await tx`DELETE FROM run_result_review WHERE run_id=${runId}`;
      await tx`DELETE FROM run_result WHERE run_id=${runId}`;
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
    await sql`DELETE FROM auth_user WHERE email=${email} OR email=${otherEmail}`;
  } finally { await sql.end({ timeout: 5 }); }
});

test('explicit grant, review, reload and lost-response recovery update both authenticated viewers', async ({ browser }) => {
  test.setTimeout(180_000);
  const adminContext = await browser.newContext({ storageState: AUTH_STATE.administrator });
  const auditorContext = await browser.newContext({ storageState: AUTH_STATE.auditor });
  const managerContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const auditor = await auditorContext.newPage();
  const manager = await managerContext.newPage();
  await manager.setViewportSize({ width: 1280, height: 800 });
  try {
    await admin.goto('/administration');
    await admin.getByLabel('Email address').fill(email);
    await admin.getByLabel('Full name').fill(name);
    await admin.getByLabel('Initial password').fill(PASSWORD);
    await admin.getByLabel('Role', { exact: true }).selectOption('audit-manager');
    await admin.getByRole('button', { name: 'Create user', exact: true }).click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Create user', exact: true }).click();
    const row = admin.getByRole('row').filter({ hasText: email });
    await expect(row).toContainText('Not granted');
    await signIn(manager, email);
    await auditor.goto(`/runs/${runId}/workspace`);
    const auditorControl = auditor.getByRole('region', { name: 'Run controller', exact: true });
    await auditorControl.getByRole('button', { name: 'Acquire control', exact: true }).click();
    await expect(auditorControl).toContainText('You control this Run.');
    await manager.goto(`/runs/${runId}/workspace`);
    const managerControl = manager.getByRole('region', { name: 'Run controller', exact: true });
    await expect(managerControl).toContainText(`Current controller: ${auditorName}.`);
    await expect(managerControl.getByRole('button', { name: 'Transfer control to me' })).toHaveCount(0);
    await row.getByRole('button', { name: 'Grant transfer permission' }).click();
    await expect(admin.getByRole('dialog')).toContainText(name);
    await admin.getByRole('dialog').getByRole('button', { name: 'Grant permission', exact: true }).click();
    await expect(row).toContainText('Granted');
    await manager.reload();
    await managerControl.getByRole('button', { name: 'Transfer control to me' }).click();
    await manager.keyboard.press('Escape');
    await expect(manager.getByRole('dialog')).toHaveCount(0);
    await expect(managerControl).toBeFocused();
    await managerControl.getByRole('button', { name: 'Transfer control to me' }).click();
    // Identical validation failures must not leave the confirmation latch closed.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await manager.getByLabel('Rationale').fill('x'.repeat(1001));
      await manager.getByRole('dialog').getByRole('button', { name: 'Review transfer' }).click();
      await expect(manager.getByRole('dialog')).toContainText('Give a reason of at most 1,000 characters.');
    }
    await manager.getByLabel('Rationale').fill('Covering the current controller during the review handover.');
    await manager.getByRole('dialog').getByRole('button', { name: 'Review transfer' }).click();
    await expect(manager.getByRole('dialog')).toContainText(`${name} will take control from ${auditorName}`);
    await expect(manager.getByRole('dialog')).toContainText('Accepted Pause and Stop requests remain in effect.');
    await expect(manager.getByRole('region', { name: 'Transfer reason source' })).toContainText('review handover');
    const [before] = await sql<{ epoch: number; holder_id: string }[]>`SELECT epoch,holder_id FROM run_control_lease WHERE run_id=${runId}`;
    expect(before?.holder_id).toBe(auditorId);
    await manager.keyboard.press('Escape');
    await expect(manager.getByRole('dialog')).toHaveCount(0);
    await expect(managerControl).toBeFocused();
    expect((await sql`SELECT holder_id FROM run_control_lease WHERE run_id=${runId}`)[0]?.holder_id).toBe(auditorId);

    await managerControl.getByRole('button', { name: 'Transfer control to me' }).click();
    // A maximum unbroken reason stays inside a labelled source viewport.
    await manager.getByLabel('Rationale').fill('r'.repeat(1000));
    await manager.getByRole('dialog').getByRole('button', { name: 'Review transfer' }).click();
    await expect(manager.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    const source = manager.getByRole('region', { name: 'Transfer reason source' });
    await expect(source).toContainText('r'.repeat(1000));
    const geometry = await manager.getByRole('dialog').evaluate(element => ({
      width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right,
      buttonsBottom: element.querySelector('.ls-dialog__actions')!.getBoundingClientRect().bottom,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
    }));
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.buttonsBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    await source.focus(); await expect(source).toBeFocused();
    expect((await new AxeBuilder({ page: manager }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    // A remount of an UNCONFIRMED proposal must recover review, never apply it.
    await manager.reload();
    await managerControl.getByRole('button', { name: 'Recover transfer request' }).click();
    await expect(manager.getByRole('dialog')).toContainText('r'.repeat(1000));
    expect((await sql`SELECT holder_id FROM run_control_lease WHERE run_id=${runId}`)[0]?.holder_id).toBe(auditorId);

    let dropped = false;
    const confirmations: string[] = [];
    await manager.route(`**/runs/${runId}/workspace`, async route => {
      const request = route.request();
      if (request.method() === 'POST' && request.headers()['next-action']) {
        const args: unknown = JSON.parse(request.postData() ?? 'null');
        const fields = Array.isArray(args) ? args[0] as Record<string, unknown> | undefined : undefined;
        if (fields?.commandId && Object.keys(fields).length === 2) {
          confirmations.push(String(fields.commandId));
          if (!dropped) { dropped = true; expect((await route.fetch()).status()).toBe(200); await route.abort('failed'); return; }
        }
      }
      await route.continue();
    });
    await manager.getByRole('dialog').getByRole('button', { name: 'Confirm transfer', exact: true }).click();
    await expect.poll(() => dropped).toBe(true);
    await expect(auditorControl).toContainText(`Current controller: ${name}.`, { timeout: 20_000 });
    retainedRecovery = await manager.evaluate(() => sessionStorage.getItem('intellifin.control-transfers.v2') ?? '');
    expect(retainedRecovery).not.toBe('');
    if (await manager.getByRole('dialog').count()) {
      await manager.keyboard.press('Escape');
      await expect(manager.getByRole('dialog')).toHaveCount(0);
      await expect(managerControl).toBeFocused();
    }
    await manager.reload();
    await managerControl.getByRole('button', { name: 'Recover transfer request' }).click();
    await expect(managerControl).toContainText('You control this Run.');
    expect(confirmations).toHaveLength(2); expect(confirmations[1]).toBe(confirmations[0]);
    const [after] = await sql<{ epoch: number; holder_id: string }[]>`SELECT epoch,holder_id FROM run_control_lease WHERE run_id=${runId}`;
    expect(after?.epoch).toBe(before!.epoch + 1);
    const receipts = await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-control-lease-transferred'`;
    expect(receipts).toHaveLength(1);
    await expect(auditorControl.getByRole('button', { name: 'Transfer control to me' })).toHaveCount(0);
    await row.getByRole('button', { name: 'Revoke transfer permission' }).click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Revoke permission', exact: true }).click();
    await expect(row).toContainText('Not granted');
  } finally {
    await Promise.allSettled([adminContext.close(), auditorContext.close(), managerContext.close()]);
  }
});


test('historical and terminal receipt recovery never claims present ownership, and account change discards the old reason', async ({ browser }) => {
  test.setTimeout(120_000);
  const adminContext = await browser.newContext({ storageState: AUTH_STATE.administrator });
  const auditorContext = await browser.newContext({ storageState: AUTH_STATE.auditor });
  const managerContext = await browser.newContext();
  const admin = await adminContext.newPage(); const auditor = await auditorContext.newPage(); const manager = await managerContext.newPage();
  try {
    await admin.goto('/administration');
    const row = admin.getByRole('row').filter({ hasText: email });
    await row.getByRole('button', { name: 'Grant transfer permission' }).click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Grant permission', exact: true }).click();
    await expect(row).toContainText('Granted');
    await admin.getByLabel('Email address').fill(otherEmail);
    await admin.getByLabel('Full name').fill('Second transfer manager');
    await admin.getByLabel('Initial password').fill(PASSWORD);
    await admin.getByLabel('Role', { exact: true }).selectOption('audit-manager');
    await admin.getByRole('button', { name: 'Create user', exact: true }).click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Create user', exact: true }).click();
    const otherRow = admin.getByRole('row').filter({ hasText: otherEmail });
    await otherRow.getByRole('button', { name: 'Grant transfer permission' }).click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Grant permission', exact: true }).click();
    await expect(otherRow).toContainText('Granted');
    await signIn(manager, email);
    await manager.goto(`/runs/${runId}/workspace`);
    const managerControl = manager.getByRole('region', { name: 'Run controller', exact: true });
    await managerControl.getByRole('button', { name: 'Release control', exact: true }).click();
    await expect(managerControl).toContainText('No auditor currently holds control.');
    await auditor.goto(`/runs/${runId}/workspace`);
    const auditorControl = auditor.getByRole('region', { name: 'Run controller', exact: true });
    await auditorControl.getByRole('button', { name: 'Acquire control', exact: true }).click();
    await expect(auditorControl).toContainText('You control this Run.');
    const epoch = (await sql`SELECT epoch FROM run_control_lease WHERE run_id=${runId}`)[0]!.epoch;
    await manager.evaluate(value => sessionStorage.setItem('intellifin.control-transfers.v2', value), retainedRecovery);
    await manager.reload();
    await managerControl.getByRole('button', { name: 'Recover transfer request' }).click();
    await expect(managerControl).toContainText(`Current controller: ${auditorName}.`);
    await expect(managerControl).not.toContainText('You control this Run.');
    expect((await sql`SELECT epoch FROM run_control_lease WHERE run_id=${runId}`)[0]!.epoch).toBe(epoch);

    const db = createDb(sql); const repository = new PostgresRunCancellationRepository(db);
    expect(await cancelRun({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), repository, ids, clock: new SystemClock() },
      { session: { userId: auditorId, sessionId: 'terminal-transfer-fixture' }, request: { runId, reason: 'End receipt recovery fixture.' } })).toMatchObject({ ok: true });
    await repository.transaction(runId, async context => {
      if (!context.run?.cancellation) throw new Error('The fixture must retain the actual cancellation marker.');
      await performCancellation(context, { run: context.run, request: context.run.cancellation, at: new Date().toISOString(), plan: await context.frozenPlan(), source: 'worker' });
    });
    await manager.evaluate(value => sessionStorage.setItem('intellifin.control-transfers.v2', value), retainedRecovery);
    await manager.reload();
    await managerControl.getByRole('button', { name: 'Recover transfer request' }).click();
    await expect(managerControl).toContainText('Control transfer recorded.');
    await expect(managerControl.getByRole('button', { name: 'Recover transfer request' })).toHaveCount(0);
    await expect(managerControl).not.toContainText('You control this Run.');
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${runId}`)[0]!.state).toBe('CANCELED');
    expect((await sql`SELECT epoch FROM run_control_lease WHERE run_id=${runId}`)[0]!.epoch).toBe(epoch);

    // Sign-out keeps browser storage; the next authenticated identity read must discard it.
    await manager.evaluate(value => sessionStorage.setItem('intellifin.control-transfers.v2', value), retainedRecovery);
    await manager.getByRole('button', { name: 'Sign out', exact: true }).click();
    await signIn(manager, otherEmail);
    await manager.goto(`/runs/${runId}/workspace`);
    await expect(managerControl.getByRole('button', { name: 'Recover transfer request' })).toHaveCount(0);
    await expect.poll(() => manager.evaluate(() => sessionStorage.getItem('intellifin.control-transfers.v2'))).toBe('[]');
    await expect(managerControl).not.toContainText('r'.repeat(1000));
  } finally { await Promise.allSettled([adminContext.close(), auditorContext.close(), managerContext.close()]); }
});
