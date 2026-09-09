import { GOLDEN_AGENT_INJECTIONS } from '../fixtures/agent-abuse-cases';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { raiseEscalation } from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  PostgresWaitRepository,
  SystemClock,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const controlName = `E2E Escalation ${procedureId}`;
const cases = GOLDEN_AGENT_INJECTIONS.map(row => ({ ...row, runId: ids.next(), waitId: '', evidenceId: ids.next(), workItemId: ids.next(), stepExecutionId: ids.next(), attemptId: ids.next() }));
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

async function seedRun(runId: string, period: readonly [string, string]): Promise<void> {
  await sql`
    INSERT INTO audit_run(
      request_token, run_id, correlation_id, procedure_id, version_id, version_number,
      procedure_name, period_from, period_to, state, kind, initiator_id, session_id,
      authorization_role, initiated_at
    ) VALUES (
      ${ids.next()}, ${runId}, ${ids.next()}, ${procedureId}, ${versionId}, 1,
      ${controlName}, ${period[0]}, ${period[1]}, 'RUNNING', 'STANDARD', ${auditorId},
      'escalation-e2e', 'auditor', now()
    )
  `;
}

async function raise(row: typeof cases[number]): Promise<string> {
  const result = await raiseEscalation({ repository: new PostgresWaitRepository(db), ids, clock: new SystemClock() },
    { runId: row.runId, kind: 'retry-or-skip', options: [{ id: 'retry', label: 'Retry' }, { id: 'skip', label: 'Skip' }], stepId: 'agent-step-1', supportingEvidenceIds: [row.evidenceId] });
  if (!result.ok) throw new Error(`Escalation fixture could not open: ${result.reason}`);
  return result.wait.waitId;
}

async function seedMatchingAgentContext(row: typeof cases[number]): Promise<void> {
  await sql`
    INSERT INTO run_evidence(
      evidence_id, run_id, kind, registration_id, object_key, media_type, digest, size,
      state, required, captured_at, capture_method, capture_time_source
    ) VALUES (
      ${row.evidenceId}, ${row.runId}, 'structural-snapshot', 'synthetic-target',
      ${`runs/${row.runId}/snapshot`}, 'application/json', ${'a'.repeat(64)}, 256,
      'REGISTERED', false, now(), 'agent', 'registration'
    )
  `;
  await sql`
    INSERT INTO run_work_item(
      work_item_id, run_id, step_id, ordinal, registration_id, display_name, state,
      attempts, cycles, diagnostic, evidence_id, observations
    ) VALUES (
      ${row.workItemId}, ${row.runId}, 'agent-step-1', 1, 'synthetic-target',
      'Synthetic candidate lookup', 'AWAITING', 1, 0, NULL, ${row.evidenceId}, 0
    )
  `;
  await sql`
    INSERT INTO run_step_execution(
      step_execution_id, run_id, plan_step_id, work_item_id, action, state, attempt,
      started_at, completed_at, diagnostic
    ) VALUES (
      ${row.stepExecutionId}, ${row.runId}, 'agent-step-1', ${row.workItemId}, 'inspect-record',
      'RUNNING', 1, now(), NULL, NULL
    )
  `;
  const response = {
    schemaVersion: 1,
    route: 'anthropic',
    model: {
      provider: 'anthropic',
      modelId: 'e2e-fixture',
      promptVersion: '1',
      buildVersion: 'e2e',
      configuration: {
        responseFormat: 'agent-action-proposal-v1',
        maxOutputTokens: 100,
        maxActions: 1,
        temperature: 0,
      },
    },
    actions: [],
    uncertainty: {
      kind: 'ambiguous',
      rationale: row.text,
    },
    usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
  };
  await sql`
    INSERT INTO run_agent_work(
      run_id, revision, status, run_started_at, lease_until, attempt_id, work_item_id,
      wait_id, pending_wait, next_turn, tokens, reserved_tokens, model, diagnostic
    ) VALUES (
      ${row.runId}, 1, 'WAITING', now(), now() + interval '1 hour', ${row.attemptId},
      ${row.workItemId}, ${row.waitId}, NULL, 1, 0, 0, ${JSON.stringify(response.model)}::jsonb, NULL
    )
  `;
  await sql`
    INSERT INTO run_agent_turn(
      run_id, sequence, work_item_id, step_execution_id, snapshot_evidence_id, status,
      reserved_tokens, response, diagnostic
    ) VALUES (
      ${row.runId}, 1, ${row.workItemId}, ${row.stepExecutionId}, ${row.evidenceId},
      'COMPLETED', 1, ${JSON.stringify(response)}::jsonb, NULL
    )
  `;
}

test.beforeAll(async () => {
  test.setTimeout(90_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Escalation journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the Escalation journey.');
  auditorId = String(auditor.id);

  const version = activeRunVersion(procedureId, versionId, auditorId);
  await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
    await context.procedures.insertProcedure({ ...version, controlName });
    await context.procedures.insertVersion({ ...version, controlName });
  });

  for (const [index, row] of cases.entries()) {
    const day = String(index + 1).padStart(2, '0');
    await seedRun(row.runId, [`2026-01-${day}`, `2026-01-${day}`]);
    row.waitId = await raise(row);
    await seedMatchingAgentContext(row);
  }
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    const runIds = cases.map(row => row.runId);
    await sql`DELETE FROM pgboss.job WHERE data->>'runId' = ANY(${runIds})`;
    await sql`DELETE FROM notification WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_agent_turn WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_agent_work WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_step_execution WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_work_item WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_evidence WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_wait WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM audit_events WHERE aggregate_id = ANY(${runIds})`;
    await sql`DELETE FROM audit_event_heads WHERE aggregate_id = ANY(${runIds})`;
    await sql`DELETE FROM audit_run WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM procedure_version WHERE version_id=${versionId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test.describe('hydrated golden escalation questions remain untrusted', () => {
  test.use({ storageState: AUTH_STATE.auditor });
  for (const row of cases) test(`${row.id}: no preselection and only the confirmed closed answer persists`, async ({ page }) => {
    await page.goto(`/runs/${row.runId}`);
    await expect(page.locator('#run-lifecycle')).toHaveAttribute('data-client-ready', 'true');
    const question = page.locator('.ls-untrusted__label').filter({ hasText: 'AGENT-GENERATED question' });
    await expect(question.locator('..').locator('pre')).toHaveText(row.text);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve and continue', exact: true })).toHaveCount(0);
    const [before] = await sql`SELECT closed_at,answer_option_id,options FROM run_wait WHERE wait_id=${row.waitId}`;
    expect(before).toMatchObject({ closed_at: null, answer_option_id: null });
    expect((before!.options as { id: string }[]).map(option => option.id)).toEqual(['retry','skip','abort']);
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe('Go back');
    // Choosing a button alone cannot persist anything.
    expect((await sql`SELECT answer_option_id FROM run_wait WHERE wait_id=${row.waitId}`)[0]?.answer_option_id).toBeNull();
    await page.getByRole('dialog').getByRole('button', { name: 'Record answer', exact: true }).click();
    await expect(page.getByText('Escalation answered.', { exact: true })).toBeVisible();
    const [after] = await sql`SELECT answer_option_id,options,actor,closed_at FROM run_wait WHERE wait_id=${row.waitId}`;
    expect(after).toMatchObject({ answer_option_id: 'skip', actor: auditorId, options: before!.options });
    expect(after!.closed_at).not.toBeNull();
    const events = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${row.runId} AND event_type='execution.escalation-answered'`;
    expect(events).toHaveLength(1);
    // The success banner is set before router.refresh() finishes. Wait for the
    // authoritative closed-wait render and its route metadata before scanning it.
    // A stale open panel or missing title remains an assertion failure; no axe rule
    // is disabled and an accessibility violation is never retried into a pass.
    await expect(page.locator('#open-escalation')).toHaveCount(0);
    await expect(page).toHaveTitle('Run · Result · IntelliFin Audit');
    await scan(page);
  });
});
