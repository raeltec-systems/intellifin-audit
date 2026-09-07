import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { GATE_CHECKS } from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';

import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const controlName = `E2E Evaluation Review ${procedureId}`;
const runs = { confirmed: ids.next(), rejected: ids.next() };
const evidence = { confirmed: ids.next(), rejected: ids.next() };
const workItems = { confirmed: ids.next(), rejected: ids.next() };
const observations = { confirmed: ids.next(), rejected: ids.next() };
const stepExecutions = { confirmed: ids.next(), rejected: ids.next() };
let sql: Sql;
let db: Database;
let auditorId: string;

async function scan(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const violations = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

function publication(): string {
  return JSON.stringify({
    templateId: 'P-1',
    controlName,
    scope: 'Every matching record is evaluated.',
    period: { from: '2026-08-01', to: '2026-08-31' },
    population: { rowsParsed: 1, included: 1, excluded: 0, indeterminate: 0 },
    exclusions: [],
    coverage: [{ targetSystem: 'review-target', inspected: 1, uninspected: 0, records: [] }],
    conditions: [{ conditionId: 'C2', origin: 'AGENT_JUDGED', confirmation: 'pending', value: 'COMPLIANT', total: 1 }],
    exceptions: { total: 0, records: [] },
    unevaluated: { total: 0, records: [] },
    controlFields: [],
    gate: { passed: true, checks: GATE_CHECKS.length, failed: [] },
    evidence: { state: 'SEALED', requiredTotal: 1, registered: 1, missingRequired: 0, abandoned: 0 },
    statement: 'An Agent-Judged evaluation is waiting for a human decision.',
  });
}

async function seedRun(runId: string, evidenceId: string, workItemId: string, observationId: string, stepExecutionId: string): Promise<void> {
  const at = '2026-09-06T09:00:00.000Z';
  await sql`
    INSERT INTO audit_run(
      request_token, run_id, correlation_id, procedure_id, version_id, version_number,
      procedure_name, period_from, period_to, state, kind, initiator_id, session_id,
      authorization_role, initiated_at
    ) VALUES (
      ${ids.next()}, ${runId}, ${ids.next()}, ${procedureId}, ${versionId}, 1,
      ${controlName}, '2026-08-01', '2026-08-31', 'RUNNING', 'STANDARD', ${auditorId},
      'evaluation-review-e2e', 'auditor', ${at}
    )
  `;
  await sql`
    INSERT INTO run_evidence(
      evidence_id, run_id, kind, registration_id, object_key, media_type, digest, size,
      state, required, captured_at, capture_method, capture_time_source
    ) VALUES (
      ${evidenceId}, ${runId}, 'structural-snapshot', 'review-target', ${`runs/${runId}/snapshot`},
      'application/json', ${'a'.repeat(64)}, 128, 'REGISTERED', false, ${at}, 'agent', 'registration'
    )
  `;
  await sql`
    INSERT INTO run_work_item(
      work_item_id, run_id, step_id, ordinal, registration_id, display_name, state,
      attempts, cycles, diagnostic, evidence_id, observations
    ) VALUES (
      ${workItemId}, ${runId}, 'agent-step-1', 1, 'review-target', 'Review target',
      'OBSERVED', 1, 0, NULL, ${evidenceId}, 1
    )
  `;
  await sql`
    INSERT INTO run_step_execution(
      step_execution_id, run_id, plan_step_id, work_item_id, action, state, attempt,
      started_at, completed_at, diagnostic
    ) VALUES (
      ${stepExecutionId}, ${runId}, 'agent-step-1', ${workItemId}, 'inspect-record', 'SUCCEEDED',
      1, ${at}, ${at}, NULL
    )
  `;
  const identity = JSON.stringify({
    name: 'employee_id',
    originalValue: 'E-001',
    normalizedValue: 'E-001',
    grounding: { evidenceId, locator: '$.nodes[0].value', label: 'Employee ID', extractedText: 'E-001' },
    corroboration: 'matched',
  });
  await sql`
    INSERT INTO run_observation(
      observation_id, run_id, work_item_id, schema_version, population_record_key, target_system,
      found, observed_at, step_execution_id, capture_method, match_origin, identity, attributes,
      evidence_ids, digest, coverage, observed_at_source, corroboration
    ) VALUES (
      ${observationId}, ${runId}, ${workItemId}, 1, 'E-001', 'review-target', 'true', ${at},
      ${stepExecutionId}, 'agent', 'platform', ${identity}::jsonb, '[]'::jsonb,
      ${JSON.stringify([evidenceId])}::jsonb, ${'b'.repeat(64)}, 'COVERED', ${at}, 'MATCHED'
    )
  `;
  await sql`
    INSERT INTO run_observation_evaluation(
      observation_id, coverage, corroboration, run_id, condition_id, origin, value,
      confirmation, confidence, rationale, diagnostic, evidence_ids,
      agent_proposed_value, agent_proposed_confidence, agent_proposed_rationale
    ) VALUES (
      ${observationId}, 'COVERED', 'MATCHED', ${runId}, 'C2', 'AGENT_JUDGED', 'COMPLIANT',
      'pending', 0.950000, 'Synthetic original machine proposal', NULL,
      ${JSON.stringify([evidenceId])}::jsonb, 'COMPLIANT', 0.950000, 'Synthetic original machine proposal'
    )
  `;
  for (const check of GATE_CHECKS) {
    await sql`
      INSERT INTO run_gate_check(
        run_id, check_name, outcome, diagnostics, target_systems, work_items, records, total, decided_at
      ) VALUES (${runId}, ${check}, 'PASS', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0, ${at})
    `;
  }
  await sql`
    INSERT INTO run_evidence_package(
      run_id, state, run_state, sealed_at, required_total, registered, missing_required, abandoned
    ) VALUES (${runId}, 'SEALED', 'COMPLETED', ${at}, 1, 1, '[]'::jsonb, '[]'::jsonb)
  `;
  await sql`
    INSERT INTO run_result(
      run_id, version, outcome, outcome_row, sealed, run_state, gate_passed, sealed_at, scope, publication
    ) VALUES (
      ${runId}, 1, 'PENDING_CONFIRMATION', 'pending-confirmation', false, 'COMPLETED', true,
      ${at}, 'Every matching record is evaluated.', ${publication()}::jsonb
    )
  `;
  await sql`INSERT INTO run_result_review(run_id, revision) VALUES(${runId}, 0)`;
  await sql`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${runId}`;
}

test.beforeAll(async () => {
  test.setTimeout(90_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Evaluation Review journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the Evaluation Review journey.');
  auditorId = String(auditor.id);
  const version = activeRunVersion(procedureId, versionId, auditorId);
  await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
    await context.procedures.insertProcedure({ ...version, controlName });
    await context.procedures.insertVersion({ ...version, controlName });
  });
  await seedRun(runs.confirmed, evidence.confirmed, workItems.confirmed, observations.confirmed, stepExecutions.confirmed);
  await seedRun(runs.rejected, evidence.rejected, workItems.rejected, observations.rejected, stepExecutions.rejected);
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    for (const runId of Object.values(runs)) {
      // Removing the original evaluation cascades the immutable review row for a disposable
      // fixture; a production review row cannot be deleted while that evaluation exists.
      await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
      await sql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
      await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
      await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
      await sql`DELETE FROM run_result_review WHERE run_id=${runId}`;
      await sql`DELETE FROM run_result WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
      await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
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

test.describe('the Evaluation Review surface as an Auditor', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('rejects with a fixed replacement and required rationale, then preserves proposal history', async ({ page }) => {
    await page.goto(`/runs/${runs.rejected}`);
    await expect(page.getByText('1 Agent-Judged evaluations await confirmation', { exact: true })).toBeVisible();
    await expect(page.getByText('Original Agent-Judged proposal', { exact: true })).toBeVisible();
    await expect(page.getByText('0.950000', { exact: true })).toBeVisible();
    await expect(page.getByText('Untrusted source content — AGENT-GENERATED evaluation rationale.').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm evaluation', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reject evaluation', exact: true })).toBeVisible();
    await scan(page);

    await page.getByLabel('Replacement value for rejection', { exact: true }).selectOption('UNEVALUATED');
    await page.getByRole('button', { name: 'Reject evaluation', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Rationale', { exact: true })).toBeFocused();
    await dialog.getByLabel('Rationale', { exact: true }).fill('The retained evidence does not support the proposal.');
    await dialog.getByRole('button', { name: 'Reject evaluation', exact: true }).click();
    await expect.poll(async () => {
      const [row] = await sql`SELECT version,sealed,outcome FROM run_result WHERE run_id=${runs.rejected}`;
      return row;
    }).toMatchObject({ version: 2, sealed: true, outcome: 'INCONCLUSIVE' });
    await expect.poll(async () => {
      const [row] = await sql`SELECT action,effective_origin,effective_value,rejection_rationale FROM run_evaluation_review WHERE run_id=${runs.rejected}`;
      return row;
    }).toMatchObject({ action: 'reject', effective_origin: 'HUMAN', effective_value: 'UNEVALUATED', rejection_rationale: 'The retained evidence does not support the proposal.' });
    await expect(page.getByText('Stored human review decision', { exact: true })).toBeVisible();
    await expect(page.getByText('The Result is sealed. Review history is read-only.', { exact: true })).toBeVisible();
    await expect(page.getByText('Synthetic original machine proposal', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm evaluation', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reject evaluation', exact: true })).toHaveCount(0);
    await scan(page);
  });

  test('confirms the proposal and seals the Result once', async ({ page }) => {
    await page.goto(`/runs/${runs.confirmed}`);
    await page.getByRole('button', { name: 'Confirm evaluation', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm evaluation', exact: true }).click();
    await expect.poll(async () => {
      const [row] = await sql`SELECT version,sealed,outcome FROM run_result WHERE run_id=${runs.confirmed}`;
      return row;
    }).toMatchObject({ version: 2, sealed: true, outcome: 'PASS' });
    await expect.poll(async () => {
      const [row] = await sql`SELECT action,effective_origin,effective_value,effective_confirmation FROM run_evaluation_review WHERE run_id=${runs.confirmed}`;
      return row;
    }).toMatchObject({ action: 'confirm', effective_origin: 'AGENT_JUDGED', effective_value: 'COMPLIANT', effective_confirmation: 'confirmed' });
    await expect(page.getByText('Stored human review decision', { exact: true })).toBeVisible();
    await expect(page.getByText('The Result is sealed. Review history is read-only.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm evaluation', exact: true })).toHaveCount(0);
    await scan(page);
  });
});
