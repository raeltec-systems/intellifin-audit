import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';
import type { Session } from '../../src/auth';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration, restoreAndClose } from './cleanup';

// Browser plugin is unavailable. The owned browser uses the real HTTPS OIDC
// provider, cookie replacement, API and PostgreSQL; routes delay actual replies.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const restore = fixtureRestoration(['actor-a', 'actor-manager'], `
UPDATE public.identities SET active=true WHERE id IN ('actor-a','actor-manager');
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE actor_id='actor-a' AND organisation_id='org-a';
UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id='actor-a' AND organisation_id='org-a';`);
test.beforeAll(async () => { runtime = await startAuthRuntime(); });
test.beforeEach(async () => runtime.sqlAsync(restore()));
test.afterEach(async ({ context }) => {
  for (const page of context.pages()) await page.getByLabel('Password', { exact: true }).fill('', { timeout: 250 }).catch(() => {});
});
test.afterAll(async () => { if (runtime) await restoreAndClose(runtime, restore()); });

function gate() {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  return { held, release };
}
async function settleInitialImpact(page: Page) {
  await expect(page.getByRole('region', { name: 'Affected skill selections', exact: true })
    .getByText('No matching affected selections in this engagement.', { exact: true })).toBeVisible();
}
async function signIn(page: Page, account = 'auditor-a', replacing = false) {
  if (replacing) {
    await page.context().clearCookies({ domain: '127.0.0.1' });
    await page.goto(`${runtime.url}/api/auth/login`);
  } else {
    await page.goto(runtime.url);
    await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  }
  await page.getByLabel('Account', { exact: true }).selectOption(account);
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
}
async function session(page: Page): Promise<Session> {
  const response = await page.request.get(`${runtime.url}/api/auth/session`);
  expect(response.status()).toBe(200); return response.json();
}
async function savedOutbox(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const { OutboxStore } = await import(/* @vite-ignore */ '../../src/conversation-outbox.ts');
    const store = new OutboxStore('actor-a', { organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' });
    try { return JSON.stringify(await store.read()); } finally { store.close(); }
  });
}

test('a completed old session response cannot re-expose another account draft in the same engagement', async ({ page, context }, info) => {
  await signIn(page); await settleInitialImpact(page);
  const uncertainContent = 'Auditor A private retained uncertain request';
  // Exercise actual UI persistence and transmission failure, without accepting
  // a shared conversation message that the manager would legitimately see.
  await page.route('**/api/engagements/engagement-a/task-commands?*', route => route.abort('connectionreset'));
  await page.getByLabel('Task objective', { exact: true }).fill(uncertainContent);
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect(page.locator('.pending-message')).toContainText('Delivery unconfirmed');
  const originalOutbox = await savedOutbox(page);
  expect(JSON.parse(originalOutbox)).toHaveLength(1);
  expect(JSON.parse(originalOutbox)[0].command.content).toBe(uncertainContent);
  await page.unroute('**/api/engagements/engagement-a/task-commands?*');
  const privateDraft = 'Auditor A private unsent account-switch draft';
  await page.getByLabel('Task objective', { exact: true }).fill(privateDraft);
  const oldReply = gate(); let held = false, delivered = false, sessionReads = 0, posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/task-')) posts++; });
  await page.route('**/api/auth/session', async route => {
    if (Object.hasOwn(route.request().headers(), 'x-expected-session')) { await route.continue(); return; }
    sessionReads++;
    const response = await route.fetch();
    if (held) { await route.fulfill({ response }); return; }
    expect(response.status()).toBe(200);
    expect((await response.json()).identity.id).toBe('actor-a');
    held = true; await oldReply.held; await route.fulfill({ response }); delivered = true;
  });
  const replacement = await context.newPage();
  try {
    await page.getByRole('button', { name: 'Refresh access' }).click();
    await expect.poll(() => held).toBe(true);
    await expect(page.locator('.protected-workspace')).toBeHidden();
    await page.evaluate(({ draft, uncertain }) => {
      const leaks: string[] = [];
      const inspect = () => {
        const identity = document.querySelector<HTMLElement>('.identity');
        if (identity?.getClientRects().length && identity.innerText.includes('auditor-a')) leaks.push('old identity');
        if ([...document.querySelectorAll('textarea')].some(element => element.getClientRects().length && element.value === draft)) leaks.push('old draft');
        if ([...document.querySelectorAll<HTMLElement>('.pending-message')].some(element => element.getClientRects().length && element.innerText.includes(uncertain))) leaks.push('old recovery request');
      };
      const observer = new MutationObserver(inspect);
      observer.observe(document.body, { attributes: true, childList: true, subtree: true });
      inspect();
      Object.assign(window, { accountBindingEvidence: { leaks, observer } });
    }, { draft: privateDraft, uncertain: uncertainContent });
    await signIn(replacement, 'manager-a', true);
    expect((await session(replacement)).identity.id).toBe('actor-manager');
    expect(sessionReads).toBe(1);
    oldReply.release(); await expect.poll(() => delivered).toBe(true);
    await expect(page.locator('.identity')).toContainText('manager-a');
    await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Task objective', { exact: true })).toHaveValue('');
    const leaks = await page.evaluate(() => {
      const evidence = (window as unknown as { accountBindingEvidence: { leaks: string[]; observer: MutationObserver } }).accountBindingEvidence;
      evidence.observer.disconnect(); return evidence.leaks;
    });
    expect(leaks).toEqual([]); expect(posts).toBe(0);
    await expect(page.locator('.pending-message')).toHaveCount(0);
    expect(await savedOutbox(page)).toBe(originalOutbox);
    expect((await session(page)).identity.id).toBe('actor-manager');
    const screenshot = info.outputPath('account-binding-fixed.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await info.attach('account-binding-fixed', { path: screenshot, contentType: 'image/png' });
    await info.attach('account-binding-evidence', { body: JSON.stringify({ held_actor: 'actor-a', replacement_actor: 'actor-manager', same_engagement: true, sessionReads, posts, leaks }), contentType: 'application/json' });
  } finally { oldReply.release(); try { await page.unrouteAll({ behavior: 'wait' }); } finally { await replacement.close(); } }
});

test('same-account session rotation retains the hidden draft, mounted editor and focus after verification', async ({ page, context }) => {
  await signIn(page); await settleInitialImpact(page);
  const original = await session(page);
  const editor = page.getByLabel('Task objective', { exact: true });
  await editor.fill('Same actor private draft survives verified session rotation');
  await editor.evaluate(element => { element.dataset.retainedEditor = 'yes'; element.focus(); (element as HTMLTextAreaElement).setSelectionRange(5, 12); });
  const oldReply = gate(); let held = false;
  await page.route('**/api/auth/session', async route => {
    if (Object.hasOwn(route.request().headers(), 'x-expected-session')) { await route.continue(); return; }
    const response = await route.fetch();
    if (!held) { held = true; await oldReply.held; }
    await route.fulfill({ response });
  });
  const replacement = await context.newPage();
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => held).toBe(true); await expect(editor).toBeHidden();
    await signIn(replacement, 'auditor-a', true);
    const rotated = await session(replacement);
    expect(rotated.identity.id).toBe(original.identity.id); expect(rotated.csrf_token).not.toBe(original.csrf_token);
    oldReply.release();
    await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
    await expect(editor).toHaveValue('Same actor private draft survives verified session rotation');
    await expect(editor).toHaveAttribute('data-retained-editor', 'yes'); await expect(editor).toBeFocused();
    expect(await editor.evaluate(element => [(element as HTMLTextAreaElement).selectionStart, (element as HTMLTextAreaElement).selectionEnd])).toEqual([5, 12]);
  } finally { oldReply.release(); try { await page.unrouteAll({ behavior: 'wait' }); } finally { await replacement.close(); } }
});

test('every protected GET refuses an obsolete session without expiring the replacement cookie', async ({ page, context }) => {
  await signIn(page); const original = await session(page);
  const replacement = await context.newPage();
  try {
    await signIn(replacement, 'manager-a', true);
    const scope = 'organisation_id=org-a&client_id=client-a';
    for (const path of ['/auth/session', '/engagements', `/engagements/engagement-a?${scope}`,
      `/engagements/engagement-a/conversation?${scope}`, `/engagements/engagement-a/conversation/history?${scope}&through=0&before=1`,
      `/engagements/engagement-a/conversation/events?${scope}&after=0`, `/engagements/engagement-a/tasks?${scope}`,
      `/engagements/engagement-a/tasks/not-a-task?${scope}`, `/engagements/engagement-a/task-events?${scope}&after=0`]) {
      const response = await page.request.get(`${runtime.url}/api${path}`, { headers: { 'X-Expected-Session': original.csrf_token } });
      expect(response.status(), path).toBe(412); expect((await response.json()).error).toBe('session_changed');
      expect(response.headers()['set-cookie']).toBeUndefined();
    }
    const current = await session(page); expect(current.identity.id).toBe('actor-manager');
    const valid = await page.request.get(`${runtime.url}/api/engagements`, { headers: { 'X-Expected-Session': current.csrf_token } });
    expect(valid.status()).toBe(200);
  } finally { await replacement.close(); }
});

test('a delayed real unauthorized response cannot delete the newer manager session', async ({ page, context }) => {
  await signIn(page); await page.goto(`${runtime.url}/status`);
  runtime.sql("UPDATE public.sessions SET expires_at=1 WHERE actor_id='actor-a';");
  const oldReply = gate(); let held = false;
  await page.route('**/api/auth/session', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(401);
    held = true; await oldReply.held; await route.fulfill({ response });
  });
  const replacement = await context.newPage();
  try {
    await page.evaluate(() => { Object.assign(window, { staleSessionResult: fetch('/api/auth/session').then(response => response.status) }); });
    await expect.poll(() => held).toBe(true);
    await signIn(replacement, 'manager-a', true); expect((await session(replacement)).identity.id).toBe('actor-manager');
    oldReply.release();
    expect(await page.evaluate(() => (window as unknown as { staleSessionResult: Promise<number> }).staleSessionResult)).toBe(401);
    expect((await session(replacement)).identity.id).toBe('actor-manager');
  } finally { oldReply.release(); await replacement.close(); }
});

test('repeated real session mismatches stop after one retry and withdraw the private workspace', async ({ page }) => {
  await signIn(page); await settleInitialImpact(page); await page.getByLabel('Task objective', { exact: true }).fill('Never reveal an unstable session draft');
  let sessionReads = 0, mismatches = 0, posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/task-')) posts++; });
  try {
  await page.route('**/api/auth/session', async route => {
    if (Object.hasOwn(route.request().headers(), 'x-expected-session')) { await route.continue(); return; }
    const response = await route.fetch(); sessionReads++;
    // Rotate only the test session after its actual response was completed.
    runtime.sql(`UPDATE public.sessions SET csrf_token='rotation-${sessionReads}' WHERE actor_id='actor-a';`);
    await route.fulfill({ response });
  });
  await page.route('**/api/engagements', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(412); mismatches++;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Refresh access' }).click();
  await expect(page.getByRole('heading', { name: 'Connection interrupted' })).toBeVisible();
  expect(sessionReads).toBe(2); expect(mismatches).toBe(2); expect(posts).toBe(0);
  await expect(page.locator('.protected-workspace')).toHaveCount(0); await expect(page.locator('textarea')).toHaveCount(0);
  } finally { await page.unrouteAll({ behavior: 'wait' }); }
});

test('live conversation polling withdraws the old actor before recovering a replacement session', async ({ page, context }) => {
  await signIn(page); await settleInitialImpact(page);
  await page.getByLabel('Task objective', { exact: true }).fill('Live poll private draft');
  const pollGate = gate(), sessionGate = gate(); let pollHeld = false, sessionHeld = false, mismatch = false, posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/task-')) posts++; });
  await page.route('**/api/engagements/engagement-a/conversation/events?*', async route => {
    const response = await route.fetch();
    if (!pollHeld) {
      expect(response.status()).toBe(200); pollHeld = true; await pollGate.held;
      await route.fulfill({ response }); return;
    }
    if (mismatch) { await route.fulfill({ response }); return; }
    // This subsequent browser request sends the replacement cookie together
    // with the controller's retained old session binding.
    expect(response.status()).toBe(412); mismatch = true;
    await route.fulfill({ response });
  });
  await page.route('**/api/auth/session', async route => {
    if (Object.hasOwn(route.request().headers(), 'x-expected-session')) { await route.continue(); return; }
    const response = await route.fetch();
    if (!sessionHeld) { sessionHeld = true; await sessionGate.held; }
    await route.fulfill({ response });
  });
  const replacement = await context.newPage();
  try {
    await expect.poll(() => pollHeld).toBe(true);
    await signIn(replacement, 'manager-a', true);
    pollGate.release(); await expect.poll(() => sessionHeld).toBe(true);
    expect(mismatch).toBe(true);
    await expect(page.locator('.protected-workspace')).toBeHidden(); await expect(page.locator('.identity')).toBeHidden();
    sessionGate.release();
    await expect(page.locator('.identity')).toContainText('manager-a');
    await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Task objective', { exact: true })).toHaveValue(''); expect(posts).toBe(0);
  } finally { pollGate.release(); sessionGate.release(); try { await page.unrouteAll({ behavior: 'wait' }); } finally { await replacement.close(); } }
});

test('conversation mismatches after successful engagement reads share one bounded recovery budget', async ({ page }) => {
  await signIn(page); await page.getByLabel('Task objective', { exact: true }).fill('Do not loop or expose this unstable draft');
  const impacts = page.getByRole('region', { name: 'Affected skill selections', exact: true });
  // Settle the initial projection, including its bound session verification,
  // before counting this deliberately unstable App recovery composition.
  await expect(impacts.getByText('No matching affected selections in this engagement.', { exact: true })).toBeVisible();
  let sessionReads = 0, boundVerifications = 0, scopeReads = 0, mismatches = 0, posts = 0;
  let conversationInjectionArmed = false;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/task-')) posts++; });
  await page.route('**/api/auth/session', async route => {
    // App bootstrap reads are unbound; current projection postchecks carry the
    // expected-session header. Count presence only, never record its value.
    if (Object.hasOwn(route.request().headers(), 'x-expected-session')) boundVerifications++;
    else sessionReads++;
    await route.continue();
  });
  await page.route('**/api/engagements/engagement-a?*', async route => {
    scopeReads++;
    // A finite fuse makes the negative-control run fail safely if the old
    // cross-layer loop returns; successful repair never reaches this cutoff.
    if (scopeReads > 4) { await route.abort('connectionreset'); return; }
    const response = await route.fetch(); expect(response.status()).toBe(200);
    runtime.sql(`UPDATE public.sessions SET csrf_token='post-scope-rotation-${scopeReads}' WHERE actor_id='actor-a';`);
    conversationInjectionArmed = true;
    await route.fulfill({ response });
  });
  await page.route('**/api/engagements/engagement-a/conversation?*', async route => {
    const injected = conversationInjectionArmed;
    const response = await route.fetch();
    if (injected) { expect(response.status()).toBe(412); mismatches++; }
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Refresh access' }).click();
  await expect(page.getByRole('heading', { name: 'Connection interrupted' })).toBeVisible();
  expect(sessionReads).toBe(2); expect(boundVerifications).toBe(0); expect(scopeReads).toBe(2); expect(mismatches).toBe(2); expect(posts).toBe(0);
  await expect(page.locator('.protected-workspace')).toHaveCount(0); await expect(page.locator('textarea')).toHaveCount(0);
  // Automatic browser lifecycle events cannot replenish an exhausted budget.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    for (const value of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value });
      document.dispatchEvent(new Event('visibilitychange'));
    }
    Reflect.deleteProperty(document, 'visibilityState');
  });
  expect(sessionReads).toBe(2); expect(boundVerifications).toBe(0);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
  await page.unroute('**/api/engagements/engagement-a?*'); await page.unroute('**/api/engagements/engagement-a/conversation?*');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  expect(sessionReads).toBe(3); await expect(page.getByLabel('Task objective', { exact: true })).toHaveValue('');
  await expect(impacts.getByText('No matching affected selections in this engagement.', { exact: true })).toBeVisible();
  expect(sessionReads).toBe(3); expect(boundVerifications).toBe(1); expect(posts).toBe(0);
});

test('read preconditions cannot change ordinary command, reserved control or logout CSRF contracts', async ({ page }) => {
  await signIn(page); const current = await session(page);
  const scope = 'organisation_id=org-a&client_id=client-a';
  const headers = { Origin: runtime.url, 'X-CSRF-Token': current.csrf_token, 'X-Expected-Actor': current.identity.id, 'X-Expected-Session': 'irrelevant-old-read-binding' };
  const create = await page.request.post(`${runtime.url}/api/engagements/engagement-a/task-commands?${scope}`, {
    headers, data: { key: crypto.randomUUID(), kind: 'create', content: 'Mutation read-header contract proof' },
  });
  expect(create.status()).toBe(202); const receipt = await create.json();
  const control = { key: crypto.randomUUID(), kind: 'stop', task_id: receipt.task_id, cycle_id: receipt.cycle_id };
  expect((await page.request.post(`${runtime.url}/api/engagements/engagement-a/task-controls?${scope}`, { headers, data: control })).status()).toBe(202);
  expect((await page.request.post(`${runtime.url}/api/engagements/engagement-a/task-controls?${scope}`, { headers: { ...headers, 'X-CSRF-Token': 'wrong' }, data: control })).status()).toBe(403);
  expect((await page.request.post(`${runtime.url}/api/auth/logout`, { headers: { ...headers, 'X-CSRF-Token': 'wrong' } })).status()).toBe(403);
  expect((await page.request.post(`${runtime.url}/api/auth/logout`, { headers })).status()).toBe(204);
  expect((await page.request.get(`${runtime.url}/api/auth/session`)).status()).toBe(401);
});

test('an engagement mismatch and a later conversation mismatch consume the same recovery allowance', async ({ page }, info) => {
  const started = Date.now(), chronology: Record<string, unknown>[] = [];
  let phase = 'sign-in';
  const record = (event: string, detail: Record<string, unknown> = {}) => {
    if (chronology.length < 200) chronology.push({ sequence: chronology.length + 1, elapsedMs: Date.now() - started, phase, event, ...detail });
  };
  let sessionReads = 0, boundSessionReads = 0, scopeReads = 0, refusals = 0, engagementMismatches = 0, conversationMismatches = 0, posts = 0;
  let conversationInjectionArmed = false, ordinaryConversationReads = 0;
  const initialImpact = gate(); let impactHeld = false, boundSessionCompleted = false;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/task-')) posts++; });
  try {
  // Deliberately deliver the real initial impact response after installing the
  // App fault gate. Its bound postcheck must complete without consuming that
  // gate's first unbound read or rotating the session before Refresh access.
  await page.route('**/api/engagements/engagement-a/skills/impacts?*', async route => {
    const response = await route.fetch(); record('initial-impact-response', { status: response.status() }); expect(response.status()).toBe(200);
    impactHeld = true; await initialImpact.held; await route.fulfill({ response }); record('initial-impact-delivered');
  });
  await signIn(page); phase = 'installing-routes'; record('sign-in-complete');
  await expect.poll(() => impactHeld).toBe(true);
  await page.route('**/api/auth/session', async route => {
    const bound = Object.hasOwn(route.request().headers(), 'x-expected-session');
    record('session-request', { bound });
    const response = await route.fetch(); record('session-response', { bound, status: response.status() });
    if (bound) {
      boundSessionReads++; expect(response.status()).toBe(200); await route.fulfill({ response });
      boundSessionCompleted = true; record('bound-session-delivered', { boundSessionReads }); return;
    }
    sessionReads++;
    record('session-count', { bound, sessionReads });
    if (sessionReads === 1) {
      record('scope-rotation-before', { bound, sessionReads });
      runtime.sql("UPDATE public.sessions SET csrf_token='mixed-scope-rotation' WHERE actor_id='actor-a';");
      record('scope-rotation-after', { bound, sessionReads });
    }
    await route.fulfill({ response });
  });
  await page.route('**/api/engagements', async route => {
    record('engagements-request', { bound: Object.hasOwn(route.request().headers(), 'x-expected-session') });
    const response = await route.fetch();
    record('engagements-response', { status: response.status() });
    if (response.status() === 412) { refusals++; engagementMismatches++; }
    await route.fulfill({ response });
  });
  await page.route('**/api/engagements/engagement-a?*', async route => {
    record('scope-request', { bound: Object.hasOwn(route.request().headers(), 'x-expected-session') });
    const response = await route.fetch(); record('scope-response', { status: response.status() }); expect(response.status()).toBe(200); scopeReads++;
    record('conversation-rotation-before', { scopeReads });
    runtime.sql("UPDATE public.sessions SET csrf_token='mixed-conversation-rotation' WHERE actor_id='actor-a';");
    conversationInjectionArmed = true;
    record('conversation-rotation-after', { scopeReads });
    await route.fulfill({ response });
  });
  await page.route('**/api/engagements/engagement-a/conversation?*', async route => {
    // Capture causality at entry: a normal poll already in flight cannot become
    // an injected refusal merely because a later scoped response rotates access.
    const injected = conversationInjectionArmed;
    record('conversation-request', { bound: Object.hasOwn(route.request().headers(), 'x-expected-session'), injected });
    const response = await route.fetch(); record('conversation-response', { status: response.status(), injected });
    if (injected) { expect(response.status()).toBe(412); refusals++; conversationMismatches++; }
    else if (response.status() === 200) ordinaryConversationReads++;
    await route.fulfill({ response });
  });
  phase = 'releasing-initial-impact'; initialImpact.release();
  await expect.poll(() => boundSessionCompleted).toBe(true);
  expect(boundSessionReads).toBe(1); expect(sessionReads).toBe(0); expect(scopeReads).toBe(0); expect(refusals).toBe(0);
  // Exercise the real UI's ordinary controller poll before the App injection.
  // This genuine200 must pass through the same handler without consuming412s.
  phase = 'ordinary-conversation-poll'; const ordinaryReadsBefore = ordinaryConversationReads;
  await page.getByRole('button', { name: 'Latest messages', exact: true }).click();
  await expect.poll(() => ordinaryConversationReads).toBeGreaterThan(ordinaryReadsBefore);
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  expect(boundSessionReads).toBe(1); expect(sessionReads).toBe(0); expect(scopeReads).toBe(0); expect(refusals).toBe(0);
  phase = 'refresh'; record('refresh-click-before');
  await page.getByRole('button', { name: 'Refresh access' }).click();
  phase = 'waiting-for-interruption'; record('refresh-click-after');
  await expect(page.getByRole('heading', { name: 'Connection interrupted' })).toBeVisible();
  expect(sessionReads).toBe(2); expect(scopeReads).toBe(1); expect(refusals).toBe(2);
  expect(boundSessionReads).toBe(1); expect(engagementMismatches).toBe(1); expect(conversationMismatches).toBe(1); expect(posts).toBe(0);
  await expect(page.locator('.protected-workspace')).toHaveCount(0);
  } finally {
    phase = 'cleanup'; record('cleanup-before', { sessionReads, boundSessionReads, scopeReads, refusals, engagementMismatches, conversationMismatches, ordinaryConversationReads, posts });
    initialImpact.release();
    try { await page.unrouteAll({ behavior: 'wait' }); }
    finally {
      record('cleanup-after', { sessionReads, boundSessionReads, scopeReads, refusals, engagementMismatches, conversationMismatches, ordinaryConversationReads, posts });
      // Endpoint categories, header presence and status only: no header values,
      // query strings, cookies, response bodies or session material is retained.
      const name = 'mixed-recovery-chronology.json', path = info.outputPath(name);
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(chronology, null, 2));
      await info.attach(name, { path, contentType: 'application/json' });
    }
  }
});
