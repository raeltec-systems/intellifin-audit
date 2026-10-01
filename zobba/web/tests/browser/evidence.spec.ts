import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { Session } from '../../src/auth';
import type { Evidence, ReservationRequest } from '../../src/evidence';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';

// No Browser plugin is available. This owned Playwright harness exercises real
// HTTPS OIDC, restricted PostgreSQL and the API's numeric-loopback S3 transport.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const scope = 'organisation_id=org-a&client_id=client-a';
const restore = `UPDATE public.identities SET active=true WHERE id IN ('actor-a','actor-b');
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE actor_id='actor-a' AND organisation_id='org-a';
UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id='actor-a' AND organisation_id='org-a';`;
test.beforeAll(async () => { runtime = await startAuthRuntime({ evidence: true }); });
test.beforeEach(async () => runtime.sqlAsync(`${restore} TRUNCATE public.evidence_reservations,public.tasks,public.task_counters CASCADE;`));
test.afterEach(async ({ context }) => {
  await runtime.sqlAsync(restore);
  for (const page of context.pages()) await page.getByLabel('Password', { exact: true }).fill('', { timeout: 100 }).catch(() => {});
});
test.afterAll(async () => { if (runtime) { try { await runtime.sqlAsync(restore); } finally { await runtime.close(); } } });
function gate() { let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); return { held, release }; }
async function signIn(page: Page, account = 'auditor-a', replace = false) {
  if (replace) { await page.context().clearCookies({ domain: '127.0.0.1' }); await page.goto(`${runtime.url}/api/auth/login`); }
  else { await page.goto(runtime.url); await page.getByRole('link', { name: 'Sign in to Zobba' }).click(); }
  await page.getByLabel('Account', { exact: true }).selectOption(account);
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: account === 'auditor-b' ? /FY2026 review/ : /FY2026 audit/ }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
}
async function openEvidence(page: Page) {
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Registered originals', exact: true })).toBeVisible();
}
const original = { name: 'ledger.txt', mimeType: 'text/plain', buffer: Buffer.from('Original asserted ledger\nDebit 100\nCredit 100\n') };
async function acquire(page: Page, value = original) {
  await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles(value);
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible();
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence?${scope}`);
  expect(response.status()).toBe(200);
  return (await response.json()).items.find((item: Evidence) => item.reservation.request.filename === value.name) as Evidence;
}
async function currentSession(page: Page): Promise<Session> { const response = await page.request.get(`${runtime.url}/api/auth/session`); expect(response.status()).toBe(200); return response.json(); }
async function retainUncertainDraft(page: Page) {
  const pattern = '**/api/engagements/engagement-a/evidence-reservations?*';
  await page.route(pattern, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('connectionreset');
  });
  await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles({ ...original, name: 'private-pending-original.txt' });
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  await expect(page.locator('.evidence-pane').getByRole('alert')).toContainText('delivery could not be confirmed');
  await expect(page.getByRole('heading', { name: 'Finish reserved acquisition' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('zobba.evidence-draft.v1'))).not.toBeNull();
  await page.unroute(pattern);
}


test('verified acquisition keeps source assertions distinct and preserves Task guidance, selection and return focus', async ({ page }) => {
  await signIn(page);
  await page.getByLabel('Task objective', { exact: true }).fill('Reconcile the asserted ledger');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await page.getByRole('button', { name: 'Open Reconcile the asserted ledger', exact: true }).click();
  await page.getByRole('button', { name: 'Guide this Task', exact: true }).click();
  await page.getByLabel('Guidance', { exact: true }).fill('Retained unsent guidance');
  const target = await page.getByLabel('Send to', { exact: true }).inputValue();
  await openEvidence(page);
  await page.getByText('Source assertions (optional)', { exact: true }).click();
  await page.getByLabel('Source system', { exact: true }).fill('Asserted ledger source');
  await page.getByLabel('Source version', { exact: true }).fill('User assertion v7');
  const before = runtime.evidence!.stats().objects;
  const item = await acquire(page);
  expect(item.reservation.request.source.system).toBe('Asserted ledger source');
  expect(item.reservation.request.source.source_version).toBe('User assertion v7');
  expect(runtime.evidence!.stats().objects).toBe(before + 1);
  await page.locator('.evidence-pane').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: '/tmp/zobba-21-1-evidence-overview-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Read bounded preview' }).click();
  await expect(page.locator('.evidence-preview')).toHaveText(original.buffer.toString());
  await page.locator('.evidence-preview').evaluate(element => element.scrollIntoView({ block: 'end' }));
  await page.screenshot({ path: '/tmp/zobba-21-1-evidence-desktop.png', fullPage: true });
  const details = page.getByRole('region', { name: 'Evidence details' });
  await expect(details).toContainText('Direct upload by actor-a');
  const value = (label: string) => details.locator('dt').filter({ hasText: label }).locator('..').locator('dd');
  await expect(value('Measured SHA-256')).toHaveText(item.reservation.request.identity.sha256);
  await expect(value('Measured size')).toHaveText(`${original.buffer.length} bytes`);
  await expect(value('Verified storage version')).toHaveText(item.version);
  expect(item.version).not.toBe('User assertion v7');
  await expect(value('Source version')).toHaveText('User assertion v7');
  await expect(value('Source system')).toHaveText('Asserted ledger source');
  await expect(value('Source account')).toHaveText('Unknown');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download verified original', exact: true }).click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toBe(original.name);
  const chunks = []; const stream = await download.createReadStream();
  for await (const chunk of stream!) chunks.push(chunk); expect(Buffer.concat(chunks)).toEqual(original.buffer);
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence/${item.reservation.id}/download?${scope}`);
  expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['x-content-type-options']).toBe('nosniff'); expect(response.headers()['referrer-policy']).toBe('no-referrer');
  expect(response.headers()['content-disposition']).toContain('attachment');
  await page.getByRole('button', { name: 'Open Reconcile the asserted ledger', exact: true }).click();
  await expect(page.locator('.inspection-header h2')).toBeVisible();
  await expect(page.locator('.inspection-header h2')).toBeFocused();
  await expect(page.getByRole('complementary', { name: 'Engagement evidence' })).toBeHidden();
  await expect(page.getByLabel('Send to', { exact: true })).toHaveValue(target);
  await expect(page.getByLabel('Guidance', { exact: true })).toHaveValue('Retained unsent guidance');
  await openEvidence(page);
  await expect(page.getByRole('region', { name: 'Evidence details' })).toContainText(item.reservation.id);
  await expect(page.locator('.evidence-preview')).toHaveText(original.buffer.toString());
  await page.getByRole('button', { name: 'Return to conversation and Task' }).click();
  await expect(page.getByRole('button', { name: 'Evidence', exact: true })).toBeFocused();
  await expect(page.getByLabel('Send to', { exact: true })).toHaveValue(target);
  await expect(page.getByLabel('Guidance', { exact: true })).toHaveValue('Retained unsent guidance');
  await expect(page.locator('.inspection-header h2')).toHaveText('Reconcile the asserted ledger');
});

test('lost reservation acknowledgement recovers the exact key on reload and refuses a changed file', async ({ page }) => {
  await signIn(page); await openEvidence(page);
  let first: ReservationRequest | undefined;
  await page.route('**/api/engagements/engagement-a/evidence-reservations?*', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    first = route.request().postDataJSON(); const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('connectionreset');
  });
  await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles(original);
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  await expect(page.locator('.evidence-pane').getByRole('alert')).toContainText('delivery could not be confirmed');
  await page.unroute('**/api/engagements/engagement-a/evidence-reservations?*');
  await page.reload(); await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible(); await openEvidence(page);
  await expect(page.getByRole('heading', { name: 'Finish reserved acquisition' })).toBeVisible();
  await page.getByLabel('Reselect identical original', { exact: true }).setInputFiles({ ...original, buffer: Buffer.from('changed original') });
  await page.getByRole('button', { name: 'Retry same reservation' }).click();
  await expect(page.locator('.evidence-pane').getByRole('alert')).toContainText('does not match the retained reservation');
  let retry: ReservationRequest | undefined;
  await page.route('**/api/engagements/engagement-a/evidence-reservations?*', async route => { if (route.request().method() === 'POST') retry = route.request().postDataJSON(); await route.continue(); });
  await page.getByLabel('Reselect identical original', { exact: true }).setInputFiles(original);
  await page.getByRole('button', { name: 'Retry same reservation' }).click();
  await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible();
  expect(retry).toEqual(first); await expect(page.locator('.evidence-registry li')).toHaveCount(1);
});

test('lost upload acknowledgement retries the same registered original across API restart without overwrite', async ({ page }) => {
  await signIn(page); await openEvidence(page); const before = runtime.evidence!.stats().objects;
  let originalId = '';
  await page.route('**/api/engagements/engagement-a/evidence-reservations/*/upload?*', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200); originalId = (await response.json()).reservation.id; await route.abort('connectionreset');
  });
  await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles(original);
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  await expect(page.locator('.evidence-pane').getByRole('alert')).toContainText('delivery could not be confirmed');
  await page.unroute('**/api/engagements/engagement-a/evidence-reservations/*/upload?*'); await runtime.restartApi();
  await page.getByRole('button', { name: 'Retry same reservation' }).click();
  await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Evidence details' })).toContainText(originalId);
  expect(runtime.evidence!.stats().objects).toBe(before + 1);
});

test('narrow keyboard inspection caps plain text and keeps markup download-only', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await signIn(page); await openEvidence(page);
  const long = { name: 'bounded.txt', mimeType: 'text/plain', buffer: Buffer.from('界'.repeat(1000).concat('\n').repeat(120)) };
  await acquire(page, long); await page.getByRole('button', { name: 'Read bounded preview' }).click();
  await expect(page.getByText('Truncated; download the original for all bytes.', { exact: false })).toBeVisible();
  const preview = await page.locator('.evidence-preview').innerText();
  expect(Buffer.byteLength(preview)).toBeLessThanOrEqual(65536); expect(preview.split('\n').length).toBeLessThanOrEqual(100);
  await acquire(page, { name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>') });
  await page.getByRole('button', { name: 'Read bounded preview' }).click();
  await expect(page.getByText('Download only. This original has no supported inert plain-text preview.', { exact: true })).toBeVisible();
  await expect(page.locator('.evidence-pane svg')).toHaveCount(0);
  await page.getByText('Download only. This original has no supported inert plain-text preview.', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'end' }));
  await page.screenshot({ path: '/tmp/zobba-21-1-evidence-narrow.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Download verified original' }).focus(); await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Evidence', exact: true })).toBeFocused();
  await expect(page.getByLabel('Task objective', { exact: true })).toBeVisible();
});

for (const account of ['auditor-a', 'manager-a', 'auditor-b']) {
  test(`completed metadata is withheld after ${account === 'auditor-a' ? 'same-actor session' : account === 'manager-a' ? 'same-engagement actor' : 'foreign-scope account'} replacement`, async ({ page, context }) => {
    await signIn(page); await openEvidence(page); await acquire(page);
    if (account === 'auditor-a') {
      await page.locator('.evidence-inspection').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: '/tmp/zobba-21-1-evidence-top-desktop.png', fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('.evidence-inspection').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: '/tmp/zobba-21-1-evidence-top-narrow.png', fullPage: true });
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    await retainUncertainDraft(page); const responseGate = gate(); let held = false;
    await page.route('**/api/engagements/engagement-a/evidence?*', async route => { const response = await route.fetch(); held = true; await responseGate.held; await route.fulfill({ response }).catch(() => {}); });
    try {
      await page.getByRole('button', { name: 'Refresh evidence' }).click(); await expect.poll(() => held).toBe(true);
      const other = await context.newPage(); await signIn(other, account, true); responseGate.release(); await page.bringToFront();
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
      if (account === 'auditor-b') await expect(page.locator('body')).not.toContainText(original.name);
      await expect(page.getByRole('region', { name: 'Evidence details' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Finish reserved acquisition' })).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem('zobba.evidence-draft.v1'))).toBeNull();
    } finally { responseGate.release(); }
  });
  test(`completed download creates no Blob URL after ${account === 'auditor-a' ? 'same-actor session' : account === 'manager-a' ? 'same-engagement actor' : 'foreign-scope account'} replacement`, async ({ page, context }) => {
    await signIn(page); await openEvidence(page); await acquire(page); await retainUncertainDraft(page);
    await page.evaluate(() => { const originalCreate = URL.createObjectURL; Object.assign(window, { evidenceBlobCalls: 0 }); URL.createObjectURL = function (blob) { (window as unknown as { evidenceBlobCalls: number }).evidenceBlobCalls++; return originalCreate.call(URL, blob); }; });
    const responseGate = gate(); let held = false, delivered = false;
    await page.route('**/api/engagements/engagement-a/evidence/*/download?*', async route => { const response = await route.fetch(); expect(response.status()).toBe(200); held = true; await responseGate.held; await route.fulfill({ response }).catch(() => {}); delivered = true; });
    try {
      await page.getByRole('button', { name: 'Download verified original' }).click(); await expect.poll(() => held).toBe(true);
      const other = await context.newPage(); await signIn(other, account, true); responseGate.release(); await page.bringToFront(); await expect.poll(() => delivered).toBe(true);
      if (account === 'auditor-b') await expect(page.locator('body')).not.toContainText(original.name);
      await expect(page.getByRole('region', { name: 'Evidence details' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Finish reserved acquisition' })).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem('zobba.evidence-draft.v1'))).toBeNull();
      expect(await page.evaluate(() => (window as unknown as { evidenceBlobCalls: number }).evidenceBlobCalls)).toBe(0);
    } finally { responseGate.release(); }
  });
}

test('revocation during object upload prevents registration and foreign scope discloses no metadata', async ({ page }) => {
  await signIn(page); await openEvidence(page); const current = await currentSession(page);
  const held = runtime.evidence!.holdNext('PUT');
  try {
    await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles(original);
    await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click(); await held.entered;
    const raw = await page.evaluate(() => sessionStorage.getItem('zobba.evidence-draft.v1'));
    const id = JSON.parse(raw!).reservationId as string; expect(id).toBeTruthy();
    await runtime.sqlAsync("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND organisation_id='org-a';");
    held.release();
    await expect(page.getByText('This engagement is no longer available to you.', { exact: false })).toBeVisible();
    const denied = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence/${id}?${scope}`, { headers: { 'X-Expected-Session': current.csrf_token } });
    expect([403, 404]).toContain(denied.status());
    await runtime.sqlAsync(restore);
    const registered = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence?${scope}`);
    expect(registered.status()).toBe(200); expect((await registered.json()).items).toHaveLength(0);
    const foreign = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence/${id}?organisation_id=org-b&client_id=client-b`);
    expect([403, 404]).toContain(foreign.status());
  } finally { held.release(); }
});

test('routine same-session access checks retain an in-flight upload, inspection, file control and focus', async ({ page }) => {
  await signIn(page); await openEvidence(page);
  const held = runtime.evidence!.holdNext('PUT');
  try {
    const input = page.getByLabel('Original file (up to 10 MiB)', { exact: true });
    await input.setInputFiles(original); await input.evaluate(element => { element.setAttribute('data-retained-file', 'same-node'); });
    await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click(); await held.entered;
    const checked = page.waitForResponse(response => response.url().includes('/api/engagements/engagement-a/evidence?') && response.status() === 200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await checked;
    await expect(page.getByRole('heading', { name: 'Finish reserved acquisition' })).toBeVisible();
    await expect(page.locator('[data-retained-file="same-node"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Retry same reservation' })).toBeDisabled();
    held.release(); await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Read bounded preview' }).click();
    await expect(page.locator('.evidence-preview')).toBeVisible();
    const download = page.getByRole('button', { name: 'Download verified original' }); await download.focus();
    await download.evaluate(element => { element.setAttribute('data-retained-download', 'same-node'); });
    const next = page.waitForResponse(response => response.url().includes('/api/engagements/engagement-a/evidence?') && response.status() === 200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await next;
    await expect(page.locator('.evidence-preview')).toHaveText(original.buffer.toString());
    await expect(download).toHaveAttribute('data-retained-download', 'same-node'); await expect(download).toBeFocused();
  } finally { held.release(); }
});

test('registry and recovery pages stay bounded and new registration refreshes canonical ordering and cursor', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page); const session = await currentSession(page);
  const headers = { Origin: runtime.url, 'X-CSRF-Token': session.csrf_token, 'X-Expected-Session': session.csrf_token };
  const bytes = Buffer.from('Bounded page original\n');
  const identity = { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  const source = { system: null, account: null, source_version: null, selection: null, coverage: null };
  for (let index = 0; index < 102; index++) {
    const response = await page.request.post(`${runtime.url}/api/engagements/engagement-a/evidence-reservations?${scope}`, {
      headers, data: { key: `bounded-page-${index}`, filename: `bounded-page-${index}.txt`, identity, source },
    });
    expect(response.status()).toBe(200);
    if (index < 51) {
      const { id } = await response.json();
      const upload = await page.request.put(`${runtime.url}/api/engagements/engagement-a/evidence-reservations/${id}/upload?${scope}`, {
        headers: { ...headers, 'Content-Type': 'application/octet-stream' }, data: bytes,
      });
      expect(upload.status()).toBe(200);
    }
  }
  await openEvidence(page); await expect(page.locator('.evidence-registry li')).toHaveCount(50);
  await page.getByRole('button', { name: 'More evidence', exact: true }).click(); await expect(page.locator('.evidence-registry li')).toHaveCount(1);
  await page.locator('.evidence-recovery summary').click(); await expect(page.locator('.evidence-recovery li')).toHaveCount(50);
  await page.getByRole('button', { name: 'More incomplete reservations', exact: true }).click(); await expect(page.locator('.evidence-recovery li')).toHaveCount(1);
  const laterIds = await page.locator('.evidence-open-item').evaluateAll(elements => elements.map(element => element.getAttribute('data-evidence-id')));
  const laterReservation = await page.locator('.evidence-recovery li > span').innerText();
  const checked = page.waitForResponse(response => response.url().includes('/api/engagements/engagement-a/evidence?') && response.url().includes('after=') && response.status() === 200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await checked;
  await expect(page.locator('.evidence-registry li')).toHaveCount(1);
  expect(await page.locator('.evidence-open-item').evaluateAll(elements => elements.map(element => element.getAttribute('data-evidence-id')))).toEqual(laterIds);
  await expect(page.locator('.evidence-recovery li > span')).toHaveText(laterReservation);
  await page.getByRole('button', { name: 'Previous evidence', exact: true }).click(); await expect(page.locator('.evidence-registry li')).toHaveCount(50);
  await page.setViewportSize({ width: 390, height: 844 });
  const opener = page.locator('.evidence-open-item').last();
  const selectedId = await opener.getAttribute('data-evidence-id');
  await opener.focus(); await page.keyboard.press('Enter');
  const heading = page.getByRole('region', { name: 'Evidence details' }).getByRole('heading', { level: 3 });
  await expect(heading).toBeFocused(); await expect(heading).toBeInViewport();
  await expect(page.getByRole('region', { name: 'Evidence details' })).toContainText(selectedId!);
  await page.getByRole('button', { name: 'Back to evidence list', exact: true }).click();
  await expect(opener).toBeFocused(); await expect(opener).toBeInViewport();
  await page.getByRole('button', { name: 'More evidence', exact: true }).click(); await expect(page.locator('.evidence-registry li')).toHaveCount(1);
  await page.getByRole('button', { name: 'First evidence page', exact: true }).click(); await expect(page.locator('.evidence-registry li')).toHaveCount(50);
  await page.getByRole('button', { name: 'Previous incomplete reservations', exact: true }).click(); await expect(page.locator('.evidence-recovery li')).toHaveCount(50);
  await page.getByRole('button', { name: 'More incomplete reservations', exact: true }).click(); await expect(page.locator('.evidence-recovery li')).toHaveCount(1);
  await page.getByRole('button', { name: 'First incomplete reservations', exact: true }).click(); await expect(page.locator('.evidence-recovery li')).toHaveCount(50);
  await acquire(page); await expect(page.locator('.evidence-registry li')).toHaveCount(50); await expect(page.locator('.evidence-recovery li')).toHaveCount(50);
  const fresh = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence?${scope}`);
  expect(fresh.status()).toBe(200); const expected = await fresh.json();
  const ids = await page.locator('.evidence-open-item').evaluateAll(elements => elements.map(element => element.getAttribute('data-evidence-id')));
  expect(ids).toEqual(expected.items.map((item: Evidence) => item.reservation.id)); expect(ids).toEqual([...ids].sort());
  await page.getByRole('button', { name: 'More evidence', exact: true }).click(); await expect(page.locator('.evidence-registry li')).toHaveCount(2);

  // Another tab can complete the final item on a later recovery page. The
  // preserved empty cursor must still provide access to earlier reservations.
  await page.getByRole('button', { name: 'More incomplete reservations', exact: true }).click();
  await expect(page.locator('.evidence-recovery li')).toHaveCount(1);
  const firstPending = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence-reservations?${scope}`);
  expect(firstPending.status()).toBe(200);
  const pendingCursor = (await firstPending.json()).next_cursor;
  const lastPending = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence-reservations?${scope}&after=${encodeURIComponent(pendingCursor)}`);
  expect(lastPending.status()).toBe(200);
  const pendingItems = (await lastPending.json()).items;
  expect(pendingItems).toHaveLength(1);
  const completedElsewhere = await page.request.put(`${runtime.url}/api/engagements/engagement-a/evidence-reservations/${pendingItems[0].id}/upload?${scope}`, {
    headers: { ...headers, 'Content-Type': 'application/octet-stream' }, data: bytes,
  });
  expect(completedElsewhere.status()).toBe(200);
  await page.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
  await expect(page.locator('.evidence-recovery li')).toHaveCount(0);
  await expect(page.getByText('No incomplete reservations on this page. Return to an earlier page to continue.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous incomplete reservations', exact: true }).click();
  await expect(page.locator('.evidence-recovery li')).toHaveCount(50);
  await expect(page.getByRole('button', { name: 'First incomplete reservations', exact: true })).toHaveCount(0);
});

test('registered provenance remains inspectable when storage configuration or original bytes are unavailable', async ({ page }) => {
  await signIn(page); await openEvidence(page); const item = await acquire(page);
  try {
    await runtime.restartApi({ evidence: false });
    await page.getByRole('button', { name: 'Refresh evidence' }).click();
    await expect(page.getByText('Original acquisition and downloads are unavailable.', { exact: false })).toBeVisible();
    await page.locator('.evidence-open-item').filter({ hasText: original.name }).click();
    await expect(page.getByRole('region', { name: 'Evidence details' })).toContainText(item.reservation.id);
    await expect(page.getByRole('button', { name: 'Download verified original' })).toBeDisabled();
    await expect(page.getByText('Metadata verified. Original bytes are unavailable.', { exact: true })).toBeVisible();
  } finally { await runtime.restartApi({ evidence: true }); }
  await page.getByRole('button', { name: 'Refresh evidence' }).click();
  await expect(page.getByRole('button', { name: 'Download verified original' })).toBeEnabled();
  runtime.evidence!.faultNext('corrupt-get');
  await page.getByRole('button', { name: 'Read bounded preview' }).click();
  await expect(page.locator('.evidence-pane').getByRole('alert')).toHaveText('The original is unavailable. Verified access still permits inspection of its registered provenance.');
  await expect(page.getByRole('region', { name: 'Evidence details' })).toContainText(item.reservation.id);
  await expect(page.locator('.evidence-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Read bounded preview' }).click();
  await expect(page.locator('.evidence-preview')).toHaveText(original.buffer.toString());
});

test('failed current-authority recheck hides all evidence while retaining same-session retry', async ({ page }) => {
  await signIn(page); await openEvidence(page); const item = await acquire(page); await retainUncertainDraft(page);
  const before = await page.evaluate(() => sessionStorage.getItem('zobba.evidence-draft.v1'));
  const responseGate = gate(); let held = false;
  const pattern = `**/api/engagements/engagement-a/evidence/${item.reservation.id}?*`;
  await page.route(pattern, async route => { const response = await route.fetch(); expect(response.status()).toBe(200); held = true; await responseGate.held; await route.fulfill({ response }); });
  try {
    await page.locator('.evidence-open-item').filter({ hasText: original.name }).click(); await expect.poll(() => held).toBe(true);
    await page.route('**/api/auth/session', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }));
    responseGate.release();
    await expect(page.locator('.evidence-private')).toBeHidden();
    await expect(page.locator('.evidence-pane > [role="status"]')).toContainText('Evidence is unavailable or delivery could not be confirmed.');
    await expect(page.getByRole('region', { name: 'Evidence details' })).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('zobba.evidence-draft.v1'))).toBe(before);
  } finally { responseGate.release(); await page.unroute(pattern); await page.unroute('**/api/auth/session'); }
  await page.getByRole('button', { name: 'Retry evidence' }).click();
  await expect(page.getByRole('heading', { name: 'Finish reserved acquisition' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('zobba.evidence-draft.v1'))).toBe(before);
});

test('asynchronous administration allows a blocked evidence transaction to commit through the database proxy', async ({ page }) => {
  await signIn(page); const session = await currentSession(page);
  const barrier = runtime.sqlAsync("BEGIN; SET LOCAL application_name='zobba_evidence_browser_session_barrier'; SELECT token_hash FROM public.sessions WHERE actor_id='actor-a' FOR UPDATE; SELECT pg_sleep(4); COMMIT;");
  let metadata: Promise<import('@playwright/test').APIResponse> | undefined;
  let mutation: Promise<void> | undefined;
  const waitFor = (predicate: string) => runtime.sqlAsync(`DO $$ DECLARE deadline timestamptz:=clock_timestamp()+interval '2 seconds'; BEGIN LOOP PERFORM pg_stat_clear_snapshot(); IF EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND ${predicate}) THEN RETURN; END IF; IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'Owned evidence lock observation timed out'; END IF; PERFORM pg_sleep(0.01); END LOOP; END $$;`);
  try {
    await waitFor("application_name='zobba_evidence_browser_session_barrier' AND wait_event='PgSleep'");
    metadata = page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence?${scope}`, { headers: { 'X-Expected-Session': session.csrf_token } });
    await waitFor("query LIKE 'SELECT public.evidence_session_locked(%' AND wait_event_type='Lock'");
    mutation = runtime.sqlAsync("BEGIN; SET LOCAL application_name='zobba_evidence_browser_waiting_admin'; UPDATE public.identities SET display_name=display_name WHERE id='actor-a'; COMMIT;");
    await waitFor("application_name='zobba_evidence_browser_waiting_admin' AND wait_event_type='Lock'");
    const [, response] = await Promise.all([barrier, metadata, mutation]);
    expect(response.status()).toBe(200); expect((await response.json()).items).toEqual([]);
  } finally { await Promise.allSettled([barrier, ...(metadata ? [metadata] : []), ...(mutation ? [mutation] : [])]); }
});
