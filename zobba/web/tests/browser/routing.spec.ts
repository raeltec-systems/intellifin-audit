import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration, restoreAndClose } from './cleanup';

// Story 22.2: untargeted direction is routed by the server, never a model.
// Two Tasks produce one durable targeting question answered by keyboard.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const scope = 'organisation_id=org-a&client_id=client-a';
const restore = fixtureRestoration(['actor-a'], "UPDATE public.identities SET active=true WHERE id='actor-a'; UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE actor_id='actor-a'; UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id='actor-a';");
const resetTasks = 'TRUNCATE public.tasks, public.task_counters, public.task_routing_questions CASCADE;';
test.beforeAll(async () => { runtime = await startAuthRuntime(); });
test.beforeEach(async () => { await runtime.stopWorker(); await runtime.sqlAsync(restore(resetTasks)); });
test.afterEach(async ({ page }) => {
  await runtime.stopWorker();
  await page.getByLabel('Password', { exact: true }).fill('', { timeout: 250 }).catch(() => {});
});
test.afterAll(async () => { if (runtime) await restoreAndClose(runtime, restore()); });

async function signIn(page: Page) {
  await page.goto(runtime.url);
  await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  await page.getByLabel('Account', { exact: true }).selectOption('auditor-a');
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
}
async function commands(page: Page, content: string) {
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/conversation?${scope}`);
  expect(response.status()).toBe(200);
  return (await response.json()).messages.filter((m: { content: string | null }) => m.content === content);
}

test('one open Task receives untargeted guidance; the receipt names it', async ({ page }) => {
  await signIn(page);
  await create(page, 'Review leaver access');
  await page.getByLabel('Send to', { exact: true }).selectOption('route');
  await page.getByLabel('Direction', { exact: true }).fill('Use the contractual termination date.');
  await page.getByLabel('Direction', { exact: true }).press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Received as guidance for Review leaver access' })).toBeVisible();
  const sent = await commands(page, 'Use the contractual termination date.');
  expect(sent).toHaveLength(1);
  expect(sent[0].kind).toBe('guide');
});

test('two Tasks: one targeting question, keyboard multi-select, one receipt per target, durable across reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await create(page, 'Review leaver access');
  await create(page, 'Investigate shared accounts');
  await page.getByLabel('Send to', { exact: true }).selectOption('route');
  await page.getByLabel('Direction', { exact: true }).fill('Exclude service accounts from the sample.');
  await page.getByLabel('Direction', { exact: true }).press('Enter');
  const question = page.getByRole('article', { name: 'Which Task should receive: Exclude service accounts from the sample.' });
  await expect(question).toBeVisible();
  expect(await commands(page, 'Exclude service accounts from the sample.')).toHaveLength(0);
  // Keyboard only: focus each candidate and toggle it with Space.
  // Candidates are listed in the server's deterministic order.
  const boxes = question.getByRole('checkbox');
  await expect(boxes).toHaveCount(2);
  const first = boxes.nth(0);
  const second = boxes.nth(1);
  await first.focus(); await page.keyboard.press('Space');
  await page.keyboard.press('Tab'); await expect(second).toBeFocused(); await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(question.getByRole('button', { name: 'Send to selected Tasks' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(question.locator('.routed-receipts li')).toHaveCount(2);
  const sent = await commands(page, 'Exclude service accounts from the sample.');
  expect(sent).toHaveLength(2);
  expect(new Set(sent.map((m: { task_id: string }) => m.task_id)).size).toBe(2);
  // Reconnect: the answered question and its receipts are durable facts.
  await page.reload();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Which Task should receive: Exclude service accounts from the sample.' }).locator('.routed-receipts li')).toHaveCount(2);
  expect(await commands(page, 'Exclude service accounts from the sample.')).toHaveLength(2);
  // The inspected Task shows recorded work, with the model honestly unavailable.
  await page.getByRole('button', { name: 'Open Review leaver access', exact: true }).click();
  const work = page.getByRole('region', { name: 'Task details' }).locator('.task-work');
  await expect(work).toContainText('Model unavailable');
  await expect(work).toContainText('Bound method');
  await work.getByText(/Brief revisions/).click();
  await expect(work.locator('.brief-revisions li')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('a direction is persisted before sending; a lost reply is retained and checked once after reload', async ({ page }) => {
  await signIn(page);
  await create(page, 'Review leaver access');
  await page.getByLabel('Send to', { exact: true }).selectOption('route');
  // The server commits; the reply never reaches the browser.
  let delivered = 0;
  await page.route('**/api/engagements/engagement-a/task-directions?**', async route => {
    await route.fetch(); delivered += 1; await route.abort();
  });
  await page.getByLabel('Direction', { exact: true }).fill('Sample only terminated users.');
  await page.getByLabel('Direction', { exact: true }).press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'Delivery was not confirmed' })).toBeVisible();
  expect(delivered).toBe(1);
  expect(await commands(page, 'Sample only terminated users.')).toHaveLength(1);
  await page.unrouteAll({ behavior: 'wait' });
  await page.reload();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  await page.getByLabel('Send to', { exact: true }).selectOption('route');
  const check = page.getByRole('button', { name: 'Check original direction' });
  await expect(check).toBeVisible();
  await check.click();
  await expect(page.getByRole('status').filter({ hasText: 'Received as guidance for Review leaver access' })).toBeVisible();
  await expect(check).toHaveCount(0);
  expect(await commands(page, 'Sample only terminated users.')).toHaveLength(1);
});
