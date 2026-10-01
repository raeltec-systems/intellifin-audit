import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
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
const foreignScope = 'organisation_id=org-b&client_id=client-b';
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
async function currentTask(page: Page, id: string): Promise<Task> {
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/tasks/${id}?${scope}`);
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
async function saved(page: Page): Promise<{ key: string; actor_id: string; command: TaskCommand }[]> {
  return page.evaluate(async () => {
    const { OutboxStore } = await import(/* @vite-ignore */ '../../src/conversation-outbox.ts');
    return (await new OutboxStore('actor-a', { organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' }).read()).sort((a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key));
  });
}
async function dropCommitted(route: Route, accepted: TaskCommand[]) {
  accepted.push(route.request().postDataJSON());
  const response = await route.fetch(); expect(response.status()).toBe(202);
  await route.abort('connectionreset');
}

test('real replacement OIDC actor and scope cannot reveal or replay the previous recovery outbox', async ({ page, context }) => {
  await signIn(page);
  const committed: TaskCommand[] = [];
  await page.route('**/api/engagements/engagement-a/conversation**', route => route.abort('connectionreset'));
  await page.route('**/api/engagements/engagement-a/task-commands?*', route => dropCommitted(route, committed));
  await page.getByLabel('Task objective', { exact: true }).fill('Previous actor private recovery text');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect(page.locator('.pending-message')).toContainText('Delivery unconfirmed');
  const original = await saved(page); expect(original).toHaveLength(1); expect(committed).toHaveLength(1);
  const replacement = await context.newPage();
  try {
    await signIn(replacement, 'auditor-b', 'FY2026 review', true);
    expect((await session(replacement)).identity.id).toBe('actor-b');
    let replacementPosts = 0;
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/task-')) replacementPosts++; });
    await page.unroute('**/api/engagements/engagement-a/conversation**');
    await page.getByRole('button', { name: 'Refresh access' }).click();
    // Polling may already have withdrawn the old scope before this explicit
    // refresh. Its one-refresh notice is transient; assert the stable boundary.
    await expect(page.getByRole('banner').getByText('auditor-b', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your engagements', exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Assigned engagements' }).getByRole('button')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /FY2026 audit/ })).toHaveCount(0);
    await expect(page.locator('.pending-message')).toHaveCount(0);
    await expect(page.getByText('Previous actor private recovery text', { exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: /FY2026 review/ }).click();
    await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
    await expect(page.locator('.pending-message')).toHaveCount(0);
    await expect(page.getByText('Previous actor private recovery text', { exact: false })).toHaveCount(0);
    expect(await saved(page)).toEqual(original);
    expect((await snapshot(page, 'engagement-b', foreignScope)).messages).toHaveLength(0);
    expect((await page.request.get(`${runtime.url}/api/engagements/engagement-a/conversation?${scope}`)).status()).toBe(403);
    expect(replacementPosts).toBe(0); expect(committed).toHaveLength(1);
  } finally { await replacement.close(); }
});

test('two same-actor tabs retain both committed lost acknowledgements and recover each exact key', async ({ page, context }) => {
  await signIn(page);
  const second = await context.newPage();
  try {
    await second.goto(page.url());
    await expect(second.getByText('Conversation up to date', { exact: true })).toBeVisible();
    const firstCommands: TaskCommand[] = [], secondCommands: TaskCommand[] = [];
    for (const tab of [page, second]) await tab.route('**/api/engagements/*/conversation**', route => route.abort('connectionreset'));
    await page.route('**/api/engagements/*/task-commands?*', route => dropCommitted(route, firstCommands));
    await second.route('**/api/engagements/*/task-commands?*', route => dropCommitted(route, secondCommands));
    await page.getByLabel('Task objective', { exact: true }).fill('First tab retained objective');
    await second.getByLabel('Task objective', { exact: true }).fill('Second tab retained objective');
    await Promise.all([page.getByRole('button', { name: 'Send', exact: false }).click(), second.getByRole('button', { name: 'Send', exact: false }).click()]);
    await expect(page.locator('.pending-message').filter({ hasText: 'First tab retained objective' })).toContainText('Delivery unconfirmed');
    await expect(second.locator('.pending-message').filter({ hasText: 'Second tab retained objective' })).toContainText('Delivery unconfirmed');
    await expect.poll(async () => (await saved(page)).length).toBe(2);
    await expect.poll(() => firstCommands.length + secondCommands.length).toBe(2);
    const originals = await saved(page);
    expect(new Set(originals.map(item => item.key)).size).toBe(2);
    expect(originals.map(item => item.command.content).sort()).toEqual(['First tab retained objective', 'Second tab retained objective']);
    for (const tab of [page, second]) await tab.unroute('**/api/engagements/*/task-commands?*');
    await page.reload();
    await expect(page.locator('.pending-message')).toHaveCount(2);
    const recovered: TaskCommand[] = [];
    await page.route('**/api/engagements/*/task-commands?*', async route => {
      recovered.push(route.request().postDataJSON());
      const response = await route.fetch(); expect(response.status()).toBe(202); await route.fulfill({ response });
    });
    for (const content of ['First tab retained objective', 'Second tab retained objective']) {
      await page.locator('.pending-message').filter({ hasText: content }).getByRole('button', { name: 'Check original request' }).click();
      await expect(page.locator('.pending-message').filter({ hasText: content })).toHaveCount(0);
    }
    expect(recovered.sort((a, b) => a.key.localeCompare(b.key))).toEqual(originals.map(item => item.command).sort((a, b) => a.key.localeCompare(b.key)));
    expect(await saved(page)).toHaveLength(0);
    await page.unroute('**/api/engagements/*/conversation**');
    await page.getByRole('button', { name: 'Latest messages', exact: true }).click();
    await expect(page.locator('.task-card')).toHaveCount(2);
    const durable = await snapshot(page); expect(durable.messages).toHaveLength(2); expect(durable.tasks).toHaveLength(2);
  } finally { await second.close(); }
});

test('later bounded Task page refreshes factual state and cycle while retaining an explicitly selected old composer target', async ({ page }) => {
  await signIn(page);
  const verified = await session(page);
  const accepted: { id: string; cycle_id: string; objective: string }[] = [];
  for (let index = 0; index < 101; index++) {
    const objective = `Retained paginated Task ${String(index).padStart(3, '0')}`;
    const response = await post(page, { key: `page-create-${index}`, kind: 'create', content: objective }, verified);
    expect(response.status()).toBe(202); const receipt = await response.json();
    accepted.push({ id: receipt.task_id, cycle_id: receipt.cycle_id, objective });
    expect((await post(page, { key: `page-stop-${index}`, kind: 'stop', task_id: receipt.task_id, cycle_id: receipt.cycle_id }, verified)).status()).toBe(202);
  }
  const last = accepted.sort((a, b) => a.id.localeCompare(b.id)).at(-1)!;
  await page.getByRole('button', { name: 'Latest messages', exact: true }).click();
  await expect(page.locator('.active-task-list li')).toHaveCount(100);
  await page.getByRole('button', { name: 'More Tasks', exact: true }).click();
  await expect(page.locator('.active-task-list li')).toHaveCount(1);
  await expect(page.locator('.active-task-list')).toContainText(last.objective);
  await page.getByLabel('Send to', { exact: true }).selectOption(`${last.id}:${last.cycle_id}`);
  await page.getByLabel('Guidance', { exact: true }).fill('Keep this separately targeted draft');
  await page.locator('.task-list-open').filter({ hasText: last.objective }).click();
  // Keep this exact inspection while returning to the first bounded Task page.
  await page.getByRole('button', { name: 'Latest messages', exact: true }).click();
  await expect(page.getByLabel('Send to', { exact: true }).locator('option')).toHaveCount(102);
  await page.getByRole('button', { name: new RegExp(`^Continue ${last.objective}`) }).click();
  await expect.poll(async () => (await currentTask(page, last.id)).cycle_id).not.toBe(last.cycle_id);
  const continued = await currentTask(page, last.id);
  await expect(page.locator('.task-state .status-label')).toHaveText('Ready for foundation activity');
  await expect(page.getByRole('button', { name: `Stop ${last.objective} · current cycle ${continued.cycle_id.slice(0, 8)}`, exact: true })).toBeVisible();
  await expect(page.getByLabel('Send to', { exact: true })).toHaveValue(`${last.id}:${last.cycle_id}`);
  await expect(page.getByLabel('Guidance', { exact: true })).toHaveValue('Keep this separately targeted draft');
  await expect(page.getByRole('button', { name: 'Send', exact: false })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('earlier work cycle');
  let stalePosts = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/task-')) stalePosts++; });
  await page.getByLabel('Guidance', { exact: true }).press('Enter');
  expect(stalePosts).toBe(0);
  await expect(page.getByLabel('Guidance', { exact: true })).toHaveValue('Keep this separately targeted draft');
  expect((await post(page, { key: 'later-page-current-stop', kind: 'stop', task_id: last.id, cycle_id: continued.cycle_id }, verified)).status()).toBe(202);
  await expect(page.locator('.task-state .status-label')).toHaveText('Stopped');
  await expect(page.getByRole('button', { name: `Continue ${last.objective} · current cycle ${continued.cycle_id.slice(0, 8)}`, exact: true })).toBeVisible();
});

test('a held old-scope snapshot cannot restore protected projection or draft after explicit scope selection', async ({ page }) => {
  runtime.sql("INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-b','actor-a',ARRAY['auditor']); INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-b','client-b','engagement-b','actor-a');");
  const oldResponse = gate(); let entered = false; let delivered = false;
  try {
    await signIn(page); await create(page, 'Old scope projection must remain withdrawn');
    await page.getByLabel('Task objective', { exact: true }).fill('Old scope editable draft');
    await page.route('**/api/engagements/engagement-a/conversation?*', async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200); entered = true;
      await oldResponse.held; await route.fulfill({ response }); delivered = true;
    });
    await page.getByRole('button', { name: 'Latest messages', exact: true }).click();
    await expect.poll(() => entered).toBe(true);
    await page.getByRole('button', { name: 'All engagements' }).click();
    await page.getByRole('button', { name: /FY2026 review/ }).click();
    await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
    oldResponse.release(); await expect.poll(() => delivered).toBe(true);
    await expect(page.locator('.conversation-message')).toHaveCount(0);
    await expect(page.locator('.task-card')).toHaveCount(0);
    await expect(page.getByLabel('Task objective', { exact: true })).toHaveValue('');
    await expect(page.getByText('Old scope projection must remain withdrawn', { exact: false })).toHaveCount(0);
    expect((await snapshot(page, 'engagement-b', foreignScope)).messages).toHaveLength(0);
  } finally { oldResponse.release(); runtime.sql(restore); }
});

test('logout wins over an already fetched protected snapshot and later refresh callbacks', async ({ page }) => {
  await signIn(page); await create(page, 'Protected before logout');
  const oldResponse = gate(); let entered = false; let delivered = false;
  await page.route('**/api/engagements/engagement-a/conversation?*', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200); entered = true;
    await oldResponse.held; await route.fulfill({ response }); delivered = true;
  });
  try {
    await page.getByRole('button', { name: 'Latest messages', exact: true }).click();
    await expect.poll(() => entered).toBe(true);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your work starts here' })).toBeVisible();
    oldResponse.release(); await expect.poll(() => delivered).toBe(true);
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await expect(page.getByRole('heading', { name: 'Your work starts here' })).toBeVisible();
    await expect(page.locator('.conversation-workspace')).toHaveCount(0);
    await expect(page.getByText('Protected before logout', { exact: false })).toHaveCount(0);
    expect((await page.request.get(`${runtime.url}/api/auth/session`)).status()).toBe(401);
  } finally { oldResponse.release(); }
});

test('reserved control and same-key receipt recovery do not wait on held ordinary session or scope reads', async ({ page }) => {
  await signIn(page); const task = await create(page, 'Reserved control through ordinary read outage');
  await page.getByRole('button', { name: `Open ${task.objective}`, exact: true }).click();
  const ordinary = gate(), events = gate(); let heldReads = 0; let eventsHeld = false;
  const holdRead = async (route: Route) => { const response = await route.fetch(); expect(response.status()).toBe(200); heldReads++; await ordinary.held; await route.fulfill({ response }); };
  await page.route('**/api/auth/session', holdRead);
  await page.route('**/api/engagements/engagement-a?*', holdRead);
  await page.route('**/api/engagements/engagement-a/conversation/events?*', async route => { eventsHeld = true; await events.held; await route.continue(); });
  const commands: TaskCommand[] = [];
  await page.route('**/api/engagements/engagement-a/task-controls?*', async route => {
    commands.push(route.request().postDataJSON());
    const response = await route.fetch(); expect(response.status()).toBe(202);
    if (commands.length === 1) await route.abort('connectionreset'); else await route.fulfill({ response });
  });
  try {
    await page.evaluate(selected => {
      document.documentElement.dataset.ordinaryReads = 'pending';
      void Promise.all([fetch('/api/auth/session'), fetch(`/api/engagements/engagement-a?${selected}`)])
        .then(() => { document.documentElement.dataset.ordinaryReads = 'settled'; });
    }, scope);
    await expect.poll(() => heldReads).toBe(2); await expect.poll(() => eventsHeld).toBe(true);
    await page.getByRole('button', { name: `Pause ${task.objective} · current cycle ${task.cycle_id.slice(0, 8)}`, exact: true }).click();
    await expect(page.locator('.pending-message')).toContainText('Delivery unconfirmed');
    expect((await currentTask(page, task.id)).state).toBe('paused');
    await page.getByRole('button', { name: 'Check original request', exact: true }).click();
    await expect(page.locator('.pending-message')).toHaveCount(0);
    expect(commands).toHaveLength(2); expect(commands[1]).toEqual(commands[0]);
    expect(heldReads).toBe(2);
    expect(await page.evaluate(() => document.documentElement.dataset.ordinaryReads)).toBe('pending');
    const durable = await snapshot(page);
    expect(durable.messages.filter((message: { key: string }) => message.key === commands[0]!.key)).toHaveLength(1);
  } finally { ordinary.release(); events.release(); }
});

test('an actual stale-cycle control returns 409 and dismissing its refusal preserves the independent next draft', async ({ page }) => {
  await signIn(page); const task = await create(page, 'Exact stale cycle refusal');
  await page.getByRole('button', { name: `Open ${task.objective}`, exact: true }).click();
  const control = gate(), events = gate(); let attempted: TaskCommand | null = null; let responseStatus: number | null = null;
  await page.route('**/api/engagements/engagement-a/conversation/events?*', async route => { await events.held; await route.continue(); });
  await page.route('**/api/engagements/engagement-a/task-controls?*', async route => {
    attempted = route.request().postDataJSON(); await control.held;
    const response = await route.fetch(); responseStatus = response.status(); await route.fulfill({ response });
  }, { times: 1 });
  try {
    await page.getByRole('button', { name: `Pause ${task.objective} · current cycle ${task.cycle_id.slice(0, 8)}`, exact: true }).click();
    await expect.poll(() => attempted).not.toBeNull();
    await page.getByLabel('Task objective', { exact: true }).fill('Independent next draft survives refusal');
    expect((await post(page, { key: 'external-stop-before-stale', kind: 'stop', task_id: task.id, cycle_id: task.cycle_id })).status()).toBe(202);
    const continued = await post(page, { key: 'external-continue-before-stale', kind: 'continue', task_id: task.id, cycle_id: task.cycle_id });
    expect(continued.status()).toBe(202); const next = await continued.json(); expect(next.cycle_id).not.toBe(task.cycle_id);
    control.release(); await expect.poll(() => responseStatus).toBe(409);
    await expect(page.locator('.pending-message')).toContainText('Request refused');
    await expect(page.locator('.pending-message')).toContainText(task.cycle_id);
    const before = await saved(page); expect(before).toHaveLength(1); expect(before[0]!.command).toEqual(attempted);
    await page.getByRole('button', { name: 'Dismiss refusal', exact: true }).click();
    await expect(page.locator('.pending-message')).toHaveCount(0); expect(await saved(page)).toHaveLength(0);
    await expect(page.getByLabel('Task objective', { exact: true })).toHaveValue('Independent next draft survives refusal');
    const durable = await snapshot(page);
    expect(durable.messages.filter((message: { key: string }) => message.key === (attempted as unknown as TaskCommand).key)).toHaveLength(0);
    expect((await currentTask(page, task.id)).cycle_id).toBe(next.cycle_id);
  } finally { control.release(); events.release(); }
});
