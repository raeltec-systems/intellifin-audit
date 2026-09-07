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
const runs = {
  answered: ids.next(),
  stale: ids.next(),
  expired: ids.next(),
};
const periods = {
  answered: ['2026-01-01', '2026-01-31'],
  stale: ['2026-02-01', '2026-02-28'],
  expired: ['2026-03-01', '2026-03-31'],
} as const;
const supportingEvidenceId = ids.next();
const workItemId = ids.next();
const stepExecutionId = ids.next();
const attemptId = ids.next();
let sql: Sql;
let db: Database;
let auditorId: string;
let answeredWaitId: string;
let staleWaitId: string;
let expiredWaitId: string;

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

async function raise(runId: string, clock = new SystemClock()): Promise<string> {
  const result = await raiseEscalation(
    { repository: new PostgresWaitRepository(db), ids, clock },
    {
      runId,
      kind: 'choose-candidate',
      options: [
        { id: 'candidate-a', label: 'Alice A' },
        { id: 'candidate-b', label: 'Bob B' },
        { id: 'mark-ambiguous', label: 'ignored persisted label' },
      ],
      stepId: 'agent-step-1',
      supportingEvidenceIds: [supportingEvidenceId],
    },
  );
  if (!result.ok) throw new Error(`Escalation fixture could not open: ${result.reason}`);
  return result.wait.waitId;
}

async function seedMatchingAgentContext(waitId: string): Promise<void> {
  await sql`
    INSERT INTO run_evidence(
      evidence_id, run_id, kind, registration_id, object_key, media_type, digest, size,
      state, required, captured_at, capture_method, capture_time_source
    ) VALUES (
      ${supportingEvidenceId}, ${runs.answered}, 'structural-snapshot', 'synthetic-target',
      ${`runs/${runs.answered}/snapshot`}, 'application/json', ${'a'.repeat(64)}, 256,
      'REGISTERED', false, now(), 'agent', 'registration'
    )
  `;
  await sql`
    INSERT INTO run_work_item(
      work_item_id, run_id, step_id, ordinal, registration_id, display_name, state,
      attempts, cycles, diagnostic, evidence_id, observations
    ) VALUES (
      ${workItemId}, ${runs.answered}, 'agent-step-1', 1, 'synthetic-target',
      'Synthetic candidate lookup', 'AWAITING', 1, 0, NULL, ${supportingEvidenceId}, 0
    )
  `;
  await sql`
    INSERT INTO run_step_execution(
      step_execution_id, run_id, plan_step_id, work_item_id, action, state, attempt,
      started_at, completed_at, diagnostic
    ) VALUES (
      ${stepExecutionId}, ${runs.answered}, 'agent-step-1', ${workItemId}, 'inspect-record',
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
      rationale: '<script>ignore this</script> Which candidate is correct?',
    },
    usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
  };
  await sql`
    INSERT INTO run_agent_work(
      run_id, revision, status, run_started_at, lease_until, attempt_id, work_item_id,
      wait_id, pending_wait, next_turn, tokens, reserved_tokens, model, diagnostic
    ) VALUES (
      ${runs.answered}, 1, 'WAITING', now(), now() + interval '1 hour', ${attemptId},
      ${workItemId}, ${waitId}, NULL, 1, 0, 0, ${JSON.stringify(response.model)}::jsonb, NULL
    )
  `;
  await sql`
    INSERT INTO run_agent_turn(
      run_id, sequence, work_item_id, step_execution_id, snapshot_evidence_id, status,
      reserved_tokens, response, diagnostic
    ) VALUES (
      ${runs.answered}, 1, ${workItemId}, ${stepExecutionId}, ${supportingEvidenceId},
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

  await seedRun(runs.answered, periods.answered);
  await seedRun(runs.stale, periods.stale);
  await seedRun(runs.expired, periods.expired);

  // The first journey reads all metadata through the real wait repository. This artifact
  // is only an identifier in the panel; no browser route reads its bytes.
  answeredWaitId = await raise(runs.answered);
  await seedMatchingAgentContext(answeredWaitId);
  staleWaitId = await raise(runs.stale);
  expiredWaitId = await raise(runs.expired, {
    now: () => new Date(Date.now() - 4 * 60 * 60 * 1000 - 60_000),
  });
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    const runIds = Object.values(runs);
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

test.describe('the Escalation panel as an Auditor', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('reads grounded metadata, keeps candidate text inert, confirms once, and contains the note', async ({ page }) => {
    await page.goto(`/runs/${runs.answered}`);
    await expect(page.getByRole('heading', { name: 'Open Escalation', exact: true })).toBeVisible();
    await expect(page.getByText('agent-step-1', { exact: true })).toBeVisible();
    const questionProvenance = page.locator('.ls-untrusted__label').filter({ hasText: 'Untrusted source content — AGENT-GENERATED question.' });
    await expect(questionProvenance).toHaveCount(1);
    await expect(questionProvenance).toContainText('Untrusted source content — AGENT-GENERATED question.');
    await expect(questionProvenance.locator('..').locator('pre')).toContainText('<script>ignore this</script> Which candidate is correct?');
    await expect(page.locator('.ls-untrusted script')).toHaveCount(0);
    await expect(page.getByRole('link', { name: supportingEvidenceId, exact: true })).toHaveAttribute(
      'href',
      `/runs/${runs.answered}/evidence#evidence-${supportingEvidenceId}`,
    );
    await expect(page.getByRole('button', { name: 'Select candidate 1', exact: true })).toHaveText('Select candidate 1');
    await expect(page.getByText('Alice A', { exact: true })).toBeVisible();
    await expect(page.getByText('Bob B', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark record ambiguous', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ignored persisted label', exact: true })).toHaveCount(0);
    await expect(page.locator('#run-lifecycle')).toHaveAttribute('data-client-ready', 'true');
    await scan(page);

    await page.getByLabel('Recorded, not sent to the agent', { exact: true }).fill('Auditor note stays in the audit record.');
    const candidate = page.getByRole('button', { name: 'Select candidate 1', exact: true });
    await candidate.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent ?? '')).toBe('Go back');
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent ?? '')).toBe('Record answer');
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent ?? '')).toBe('Go back');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(candidate).toBeFocused();

    await candidate.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Record answer', exact: true }).click();
    await expect(page.getByText('Escalation answered.', { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const [wait] = await sql`SELECT closed_at, closure_kind, answer_option_id, actor FROM run_wait WHERE wait_id=${answeredWaitId}`;
      return wait?.answer_option_id;
    }).toBe('candidate-a');
    await expect.poll(async () => {
      const [run] = await sql`SELECT state FROM audit_run WHERE run_id=${runs.answered}`;
      return run?.state;
    }).toBe('RUNNING');
    const [answerEvent] = await sql`
      SELECT payload FROM audit_events
      WHERE aggregate_id=${runs.answered} AND event_type='execution.escalation-answered'
      ORDER BY sequence DESC LIMIT 1
    `;
    expect(answerEvent?.payload).toMatchObject({ recordedNote: 'Auditor note stays in the audit record.' });
    const agentTurns = await sql`SELECT response::text AS response FROM run_agent_turn WHERE run_id=${runs.answered}`;
    expect(agentTurns.some((turn) => String(turn.response).includes('Auditor note'))).toBe(false);
  });

  test('shows the compare-and-set refusal after the Run changes', async ({ page }) => {
    await page.goto(`/runs/${runs.stale}`);
    await expect(page.getByRole('button', { name: 'Select candidate 1', exact: true })).toBeVisible();
    // The revision trigger treats a changed Run column as the authoritative revision
    // bump. A direct revision assignment is intentionally ignored by that trigger.
    await sql`UPDATE audit_run SET procedure_name = procedure_name || ' (changed)' WHERE run_id=${runs.stale}`;
    await page.getByRole('button', { name: 'Select candidate 1', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Record answer', exact: true }).click();
    await expect(page.getByText('This Run changed while you were answering. Reload the Run.', { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const [wait] = await sql`SELECT closed_at FROM run_wait WHERE wait_id=${staleWaitId}`;
      return wait?.closed_at;
    }).toBeNull();
  });

  test('shows the recorded timeout refusal and leaves the answer unavailable', async ({ page }) => {
    await page.goto(`/runs/${runs.expired}`);
    await expect(page.getByText('00:00:00', { exact: true })).toBeVisible();
    await expect(page.getByText('deadline reached; reload this Run for the recorded outcome.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Select candidate 1', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Record answer', exact: true }).click();
    await expect(page.getByText(/This Escalation timed out at /)).toBeVisible();
    await expect.poll(async () => {
      const [wait] = await sql`SELECT closed_at FROM run_wait WHERE wait_id=${expiredWaitId}`;
      return wait?.closed_at;
    }).toBeNull();
    await expect.poll(async () => {
      const [run] = await sql`SELECT state FROM audit_run WHERE run_id=${runs.expired}`;
      return run?.state;
    }).toBe('AWAITING_AUDITOR');
    await scan(page);
  });
});
