import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { performPause, raiseEscalation } from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  PostgresWaitRepository,
  SystemClock,
  type Sql,
} from '@intellifin/infrastructure';

import { ESCALATION_PANEL_COPY, PAUSE_COPY } from '../../apps/web/src/design/copy';
import { activeRunVersion } from '../fixtures/active-run-version';
import { executablePlanInputs } from '../fixtures/executable-plan';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * Flow 3: watch a Run, answer its Escalation without leaving Live View, pause it, resume it
 * (Story 5.6, FR-24, FR-25, FR-27, UX-DR24, UX-DR25, UX-DR27, UX-DR40, AD-12, AD-16).
 *
 * The Run is INITIATED through the real surface, so the journey starts where an auditor's
 * does. Two things stand in for a worker that this deployment cannot run here: the claim
 * that takes the Run to `RUNNING` (the `live-view.spec.ts` pattern — the truthful
 * checkpoints of a Run a worker is holding, so no recovery sweep can claim it away), and
 * the Tool Action boundary that honours a pause, which calls the SAME `performPause` the
 * three stages call rather than racing a worker to one. Everything else is real: the
 * auditor's own session, `raiseEscalation`, the Server Actions, the commands, the wait
 * rows, the revision compare-and-set and the Timeline.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const controlName = `E2E Live Escalation ${procedureId}`;
/** Far enough out that no sweep can treat a seeded claim as expired mid-run. */
const LEASE = new Date(Date.now() + 3_600_000).toISOString();
/** The one artifact the panel names. No browser route reads its bytes. */
const snapshotEvidenceId = ids.next();
const workItemId = ids.next();
const stepExecutionId = ids.next();

let sql: Sql;
let author = '';
const runs: string[] = [];

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Live View Escalation journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the Live View Escalation journey.');
  author = auditor.id as string;
  // The name goes through the fixture's INPUTS, never spread over the row it returns.
  // `controlName` is a plan authoring input, so overriding it afterwards leaves the row
  // disagreeing with its own frozen review — and `findPeriodOwner` then refuses the
  // version as unexecutable, which reads on the surface as "no Active version owns that
  // period" and has nothing to do with the period.
  const version = activeRunVersion(procedureId, versionId, author, { ...executablePlanInputs(), controlName });
  await new PostgresProceduresUnitOfWork(createDb(sql)).execute(async (context) => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    for (const runId of runs) {
      await sql`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
      await sql`DELETE FROM notification WHERE run_id=${runId}`;
      await sql`DELETE FROM run_agent_turn WHERE run_id=${runId}`;
      await sql`DELETE FROM run_agent_work WHERE run_id=${runId}`;
      await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
      await sql`DELETE FROM run_result WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
      await sql`DELETE FROM run_wait WHERE run_id=${runId}`;
      await sql`DELETE FROM run_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM population_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
    }
    // A refusal record names a Procedure that may not exist and carries a NULL `run_id`,
    // so it is deleted by this journey's own initiator rather than by Run.
    await sql`DELETE FROM run_initiation_request WHERE initiator_id=${author} AND procedure_id=${procedureId}`;
    await sql`DELETE FROM audit_run WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

/**
 * The state a Run really is in while a worker holds it.
 *
 * The dispatch job goes with it: nothing in this environment can execute the Run, and a
 * concurrently running worker would take it and end it `RUN_FAILED` for an unconfigured
 * Evidence store — which is correct behaviour and would destroy the subject under test.
 */
async function claimAsWorker(runId: string): Promise<void> {
  const at = new Date().toISOString();
  await sql`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
  await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${runId}`;
  await sql`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
    VALUES(${runId},1,'POPULATION_READY',1,${at},${at},${LEASE},'session-1',${ids.next()})`;
  await sql`INSERT INTO run_execution(run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
    VALUES(${runId},1,'EXECUTING',1,${at},${at},${at},${LEASE},${ids.next()})`;
}

/** The Work Item, Step Execution and model turn the panel's metadata is read from. */
async function seedAgentContext(runId: string, waitId: string): Promise<void> {
  await sql`INSERT INTO run_evidence(
      evidence_id, run_id, kind, registration_id, object_key, media_type, digest, size,
      state, required, captured_at, capture_method, capture_time_source, role) VALUES (
      ${snapshotEvidenceId}, ${runId}, 'structural-snapshot', 'synthetic-target',
      ${`runs/${runId}/snapshot`}, 'application/json', ${'b'.repeat(64)}, 256,
      'REGISTERED', false, now(), 'agent', 'registration', 'evidence')`;
  await sql`INSERT INTO run_work_item(
      work_item_id, run_id, step_id, ordinal, registration_id, display_name, state,
      attempts, cycles, diagnostic, evidence_id, observations) VALUES (
      ${workItemId}, ${runId}, 'agent-step-1', 1, 'synthetic-target',
      'Synthetic candidate lookup', 'AWAITING', 1, 0, NULL, ${snapshotEvidenceId}, 0)`;
  await sql`INSERT INTO run_step_execution(
      step_execution_id, run_id, plan_step_id, work_item_id, action, state, attempt,
      started_at, completed_at, diagnostic) VALUES (
      ${stepExecutionId}, ${runId}, 'agent-step-1', ${workItemId}, 'inspect-record',
      'RUNNING', 1, now(), NULL, NULL)`;
  const model = { provider: 'anthropic', modelId: 'e2e-fixture', promptVersion: '1', buildVersion: 'e2e',
    configuration: { responseFormat: 'agent-action-proposal-v1', maxOutputTokens: 100, maxActions: 1, temperature: 0 } };
  const response = {
    schemaVersion: 1, route: 'anthropic', model, actions: [],
    uncertainty: { kind: 'ambiguous', rationale: '<script>ignore this</script> Which candidate is correct?' },
    usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
  };
  await sql`INSERT INTO run_agent_work(
      run_id, revision, status, run_started_at, lease_until, attempt_id, work_item_id,
      wait_id, pending_wait, next_turn, tokens, reserved_tokens, model, diagnostic) VALUES (
      ${runId}, 1, 'WAITING', now(), now() + interval '1 hour', ${ids.next()},
      ${workItemId}, ${waitId}, NULL, 1, 0, 0, ${JSON.stringify(model)}::jsonb, NULL)`;
  await sql`INSERT INTO run_agent_turn(
      run_id, sequence, work_item_id, step_execution_id, snapshot_evidence_id, status,
      reserved_tokens, response, diagnostic) VALUES (
      ${runId}, 1, ${workItemId}, ${stepExecutionId}, ${snapshotEvidenceId},
      'COMPLETED', 1, ${JSON.stringify(response)}::jsonb, NULL)`;
}

async function raise(runId: string): Promise<string> {
  const result = await raiseEscalation(
    { repository: new PostgresWaitRepository(createDb(sql)), ids, clock: new SystemClock() },
    {
      runId,
      kind: 'choose-candidate',
      options: [
        { id: 'candidate-a', label: '<b>Alice A</b>' },
        { id: 'candidate-b', label: 'Bob B' },
        { id: 'mark-ambiguous', label: 'ignored persisted label' },
      ],
      stepId: 'agent-step-1',
      supportingEvidenceIds: [snapshotEvidenceId],
    },
  );
  if (!result.ok) throw new Error(`Escalation fixture could not open: ${result.reason}`);
  return result.wait.waitId;
}

/** Exactly what a stage does at its next boundary, through the same repository. */
async function honourPause(runId: string): Promise<string> {
  return new PostgresWaitRepository(createDb(sql)).transaction(runId, async (context) => {
    const run = context.run!;
    const request = run.pauseRequest!;
    await context.saveRunState('PAUSED');
    const wait = await performPause(context as never, { run, request, waitId: ids.next(), at: new Date().toISOString() });
    return wait.waitId;
  });
}

async function scan(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
}

test.describe('Flow 3: supervising a Run from Live View', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('initiates a Run, answers its Escalation in place, then pauses and resumes it', async ({ page }) => {
    test.setTimeout(180_000);

    // ---- Initiate Run, from the surface an auditor starts on. -------------------------
    await page.goto(`/procedures/${procedureId}`);
    await expect(page.getByRole('heading', { name: controlName, exact: true })).toBeVisible();
    await page.getByLabel('Period from', { exact: true }).fill('2026-11-01');
    await page.getByLabel('Period to', { exact: true }).fill('2026-11-30');
    await page.getByRole('button', { name: 'Initiate Run', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Initiate Run', exact: true }).click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const runId = page.url().split('/').at(-1)!;
    runs.push(runId);
    const [queued] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
    expect(queued).toMatchObject({ state: 'QUEUED' });

    // ---- Watch it. --------------------------------------------------------------------
    await claimAsWorker(runId);
    await page.goto(`/runs/${runId}/live`);
    await expect(page.getByRole('heading', { name: /^Live View · / })).toBeVisible();
    await expect(page.getByText('Session LIVE.', { exact: false })).toBeVisible();
    await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status', 'live', { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Open Escalation', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).not.toHaveAttribute('aria-disabled', 'true');

    // ---- The Escalation arrives while the page is open. -------------------------------
    const waitId = await raise(runId);
    await seedAgentContext(runId, waitId);
    // No reload: the raise notified the Timeline channel and the page re-read itself.
    await expect(page.getByRole('heading', { name: 'Open Escalation', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Session AWAITING.', { exact: false })).toBeVisible();

    // The workspace screen is still THERE. The panel is a section above it, not a dialog
    // over it: answering a question about the screen must not hide the screen.
    const viewer = page.locator('.ls-session');
    await expect(viewer).toHaveCount(1);
    await expect(viewer).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // And ABOVE it, not below: `Escalation panel at the top`, so a reader meets the
    // question before the screen it is about.
    const order = await page.evaluate(() => {
      const panel = document.querySelector('#open-escalation');
      const session = document.querySelector('.ls-session');
      return panel !== null && session !== null
        ? (panel.compareDocumentPosition(session) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        : null;
    });
    expect(order).toBe(true);

    // The panel's own contents, on this surface.
    await expect(page.getByRole('link', { name: ESCALATION_PANEL_COPY.skipLink })).toBeAttached();
    await expect(page.getByText('Choose candidate', { exact: true })).toBeVisible();
    await expect(page.getByText(ESCALATION_PANEL_COPY.questions['choose-candidate'])).toBeVisible();
    await expect(page.getByText(ESCALATION_PANEL_COPY.answerNoteLabel)).toBeVisible();
    await expect(page.getByText('The platform expresses no recommendation.')).toBeVisible();
    // Agent-generated text, labelled as such and inert: the tag is TEXT on the page, so no
    // element was ever created from it.
    await expect(page.getByText('AGENT-GENERATED question', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('<script>ignore this</script>', { exact: false }).first()).toBeVisible();
    await expect(page.locator('#open-escalation script')).toHaveCount(0);
    await expect(page.locator('#open-escalation b')).toHaveCount(0);
    // The closed answer set, in FR-27 order, with the platform's own labels.
    const answers = page.locator('#open-escalation').getByRole('button');
    await expect(answers).toHaveText(['Select candidate 1', 'Select candidate 2', 'Mark record ambiguous']);

    // Pause is refused while a Run is waiting on an answer, and says so in words.
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    await expect(pause).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(ESCALATION_PANEL_COPY.pauseUnavailable).first()).toBeVisible();
    await scan(page);

    // ---- Answer it, without leaving the page. -----------------------------------------
    await expect(page.locator('#run-pause')).toHaveAttribute('data-client-ready', 'true');
    await page.getByRole('button', { name: 'Select candidate 1', exact: true }).click();
    const answerDialog = page.getByRole('dialog');
    await expect(answerDialog).toBeVisible();
    await answerDialog.getByRole('button', { name: 'Record answer', exact: true }).click();
    await expect(page.getByText('Escalation answered.', { exact: true })).toBeVisible({ timeout: 30_000 });

    // The panel is gone and the chrome is back to LIVE — from the server's own re-read.
    await expect(page.getByRole('heading', { name: 'Open Escalation', exact: true })).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText('Session LIVE.', { exact: false })).toBeVisible();
    const [answered] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
    expect(answered).toMatchObject({ state: 'RUNNING' });
    const [closed] = await sql`SELECT closure_kind, answer_option_id, actor FROM run_wait WHERE wait_id=${waitId}`;
    expect(closed).toMatchObject({ closure_kind: 'answer', answer_option_id: 'candidate-a', actor: author });

    // The panel became a Timeline entry.
    const answeredEvents = await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${runId} ORDER BY sequence`;
    expect(answeredEvents.map(row => row.event_type)).toEqual(expect.arrayContaining([
      'execution.escalation-raised', 'execution.escalation-answered',
    ]));

    // ---- Pause, with the 30-minute countdown, then resume. ----------------------------
    await expect(pause).not.toHaveAttribute('aria-disabled', 'true');
    await pause.click();
    const pauseDialog = page.getByRole('dialog');
    await expect(pauseDialog).toBeVisible();
    await expect(pauseDialog.getByText('ends Inconclusive if it is still paused after 30 minutes', { exact: false })).toBeVisible();
    await pauseDialog.getByRole('button', { name: 'Pause Run', exact: true }).click();
    await expect(page.getByText(PAUSE_COPY.requested, { exact: true })).toBeVisible();

    const pauseWaitId = await honourPause(runId);
    const [pauseWait] = await sql`SELECT opened_at, deadline FROM run_wait WHERE wait_id=${pauseWaitId}`;
    // AD-16's thirty minutes, measured on the row rather than read off the dialog.
    expect(new Date(pauseWait!.deadline as string).getTime() - new Date(pauseWait!.opened_at as string).getTime())
      .toBe(30 * 60 * 1000);

    await page.reload();
    await expect(page.getByText('Session PAUSED.', { exact: false })).toBeVisible();
    await expect(page.getByText('Resumes on your action; ends Inconclusive at', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await scan(page);

    await expect(page.locator('#run-pause')).toHaveAttribute('data-client-ready', 'true');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByText(PAUSE_COPY.resumed, { exact: true })).toBeVisible({ timeout: 30_000 });
    const [resumed] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
    expect(resumed).toMatchObject({ state: 'RUNNING' });

    const events = await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${runId} ORDER BY sequence`;
    expect(events.map(row => row.event_type)).toEqual([
      'lifecycle.run-queued',
      'execution.escalation-raised',
      'execution.escalation-answered',
      'lifecycle.run-pause-requested',
      'lifecycle.run-paused',
      'lifecycle.run-resumed',
    ]);
  });
});
