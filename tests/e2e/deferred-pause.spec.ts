import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { AUTH_STATE } from './accounts';
import { createDeferredPauseBrowserFixture, type DeferredPauseBrowserFixture } from '../fixtures/deferred-pause-browser';
import { acquireRunControlLease, releaseRunControlLease } from '@intellifin/application';
import { createDb, CryptoUuidV7Generator, DrizzleRoleRepository, PostgresRunsUnitOfWork, PostgresRunControlLeaseRepository } from '@intellifin/infrastructure';
import { acquireControl } from './run-control';

let fixture: DeferredPauseBrowserFixture | undefined;

function current(): DeferredPauseBrowserFixture {
  if (!fixture) throw new Error('The deferred-pause fixture has not been created.');
  return fixture;
}

async function safetyState(): Promise<unknown> {
  const { sql, runId } = current();
  return {
    run: await sql`SELECT state,revision,pause_requested_at,pause_requested_by FROM audit_run WHERE run_id=${runId}`,
    wait: await sql`SELECT wait_id,kind,closed_at,closure_kind,answer_option_id FROM run_wait WHERE run_id=${runId} ORDER BY wait_id`,
    work: await sql`SELECT work_item_id,state,subject_key,registration_id FROM run_work_item WHERE run_id=${runId} ORDER BY ordinal`,
    checkpoint: await sql`SELECT status,work_item_id,wait_id FROM run_agent_work WHERE run_id=${runId}`,
    evidence: await sql`SELECT evidence_id,digest,state,size FROM run_evidence WHERE run_id=${runId} ORDER BY evidence_id`,
  };
}

async function markerCount(): Promise<number> {
  const { sql, runId } = current();
  const [row] = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM run_deferred_pause WHERE run_id=${runId}`;
  return row!.count;
}

async function readProposal(): Promise<{
  command_id: string;
  deferred_anchor: { workItemId: string; subjectKey: string | null; registrationId: string; runRevision: number; planDigest: string };
  deferred_control_epoch: number;
  state: string;
} | undefined> {
  const { sql, runId } = current();
  const rows = await sql<{
    command_id: string;
    deferred_anchor: { workItemId: string; subjectKey: string | null; registrationId: string; runRevision: number; planDigest: string };
    deferred_control_epoch: number;
    state: string;
  }[]>`SELECT c.command_id,c.deferred_anchor,c.deferred_control_epoch,t.state
    FROM run_interaction_command c
    JOIN LATERAL (SELECT state FROM run_interaction_transition
      WHERE command_id=c.command_id ORDER BY sequence DESC LIMIT 1) t ON true
    WHERE c.run_id=${runId} AND c.kind='pause-after-inspection' ORDER BY c.created_at DESC LIMIT 1`;
  return rows[0];
}

async function openWorkspace(page: Page): Promise<void> {
  await page.goto(`/runs/${current().runId}/workspace`);
  await expect(page.getByRole('heading', { name: 'Auditor Workspace · Configuration baseline', exact: true })).toBeVisible();
  await expect(page.locator('.run-conversation__composer-form')).toContainText('Current inspection: Page inspection · ProdConsole.');
  await expect(page.getByRole('region', { name: 'Run controller', exact: true })).toBeVisible();
}

async function acquire(page: Page): Promise<void> {
  const controller = page.getByRole('region', { name: 'Run controller', exact: true });
  await acquireControl(controller);
}

async function propose(page: Page): Promise<NonNullable<Awaited<ReturnType<typeof readProposal>>>> {
  const { sql, runId, workItemId, targetRegistrationId, auditorId } = current();
  const [run] = await sql<{ revision: number }[]>`SELECT revision FROM audit_run WHERE run_id=${runId}`;
  const [lease] = await sql<{ epoch: number; holder_id: string }[]>`SELECT epoch,holder_id FROM run_control_lease WHERE run_id=${runId}`;
  expect(lease?.holder_id).toBe(auditorId);
  await page.getByLabel('Message the Run', { exact: true }).fill('pause after this inspection');
  await expect(page.locator('.run-conversation__composer-form')).toContainText('Inspection at draft start: Page inspection · ProdConsole.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.run-conversation__composer-status')).toHaveText('Message accepted.');
  await expect.poll(async () => (await readProposal())?.state).toBe('interpreted');
  const proposal = (await readProposal())!;
  expect(proposal.deferred_anchor).toEqual({
    workItemId, subjectKey: null, registrationId: targetRegistrationId,
    runRevision: run!.revision, planDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(proposal.deferred_control_epoch).toBe(lease!.epoch);
  expect(await markerCount()).toBe(0);
  await expect(page.getByLabel('Conversation history')).toContainText('Pause request: awaiting your confirmation.');
  return proposal;
}

async function openConfirmation(page: Page): Promise<ReturnType<Page['getByRole']>> {
  await page.getByRole('button', { name: 'Review pause after inspection', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Pause after this inspection?', exact: true });
  await expect(dialog).toContainText('the page inspection on ProdConsole');
  await expect(dialog).toContainText('An open question remains open');
  await expect(dialog.getByRole('button', { name: 'Go back', exact: true })).toBeFocused();
  expect(await markerCount()).toBe(0);
  return dialog;
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test.describe('deferred inspection pause through the authenticated workspace', () => {
  test.use({ storageState: AUTH_STATE.auditor, viewport: { width: 1440, height: 900 } });
  test.beforeEach(async () => {
    test.setTimeout(120_000);
    fixture = await createDeferredPauseBrowserFixture();
  });
  test.afterEach(async () => {
    const owned = fixture;
    fixture = undefined;
    await owned?.cleanup();
  });

  test('requires confirmation, retains the open question, and reloads the queued receipt', async ({ page }, testInfo) => {
    const { sql, runId, waitId, workItemId, targetRegistrationId, auditorId } = current();
    const before = await safetyState();
    await openWorkspace(page);
    await acquire(page);
    const proposal = await propose(page);
    expect(await safetyState()).toEqual(before);
    const dialog = await openConfirmation(page);
    await capture(page, testInfo, 'deferred-pause-confirmation');
    // Opening or dismissing the proposal cannot queue a safety latch.
    await dialog.getByRole('button', { name: 'Go back', exact: true }).click();
    expect(await markerCount()).toBe(0);
    expect(await safetyState()).toEqual(before);
    const reviewed = await openConfirmation(page);
    await reviewed.getByRole('button', { name: 'Pause after this inspection', exact: true }).click();
    await expect(reviewed).toBeHidden();
    await expect.poll(markerCount).toBe(1);
    await expect.poll(async () => (await readProposal())?.state).toBe('queued');
    const markers = await sql`SELECT command_id,work_item_id,subject_key,registration_id,
      requested_by,expected_control_epoch,plan_digest,state FROM run_deferred_pause WHERE run_id=${runId}`;
    expect([...markers]).toEqual([{
      command_id: proposal.command_id, work_item_id: workItemId, subject_key: null,
      registration_id: targetRegistrationId, requested_by: auditorId,
      expected_control_epoch: proposal.deferred_control_epoch,
      plan_digest: proposal.deferred_anchor.planDigest, state: 'PENDING',
    }]);
    expect(await safetyState()).toEqual(before);
    const waits = await sql`SELECT wait_id,kind FROM run_wait WHERE run_id=${runId} AND closed_at IS NULL`;
    expect([...waits]).toEqual([{ wait_id: waitId, kind: 'choose-candidate' }]);
    await page.reload();
    await expect(page.getByLabel('Conversation history')).toContainText('Pause request: waiting for the named inspection to settle.');
    await expect(page.getByRole('button', { name: 'Review pause after inspection', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Open Escalation', exact: true })).toBeVisible();
    expect(await markerCount()).toBe(1);
    expect(await safetyState()).toEqual(before);
    await capture(page, testInfo, 'deferred-pause-persisted-receipt');
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test('refuses the original proposal after its owner releases and reacquires control', async ({ page, context }, testInfo) => {
    const { sql, runId, auditorId } = current();
    const before = await safetyState();
    await openWorkspace(page);
    await acquire(page);
    const proposal = await propose(page);
    const dialog = await openConfirmation(page);
    // Hold an already-submitted confirmation. Fresh ownership now closes unsubmitted
    // dialogs, so only a real in-flight stale request should reach the server fence.
    let releaseConfirmation!: () => void;
    let captureConfirmation!: () => void;
    const released = new Promise<void>(resolve => { releaseConfirmation = resolve; });
    const captured = new Promise<void>(resolve => { captureConfirmation = resolve; });
    await page.route(`**/runs/${runId}/workspace`, async route => {
      const request = route.request();
      if (request.method() === 'POST' && request.headers()['next-action']) {
        const args: unknown = JSON.parse(request.postData() ?? 'null');
        const fields = Array.isArray(args) ? args[0] as Record<string, unknown> | undefined : undefined;
        if (fields?.commandId === proposal.command_id) { captureConfirmation(); await released; }
      }
      await route.continue();
    });
    await dialog.getByRole('button', { name: 'Pause after this inspection', exact: true }).click();
    await captured;
    const controllerPage = await context.newPage();
    try {
      await openWorkspace(controllerPage);
      const controller = controllerPage.getByRole('region', { name: 'Run controller', exact: true });
      await expect(controller).toContainText('You control this Run.');
      await controller.getByRole('button', { name: 'Release control', exact: true }).click();
      await expect(controller).toContainText('No auditor currently holds control.');
      await acquire(controllerPage);
      const [lease] = await sql<{ epoch: number; holder_id: string }[]>`SELECT epoch,holder_id FROM run_control_lease WHERE run_id=${runId}`;
      expect(lease?.holder_id).toBe(auditorId);
      expect(lease!.epoch).toBeGreaterThan(proposal.deferred_control_epoch);
      await page.bringToFront();
      releaseConfirmation();
      await expect.poll(async () => (await readProposal())?.state).toBe('refused');
      expect(await markerCount()).toBe(0);
      expect(await safetyState()).toEqual(before);
      const retained = (await readProposal())!;
      expect(retained.deferred_anchor).toEqual(proposal.deferred_anchor);
      expect(retained.deferred_control_epoch).toBe(proposal.deferred_control_epoch);
      await capture(page, testInfo, 'deferred-pause-stale-confirmation-refused');
      await page.reload();
      await expect(page.getByLabel('Conversation history')).toContainText('Pause request: refused.');
      await expect(page.getByRole('button', { name: 'Review pause after inspection', exact: true })).toHaveCount(0);
      expect(await markerCount()).toBe(0);
      expect(await safetyState()).toEqual(before);
    } finally { releaseConfirmation(); await controllerPage.close(); }
  });

  for (const invalidation of ['failed ownership read', 'same actor new epoch'] as const) {
    test(`withdraws deferred confirmation after ${invalidation} without hiding Stop`, async ({ page }) => {
      const { sql, runId, auditorId } = current();
      const before = await safetyState();
      await openWorkspace(page); await acquire(page);
      const proposal = await propose(page);
      const dialog = await openConfirmation(page);
      let confirmations = 0;
      let reads = 0;
      await page.route(`**/api/runs/${runId}/control`, async route => {
        reads += 1;
        if (invalidation === 'failed ownership read') { await route.abort('failed'); return; }
        await route.continue();
      });
      await page.route(`**/runs/${runId}/workspace`, async route => {
        const request = route.request();
        if (request.method() === 'POST' && request.headers()['next-action']) {
          const args: unknown = JSON.parse(request.postData() ?? 'null');
          const fields = Array.isArray(args) ? args[0] as Record<string, unknown> | string | undefined : undefined;
          if (typeof fields === 'object' && fields?.commandId) confirmations += 1;
        }
        await route.continue();
      });
      const db = createDb(sql);
      const ids = new CryptoUuidV7Generator();
      const work = new PostgresRunsUnitOfWork(db);
      if (invalidation === 'same actor new epoch') {
        const dependencies = { roles: new DrizzleRoleRepository(db), unitOfWork: work,
          repository: new PostgresRunControlLeaseRepository(db), ids, allowEnrollment: true };
        const session = { userId: auditorId, sessionId: 'deferred-confirmation-epoch-fixture' };
        expect(await releaseRunControlLease(dependencies, { session,
          request: { runId, expectedEpoch: proposal.deferred_control_epoch } })).toMatchObject({ ok: true });
        expect(await acquireRunControlLease(dependencies, { session,
          request: { runId, expectedEpoch: proposal.deferred_control_epoch + 1 } })).toMatchObject({ ok: true });
      }
      const event = await work.execute(context => context.auditEvents.append({
        actor: { type: 'system', id: 'deferred-confirmation-fixture' }, source: 'worker', outcome: 'success',
        eventType: 'lifecycle.run-progressed', aggregateId: runId, correlationId: ids.next(),
        sessionId: 'deferred-confirmation', payload: {},
      }));
      await sql`SELECT pg_notify('run_timeline', ${JSON.stringify({ runId, sequence: event.sequence })})`;
      await expect.poll(() => reads).toBeGreaterThan(0);
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Review pause after inspection', exact: true })).toHaveCount(0);
      const controller = page.getByRole('region', { name: 'Run controller', exact: true });
      if (invalidation === 'same actor new epoch') {
        await expect(controller).toContainText('You control this Run.');
        expect(await sql`SELECT epoch,holder_id FROM run_control_lease WHERE run_id=${runId}`)
          .toEqual([{ epoch: proposal.deferred_control_epoch + 2, holder_id: auditorId }]);
      } else await expect(controller).toContainText('Run control is unavailable.');
      expect(confirmations).toBe(0);
      expect(await markerCount()).toBe(0);
      expect(await safetyState()).toEqual(before);
      expect(await readProposal()).toEqual(proposal);
      await page.getByLabel('Message the Run', { exact: true }).fill('Stop');
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await page.getByRole('button', { name: 'Review Stop', exact: true }).click();
      const stop = page.getByRole('dialog', { name: 'Stop this Run?', exact: true });
      await expect(stop.getByRole('button', { name: 'Stop Run', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
      await stop.getByRole('button', { name: 'Go back', exact: true }).click();
      expect(confirmations).toBe(0);
      expect(await safetyState()).toEqual(before);
    });
  }
});
