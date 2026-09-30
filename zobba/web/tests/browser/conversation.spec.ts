import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { restoreAndClose } from './cleanup';

// Browser plugin not available. The repository-owned Playwright harness runs
// actual HTTPS OIDC, restricted PostgreSQL, API and bounded worker processes.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const scope = 'organisation_id=org-a&client_id=client-a';
const restore = "UPDATE public.identities SET active=true WHERE id='actor-a'; UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE actor_id='actor-a'; UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id='actor-a';";
const resetTasks = 'TRUNCATE public.tasks, public.task_counters CASCADE;';
test.beforeAll(async () => { runtime = await startAuthRuntime(); });
test.beforeEach(async () => { await runtime.stopWorker(); runtime.sql(restore + resetTasks); });
test.afterEach(async ({ page }) => {
  await runtime.stopWorker();
  await page.getByLabel('Password', { exact: true }).fill('', { timeout: 250 }).catch(() => {});
});
test.afterAll(async () => { if (runtime) await restoreAndClose(runtime, restore); });

async function signIn(page: Page, account = 'auditor-a') {
  await page.goto(runtime.url);
  await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  await page.getByLabel('Account', { exact: true }).selectOption(account);
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
}
async function create(page: Page, objective: string) {
  await page.getByLabel('Send to', { exact: true }).selectOption('create');
  await page.getByLabel('Task objective', { exact: true }).fill(objective);
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect(page.locator('.task-card h3').filter({ hasText: objective })).toBeVisible();
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/tasks?${scope}`);
  expect(response.status()).toBe(200);
  const task = (await response.json()).tasks.find((task: { objective: string }) => task.objective === objective);
  expect(task).toBeDefined();
  return task;
}
async function post(page: Page, command: Record<string, unknown>) {
  const session = await (await page.request.get(`${runtime.url}/api/auth/session`)).json();
  const lane = ['guide', 'pause', 'stop'].includes(command.kind as string) ? 'task-controls' : 'task-commands';
  return page.request.post(`${runtime.url}/api/engagements/engagement-a/${lane}?${scope}`, {
    headers: { Origin: runtime.url, 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id }, data: command,
  });
}
async function snapshot(page: Page) {
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/conversation?${scope}`);
  expect(response.status()).toBe(200); return response.json();
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const path = info.outputPath(name); await page.screenshot({ path, fullPage: false });
  await info.attach(name, { path, contentType: 'image/png' });
}

test('two attributed Tasks, Guide A while inspecting B, reload and real API/worker interruption retain guidance', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  const a = await create(page, 'Review leaver access');
  await create(page, 'Investigate shared accounts');
  await page.getByLabel('Send to', { exact: true }).selectOption(`${a.id}:${a.cycle_id}`);
  await page.getByLabel('Guidance', { exact: true }).fill('Use the contractual termination date.');
  await page.getByRole('button', { name: 'Open Investigate shared accounts', exact: true }).click();
  await expect(page.locator('.inspection-header h2')).toHaveText('Investigate shared accounts');
  await expect(page.getByLabel('Send to', { exact: true })).toHaveValue(`${a.id}:${a.cycle_id}`);
  await page.getByLabel('Guidance', { exact: true }).press('Enter');
  await expect(page.locator('.conversation-message').filter({ hasText: 'Use the contractual termination date.' })).toContainText('Not yet applied');
  const before = await snapshot(page);
  expect(before.messages).toHaveLength(3);
  expect(before.messages.map((row: { author_id: string }) => row.author_id)).toEqual(['actor-a', 'actor-a', 'actor-a']);
  expect(before.messages[2]).toMatchObject({ kind: 'guide', task_id: a.id, cycle_id: a.cycle_id, target_task_id: a.id, applied_cursor: null });
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await runtime.restartApi();
  await runtime.startWorker(300);
  await expect.poll(async () => (await snapshot(page)).messages[2].applied_cursor).not.toBeNull();
  await runtime.stopWorker();
  await runtime.startWorker(300);
  await page.reload();
  await expect(page.locator('.task-card')).toHaveCount(2);
  await expect(page.locator('.conversation-message').filter({ hasText: 'Use the contractual termination date.' })).toContainText('Applied to the plain working brief');
  await page.getByRole('button', { name: 'Open Review leaver access', exact: true }).click();
  await expect(page.locator('.brief-section').filter({ hasText: 'Original objective' })).toContainText('Review leaver access');
  await expect(page.locator('.brief-section').filter({ hasText: 'Working brief' })).toContainText('Use the contractual termination date.');
  await expect(page.getByText('No work products yet.', { exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(await page.getByRole('button', { name: 'Send', exact: false }).evaluate(element => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  expect(await page.getByRole('button', { name: /^Pause Review leaver access/ }).evaluate(element => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await capture(page, info, 'conversation-and-inspection-1280.png');
});

test('lost committed acknowledgement reloads original outbox meaning, recovers one receipt and refuses changed meaning', async ({ page }, info) => {
  await signIn(page);
  let original: Record<string, unknown> | null = null;
  let receipt: Record<string, unknown> | null = null;
  await page.route('**/api/engagements/*/task-commands?*', async route => {
    original = route.request().postDataJSON();
    const response = await route.fetch(); expect(response.status()).toBe(202);
    receipt = await response.json(); await route.abort('connectionreset');
  });
  await page.route('**/api/engagements/*/conversation**', route => route.abort('connectionreset'));
  await page.getByLabel('Task objective', { exact: true }).fill('Recover this exact accepted objective');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect.poll(() => receipt).not.toBeNull();
  await expect(page.getByText('Delivery unconfirmed', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Delivery unconfirmed', { exact: false })).toBeVisible();
  const saved = await page.evaluate(async () => { const { OutboxStore } = await import(/* @vite-ignore */ '../../src/conversation-outbox.ts'); return new OutboxStore('actor-a', { organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' }).read(); });
  expect(saved).toHaveLength(1); expect(saved[0]!.command).toEqual(original);
  await capture(page, info, 'lost-ack-original-request-retained.png');
  await page.unroute('**/api/engagements/*/task-commands?*');
  let retried: unknown;
  await page.route('**/api/engagements/*/task-commands?*', async route => { retried = route.request().postDataJSON(); await route.continue(); });
  await page.getByRole('button', { name: 'Check original request' }).click();
  await expect.poll(() => retried).toEqual(original);
  await page.unroute('**/api/engagements/*/conversation**');
  await page.getByRole('button', { name: 'Latest messages' }).click();
  await expect(page.locator('.task-card')).toHaveCount(1);
  const exact = await post(page, original!); expect(exact.status()).toBe(202); expect(await exact.json()).toEqual(receipt);
  const changed = await post(page, { ...original!, content: 'Changed material meaning' }); expect(changed.status()).toBe(409);
  const current = await snapshot(page); expect(current.messages).toHaveLength(1); expect(current.tasks).toHaveLength(1);
  await capture(page, info, 'lost-ack-one-task-recovered.png');
});

test('actual worker Pause and Stop stay pending until observed; Resume retains cycle and Continue creates another', async ({ page }, info) => {
  await signIn(page);
  const task = await create(page, 'Control this exact Task');
  await runtime.startWorker();
  await expect.poll(async () => (await snapshot(page)).tasks[0].state).toBe('running');
  await page.getByRole('button', { name: 'Open Control this exact Task', exact: true }).click();
  await expect(page.locator('.task-state')).toContainText('Foundation activity');
  const pausedWorker = await runtime.freezeWorker();
  try {
    await info.attach('pause-worker-freeze.json', { body: JSON.stringify(pausedWorker), contentType: 'application/json' });
    await page.getByRole('button', { name: /^Pause Control this exact Task/ }).click();
    await expect(page.locator('.task-state .status-label')).toHaveText('Pausing');
    expect((await snapshot(page)).tasks[0]).toMatchObject({ state: 'paused', cessation: 'pending' });
    await capture(page, info, 'task-pausing-awaiting-worker.png');
  } finally { runtime.thawWorker(); }
  await expect(page.locator('.task-state .status-label')).toHaveText('Paused');
  await page.getByRole('button', { name: /^Resume Control this exact Task/ }).click();
  await expect.poll(async () => (await snapshot(page)).tasks[0].state).toBe('running');
  expect((await snapshot(page)).tasks[0].cycle_id).toBe(task.cycle_id);
  const stoppedWorker = await runtime.freezeWorker();
  try {
    await info.attach('stop-worker-freeze.json', { body: JSON.stringify(stoppedWorker), contentType: 'application/json' });
    const stoppedReceipt = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/task-controls?') && response.request().postDataJSON().kind === 'stop');
    await page.getByRole('button', { name: /^Stop Control this exact Task/ }).click();
    expect((await stoppedReceipt).status()).toBe(202);
    expect((await snapshot(page)).tasks[0]).toMatchObject({ state: 'stopped', cessation: 'pending' });
    await expect(page.locator('.task-state .status-label')).toHaveText('Stopping');
    await capture(page, info, 'task-stopping-awaiting-worker.png');
  } finally { runtime.thawWorker(); }
  await expect(page.locator('.task-state .status-label')).toHaveText('Stopped');
  await capture(page, info, 'task-stopped-observed.png');
  await page.getByRole('button', { name: /^Continue Control this exact Task/ }).click();
  await expect.poll(async () => (await snapshot(page)).tasks[0].cycle_id).not.toBe(task.cycle_id);
  const stale = await post(page, { key: 'stale-cycle-control', kind: 'pause', task_id: task.id, cycle_id: task.cycle_id, content: null });
  expect(stale.status()).toBe(409);
});

test('consumed crash remains unresolved after worker restart without replay or false stopped success', async ({ page }) => {
  await signIn(page);
  const task = await create(page, 'Retain consumed activity uncertainty');
  await runtime.startWorker();
  await expect.poll(async () => (await snapshot(page)).tasks[0].state).toBe('running');
  await runtime.crashWorker();
  await runtime.startWorker();
  await page.getByRole('button', { name: 'Open Retain consumed activity uncertainty', exact: true }).click();
  await expect(page.locator('.task-state .status-label')).toHaveText('Activity unresolved', { timeout: 15_000 });
  await page.getByRole('button', { name: /^Stop Retain consumed activity uncertainty/ }).click();
  await expect.poll(async () => (await snapshot(page)).tasks[0].state).toBe('stopped');
  await expect(page.locator('.task-state .status-label')).toHaveText('Activity unresolved');
  await expect(page.getByRole('button', { name: /^Continue Retain/ })).toHaveCount(0);
  const state = await snapshot(page); expect(state.tasks[0].cycle_id).toBe(task.cycle_id);
  expect(state.tasks[0].cessation).toBe('reconciliation_required');
});

test('keyboard narrow views, pin and follow preserve explicit target, draft and focus across revalidation', async ({ page }, info) => {
  await signIn(page);
  const a = await create(page, 'Keyboard Task A');
  await create(page, 'Keyboard Task B');
  await page.getByLabel('Send to', { exact: true }).selectOption(`${a.id}:${a.cycle_id}`);
  const draft = page.getByLabel('Guidance', { exact: true });
  await draft.fill('Retain this draft'); await draft.press('Shift+Enter'); await draft.press('x');
  await expect(draft).toHaveValue('Retain this draft\nx');
  await page.getByRole('button', { name: 'Open Keyboard Task B', exact: true }).click();
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await draft.focus();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(draft).toBeFocused(); await expect(draft).toHaveValue('Retain this draft\nx');
  await expect(page.getByRole('button', { name: 'Pinned', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const incoming = await post(page, { key: 'incoming-guide-a', kind: 'guide', task_id: a.id, cycle_id: a.cycle_id, content: 'New attributed guidance to A' });
  expect(incoming.status()).toBe(202);
  await expect(page.locator('.conversation-message').filter({ hasText: 'New attributed guidance to A' })).toBeVisible();
  await expect(page.locator('.inspection-header h2')).toHaveText('Keyboard Task B'); await expect(draft).toBeFocused();
  await page.getByRole('button', { name: 'Follow Zobba', exact: true }).click();
  await expect(page.locator('.inspection-header h2')).toHaveText('Keyboard Task A');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await expect(draft).toHaveValue('Retain this draft\nx');
    await expect(page.getByLabel('Send to', { exact: true })).toHaveValue(`${a.id}:${a.cycle_id}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.getByRole('button', { name: 'Send', exact: false }).evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.getByRole('button', { name: 'Send', exact: false }).evaluate(element => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    await capture(page, info, `conversation-${width}.png`);
    await page.getByRole('button', { name: /^Workspace/ }).click();
    await expect(page.locator('.inspection-header h2')).toHaveText('Keyboard Task A');
    await expect(page.getByRole('button', { name: /^Pause Keyboard Task A/ })).toBeVisible();
  }
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Open Keyboard Task B', exact: true })).toBeFocused();
  await expect(page.getByLabel('Send to', { exact: true })).toHaveValue(`${a.id}:${a.cycle_id}`);
});

test('storage failure cannot transmit and a later identical next draft survives an in-flight acknowledgement', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    (window as Window & { __abortedSuccessfulWrite?: boolean }).__abortedSuccessfulWrite = false;
    IDBObjectStore.prototype.add = function (...args) {
      const transaction = this.transaction, request = add.apply(this, args);
      if (this.name === 'requests') request.addEventListener('success', () => {
        IDBObjectStore.prototype.add = add;
        (window as Window & { __abortedSuccessfulWrite?: boolean }).__abortedSuccessfulWrite = true;
        transaction.abort();
      }, { once: true });
      return request;
    };
  });
  let posts = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/task-')) posts++; });
  await page.getByLabel('Task objective', { exact: true }).fill('Storage must precede sending');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __abortedSuccessfulWrite?: boolean }).__abortedSuccessfulWrite)).toBe(true);
  await expect(page.getByRole('alert')).toContainText('Not sent'); expect(posts).toBe(0);
  expect(await page.evaluate(async () => {
    const { OutboxStore } = await import(/* @vite-ignore */ '../../src/conversation-outbox.ts');
    const store = new OutboxStore('actor-a', { organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' });
    try { return await store.read(); } finally { store.close(); }
  })).toHaveLength(0);
  expect((await snapshot(page)).messages).toHaveLength(0);
  await expect(page.getByLabel('Task objective', { exact: true })).toHaveValue('Storage must precede sending');
  await page.reload(); await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  const a = await create(page, 'Existing target for next draft');
  let release: (() => void) | undefined;
  let admitted = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/engagements/*/task-commands?*', async route => {
    const response = await route.fetch(); admitted = true; await gate; await route.fulfill({ response });
  });
  await page.getByLabel('Task objective', { exact: true }).fill('Same text with new meaning');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect.poll(() => admitted).toBe(true);
  await page.getByLabel('Send to', { exact: true }).selectOption(`${a.id}:${a.cycle_id}`);
  release!();
  await expect(page.getByLabel('Guidance', { exact: true })).toHaveValue('Same text with new meaning');
  await expect(page.locator('.task-card')).toHaveCount(2);
});

test('held ordinary projection does not block named reserved control and failure withdraws inspection', async ({ page }) => {
  await signIn(page); const task = await create(page, 'Independent safety control');
  await page.getByRole('button', { name: 'Open Independent safety control', exact: true }).click();
  let release: (() => void) | undefined; let entered = false; let completed: (() => void) | undefined;
  const settled = new Promise<void>(resolve => { completed = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/engagements/*/conversation/events?*', async route => { entered = true; await gate; try { await route.continue(); } finally { completed!(); } });
  try {
    await expect.poll(() => entered).toBe(true);
    await page.getByRole('button', { name: /^Pause Independent safety control/ }).click();
    await expect.poll(async () => (await snapshot(page)).tasks[0].state).toBe('paused');
    expect((await snapshot(page)).tasks[0].cycle_id).toBe(task.cycle_id);
  } finally { release!(); await settled; }
  await page.unroute('**/api/engagements/*/conversation/events?*');
  await page.route('**/api/engagements/*/conversation**', route => route.abort('connectionreset'));
  await expect(page.getByText('Reconnecting · current updates unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('.task-detail')).toHaveCount(0);
  await expect(page.locator('.conversation-message')).toHaveCount(0);
  await page.unroute('**/api/engagements/*/conversation**');
  await expect(page.locator('.task-detail')).toBeVisible();
});

test('bounded burst/history and second actor/foreign scope preserve exact attributed audience', async ({ page, browser }) => {
  await signIn(page); const task = await create(page, 'Bounded shared conversation');
  for (let index = 0; index < 105; index++) {
    const response = await post(page, { key: `page-guide-${index}`, kind: 'guide', task_id: task.id, cycle_id: task.cycle_id, content: `Retained guide ${index}` });
    expect(response.status()).toBe(202);
  }
  await page.getByRole('button', { name: 'Latest messages', exact: true }).click();
  await expect(page.locator('.conversation-message')).toHaveCount(100);
  await page.getByRole('button', { name: 'Earlier messages', exact: true }).click();
  await expect(page.locator('.conversation-message')).toHaveCount(6);
  await expect(page.locator('.conversation-message').first()).toContainText('Bounded shared conversation');
  const context = await browser.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } });
  try {
    const manager = await context.newPage(); await signIn(manager, 'manager-a');
    expect((await snapshot(manager)).messages).toHaveLength(100);
    const guide = await post(manager, { key: 'manager-guidance', kind: 'guide', task_id: task.id, cycle_id: task.cycle_id, content: 'Manager direction keeps original ownership' }); expect(guide.status()).toBe(202);
    const read = await snapshot(manager); expect(read.tasks[0].accountable_actor).toBe('actor-a'); expect(read.messages.at(-1).author_id).toBe('actor-manager');
    const foreign = await manager.request.get(`${runtime.url}/api/engagements/engagement-b/conversation?organisation_id=org-b&client_id=client-b`);
    expect(foreign.status()).toBe(403); expect(await foreign.text()).not.toContain('Beacon');
  } finally { await context.close(); }
  runtime.sql("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a';");
  await page.getByRole('button', { name: 'Refresh access' }).click();
  await expect(page.getByRole('heading', { name: 'No assigned engagements' })).toBeVisible();
  await expect(page.locator('.conversation-message')).toHaveCount(0);
});
