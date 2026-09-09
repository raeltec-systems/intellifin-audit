import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { deriveExecutablePlan } from '@intellifin/domain';
import { initiateRun, initialPlanDerivation, planAuthoringDigest, procedureVersionRowVersion, transitionVersion, type ProcedureVersionRecord } from '@intellifin/application';
import { createDb, createSqlClient, CryptoUuidV7Generator, DrizzleProcedureRepository, DrizzleRoleRepository, PostgresProceduresUnitOfWork, PostgresRunsUnitOfWork, SystemClock, type Sql } from '@intellifin/infrastructure';
import { executablePlanInputs } from '../fixtures/executable-plan';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const managerId = `runs-e2e-${ids.next()}`;
const controlName = `E2E Run initiation ${procedureId}`;
let sql: Sql;
let auditorId: string;

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Run browser journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 2 });
  const db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the Run journey.');
  auditorId = auditor.id as string;
  await sql`INSERT INTO auth_user(id,name,email) VALUES (${managerId},'Synthetic Run fixture approver',${`${managerId}@example.test`})`;
  await sql`INSERT INTO user_role(user_id,role) VALUES (${managerId},'audit-manager')`;
  const inputs = { ...executablePlanInputs(), controlName };
  const compiled = deriveExecutablePlan(inputs);
  if (!compiled.ok) throw new Error(compiled.reason);
  let row: ProcedureVersionRecord = {
    ...inputs, ...initialPlanDerivation(), procedureId, versionId, versionNumber: 1,
    state: 'DRAFT', compiledPlan: compiled.plan, planStatus: 'succeeded', planDerivable: true,
    authorship: { createdBy: { type: 'human', id: auditorId }, responsibleAuthorId: auditorId, humanAuthorIds: [auditorId] },
  };
  row = { ...row, planInputDigest: planAuthoringDigest(row) };
  const unitOfWork = new PostgresProceduresUnitOfWork(db);
  const repository = new DrizzleProcedureRepository(db);
  await unitOfWork.execute(async context => {
    await context.procedures.insertProcedure(row);
    await context.procedures.insertVersion(row);
  });
  for (const decision of ['submit', 'approve'] as const) {
    const actor = decision === 'submit' ? auditorId : managerId;
    const outcome = await transitionVersion({ roles: new DrizzleRoleRepository(db), unitOfWork, ids }, {
      procedureId, versionId, expectedRowVersion: procedureVersionRowVersion(row),
      session: { userId: actor, sessionId: `fixture-${actor}` }, correlationId: ids.next(),
    }, decision);
    if (!outcome.ok) throw new Error(`Run fixture ${decision}: ${outcome.reason}`);
    const saved = await repository.findVersion(versionId);
    if (!saved) throw new Error('Run fixture version was not readable after decision.');
    row = saved;
  }
  expect(row.state).toBe('ACTIVE');
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM pgboss.job WHERE data->>'runId' IN (SELECT run_id::text FROM audit_run WHERE procedure_id=${procedureId})`;
    await sql`DELETE FROM run_result WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${procedureId})`;
    await sql`DELETE FROM run_evidence_package WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${procedureId})`;
    await sql`DELETE FROM run_initiation_request WHERE procedure_id=${procedureId}`;
    // A rerun link is a self-referencing foreign key, so a successor goes first.
    await sql`DELETE FROM audit_run WHERE procedure_id=${procedureId} AND predecessor_run_id IS NOT NULL`;
    await sql`DELETE FROM audit_run WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM notification WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM auth_user WHERE id=${managerId}`;
  } finally { await sql.end({ timeout: 5 }); }
});

/**
 * Drive a Run to COMPLETED the way production does: sealed Evidence package and Result.
 *
 * Generation 21 refuses a terminal Run with no `run_evidence_package` row and generation 25
 * refuses one with no `run_result` row, which is how "seal on EVERY terminal transition" is
 * enforced rather than remembered. These Runs acquired nothing, so their package is SEALED
 * over zero artifacts and their Result is a Pass over an empty population.
 */
async function terminate(runId: string): Promise<void> {
  await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
            VALUES(${runId},'SEALED','COMPLETED',now(),0,0,'[]'::jsonb,'[]'::jsonb) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
            VALUES(${runId},1,'PASS','pass',true,'COMPLETED',true,now(),NULL,'{}'::jsonb) ON CONFLICT DO NOTHING`;
  await sql`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${runId}`;
}

test.describe('Run initiation as an Auditor', () => {
  test.use({ storageState: AUTH_STATE.auditor });
  test('starts from Procedure Detail, reloads the persisted queued Run, and refuses a duplicate', async ({ page }) => {
    test.setTimeout(90_000);
    const hydrationErrors: string[] = [];
    page.on('console', message => { if (/hydrated.*didn't match|hydration failed/i.test(message.text())) hydrationErrors.push(message.text()); });
    await page.goto(`/procedures/${procedureId}`);
    await expect(page.getByRole('heading', { name: controlName, exact: true })).toBeVisible();
    await page.getByLabel('Period from', { exact: true }).fill('2026-08-01');
    await page.getByLabel('Period to', { exact: true }).fill('2026-08-31');
    await page.getByRole('button', { name: 'Initiate Run', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Initiate Run', exact: true }).click();
    // The first visit compiles this route when persistent development caching is off.
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: process.env['INTELLIFIN_LOW_DISK'] === '1' ? 30_000 : 10_000 });
    const runId = page.url().split('/').at(-1)!;
    const [stored] = await sql`SELECT * FROM audit_run WHERE run_id=${runId}`;
    expect(stored).toMatchObject({ procedure_id: procedureId, version_id: versionId, initiator_id: auditorId, state: 'QUEUED', kind: 'STANDARD' });
    expect(stored!.correlation_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await page.reload();
    // Twice on the Result tab, and both are the contract's: the record header badge and
    // the conclusion triptych's own Run lifecycle cell (Story 3.11).
    await expect(page.getByText('Queued', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(controlName, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/2026-08-01/).first()).toBeVisible();
    await expect(page.getByText(/2026-08-31/).first()).toBeVisible();
    const details = page.getByRole('region', { name: 'Run details' });
    await expect(details.getByText(runId, { exact: true })).toBeVisible();
    await expect(details.getByText(auditorId, { exact: true })).toBeVisible();
    await expect(details.getByText(stored!.correlation_id as string, { exact: true })).toBeVisible();
    await expect(details.getByText('Standard', { exact: true })).toBeVisible();
    await expect(details.getByRole('link', { name: 'v1', exact: true })).toHaveAttribute('href', `/procedures/${procedureId}/versions/${versionId}`);
    // ISO 8601 UTC with `Z`, which is the format EXPERIENCE.md fixes; Story 3.10 rendered
    // `2026-09-06 09:00:00 UTC`, which is not ISO 8601, and Story 3.11 adopted the
    // contract's own spelling on every Run surface.
    await expect(details.getByText(new Date(stored!.initiated_at as string).toISOString(), { exact: true })).toBeVisible();
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(accessibility.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help }))).toEqual([]);
    const screenshot = test.info().outputPath('queued-run.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await test.info().attach('Queued Run after reload', { path: screenshot, contentType: 'image/png' });
    const jobs = await sql`SELECT data FROM pgboss.job WHERE data->>'runId'=${runId}`;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data).toMatchObject({ runId, correlationId: stored!.correlation_id });
    const events = await sql`SELECT sequence,event_type,payload FROM audit_events WHERE aggregate_id=${runId} ORDER BY sequence`;
    expect(events).toHaveLength(1);
    expect(Number(events[0]!.sequence)).toBe(1);
    expect(events[0]).toMatchObject({ event_type: 'lifecycle.run-queued', payload: { priorState: null, state: 'QUEUED' } });

    await page.goto(`/procedures/${procedureId}`);
    await page.getByLabel('Period from', { exact: true }).fill('2026-08-01');
    await page.getByLabel('Period to', { exact: true }).fill('2026-08-31');
    await page.getByRole('button', { name: 'Initiate Run', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Initiate Run', exact: true }).click();
    await expect(page.getByText('An active Run already exists for this Procedure and period.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /existing Run/i })).toHaveAttribute('href', `/runs/${runId}`);
    const savedRuns = await sql`SELECT run_id FROM audit_run WHERE procedure_id=${procedureId}`;
    expect(savedRuns).toHaveLength(1);
    expect(hydrationErrors).toEqual([]);
  });

  test('recovers two lost acknowledgements after the original Run becomes terminal', async ({ page }) => {
    test.setTimeout(90_000);
    const detailPath = `/procedures/${procedureId}`;
    await page.goto(detailPath);
    await expect(page.locator('#initiate-run')).toHaveAttribute('data-client-ready', 'true');
    const requestToken = await page.locator('input[name="requestToken"]').inputValue();
    await page.getByLabel('Period from', { exact: true }).fill('2026-07-01');
    await page.getByLabel('Period to', { exact: true }).fill('2026-07-31');
    await page.getByRole('button', { name: 'Initiate Run', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const detailUrl = page.url().split('#')[0]!;
    await page.route(detailUrl, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch();
      await route.abort('failed');
    });
    await page.getByRole('dialog').getByRole('button', { name: 'Initiate Run', exact: true }).click();
    await expect(page.getByText('The Run could not be confirmed.', { exact: true })).toBeVisible();
    const persisted = await sql`SELECT run_id,request_token FROM audit_run WHERE procedure_id=${procedureId} AND period_from='2026-07-01' AND period_to='2026-07-31'`;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.request_token).toBe(requestToken);
    // Simulate execution completing before the caller can retry the lost acknowledgement.
    await terminate(persisted[0]!.run_id as string);
    await page.unroute(detailUrl);
    await page.getByRole('link', { name: 'Reload Procedure', exact: true }).click();
    await expect(page.locator('#initiate-run')).toHaveAttribute('data-client-ready', 'true');
    await expect(page.getByLabel('Period from', { exact: true })).toHaveValue('2026-07-01');
    await expect(page.getByLabel('Period to', { exact: true })).toHaveValue('2026-07-31');
    await expect(page.locator('input[name="requestToken"]')).toHaveValue(requestToken);
    await expect(page.getByLabel('Period from', { exact: true })).toHaveAttribute('readonly', '');
    const recoveryUrl = page.url().split('#')[0]!;
    await page.route(recoveryUrl, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch();
      await route.abort('failed');
    });
    await page.getByRole('button', { name: 'Retry same period', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Initiate Run', exact: true }).click();
    await expect(page.getByText('The Run could not be confirmed.', { exact: true })).toBeVisible();
    await page.unroute(recoveryUrl);
    // This recovery URL is already current: another anchor navigation must still reload.
    await page.getByRole('link', { name: 'Reload Procedure', exact: true }).click();
    await expect(page.locator('#initiate-run')).toHaveAttribute('data-client-ready', 'true');
    await expect(page.getByLabel('Period from', { exact: true })).toHaveValue('2026-07-01');
    await expect(page.getByLabel('Period to', { exact: true })).toHaveValue('2026-07-31');
    await expect(page.locator('input[name="requestToken"]')).toHaveValue(requestToken);
    await page.getByRole('button', { name: 'Retry same period', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Initiate Run', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/runs/${persisted[0]!.run_id}$`));
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
    // This fixture writes an EMPTY publication document, which is storable — the column's
    // CHECK says only that it is an object. The surface must say so and still show the
    // outcome, the seal and the version, rather than answering a framework 500.
    await expect(page.getByText('The published Result document could not be read.')).toHaveCount(1);
    await expect(page.getByText('Pass', { exact: true }).first()).toBeVisible();
    expect(await sql`SELECT run_id FROM audit_run WHERE procedure_id=${procedureId} AND period_from='2026-07-01' AND period_to='2026-07-31'`).toHaveLength(1);
    expect(await sql`SELECT id FROM pgboss.job WHERE data->>'runId'=${persisted[0]!.run_id}`).toHaveLength(1);
  });
  test('cancels a queued Run from Run Detail, and reruns the terminal Run it leaves', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/procedures/${procedureId}`);
    await page.getByLabel('Period from', { exact: true }).fill('2026-04-01');
    await page.getByLabel('Period to', { exact: true }).fill('2026-04-30');
    await page.getByRole('button', { name: 'Initiate Run', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Initiate Run', exact: true }).click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: process.env['INTELLIFIN_LOW_DISK'] === '1' ? 30_000 : 10_000 });
    const runId = page.url().split('/').at(-1)!;
    expect(await sql`SELECT id FROM pgboss.job WHERE data->>'runId'=${runId}`).toHaveLength(1);

    // EXPERIENCE.md makes cancel a routine confirmation that restates the consequence,
    // and a focus-trapping dialog cannot exist before React attaches its handlers. Prove
    // hydration rather than racing it: a click that lands first does nothing at all.
    await expect(page.locator('#run-lifecycle')).toHaveAttribute('data-client-ready', 'true');
    await page.getByRole('button', { name: 'Cancel Run', exact: true }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText('Evidence already collected is preserved')).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel Run', exact: true }).click();
    await expect(page.getByText('Run canceled.', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText('Canceled', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(new RegExp(`Canceled by ${auditorId} at `))).toBeVisible();
    // A queued Run has no process holding it, so the web finished the job: the dispatch
    // job is gone in the same transaction that wrote CANCELED.
    expect(await sql`SELECT id FROM pgboss.job WHERE data->>'runId'=${runId}`).toHaveLength(0);
    expect(await sql`SELECT state FROM audit_run WHERE run_id=${runId}`).toMatchObject([{ state: 'CANCELED' }]);
    expect(await sql`SELECT outcome FROM run_result WHERE run_id=${runId}`).toMatchObject([{ outcome: 'CANCELED' }]);
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(accessibility.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help }))).toEqual([]);

    // A terminal Run offers a rerun instead, and the predecessor is left alone.
    const [before] = await sql`SELECT * FROM audit_run WHERE run_id=${runId}`;
    await expect(page.locator('#run-lifecycle')).toHaveAttribute('data-client-ready', 'true');
    await page.getByRole('button', { name: 'Rerun', exact: true }).click();
    const rerunDialog = page.getByRole('dialog');
    await expect(rerunDialog.getByText('This Run remains unchanged.')).toBeVisible();
    await rerunDialog.getByRole('button', { name: 'Start the new Run', exact: true }).click();
    await expect(page.getByText('A new Run is queued.', { exact: true })).toBeVisible();
    const [successor] = await sql`SELECT run_id::text AS id,period_from::text AS f,period_to::text AS t,rerun_reason FROM audit_run WHERE predecessor_run_id=${runId}`;
    expect(successor).toMatchObject({ f: '2026-04-01', t: '2026-04-30' });
    expect(successor!.rerun_reason).not.toBeNull();
    expect(await sql`SELECT * FROM audit_run WHERE run_id=${runId}`).toEqual([before]);

    await page.getByRole('link', { name: 'Open the linked Run', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/runs/${successor!.id as string}$`));
    await expect(page.getByText('Queued', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: runId, exact: true })).toBeVisible();
    // Cancel the successor so the Procedure has no active Run left behind. This click is
    // the one that races hydration: the anchor above did a full document navigation.
    await expect(page.locator('#run-lifecycle')).toHaveAttribute('data-client-ready', 'true');
    await page.getByRole('button', { name: 'Cancel Run', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel Run', exact: true }).click();
    await expect(page.getByText('Run canceled.', { exact: true })).toBeVisible();
  });

  test('returns safe not-found pages for malformed and absent Run IDs', async ({ page }) => {
    for (const id of ['not-a-run-id', ids.next()]) {
      const response = await page.goto(`/runs/${id}`);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole('heading', { name: 'Run details', exact: true })).toHaveCount(0);
    }
  });
  test('validates recovery URLs and gives fresh visits fresh request tokens', async ({ page }) => {
    await page.goto(`/procedures/${procedureId}`);
    const first = await page.locator('input[name="requestToken"]').inputValue();
    await page.reload();
    expect(await page.locator('input[name="requestToken"]').inputValue()).not.toBe(first);
    for (const query of ['requestToken=bad&from=2026-07-01&to=2026-07-31', `requestToken=${first}&from=2026-02-30&to=2026-03-01`, `requestToken=${first}`]) {
      const response = await page.goto(`/procedures/${procedureId}?${query}`);
      expect(response?.status()).toBe(404);
    }
  });
});

test.describe('Native Run initiation', () => {
  test.use({ storageState: AUTH_STATE.auditor, javaScriptEnabled: false });
  test('submits and recovers the same terminal Run without JavaScript', async ({ page }) => {
    await page.goto(`/procedures/${procedureId}`);
    const token = await page.locator('input[name="requestToken"]').inputValue();
    await page.getByLabel('Period from', { exact: true }).fill('2026-05-01');
    await page.getByLabel('Period to', { exact: true }).fill('2026-05-31');
    await page.getByRole('button', { name: 'Initiate Run', exact: true }).click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
    const runId = new URL(page.url()).pathname.split('/').at(-1)!;
    await terminate(runId);
    await page.goto(`/procedures/${procedureId}?requestToken=${token}&from=2026-05-01&to=2026-05-31`);
    await page.getByRole('button', { name: 'Retry same period', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
    expect(await sql`SELECT run_id FROM audit_run WHERE procedure_id=${procedureId} AND period_from='2026-05-01' AND period_to='2026-05-31'`).toHaveLength(1);
    expect(await sql`SELECT id FROM pgboss.job WHERE data->>'runId'=${runId}`).toHaveLength(1);
  });
});

test.describe('Run access as an administrator', () => {
  test.use({ storageState: AUTH_STATE.administrator });
  test('refuses initiation data without exposing the Procedure', async ({ page }) => {
    await page.goto(`/procedures/${procedureId}`);
    await expect(page.getByText('PoC Administrator cannot author Procedures or start Runs.', { exact: true })).toBeVisible();
    await expect(page.getByText(controlName, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Initiate Run', exact: true })).toHaveCount(0);
  });
  test('denies direct Run URLs before exposing existence or stored facts', async ({ page }) => {
    const db = createDb(sql);
    const started = await initiateRun({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock: new SystemClock() }, { session: { userId: auditorId, sessionId: 'run-access-fixture' }, request: { procedureId, requestToken: ids.next(), period: { from: '2026-06-01', to: '2026-06-30' } } });
    if (!started.ok) throw new Error(started.reason);
    for (const id of [started.runId, 'malformed', ids.next()]) {
      await page.goto(`/runs/${id}`);
      await expect(page.getByText('PoC Administrator cannot author Procedures or start Runs.', { exact: true })).toBeVisible();
      await expect(page.getByText(controlName, { exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Run details', exact: true })).toHaveCount(0);
    }
  });
});
