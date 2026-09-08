import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { GATE_CHECKS } from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  type Sql,
} from '@intellifin/infrastructure';

import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * The Runs list and the five Run Detail tabs, in a real browser (Story 3.11).
 *
 * The Runs are seeded directly rather than executed: the point of this story is what an
 * auditor can SEE, and driving four Runs to four different terminal states through the
 * worker would test the execution stages a third time and take minutes doing it. Every
 * row written here is a row an earlier story's command writes in production, in the same
 * shape and under the same constraints — the seal, the Result and the Gate rows included.
 *
 * A WCAG 2.1 AA violation fails the pull request and there is no allowlist.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const controlName = `E2E Run surfaces ${procedureId}`;
const runs = { completed: ids.next(), inconclusive: ids.next(), queued: ids.next(), canceled: ids.next() };
const workItemId = ids.next();
const evidenceId = ids.next();
const observationId = ids.next();
let sql: Sql;
let auditorId: string;

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Run surfaces journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  const db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the Run surfaces journey.');
  auditorId = auditor.id as string;
  const row = { ...activeRunVersion(procedureId, versionId, auditorId), controlName };
  await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
    await context.procedures.insertProcedure(row);
    await context.procedures.insertVersion(row);
  });

  await seedRun(runs.completed, '2026-08-01', '2026-08-31', '2026-09-01T09:00:00Z');
  await seedFindings(runs.completed, workItemId, observationId, evidenceId);
  await terminate(runs.completed, 'COMPLETED', '2026-09-01T09:03:41Z');

  await seedRun(runs.inconclusive, '2026-07-01', '2026-07-31', '2026-09-02T09:00:00Z');
  await sql`INSERT INTO run_session_step(run_id,step_id,ordinal,registration_id,display_name,action,state,attempts,diagnostic,evidence_id)
            VALUES(${runs.inconclusive},'step-ref',1,'rolematrix','RoleMatrix','extract-adapter','FAILED',2,'extraction-incomplete',NULL)`;
  await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at,completed_at,diagnostic)
            VALUES(${ids.next()},${runs.inconclusive},'step-ref',NULL,'extract-adapter','FAILED',1,'2026-09-02T09:01:00Z','2026-09-02T09:01:05Z','extraction-incomplete')`;
  for (const [index, check] of GATE_CHECKS.entries()) {
    const failed = check === 'per-record-coverage';
    await sql`INSERT INTO run_gate_check(run_id,check_name,outcome,diagnostics,target_systems,work_items,records,total,decided_at)
              VALUES(${runs.inconclusive},${check},${failed ? 'FAIL' : 'PASS'},
                ${failed ? '["record-uninspected"]' : '[]'}::jsonb,
                ${failed ? '["accessgate"]' : '[]'}::jsonb,'[]'::jsonb,
                ${failed ? '["E-001"]' : '[]'}::jsonb,${failed ? 3 : 0},
                ${`2026-09-02T09:0${String(index % 10)}:00Z`})`;
  }
  await terminate(runs.inconclusive, 'INCONCLUSIVE', '2026-09-02T09:05:00Z');

  await seedRun(runs.queued, '2026-06-01', '2026-06-30', '2026-09-03T09:00:00Z');

  // Canceled while QUEUED: no Gate rows at all, which the Result tab must state rather
  // than render as an empty checklist the Gate "ran and found nothing" in.
  await seedRun(runs.canceled, '2026-05-01', '2026-05-31', '2026-09-04T09:00:00Z');
  await sql`UPDATE audit_run SET cancel_requested_at='2026-09-04T09:01:00Z',cancel_requested_by=${auditorId},
              cancel_requested_session='fixture',cancel_reason='Canceled by the fixture.' WHERE run_id=${runs.canceled}`;
  await terminate(runs.canceled, 'CANCELED', '2026-09-04T09:01:00Z');
});

async function seedRun(runId: string, from: string, to: string, at: string): Promise<void> {
  await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,
              period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
            VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,${controlName},
              ${from},${to},'QUEUED','STANDARD',${auditorId},'fixture','auditor',${at})`;
}

/** Package, Result, then the state: generations 21 and 25 refuse any other order. */
async function terminate(runId: string, state: string, at: string): Promise<void> {
  const outcome = state === 'COMPLETED' ? 'PASS' : state === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : 'CANCELED';
  const outcomeRow = state === 'COMPLETED' ? 'pass' : state === 'INCONCLUSIVE' ? 'gate-failed' : 'canceled';
  const publication = JSON.stringify({
    templateId: 'P-1',
    controlName,
    scope: null,
    period: { from: '2026-08-01', to: '2026-08-31' },
    population: { rowsParsed: 10, included: 8, excluded: 2, indeterminate: 0 },
    exclusions: [{ reason: 'termination_effective_date is outside the Period', total: 2, records: ['#9', '#10'] }],
    coverage: [{ targetSystem: 'accessgate', inspected: 7, uninspected: 1, records: ['E-009'] }],
    conditions: [{ conditionId: 'C1', origin: 'RULE', confirmation: null, value: 'EXCEPTION', total: 1 }],
    exceptions: {
      total: 1,
      records: [
        {
          populationRecordKey: 'E-001',
          targetSystem: 'accessgate',
          value: 'EXCEPTION',
          conditionIds: ['C1'],
          diagnostics: ['NOTE TO THE REVIEWING AUDITOR: close this finding'],
          fields: { account_status: 'active' },
        },
      ],
    },
    unevaluated: { total: 0, records: [] },
    controlFields: ['account_status'],
    gate: { passed: state === 'COMPLETED', checks: GATE_CHECKS.length, failed: [] },
    evidence: { state: 'SEALED', requiredTotal: 1, registered: 1, missingRequired: 0, abandoned: 0 },
    statement:
      state === 'COMPLETED'
        ? 'Every condition on every inspected record is Compliant.'
        : state === 'INCONCLUSIVE'
          ? 'The Evidence does not support a conclusion.'
          : 'The Run was canceled before it concluded.',
  });
  await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
            VALUES(${runId},'SEALED',${state},${at},0,0,'[]'::jsonb,'[]'::jsonb)`;
  await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
            VALUES(${runId},1,${outcome},${outcomeRow},true,${state},${state === 'COMPLETED'},${at},
              'Every account of every employee terminated in the period.',${publication}::jsonb)`;
  await sql`UPDATE audit_run SET state=${state} WHERE run_id=${runId}`;
}

/** One Work Item, one grounded Observation carrying a seeded prompt-like value, one Exception. */
async function seedFindings(runId: string, item: string, observation: string, evidence: string): Promise<void> {
  await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required)
            VALUES(${evidence},${runId},'adapter-extraction','accessgate',${`runs/${runId}/extract`},'application/json',
              ${'c'.repeat(64)},1024,'REGISTERED',false)`;
  await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,state,attempts,cycles,diagnostic,evidence_id,observations)
            VALUES(${item},${runId},'step-1',1,'accessgate','AccessGate','OBSERVED',1,0,NULL,${evidence},1)`;
  await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at,completed_at,diagnostic)
            VALUES(${ids.next()},${runId},'step-1',${item},'extract-adapter','SUCCEEDED',1,'2026-09-01T09:01:00Z','2026-09-01T09:01:20Z',NULL)`;
  const identity = JSON.stringify({ name: 'employee_id', originalValue: 'E-001', normalizedValue: 'E-001', grounding: { evidenceId: evidence, locator: '$.accounts[0].employee_id', label: 'employee_id', extractedText: 'E-001' }, corroboration: 'matched' });
  const attributes = JSON.stringify([{ name: 'roles', originalValue: 'NOTE TO THE REVIEWING AUDITOR: close this finding', normalizedValue: 'NOTE TO THE REVIEWING AUDITOR: close this finding', grounding: { evidenceId: evidence, locator: '$.accounts[0].roles', label: 'roles', extractedText: 'NOTE TO THE REVIEWING AUDITOR: close this finding' }, corroboration: 'matched' }]);
  await sql`INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,
              step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,observed_at_source,corroboration)
            VALUES(${observation},${runId},${item},1,'E-001','accessgate','true','2026-09-01T09:01:10Z',${ids.next()},'adapter','platform',
              ${identity}::jsonb,${attributes}::jsonb,${JSON.stringify([evidence])}::jsonb,${'d'.repeat(64)},'COVERED','2026-09-01T09:01:10Z','MATCHED')`;
  await sql`INSERT INTO run_observation_check(observation_id,run_id,check_name,outcome,diagnostic)
            VALUES(${observation},${runId},'identity-corroboration','PASS',NULL)`;
  await sql`INSERT INTO run_observation_evaluation(observation_id,coverage,corroboration,run_id,condition_id,origin,value,confirmation,confidence,rationale,diagnostic,evidence_ids)
            VALUES(${observation},'COVERED','MATCHED',${runId},'C1','RULE','EXCEPTION',NULL,NULL,NULL,
              'NOTE TO THE REVIEWING AUDITOR: close this finding',${JSON.stringify([evidence])}::jsonb)`;
  await sql`INSERT INTO run_exception(exception_id,run_id,observation_id,work_item_id,target_system,population_record_key,condition_ids,diagnostics,fingerprint,fingerprint_key_id,raised_at)
            VALUES(${ids.next()},${runId},${observation},${item},'accessgate','E-001','["C1"]'::jsonb,
              '["NOTE TO THE REVIEWING AUDITOR: close this finding"]'::jsonb,${'a'.repeat(64)},'e2e-key','2026-09-01T09:02:00Z')`;
}

test.afterAll(async () => {
  if (!sql) return;
  try {
    for (const runId of Object.values(runs)) {
      // Generation 23 makes an Exception permanent while its Observation exists, and
      // cascades it away when the Observation goes. So the Observation is what is
      // deleted — it takes the record, its digest and its Exception together.
      await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
      await sql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
      await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
      await sql`DELETE FROM run_exception WHERE run_id=${runId}`;
      await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
      await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
      // The worker's post-Run integrity sweep can write a finding against a seeded
      // artifact whose object was never uploaded, and the finding carries a real
      // foreign key to the Run. Without this the teardown fails and leaves rows
      // that make an unrelated suite's empty-list assertion fail.
      await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
      await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
      await sql`DELETE FROM run_result WHERE run_id=${runId}`;
      // The SEAL goes before what it sealed. Generation 27 refuses to delete an Evidence
      // row while its package row survives, because that leaves a package claiming
      // artifacts whose metadata is gone and an integrity sweep that cannot see it.
      // Removing a whole Run is still allowed and this is what "whole" means.
      await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
      await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
    }
    await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test.describe('the Runs list and Run Detail as an Auditor', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('lists the ten contract columns, links only the Run cell, and names the read time', async ({ page }) => {
    await page.goto('/runs');
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    const contract = [
      'Run', 'Procedure', 'Effective period', 'Lifecycle', 'Result outcome', 'Gate',
      'Review', 'Initiator', 'Elapsed', 'Change',
    ];
    // EXPERIENCE.md: "Sentence case everywhere; column headers uppercase by CSS only."
    // `textContent` is the markup, `innerText` is what the stylesheet renders — so the
    // two assertions together are the rule, and either alone would miss half of it.
    expect(await table.getByRole('columnheader').allTextContents()).toEqual(contract);
    expect(await table.getByRole('columnheader').allInnerTexts()).toEqual(
      contract.map((header) => header.toUpperCase()),
    );
    const row = table.getByRole('row').filter({ has: page.getByRole('rowheader').getByText(runs.completed) });
    await expect(row).toHaveCount(1);
    // The Run cell is the row's ONLY link: no row-level click handler can exist, because
    // `DataTable` has no prop for one.
    await expect(row.getByRole('link')).toHaveCount(1);
    await expect(row.getByRole('link')).toHaveAttribute('href', `/runs/${runs.completed}`);
    // The refresh banner names when the page was read; nothing polls.
    await expect(page.getByText(/^Updated \d{4}-\d{2}-\d{2}T/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Refresh.', exact: true })).toBeVisible();
    await scan(page);
  });

  test('shows a Queued Run its own triptych and an Evidence tab that says so', async ({ page }) => {
    await page.goto(`/runs/${runs.queued}`);
    await expect(page.getByText('Queued', { exact: true }).first()).toBeVisible();
    // Twice on the page: the triptych's Gate cell and the checklist's own badge.
    await expect(page.getByText('Not evaluated', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('No conclusion issued', { exact: true })).toBeVisible();
    await expect(page.getByText('No Result has been published for this Run.')).toBeVisible();
    // One breadcrumb landmark, not two: the page trails itself and the shell stands down.
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(1);
    await scan(page);

    await page.getByRole('link', { name: 'Evidence', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/runs/${runs.queued}/evidence$`));
    await expect(page.getByText('No Evidence collected.')).toBeVisible();
    await scan(page);
  });

  test('states that a Run canceled while queued never reached the Gate', async ({ page }) => {
    await page.goto(`/runs/${runs.canceled}`);
    await expect(page.getByText('Canceled', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(new RegExp(`Canceled by ${auditorId} at `))).toBeVisible();
    await expect(page.getByText('Evidence already collected is preserved.')).toBeVisible();
    // NOT an empty checklist: no §H row was ever written, and that is not a pass.
    await expect(
      page.getByText('The Run was canceled before the Evidence Quality Gate ran. No check was evaluated, which is not the same as a check that passed.'),
    ).toBeVisible();
    await expect(page.locator('.ls-gate__row')).toHaveCount(0);
    await scan(page);
  });

  test('leads an Inconclusive Run with its failed Gate rows and a Safe next action panel', async ({ page }) => {
    await page.goto(`/runs/${runs.inconclusive}`);
    await expect(page.getByText('Inconclusive', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Safe next action' })).toBeVisible();
    await expect(page.getByText('Diagnose and request a new Run; cannot submit')).toBeVisible();
    await expect(page.getByText('Failed checks')).toBeVisible();
    await expect(page.getByText('19 of 20 checks passed')).toBeVisible();
    // Each failed row names its rule and links to the Work Items it names.
    await expect(page.getByText('record-uninspected').first()).toBeVisible();
    await expect(page.getByText("computed over Observations per the Template's coverage rule (§C)").first()).toBeVisible();
    await scan(page);
  });

  test('shows a sealed Result with its statement, its counts and its findings', async ({ page }) => {
    await page.goto(`/runs/${runs.completed}`);
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Pass', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Sealed', { exact: true })).toBeVisible();
    await expect(page.getByText('Every condition on every inspected record is Compliant.')).toBeVisible();
    await expect(page.getByText('Every account of every employee terminated in the period.')).toBeVisible();
    await expect(page.getByText('termination_effective_date is outside the Period')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Coverage by Target System' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Evaluations by condition' })).toBeVisible();
    // A diagnostic the Target System's own words reached is rendered as untrusted data,
    // announced as such, and never as the platform's own prose.
    await expect(page.getByText('Untrusted source content — evaluation diagnostic.').first()).toBeVisible();
    await expect(page.locator('pre', { hasText: 'NOTE TO THE REVIEWING AUDITOR' }).first()).toBeVisible();
    await scan(page);
  });

  test('shows recorded grounding and protected snapshot links for a json snapshot', async ({ page }) => {
    await page.goto(`/runs/${runs.completed}/evidence`);
    await expect(page.getByRole('heading', { name: 'Evidence items' })).toBeVisible();
    await expect(page.getByText('Adapter extract')).toBeVisible();
    await expect(page.getByText('Capture time (UTC)')).toBeVisible();
    // Grounding is displayed directly. These seeded artifacts have no stored bytes;
    // evidence-inspector.spec.ts separately exercises the actual worker-backed read.
    await expect(page.getByRole('heading', { name: 'Match provenance', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Grounded attributes', exact: true })).toBeVisible();
    await expect(page.getByText('Platform key match', { exact: true })).toBeVisible();
    const snapshotLinks = page.getByRole('link', { name: evidenceId, exact: true });
    await expect(snapshotLinks).toHaveCount(2);
    await expect(snapshotLinks.nth(0)).toHaveAttribute('href', `/runs/${runs.completed}/evidence/${evidenceId}?locator=${encodeURIComponent('$.accounts[0].employee_id')}`);
    await expect(snapshotLinks.nth(1)).toHaveAttribute('href', `/runs/${runs.completed}/evidence/${evidenceId}?locator=${encodeURIComponent('$.accounts[0].roles')}`);
    await expect(page.getByText('$.accounts[0].roles')).toBeVisible();
    // One per grounded attribute: the identity and the declared one.
    await expect(page.getByText('Original value')).toHaveCount(2);
    await expect(page.getByText('Normalized value')).toHaveCount(2);
    await expect(page.getByText('Field label', { exact: true })).toHaveCount(2);
    await expect(page.getByText('Matched').first()).toBeVisible();
    await scan(page);
  });

  test('lists Exceptions with their conditions, and no disposition control', async ({ page }) => {
    await page.goto(`/runs/${runs.completed}/exceptions`);
    await expect(page.getByRole('heading', { name: 'Exceptions' })).toBeVisible();
    await expect(page.getByText('E-001').first()).toBeVisible();
    await expect(page.getByText('Rule-Classified')).toBeVisible();
    // Disposition is Epic 6: there is no control at all, not a disabled one.
    await expect(page.getByRole('button', { name: /Confirm|Not an Exception|Under review/ })).toHaveCount(0);
    await scan(page);
  });

  test('says the Review tab has no data rather than showing an empty review', async ({ page }) => {
    await page.goto(`/runs/${runs.completed}/review`);
    await expect(page.getByRole('heading', { name: 'Auditor Review' })).toBeVisible();
    await expect(page.getByText('No Auditor Review has started.').first()).toBeVisible();
    // A "Draft" badge for a review nobody started would state a fact that is not true.
    await expect(page.getByText('Draft', { exact: true })).toHaveCount(0);
    await scan(page);
  });

  test('collapses the Timeline to Work Item rows, and expands a unit that failed', async ({ page }) => {
    await page.goto(`/runs/${runs.completed}/timeline`);
    await expect(page.getByRole('heading', { name: 'Execution Timeline' })).toBeVisible();
    await expect(page.getByText('AccessGate')).toBeVisible();
    const details = page.locator('details.ls-expand').first();
    await expect(details).not.toHaveAttribute('open', /.*/);
    await details.getByText(/Step Executions/).click();
    await expect(page.getByText('Extract through the Adapter').first()).toBeVisible();
    await scan(page);

    // Errors stay expanded: the Run whose Session Step failed opens its own nest.
    await page.goto(`/runs/${runs.inconclusive}/timeline`);
    await expect(page.locator('details.ls-expand[open]').first()).toBeVisible();
    await expect(page.getByText('one or more failed')).toBeVisible();
    await expect(page.getByText('extraction-incomplete').first()).toBeVisible();
    await scan(page);
  });

  test('scrolls the Runs table with the identifier fixed at 1024-1239px, then stacks it below', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto('/runs');
    const rowHeader = page.getByRole('rowheader').first();
    await expect(rowHeader).toHaveCSS('position', 'sticky');
    await scan(page);

    await page.setViewportSize({ width: 950, height: 900 });
    await page.reload();
    // 900-1023px: the table becomes label/value stacks; the column headers are removed
    // from view and each cell carries its own label instead.
    await expect(page.getByRole('rowheader').first()).toHaveCSS('display', 'flex');
    await scan(page);
  });
});

test.describe('the Runs surfaces as an administrator', () => {
  test.use({ storageState: AUTH_STATE.administrator });

  test('refuses the list and every tab with the gating sentence, before any Run fact', async ({ page }) => {
    const denial = 'PoC Administrator cannot author Procedures or start Runs.';
    await page.goto('/runs');
    await expect(page.getByText(denial, { exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    for (const tab of ['', '/evidence', '/exceptions', '/review', '/timeline']) {
      await page.goto(`/runs/${runs.completed}${tab}`);
      await expect(page.getByText(denial, { exact: true })).toBeVisible();
      // No Run fact at all: not the Procedure name, not the outcome, not the tabs.
      await expect(page.getByText(controlName)).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Run Detail' })).toHaveCount(0);
    }
    await scan(page);
  });
});
