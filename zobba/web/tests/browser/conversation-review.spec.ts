import { expect, test } from '@playwright/test';
import type { Page, Request, Route } from '@playwright/test';
import type { Session } from '../../src/auth';
import type { Task, TaskCommand } from '../../src/conversation';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration, restoreAndClose } from './cleanup';

// Browser plugin not available. These regressions use the owned Playwright
// harness, actual HTTPS OIDC, restricted PostgreSQL and real HTTP admission.
// Fault routes hold/drop actual responses; none fabricates successful work.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const scope = 'organisation_id=org-a&client_id=client-a';
const restore = fixtureRestoration(['actor-a', 'actor-manager', 'actor-b'], `
UPDATE public.identities SET active=true WHERE id IN ('actor-a','actor-manager','actor-b');
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE actor_id='actor-a' AND organisation_id='org-a';
UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id='actor-a' AND organisation_id='org-a';
DELETE FROM public.engagement_assignments WHERE actor_id='actor-a' AND organisation_id='org-b';
DELETE FROM public.organisation_memberships WHERE actor_id='actor-a' AND organisation_id='org-b';`);
test.beforeAll(async () => { runtime = await startAuthRuntime(); });
test.beforeEach(async () => { await runtime.stopWorker(); await runtime.sqlAsync(restore('TRUNCATE public.tasks, public.task_counters CASCADE;')); });
test.afterEach(async ({ context }) => {
  await runtime.stopWorker(); await runtime.sqlAsync(restore());
  for (const page of context.pages()) await page.getByLabel('Password', { exact: true }).fill('', { timeout: 250 }).catch(() => {});
});
test.afterAll(async () => { if (runtime) await restoreAndClose(runtime, restore()); });

function gate() {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  return { held, release };
}
async function signIn(page: Page, account = 'auditor-a', engagement = 'FY2026 audit', replacing = false) {
  if (replacing) {
    // Only the provider cookie is cleared: the existing application cookie must
    // be replaced by the real callback, with old local recovery bytes retained.
    await page.context().clearCookies({ domain: '127.0.0.1' });
    await page.goto(`${runtime.url}/api/auth/login`);
  } else {
    await page.goto(runtime.url);
    await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  }
  await page.getByLabel('Account', { exact: true }).selectOption(account);
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(engagement) }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
}
async function session(page: Page): Promise<Session> {
  const response = await page.request.get(`${runtime.url}/api/auth/session`);
  expect(response.status()).toBe(200); return response.json();
}
async function post(page: Page, command: TaskCommand, current?: Session) {
  const verified = current ?? await session(page);
  const lane = ['guide', 'pause', 'stop'].includes(command.kind) ? 'task-controls' : 'task-commands';
  return page.request.post(`${runtime.url}/api/engagements/engagement-a/${lane}?${scope}`, {
    headers: { Origin: runtime.url, 'X-CSRF-Token': verified.csrf_token, 'X-Expected-Actor': verified.identity.id }, data: command,
  });
}
async function snapshot(page: Page, engagement = 'engagement-a', selected = scope) {
  const response = await page.request.get(`${runtime.url}/api/engagements/${engagement}/conversation?${selected}`);
  expect(response.status()).toBe(200); return response.json();
}
async function create(page: Page, objective: string): Promise<Task> {
  await page.getByLabel('Send to', { exact: true }).selectOption('create');
  await page.getByLabel('Task objective', { exact: true }).fill(objective);
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect(page.locator('.task-card h3').filter({ hasText: objective })).toBeVisible();
  const value = (await snapshot(page)).tasks.find((task: Task) => task.objective === objective);
  expect(value).toBeDefined(); return value;
}
test('same-scope checks hide every protected surface and restore mounted Task controls, disclosure and focus', async ({ page }, info) => {
  await signIn(page);
  await page.getByRole('button', { name: 'All engagements' }).click();
  const picker = page.getByRole('button', { name: /FY2026 audit/ });
  await picker.focus();
  const authority = gate(); let authorityHeld = false, authorityDelivered = false;
  await page.route('**/api/auth/session', async route => {
    const response = await route.fetch(); authorityHeld = true; await authority.held; await route.fulfill({ response }); authorityDelivered = true;
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => authorityHeld).toBe(true);
    await expect(page.getByText('Checking current access…', { exact: true })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/auditor-a|Northstar|Alder Manufacturing|FY2026 audit|Auditor/);
    authority.release(); await expect.poll(() => authorityDelivered).toBe(true);
    await page.unrouteAll({ behavior: 'wait' });
    await expect(picker).toBeFocused(); await picker.click();
    await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  } finally { authority.release(); await page.unrouteAll({ behavior: 'wait' }); }
  const task = await create(page, 'Retain focused control and disclosure');
  await page.getByRole('button', { name: `Open ${task.objective}`, exact: true }).click();
  const methodology = page.locator('.task-methodology');
  const recordedBasis = methodology.getByText('Neutral starter', { exact: true });
  await expect(recordedBasis).toBeVisible();
  await methodology.evaluate(element => { element.setAttribute('data-original-methodology', 'retained'); });
  const disclosure = page.locator('.task-detail > details.message-binding');
  await disclosure.getByText('Task and current cycle', { exact: true }).click();
  const pause = page.getByRole('button', { name: new RegExp(`^Pause ${task.objective}`) });
  await pause.evaluate(element => { element.setAttribute('data-original-control', 'retained'); });
  await pause.focus();
  const access = gate(), projection = gate(); let accessHeld = false, projectionHeld = false;
  const snapshotPath = '/api/engagements/engagement-a/conversation';
  const faultReads: { id: number; path: string; observed_ms: number; aborted_ms?: number; failed_ms?: number; error?: string }[] = [];
  const faultRequests = new Map<Request, typeof faultReads[number]>();
  const faultStarted = Date.now();
  let faultInstalled = false;
  const faultTraffic: { path: string; origin_matches: boolean; stage: string; elapsed_ms: number }[] = [];
  const recordRequest = (request: Request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) faultTraffic.push({ path: url.pathname, origin_matches: url.origin === runtime.url, stage: 'request', elapsed_ms: Date.now() - faultStarted });
  };
  const recordFailure = (request: Request) => {
    const entry = faultRequests.get(request);
    if (entry) { entry.failed_ms = Date.now() - faultStarted; entry.error = request.failure()?.errorText; }
  };
  await page.route('**/api/auth/session', async route => {
    const response = await route.fetch(); accessHeld = true; await access.held; await route.fulfill({ response });
  });
  await page.route('**/api/engagements/engagement-a/conversation?*', async route => {
    const response = await route.fetch(); projectionHeld = true; await projection.held; await route.fulfill({ response });
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => accessHeld).toBe(true);
    expect(await page.locator('body').innerText()).not.toMatch(/auditor-a|Northstar|Alder Manufacturing|FY2026 audit|Retain focused control|Auditor/);
    access.release(); await expect.poll(() => projectionHeld).toBe(true);
    await expect(page.locator('[data-original-control="retained"]')).toHaveCount(1);
    await expect(disclosure).toHaveAttribute('open', '');
    await expect(page.locator('[data-original-methodology="retained"]')).toHaveCount(1);
    await expect(recordedBasis).toBeHidden();
    await expect(pause).toBeHidden();
    projection.release();
    await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
    await expect(pause).toHaveAttribute('data-original-control', 'retained');
    await expect(pause).toBeFocused(); await expect(disclosure).toHaveAttribute('open', '');
    await expect(methodology).toHaveAttribute('data-original-methodology', 'retained');
    await expect(recordedBasis).toBeVisible();
    // Release and settle every legitimate session/panel read before replacing
    // the interception phase; unroute alone leaves active handlers running.
    await page.unrouteAll({ behavior: 'wait' });
    page.on('request', recordRequest); page.on('requestfailed', recordFailure);
    const abortScopedConversation = async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      expect(request.method()).toBe('GET');
      expect(url.searchParams.get('organisation_id')).toBe('org-a');
      expect(url.searchParams.get('client_id')).toBe('client-a');
      const entry: typeof faultReads[number] = { id: faultReads.length + 1, path: url.pathname, observed_ms: Date.now() - faultStarted };
      faultReads.push(entry); faultRequests.set(request, entry);
      await route.abort('connectionreset'); entry.aborted_ms = Date.now() - faultStarted;
    };
    // Use explicit scoped snapshot/event matchers, matching the working snapshot
    // hold phase. Require actual abort + requestfailed before withdrawal proof;
    // the earlier predicate-miss cause remains unproven.
    await page.route('**/api/engagements/engagement-a/conversation?*', abortScopedConversation);
    await page.route('**/api/engagements/engagement-a/conversation/events?*', abortScopedConversation);
    faultInstalled = true;
    const latestMessages = page.getByRole('button', { name: 'Latest messages' });
    await latestMessages.evaluate(button => { button.addEventListener('click', () => button.setAttribute('data-observed-fault-click', 'yes'), { once: true }); });
    await latestMessages.click();
    // Verify an actual current snapshot refusal before asserting withdrawal;
    // a click alone does not establish that the fault phase handled a read.
    await expect.poll(() => faultReads.some(read => read.path === snapshotPath && read.aborted_ms !== undefined && read.failed_ms !== undefined)).toBe(true);
    await expect(page.getByRole('region', { name: 'Task details', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-original-control="retained"]')).toHaveCount(0);
    await expect(page.locator('[data-original-methodology="retained"]')).toHaveCount(0);
  } finally {
    try {
      // Capture only request paths/timing and node counts while the fault remains
      // installed, before cleanup could permit a successful recovery read.
      await info.attach('conversation-access-fault.json', { contentType: 'application/json', body: JSON.stringify({
        fault_installed: faultInstalled, reads: faultReads, traffic: faultTraffic,
        click_observed: await page.locator('[data-observed-fault-click="yes"]').count(),
        task_details: await page.locator('.task-detail').count(),
        original_control: await page.locator('[data-original-control="retained"]').count(),
        original_methodology: await page.locator('[data-original-methodology="retained"]').count(),
      }, null, 2) });
    } finally {
      page.off('request', recordRequest); page.off('requestfailed', recordFailure);
      access.release(); projection.release(); await page.unrouteAll({ behavior: 'wait' });
    }
  }
});

test('Follow uses current activity while reading older history without retargeting or stealing focus', async ({ page }) => {
  await signIn(page); const a = await create(page, 'History follow Task A'); const b = await create(page, 'History follow Task B');
  const verified = await session(page);
  for (let index = 0; index < 105; index++) expect((await post(page, { key: `history-follow-${index}`, kind: 'guide', task_id: a.id, cycle_id: a.cycle_id, content: `Historical guidance ${index}` }, verified)).status()).toBe(202);
  const latest = (await snapshot(page)).messages.at(-1);
  expect(latest.key).toBe('history-follow-104');
  await page.getByRole('button', { name: 'Latest messages' }).click();
  await expect(page.locator('.conversation-entry').last()).toHaveAttribute('data-command-id', latest.command_id);
  await expect(page.locator('.message-content').last()).toHaveText('Historical guidance 104');
  await expect(page.locator('.conversation-message')).toHaveCount(100);
  await page.getByLabel('Send to', { exact: true }).selectOption(`${a.id}:${a.cycle_id}`);
  const draft = page.getByLabel('Guidance', { exact: true }); await draft.fill('Independently targeted draft');
  await page.locator('.task-list-open').filter({ hasText: a.objective }).click();
  await page.getByRole('button', { name: 'Follow Zobba', exact: true }).click();
  await page.getByRole('button', { name: 'Earlier messages' }).click();
  await expect(page.locator('.conversation-message')).toHaveCount(7);
  const first = await page.locator('.conversation-entry').first().getAttribute('data-command-id');
  await draft.focus();
  expect((await post(page, { key: 'new-activity-outside-history', kind: 'guide', task_id: b.id, cycle_id: b.cycle_id, content: 'Current activity outside displayed history' }, verified)).status()).toBe(202);
  await expect(page.locator('.inspection-header h2')).toHaveText(b.objective);
  await expect(draft).toBeFocused(); await expect(draft).toHaveValue('Independently targeted draft');
  await expect(page.getByLabel('Send to', { exact: true })).toHaveValue(`${a.id}:${a.cycle_id}`);
  await expect(page.locator('.conversation-entry').first()).toHaveAttribute('data-command-id', first!);
  await expect(page.locator('.conversation-message').filter({ hasText: 'Current activity outside displayed history' })).toHaveCount(0);
});

test('an unresolved exact send scrolls once and never pulls deliberately opened history to the bottom', async ({ page }) => {
  await signIn(page); const task = await create(page, 'History position survives uncertainty');
  const verified = await session(page);
  for (let index = 0; index < 105; index++) expect((await post(page, { key: `scroll-guide-${index}`, kind: 'guide', task_id: task.id, cycle_id: task.cycle_id, content: `Earlier scroll guidance ${index}` }, verified)).status()).toBe(202);
  const latest = (await snapshot(page)).messages.at(-1);
  expect(latest.key).toBe('scroll-guide-104');
  await page.getByRole('button', { name: 'Latest messages' }).click();
  await expect(page.locator('.conversation-entry').last()).toHaveAttribute('data-command-id', latest.command_id);
  await expect(page.locator('.message-content').last()).toHaveText('Earlier scroll guidance 104');
  await expect(page.locator('.conversation-message')).toHaveCount(100);
  const ack = gate(), events = gate();
  await page.route('**/api/engagements/engagement-a/conversation/events?*', async route => { await events.held; await route.continue(); });
  let admitted = false, delivered = false; let submitted: TaskCommand | undefined;
  await page.route('**/api/engagements/*/task-commands?*', async route => {
    submitted = route.request().postDataJSON(); const response = await route.fetch(); expect(response.status()).toBe(202); admitted = true;
    await ack.held; await route.abort('connectionreset'); delivered = true;
  });
  try {
    await page.getByLabel('Task objective', { exact: true }).fill('Exact one-time send scroll');
    await page.getByRole('button', { name: 'Send', exact: false }).click();
    await expect.poll(() => admitted).toBe(true);
    await expect(page.locator('.pending-message')).toContainText('Sending');
    await page.getByRole('button', { name: 'Earlier messages' }).click();
    await expect(page.locator('.conversation-message')).toHaveCount(6);
    const first = await page.locator('.conversation-entry').first().getAttribute('data-command-id');
    await page.locator('.conversation-history').evaluate(element => { element.scrollTop = 0; });
    ack.release(); await expect.poll(() => delivered).toBe(true);
    await expect(page.locator('.pending-message')).toContainText('Delivery unconfirmed');
    await expect.poll(() => page.locator('.conversation-history').evaluate(element => element.scrollTop)).toBe(0);
    events.release();
    expect((await post(page, { key: 'another-scroll-event', kind: 'guide', task_id: task.id, cycle_id: task.cycle_id, content: 'Unrelated receipt must preserve history scroll' }, verified)).status()).toBe(202);
    await expect.poll(async () => (await snapshot(page)).messages.some((message: { key: string }) => message.key === submitted!.key)).toBe(true);
    await expect(page.locator('.conversation-entry').first()).toHaveAttribute('data-command-id', first!);
    await expect.poll(() => page.locator('.pending-message').count()).toBe(0);
    expect(await page.locator('.conversation-history').evaluate(element => element.scrollTop)).toBe(0);
  } finally { ack.release(); events.release(); }
});

test('inner methodology disclosure survives cancelled reads and tab-away but withdraws on current failure', async ({ page }) => {
  await page.clock.install();
  await signIn(page);
  const task = await create(page, 'Retain the inspected methodology disclosure');
  // Creation uses the running clock. Reload at a paused origin before opening
  // inspection so the 15s/30s refresh intervals cannot supersede its 8s deadline.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60_000));
  await page.reload();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Open ${task.objective}`, exact: true }).click();
  const methodology = page.locator('.task-methodology');
  const template = methodology.locator('details').filter({ has: page.locator('summary', { hasText: /^Template: / }) });
  const summary = template.locator('summary');
  const refresh = methodology.getByRole('button', { name: 'Refresh methodology basis', exact: true });
  await expect(summary).toHaveCount(1);
  await summary.click(); await summary.focus();
  await template.evaluate(element => { element.setAttribute('data-original-template', 'retained'); });
  const retained = page.locator('[data-original-template="retained"]');
  const basisRoute = `**/api/engagements/engagement-a/tasks/${task.id}/methodology?*`;

  for (const tabAway of [false, true]) {
    const basis = gate(), authority = gate(), projection = gate();
    let basisHeld = false, authorityHeld = false, projectionHeld = false;
    await page.route(basisRoute, async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200); basisHeld = true;
      await basis.held; await route.fulfill({ response });
    });
    await page.route('**/api/auth/session', async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200); authorityHeld = true;
      await authority.held; await route.fulfill({ response });
    });
    await page.route('**/api/engagements/engagement-a/conversation?*', async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200); projectionHeld = true;
      await projection.held; await route.fulfill({ response });
    });
    try {
      await refresh.click(); await expect.poll(() => basisHeld).toBe(true);
      await summary.focus();
      if (tabAway) {
        // Deterministically deliver the browser's hidden/visible lifecycle in
        // headless Chromium; App and TaskMethodology use the two paired values.
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await expect(page.locator('.protected-workspace')).toBeHidden();
        await expect(retained).toHaveCount(1); await expect(retained).toHaveAttribute('open', '');
        await expect(summary).toBeHidden();
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
          Object.defineProperty(document, 'hidden', { configurable: true, value: false });
          document.dispatchEvent(new Event('visibilitychange'));
        });
      } else await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect.poll(() => authorityHeld).toBe(true);
      await expect(page.locator('.protected-workspace')).toBeHidden();
      expect(await page.locator('body').innerText()).not.toMatch(/Retain the inspected methodology|Neutral working-paper starter|auditor-a|Alder Manufacturing/);
      basis.release(); authority.release();
      await expect.poll(() => projectionHeld).toBe(true);
      await expect(retained).toHaveCount(1); await expect(retained).toHaveAttribute('open', '');
      await expect(summary).toBeHidden();
      projection.release();
      await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
      await expect(refresh).toBeEnabled();
      await page.unrouteAll({ behavior: 'wait' });
      await expect(retained).toHaveCount(1); await expect(retained).toHaveAttribute('open', '');
      await expect(summary).toBeVisible(); await expect(summary).toBeFocused();
    } finally {
      basis.release(); authority.release(); projection.release();
      if (tabAway) await page.evaluate(() => {
        Reflect.deleteProperty(document, 'visibilityState'); Reflect.deleteProperty(document, 'hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.unrouteAll({ behavior: 'wait' });
    }
  }

  // A current failed read must withdraw the retained inspection, unlike an
  // intentionally superseded read. Recovery must read the real basis again.
  await page.route(basisRoute, route => route.abort('connectionreset'));
  try {
    await refresh.click();
    await expect(methodology.getByText('Current methodology basis is unavailable. Refresh to inspect it.', { exact: true })).toBeVisible();
    await expect(retained).toHaveCount(0); await expect(template).toHaveCount(0);
  } finally { await page.unrouteAll({ behavior: 'wait' }); }
  await refresh.click(); await expect(summary).toBeVisible();
  await summary.click(); await summary.focus();
  await template.evaluate(element => { element.setAttribute('data-timeout-template', 'retained'); });
  const deadline = gate(); let deadlineHeld = false;
  await page.route(basisRoute, async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200); deadlineHeld = true;
    await deadline.held; await route.fulfill({ response });
  });
  try {
    await refresh.click(); await expect.poll(() => deadlineHeld).toBe(true);
    // The real response is held; exercise the production timeout boundary.
    await page.clock.runFor(7_999);
    await expect(page.locator('[data-timeout-template="retained"]')).toBeVisible();
    await page.clock.runFor(1);
    await expect(methodology.getByText('Current methodology basis is unavailable. Refresh to inspect it.', { exact: true })).toBeVisible();
    await expect(page.locator('[data-timeout-template="retained"]')).toHaveCount(0);
    await expect(template).toHaveCount(0);
  } finally { deadline.release(); await page.unrouteAll({ behavior: 'wait' }); }
});
