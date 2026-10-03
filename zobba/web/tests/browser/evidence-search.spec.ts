import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Download, Page, Request } from '@playwright/test';
import type { Evidence } from '../../src/evidence';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration } from './cleanup';

// Browser plugin not available. Real Chromium, OIDC, PostgreSQL and S3 fixture;
// intercepted successful reads only hold actual responses to exercise races.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const scope = 'organisation_id=org-a&client_id=client-a';
const restore = fixtureRestoration(['actor-a'], `UPDATE public.identities SET active=true WHERE id='actor-a';
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE actor_id='actor-a' AND organisation_id='org-a';
UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id='actor-a';`);
let pageErrors: string[];
test.beforeAll(async () => {
  // A cold owned Rust fixture build is setup work; journey deadlines stay at 90 seconds.
  test.setTimeout(180_000);
  runtime = await startAuthRuntime({ evidence: true });
  console.info('Source-library runtime ready; owned fixture build completed.');
});
test.beforeEach(async ({ page }) => {
  await runtime.sqlAsync(restore('TRUNCATE public.evidence_reservations,public.tasks,public.task_counters CASCADE;'));
  pageErrors = []; page.on('pageerror', error => pageErrors.push(error.name));
});
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'wait' }); await runtime.sqlAsync(restore()); expect(pageErrors).toEqual([]); });
test.afterAll(async () => { if (runtime) { try { await runtime.sqlAsync(restore()); } finally { await runtime.close(); } } });
function gate() { let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); return { held, release }; }
async function signIn(page: Page, replace = false) {
  if (replace) await page.context().clearCookies({ domain: '127.0.0.1' });
  await page.goto(`${runtime.url}/api/auth/login`); await page.getByLabel('Account', { exact: true }).selectOption('auditor-a');
  await page.getByLabel('Password', { exact: true }).fill(runtime.password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /FY2026 audit/ }).click(); await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
}
async function headers(page: Page) {
  const response = await page.request.get(`${runtime.url}/api/auth/session`); expect(response.status()).toBe(200); const session = await response.json();
  return { Origin: runtime.url, 'X-CSRF-Token': session.csrf_token, 'X-Expected-Session': session.csrf_token, 'X-Expected-Actor': session.identity.id };
}
async function acquire(page: Page, name = 'Original Résumé.txt', bytes = Buffer.from('\ufeffSource says 😀\r\nOriginal retained bytes.\r\n')): Promise<Evidence> {
  const authority = await headers(page);
  const response = await page.request.post(`${runtime.url}/api/engagements/engagement-a/evidence-reservations?${scope}`, { headers: authority, data: {
    key: crypto.randomUUID(), filename: name, identity: { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
    source: { system: 'Asserted Ledger', account: 'Acquisition account', source_version: 'asserted-v7', selection: 'Selected working source', coverage: 'Coverage unknown' },
  } });
  expect(response.status()).toBe(200); const reserved = await response.json();
  const registered = await page.request.put(`${runtime.url}/api/engagements/engagement-a/evidence-reservations/${reserved.id}/upload?${scope}`, { headers: { ...authority, 'Content-Type': 'application/octet-stream' }, data: bytes });
  expect(registered.status()).toBe(200); return registered.json();
}
async function open(page: Page) { await page.getByRole('button', { name: 'Evidence', exact: true }).click(); await expect(page.getByLabel('Find registered sources', { exact: true })).toBeVisible(); }
async function search(page: Page, query: string) { await page.getByLabel('Find registered sources', { exact: true }).fill(query); await page.getByRole('button', { name: 'Search sources', exact: true }).click(); }
async function createTask(page: Page, objective: string) {
  const created = await page.request.post(`${runtime.url}/api/engagements/engagement-a/task-commands?${scope}`, { headers: await headers(page), data: { key: crypto.randomUUID(), kind: 'create', task_id: null, cycle_id: null, content: objective } });
  expect(created.status()).toBe(202);
  await page.getByRole('button', { name: `Open ${objective}`, exact: true }).click();
}
async function seedCandidates(source: Evidence) {
  const id = source.reservation.id; expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  // Metadata-only synthetic candidates do not claim that object bytes exist.
  await runtime.sqlAsync(`INSERT INTO public.evidence_reservations(id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at)
SELECT 'zz-search-'||lpad(n::text,4,'0'),organisation_id,client_id,engagement_id,actor_id,'search-key-'||n,
(request::jsonb || jsonb_build_object('key','search-key-'||n,'filename',CASE WHEN n<51 THEN 'Dense Résumé '||n||'.txt' ELSE 'Other source '||n||'.txt' END,'coverage',CASE WHEN n=299 THEN 'Rare %_ needle' ELSE NULL END))::text,
digest,size,namespace,reserved_at FROM public.evidence_reservations CROSS JOIN generate_series(0,299) n WHERE id='${id}';
INSERT INTO public.evidence_originals(id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at,version)
SELECT id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at,'fixture-metadata-version' FROM public.evidence_reservations WHERE id LIKE 'zz-search-%';`);
}

test('bounded dense and sparse search pages disclose coverage and reset the cursor for Unicode queries', async ({ page }) => {
  await signIn(page); const source = await acquire(page); await seedCandidates(source); await open(page);
  await search(page, 'dense résumé'); await expect(page.locator('.evidence-registry li')).toHaveCount(50);
  const first = await page.locator('.evidence-open-item').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-evidence-id')));
  await page.getByRole('button', { name: 'More evidence', exact: true }).click(); await expect(page.locator('.evidence-registry li')).toHaveCount(1);
  expect(first).not.toContain(await page.locator('.evidence-open-item').getAttribute('data-evidence-id'));
  // A headers-only response event can belong to a subsequently cancelled read.
  // Buffer the real upstream body before forwarding it, and assert only the
  // exact browser request that finished; no replacement API read is issued.
  const captured = new Map<Request, { status: number; body: unknown }>();
  const sparseQuery = (url: URL) => url.pathname === '/api/engagements/engagement-a/evidence' && url.searchParams.get('q') === '%_ NEEDLE';
  await page.route(sparseQuery, async route => {
    const response = await route.fetch();
    captured.set(route.request(), { status: response.status(), body: await response.json() });
    try { await route.fulfill({ response }); }
    catch (reason) { if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw reason; }
  });
  const queried = page.waitForEvent('requestfinished', { predicate: request => captured.has(request) });
  await search(page, '%_ NEEDLE'); const request = await queried, response = captured.get(request)!;
  expect(response.status).toBe(200); expect(request.method()).toBe('GET');
  expect(new URL(request.url()).searchParams.has('after')).toBe(false);
  expect(response.body).toMatchObject({ query: '%_ NEEDLE', items: [], coverage: { examined_count: 256, candidate_limit: 256, complete: false } });
  await expect(page.locator('.evidence-registry li')).toHaveCount(0); await expect(page.locator('.evidence-registry')).toContainText('Continue to examine later candidates.');
  await page.getByRole('button', { name: 'More evidence', exact: true }).click(); await expect(page.locator('.evidence-registry li')).toHaveCount(1);
  await expect(page.locator('.evidence-open-item')).toHaveAttribute('data-evidence-id', 'zz-search-0299');
  await search(page, '界'.repeat(67)); await expect(page.getByRole('alert')).toContainText('200 UTF-8 bytes');
  await expect(page.getByLabel('Find registered sources', { exact: true })).toHaveValue('界'.repeat(67));
  await search(page, '\ufeff'); await expect(page.locator('.evidence-coverage')).toContainText('256');
});

test('late source search cannot replace a newer query and query navigation never mutates', async ({ page }) => {
  await signIn(page); await acquire(page, 'First original.txt'); await acquire(page, 'Second original.txt'); await open(page);
  const barrier = gate(); let held = false; const mutations: string[] = [];
  page.on('request', request => { if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method()) && /\/evidence(?:-|\/|\?)/.test(request.url())) mutations.push(request.method()); });
  await page.route('**/api/engagements/engagement-a/evidence?*', async route => {
    if (new URL(route.request().url()).searchParams.get('q') !== 'First') { await route.continue(); return; }
    const response = await route.fetch(); expect(response.status()).toBe(200); held = true; await barrier.held;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await search(page, 'First'); await expect.poll(() => held).toBe(true);
    await search(page, 'Second'); await expect(page.locator('.evidence-open-item')).toContainText('Second original.txt');
    barrier.release(); await expect(page.locator('.evidence-open-item')).toHaveCount(1); await expect(page.locator('.evidence-open-item')).toContainText('Second original.txt');
    await expect(page.locator('.evidence-coverage')).toContainText('“Second”'); expect(mutations).toEqual([]);
  } finally { barrier.release(); }
});

for (const change of ['a new query', 'another engagement'] as const) {
  test(`a held later source page is cancelled after selecting ${change}`, async ({ page }) => {
    const destination = `search-destination-${crypto.randomUUID()}`;
    const destinationName = 'Source search destination';
    if (change === 'another engagement') await runtime.sqlAsync(restore(`
INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','${destination}','${destinationName}');
INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','${destination}','actor-a');`));
    const barrier = gate(); let held = false, released = false, cancelled = false;
    const mutations: string[] = [];
    try {
      await signIn(page); const source = await acquire(page, 'Current query original.txt'); await seedCandidates(source); await open(page);
      await search(page, 'dense résumé'); await expect(page.locator('.evidence-open-item')).toHaveCount(50);
      const isLaterPage = (url: string) => {
        const parsed = new URL(url);
        return parsed.pathname === '/api/engagements/engagement-a/evidence' && parsed.searchParams.get('q') === 'dense résumé' && parsed.searchParams.has('after');
      };
      page.on('requestfailed', request => { if (isLaterPage(request.url())) cancelled = request.failure()?.errorText === 'net::ERR_ABORTED'; });
      page.on('request', request => { if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method()) && /\/evidence(?:-|\/|\?)/.test(request.url())) mutations.push(request.method()); });
      await page.route('**/api/engagements/engagement-a/evidence?*', async route => {
        if (!isLaterPage(route.request().url())) { await route.continue(); return; }
        const response = await route.fetch(); expect(response.status()).toBe(200);
        const result = await response.json(); expect(result.items).toHaveLength(1); expect(result.items[0].reservation.id).toBe('zz-search-0050');
        held = true; await barrier.held; await route.fulfill({ response }).catch(() => {}); released = true;
      });
      await page.getByRole('button', { name: 'More evidence', exact: true }).click(); await expect.poll(() => held).toBe(true);
      await expect(page.locator('.evidence-private')).toBeHidden();
      if (change === 'a new query') {
        const current = page.waitForResponse(response => new URL(response.url()).pathname === '/api/engagements/engagement-a/evidence' && new URL(response.url()).searchParams.get('q') === 'Current query');
        const input = page.getByLabel('Find registered sources', { exact: true });
        await input.fill('Current query'); await input.press('Enter');
        const response = await current; expect(response.status()).toBe(200); expect(new URL(response.url()).searchParams.has('after')).toBe(false);
        await expect(page.locator('.evidence-open-item')).toHaveCount(1); await expect(page.locator('.evidence-open-item')).toHaveAttribute('data-evidence-id', source.reservation.id);
        await expect(input).toBeFocused();
      } else {
        await page.getByRole('button', { name: /All engagements/ }).click();
        await page.getByRole('button', { name: new RegExp(destinationName) }).click();
        await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: destinationName, exact: true })).toBeFocused();
        // Capture the real destination body before forwarding it, then select a
        // completed browser request rather than a possibly superseded response.
        const captured = new Map<Request, { status: number; body: unknown }>();
        await page.route(url => url.pathname === `/api/engagements/${destination}/evidence`, async route => {
          const response = await route.fetch();
          captured.set(route.request(), { status: response.status(), body: await response.json() });
          try { await route.fulfill({ response }); }
          catch (reason) { if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw reason; }
        });
        const current = page.waitForEvent('requestfinished', { predicate: request => captured.has(request) });
        await open(page); const request = await current, response = captured.get(request)!;
        expect(response.status).toBe(200); expect(request.method()).toBe('GET');
        const query = new URL(request.url()).searchParams;
        expect(query.get('organisation_id')).toBe('org-a'); expect(query.get('client_id')).toBe('client-a');
        expect(query.has('after')).toBe(false); expect(query.get('q')).toBe('');
        expect(response.body).toMatchObject({ items: [], query: '', next_cursor: null, coverage: { examined_count: 0, candidate_limit: 256, complete: true } });
        await expect(page.locator('.evidence-coverage')).toContainText('Reached the end');
        await expect(page.getByLabel('Find registered sources', { exact: true })).toHaveValue('');
        await expect(page.locator('.evidence-header').getByRole('heading', { name: 'Evidence', exact: true })).toBeFocused();
      }
      barrier.release(); await expect.poll(() => released).toBe(true); await expect.poll(() => cancelled).toBe(true);
      await expect(page.locator('.evidence-registry')).not.toContainText('Dense Résumé');
      await expect(page.locator('.evidence-inspection, .evidence-preview')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Previous evidence', exact: true })).toHaveCount(0);
      if (change === 'a new query') {
        await expect(page.locator('.evidence-open-item')).toHaveAttribute('data-evidence-id', source.reservation.id);
        await expect(page.locator('.evidence-coverage')).toContainText('“Current query”');
        await expect(page.getByLabel('Find registered sources', { exact: true })).toBeFocused();
      } else {
        await expect(page.locator('.evidence-open-item')).toHaveCount(0);
        await expect(page.locator('.evidence-pane')).not.toContainText(source.reservation.id);
        await expect(page.locator('.evidence-pane')).not.toContainText(source.reservation.request.filename);
        await expect(page.locator('.evidence-header').getByRole('heading', { name: 'Evidence', exact: true })).toBeFocused();
      }
      expect(mutations).toEqual([]);
    } finally {
      barrier.release(); await page.unrouteAll({ behavior: 'wait' });
      if (change === 'another engagement') {
        await page.goto('about:blank');
        await runtime.sqlAsync(restore(`DELETE FROM public.task_counters WHERE organisation_id='org-a' AND engagement_id='${destination}';
DELETE FROM public.engagement_assignments WHERE organisation_id='org-a' AND engagement_id='${destination}';
DELETE FROM public.engagements WHERE organisation_id='org-a' AND id='${destination}';`));
      }
    }
  });
}

for (const change of ['assignment revocation', 'same-actor session replacement'] as const) {
  test(`a held inspector preview never discloses stale private material after ${change}`, async ({ page, context }) => {
    await signIn(page); const originalSession = await headers(page);
    const privateText = 'Held private preview must never be published.';
    const source = await acquire(page, 'Held private original.txt', Buffer.from(privateText)); await open(page);
    const barrier = gate(); let held = false, released = false;
    await page.evaluate(marker => {
      Object.assign(window, { stalePreviewDisclosed: false });
      new MutationObserver(records => {
        if (records.some(record => [...record.addedNodes].some(node => node.textContent?.includes(marker)))) {
          Object.assign(window, { stalePreviewDisclosed: true });
        }
      }).observe(document.body, { childList: true, subtree: true });
    }, privateText);
    await page.route(`**/api/engagements/engagement-a/evidence/${source.reservation.id}/preview?*`, async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ kind: 'plain_text', text: privateText, truncated: false });
      held = true; await barrier.held; await route.fulfill({ response }).catch(() => {}); released = true;
    });
    try {
      await page.locator('.evidence-open-item').click(); await expect.poll(() => held).toBe(true);
      const inspector = page.getByRole('region', { name: 'Evidence details', exact: true });
      await expect(inspector).toContainText(source.reservation.request.identity.sha256);
      await expect(inspector.getByRole('heading', { level: 3 })).toBeFocused();
      await expect(page.locator('.evidence-preview')).toHaveCount(0);
      if (change === 'assignment revocation') {
        const denied = page.waitForResponse(response => new URL(response.url()).pathname === '/api/engagements/engagement-a' && response.status() === 403);
        await runtime.sqlAsync("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND engagement_id='engagement-a';");
        barrier.release(); expect((await denied).status()).toBe(403);
        await expect(page.getByRole('heading', { name: 'Your engagements', exact: true })).toBeFocused();
        await expect(page.locator('.evidence-private:visible')).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText(source.reservation.request.filename);
      } else {
        const other = await context.newPage();
        try {
          await signIn(other, true); const replacementSession = await headers(other);
          expect(replacementSession['X-Expected-Actor']).toBe(originalSession['X-Expected-Actor']);
          expect(replacementSession['X-Expected-Session']).not.toBe(originalSession['X-Expected-Session']);
          barrier.release(); await page.bringToFront();
          await expect(inspector).toHaveCount(0);
          await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
          await expect.poll(() => page.evaluate(() => document.activeElement?.matches('[data-focus="workspace-heading"], .evidence-header h2') ?? false)).toBe(true);
        } finally { await other.close(); }
      }
      await expect.poll(() => released).toBe(true);
      await expect(inspector).toHaveCount(0); await expect(page.locator('.evidence-preview')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(privateText);
      await expect(page.locator('body')).not.toContainText(source.reservation.request.identity.sha256);
      expect(await page.evaluate(() => (window as unknown as { stalePreviewDisclosed: boolean }).stalePreviewDisclosed)).toBe(false);
    } finally { barrier.release(); }
  });
}

test('a held successful search is refused after actual assignment revocation', async ({ page }) => {
  await signIn(page); await acquire(page, 'Private registered source.txt'); await open(page);
  const barrier = gate(); let held = false;
  await page.route('**/api/engagements/engagement-a/evidence?*', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200); held = true; await barrier.held; await route.fulfill({ response }).catch(() => {});
  });
  try {
    await search(page, 'Private'); await expect.poll(() => held).toBe(true);
    const denied = page.waitForResponse(response => new URL(response.url()).pathname === '/api/engagements/engagement-a' && response.status() === 403);
    await runtime.sqlAsync("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND engagement_id='engagement-a';");
    barrier.release(); expect((await denied).status()).toBe(403); await expect(page.getByRole('button', { name: /Private registered source/ })).toHaveCount(0);
    await expect(page.locator('.evidence-private:visible')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Your engagements', exact: true })).toBeFocused();
  } finally { barrier.release(); }
});

test('an unavailable search withdraws results and focuses a permitted retry surface', async ({ page }) => {
  await signIn(page); await acquire(page); await open(page);
  await page.route('**/api/engagements/engagement-a/evidence?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }));
  await search(page, 'Résumé'); await expect(page.locator('.evidence-private')).toBeHidden();
  await expect(page.locator('.evidence-header').getByRole('heading', { name: 'Evidence', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Retry evidence', exact: true })).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' }); await page.getByRole('button', { name: 'Retry evidence', exact: true }).click();
  await expect(page.locator('.evidence-open-item')).toContainText('Original Résumé.txt');
});

for (const kind of ['preview', 'download'] as const) {
  test(`routine access checking preserves a held knowledge-source ${kind} until current verification`, async ({ page }) => {
    // Advance the actual scheduled 30-second check without sleeping or changing
    // the server clock, authority responses, or bounded transfer deadline.
    await page.clock.install();
    await page.addInitScript(() => {
      const counts = { created: 0, revoked: 0 }; Object.assign(window, { evidenceBlobCounts: counts });
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = value => { counts.created++; return create(value); };
      URL.revokeObjectURL = value => { counts.revoked++; revoke(value); };
    });
    await signIn(page); const session = await headers(page);
    const bytes = Buffer.from('Source survives routine access checking.');
    const item = await acquire(page, 'Routine source original.txt', bytes);
    await createTask(page, 'Keep one original transfer through routine checking');
    const card = page.getByRole('article').filter({ hasText: bytes.toString() }).first();
    await card.getByText('Inspect knowledge basis', { exact: true }).click();
    const transferGate = gate(), authorityGate = gate();
    let transferHeld = false, transferReleased = false, authorityHeld = false, holdAuthority = true, transferReads = 0, transferAborted = false;
    const path = `/api/engagements/engagement-a/evidence/${item.reservation.id}/${kind}`;
    page.on('requestfailed', request => { if (new URL(request.url()).pathname === path) transferAborted = true; });
    await page.route(`**${path}?*`, async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200); transferReads++;
      if (kind === 'preview') expect(await response.json()).toMatchObject({ kind: 'plain_text', text: bytes.toString() });
      else expect(await response.body()).toEqual(bytes);
      transferHeld = true; await transferGate.held; await route.fulfill({ response }).catch(() => {}); transferReleased = true;
    });
    try {
      await card.getByRole('button', { name: 'Open in evidence library', exact: true }).first().click();
      const inspector = page.locator('.evidence-pane .evidence-source-inspector');
      let downloaded: Promise<Download> | undefined;
      if (kind === 'download') {
        await expect(inspector.locator('.evidence-preview')).toHaveText(bytes.toString());
        downloaded = page.waitForEvent('download');
        await inspector.getByRole('button', { name: 'Download verified original', exact: true }).click();
      }
      await expect.poll(() => transferHeld).toBe(true);
      // Hold only the workspace's assignment-list check. The transfer's own
      // session and exact-source checks remain live, exercising quarantine after
      // its authenticated body has finished, rather than delaying those checks.
      await page.route(url => url.pathname === '/api/engagements', async route => {
        if (!holdAuthority) { await route.continue(); return; }
        const response = await route.fetch(); expect(response.status()).toBe(200); authorityHeld = true;
        await authorityGate.held; await route.fulfill({ response }).catch(() => {});
      });
      await page.clock.fastForward(30_000); await expect.poll(() => authorityHeld).toBe(true);
      await expect(inspector).toBeHidden(); await expect(page.locator('.evidence-pane .evidence-preview:visible')).toHaveCount(0);
      const sourceVerified = page.waitForResponse(response => new URL(response.url()).pathname === '/api/engagements/engagement-a' && response.status() === 200);
      transferGate.release(); await expect.poll(() => transferReleased).toBe(true);
      await (await sourceVerified).finished();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await page.evaluate(() => (window as unknown as { evidenceBlobCounts: { created: number } }).evidenceBlobCounts.created)).toBe(0);
      await expect(inspector).toBeHidden();
      holdAuthority = false; authorityGate.release();
      await expect(inspector).toBeVisible(); await expect(inspector).toContainText(item.reservation.request.identity.sha256);
      if (kind === 'preview') await expect(inspector.locator('.evidence-preview')).toHaveText(bytes.toString());
      else {
        const download = await downloaded!;
        expect(await readFile((await download.path())!)).toEqual(bytes);
        await expect.poll(() => page.evaluate(() => (window as unknown as { evidenceBlobCounts: { created: number; revoked: number } }).evidenceBlobCounts)).toEqual({ created: 1, revoked: 1 });
      }
      expect((await headers(page))['X-Expected-Session']).toBe(session['X-Expected-Session']);
      expect(transferReads).toBe(1); expect(transferAborted).toBe(false);
    } finally { holdAuthority = false; transferGate.release(); authorityGate.release(); }
  });
}

test('390px keyboard search traverses dense and sparse pages and returns from inspection to the exact result', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await signIn(page);
  const item = await acquire(page, 'Dense Résumé original.txt'); await seedCandidates(item); await open(page);
  const input = page.getByLabel('Find registered sources', { exact: true });
  await input.fill('dense résumé'); await input.press('Enter'); await expect(page.locator('.evidence-open-item')).toHaveCount(50);
  const first = await page.locator('.evidence-open-item').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-evidence-id')));
  const more = page.getByRole('button', { name: 'More evidence', exact: true }); await more.focus(); await more.press('Enter');
  await expect(page.locator('.evidence-open-item')).toHaveCount(2); await expect(input).toBeFocused();
  const previous = page.getByRole('button', { name: 'Previous evidence', exact: true }); await previous.focus(); await previous.press('Enter');
  await expect(page.locator('.evidence-open-item')).toHaveCount(50); await expect(input).toBeFocused();
  expect(await page.locator('.evidence-open-item').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-evidence-id')))).toEqual(first);
  // The real original has a random ID; inspect whichever bounded page owns it.
  if (!first.includes(item.reservation.id)) { await more.focus(); await more.press('Enter'); await expect(page.locator('.evidence-open-item')).toHaveCount(2); }
  const opener = page.locator(`.evidence-open-item[data-evidence-id="${item.reservation.id}"]`);
  await opener.focus(); await opener.press('Enter'); const inspector = page.getByRole('region', { name: 'Evidence details', exact: true });
  await expect(inspector.getByRole('heading', { level: 3 })).toBeFocused(); await expect(inspector.locator('.evidence-preview')).toContainText('Source says 😀');
  const back = inspector.getByRole('button', { name: 'Back to evidence list', exact: true }); await back.focus(); await back.press('Enter');
  await expect(opener).toBeFocused(); await expect(opener).toBeInViewport();
  await input.fill('%_ needle'); await input.press('Enter'); await expect(page.locator('.evidence-open-item')).toHaveCount(0);
  await expect(page.locator('.evidence-registry')).toContainText('Continue to examine later candidates.');
  await more.focus(); await more.press('Enter'); await expect(page.locator('.evidence-open-item')).toHaveAttribute('data-evidence-id', 'zz-search-0299');
  await expect(input).toBeFocused(); await previous.focus(); await previous.press('Enter');
  await expect(page.locator('.evidence-open-item')).toHaveCount(0); await expect(input).toBeFocused();
  await expect(page.locator('.evidence-registry')).toContainText('Continue to examine later candidates.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('source-search-continuation-390.png'), fullPage: true });
});

test('390px keyboard inspection preserves exact provenance and verified original bytes, then returns to its opener', async ({ page }, info) => {
  await page.addInitScript(() => {
    const counts = { created: 0, revoked: 0 }; Object.assign(window, { evidenceBlobCounts: counts });
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = value => { counts.created++; return create(value); };
    URL.revokeObjectURL = value => { counts.revoked++; revoke(value); };
  });
  await page.setViewportSize({ width: 390, height: 844 }); await signIn(page);
  const bytes = Buffer.from('\ufeffSource says 😀\r\nOriginal retained bytes.\r\n'); const item = await acquire(page, 'Original Résumé.txt', bytes); await open(page);
  await search(page, 'asserted-v7'); const opener = page.locator('.evidence-open-item'); await expect(opener).toHaveCount(1);
  await opener.hover();
  const contrast = await opener.evaluate(element => {
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
    };
    const background = luminance(getComputedStyle(element).backgroundColor);
    return [...element.querySelectorAll('strong, span')].map(label => {
      const foreground = luminance(getComputedStyle(label).color);
      return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
    });
  });
  expect(Math.min(...contrast)).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: info.outputPath('source-search-390.png'), fullPage: true });
  await opener.focus(); await page.keyboard.press('Enter'); const inspector = page.getByRole('region', { name: 'Evidence details', exact: true });
  await expect(inspector.getByRole('heading', { level: 3 })).toBeFocused(); await expect(inspector.locator('.evidence-preview')).toHaveText(bytes.toString());
  for (const text of [item.reservation.id, item.version, item.reservation.request.identity.sha256, 'org-a / client-a / engagement-a', 'actor-a', 'asserted-v7']) await expect(inspector).toContainText(text);
  await expect(inspector).toContainText('Bounded plain-text preview');
  const downloadPromise = page.waitForEvent('download'); await inspector.getByRole('button', { name: 'Download verified original', exact: true }).click();
  const downloaded = await downloadPromise; expect(downloaded.suggestedFilename()).toBe('Original_R_sum_.txt'); expect(await readFile((await downloaded.path())!)).toEqual(bytes);
  await expect.poll(() => page.evaluate(() => (window as unknown as { evidenceBlobCounts: { created: number; revoked: number } }).evidenceBlobCounts)).toEqual({ created: 1, revoked: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('source-library-390.png'), fullPage: true });
  await inspector.getByRole('button', { name: 'Back to evidence list', exact: true }).click(); await expect(opener).toBeFocused(); await expect(opener).toBeInViewport();
});

test('Task knowledge opens its exact source in the library and restores the knowledge opener', async ({ page }, info) => {
  await signIn(page); const item = await acquire(page, 'Knowledge original.txt');
  const objective = 'Inspect original source from working knowledge';
  const created = await page.request.post(`${runtime.url}/api/engagements/engagement-a/task-commands?${scope}`, { headers: await headers(page), data: { key: crypto.randomUUID(), kind: 'create', task_id: null, cycle_id: null, content: objective } }); expect(created.status()).toBe(202);
  await page.getByRole('button', { name: `Open ${objective}`, exact: true }).click();
  const card = page.getByRole('article').filter({ hasText: 'Source says 😀' }).first(); await expect(card).toBeVisible();
  await card.getByText('Inspect knowledge basis', { exact: true }).click(); const opener = card.getByRole('button', { name: 'Open in evidence library', exact: true }).first();
  await opener.focus(); await page.keyboard.press('Enter'); const inspector = page.locator('.evidence-pane .evidence-source-inspector');
  await expect(inspector).toContainText(item.reservation.id); await expect(inspector).toContainText(item.version); await expect(inspector.locator('.evidence-preview')).toContainText('Source says 😀');
  await expect(inspector.getByRole('heading').first()).toBeFocused();
  await inspector.evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: info.outputPath('knowledge-source-library-desktop.png'), fullPage: true });
  const sourceDownload = page.waitForEvent('download'); await inspector.getByRole('button', { name: 'Download verified original', exact: true }).click();
  expect(await readFile((await (await sourceDownload).path())!)).toEqual(Buffer.from('\ufeffSource says 😀\r\nOriginal retained bytes.\r\n'));
  runtime.evidence!.faultNext('corrupt-get'); await inspector.getByRole('button', { name: 'Recheck source access', exact: true }).click();
  await expect(inspector).toContainText('Current access permits its registered provenance'); await expect(inspector).toContainText(item.reservation.id);
  await expect(inspector.locator('.evidence-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Return to conversation and Task', exact: true }).click(); await expect(opener).toBeFocused();
});

test('reused knowledge opens its exact original from another engagement and source-only revocation preserves destination work', async ({ page }, info) => {
  const destination = `library-reuse-${crypto.randomUUID()}`;
  const destinationName = 'Cross-engagement source library destination';
  const objective = 'Destination Task retains its own conversation';
  const pendingDraft = 'Unsent destination objective remains owned by this engagement.';
  const bytes = Buffer.from('\ufeffPrivate cross-engagement source 😀\r\nExact original bytes.\r\n');
  expect(destination).toMatch(/^[A-Za-z0-9_-]+$/);
  await runtime.sqlAsync(restore(`
INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','${destination}','${destinationName}');
INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','${destination}','actor-a');`));
  try {
    await signIn(page);
    const original = await acquire(page, 'Reused original Résumé.txt', bytes);
    const makeTask = async (engagement: string, content: string) => {
      const response = await page.request.post(`${runtime.url}/api/engagements/${engagement}/task-commands?${scope}`, {
        headers: await headers(page), data: { key: crypto.randomUUID(), kind: 'create', task_id: null, cycle_id: null, content },
      });
      expect(response.status()).toBe(202); return (await response.json()).task_id as string;
    };
    const sourceTask = await makeTask('engagement-a', 'Original source consumer');
    const destinationTask = await makeTask(destination, objective);
    const readKnowledge = async (engagement: string, task: string) => {
      const response = await page.request.get(`${runtime.url}/api/engagements/${engagement}/tasks/${task}/knowledge?${scope}`);
      expect(response.status()).toBe(200); return await response.json() as import('../../src/knowledge').KnowledgePage;
    };
    await expect.poll(async () => (await readKnowledge('engagement-a', sourceTask)).items.some(item => item.record.source?.evidence_id === original.reservation.id)).toBe(true);
    const basis = await readKnowledge('engagement-a', sourceTask);
    const sourceRecord = basis.items.find(item => item.record.source?.evidence_id === original.reservation.id)!;
    expect(sourceRecord.record.scope).toMatchObject({ organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' });
    expect(sourceRecord.record.source).toMatchObject({ evidence_id: original.reservation.id, storage_version: original.version, digest: original.reservation.request.identity.sha256 });
    const reused = await page.request.post(`${runtime.url}/api/engagements/engagement-a/tasks/${sourceTask}/knowledge/commands?${scope}`, {
      headers: await headers(page), data: { key: crypto.randomUUID(), expected_revision: basis.revision, action: {
        kind: 'reuse', target: { id: sourceRecord.record.id, revision: sourceRecord.record.revision },
        destination_engagement_id: destination, destination_task_id: destinationTask,
        reason: 'Explicit source support for the named destination Task.',
      } },
    });
    expect(reused.status()).toBe(200);
    await page.getByRole('button', { name: 'All engagements', exact: false }).click();
    await page.getByRole('button', { name: new RegExp(destinationName) }).click();
    await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Open ${objective}`, exact: true }).click();
    const panel = page.getByRole('region', { name: 'Scoped working knowledge', exact: true });
    const card = panel.getByRole('article', { name: `Knowledge ${sourceRecord.record.id}`, exact: true });
    await expect(card).toBeVisible();
    await page.getByLabel('Task objective', { exact: true }).fill(pendingDraft);
    await card.getByText('Inspect knowledge basis', { exact: true }).click();
    const opener = card.getByRole('button', { name: 'Open in evidence library', exact: true }).first();
    const sourcePath = `/api/engagements/engagement-a/evidence/${original.reservation.id}`;
    const sourceRead = page.waitForResponse(response => new URL(response.url()).pathname === sourcePath && response.request().method() === 'GET' && response.status() === 200);
    const mutations: string[] = [];
    page.on('request', request => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && /\/(?:evidence(?:-|\/|\?)|task-commands|task-controls|tasks\/[^/]+\/knowledge\/commands)/.test(new URL(request.url()).pathname)) mutations.push(new URL(request.url()).pathname);
    });
    await opener.focus(); await page.keyboard.press('Enter');
    const read = await sourceRead;
    expect(new URL(read.url()).searchParams.get('organisation_id')).toBe('org-a');
    expect(new URL(read.url()).searchParams.get('client_id')).toBe('client-a');
    const inspector = page.locator('.evidence-pane .evidence-source-inspector');
    await expect(inspector.getByRole('heading').first()).toBeFocused();
    await expect(inspector.locator('.evidence-preview')).toHaveText(bytes.toString());
    for (const value of [original.reservation.id, original.version, original.reservation.request.identity.sha256,
      'org-a / client-a / engagement-a', 'Direct upload by actor-a', 'Registered immutable original',
      'Asserted Ledger', 'Acquisition account', 'asserted-v7', 'Selected working source', 'Coverage unknown']) await expect(inspector).toContainText(value);
    // The surrounding library is the destination; only the inspected reference is the origin.
    await expect(page.locator('.evidence-pane .scope-note')).toContainText(destinationName);
    await expect(page.locator('.evidence-registry .evidence-open-item')).toHaveCount(0);
    await expect(page.getByLabel('Task objective', { exact: true })).toHaveValue(pendingDraft);
    const downloadRead = page.waitForRequest(request => new URL(request.url()).pathname === `${sourcePath}/download`);
    const downloaded = page.waitForEvent('download');
    await inspector.getByRole('button', { name: 'Download verified original', exact: true }).click();
    expect(new URL((await downloadRead).url()).searchParams.get('organisation_id')).toBe('org-a');
    const file = await downloaded;
    expect(await readFile((await file.path())!)).toEqual(bytes);
    await inspector.evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: info.outputPath('cross-engagement-source-library.png'), fullPage: true });
    // First prove successful return preserves the exact destination Task and opener.
    await page.getByRole('button', { name: 'Return to conversation and Task', exact: true }).click();
    await expect(opener).toBeFocused();
    await expect(page.locator('.inspection-header').getByRole('heading', { name: objective, exact: true })).toBeVisible();
    await expect(page.getByLabel('Task objective', { exact: true })).toHaveValue(pendingDraft);
    await opener.click(); await expect(inspector.locator('.evidence-preview')).toHaveText(bytes.toString());
    // Revoke only the origin. The viewer/accountable actor remains assigned to destination.
    await runtime.sqlAsync(`BEGIN; SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('org-a',205));
UPDATE public.engagement_assignments SET active=false WHERE organisation_id='org-a' AND client_id='client-a' AND engagement_id='engagement-a' AND actor_id='actor-a'; COMMIT;`);
    const refused = page.waitForResponse(response => new URL(response.url()).pathname === sourcePath && response.request().method() === 'GET' && response.status() === 403);
    await inspector.getByRole('button', { name: 'Recheck source access', exact: true }).click();
    expect((await refused).status()).toBe(403);
    await expect(inspector).toHaveCount(0); await expect(card).toHaveCount(0);
    await expect(page.locator('.evidence-preview')).toHaveCount(0);
    await expect(page.locator('.evidence-header').getByRole('heading', { name: 'Evidence', exact: true })).toBeFocused();
    await expect(page.locator('.evidence-pane')).not.toContainText(original.reservation.id);
    await expect(page.locator('.evidence-pane')).not.toContainText(original.reservation.request.identity.sha256);
    await expect(page.getByLabel('Task objective', { exact: true })).toHaveValue(pendingDraft);
    const currentDestination = await page.request.get(`${runtime.url}/api/engagements/${destination}?${scope}`);
    expect(currentDestination.status()).toBe(200);
    const currentTask = await page.request.get(`${runtime.url}/api/engagements/${destination}/tasks/${destinationTask}?${scope}`);
    expect(currentTask.status()).toBe(200);
    expect(await currentTask.json()).toMatchObject({ id: destinationTask, objective, accountable_actor: 'actor-a' });
    await page.getByRole('button', { name: 'Return to conversation and Task', exact: true }).click();
    // The revoked card removed the old opener; the stable Evidence toggle is the fallback.
    await expect(page.getByRole('button', { name: 'Evidence', exact: true })).toBeFocused();
    await expect(page.getByRole('heading', { name: destinationName, exact: true })).toBeVisible();
    await expect(page.locator('.inspection-header').getByRole('heading', { name: objective, exact: true })).toBeVisible();
    await expect(page.getByLabel('Task objective', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('Task objective', { exact: true })).toHaveValue(pendingDraft);
    expect(mutations).toEqual([]);
    await page.screenshot({ path: info.outputPath('cross-engagement-source-refusal-destination.png'), fullPage: true });
  } finally {
    await page.goto('about:blank');
    // This file already owns/discards all Task fixture data in beforeEach. Truncating
    // it here also clears the destination publication and Task-dependent FK rows.
    await runtime.sqlAsync(restore(`TRUNCATE public.tasks,public.task_counters CASCADE;
DELETE FROM public.engagement_assignments WHERE organisation_id='org-a' AND client_id='client-a' AND engagement_id='${destination}';
DELETE FROM public.engagements WHERE organisation_id='org-a' AND client_id='client-a' AND id='${destination}';`));
  }
});
