import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { Page, Request, Response } from '@playwright/test';
import type { Session } from '../../src/auth';
import type { ConversationMessage } from '../../src/conversation';
import type { Scope } from '../../src/engagements';
import type { Evidence } from '../../src/evidence';
import type { KnowledgeCommand, KnowledgePage, KnowledgeReceipt, PreferenceSnapshot } from '../../src/knowledge';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration, restoreAndClose } from './cleanup';

// Real OIDC/API/PostgreSQL/object storage. Interception only delays or loses
// actual responses, except the explicitly labelled transport/capacity failures.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const browserDiagnostics = new WeakMap<Page, string[]>();
const scope: Scope = { organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' };
const query = 'organisation_id=org-a&client_id=client-a';
const restore = fixtureRestoration(['actor-manager', 'actor-a'], `
UPDATE public.identities SET active=true WHERE id IN ('actor-manager','actor-a');
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['audit_manager','admin'] WHERE organisation_id='org-a' AND actor_id='actor-manager';
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE organisation_id='org-a' AND actor_id='actor-a';
UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id IN ('actor-manager','actor-a');
`);
test.beforeAll(async () => { runtime = await startAuthRuntime({ evidence: true }); await runtime.stopWorker(); });
test.beforeEach(async ({ page }) => {
  const entries: string[] = []; browserDiagnostics.set(page, entries);
  const append = (entry: string) => { if (entries.length < 300) entries.push(entry.replace(/https?:\/\/[^\s)'\"]+/g, raw => { try { const url = new URL(raw); return `${url.origin}${url.pathname}`; } catch { return '[URL omitted]'; } })); };
  page.on('pageerror', error => append(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') append(`console: ${message.text()}`); });
  page.on('requestfailed', request => append(`requestfailed: ${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText}`));
  page.on('response', response => { if (response.status() >= 400) append(`response: ${response.status()} ${new URL(response.url()).pathname}`); });
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    const health = runtime ? await page.request.get(`${runtime.url}/api/health/ready`, { timeout: 3000 }).then(response => response.status()).catch(() => 'unreachable') : 'not-started';
    await info.attach('knowledge-browser-diagnostics', { contentType: 'application/json', body: JSON.stringify({ location: page.url().split('?')[0], errors: browserDiagnostics.get(page), health, processes: runtime?.processStatus() }, null, 2) });
  }
  await page.unrouteAll({ behavior: 'wait' }); if (runtime) await runtime.sqlAsync(restore());
});
test.afterAll(async () => { if (runtime) await restoreAndClose(runtime, restore()); });

async function signIn(page: Page, account: 'manager-a' | 'auditor-a' = 'manager-a') {
  const started = Date.now();
  const caller = new Error().stack?.split('\n').slice(2).map(line => line.match(/knowledge\.spec\.ts:(\d+):(\d+)/)).find(Boolean);
  const location = (raw: string) => {
    try {
      const url = new URL(raw, runtime.url);
      const knownOrigin = [new URL(runtime.url).origin, new URL(runtime.issuer).origin].includes(url.origin);
      const provider = url.origin === new URL(runtime.issuer).origin;
      const providerPath = ['/', '/auth', '/token', '/jwks', '/.well-known/openid-configuration'].includes(url.pathname)
        ? url.pathname : url.pathname.startsWith('/interaction/') ? '/interaction/[opaque]' : '[provider-path]';
      return { path: knownOrigin ? provider ? providerPath : url.pathname.slice(0, 512) : '[other-origin]', auth_error: url.searchParams.has('auth_error') };
    } catch { return { path: '[unavailable]', auth_error: false }; }
  };
  const callbacks: { path: string; status: number; location_path: string; auth_error: boolean; elapsed_ms: number }[] = [];
  const pageErrors: { name: string; source_paths: string[]; elapsed_ms: number }[] = [];
  const failedRequests: { method: string; path: string; failure: string; elapsed_ms: number }[] = [];
  const onResponse = (response: Response) => {
    const requestLocation = location(response.url());
    if (requestLocation.path !== '/api/auth/callback' || callbacks.length >= 5) return;
    const destination = location(response.headers()['location'] ?? response.url());
    callbacks.push({ path: requestLocation.path, status: response.status(), location_path: destination.path, auth_error: destination.auth_error, elapsed_ms: Date.now() - started });
  };
  const onPageError = (error: Error) => {
    if (pageErrors.length >= 20) return;
    // Record error categories and source paths only: arbitrary messages/stacks
    // can embed callback URLs, OAuth values or application-private text.
    const name = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'].includes(error.name) ? error.name : 'Error';
    const paths = [...(error.stack ?? '').matchAll(/https?:\/\/[^\s)'"]+/g)].slice(0, 3).map(match => location(match[0]).path);
    pageErrors.push({ name, source_paths: paths, elapsed_ms: Date.now() - started });
  };
  const onRequestFailed = (request: Request) => {
    if (failedRequests.length >= 40) return;
    const failure = request.failure()?.errorText.match(/(?:net::)?ERR_[A-Z0-9_]+/)?.[0] ?? 'request-failed';
    failedRequests.push({ method: request.method(), path: location(request.url()).path, failure, elapsed_ms: Date.now() - started });
  };
  page.on('response', onResponse); page.on('pageerror', onPageError); page.on('requestfailed', onRequestFailed);
  try {
    await page.goto(`${runtime.url}/api/auth/login`); await page.getByLabel('Account', { exact: true }).selectOption(account);
    await page.getByLabel('Password', { exact: true }).fill(runtime.password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your engagements', exact: true })).toBeVisible();
  } catch (reason) {
    try {
      const failedAt = location(page.url()), elapsed = Date.now() - started;
      const results = await Promise.allSettled([
        page.request.get(`${runtime.url}/api/auth/session`, { timeout: 3000, maxRedirects: 0 }),
        page.request.get(`${runtime.url}/api/health/ready`, { timeout: 3000, maxRedirects: 0 }),
      ]);
      const status = (index: number) => { const result = results[index]; return result?.status === 'fulfilled' ? result.value.status() : 'unreachable'; };
      // Attach inside this caller before an auxiliary reader's finally can close
      // its context. Never read response bodies, cookies or OAuth query values.
      await test.info().attach('knowledge-signin-diagnostics', { contentType: 'application/json', body: JSON.stringify({
        account, caller: caller ? { file: 'knowledge.spec.ts', line: Number(caller[1]), column: Number(caller[2]) } : null,
        elapsed_ms: elapsed, location_path: failedAt.path, auth_error: failedAt.auth_error,
        callbacks, page_errors: pageErrors, request_failures: failedRequests,
        auth_session_status: status(0), readiness_status: status(1), processes: runtime.processStatus(),
      }, null, 2) });
    } finally { throw reason; }
  } finally {
    page.off('response', onResponse); page.off('pageerror', onPageError); page.off('requestfailed', onRequestFailed);
  }
}
async function session(page: Page): Promise<Session> { const response = await page.request.get(`${runtime.url}/api/auth/session`); expect(response.status()).toBe(200); return response.json(); }
async function headers(page: Page) { const current = await session(page); return { Origin: runtime.url, 'X-CSRF-Token': current.csrf_token, 'X-Expected-Actor': current.identity.id, 'X-Expected-Session': current.csrf_token }; }
async function preferences(page: Page): Promise<PreferenceSnapshot> { const response = await page.request.get(`${runtime.url}/api/knowledge/organisations/org-a/preference`); expect(response.status()).toBe(200); return response.json(); }
async function resetPreference(page: Page) {
  const existing = await preferences(page); if (!existing.current) return;
  const response = await page.request.post(`${runtime.url}/api/knowledge/organisations/org-a/preference`, { headers: await headers(page), data: { key: crypto.randomUUID(), expected_revision: existing.revision, action: { kind: 'undo', target: { id: existing.current.record.id, revision: existing.current.record.revision } } } }); expect(response.status()).toBe(200);
}
async function knowledge(page: Page, task: string, target = scope, inactive = false): Promise<KnowledgePage> { const response = await page.request.get(`${runtime.url}/api/engagements/${target.engagement_id}/tasks/${task}/knowledge?organisation_id=${target.organisation_id}&client_id=${target.client_id}&include_inactive=${inactive}`); expect(response.status()).toBe(200); return response.json(); }
async function openTask(page: Page, objective: string) { await page.getByRole('button', { name: `Open ${objective}`, exact: true }).click(); await expect(page.getByRole('region', { name: 'Scoped working knowledge', exact: true }).getByRole('button', { name: 'Record an assertion', exact: true })).toBeEnabled(); }
function unavailableBrowserBody(reason: unknown): boolean { return reason instanceof Error && reason.message.includes('Protocol error (Network.getResponseBody): No data found for resource with given identifier'); }
function storedCommandRevisions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(storedCommandRevisions);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, field]) => {
    if (['revision', 'expected_revision', 'expected_source_revision'].includes(key) && typeof field === 'number') {
      expect(Number.isSafeInteger(field) && field >= 0).toBe(true);
      return [key, String(field)];
    }
    return [key, storedCommandRevisions(field)];
  }));
}
async function knowledgeReceipt(page: Page, response: Response): Promise<KnowledgeReceipt> {
  expect(response.status()).toBe(200);
  try { return await response.json(); } catch (reason) {
    if (!unavailableBrowserBody(reason)) throw reason;
    const posted = response.request().postDataJSON() as KnowledgeCommand;
    const actor = response.request().headers()['x-expected-actor']; expect(actor).toBeTruthy();
    const url = new URL(response.url()), task = url.pathname.split('/tasks/')[1]!.split('/')[0]!;
    expect(url.pathname).toBe(`/api/engagements/${scope.engagement_id}/tasks/${task}/knowledge/commands`);
    expect(url.searchParams.get('organisation_id')).toBe(scope.organisation_id); expect(url.searchParams.get('client_id')).toBe(scope.client_id);
    const accepted = runtime.readKnowledgeEvent(scope, actor!, posted.key) as { event_id: string; command: { scope: object; task_id: string; command: KnowledgeCommand }; receipt: { event_id: string; revision: number; record_reference: { id: string; revision: number }; affected_ids: string[]; affected_destinations: string[] } };
    expect(accepted).toBeTruthy();
    expect(storedCommandRevisions(accepted.command)).toEqual({ scope: { kind: 'engagement', ...scope, owner_id: null }, task_id: task, command: posted });
    expect(accepted.event_id).toBe(accepted.receipt.event_id);
    const reference = accepted.receipt.record_reference; expect(reference).toBeTruthy();
    const current = await page.request.get(`${runtime.url}/api/engagements/${scope.engagement_id}/tasks/${task}/knowledge/records/${reference.id}/revisions/${reference.revision}?${query}`);
    expect(current.status()).toBe(200); const record = await current.json();
    expect(record).toMatchObject({ status: 'current', record: { id: reference.id, revision: String(reference.revision), actor_id: actor } });
    if (posted.action.kind === 'assert' || posted.action.kind === 'correct') expect(record.record).toMatchObject(posted.action.assertion);
    await expect(page.getByText(`Recorded change ${accepted.event_id}. Original history is retained; current eligibility is checked again.`, { exact: true })).toBeVisible();
    await expect(page.getByRole('article', { name: `Knowledge ${reference.id}`, exact: true }).getByText(record.record.text, { exact: true })).toBeVisible();
    return { event_id: accepted.event_id, revision: String(accepted.receipt.revision), record, affected_ids: accepted.receipt.affected_ids, affected_destinations: accepted.receipt.affected_destinations };
  }
}
async function createTask(page: Page, objective: string) {
  await page.getByRole('button', { name: /FY2026 audit/ }).click(); await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  await page.getByLabel('Task objective', { exact: true }).fill(objective);
  const accepted = page.waitForResponse(response => response.url().includes('/task-commands?') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /^Send/ }).click(); const response = await accepted; expect(response.status()).toBe(202);
  let taskId: string;
  try { taskId = (await response.json()).task_id; } catch (reason) {
    if (!unavailableBrowserBody(reason)) throw reason;
    const posted = response.request().postDataJSON(); expect(posted).toMatchObject({ kind: 'create', content: objective, task_id: null, cycle_id: null });
    const actor = response.request().headers()['x-expected-actor']; expect(actor).toBeTruthy();
    let matching: ConversationMessage | undefined;
    await expect.poll(async () => { const current = await page.request.get(`${runtime.url}/api/engagements/engagement-a/conversation?${query}`); expect(current.status()).toBe(200); const snapshot = await current.json(); expect(snapshot.scope).toEqual(scope); matching = snapshot.messages.find((message: ConversationMessage) => message.key === posted.key && message.author_id === actor); return matching !== undefined; }).toBe(true);
    expect(matching).toMatchObject({ key: posted.key, author_id: actor, kind: posted.kind, content: posted.content, target_task_id: posted.task_id, target_cycle_id: posted.cycle_id }); expect(matching!.context ?? null).toEqual(posted.context ?? null); taskId = matching!.task_id;
  }
  await openTask(page, objective); return taskId;
}
async function recordAssertion(page: Page, text: string) {
  const panel = page.getByRole('region', { name: 'Scoped working knowledge', exact: true });
  await panel.getByRole('button', { name: 'Record an assertion', exact: true }).click(); const form = panel.getByRole('form', { name: 'Working knowledge change', exact: true });
  await form.getByRole('textbox', { name: 'Assertion text', exact: true }).fill(text);
  const response = page.waitForResponse(response => response.url().includes('/knowledge/commands?') && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Record knowledge change', exact: true }).click(); const committed = await response; expect(committed.status()).toBe(200);
  const receipt = await knowledgeReceipt(page, committed); await expect(panel.getByText(text, { exact: true })).toBeVisible(); return receipt.record!;
}
async function acquire(page: Page, name: string, content: Buffer, sourceAssertion?: string): Promise<Evidence> {
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles({ name, mimeType: 'text/plain', buffer: content });
  if (sourceAssertion) { await page.getByText('Source assertions (optional)', { exact: true }).click(); await page.getByLabel('Known coverage', { exact: true }).fill(sourceAssertion); }
  const registered = page.waitForResponse(response => /\/evidence-reservations\/[^/]+\/upload\?/.test(response.url()) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click(); await registered;
  await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible();
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence?${query}`); expect(response.status()).toBe(200);
  return (await response.json()).items.find((e: Evidence) => e.reservation.request.filename === name);
}

test('real distinct Expand openings learn privately, apply later, and Undo consumes old observations', async ({ page }, info) => {
  await signIn(page); await resetPreference(page); const objective = 'Learn a harmless inspection default'; await createTask(page, objective);
  const observations: object[] = []; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/preference/observations')) observations.push(request.postDataJSON()); });
  for (let i = 0; i < 2; i++) {
    await expect(page.getByRole('region', { name: 'Your inspection preference', exact: true }).locator('details > summary').first()).toBeVisible();
    const recorded = page.waitForResponse(response => response.url().endsWith('/preference/observations') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Expand', exact: true }).click(); expect((await recorded).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Reduce', exact: true })).toBeEnabled();
    if (i === 0) { await page.getByRole('button', { name: 'Close inspection', exact: true }).click(); await openTask(page, objective); }
  }
  await expect(page.getByText('Learned from your display choices', { exact: true })).toBeVisible();
  const learned = await preferences(page); expect(learned.current?.record.preference).toMatchObject({ value: 'expanded', inferred: true }); expect(learned.current?.record.preference?.observation_ids).toHaveLength(2);
  expect(observations).toHaveLength(2); expect(new Set(observations.map(event => (event as { opening_id: string }).opening_id)).size).toBe(2);
  await page.getByRole('button', { name: 'Close inspection', exact: true }).click(); await openTask(page, objective); await expect(page.getByRole('button', { name: 'Reduce', exact: true })).toBeVisible(); expect(observations).toHaveLength(2);
  await page.getByText('Learned from your display choices', { exact: true }).click(); await page.getByText('Inspect preference basis', { exact: true }).click();
  await page.screenshot({ path: info.outputPath('knowledge-learned-preference.png') });
  const undo = page.waitForResponse(response => response.url().endsWith('/preference') && response.request().method() === 'POST'); await page.getByRole('button', { name: 'Undo remembered preference', exact: true }).click(); expect((await undo).status()).toBe(200);
  await expect.poll(async () => (await preferences(page)).current).toBeNull();
  for (const original of observations) { const response = await page.request.post(`${runtime.url}/api/knowledge/organisations/org-a/preference/observations`, { headers: await headers(page), data: original }); expect([200, 409]).toContain(response.status()); }
  expect((await preferences(page)).current).toBeNull();
  await page.getByRole('button', { name: 'Close inspection', exact: true }).click(); await openTask(page, objective); await expect(page.getByRole('button', { name: 'Expand', exact: true })).toBeVisible(); expect(observations).toHaveLength(2);
});

test('exact typed release is useful to another assigned reader without private preference events', async ({ page, browser }) => {
  await signIn(page); await resetPreference(page); await createTask(page, 'Release an optional layout setting');
  const own = page.getByRole('region', { name: 'Your inspection preference', exact: true }); await own.locator('details > summary').first().click();
  await own.getByRole('button', { name: 'Remember expanded layout', exact: true }).click(); await expect(own.getByText('Your saved display choice', { exact: true })).toBeVisible();
  await own.getByText('Release this exact layout value', { exact: true }).click(); await own.getByRole('button', { name: 'Load assigned destinations', exact: true }).click(); await own.getByRole('combobox', { name: 'Preference destination', exact: true }).selectOption('engagement-a');
  const released = page.waitForResponse(response => response.url().endsWith('/preference') && response.request().method() === 'POST'); await own.getByRole('button', { name: 'Release exact layout value', exact: true }).click(); expect((await released).status()).toBe(200);
  const ownSnapshot = await preferences(page), publication = ownSnapshot.publications.find(p => p.status === 'current'); expect(publication).toBeTruthy();
  const context = await browser.newContext({ ignoreHTTPSErrors: true }); const recipient = await context.newPage();
  try {
    await signIn(recipient, 'auditor-a'); const task = await createTask(recipient, 'Use explicitly released optional context'); const result = await knowledge(recipient, task);
    const shared = result.items.find(v => v.record.id === publication!.record.id); expect(shared?.record.preference).toMatchObject({ value: 'expanded', inferred: false, observation_ids: [] }); expect(shared?.record.scope.kind).toBe('engagement'); expect(shared?.record.dependencies).toEqual([]);
    expect(JSON.stringify(shared)).not.toContain(ownSnapshot.current!.record.id);
    await expect(recipient.getByRole('article', { name: `Knowledge ${publication!.record.id}`, exact: true })).toBeVisible();
    await recipient.getByRole('article', { name: `Knowledge ${publication!.record.id}`, exact: true }).getByRole('button', { name: 'Apply released layout to this opening', exact: true }).click(); await expect(recipient.getByRole('button', { name: 'Reduce', exact: true })).toBeVisible();
    await own.getByRole('button', { name: 'Undo remembered preference', exact: true }).click();
    await expect.poll(async () => (await knowledge(recipient, task)).items.some(v => v.record.id === publication!.record.id)).toBe(false);
    await recipient.getByRole('button', { name: 'Refresh working knowledge', exact: true }).click(); await expect(recipient.getByRole('article', { name: `Knowledge ${publication!.record.id}`, exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test('verified acquisition and Guide automatically project distinct attributable knowledge with exact source navigation', async ({ page }, info) => {
  await signIn(page); const objective = 'Inspect automatic scoped source knowledge', task = await createTask(page, objective);
  const content = Buffer.from('\ufeff  Source says 😀\r\nExact second line.\r\n', 'utf8'); const filename = `knowledge-source-${crypto.randomUUID()}.txt`;
  const original = await acquire(page, filename, content, 'Auditor asserts this is the selected sample');
  await expect(page.getByRole('region', { name: 'Source working knowledge', exact: true }).getByRole('button', { name: 'Check or recover automatic source capture', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Return to conversation and Task', exact: true }).click();
  await page.getByRole('button', { name: 'Guide this Task', exact: true }).click(); await page.getByLabel('Guidance', { exact: true }).fill('Keep the limitation with this original source.');
  const guided = page.waitForResponse(response => response.url().includes('/task-controls?') && response.request().method() === 'POST'); await page.getByRole('button', { name: /^Send/ }).click(); expect((await guided).status()).toBe(202);
  await page.getByRole('button', { name: 'Refresh working knowledge', exact: true }).click();
  const stored = await knowledge(page, task); const observed = stored.items.find(v => v.record.kind === 'observation' && v.record.source?.evidence_id === original.reservation.id)!;
  expect(observed.record.text).toBe(content.toString('utf8')); expect(observed.record.source).toMatchObject({ byte_start: 0, byte_end: content.length, original_size: content.length, partial: false, digest: original.reservation.request.identity.sha256 });
  expect(stored.items.some(v => v.record.kind === 'assertion' && v.record.source?.field_path === 'source.coverage' && v.record.text === 'Auditor asserts this is the selected sample')).toBe(true);
  expect(stored.items.some(v => v.record.kind === 'decision' && v.record.direction?.task_id === task && v.record.text === 'Keep the limitation with this original source.')).toBe(true);
  const card = page.getByRole('article', { name: `Knowledge ${observed.record.id}`, exact: true }); await expect(card).toBeVisible(); await card.getByText('Inspect knowledge basis', { exact: true }).click(); await card.getByRole('button', { name: 'Inspect original source', exact: true }).click(); await expect(card.locator('.evidence-preview')).toHaveText(content.toString('utf8'));
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: /Workspace · 1/ }).click();
  const sourcePreview = card.locator('.evidence-preview'); await sourcePreview.scrollIntoViewIfNeeded();
  await expect(sourcePreview).toBeInViewport({ ratio: 1 });
  expect((await page.getByRole('region', { name: 'Task inspection reading area', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(240);
  await expect(page.getByRole('button', { name: /^Pause Inspect automatic scoped source knowledge/ })).toBeInViewport();
  await expect(page.getByRole('button', { name: /^Stop Inspect automatic scoped source knowledge/ })).toBeInViewport();
  await expect(page.getByRole('button', { name: '← All engagements', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const geometry = {
    viewport: page.viewportSize(), documentWidth: await page.evaluate(() => document.documentElement.scrollWidth),
    readingArea: await page.getByRole('region', { name: 'Task inspection reading area', exact: true }).boundingBox(),
    sourcePreview: await sourcePreview.boundingBox(), sourceText: await sourcePreview.textContent(),
    engagementHeading: await page.getByRole('heading', { name: 'FY2026 audit', exact: true }).boundingBox(),
    backNavigation: await page.getByRole('button', { name: '← All engagements', exact: true }).boundingBox(),
    pause: await page.getByRole('button', { name: /^Pause Inspect automatic scoped source knowledge/ }).boundingBox(),
    stop: await page.getByRole('button', { name: /^Stop Inspect automatic scoped source knowledge/ }).boundingBox(),
    assertionsPassed: ['exact registered source text', 'source preview fully in viewport', 'reading area at least 240px', 'Pause and Stop in viewport', 'engagement navigation in viewport', 'no horizontal overflow'],
  };
  await page.screenshot({ path: info.outputPath('knowledge-narrow-source-inspection.png') });
  await writeFile(info.outputPath('knowledge-narrow-geometry.json'), JSON.stringify(geometry, null, 2));
});

test('assertion correction, exclusion and forget retain original attributable history', async ({ page }) => {
  await signIn(page); const task = await createTask(page, 'Correct retained working knowledge');
  const first = await recordAssertion(page, 'Initial management assertion');
  const card = page.getByRole('article', { name: `Knowledge ${first.record.id}`, exact: true }); await card.getByRole('button', { name: 'Correct assertion', exact: true }).click();
  const form = page.getByRole('form', { name: 'Working knowledge change', exact: true }); await form.getByRole('textbox', { name: 'Assertion text', exact: true }).fill('Corrected management assertion'); await form.getByRole('textbox', { name: 'Knowledge change reason', exact: true }).fill('The author corrected the earlier account.');
  const corrected = page.waitForResponse(response => response.url().includes('/knowledge/commands?') && response.request().method() === 'POST'); await form.getByRole('button', { name: 'Record knowledge change', exact: true }).click(); const receipt = await knowledgeReceipt(page, await corrected);
  expect(receipt.record?.record.supersedes).toEqual({ id: first.record.id, revision: first.record.revision }); const successor = page.getByRole('article', { name: `Knowledge ${receipt.record!.record.id}`, exact: true }); await expect(successor.getByText('Corrected management assertion', { exact: true })).toBeVisible();
  expect(receipt.record?.record.revision).toBe((BigInt(first.record.revision) + 1n).toString()); await successor.getByText('Inspect knowledge basis', { exact: true }).click(); await expect(successor.getByText(`${first.record.id} · revision ${receipt.record!.record.revision}`, { exact: true })).toBeVisible();
  await successor.getByRole('button', { name: 'Exclude from future context', exact: true }).click(); await form.getByRole('textbox', { name: 'Knowledge change reason', exact: true }).fill('Not applicable to future preparation.'); await form.getByRole('button', { name: 'Record knowledge change', exact: true }).click(); await expect(successor).toHaveCount(0);
  const forgotten = await recordAssertion(page, 'Temporary context to forget'); const forgetCard = page.getByRole('article', { name: `Knowledge ${forgotten.record.id}`, exact: true }); await forgetCard.getByRole('button', { name: 'Forget working context', exact: true }).click(); await form.getByRole('textbox', { name: 'Knowledge change reason', exact: true }).fill('Withdraw this context.'); await form.getByRole('button', { name: 'Record knowledge change', exact: true }).click(); await expect(forgetCard).toHaveCount(0);
  await page.getByLabel('Inspect retained inactive history', { exact: true }).check();
  const historical = await knowledge(page, task, scope, true); expect(historical.items.find(v => v.record.id === first.record.id)).toMatchObject({ status: 'excluded', record: { revision: receipt.record!.record.revision, text: 'Corrected management assertion' } }); expect(historical.items.find(v => v.record.id === forgotten.record.id)?.status).toBe('forgotten');
  const exact = await page.request.get(`${runtime.url}/api/engagements/engagement-a/tasks/${task}/knowledge/records/${first.record.id}/revisions/${first.record.revision}?${query}`); expect(exact.status()).toBe(200); expect(await exact.json()).toMatchObject({ status: 'corrected', record: { id: first.record.id, revision: first.record.revision, text: 'Initial management assertion' } });
});

test('actual session outage remount preserves exact unsent draft only after its own current read', async ({ page }) => {
  await signIn(page); const objective = 'Recover exact private assertion draft'; await createTask(page, objective); let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/knowledge/commands?')) posts++; });
  await page.getByRole('button', { name: 'Record an assertion', exact: true }).click(); const form = page.getByRole('form', { name: 'Working knowledge change', exact: true }); const exact = '  Unsent private assertion\n😀 unchanged';
  await form.getByRole('textbox', { name: 'Assertion text', exact: true }).fill(exact); await form.getByLabel('Known uncertainty', { exact: true }).fill('Still unverified'); await form.evaluate(element => element.setAttribute('data-original-knowledge-draft', 'true'));
  await page.route('**/api/auth/session', route => {
    // Only App's session refresh loses transport. Independent source/receipt
    // postchecks retain their real answers and cannot trigger this fixture.
    if (Object.hasOwn(route.request().headers(), 'x-expected-session')) return route.continue();
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily_unavailable"}' });
  });
  await page.getByRole('button', { name: 'Refresh access', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Connection interrupted', exact: true })).toBeVisible(); await expect(page.locator('[data-original-knowledge-draft]')).toHaveCount(0);
  await page.unroute('**/api/auth/session'); await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible(); await page.getByRole('button', { name: `Open ${objective}`, exact: true }).click();
  await expect(form.getByRole('textbox', { name: 'Assertion text', exact: true })).toHaveValue(exact); await expect(form.getByLabel('Known uncertainty', { exact: true })).toHaveValue('Still unverified'); expect(posts).toBe(0);
  const privateStorage = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join('\n')); expect(privateStorage).not.toContain(exact);
  await form.getByRole('button', { name: 'Cancel knowledge change', exact: true }).click(); await expect(form).toHaveCount(0);
});

test('lost mutation reply and temporary retry capacity preserve one exact command through recovery', async ({ page }) => {
  await signIn(page); const objective = 'Recover one exact working knowledge command', task = await createTask(page, objective);
  const posted: string[] = []; let firstReceipt: KnowledgeReceipt | null = null;
  await page.route('**/api/engagements/*/tasks/*/knowledge/commands?*', async route => {
    posted.push(route.request().postData()!);
    if (posted.length === 2) { await route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"knowledge_capacity"}' }); return; }
    const response = await route.fetch(); expect(response.status()).toBe(200); const receipt: KnowledgeReceipt = await response.json();
    if (posted.length === 1) { firstReceipt = receipt; await route.abort('connectionreset'); } else { expect(receipt).toEqual(firstReceipt); await route.fulfill({ response }); }
  });
  await page.getByRole('button', { name: 'Record an assertion', exact: true }).click(); const form = page.getByRole('form', { name: 'Working knowledge change', exact: true }); await form.getByRole('textbox', { name: 'Assertion text', exact: true }).fill('Retain exactly once despite a lost acknowledgement.'); await form.getByRole('button', { name: 'Record knowledge change', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Retry exact knowledge request', exact: true }); await expect(retry).toBeEnabled(); await expect(form.getByRole('textbox', { name: 'Assertion text', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'All engagements', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Your engagements', exact: true })).toBeVisible(); await expect(retry).toHaveCount(0); expect(posted).toHaveLength(1);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let captured = false;
  const currentRead = `**/api/engagements/engagement-a/tasks/${task}/knowledge?*`;
  await page.route(currentRead, async route => { const response = await route.fetch(); expect(response.status()).toBe(200); captured = true; await held; await route.fulfill({ response }); });
  try {
    await page.getByRole('button', { name: /FY2026 audit/ }).click(); await page.getByRole('button', { name: `Open ${objective}`, exact: true }).click(); await expect.poll(() => captured).toBe(true);
    await expect(retry).toBeHidden(); await expect(form).toBeHidden(); expect(posted).toHaveLength(1);
    release(); await expect(retry).toBeEnabled(); await expect(form.getByRole('textbox', { name: 'Assertion text', exact: true })).toBeDisabled();
  } finally { release(); await page.unroute(currentRead); }
  await retry.click(); await expect(retry).toBeEnabled(); await expect(form.getByRole('textbox', { name: 'Assertion text', exact: true })).toBeDisabled(); await retry.click(); await expect(retry).toHaveCount(0);
  expect(posted).toHaveLength(3); expect(posted[1]).toBe(posted[0]); expect(posted[2]).toBe(posted[0]);
  await expect(page.getByText('Retain exactly once despite a lost acknowledgement.', { exact: true })).toBeVisible();
  const durable = runtime.readKnowledgeEvent(scope, 'actor-manager', JSON.parse(posted[0]!).key) as { event_id: string }; expect(durable.event_id).toBe(firstReceipt!.event_id);
  expect((await knowledge(page, task)).items.filter(item => item.record.id === firstReceipt!.record!.record.id)).toHaveLength(1);
});

test('held successful knowledge response cannot restore a corrected assertion after fresh verification', async ({ page }) => {
  await signIn(page); const task = await createTask(page, 'Fence knowledge disclosure after its source changes');
  const original = await recordAssertion(page, 'Protected assertion before correction');
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let captured = false;
  const pattern = `**/api/engagements/engagement-a/tasks/${task}/knowledge?*`;
  await page.route(pattern, async route => { const response = await route.fetch(); expect(response.status()).toBe(200); captured = true; await held; await route.fulfill({ response }); });
  try {
    await page.getByRole('button', { name: 'Refresh working knowledge', exact: true }).click(); await expect.poll(() => captured).toBe(true);
    const current = await knowledge(page, task);
    const correction = await page.request.post(`${runtime.url}/api/engagements/engagement-a/tasks/${task}/knowledge/commands?${query}`, { headers: await headers(page), data: { key: crypto.randomUUID(), expected_revision: current.revision, action: { kind: 'correct', target: { id: original.record.id, revision: original.record.revision }, assertion: { text: 'Current corrected assertion', period: { start: null, end: null }, uncertainty: null, dependencies: [] }, reason: 'Corrected while the old response was in transit.' } } }); expect(correction.status()).toBe(200);
    release(); await expect(page.getByText('Current working knowledge is unavailable. Refresh to check its basis.', { exact: true })).toBeVisible(); await expect(page.getByRole('article', { name: `Knowledge ${original.record.id}`, exact: true })).toHaveCount(0);
  } finally { release(); await page.unroute(pattern); }
  await page.getByRole('button', { name: 'Refresh working knowledge', exact: true }).click(); await expect(page.getByText('Current corrected assertion', { exact: true })).toBeVisible();
});

test('source correction declares exact immutable replacement and invalidates derived context', async ({ page }) => {
  await signIn(page); const task = await createTask(page, 'Declare a registered original correction');
  const first = await acquire(page, `source-before-${crypto.randomUUID()}.txt`, Buffer.from('Superseded original source.'));
  await page.getByRole('button', { name: 'Return to conversation and Task', exact: true }).click();
  const replacement = await acquire(page, `source-after-${crypto.randomUUID()}.txt`, Buffer.from('Corrected registered source.'));
  await page.getByRole('button', { name: 'Return to conversation and Task', exact: true }).click(); await page.getByRole('button', { name: 'Refresh working knowledge', exact: true }).click();
  const source = (await knowledge(page, task)).items.find(v => v.record.kind === 'observation' && v.record.source?.evidence_id === first.reservation.id)!;
  const card = page.getByRole('article', { name: `Knowledge ${source.record.id}`, exact: true });
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let captured = false;
  const pattern = `**/api/engagements/engagement-a/knowledge/evidence/${first.reservation.id}?*`;
  await page.route(pattern, async route => { const response = await route.fetch(); expect(response.status()).toBe(200); captured = true; await held; await route.fulfill({ response }); });
  try {
    await card.getByRole('button', { name: 'Declare original source correction', exact: true }).click(); await expect.poll(() => captured).toBe(true);
    const form = page.getByRole('form', { name: 'Working knowledge change', exact: true }), replacementField = form.getByLabel('Replacement registered original ID', { exact: true }), reason = form.getByRole('textbox', { name: 'Knowledge change reason', exact: true });
    // These edits happen before the real status response arrives. Source metadata
    // may initialize its revision only; it cannot replace the current form text.
    await replacementField.fill(replacement.reservation.id); await reason.fill('The provider explicitly replaced this registered original.');
    await expect(form.getByRole('button', { name: 'Record knowledge change', exact: true })).toBeDisabled(); release();
    await expect(form.getByRole('button', { name: 'Record knowledge change', exact: true })).toBeEnabled();
    await expect(replacementField).toHaveValue(replacement.reservation.id); await expect(reason).toHaveValue('The provider explicitly replaced this registered original.');
    const committed = page.waitForResponse(response => response.url().includes('/knowledge/commands?') && response.request().method() === 'POST');
    await form.getByRole('button', { name: 'Record knowledge change', exact: true }).click(); const response = await committed; expect(response.status()).toBe(200);
    expect(response.request().postDataJSON().action).toMatchObject({ kind: 'correct_source', predecessor_id: first.reservation.id, replacement_id: replacement.reservation.id, reason: 'The provider explicitly replaced this registered original.' });
    await expect(card).toHaveCount(0);
  } finally { release(); await page.unroute(pattern); }
  const status = await page.request.get(`${runtime.url}/api/engagements/engagement-a/knowledge/evidence/${first.reservation.id}?${query}`); expect(status.status()).toBe(200); expect(await status.json()).toMatchObject({ replacement_id: replacement.reservation.id, correction_actor_id: 'actor-manager', correction_reason: 'The provider explicitly replaced this registered original.' });
  const before = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence/${first.reservation.id}/download?${query}`); expect(before.status()).toBe(200); expect((await before.body()).toString()).toBe('Superseded original source.');
  const after = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence/${replacement.reservation.id}/download?${query}`); expect(after.status()).toBe(200); expect((await after.body()).toString()).toBe('Corrected registered source.');
});

test('named same-client reuse serves the destination and independently checks reader and accountable Task owner', async ({ page, browser }) => {
  test.setTimeout(150000);
  const destination: Scope = { ...scope, engagement_id: `knowledge-reuse-${crypto.randomUUID()}` };
  await runtime.sqlAsync(`BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('org-a',205));
INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','${destination.engagement_id}','Knowledge same-client destination');
INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','${destination.engagement_id}','actor-manager'),('org-a','client-a','${destination.engagement_id}','actor-a');
COMMIT;`);
  const readerContext = await browser.newContext({ ignoreHTTPSErrors: true }); const reader = await readerContext.newPage();
  try {
    await signIn(page); const sourceTask = await createTask(page, 'Explicitly reuse working context in one later Task'); const original = await recordAssertion(page, 'Same-client source assertion for exact named reuse');
    const created = await page.request.post(`${runtime.url}/api/engagements/${destination.engagement_id}/task-commands?${query}`, { headers: await headers(page), data: { key: crypto.randomUUID(), kind: 'create', task_id: null, cycle_id: null, content: 'Named destination with the manager accountable' } }); expect(created.status()).toBe(202); const destinationTask = (await created.json()).task_id as string;
    expect((await knowledge(page, destinationTask, destination)).items.some(v => v.record.id === original.record.id)).toBe(false);
    await page.getByRole('article', { name: `Knowledge ${original.record.id}`, exact: true }).getByRole('button', { name: 'Reuse in named Task', exact: true }).click();
    const form = page.getByRole('form', { name: 'Working knowledge change', exact: true }); await form.getByLabel('Destination engagement ID', { exact: true }).fill(destination.engagement_id); await form.getByLabel('Destination Task ID', { exact: true }).fill(destinationTask); await form.getByRole('textbox', { name: 'Knowledge change reason', exact: true }).fill('Reuse this exact assertion in the named same-client preparation.');
    await form.getByRole('button', { name: 'Record knowledge change', exact: true }).click(); await expect(form).toHaveCount(0);
    const reused = (await knowledge(page, destinationTask, destination)).items.find(v => v.record.id === original.record.id); expect(reused?.record).toEqual(original.record);
    await signIn(reader, 'auditor-a'); await reader.goto(`${runtime.url}/?organisation_id=org-a&client_id=client-a&engagement_id=${destination.engagement_id}`); await openTask(reader, 'Named destination with the manager accountable');
    const foreignCard = reader.getByRole('article', { name: `Knowledge ${original.record.id}`, exact: true }); await expect(foreignCard).toBeVisible();
    await expect(foreignCard.getByRole('button', { name: 'Correct assertion', exact: true })).toHaveCount(0); await expect(foreignCard.getByRole('button', { name: 'Reuse in named Task', exact: true })).toHaveCount(0);
    await expect(foreignCard.getByRole('button', { name: 'Exclude from future context', exact: true })).toBeEnabled(); await expect(foreignCard.getByRole('button', { name: 'Forget working context', exact: true })).toBeEnabled();
    // The reader remains assigned to the destination. Origin loss is independent.
    await runtime.sqlAsync(`BEGIN; SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('org-a',205)); UPDATE public.engagement_assignments SET active=false WHERE organisation_id='org-a' AND client_id='client-a' AND engagement_id='engagement-a' AND actor_id='actor-a'; COMMIT;`);
    expect((await knowledge(reader, destinationTask, destination)).items.some(v => v.record.id === original.record.id)).toBe(false);
    await reader.getByRole('button', { name: 'Refresh working knowledge', exact: true }).click(); await expect(reader.getByRole('article', { name: `Knowledge ${original.record.id}`, exact: true })).toHaveCount(0);
    // Restoring the viewer does not lend that viewer's access to the Task owner.
    await runtime.sqlAsync(`BEGIN; SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('org-a',205)); UPDATE public.engagement_assignments SET active=true WHERE organisation_id='org-a' AND client_id='client-a' AND engagement_id='engagement-a' AND actor_id='actor-a'; UPDATE public.engagement_assignments SET active=false WHERE organisation_id='org-a' AND client_id='client-a' AND engagement_id='engagement-a' AND actor_id='actor-manager'; COMMIT;`);
    expect((await knowledge(reader, destinationTask, destination)).items.some(v => v.record.id === original.record.id)).toBe(false);
    const deniedSource = await page.request.get(`${runtime.url}/api/engagements/engagement-a/tasks/${sourceTask}/knowledge?${query}&include_inactive=false`); expect(deniedSource.status()).toBe(403);
  } finally {
    await readerContext.close();
    await runtime.sqlAsync(restore(`
DELETE FROM public.knowledge_withdrawals WHERE organisation_id='org-a' AND publication_id IN (SELECT id FROM public.knowledge_publications WHERE organisation_id='org-a' AND engagement_id='${destination.engagement_id}');
DELETE FROM public.knowledge_publications WHERE organisation_id='org-a' AND engagement_id='${destination.engagement_id}';
DELETE FROM public.task_methodology_changes WHERE organisation_id='org-a' AND task_id IN (SELECT id FROM public.tasks WHERE organisation_id='org-a' AND engagement_id='${destination.engagement_id}');
DELETE FROM public.task_methodology_heads WHERE organisation_id='org-a' AND task_id IN (SELECT id FROM public.tasks WHERE organisation_id='org-a' AND engagement_id='${destination.engagement_id}');
DELETE FROM public.task_methodology_bindings WHERE organisation_id='org-a' AND engagement_id='${destination.engagement_id}';
DELETE FROM public.task_deliveries WHERE wakeup_id IN (SELECT id FROM public.task_wakeups WHERE organisation_id='org-a' AND engagement_id='${destination.engagement_id}');
DELETE FROM public.task_wakeups WHERE organisation_id='org-a' AND engagement_id='${destination.engagement_id}';
DELETE FROM public.task_events WHERE organisation_id='org-a' AND engagement_id='${destination.engagement_id}';
DELETE FROM public.task_commands WHERE organisation_id='org-a' AND engagement_id='${destination.engagement_id}';
DELETE FROM public.task_cycles WHERE organisation_id='org-a' AND engagement_id='${destination.engagement_id}';
DELETE FROM public.tasks WHERE organisation_id='org-a' AND engagement_id='${destination.engagement_id}';
DELETE FROM public.task_counters WHERE organisation_id='org-a' AND engagement_id='${destination.engagement_id}';
DELETE FROM public.engagement_assignments WHERE organisation_id='org-a' AND engagement_id='${destination.engagement_id}';
DELETE FROM public.engagements WHERE organisation_id='org-a' AND id='${destination.engagement_id}';
`));
  }
});

async function addDestination(id: string, name: string) {
  await runtime.sqlAsync(`BEGIN; SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('org-a',205));
INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','${id}','${name}');
INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','${id}','actor-manager'),('org-a','client-a','${id}','actor-a'); COMMIT;`);
}

test('assertion support can be added and replaced through current originals and exact knowledge while old basis stays inspectable', async ({ page }, info) => {
  await signIn(page); const task = await createTask(page, 'Correct an assertion and its exact claimed support');
  const first = await acquire(page, `support-first-${crypto.randomUUID()}.txt`, Buffer.from('First claimed support.'));
  await page.getByRole('button', { name: 'Return to conversation and Task', exact: true }).click();
  const second = await acquire(page, `support-second-${crypto.randomUUID()}.txt`, Buffer.from('Replacement claimed support.'));
  await page.getByRole('button', { name: 'Return to conversation and Task', exact: true }).click(); await page.getByRole('button', { name: 'Refresh working knowledge', exact: true }).click();
  const secondSupport = (await knowledge(page, task)).items.find(item => item.record.source?.evidence_id === second.reservation.id && item.record.kind === 'observation')!;
  await page.getByRole('button', { name: 'Record an assertion', exact: true }).click(); const form = page.getByRole('form', { name: 'Working knowledge change', exact: true });
  await form.getByRole('textbox', { name: 'Assertion text', exact: true }).fill('Actor interpretation supported by the first original.');
  await form.getByRole('button', { name: 'Load current registered originals', exact: true }).click();
  await form.getByRole('combobox', { name: 'Current registered originals', exact: true }).selectOption(first.reservation.id);
  await form.getByRole('button', { name: 'Verify and add source reference', exact: true }).click();
  await expect(form.getByRole('list', { name: 'Draft source references', exact: true })).toContainText(first.reservation.id);
  const accepted = page.waitForResponse(response => response.url().includes('/knowledge/commands?') && response.request().method() === 'POST'); await form.getByRole('button', { name: 'Record knowledge change', exact: true }).click();
  const acceptedResponse = await accepted;
  const actualScope = acceptedResponse.request().postDataJSON().action.assertion.dependencies[0].scope;
  const wire = { method: acceptedResponse.request().method(), action: 'assert', status: acceptedResponse.status(), dependency_scope_keys: Object.keys(actualScope).sort() };
  const wirePath = info.outputPath('knowledge-support-wire.json'); await writeFile(wirePath, JSON.stringify(wire, null, 2)); await info.attach('knowledge-support-wire', { path: wirePath, contentType: 'application/json' });
  expect(wire.dependency_scope_keys).toEqual(['client_id', 'engagement_id', 'kind', 'organisation_id', 'owner_id']);
  expect(actualScope).toEqual({ kind: 'engagement', ...scope, owner_id: null });
  const original = (await knowledgeReceipt(page, acceptedResponse)).record!;
  expect(original.record.dependencies).toEqual([{ kind: 'evidence', evidence_id: first.reservation.id, storage_version: first.version, digest: first.reservation.request.identity.sha256, scope: { kind: 'engagement', ...scope, owner_id: null } }]);
  const card = page.getByRole('article', { name: `Knowledge ${original.record.id}`, exact: true }); await card.getByRole('button', { name: 'Correct assertion', exact: true }).click();
  await expect(form.getByRole('list', { name: 'Draft source references', exact: true })).toContainText(first.reservation.id);
  await form.getByRole('button', { name: 'Remove source reference 1', exact: true }).click();
  await form.getByRole('combobox', { name: 'Support type', exact: true }).selectOption('knowledge');
  await form.getByRole('combobox', { name: 'Current working knowledge support', exact: true }).selectOption(secondSupport.record.id);
  await form.getByRole('button', { name: 'Verify and add source reference', exact: true }).click();
  await expect(form.getByRole('list', { name: 'Draft source references', exact: true })).toContainText(secondSupport.record.id);
  await expect(form.getByRole('list', { name: 'Draft source references', exact: true })).not.toContainText(first.reservation.id);
  await form.getByRole('textbox', { name: 'Assertion text', exact: true }).fill('Corrected interpretation with replacement support.');
  await form.getByRole('textbox', { name: 'Knowledge change reason', exact: true }).fill('The earlier citation was wrong.');
  const correction = page.waitForResponse(response => response.url().includes('/knowledge/commands?') && response.request().method() === 'POST'); await form.getByRole('button', { name: 'Record knowledge change', exact: true }).click();
  const changed = (await knowledgeReceipt(page, await correction)).record!;
  expect(changed.record.supersedes).toEqual({ id: original.record.id, revision: original.record.revision });
  expect(changed.record.dependencies).toEqual([{ kind: 'knowledge', id: secondSupport.record.id, revision: secondSupport.record.revision, scope: secondSupport.record.scope }]);
  await expect(card).toContainText('Corrected interpretation with replacement support.'); await card.getByText('Inspect knowledge basis', { exact: true }).click(); await expect(card.getByRole('list', { name: 'Exact knowledge dependencies', exact: true })).toContainText(secondSupport.record.id);
  await page.getByText('Inspect an exact record beyond this page', { exact: true }).click(); await page.getByLabel('Exact knowledge record ID', { exact: true }).fill(original.record.id); await page.getByLabel('Exact knowledge revision', { exact: true }).fill(original.record.revision); await page.getByRole('button', { name: 'Inspect exact knowledge', exact: true }).click();
  const historical = page.locator('.knowledge-exact').getByRole('article', { name: `Knowledge ${original.record.id}`, exact: true }); await expect(historical).toContainText(original.record.text); await historical.getByText('Inspect knowledge basis', { exact: true }).click(); await expect(historical.getByRole('list', { name: 'Exact knowledge dependencies', exact: true })).toContainText(first.reservation.id);
  const retained = await page.request.get(`${runtime.url}/api/engagements/engagement-a/tasks/${task}/knowledge/records/${original.record.id}/revisions/${original.record.revision}?${query}`); expect(retained.status()).toBe(200); expect((await retained.json()).record.dependencies).toEqual(original.record.dependencies);
});

test('local layout stays usable while one exact observation is uncertain and recovery creates no competing events', async ({ page }) => {
  await signIn(page); await resetPreference(page); await createTask(page, 'Retain an uncertain display observation');
  const posted: string[] = []; let initial: PreferenceSnapshot | null = null;
  await page.route('**/api/knowledge/organisations/org-a/preference/observations', async route => {
    posted.push(route.request().postData()!); const response = await route.fetch(); expect(response.status()).toBe(200); const actual = await response.json();
    if (posted.length === 1) { initial = actual; await route.abort('connectionreset'); } else { expect(actual).toEqual(initial); await route.fulfill({ response }); }
  });
  await page.getByRole('button', { name: 'Expand', exact: true }).click(); const retry = page.getByRole('button', { name: 'Retry exact display choice', exact: true }); await expect(retry).toBeEnabled();
  await page.getByRole('button', { name: 'Reduce', exact: true }).click(); await expect(page.locator('.conversation-workspace')).not.toHaveClass(/inspection-expanded/);
  await page.getByRole('button', { name: 'Expand', exact: true }).click(); await expect(page.locator('.conversation-workspace')).toHaveClass(/inspection-expanded/);
  await page.getByRole('button', { name: 'Reduce', exact: true }).click(); expect(posted).toHaveLength(1);
  await retry.click(); await expect(retry).toHaveCount(0); expect(posted).toHaveLength(2); expect(posted[1]).toBe(posted[0]); await expect(page.getByRole('button', { name: 'Expand', exact: true })).toBeVisible();
  expect((await preferences(page)).current).toBeNull();
});

test('private preference offers its supported Undo and retained outcome names every released destination exactly once', async ({ page }) => {
  const destination = `preference-outcome-${crypto.randomUUID()}`; await addDestination(destination, 'Preference outcome destination');
  await signIn(page); await resetPreference(page); const task = await createTask(page, 'Inspect attributable preference withdrawal results');
  const own = page.getByRole('region', { name: 'Your inspection preference', exact: true }); await own.locator('details > summary').first().click(); await own.getByRole('button', { name: 'Remember expanded layout', exact: true }).click(); await expect(own.getByText('Your saved display choice', { exact: true })).toBeVisible();
  const saved = (await preferences(page)).current!; await page.getByRole('button', { name: 'Refresh working knowledge', exact: true }).click(); const privateCard = page.getByRole('article', { name: `Knowledge ${saved.record.id}`, exact: true });
  await expect(privateCard).toBeVisible(); await expect(privateCard.getByRole('button', { name: 'Forget working context', exact: true })).toHaveCount(0); await expect(own.getByRole('button', { name: 'Undo remembered preference', exact: true })).toBeEnabled(); expect((await knowledge(page, task)).items.find(item => item.record.id === saved.record.id)?.can_forget).toBe(false);
  await own.getByText('Release this exact layout value', { exact: true }).click();
  for (const [index, target] of ['engagement-a', destination].entries()) {
    const selector = own.getByRole('combobox', { name: 'Preference destination', exact: true });
    if (index === 1) {
      let releaseList!: () => void; const heldList = new Promise<void>(resolve => { releaseList = resolve; }); let listCaptured = false, listDelivered = false;
      await page.route('**/api/engagements', async route => { const response = await route.fetch(); expect(response.status()).toBe(200); listCaptured = true; await heldList; await route.fulfill({ response }); listDelivered = true; });
      try {
        await own.getByRole('button', { name: 'Load assigned destinations', exact: true }).click(); await expect.poll(() => listCaptured).toBe(true);
        await expect(selector).toHaveCount(0); await expect(own.getByRole('button', { name: 'Release exact layout value', exact: true })).toHaveCount(0);
        releaseList(); await expect.poll(() => listDelivered).toBe(true); await selector.selectOption(target); await expect(selector).toHaveValue(target);
      } finally { releaseList(); await page.unrouteAll({ behavior: 'wait' }); }
    } else { await own.getByRole('button', { name: 'Load assigned destinations', exact: true }).click(); await selector.selectOption(target); }
    await expect(own.getByRole('button', { name: 'Release exact layout value', exact: true })).toBeEnabled();
    const accepted = page.waitForResponse(response => response.url().endsWith('/preference') && response.request().method() === 'POST'); await own.getByRole('button', { name: 'Release exact layout value', exact: true }).click(); expect((await accepted).status()).toBe(200);
    await expect.poll(async () => (await preferences(page)).publications.some(item => item.status === 'current' && item.record.scope.engagement_id === target)).toBe(true);
    await expect(own).toContainText(`client-a / ${target} · current`);
  }
  const posted: string[] = []; let first: KnowledgeReceipt | null = null;
  let releaseCurrent!: () => void; const currentHeld = new Promise<void>(resolve => { releaseCurrent = resolve; }); let holdCurrent = false, currentCaptured = false;
  await page.route('**/api/knowledge/organisations/org-a/preference/verify', async route => { const response = await route.fetch(); expect(response.status()).toBe(200); if (holdCurrent) { currentCaptured = true; await currentHeld; } await route.fulfill({ response }); });
  await page.route('**/api/knowledge/organisations/org-a/preference', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    expect(route.request().postDataJSON().action.kind).toBe('undo'); posted.push(route.request().postData()!); const response = await route.fetch(); expect(response.status()).toBe(200); const receipt = await response.json();
    if (posted.length === 1) { first = receipt; await route.abort('connectionreset'); } else { expect(receipt).toEqual(first); holdCurrent = true; await route.fulfill({ response }); }
  });
  const outcome = own.getByRole('region', { name: 'Preference change outcome', exact: true });
  try {
    await own.getByRole('button', { name: 'Undo remembered preference', exact: true }).click(); const retry = own.getByRole('button', { name: 'Retry exact display choice', exact: true }); await expect(retry).toBeEnabled(); await retry.click(); await expect(retry).toHaveCount(0);
    await expect.poll(() => currentCaptured).toBe(true); await expect(outcome).toHaveCount(0);
    releaseCurrent(); await expect(outcome).toContainText('Remembered preference undone.');
    expect(first!.affected_destinations).toHaveLength(2); expect(new Set(first!.affected_destinations).size).toBe(2);
    expect([...first!.affected_destinations].sort()).toEqual(['engagement-a', destination].sort());
    await expect(outcome.getByRole('listitem')).toHaveCount(2); await expect(outcome.getByRole('listitem')).toHaveText(first!.affected_destinations);
    expect(posted).toHaveLength(2); expect(posted[1]).toBe(posted[0]);
  } finally { releaseCurrent(); await page.unroute('**/api/knowledge/organisations/org-a/preference/verify'); await page.unroute('**/api/knowledge/organisations/org-a/preference'); }
  await page.getByRole('button', { name: 'All engagements', exact: false }).click(); await expect(outcome).toHaveCount(0); await page.getByRole('button', { name: /FY2026 audit/ }).click(); await openTask(page, 'Inspect attributable preference withdrawal results');
  await expect(outcome).toContainText(first!.event_id); await expect(outcome.getByRole('listitem')).toHaveCount(2); await expect(outcome.getByRole('listitem')).toHaveText(first!.affected_destinations); expect(posted).toHaveLength(2);
});

for (const sourceKind of ['evidence', 'guide'] as const) test(`a real ${sourceKind} source refusal withdraws enclosing knowledge while destination work and unrelated exact recovery survive`, async ({ page }, info) => {
  const destination: Scope = { ...scope, engagement_id: `source-refusal-${crypto.randomUUID()}` }; await addDestination(destination.engagement_id, `Source refusal ${sourceKind} destination`);
  await signIn(page); const sourceTask = await createTask(page, `Source for ${sourceKind} independent revocation`);
  const protectedText = `Protected ${sourceKind} basis ${crypto.randomUUID()}`;
  let sourceId = '', sourcePath = '';
  if (sourceKind === 'evidence') {
    const original = await acquire(page, `revocation-${crypto.randomUUID()}.txt`, Buffer.from(protectedText)); sourceId = original.reservation.id; sourcePath = `/api/engagements/engagement-a/evidence/${sourceId}`;
    await page.getByRole('button', { name: 'Return to conversation and Task', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Guide this Task', exact: true }).click(); await page.getByLabel('Guidance', { exact: true }).fill(protectedText);
    const received = page.waitForResponse(response => response.url().includes('/task-controls?') && response.request().method() === 'POST'); await page.getByRole('button', { name: /^Send/ }).click(); expect((await received).status()).toBe(202); sourcePath = `/api/engagements/engagement-a/tasks/${sourceTask}`;
  }
  const root = (await knowledge(page, sourceTask)).items.find(item => item.record.text === protectedText)!; expect(root).toBeTruthy();
  const objective = `Destination remains current after ${sourceKind} revocation`;
  const created = await page.request.post(`${runtime.url}/api/engagements/${destination.engagement_id}/task-commands?${query}`, { headers: await headers(page), data: { key: crypto.randomUUID(), kind: 'create', content: objective } }); expect(created.status()).toBe(202); const destinationTask = (await created.json()).task_id as string;
  const reused = await page.request.post(`${runtime.url}/api/engagements/engagement-a/tasks/${sourceTask}/knowledge/commands?${query}`, { headers: await headers(page), data: { key: crypto.randomUUID(), expected_revision: (await knowledge(page, sourceTask)).revision, action: { kind: 'reuse', target: { id: root.record.id, revision: root.record.revision }, destination_engagement_id: destination.engagement_id, destination_task_id: destinationTask, reason: 'Explicitly support the named destination.' } } }); expect(reused.status()).toBe(200);
  await page.getByRole('button', { name: 'All engagements', exact: false }).click(); await page.getByRole('button', { name: new RegExp(`Source refusal ${sourceKind} destination`) }).click(); await openTask(page, objective);
  const panel = page.getByRole('region', { name: 'Scoped working knowledge', exact: true }), card = panel.getByRole('article', { name: `Knowledge ${root.record.id}`, exact: true });
  await card.getByText('Inspect knowledge basis', { exact: true }).click(); await card.getByRole('button', { name: sourceKind === 'evidence' ? 'Inspect original source' : 'Inspect source Task', exact: true }).click();
  if (sourceKind === 'evidence') await expect(card.locator('.evidence-preview')).toHaveText(protectedText); else await expect(card.getByRole('heading', { name: `Source for ${sourceKind} independent revocation`, exact: true })).toBeVisible();
  const posted: string[] = []; let receipt: KnowledgeReceipt | null = null;
  const commandPattern = `**/api/engagements/${destination.engagement_id}/tasks/${destinationTask}/knowledge/commands?*`;
  await page.route(commandPattern, async route => { posted.push(route.request().postData()!); const response = await route.fetch(); expect(response.status()).toBe(200); const actual = await response.json(); if (posted.length === 1) { receipt = actual; await route.abort('connectionreset'); } else { expect(actual).toEqual(receipt); await route.fulfill({ response }); } });
  await panel.getByRole('button', { name: 'Record an assertion', exact: true }).click(); const form = panel.getByRole('form', { name: 'Working knowledge change', exact: true }); await form.getByRole('textbox', { name: 'Assertion text', exact: true }).fill('Unrelated destination assertion retains exact recovery.'); await form.getByRole('button', { name: 'Record knowledge change', exact: true }).click(); const retry = panel.getByRole('button', { name: 'Retry exact knowledge request', exact: true }); await expect(retry).toBeEnabled();
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let captured = false;
  const projectionPattern = `**/api/engagements/${destination.engagement_id}/tasks/${destinationTask}/knowledge?*`;
  let heldRequest: Request | null = null;
  const lifecycle: { source_kind: string; held_status: number | null; source_status: number | null; held_failure: string | null; held_fulfilled: boolean; protected_withdrawn: boolean; exact_recovery_completed: boolean; events: string[] } = { source_kind: sourceKind, held_status: null, source_status: null, held_failure: null, held_fulfilled: false, protected_withdrawn: false, exact_recovery_completed: false, events: [] };
  const failedHeldRequest = (request: Request) => { if (request === heldRequest) { lifecycle.held_failure = request.failure()?.errorText ?? 'unknown'; lifecycle.events.push('exact-held-request-failed'); } };
  page.on('requestfailed', failedHeldRequest);
  await page.route(projectionPattern, async route => {
    const response = await route.fetch();
    if (!captured) {
      expect(response.status()).toBe(200); heldRequest = route.request(); lifecycle.held_status = response.status(); captured = true; lifecycle.events.push('exact-response-held');
      await held; lifecycle.events.push('held-gate-released'); await route.fulfill({ response }); lifecycle.held_fulfilled = true; lifecycle.events.push('held-fulfill-completed');
    } else await route.fulfill({ response });
  });
  try {
    await panel.getByRole('button', { name: 'Refresh working knowledge', exact: true }).click(); await expect.poll(() => captured).toBe(true);
    await runtime.sqlAsync(`BEGIN; SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('org-a',205)); UPDATE public.engagement_assignments SET active=false WHERE organisation_id='org-a' AND client_id='client-a' AND engagement_id='engagement-a' AND actor_id='actor-manager'; COMMIT;`);
    const refused = page.waitForResponse(response => new URL(response.url()).pathname === sourcePath && response.request().method() === 'GET' && response.status() === 403);
    await card.getByRole('button', { name: sourceKind === 'evidence' ? 'Recheck source access' : 'Recheck source Task access', exact: true }).click(); lifecycle.source_status = (await refused).status(); expect(lifecycle.source_status).toBe(403); lifecycle.events.push('actual-source-refusal');
    await expect(card).toHaveCount(0); await expect(panel.getByText(protectedText, { exact: true })).toHaveCount(0); await expect(form).toHaveCount(0);
    lifecycle.protected_withdrawn = true; lifecycle.events.push('enclosing-fragment-withdrawn');
    release(); await expect.poll(() => lifecycle.held_fulfilled).toBe(true); await expect.poll(() => lifecycle.held_failure).toMatch(/ERR_ABORTED/);
    await expect(retry).toBeEnabled(); await expect(card).toHaveCount(0); await expect(panel.getByText(protectedText, { exact: true })).toHaveCount(0); expect(posted).toHaveLength(1);
    await expect(page.getByLabel('Task objective', { exact: true })).toBeEnabled(); await expect(page.getByRole('heading', { name: `Source refusal ${sourceKind} destination`, exact: true })).toBeVisible();
    await retry.click(); await expect(retry).toHaveCount(0); expect(posted).toHaveLength(2); expect(posted[1]).toBe(posted[0]);
    await expect(panel.getByText('Unrelated destination assertion retains exact recovery.', { exact: true })).toBeVisible(); lifecycle.exact_recovery_completed = true; lifecycle.events.push('exact-recovery-completed');
  } finally {
    release(); lifecycle.events.push('cleanup-wait-started');
    try { await page.unrouteAll({ behavior: 'wait' }); lifecycle.events.push('cleanup-wait-completed'); }
    finally { page.off('requestfailed', failedHeldRequest); const path = info.outputPath(`knowledge-${sourceKind}-source-lifecycle.json`); await writeFile(path, JSON.stringify(lifecycle, null, 2)); await info.attach('source-request-lifecycle', { path, contentType: 'application/json' }); }
  }
});

for (const change of ['scope denial', 'same-account replacement'] as const) test(`confirmed ${change} clears an uncertain knowledge request without automatic retry or later resurrection`, async ({ page, context }) => {
  await signIn(page); const objective = `Clear private recovery on ${change}`; await createTask(page, objective);
  const posted: string[] = [];
  await page.route('**/api/engagements/engagement-a/tasks/*/knowledge/commands?*', async route => { posted.push(route.request().postData()!); const accepted = await route.fetch(); expect(accepted.status()).toBe(200); await route.abort('connectionreset'); });
  await page.getByRole('button', { name: 'Record an assertion', exact: true }).click(); const form = page.getByRole('form', { name: 'Working knowledge change', exact: true }); await form.getByRole('textbox', { name: 'Assertion text', exact: true }).fill(`Private recovery identity for ${change}`); await form.getByRole('button', { name: 'Record knowledge change', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Retry exact knowledge request', exact: true }); await expect(retry).toBeEnabled();
  if (change === 'scope denial') {
    const deniedScope = page.waitForResponse(response => new URL(response.url()).pathname === '/api/engagements/engagement-a' && response.request().method() === 'GET' && response.status() === 403);
    await runtime.sqlAsync(`BEGIN; SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('org-a',205)); UPDATE public.engagement_assignments SET active=false WHERE organisation_id='org-a' AND client_id='client-a' AND engagement_id='engagement-a' AND actor_id='actor-manager'; COMMIT;`);
    await page.getByRole('button', { name: 'Refresh access', exact: true }).click(); expect((await deniedScope).status()).toBe(403); await expect(page.getByRole('heading', { name: 'Your engagements', exact: true })).toBeVisible(); await expect(retry).toHaveCount(0); await expect(form).toHaveCount(0);
    await runtime.sqlAsync(restore()); await page.getByRole('button', { name: 'Refresh access', exact: true }).click(); await page.getByRole('button', { name: /FY2026 audit/ }).click();
  } else {
    const before = await session(page), replacement = await context.newPage();
    try {
      const appCookie = (await context.cookies(runtime.url)).find(cookie => cookie.name === '__Host-zobba-session')?.value; expect(!!appCookie).toBe(true);
      await context.clearCookies({ domain: '127.0.0.1' }); expect((await context.cookies(runtime.url)).find(cookie => cookie.name === '__Host-zobba-session')?.value === appCookie).toBe(true);
      await signIn(replacement); expect((await session(replacement)).csrf_token === before.csrf_token).toBe(false); await page.getByRole('button', { name: 'Refresh access', exact: true }).click(); await expect(retry).toHaveCount(0); await expect(form).toHaveCount(0); }
    finally { await replacement.close(); }
  }
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible(); await openTask(page, objective); await expect(retry).toHaveCount(0); await expect(form).toHaveCount(0); expect(posted).toHaveLength(1);
});
