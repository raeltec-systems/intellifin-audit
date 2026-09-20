import { expect, test, type Page } from '@playwright/test';
import { answerEscalation, raiseEscalation } from '@intellifin/application';
import { createDb, CryptoUuidV7Generator, DrizzleRoleRepository, PostgresRunsUnitOfWork, PostgresWaitRepository, SystemClock } from '@intellifin/infrastructure';
import { createRunWorkspaceBrowserFixture, type RunWorkspaceBrowserFixture } from '../fixtures/run-workspace-browser';
import { AUTH_STATE } from './accounts';

// Protocol fixtures prove the authenticated question boundary. The separate compiled-worker
// journey proves actual candidate consumption; this P4 fixture makes no execution claim.
const ids = new CryptoUuidV7Generator();
let fixture: RunWorkspaceBrowserFixture;
const path = () => `/runs/${fixture.runId}/workspace`;
const composer = (page: Page) => page.getByLabel('Message the Run', { exact: true });
const dependencies = () => {
  const db = createDb(fixture.sql);
  return { repository: new PostgresWaitRepository(db), roles: new DrizzleRoleRepository(db),
    unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock: new SystemClock() };
};
async function open(page: Page) {
  await page.goto(path());
  await expect(composer(page)).toBeEditable();
  await expect(page.locator('.run-conversation__composer-form')).toContainText('Current question:');
}
async function propose(page: Page, text = 'candidate-a') {
  await composer(page).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review answer', exact: true })).toBeVisible();
  const [command] = await fixture.sql`SELECT command_id,answer_anchor,answer_option_id FROM run_interaction_command WHERE run_id=${fixture.runId} AND kind='answer' ORDER BY created_at DESC LIMIT 1`;
  if (!command) throw new Error('Answer command missing');
  return command;
}
async function openReview(page: Page) {
  await page.getByRole('button', { name: 'Review answer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm this answer?', exact: true });
  await expect(dialog).toContainText('Synthetic candidate A');
  await expect(dialog).toContainText('Confirm before');
  return dialog;
}
async function replaceQuestion() {
  const [run] = await fixture.sql`SELECT revision FROM audit_run WHERE run_id=${fixture.runId}`;
  const result = await answerEscalation(dependencies(), { session: { userId: fixture.auditorId, sessionId: 'answer-draft-fixture' },
    request: { runId: fixture.runId, waitId: fixture.waitId, expectedRunRevision: Number(run!.revision), answerOptionId: 'candidate-b' } });
  if (!result.ok) throw new Error(result.reason);
  const [wait] = await fixture.sql`SELECT options FROM run_wait WHERE wait_id=${fixture.waitId}`;
  const [work] = await fixture.sql`SELECT step_id FROM run_work_item WHERE run_id=${fixture.runId}`;
  await fixture.sql`UPDATE run_agent_work SET wait_id=NULL WHERE run_id=${fixture.runId}`;
  const raised = await raiseEscalation(dependencies(), { runId: fixture.runId, kind: 'choose-candidate',
    options: wait!.options, stepId: String(work!.step_id), supportingEvidenceIds: [fixture.evidenceId] });
  if (!raised.ok) throw new Error(raised.reason);
  return raised.wait.waitId;
}

test.describe('conversation answers through authenticated workspace', () => {
  test.use({ storageState: AUTH_STATE.auditor });
  test.beforeEach(async () => {
    test.setTimeout(120_000);
    fixture = await createRunWorkspaceBrowserFixture();
  });
  test.afterEach(async () => { await fixture?.restoreAuditor(); await fixture?.cleanup(); });

  test('a W1 draft survives W2 refresh and cannot answer the replacement question', async ({ page }) => {
    await open(page);
    await composer(page).fill('candidate-a');
    const second = await replaceQuestion();
    await expect(page.locator('.run-conversation__composer-form')).toContainText('This question changed.');
    await expect(composer(page)).toHaveValue('candidate-a');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.run-conversation__composer-error')).toContainText('referenced wait is not open');
    expect(await fixture.sql`SELECT closed_at FROM run_wait WHERE wait_id=${second}`).toEqual([{ closed_at: null }]);
    expect(await fixture.sql`SELECT command_id FROM run_interaction_command WHERE run_id=${fixture.runId} AND kind='answer'`).toHaveLength(0);
  });

  test('lost intake response retains the exact request across question replacement', async ({ page }) => {
    await open(page);
    const requests: unknown[] = [];
    let lost = false;
    await page.route(`**${path()}`, async route => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
        const args = JSON.parse(route.request().postData() ?? '[]') as { text?: string }[];
        if (args[0]?.text === 'candidate-a') {
          requests.push(args[0]);
          if (!lost) { lost = true; await route.fetch(); await route.abort('failed'); return; }
        }
      }
      await route.continue();
    });
    await composer(page).fill('candidate-a');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.run-conversation__composer-form')).toContainText('Delivery is unknown.');
    const second = await replaceQuestion();
    await expect(page.locator('.run-conversation__composer-form')).toContainText('This question changed.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(composer(page)).toHaveValue('');
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(await fixture.sql`SELECT command_id FROM run_interaction_command WHERE run_id=${fixture.runId} AND kind='answer'`).toHaveLength(1);
    expect(await fixture.sql`SELECT closed_at FROM run_wait WHERE wait_id=${second}`).toEqual([{ closed_at: null }]);
  });

  test('confirms without controller ownership and recovers a lost response exactly once', async ({ page }) => {
    await open(page);
    const command = await propose(page);
    expect(await fixture.sql`SELECT run_id FROM run_control_lease WHERE run_id=${fixture.runId}`).toHaveLength(0);
    const dialog = await openReview(page);
    let lost = false;
    let retried = false;
    const requests: Record<string, unknown>[] = [];
    let replayed = false;
    let releaseRefresh!: () => void;
    const refreshHeld = new Promise<void>(resolve => { releaseRefresh = resolve; });
    await page.route(`**${path()}*`, async route => {
      const request = route.request();
      // Delay authoritative refresh, not the mutation, so the actual recovery button
      // remains reviewable until the auditor retries the same lost confirmation.
      if (lost && !retried && request.method() === 'GET') await refreshHeld;
      if (request.method() === 'POST' && request.headers()['next-action']) {
        const args = JSON.parse(request.postData() ?? '[]') as Record<string, unknown>[];
        const argument = args[0];
        if (argument && argument.commandId === command.command_id) {
          requests.push(argument);
          if (!lost) { lost = true; await route.fetch(); await route.abort('failed'); return; }
          retried = true;
          const response = await route.fetch();
          replayed = (await response.text()).includes('"replayed":true');
          await route.fulfill({ response });
          releaseRefresh();
          return;
        }
      }
      await route.continue();
    });
    try {
      await dialog.getByRole('button', { name: 'Confirm answer', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText('Retry this same confirmation');
      await expect.poll(async () => (await fixture.sql`SELECT closure_kind FROM run_wait WHERE wait_id=${fixture.waitId}`)[0]?.closure_kind).toBe('answer');
      await dialog.getByRole('button', { name: 'Confirm answer', exact: true }).click();
      await expect.poll(() => replayed).toBe(true);
      expect(requests).toEqual([{ runId: fixture.runId, commandId: command.command_id }, { runId: fixture.runId, commandId: command.command_id }]);
    } finally { releaseRefresh(); }
    await page.reload();
    await expect(page.getByLabel('Conversation history')).toContainText('Answer request: applied.');
    expect(await fixture.sql`SELECT event_id FROM audit_events WHERE aggregate_id=${fixture.runId} AND event_type='execution.escalation-answered'`).toHaveLength(1);
    expect(await fixture.sql`SELECT answer_option_id,actor FROM run_wait WHERE wait_id=${fixture.waitId}`)
      .toEqual([{ answer_option_id: 'candidate-a', actor: fixture.auditorId }]);
  });

  test('withdraws an open answer confirmation when another auditor answers the question', async ({ page }) => {
    await open(page);
    await propose(page);
    const dialog = await openReview(page);
    const replacement = await replaceQuestion();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Conversation history')).toContainText('no longer available for confirmation');
    expect(await fixture.sql`SELECT closed_at FROM run_wait WHERE wait_id=${replacement}`).toEqual([{ closed_at: null }]);
    expect(await fixture.sql`SELECT event_id FROM audit_events WHERE aggregate_id=${fixture.runId} AND event_type='execution.escalation-answered'`).toHaveLength(1);
  });

  test('fresh role revocation refuses an already opened answer confirmation', async ({ page }) => {
    await open(page);
    await propose(page);
    const dialog = await openReview(page);
    await fixture.revokeAuditor();
    await dialog.getByRole('button', { name: 'Confirm answer', exact: true }).click();
    await expect.poll(async () => (await fixture.sql`SELECT count(*)::int n FROM audit_events WHERE actor_id=${fixture.auditorId} AND outcome='denied'`)[0]?.n).toBeGreaterThan(0);
    expect(await fixture.sql`SELECT closed_at FROM run_wait WHERE wait_id=${fixture.waitId}`).toEqual([{ closed_at: null }]);
    expect(await fixture.sql`SELECT event_id FROM audit_events WHERE aggregate_id=${fixture.runId} AND event_type='execution.escalation-answered'`).toHaveLength(0);
    await fixture.restoreAuditor();
  });
});
