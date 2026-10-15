import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration, restoreAndClose } from './cleanup';

// Story 22.2 AC4: a current Auditor with no assignments establishes an engagement
// from a first objective. Zobba asks only for the client and the period, then
// shows one confirmation; nothing is created before it.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const cleanup = `
DELETE FROM public.engagement_setup_messages; DELETE FROM public.engagement_setups;
DELETE FROM public.membership_events WHERE meaning->>'kind'='establish_engagement';
TRUNCATE public.tasks, public.task_counters, public.task_routing_questions CASCADE;
DELETE FROM public.engagement_assignments WHERE engagement_id NOT IN ('engagement-a','engagement-b');
DELETE FROM public.engagements WHERE id NOT IN ('engagement-a','engagement-b');
DELETE FROM public.clients WHERE id NOT IN ('client-a','client-b');
DELETE FROM public.organisation_memberships WHERE actor_id='actor-unassigned';`;
const restore = fixtureRestoration(['actor-unassigned', 'actor-a'], cleanup);
const grant = "INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','actor-unassigned',ARRAY['auditor']);";
test.beforeAll(async () => { runtime = await startAuthRuntime(); });
test.beforeEach(async () => { await runtime.stopWorker(); await runtime.sqlAsync(restore(grant)); });
test.afterEach(async ({ page }) => {
  await runtime.stopWorker();
  await page.getByLabel('Password', { exact: true }).fill('', { timeout: 250 }).catch(() => {});
});
test.afterAll(async () => { if (runtime) await restoreAndClose(runtime, restore()); });

async function signIn(page: Page, account = 'unassigned', heading = 'Start your first engagement') {
  await page.goto(runtime.url);
  await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  await page.getByLabel('Account', { exact: true }).selectOption(account);
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}
/** Objective, an existing client and a period, up to the one confirmation. */
async function toSummary(page: Page, objective: string, client: string) {
  await page.getByLabel('First objective', { exact: true }).fill(objective);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByLabel('Client name', { exact: true }).fill(client);
  await page.keyboard.press('Enter');
  await page.getByLabel('Audit period', { exact: true }).fill('2026-01-01 to 2026-12-31');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: 'Confirm engagement setup' })).toBeVisible();
}
function counts(): string {
  return runtime.sqlValue("SELECT (SELECT count(*) FROM public.engagements)||'/'||(SELECT count(*) FROM public.clients)||'/'||(SELECT count(*) FROM public.engagement_assignments WHERE actor_id='actor-unassigned')||'/'||(SELECT count(*) FROM public.tasks)").trim();
}

test('an Auditor with no assignments establishes an engagement and its first Task by keyboard', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  const before = counts();
  const objective = page.getByLabel('First objective', { exact: true });
  await objective.focus();
  await page.keyboard.type('Review leaver access controls');
  await page.keyboard.press('Enter');
  const conversation = page.getByRole('list', { name: 'Setup conversation' });
  await expect(conversation).toContainText('Which client is this engagement for?');
  const answer = page.getByLabel('Client name', { exact: true });
  await expect(answer).toBeFocused();
  await page.keyboard.type('alder manufacturing');
  await page.keyboard.press('Enter');
  await expect(conversation).toContainText('What audit period does this engagement cover?');
  const period = page.getByLabel('Audit period', { exact: true });
  await expect(period).toBeFocused();
  await page.keyboard.type('2026-12-31 to 2026-01-01');
  await page.keyboard.press('Enter');
  await expect(conversation).toContainText('The period must start on or before its end date.');
  await expect(period).toBeFocused();
  await page.keyboard.type('2026-01-01 to 2026-12-31');
  await page.keyboard.press('Enter');
  const summary = page.getByRole('group', { name: 'Confirm engagement setup' });
  await expect(summary).toContainText('Alder Manufacturing');
  await expect(summary).toContainText('2026-01-01 to 2026-12-31');
  await expect(summary).toContainText('Only you');
  expect(counts()).toBe(before);
  await expect(page.getByRole('button', { name: 'Confirm and start' })).toBeFocused();
  await page.keyboard.press('Enter');
  // The conversation continues in the newly established engagement.
  await expect(page.getByRole('heading', { name: 'Audit 2026-01-01 to 2026-12-31', level: 1 })).toBeVisible();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  await expect(page.locator('.task-card h3').filter({ hasText: 'Review leaver access controls' })).toBeVisible();
  const after = counts().split('/').map(Number), prior = before.split('/').map(Number);
  expect([after[0]! - prior[0]!, after[2], after[3]! - prior[3]!]).toEqual([1, 1, 1]);
  const period_ = runtime.sqlValue("SELECT to_char(period_start,'YYYY-MM-DD')||' '||to_char(period_end,'YYYY-MM-DD') FROM public.engagements WHERE id NOT IN ('engagement-a','engagement-b')").trim();
  expect(period_).toBe('2026-01-01 2026-12-31');
  expect(errors).toEqual([]);
});

test('an ambiguous client asks which one; nothing is created until confirmation', async ({ page }) => {
  await runtime.sqlAsync("INSERT INTO public.clients(organisation_id,id,name) VALUES('org-a','client-a2','ALDER MANUFACTURING');");
  await signIn(page);
  const before = counts();
  await page.getByLabel('First objective', { exact: true }).fill('Test vendor payments');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByLabel('Client name', { exact: true }).fill('Alder manufacturing');
  await page.keyboard.press('Enter');
  const choice = page.getByRole('group', { name: 'Which client is it?' });
  await expect(choice.getByRole('radio')).toHaveCount(2);
  // An answer naming a client outside the candidates is refused.
  const setups = await page.request.get(`${runtime.url}/api/organisations/org-a/engagement-setups`);
  const setup = (await setups.json()).setups[0];
  const session = await (await page.request.get(`${runtime.url}/api/auth/session`)).json();
  const outside = await page.request.post(`${runtime.url}/api/organisations/org-a/engagement-setups/${setup.id}/messages`, {
    headers: { 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, Origin: runtime.url },
    data: { key: 'outside-candidate', kind: 'choose_client', client_id: 'client-b' } });
  expect(outside.status()).toBe(200);
  const refused = await outside.json();
  expect(refused.state).toBe('client_choice');
  expect(refused.messages.at(-1).refusal).toBe('not_a_candidate');
  // Keyboard selection of the second listed candidate.
  await choice.getByRole('radio').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(choice.getByRole('radio').nth(1)).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Use this client' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Audit period', { exact: true })).toBeFocused();
  await page.keyboard.type('2026-01-01/2026-06-30');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: 'Confirm engagement setup' })).toContainText('ALDER MANUFACTURING');
  expect(counts()).toBe(before);
  // Cancelling leaves nothing behind.
  await page.getByRole('button', { name: 'Cancel setup' }).click();
  await expect(page.getByRole('list', { name: 'Setup conversation' })).toHaveCount(0);
  expect(counts()).toBe(before);
});

test('a narrow screen keeps every setup control reachable without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await signIn(page);
  await page.getByLabel('First objective', { exact: true }).fill('Check journal approvals');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByLabel('Client name', { exact: true }).fill('Cedar Partners');
  await page.keyboard.press('Enter');
  const proposal = page.getByRole('group', { name: 'Create client Cedar Partners?' });
  await expect(proposal.getByRole('button', { name: 'Create client Cedar Partners' })).toBeVisible();
  const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth + 0.5)
    .map(element => `${element.tagName}.${element.className}:${Math.round(element.getBoundingClientRect().right)}`).slice(0, 8));
  expect(overflow).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Declining keeps the setup open and asks for the client again.
  await proposal.getByRole('button', { name: 'No, name another client' }).click();
  await expect(page.getByLabel('Client name', { exact: true })).toBeFocused();
  expect(runtime.sqlValue("SELECT count(*) FROM public.clients WHERE name='Cedar Partners'").trim()).toBe('0');
});

test('a lost confirmation response is recovered by sending the same request again, creating nothing twice', async ({ page }) => {
  await signIn(page);
  const before = counts().split('/').map(Number);
  await toSummary(page, 'Reconcile supplier statements', 'Alder Manufacturing');
  // The server commits the confirmation; its response never reaches the browser.
  await page.route('**/api/organisations/*/engagement-setups/*/confirm', async route => { await route.fetch(); await route.abort('connectionreset'); });
  await page.getByRole('button', { name: 'Confirm and start' }).click();
  await expect(page.getByText('The request was not confirmed. Sending it again is safe and creates no duplicates.')).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
  const committed = counts().split('/').map(Number);
  expect([committed[0]! - before[0]!, committed[3]! - before[3]!]).toEqual([1, 1]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your engagements', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Start new engagement' }).click();
  const retained = page.locator('.setup-retained');
  await expect(retained).toContainText('Confirm and start · not confirmed');
  await retained.getByRole('button', { name: 'Send again' }).click();
  await expect(page.getByRole('heading', { name: 'Audit 2026-01-01 to 2026-12-31', level: 1 })).toBeVisible();
  const after = counts().split('/').map(Number);
  expect([after[0]! - before[0]!, after[2], after[3]! - before[3]!]).toEqual([1, 1, 1]);
});

test('a member who already has engagements opens Start new engagement and completes setup', async ({ page }) => {
  await signIn(page, 'auditor-a', 'Your engagements');
  const engagements = () => Number(runtime.sqlValue('SELECT count(*) FROM public.engagements').trim());
  const before = engagements();
  await page.getByRole('button', { name: 'Start new engagement' }).click();
  await expect(page.getByRole('heading', { name: 'Start new engagement', level: 2 })).toBeVisible();
  await page.getByLabel('First objective', { exact: true }).fill('Walk through change approvals');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByLabel('Client name', { exact: true }).fill('Juniper Holdings');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Create client Juniper Holdings' }).click();
  await page.getByLabel('Audit period', { exact: true }).fill('2026-04-01/2027-03-31');
  await page.keyboard.press('Enter');
  const summary = page.getByRole('group', { name: 'Confirm engagement setup' });
  await expect(summary).toContainText('Juniper Holdings (new client)');
  expect(engagements()).toBe(before);
  await summary.getByRole('button', { name: 'Confirm and start' }).click();
  await expect(page.getByRole('heading', { name: 'Audit 2026-04-01 to 2027-03-31', level: 1 })).toBeVisible();
  await expect(page.locator('.task-card h3').filter({ hasText: 'Walk through change approvals' })).toBeVisible();
  expect(engagements()).toBe(before + 1);
  expect(runtime.sqlValue("SELECT count(*) FROM public.engagement_assignments a JOIN public.engagements e ON e.id=a.engagement_id WHERE e.name='Audit 2026-04-01 to 2027-03-31' AND a.actor_id='actor-a'").trim()).toBe('1');
});
