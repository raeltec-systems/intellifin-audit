import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

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
import { startSyntheticS3 } from '../fixtures/s3-server';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase, signIn } from './accounts';

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
const expiredEvidenceId = ids.next();
const managerIds = [ids.next(), ids.next()];
const workItemId = ids.next();
const stepExecutionId = ids.next();
const attemptId = ids.next();
let sql: Sql;
let db: Database;
let auditorId: string;
let answeredWaitId: string;
let staleWaitId: string;
let expiredWaitId: string;
let stopWorker: (() => Promise<void>) | undefined;
let storage: Awaited<ReturnType<typeof startSyntheticS3>> | undefined;

/** The built production composition consumes the real durable queues. No wake handler or
 * notification sender is called by the test. These duties work with execution unconfigured. */
async function startWorker(): Promise<void> {
  let ready = false;
  let failed = false;
  let stopping = false;
  let closed = false;
  const worker = spawn(process.execPath, [resolve('apps/worker/dist/main.js')], {
    cwd: process.cwd(),
    windowsHide: true,
    env: {
      ...process.env,
      SERVICE_NAME: 'worker', MODEL_PROVIDER: '', MODEL_ID: '', MODEL_API_KEY: '',
      ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', SOLARI_API_KEY: '', SOLARI_RECORDING: 'false',
      CREDENTIAL_TOKENS: '{}', SENTRY_DSN: '',
      EVIDENCE_S3_ENDPOINT: '', EVIDENCE_S3_REGION: '', EVIDENCE_S3_BUCKET: '',
      EVIDENCE_S3_ACCESS_KEY_ID: '', EVIDENCE_S3_SECRET_ACCESS_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.on('error', () => { failed = true; });
  const exited = new Promise<void>(resolveExit => worker.once('close', code => {
    closed = true;
    if (code !== 0 || !stopping) failed = true;
    resolveExit();
  }));
  // Retain only fixed status markers, never configuration or arbitrary worker output.
  worker.stdout.on('data', data => { if (String(data).includes('Heartbeat loop started')) ready = true; });
  worker.stderr.on('data', () => undefined);
  stopWorker = async () => {
    stopping = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!closed) worker.kill('SIGTERM');
      const graceful = await Promise.race([
        exited.then(() => true),
        new Promise<boolean>(resolveTimeout => { timer = setTimeout(() => resolveTimeout(false), 30_000); }),
      ]);
      if (!graceful) {
        worker.kill('SIGKILL');
        throw new Error('Escalation fixture worker exceeded its graceful shutdown deadline.');
      }
      if (failed) throw new Error('Escalation fixture worker did not exit cleanly.');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      stopWorker = undefined;
    }
  };
  await expect.poll(() => {
    if (failed) throw new Error('Escalation fixture worker failed before becoming ready.');
    return ready;
  }, { timeout: 60_000 }).toBe(true);
}

async function deliverySnapshot(): Promise<string> {
  return JSON.stringify(await sql`
    SELECT send_key, recipient_id, in_app_outcome, delivered_at, email_outcome, email_outcome_at
    FROM notification WHERE wait_id=${answeredWaitId} ORDER BY send_key
  `);
}

async function assertDeliveredNotifications(): Promise<void> {
  const recipients = (await sql`
    SELECT user_id AS id FROM user_role WHERE role='audit-manager'
    UNION SELECT ${auditorId}::text AS id
  `).map(row => String(row.id)).sort();
  expect(managerIds.every(id => recipients.includes(id))).toBe(true);
  await expect.poll(async () => (await sql`
    SELECT recipient_id FROM notification WHERE wait_id=${answeredWaitId}
    AND in_app_outcome='delivered' AND delivered_at IS NOT NULL
    AND email_outcome='unconfigured' AND email_outcome_at IS NOT NULL
  `).map(row => String(row.recipient_id)).sort(), { timeout: 30_000 }).toEqual(recipients);
  const notifications = await sql`SELECT * FROM notification WHERE wait_id=${answeredWaitId}`;
  expect(notifications).toHaveLength(recipients.length);
  for (const row of notifications) {
    expect(row).toMatchObject({ procedure_name: controlName, run_id: runs.answered,
      kind: 'escalation', escalation_kind: 'choose-candidate' });
    expect(row.deadline).not.toBeNull();
  }
  const deliveries = await sql`
    SELECT event_type, outcome, payload FROM audit_events WHERE aggregate_id=${runs.answered}
    AND event_type IN ('notification.in-app-delivery','notification.email-delivery')
  `;
  expect(deliveries).toHaveLength(recipients.length * 2);
  for (const recipientId of recipients) {
    const recipientEvents = deliveries.filter(row => row.payload.recipientId === recipientId);
    expect(recipientEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'notification.in-app-delivery', outcome: 'success',
        payload: expect.objectContaining({ channel: 'in-app', deliveryOutcome: 'delivered' }) }),
      expect.objectContaining({ event_type: 'notification.email-delivery', outcome: 'failure',
        payload: expect.objectContaining({ channel: 'email', deliveryOutcome: 'unconfigured' }) }),
    ]));
  }
  for (const forbidden of [supportingEvidenceId, 'Alice A', 'Bob B', '<script>ignore this</script>',
    'Which candidate is correct?', 'Auditor note stays in the audit record.']) {
    expect(JSON.stringify({ notifications, deliveries })).not.toContain(forbidden);
  }
}

async function openFromNotifications(page: Page): Promise<void> {
  await page.goto('/notifications');
  const bell = page.getByRole('button', { name: /^Notifications/ });
  await expect(bell).toContainText('unread');
  await bell.click();
  await expect(page.getByRole('link', { name: 'Open notifications', exact: true })).toHaveAttribute('href', '/notifications');
  await page.keyboard.press('Escape');
  const open = page.getByRole('region', { name: 'Runs waiting for your answer' });
  const delivered = page.getByRole('region', { name: 'Delivered notifications' });
  await expect(bell.locator('.ls-bell__count')).toHaveText(`${await open.locator('li').count()} unread`);
  for (const surface of [open, delivered]) {
    const row = surface.locator('li').filter({ has: page.locator(`a[href="/runs/${runs.answered}"]`) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(controlName);
    await expect(row).toContainText('choose-candidate');
    await expect(row).toContainText('Time remaining:');
    await expect(row).not.toContainText('Alice A');
    await expect(row).not.toContainText('Which candidate is correct?');
  }
  await scan(page);
  await open.locator(`a[href="/runs/${runs.answered}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runs.answered}$`));
  await expect(page.getByRole('heading', { name: 'Open Escalation', exact: true })).toBeVisible();
}

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

async function raise(runId: string, clock = new SystemClock(), evidenceId = supportingEvidenceId): Promise<string> {
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
      supportingEvidenceIds: [evidenceId],
    },
  );
  if (!result.ok) throw new Error(`Escalation fixture could not open: ${result.reason}`);
  return result.wait.waitId;
}

async function seedMatchingAgentContext(waitId: string): Promise<void> {
  await sql`
    INSERT INTO run_evidence(
      evidence_id, run_id, kind, registration_id, object_key, media_type, digest, size,
      state, required, captured_at, capture_method, capture_time_source,role) VALUES (
      ${supportingEvidenceId}, ${runs.answered}, 'structural-snapshot', 'synthetic-target',
      ${`runs/${runs.answered}/snapshot`}, 'application/json', ${'a'.repeat(64)}, 256,
      'REGISTERED', false, now(), 'agent', 'registration','evidence')
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
  for (const managerId of managerIds) {
    await sql`INSERT INTO auth_user(id,name,email,email_verified)
      VALUES (${managerId},'Synthetic Escalation Manager',${`${managerId}@example.test`},true)`;
    // Reuse only the seeded synthetic hash inside SQL; sign-in below uses the real form.
    await sql`INSERT INTO auth_account(id,issuer,account_id,provider_id,user_id,password)
      SELECT ${ids.next()},issuer,${managerId},provider_id,${managerId},password
      FROM auth_account WHERE user_id=${auditorId} AND provider_id='credential'`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${managerId},'audit-manager')`;
  }

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
});

test.afterAll(async () => {
  await stopWorker?.();
  await storage?.close();
  if (!sql) return;
  try {
    const runIds = Object.values(runs);
    await sql`DELETE FROM pgboss.job WHERE data->>'runId' = ANY(${runIds})`;
    await sql`DELETE FROM notification WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_agent_turn WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_agent_work WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_step_execution WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_work_item WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_result WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_evidence_integrity WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_evidence_package WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_evidence WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM run_wait WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM audit_events WHERE aggregate_id = ANY(${runIds})`;
    await sql`DELETE FROM audit_event_heads WHERE aggregate_id = ANY(${runIds})`;
    await sql`DELETE FROM audit_run WHERE run_id = ANY(${runIds}::uuid[])`;
    await sql`DELETE FROM procedure_version WHERE version_id=${versionId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM auth_user WHERE id = ANY(${managerIds})`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test.describe('the Escalation panel as an Auditor', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('delivers to Auditor and Managers, opens grounded metadata, confirms once, and contains the note', async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    await startWorker();
    await assertDeliveredNotifications();
    await stopWorker?.();
    await openFromNotifications(page);
    const managerContext = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const managerPage = await managerContext.newPage();
      await signIn(managerPage, `${managerIds[0]}@example.test`);
      await openFromNotifications(managerPage);
    } finally {
      await managerContext.close();
    }
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

  test('refuses a late answer, then the restarted worker consumes the durable wake and seals Inconclusive', async ({ page }) => {
    test.setTimeout(120_000);
    // Each scenario owns its restart baseline. Playwright starts a fresh fixture process
    // after a prior failure, and this case must also work when selected by itself.
    await startWorker();
    await assertDeliveredNotifications();
    const deliveredBeforeRestart = await deliverySnapshot();
    await stopWorker?.();
    storage = await startSyntheticS3();
    // An already-collected synthetic artifact; the timeout must preserve its bytes and
    // registration. This fixture does not claim a fresh browser capture or remote provider.
    const bytes = Buffer.from('{"syntheticEvidence":"timeout-preservation-marker"}');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const key = `runs/${runs.expired}/collected-before-wait.json`;
    const objectUrl = `${storage.env.EVIDENCE_S3_ENDPOINT}/evidence/${key}`;
    expect((await fetch(objectUrl, { method: 'PUT', headers: { 'if-none-match': '*' }, body: bytes })).status).toBe(200);
    await sql`INSERT INTO run_evidence(
      evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required,
      captured_at,capture_method,capture_time_source,role) VALUES (${expiredEvidenceId},${runs.expired},'structural-snapshot','synthetic-target',${key},
      'application/json',${digest},${bytes.length},'REGISTERED',true,now(),'agent','registration','evidence')`;
    const evidenceBefore = await sql`SELECT * FROM run_evidence WHERE evidence_id=${expiredEvidenceId}`;
    expiredWaitId = await raise(runs.expired, {
      now: () => new Date(Date.now() - 4 * 60 * 60 * 1000 - 60_000),
    }, expiredEvidenceId);
    const wakeJobs = await sql`SELECT id,state,data,start_after FROM pgboss.job
      WHERE name='waits' AND data->>'waitId'=${expiredWaitId}`;
    expect(wakeJobs).toHaveLength(1);
    expect(wakeJobs[0]?.state).toBe('created');
    expect(wakeJobs[0]?.data).toEqual({ schemaVersion: 1, runId: runs.expired, waitId: expiredWaitId });
    expect(new Date(wakeJobs[0]!.start_after).getTime()).toBeLessThan(Date.now());
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

    // A real restart discovers the persisted wait, runs the production wake consumer /
    // recovery duty, and lets the shared CompleteRun path publish the only terminal Result.
    await startWorker();
    await expect.poll(async () => (await sql`SELECT state FROM audit_run WHERE run_id=${runs.expired}`)[0]?.state,
      { timeout: 45_000 }).toBe('INCONCLUSIVE');
    await expect.poll(async () => (await sql`SELECT state FROM pgboss.job WHERE id=${wakeJobs[0]!.id}`)[0]?.state,
      { timeout: 30_000 }).toBe('completed');
    const [wait] = await sql`SELECT closed_at,closure_kind,answer_option_id,actor FROM run_wait WHERE wait_id=${expiredWaitId}`;
    expect(wait).toMatchObject({ closure_kind: 'timeout', answer_option_id: null, actor: 'wait-wake' });
    expect(wait?.closed_at).not.toBeNull();
    expect(await sql`SELECT * FROM run_evidence WHERE evidence_id=${expiredEvidenceId}`).toEqual(evidenceBefore);
    const preserved = Buffer.from(await (await fetch(objectUrl)).arrayBuffer());
    expect(preserved).toEqual(bytes);
    expect(createHash('sha256').update(preserved).digest('hex')).toBe(digest);
    expect(await sql`SELECT outcome FROM run_result WHERE run_id=${runs.expired}`).toEqual([
      expect.objectContaining({ outcome: 'INCONCLUSIVE' }),
    ]);
    expect(await sql`SELECT state,run_state,registered FROM run_evidence_package WHERE run_id=${runs.expired}`).toEqual([
      expect.objectContaining({ state: 'SEALED', run_state: 'INCONCLUSIVE', registered: 1 }),
    ]);
    const timeoutEvents = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${runs.expired}
      AND event_type='execution.escalation-timeout'`;
    expect(timeoutEvents).toEqual([expect.objectContaining({ payload: expect.objectContaining({
      waitId: expiredWaitId, closureKind: 'timeout', state: 'INCONCLUSIVE',
    }) })]);
    expect(await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${runs.expired}
      AND event_type='execution.escalation-answered'`).toHaveLength(0);
    await assertDeliveredNotifications();
    expect(await deliverySnapshot()).toBe(deliveredBeforeRestart);
    await stopWorker?.();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Open Escalation', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Select candidate 1', exact: true })).toHaveCount(0);
    await expect(page.getByText('Inconclusive', { exact: true }).first()).toBeVisible();
    await scan(page);
    await page.goto('/notifications');
    const open = page.getByRole('region', { name: 'Runs waiting for your answer' });
    await expect(open.locator(`a[href="/runs/${runs.expired}"]`)).toHaveCount(0);
    await expect(page.locator('.ls-bell__count')).toHaveText(`${await open.locator('li').count()} unread`);
  });
});
