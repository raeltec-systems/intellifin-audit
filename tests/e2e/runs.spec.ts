import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { deriveExecutablePlan } from '@intellifin/domain';
import { initiateRun, initialPlanDerivation, planAuthoringDigest, procedureVersionRowVersion, transitionVersion, type ProcedureVersionRecord } from '@intellifin/application';
import { createDb, createSqlClient, CryptoUuidV7Generator, DrizzleProcedureRepository, DrizzleRoleRepository, PostgresProceduresUnitOfWork, PostgresRunsUnitOfWork, SystemClock, type Sql } from '@intellifin/infrastructure';
import { executablePlanInputs } from '../fixtures/executable-plan';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { RUN_STARTS_ON_CONFIRM_SENTENCE, START_RUN_LINK_LABEL } from '../../apps/web/src/design/run-start-words';
import { FRESHNESS_ADVICE, STOP_REASON_TITLE } from '../../apps/web/src/runs/stop-reason';
import { EMPTY_STATES } from '../../apps/web/src/design/copy';
import { shortReference } from '../../apps/web/src/design/references';
import { NEXT_RUN_MANUAL, NO_RUN_YET, OPEN_LAST_RUN } from '../../apps/web/src/procedures/last-run-words';

const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const managerId = `runs-e2e-${ids.next()}`;
const controlName = `E2E Run initiation ${procedureId}`;
let sql: Sql;
let auditorId: string;
let auditorName: string;

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Run browser journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 2 });
  const db = createDb(sql);
  const [auditor] = await sql`SELECT id, name FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the Run journey.');
  auditorId = auditor.id as string;
  auditorName = auditor.name as string;
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
    await sql`DELETE FROM population_snapshot WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${procedureId})`;
    await sql`DELETE FROM population_execution WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${procedureId})`;
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

/**
 * A Run that stopped at acquisition because its snapshot was stale, seeded the way the
 * population stage leaves one: the checkpoint TERMINAL with the failed check's name, the
 * snapshot carrying the declared generation time, the package sealed over nothing and the
 * Result Inconclusive (generations 21 and 25 refuse a terminal Run without those two).
 * This is the production shape of 2026-09-15, when a page of such Runs read as "all the
 * runs failed" with the reason only on the Timeline tab.
 */
async function stoppedAtAcquisition(runId: string, period: { from: string; to: string }, generatedAt: string): Promise<void> {
  await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,
              period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
            VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,${controlName},
              ${period.from},${period.to},'QUEUED','STANDARD',${auditorId},'stop-reason-fixture','auditor',now())`;
  await sql`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,diagnostic,step_id,attempt_id)
            VALUES(${runId},1,'TERMINAL',1,now(),now(),now(),'freshness','population',${ids.next()})`;
  await sql`INSERT INTO population_snapshot(run_id,included,excluded,indeterminate,rows_digest,checks,generated_at,declared_count,retrieved_count)
            VALUES(${runId},0,0,0,NULL,'[{"name":"freshness","passed":false}]'::jsonb,${generatedAt}::timestamptz,0,0)`;
  await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
            VALUES(${runId},'SEALED','INCONCLUSIVE',now(),0,0,'[]'::jsonb,'[]'::jsonb)`;
  await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
            VALUES(${runId},1,'INCONCLUSIVE','gate-failed',true,'INCONCLUSIVE',false,now(),NULL,'{}'::jsonb)`;
  await sql`UPDATE audit_run SET state='INCONCLUSIVE' WHERE run_id=${runId}`;
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
    // `[REWRITTEN 2026-09-23, UI cleanup UX-02 and UX-19]` The Result reads conclusion
    // first. The Run's own facts are "About this test run", in a person's words — the
    // Procedure and version, the period, who started it and when, the kind and a short
    // reference — and the exact identifiers and instants are under the frame's closed
    // Technical details, once, on every Run tab.
    await expect(page.locator('.ls-page-header')).toContainText('1–31 Aug 2026');
    const details = page.getByRole('region', { name: 'About this test run' });
    await expect(details).toContainText('1–31 Aug 2026');
    await expect(details).toContainText(`Run ${shortReference(runId)}`);
    await expect(details.getByText('Standard', { exact: true })).toBeVisible();
    await expect(details.getByRole('link', { name: `${controlName} · v1`, exact: true })).toHaveAttribute('href', `/procedures/${procedureId}/versions/${versionId}`);
    await expect(details).not.toContainText(runId);
    const technical = page.locator('details.ls-technical').filter({ hasText: 'Started by (user identifier)' });
    await expect(technical).not.toHaveAttribute('open', /.*/);
    await technical.locator('> summary').click();
    await expect(technical.getByText('2026-08-01 → 2026-08-31', { exact: true })).toBeVisible();
    await expect(technical.getByText(runId, { exact: true })).toBeVisible();
    await expect(technical.getByText(auditorId, { exact: true })).toBeVisible();
    await expect(technical.getByText(stored!.correlation_id as string, { exact: true })).toBeVisible();
    // ISO 8601 UTC with `Z`, which is the format EXPERIENCE.md fixes; Story 3.10 rendered
    // `2026-09-06 09:00:00 UTC`, which is not ISO 8601, and Story 3.11 adopted the
    // contract's own spelling on every Run surface. It is the exact instant, so it lives
    // under Technical details; the page itself says it in words.
    await expect(technical.getByText(new Date(stored!.initiated_at as string).toISOString(), { exact: true })).toBeVisible();
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

  test('the Active version card opens Initiate Run with the saved dates filled in', async ({ page }) => {
    // The fixture is a one-time version over August 2026, so its card offers a Run over
    // those dates and the auditor only confirms. Nothing is confirmed here, so no Run is
    // left behind for the journeys after this one to collide with.
    await page.goto(`/procedures/${procedureId}`);
    await page.getByRole('link', { name: START_RUN_LINK_LABEL, exact: true }).click();
    await expect(page).toHaveURL(/#initiate-run$/);
    await expect(page.getByLabel('Period from', { exact: true })).toHaveValue('2026-08-01');
    await expect(page.getByLabel('Period to', { exact: true })).toHaveValue('2026-08-31');
    // A suggestion is not a lost request: the fields stay editable.
    await expect(page.getByLabel('Period from', { exact: true })).not.toHaveAttribute('readonly', '');
    await expect(page.locator('#initiate-run')).toContainText(RUN_STARTS_ON_CONFIRM_SENTENCE);
  });

  test('the Runs list names the initiator and says why a stopped Run stopped, on the list and on the Run', async ({ page }) => {
    const runId = ids.next();
    await stoppedAtAcquisition(runId, { from: '2026-09-01', to: '2026-09-15' }, '2026-09-01T00:00:00Z');
    await page.goto('/runs');
    // `[REWRITTEN 2026-09-22, UX-17]` The row's one link is the Procedure's NAME now, so
    // the row is found by where its link goes rather than by a UUID as its text.
    const row = page.getByRole('row').filter({ has: page.locator(`a[href="/runs/${runId}"]`) });
    await expect(row).toBeVisible();
    // The person, never the id: a user id is what the row holds because an address cannot
    // enter the chain, and printing it here was the platform speaking its own language.
    await expect(row).toContainText(auditorName);
    await expect(row).not.toContainText(auditorId);
    // The reason, in words, with both dates and what to do. The code word stays on the
    // Timeline tab, where it is data.
    await expect(row).toContainText('The source snapshot was generated on 2026-09-01, before the period ended on 2026-09-15.');
    await expect(row).toContainText(FRESHNESS_ADVICE);
    await expect(row).not.toContainText('freshness');
    // `[REWRITTEN 2026-09-22, UX-17]` This used to pin the raw id AS the link text, wrapped
    // at its hyphens. The contract's revised Run cell names the Procedure, with the short
    // reference beneath it, and the whole identifier is no longer loose on the row at all.
    const link = row.getByRole('link', { name: controlName, exact: true });
    await expect(link).toHaveAttribute('href', `/runs/${runId}`);
    await expect(row).toContainText(`Run ${shortReference(runId)}`);
    await expect(row).not.toContainText(runId);

    await page.goto(`/runs/${runId}`);
    await expect(page.getByText(STOP_REASON_TITLE, { exact: true })).toBeVisible();
    await expect(page.getByText(/generated on 2026-09-01, before the period ended on 2026-09-15/)).toBeVisible();
    // `[REWRITTEN 2026-09-23, UI cleanup UX-19]` The person is named in "About this test
    // run"; their user id is under the frame's Technical details, never loose on the page.
    const details = page.getByRole('region', { name: 'About this test run' });
    await expect(details).toContainText(auditorName);
    await expect(details).not.toContainText(auditorId);
    const technical = page.locator('details.ls-technical').filter({ hasText: 'Started by (user identifier)' });
    await technical.locator('> summary').click();
    await expect(technical.getByText(auditorId, { exact: true })).toBeVisible();
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(accessibility.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help }))).toEqual([]);
  });

  // `[ADDED 2026-09-22, UI cleanup UX-17]` Ten columns and a raw UUID as the row's own name
  // scrolled the WHOLE PAGE sideways at a laptop's width — the one thing EXPERIENCE.md's
  // responsive rules forbid. The revised six columns must fit at both sizes the owner's
  // walkthrough was taken at, and the Procedure name — the row's one link — must stay a
  // readable column rather than collapsing into a strip of one-word lines.
  test('the Runs table fits at 1366×768 and 1280×720 with no page scroll, and the Run cell stays readable', async ({
    page,
  }) => {
    const runId = ids.next();
    // A genuinely wide row: a long Procedure name, a badge, a reason sentence and advice —
    // exactly the row that scrolled the page before the repair.
    await stoppedAtAcquisition(runId, { from: '2026-09-01', to: '2026-09-15' }, '2026-09-01T00:00:00Z');
    for (const size of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
      await page.setViewportSize(size);
      await page.goto('/runs');
      const link = page.locator(`a[href="/runs/${runId}"]`);
      // VISIBLE, not only present. The table streams in behind a Suspense boundary, and
      // React holds a streamed segment in a `hidden` block until it reveals it: the link is
      // in the DOM with its text before it has a box. Measured then, the width check below
      // read a cell with no box, and the overflow check measured the skeleton, not the table.
      await expect(link).toBeVisible();
      await expect(link).toHaveText(controlName);
      // The contract's own rule: no list or table scrolls the whole page sideways.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `page scrolled sideways by ${overflow}px at ${size.width}×${size.height}`).toBeLessThanOrEqual(0);
      // The row header's own min-width (`.ls-table th[scope='row']`, 16rem) is what stops
      // the Procedure name wrapping one word per line; a column collapsed to the link's
      // own glyph width would fail this long before it failed a scroll check.
      const cell = page.locator("th[scope='row']").filter({ has: link });
      await expect(cell).toBeVisible();
      const box = await cell.boundingBox();
      expect(box, 'the Run cell must have a measurable box').not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(200);
    }
  });

  test('the Overview and the Procedure card say what the Runs register says', async ({ page }) => {
    // Owner findings RUN-04 and RUN-05. The Overview rendered its two empty states
    // UNCONDITIONALLY — "Nothing needs attention", "none is Inconclusive or Run Failed",
    // "No Runs yet" — beside a register holding stopped Runs, and every Procedure card
    // said "No Runs yet" and "No outcome" beside a Procedure that had run. Both surfaces
    // read facts now, and this is the assertion that the three of them agree.
    const runId = ids.next();
    await stoppedAtAcquisition(runId, { from: '2026-09-01', to: '2026-09-15' }, '2026-09-01T00:00:00Z');

    await page.goto('/');
    const attention = page.getByRole('region', { name: 'Needs attention' });
    await expect(attention).toContainText(controlName);
    // The reason, in the auditor's words, from the same `stopReason` the register reads.
    await expect(attention).toContainText('The source snapshot was generated on 2026-09-01, before the period ended on 2026-09-15.');
    await expect(attention).toContainText(FRESHNESS_ADVICE);
    await expect(attention).not.toContainText('freshness');
    // An empty state is a statement about the environment, and this one would be false.
    await expect(page.getByText(EMPTY_STATES.overviewNothingNeedsAttention.headline)).toHaveCount(0);
    await expect(page.getByText(EMPTY_STATES.overviewNoRuns.sentence)).toHaveCount(0);

    const recent = page.getByRole('region', { name: 'Recent Runs' });
    // `[REWRITTEN 2026-09-22, UX-02]` Named by its short reference, never its raw UUID.
    await expect(recent.getByRole('link', { name: `Run ${shortReference(runId)}`, exact: true })).toHaveAttribute('href', `/runs/${runId}`);
    await expect(recent).not.toContainText(runId);
    await expect(recent).toContainText(auditorName);

    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(accessibility.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help }))).toEqual([]);

    await page.goto('/procedures');
    // `[REWRITTEN 2026-09-22, UX-04]` The card no longer repeats `NEXT_RUN_MANUAL` on every
    // row; the list says it ONCE, above every card, and the card itself names the PLANNED
    // frequency or that none is set — a different fact from "nothing schedules a Run".
    await expect(page.getByText(NEXT_RUN_MANUAL)).toBeVisible();
    const card = page.locator('li.ls-card').filter({ hasText: controlName });
    await expect(card).toBeVisible();
    await expect(card).not.toContainText(NEXT_RUN_MANUAL);
    // A Run that issued no conclusion is not a Procedure that never ran.
    await expect(card).toContainText('No conclusion issued');
    await expect(card).toContainText(FRESHNESS_ADVICE);
    await expect(card).not.toContainText(NO_RUN_YET);
    await expect(card).not.toContainText('No outcome');
    await expect(card.getByRole('link', { name: OPEN_LAST_RUN, exact: true })).toBeVisible();
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
    // Once the page has re-read the Run, the server's own banner names the person, and the
    // control's transitional "Run canceled." is gone: the state it announced has settled
    // (UI cleanup UX-49). Asserting the transitional sentence raced that re-read, which a
    // fast machine wins — `flag-run.spec.ts` asserts the same pair for a RUNNING Run.
    await expect(page.getByText(new RegExp(`Canceled by ${auditorName} at `))).toBeVisible();
    await expect(page.getByText('Run canceled.', { exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByText('Canceled', { exact: true }).first()).toBeVisible();
    // The PERSON, not their id: this spec used to pin the id as the expected text, which
    // is how `pause-resume.spec.ts` once required "Paused by 019a3c…" of a green test.
    await expect(page.getByText(new RegExp(`Canceled by ${auditorName} at `))).toBeVisible();
    await expect(page.getByText(new RegExp(`Canceled by ${auditorId} at `))).toHaveCount(0);
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
    // The successor names its predecessor by a short reference (UI cleanup UX-31), linked.
    await expect(page.getByRole('region', { name: 'About this test run' }).getByRole('link', { name: `Run ${shortReference(runId)}`, exact: true })).toHaveAttribute('href', `/runs/${runId}`);
    // Cancel the successor so the Procedure has no active Run left behind. This click is
    // the one that races hydration: the anchor above did a full document navigation.
    await expect(page.locator('#run-lifecycle')).toHaveAttribute('data-client-ready', 'true');
    await page.getByRole('button', { name: 'Cancel Run', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel Run', exact: true }).click();
    await expect(page.getByText(new RegExp(`Canceled by ${auditorName} at `))).toBeVisible();
    expect(await sql`SELECT state FROM audit_run WHERE run_id=${successor!.id as string}`).toMatchObject([{ state: 'CANCELED' }]);
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
