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

import { STATUS_COLUMN_WORDS } from '../../apps/web/src/design/status-words';
import { RESULT_WORDS } from '../../apps/web/src/runs/result-words';
import { activeRunVersion } from '../fixtures/active-run-version';
import { executablePlanInputs } from '../fixtures/executable-plan';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * The Result tab reads conclusion first (UI cleanup 2026-09-22, UX-19, UX-20).
 *
 * The walkthrough measured a completed Result at 7,132px, with three historical AI
 * assessments ABOVE the conclusion — because the frame rendered the pending
 * confirmations for every tab, before the page's own content — and all twenty evidence
 * checks and every artifact expanded. This drives the real page, as an Auditor, over two
 * sealed-shape Runs a real Run can produce, and measures the ORDER and the DISCLOSURES in
 * the browser rather than trusting the component tree:
 *
 * - an unsealed Result (`PENDING_CONFIRMATION`): the confirmations the reader has to act on
 *   sit directly under the conclusion, open;
 * - a sealed Result: the same decisions are history, behind a closed "Review history"
 *   disclosure, and the conclusion, the named records, the checks and the artifacts follow
 *   in that order, with the passed checks and the artifact list collapsed.
 *
 * Rows are seeded, the `evaluation-review.spec.ts` shape: what is under test is the page.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const controlName = `E2E Result first ${procedureId}`;
const runs = { pending: ids.next(), sealed: ids.next() };
let sql: Sql;
let auditorId = '';

function publication(sealed: boolean): string {
  return JSON.stringify({
    templateId: 'P-1',
    controlName,
    scope: 'Every matching record is evaluated.',
    period: { from: '2026-08-01', to: '2026-08-31' },
    population: { rowsParsed: 1, included: 1, excluded: 0, indeterminate: 0 },
    exclusions: [],
    coverage: [{ targetSystem: 'review-target', inspected: 1, uninspected: 0, records: [] }],
    conditions: [{ conditionId: 'C2', origin: 'AGENT_JUDGED', confirmation: sealed ? 'confirmed' : 'pending', value: 'COMPLIANT', total: 1 }],
    exceptions: { total: 0, records: [] },
    unevaluated: { total: 0, records: [] },
    controlFields: [],
    gate: { passed: true, checks: GATE_CHECKS.length, failed: [] },
    evidence: { state: 'SEALED', requiredTotal: 1, registered: 1, missingRequired: 0, abandoned: 0 },
    statement: sealed
      ? 'Every condition on every inspected record is Compliant.'
      : 'An Agent-Judged evaluation is waiting for a human decision.',
  });
}

async function seedRun(runId: string, sealed: boolean, day: string): Promise<void> {
  const at = '2026-09-06T09:00:00.000Z';
  const evidenceId = ids.next();
  const workItemId = ids.next();
  const observationId = ids.next();
  const stepExecutionId = ids.next();
  await sql`
    INSERT INTO audit_run(request_token, run_id, correlation_id, procedure_id, version_id, version_number,
      procedure_name, period_from, period_to, state, kind, initiator_id, session_id, authorization_role, initiated_at)
    VALUES (${ids.next()}, ${runId}, ${ids.next()}, ${procedureId}, ${versionId}, 1, ${controlName},
      ${`2026-08-${day}`}, ${`2026-08-${day}`}, 'RUNNING', 'STANDARD', ${auditorId}, 'result-first-e2e', 'auditor', ${at})`;
  await sql`
    INSERT INTO run_evidence(evidence_id, run_id, kind, registration_id, object_key, media_type, digest, size,
      state, required, captured_at, capture_method, capture_time_source, role)
    VALUES (${evidenceId}, ${runId}, 'structural-snapshot', 'review-target', ${`runs/${runId}/snapshot`},
      'application/json', ${'a'.repeat(64)}, 128, 'REGISTERED', false, ${at}, 'agent', 'registration', 'evidence')`;
  await sql`
    INSERT INTO run_work_item(work_item_id, run_id, step_id, ordinal, registration_id, display_name, state,
      attempts, cycles, diagnostic, evidence_id, observations)
    VALUES (${workItemId}, ${runId}, 'agent-step-1', 1, 'review-target', 'Review target', 'OBSERVED', 1, 0, NULL, ${evidenceId}, 1)`;
  await sql`
    INSERT INTO run_step_execution(step_execution_id, run_id, plan_step_id, work_item_id, action, state, attempt,
      started_at, completed_at, diagnostic)
    VALUES (${stepExecutionId}, ${runId}, 'agent-step-1', ${workItemId}, 'inspect-record', 'SUCCEEDED', 1, ${at}, ${at}, NULL)`;
  const identity = JSON.stringify({
    name: 'employee_id',
    originalValue: 'E-001',
    normalizedValue: 'E-001',
    grounding: { evidenceId, locator: '$.nodes[0].value', label: 'Employee ID', extractedText: 'E-001' },
    corroboration: 'matched',
  });
  await sql`
    INSERT INTO run_observation(observation_id, run_id, work_item_id, schema_version, population_record_key, target_system,
      found, observed_at, step_execution_id, capture_method, match_origin, identity, attributes,
      evidence_ids, digest, coverage, observed_at_source, corroboration)
    VALUES (${observationId}, ${runId}, ${workItemId}, 1, 'E-001', 'review-target', 'true', ${at},
      ${stepExecutionId}, 'agent', 'platform', ${identity}::jsonb, '[]'::jsonb,
      ${JSON.stringify([evidenceId])}::jsonb, ${'b'.repeat(64)}, 'COVERED', ${at}, 'MATCHED')`;
  await sql`
    INSERT INTO run_observation_evaluation(observation_id, coverage, corroboration, run_id, condition_id, origin, value,
      confirmation, confidence, rationale, diagnostic, evidence_ids,
      agent_proposed_value, agent_proposed_confidence, agent_proposed_rationale)
    VALUES (${observationId}, 'COVERED', 'MATCHED', ${runId}, 'C2', 'AGENT_JUDGED', 'COMPLIANT',
      'pending', 0.950000, 'Synthetic original machine proposal', NULL,
      ${JSON.stringify([evidenceId])}::jsonb, 'COMPLIANT', 0.950000, 'Synthetic original machine proposal')`;
  for (const check of GATE_CHECKS) {
    await sql`
      INSERT INTO run_gate_check(run_id, check_name, outcome, diagnostics, target_systems, work_items, records, total, decided_at)
      VALUES (${runId}, ${check}, 'PASS', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0, ${at})`;
  }
  await sql`
    INSERT INTO run_evidence_package(run_id, state, run_state, sealed_at, required_total, registered, missing_required, abandoned)
    VALUES (${runId}, 'SEALED', 'COMPLETED', ${at}, 1, 1, '[]'::jsonb, '[]'::jsonb)`;
  await sql`
    INSERT INTO run_result(run_id, version, outcome, outcome_row, sealed, run_state, gate_passed, sealed_at, scope, publication)
    VALUES (${runId}, 1, ${sealed ? 'PASS' : 'PENDING_CONFIRMATION'}, ${sealed ? 'pass' : 'pending-confirmation'}, ${sealed},
      'COMPLETED', true, ${at}, 'Every matching record is evaluated.', ${publication(sealed)}::jsonb)`;
  await sql`INSERT INTO run_result_review(run_id, revision) VALUES(${runId}, 0)`;
  await sql`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${runId}`;
}

test.beforeAll(async () => {
  test.setTimeout(90_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Result-first journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the Result-first journey.');
  auditorId = String(auditor.id);
  const version = activeRunVersion(procedureId, versionId, auditorId, { ...executablePlanInputs(), controlName });
  await new PostgresProceduresUnitOfWork(createDb(sql)).execute(async (context) => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });
  await seedRun(runs.pending, false, '01');
  await seedRun(runs.sealed, true, '02');
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    for (const runId of Object.values(runs)) {
      await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
      await sql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
      await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
      await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
      await sql`DELETE FROM run_result_review WHERE run_id=${runId}`;
      await sql`DELETE FROM run_result WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
      await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
      await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
    }
    await sql`DELETE FROM procedure_version WHERE version_id=${versionId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

/** The top edge of the first element a locator matches, in page coordinates. */
async function topOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
}

test.describe('the Result tab reads conclusion first', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('puts the confirmations a reader has to act on directly under the conclusion', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/runs/${runs.pending}`);
    const conclusion = page.getByRole('region', { name: 'Conclusion', exact: true });
    await expect(conclusion).toBeVisible();
    // The three questions, each labelled, in the first viewport.
    for (const label of [STATUS_COLUMN_WORDS.execution, STATUS_COLUMN_WORDS.assessment, STATUS_COLUMN_WORDS.evidenceChecks]) {
      await expect(conclusion.getByText(label, { exact: true })).toBeInViewport();
    }
    // The confirmation is open and actionable, and it sits between the conclusion and the
    // records the Result names — it is what the reader has to DO next.
    await expect(page.getByRole('button', { name: 'Confirm evaluation', exact: true })).toBeVisible();
    await expect(page.getByText(RESULT_WORDS.reviewHistory, { exact: true })).toHaveCount(0);
    const conclusionTop = await topOf(page, '[aria-labelledby="conclusion-heading"]');
    const reviewTop = await topOf(page, 'li.ls-evaluation');
    const findingsTop = await topOf(page, '[aria-labelledby="findings-heading"]');
    expect(conclusionTop).toBeLessThan(reviewTop);
    expect(reviewTop).toBeLessThan(findingsTop);
    const scan = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('keeps a sealed Result short: history, passed checks and artifacts are behind disclosures', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/runs/${runs.sealed}`);
    const conclusion = page.getByRole('region', { name: 'Conclusion', exact: true });
    await expect(conclusion).toBeInViewport();

    // The decisions already taken are history, collapsed — not three assessments in front
    // of the conclusion they produced.
    const history = page.locator('details').filter({ has: page.getByText(RESULT_WORDS.reviewHistory, { exact: true }) });
    await expect(history).toHaveCount(1);
    await expect(history).not.toHaveAttribute('open', /.*/);
    await expect(page.getByText('Original Agent-Judged proposal', { exact: true })).toBeHidden();

    // The order the contract states: conclusion, the records named, the evidence checks,
    // then what the Run froze.
    const order = await Promise.all([
      topOf(page, '[aria-labelledby="conclusion-heading"]'),
      topOf(page, '[aria-labelledby="findings-heading"]'),
      topOf(page, '[aria-labelledby="gate-heading"]'),
      topOf(page, '[aria-labelledby="evidence-package-summary"]'),
    ]);
    expect(order).toEqual([...order].sort((left, right) => left - right));

    // Twenty passed checks are one summary line with the rows behind a closed disclosure.
    const gate = page.getByRole('region', { name: RESULT_WORDS.gateHeading, exact: true });
    await expect(gate.locator('li.ls-gate__row').first()).toBeHidden();
    await expect(gate.locator('details').first()).not.toHaveAttribute('open', /.*/);
    // No specification reference is printed on an ordinary surface.
    const visibleText = await page.locator('main').innerText();
    expect(visibleText).not.toMatch(/§|addendum|FR-\d/);

    // Every reconciliation label is readable: no value is printed over its own label. The
    // shared layout put a sentence-long value beside its label in a content-sized column,
    // which squeezed the label to nothing and overlapped the two.
    const overlaps = await page.locator('.ls-reconciliation > div').evaluateAll((cells) => cells.filter((cell) => {
      const label = cell.querySelector('dt')?.getBoundingClientRect();
      const value = cell.querySelector('dd')?.getBoundingClientRect();
      if (label === undefined || value === undefined) return false;
      return label.left < value.right && value.left < label.right && label.top < value.bottom && value.top < label.bottom;
    }).length);
    expect(overlaps).toBe(0);

    // The walkthrough measured 7,132px. With every disclosure closed the page is a few
    // screens, not ten; the bound is loose on purpose, and what it catches is the old
    // shape coming back — twenty check rows and an artifact list laid out in full.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const shot = testInfo.outputPath('result-first-sealed-1366.png');
    await page.screenshot({ path: shot, fullPage: true });
    await testInfo.attach('result-first-sealed-1366', { path: shot, contentType: 'image/png' });
    expect(height).toBeLessThan(3200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const scan = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(scan.violations).toEqual([]);
  });
});
