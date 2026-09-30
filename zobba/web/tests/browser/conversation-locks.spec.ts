import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, Route } from '@playwright/test';
import type { Session } from '../../src/auth';
import type { ConversationSnapshot, Task, TaskCommand } from '../../src/conversation';
import type { OutboxItem } from '../../src/conversation-state';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { restoreAndClose } from './cleanup';

// Browser plugin unavailable: use the owned Chromium, real HTTPS OIDC, restricted
// PostgreSQL and real command handlers. A dropped acknowledgement is always
// dropped AFTER the actual API returns 202; no successful response is invented.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const scope = 'organisation_id=org-a&client_id=client-a';
let heldRecoveryPage: Page | null = null;
const restore = `
UPDATE public.identities SET active=true WHERE id='actor-a';
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE actor_id='actor-a' AND organisation_id='org-a';
UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id='actor-a' AND organisation_id='org-a';`;

// Optional expected-failure controls are confined to the module returned to this
// test browser. They never edit source or bypass the API. Run each separately:
// ZOBBA_CONVERSATION_LOCK_MUTATION=no-quota-check ... --grep 'R11 '
// ZOBBA_CONVERSATION_LOCK_MUTATION=no-submitting-guard ... --grep 'R12 '
// Each command MUST fail its normal invariant, rather than count as a passing
// acceptance run. Exact replacement counts prevent an obsolete mutation passing.
const mutation = process.env.ZOBBA_CONVERSATION_LOCK_MUTATION;
if (mutation && !['no-quota-check', 'no-submitting-guard'].includes(mutation)) throw new Error('Unknown conversation lock test mutation.');
let mutationApplications = 0;

async function installMutation(context: BrowserContext): Promise<void> {
  if (!mutation) return;
  const source = mutation === 'no-quota-check' ? 'conversation-outbox.ts' : 'ConversationWorkspace.tsx';
  await context.route(`**/src/${source}*`, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const original = await response.text();
    const marker = mutation === 'no-quota-check'
      ? /if \(overLimit\)/g
      : /submittingDraft\.current\s*\|\|\s*/g;
    expect([...original.matchAll(marker)], `The ${mutation} negative control must change exactly one safeguard.`).toHaveLength(1);
    const body = original.replace(marker, mutation === 'no-quota-check' ? 'if (false)' : '');
    mutationApplications++;
    await route.fulfill({ response, body, contentType: 'application/javascript' });
  });
}

test.beforeAll(async () => { runtime = await startAuthRuntime(); });
test.beforeEach(async ({ context }) => {
  await runtime.stopWorker();
  runtime.sql(`${restore} TRUNCATE public.tasks, public.task_counters CASCADE;`);
  mutationApplications = 0;
  await installMutation(context);
});
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

async function signIn(page: Page) {
  await page.goto(runtime.url);
  await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  await page.getByLabel('Account', { exact: true }).selectOption('auditor-a');
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
}

async function snapshot(page: Page): Promise<ConversationSnapshot> {
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/conversation?${scope}`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function createTarget(page: Page, key: string, objective: string): Promise<Task> {
  const sessionResponse = await page.request.get(`${runtime.url}/api/auth/session`);
  expect(sessionResponse.status()).toBe(200);
  const session: Session = await sessionResponse.json();
  const response = await page.request.post(`${runtime.url}/api/engagements/engagement-a/task-commands?${scope}`, {
    headers: { Origin: runtime.url, 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id },
    data: { key, kind: 'create', content: objective },
  });
  expect(response.status()).toBe(202);
  const task = (await snapshot(page)).tasks.find(value => value.objective === objective);
  expect(task).toBeDefined();
  return task!;
}

type RecoveryWindow = Window & {
  __releaseRecovery?: () => void; __recoveryHeld?: boolean; __recoveryTransaction?: IDBTransaction;
  __reservesPending?: number; __reserveObserved?: boolean;
  __readRecovery?: () => Promise<OutboxItem[]>;
};
async function saved(page: Page): Promise<OutboxItem[]> {
  if (heldRecoveryPage) return heldRecoveryPage.evaluate(() => (window as RecoveryWindow).__readRecovery!());
  return page.evaluate(async () => {
    const { OutboxStore } = await import(/* @vite-ignore */ '../../src/conversation-outbox.ts');
    return (await new OutboxStore('actor-a', { organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' }).read()).sort((a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key));
  });
}
async function holdAdmissionTransaction(context: BrowserContext): Promise<Page> {
  // Observe real reservation calls; this changes no storage result or API reply.
  for (const page of context.pages()) await page.evaluate(async () => {
    const current = window as RecoveryWindow;
    if (current.__reserveObserved) return;
    const { OutboxStore } = await import(/* @vite-ignore */ '../../src/conversation-outbox.ts');
    const reserve = OutboxStore.prototype.reserve;
    current.__reservesPending = 0; current.__reserveObserved = true;
    OutboxStore.prototype.reserve = async function (...args: Parameters<typeof reserve>) {
      current.__reservesPending!++;
      try { return await reserve.apply(this, args); } finally { current.__reservesPending!--; }
    };
  });
  const holder = await context.newPage();
  await holder.goto(`${runtime.url}/assets/zobba-symbol-color.svg`);
  await holder.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('zobba-conversation-recovery-v2', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('requests', 'readwrite');
      const current = window as RecoveryWindow;
      current.__recoveryTransaction = tx; current.__recoveryHeld = true;
      let released = false;
      const reads: Array<{ resolve: (items: OutboxItem[]) => void; reject: (reason: unknown) => void }> = [];
      current.__readRecovery = () => new Promise((resolve, reject) => reads.push({ resolve, reject }));
      current.__releaseRecovery = () => { released = true; };
      tx.oncomplete = () => { current.__recoveryHeld = false; db.close(); };
      tx.onabort = () => { current.__recoveryHeld = false; db.close(); reject(tx.error); };
      const keepAlive = () => {
        const read = tx.objectStore('requests').get('__test_holder__');
        read.onsuccess = () => {
          // A live transaction is active only in its request callback. Queue
          // observation here so the real write lock remains held throughout.
          for (const pending of reads.splice(0)) {
            const snapshot = tx.objectStore('requests').index('binding').getAll('actor-a/org-a/client-a/engagement-a/');
            snapshot.onerror = () => pending.reject(snapshot.error);
            snapshot.onsuccess = () => pending.resolve(snapshot.result.map(({ actor_id, scope, key, command, status }) => ({ actor_id, scope, key, command, status })).sort((a, b) => a.key.localeCompare(b.key)));
          }
          resolve(); if (!released) keepAlive();
        };
      };
      keepAlive();
    };
  }));
  heldRecoveryPage = holder;
  expect((await reservationCounts(holder)).held).toBe(1);
  return holder;
}
async function reservationCounts(holder: Page): Promise<{ held: number; pending: number }> {
  const held = await holder.evaluate(() => Number(!!(window as RecoveryWindow).__recoveryHeld));
  let pending = 0;
  for (const page of holder.context().pages()) if (!page.isClosed()) pending += await page.evaluate(() => (window as RecoveryWindow).__reservesPending ?? 0);
  return { held, pending };
}
async function releaseAdmissionTransaction(holder: Page): Promise<void> {
  if (heldRecoveryPage === holder) heldRecoveryPage = null;
  if (holder.isClosed()) return;
  await holder.evaluate(() => { (window as RecoveryWindow).__releaseRecovery?.(); });
  await expect.poll(() => holder.evaluate(() => !!(window as RecoveryWindow).__recoveryHeld)).toBe(false);
}

async function freezeProjection(page: Page, held: Promise<void>): Promise<void> {
  // Hold real polling, so accepted commands cannot reconcile the deliberately
  // lost acknowledgements before the recovery-capacity assertions inspect them.
  await page.route('**/api/engagements/engagement-a/conversation**', async route => {
    await held;
    await route.continue();
  });
}

test('R11 an actual IndexedDB transaction serializes near-quota tabs and preserves Pause/Stop slots', async ({ page, context }) => {
  await signIn(page);
  const pauseTarget = await createTarget(page, 'lock-pause-target', 'Real lock Pause target');
  const stopTarget = await createTarget(page, 'lock-stop-target', 'Real lock Stop target');
  await page.getByRole('button', { name: 'Latest messages', exact: true }).click();
  await expect(page.locator('.task-card')).toHaveCount(2);
  const second = await context.newPage();
  const projection = gate();
  let holder: Page | undefined;
  const attempted: TaskCommand[] = [];
  const accepted: TaskCommand[] = [];
  const lostAcknowledgement = async (route: Route) => {
    const command: TaskCommand = route.request().postDataJSON();
    attempted.push(command);
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    accepted.push(command);
    await route.abort('connectionreset');
  };
  try {
    await second.goto(page.url());
    await expect(second.getByText('Conversation up to date', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Open ${pauseTarget.objective}`, exact: true }).click();
    await second.getByRole('button', { name: `Open ${stopTarget.objective}`, exact: true }).click();

    // Arrange five earlier, unconfirmed client records through the actual store.
    // They establish no server acceptance and never receive fabricated receipts.
    await page.evaluate(async () => {
        const { OutboxStore } = await import(/* @vite-ignore */ '../../src/conversation-outbox.ts');
      const store = new OutboxStore('actor-a', { organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' });
      for (let index = 0; index < 5; index++) await store.reserve({
        key: `lock-retained-${index}`, kind: 'create', task_id: null, cycle_id: null, content: `Earlier unconfirmed objective ${index}`,
      });
    });
    const before = await saved(page);
    expect(before).toHaveLength(5);
    for (const tab of [page, second]) {
      await freezeProjection(tab, projection.held);
      await tab.route('**/api/engagements/engagement-a/task-commands?*', lostAcknowledgement);
      await tab.route('**/api/engagements/engagement-a/task-controls?*', lostAcknowledgement);
    }
    holder = await holdAdmissionTransaction(context);
    await page.getByLabel('Task objective', { exact: true }).fill('First competing ordinary admission');
    await second.getByLabel('Task objective', { exact: true }).fill('Second competing ordinary admission');
    await Promise.all([
      page.getByRole('button', { name: 'Send', exact: false }).click(),
      second.getByRole('button', { name: 'Send', exact: false }).click(),
    ]);
    // Rendezvous on both real reservation calls while the database transaction is held.
    // No storage request can commit until that actual transaction releases.
    await expect.poll(async () => (await reservationCounts(holder!)).pending === 2 ||
      (await saved(page)).length !== before.length || attempted.length > 0).toBe(true);
    if (mutation) expect(mutationApplications).toBeGreaterThan(0);
    expect(await saved(page), 'No new recovery record may be committed while another tab holds the database transaction.').toEqual(before);
    expect(attempted, 'No command may be transmitted before its durable storage transaction finishes.').toHaveLength(0);
    expect(await reservationCounts(holder)).toEqual({ held: 1, pending: 2 });
    expect((await snapshot(page)).messages).toHaveLength(2);

    await releaseAdmissionTransaction(holder);
    await expect.poll(() => reservationCounts(holder!)).toEqual({ held: 0, pending: 0 });
    await expect.poll(() => accepted.length).toBe(1);
    await expect.poll(async () => (await saved(page)).length).toBe(6);
    expect(attempted).toHaveLength(1);
    await expect(page.locator('.pending-message')).toHaveCount(6);
    await expect(second.locator('.pending-message')).toHaveCount(6);
    const ordinary = await saved(page);
    expect(ordinary.filter(item => item.command.kind === 'create')).toHaveLength(6);
    expect(ordinary.filter(item => item.key.startsWith('lock-retained-'))).toEqual(before);
    const winning = ordinary.find(item => !item.key.startsWith('lock-retained-'))!;
    expect(accepted[0]).toEqual(winning.command);

    await Promise.all([
      page.getByRole('button', { name: `Pause ${pauseTarget.objective} · current cycle ${pauseTarget.cycle_id.slice(0, 8)}`, exact: true }).click(),
      second.getByRole('button', { name: `Stop ${stopTarget.objective} · current cycle ${stopTarget.cycle_id.slice(0, 8)}`, exact: true }).click(),
    ]);
    await expect.poll(() => accepted.length).toBe(3);
    await expect.poll(async () => (await saved(page)).length).toBe(8);
    const full = await saved(page);
    expect(full.filter(item => item.command.kind === 'create')).toHaveLength(6);
    expect(full.filter(item => item.command.kind === 'pause')).toHaveLength(1);
    expect(full.filter(item => item.command.kind === 'stop')).toHaveLength(1);
    expect(new Set(full.map(item => item.key)).size).toBe(8);

    // A third control cannot overflow the two reserved positions either.
    await expect(page.getByRole('button', { name: `Pause ${pauseTarget.objective} · current cycle ${pauseTarget.cycle_id.slice(0, 8)}`, exact: true })).toBeEnabled();
    await page.getByRole('button', { name: `Pause ${pauseTarget.objective} · current cycle ${pauseTarget.cycle_id.slice(0, 8)}`, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Not sent');
    expect(await saved(page)).toEqual(full);
    expect(attempted).toHaveLength(3);
    const durable = await snapshot(page);
    expect(durable.messages).toHaveLength(5);
    for (const command of accepted) expect(durable.messages.filter(message => message.key === command.key)).toHaveLength(1);
    expect(durable.tasks.find(task => task.id === pauseTarget.id)?.state).toBe('paused');
    expect(durable.tasks.find(task => task.id === stopTarget.id)?.state).toBe('stopped');
  } finally {
    if (holder) await releaseAdmissionTransaction(holder);
    projection.release();
    for (const tab of [page, second]) await tab.unrouteAll({ behavior: 'wait' });
    await second.close();
    if (holder) await holder.close();
  }
});

test('R12 repeated Enter during an actual blocked reservation creates one key, POST and durable command', async ({ page, context }) => {
  await signIn(page);
  const projection = gate(), admission = gate(), acknowledgement = gate();
  const attempted: TaskCommand[] = [];
  const accepted: TaskCommand[] = [];
  const completedRoutes: Promise<void>[] = [];
  const holder = await holdAdmissionTransaction(context);
  await freezeProjection(page, projection.held);
  await page.route('**/api/engagements/engagement-a/task-commands?*', async route => {
    const completed = gate();
    completedRoutes.push(completed.held);
    try {
      const command: TaskCommand = route.request().postDataJSON();
      attempted.push(command);
      await admission.held;
      const response = await route.fetch();
      expect(response.status()).toBe(202);
      accepted.push(command);
      await acknowledgement.held;
      await route.fulfill({ response });
    } finally { completed.release(); }
  });
  try {
    const draft = page.getByLabel('Task objective', { exact: true });
    await draft.fill('Exactly one command from two Enter presses');
    await draft.press('Enter');
    await draft.press('Enter');
    await expect.poll(async () => (await reservationCounts(holder)).pending).toBeGreaterThan(0);
    expect(await saved(page)).toHaveLength(0);
    expect(attempted).toHaveLength(0);
    await expect(draft).toHaveValue('Exactly one command from two Enter presses');
    if (mutation) expect(mutationApplications).toBeGreaterThan(0);

    await releaseAdmissionTransaction(holder);
    await expect.poll(() => reservationCounts(holder)).toEqual({ held: 0, pending: 0 });
    await expect.poll(() => attempted.length).toBeGreaterThan(0);
    const persisted = await saved(page);
    expect(persisted, 'The synchronous submission guard must reserve exactly one key for repeated Enter.').toHaveLength(1);
    expect(attempted, 'Two Enter presses during storage admission must produce only one POST.').toHaveLength(1);
    expect(attempted[0]).toEqual(persisted[0]!.command);
    expect(new Set(attempted.map(command => command.key)).size).toBe(1);
    expect((await snapshot(page)).messages).toHaveLength(0);

    admission.release();
    await expect.poll(() => accepted.length).toBe(1);
    const durable = await snapshot(page);
    expect(durable.messages).toHaveLength(1);
    expect(durable.tasks).toHaveLength(1);
    expect(durable.messages[0]!.key).toBe(persisted[0]!.key);
    expect(durable.messages[0]!.content).toBe('Exactly one command from two Enter presses');
    expect(accepted[0]).toEqual(persisted[0]!.command);
    acknowledgement.release(); projection.release();
    await expect(page.locator('.task-card')).toHaveCount(1);
    await expect(draft).toHaveValue('');
    await expect.poll(async () => (await saved(page)).length).toBe(0);
    expect(attempted).toHaveLength(1);
  } finally {
    await releaseAdmissionTransaction(holder);
    admission.release(); acknowledgement.release(); projection.release();
    // A deliberately failing duplicate-Enter mutation can leave two actual
    // admissions in flight. Finish those owned handlers before removing routes.
    await Promise.all(completedRoutes);
    await page.unrouteAll({ behavior: 'wait' });
    await holder.close();
  }
});

test('R1 a reservation surviving same-scope revalidation hands off once without losing an independently edited draft', async ({ page, context }) => {
  await signIn(page);
  const transmitted: TaskCommand[] = [];
  await page.route('**/api/engagements/engagement-a/task-commands?*', async route => {
    transmitted.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    await route.fulfill({ response });
  });
  for (const editNext of [false, true]) {
    await test.step(editNext ? 'the independently edited next draft survives persistence and retry' : 'only the original unchanged draft clears after persistence', async () => {
      const previous = transmitted.length;
      const original = editNext ? 'Persist original meaning while next draft changes' : 'Persist original meaning across access revalidation';
      const nextDraft = 'Independent next draft must not be cleared';
      const holder = await holdAdmissionTransaction(context);
      try {
        const draft = page.getByLabel('Task objective', { exact: true });
        await draft.fill(original);
        await draft.press('Enter');
        await expect.poll(async () => (await reservationCounts(holder)).pending).toBe(1);
        expect(await saved(page)).toHaveLength(0);
        expect(transmitted).toHaveLength(previous);
        await expect(draft).toHaveValue(original);

        const revalidated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/session' && response.status() === 200);
        await page.getByRole('button', { name: 'Refresh access', exact: true }).click();
        await revalidated;
        await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
        expect(await reservationCounts(holder)).toEqual({ held: 1, pending: 1 });
        expect(await saved(page)).toHaveLength(0);
        await expect(draft).toHaveValue(original);
        if (editNext) await draft.fill(nextDraft);

        await releaseAdmissionTransaction(holder);
        await expect.poll(() => reservationCounts(holder)).toEqual({ held: 0, pending: 0 });
        await expect(page.locator('.pending-message')).toHaveCount(1);
        await expect(page.locator('.pending-message')).toContainText(original);
        await expect(page.locator('.pending-message')).toContainText('Delivery unconfirmed');
        const persisted = await saved(page);
        expect(persisted).toHaveLength(1);
        expect(persisted[0]!.command.content).toBe(original);
        expect(persisted[0]!.actor_id).toBe('actor-a');
        expect(persisted[0]!.scope).toEqual({ organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' });
        await expect(draft).toHaveValue(editNext ? nextDraft : '');
        expect(transmitted, 'Access changed while reservation awaited; the obsolete generation must not POST.').toHaveLength(previous);
        expect((await snapshot(page)).messages).toHaveLength(previous);

        await page.getByRole('button', { name: 'Check original request', exact: true }).click();
        await expect(page.locator('.pending-message')).toHaveCount(0);
        await expect(page.locator('.task-card')).toHaveCount(previous + 1);
        expect(transmitted).toHaveLength(previous + 1);
        expect(transmitted.at(-1)).toEqual(persisted[0]!.command);
        const durable = await snapshot(page);
        expect(durable.messages).toHaveLength(previous + 1);
        expect(durable.messages.filter(message => message.key === persisted[0]!.key)).toHaveLength(1);
        expect(await saved(page)).toHaveLength(0);
        await expect(draft).toHaveValue(editNext ? nextDraft : '');
      } finally {
        await releaseAdmissionTransaction(holder);
        await holder.close();
      }
    });
  }
  await page.unrouteAll({ behavior: 'wait' });
});


test('R11 global IndexedDB counts preserve four control places without reading other bindings', async ({ page }) => {
  await signIn(page);
  const counts = await page.evaluate(async () => {
    const { OutboxStore } = await import(/* @vite-ignore */ '../../src/conversation-outbox.ts');
    const scope = (index: number) => ({ organisation_id: 'org-a', client_id: 'client-a', engagement_id: `synthetic-recovery-${index}` });
    for (let index = 0; index < 10; index++) {
      const store = new OutboxStore('actor-a', scope(index));
      for (let key = 0; key < 6; key++) await store.reserve({ key: `global-${index}-${key}`, kind: 'create', content: `Synthetic unconfirmed recovery ${index}/${key}` });
    }
    const extra = new OutboxStore('actor-a', scope(10));
    let ordinaryRefused = false, controlRefused = false;
    try { await extra.reserve({ key: 'global-ordinary-overflow', kind: 'create', content: 'Must retain four control places' }); } catch { ordinaryRefused = true; }
    for (let index = 0; index < 4; index++) await extra.reserve({ key: `global-control-${index}`, kind: 'pause', task_id: `task-${index}`, cycle_id: 'cycle-a', content: null });
    try { await extra.reserve({ key: 'global-control-overflow', kind: 'stop', task_id: 'task-a', cycle_id: 'cycle-a', content: null }); } catch { controlRefused = true; }
    return { ordinaryRefused, controlRefused, original: (await new OutboxStore('actor-a', scope(0)).read()).length, controls: (await extra.read()).length };
  });
  expect(counts).toEqual({ ordinaryRefused: true, controlRefused: true, original: 6, controls: 4 });
  expect((await snapshot(page)).messages).toHaveLength(0);
});

test('a notification failure after IndexedDB commit cannot undo the send handoff', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { BroadcastChannel.prototype.postMessage = () => { throw new DOMException('Signal unavailable', 'InvalidStateError'); }; });
  const sent: TaskCommand[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/task-commands?')) sent.push(request.postDataJSON()); });
  await page.getByLabel('Task objective', { exact: true }).fill('Committed request survives notification failure');
  await page.getByLabel('Task objective', { exact: true }).press('Enter');
  await expect(page.locator('.task-card h3')).toHaveText('Committed request survives notification failure');
  await expect(page.getByLabel('Task objective', { exact: true })).toHaveValue('');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(sent).toHaveLength(1); expect(await saved(page)).toHaveLength(0);
  const durable = await snapshot(page); expect(durable.messages).toHaveLength(1); expect(durable.messages[0]!.key).toBe(sent[0]!.key);
});
