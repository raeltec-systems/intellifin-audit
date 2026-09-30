import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Session } from '../../src/auth';
import type { Task, TaskCommand } from '../../src/conversation';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { restoreAndClose } from './cleanup';

// Browser plugin not available. These regressions use the owned Playwright
// harness, actual HTTPS OIDC, restricted PostgreSQL and real HTTP admission.
// Fault routes hold/drop actual responses; none fabricates successful work.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const scope = 'organisation_id=org-a&client_id=client-a';
const restore = `
UPDATE public.identities SET active=true WHERE id IN ('actor-a','actor-manager','actor-b');
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE actor_id='actor-a' AND organisation_id='org-a';
UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id='actor-a' AND organisation_id='org-a';
DELETE FROM public.engagement_assignments WHERE actor_id='actor-a' AND organisation_id='org-b';
DELETE FROM public.organisation_memberships WHERE actor_id='actor-a' AND organisation_id='org-b';`;
test.beforeAll(async () => { runtime = await startAuthRuntime(); });
test.beforeEach(async () => { await runtime.stopWorker(); runtime.sql(`${restore} TRUNCATE public.tasks, public.task_counters CASCADE;`); });
test.afterEach(async ({ context }) => {
  await runtime.stopWorker(); runtime.sql(restore);
  for (const page of context.pages()) await page.getByLabel('Password', { exact: true }).fill('', { timeout: 250 }).catch(() => {});
});
test.afterAll(async () => { if (runtime) await restoreAndClose(runtime, restore); });

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
test('same-scope checks hide every protected surface and restore mounted Task controls, disclosure and focus', async ({ page }) => {
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
    authority.release(); await expect.poll(() => authorityDelivered).toBe(true); await page.unroute('**/api/auth/session');
    await expect(picker).toBeFocused(); await picker.click();
    await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  } finally { authority.release(); }
  const task = await create(page, 'Retain focused control and disclosure');
  await page.getByRole('button', { name: `Open ${task.objective}`, exact: true }).click();
  const disclosure = page.locator('.task-detail details');
  await disclosure.locator('summary').click();
  const pause = page.getByRole('button', { name: new RegExp(`^Pause ${task.objective}`) });
  await pause.evaluate(element => { element.setAttribute('data-original-control', 'retained'); });
  await pause.focus();
  const access = gate(), projection = gate(); let accessHeld = false, projectionHeld = false;
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
    await expect(pause).toBeHidden();
    projection.release();
    await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
    await expect(pause).toHaveAttribute('data-original-control', 'retained');
    await expect(pause).toBeFocused(); await expect(disclosure).toHaveAttribute('open', '');
    await page.unroute('**/api/auth/session'); await page.unroute('**/api/engagements/engagement-a/conversation?*');
    await page.route('**/api/engagements/engagement-a/conversation**', route => route.abort('connectionreset'));
    await page.getByRole('button', { name: 'Latest messages' }).click();
    await expect(page.getByRole('region', { name: 'Task details', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-original-control="retained"]')).toHaveCount(0);
  } finally { access.release(); projection.release(); }
});

test('Follow uses current activity while reading older history without retargeting or stealing focus', async ({ page }) => {
  await signIn(page); const a = await create(page, 'History follow Task A'); const b = await create(page, 'History follow Task B');
  const verified = await session(page);
  for (let index = 0; index < 105; index++) expect((await post(page, { key: `history-follow-${index}`, kind: 'guide', task_id: a.id, cycle_id: a.cycle_id, content: `Historical guidance ${index}` }, verified)).status()).toBe(202);
  await page.getByRole('button', { name: 'Latest messages' }).click();
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
  await page.getByRole('button', { name: 'Latest messages' }).click();
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
