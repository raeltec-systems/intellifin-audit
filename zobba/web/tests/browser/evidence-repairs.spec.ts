import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import type { Session } from '../../src/auth';
import type { Evidence, Reservation, ReservationRequest } from '../../src/evidence';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';

// Real HTTPS OIDC, guarded PostgreSQL and the test-only S3 protocol composition.
// No Browser plugin is available; use the repository's owned Playwright harness.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const scope = 'organisation_id=org-a&client_id=client-a';
const draftKey = 'zobba.evidence-draft.v1';
const original = { name: 'review-ledger.txt', mimeType: 'text/plain', buffer: Buffer.from('Verified repair original\n') };
const emptySource = { system: null, account: null, source_version: null, selection: null, coverage: null };
let pageErrors: string[];
test.beforeAll(async () => { runtime = await startAuthRuntime({ evidence: true }); });
test.beforeEach(async ({ page }) => {
  await runtime.sqlAsync('TRUNCATE public.evidence_reservations,public.tasks,public.task_counters CASCADE;');
  pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
});
test.afterEach(async ({ context }) => {
  for (const page of context.pages()) await page.getByLabel('Password', { exact: true }).fill('', { timeout: 100 }).catch(() => {});
  expect(pageErrors).toEqual([]);
});
test.afterAll(async () => { if (runtime) await runtime.close(); });
async function signIn(page: Page) {
  await page.goto(runtime.url); await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  await page.getByLabel('Account', { exact: true }).selectOption('auditor-a');
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
}
async function openEvidence(page: Page) {
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Registered originals', exact: true })).toBeVisible();
}
async function session(page: Page): Promise<Session> {
  const response = await page.request.get(`${runtime.url}/api/auth/session`);
  expect(response.status()).toBe(200); return response.json();
}
function identity(bytes = original.buffer) { return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; }
function fact(container: Locator, label: string) { return container.getByText(label, { exact: true }).locator('..').locator('dd'); }
async function draft(page: Page) { return page.evaluate(key => sessionStorage.getItem(key), draftKey); }
async function reserve(page: Page, current: Session, request: ReservationRequest): Promise<Reservation> {
  const response = await page.request.post(`${runtime.url}/api/engagements/engagement-a/evidence-reservations?${scope}`, {
    headers: { Origin: runtime.url, 'X-CSRF-Token': current.csrf_token, 'X-Expected-Session': current.csrf_token }, data: request,
  });
  expect(response.status()).toBe(200); return response.json();
}

test('R03 maximum escaped assertions survive a lost registered response and reload with the exact reservation key', async ({ page }) => {
  await signIn(page); await openEvidence(page);
  const escaped = '\\"'.repeat(1000);
  await page.getByText('Source assertions (optional)', { exact: true }).click();
  for (const label of ['Source system', 'Source account', 'Source version', 'Query or selection', 'Known coverage']) {
    await page.getByLabel(label, { exact: true }).fill(escaped);
  }
  const requests: ReservationRequest[] = [];
  await page.route('**/api/engagements/engagement-a/evidence-reservations?*', async route => {
    if (route.request().method() === 'POST') requests.push(route.request().postDataJSON());
    await route.continue();
  });
  const uploadPattern = '**/api/engagements/engagement-a/evidence-reservations/*/upload?*';
  let registered: Evidence | undefined;
  await page.route(uploadPattern, async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200); registered = await response.json();
    await route.abort('connectionreset');
  });
  const puts = runtime.evidence!.stats().puts;
  await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles(original);
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  await expect(page.locator('.evidence-pane').getByRole('alert')).toContainText('delivery could not be confirmed');
  expect(registered).toBeDefined(); expect(requests).toHaveLength(1);
  expect(Buffer.byteLength(JSON.stringify(requests[0]))).toBeGreaterThan(16 * 1024);
  const retained = await draft(page); expect(retained).not.toBeNull();
  await page.unroute(uploadPattern);
  await page.reload(); await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible(); await openEvidence(page);
  await expect(page.getByRole('heading', { name: 'Finish reserved acquisition' })).toBeVisible();
  expect(await draft(page)).toBe(retained);
  await page.getByLabel('Reselect identical original', { exact: true }).setInputFiles(original);
  await page.getByRole('button', { name: 'Retry same reservation', exact: true }).click();
  await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  const details = page.getByRole('region', { name: 'Evidence details' });
  await expect(fact(details, 'Evidence identity')).toHaveText(registered!.reservation.id);
  await expect(fact(details, 'Source version')).toHaveText(escaped);
  expect(runtime.evidence!.stats().puts).toBe(puts + 1);
});

test('R04 invalid UTF-8 source and filename bounds remain editable without creating or persisting a reservation', async ({ page }) => {
  await signIn(page); await openEvidence(page);
  let reservations = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/evidence-reservations?')) reservations++; });
  await page.getByText('Source assertions (optional)', { exact: true }).click();
  const source = page.getByLabel('Source system', { exact: true });
  await source.fill('界'.repeat(800));
  const file = page.getByLabel('Original file (up to 10 MiB)', { exact: true });
  await file.setInputFiles(original);
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  await expect(page.locator('.evidence-pane').getByRole('alert')).toHaveText('Source system is too long or contains unsupported characters. Edit it before acquiring the original.');
  await expect(source).toBeEnabled(); await expect(source).toHaveValue('界'.repeat(800));
  expect(reservations).toBe(0); expect(await draft(page)).toBeNull();
  await source.fill('Corrected assertion');
  await file.setInputFiles({ ...original, name: `${'界'.repeat(86)}.txt` });
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  await expect(page.locator('.evidence-pane').getByRole('alert')).toHaveText('The original filename is unsupported or too long. Rename the file before acquiring it.');
  await expect(file).toBeEnabled(); expect(reservations).toBe(0); expect(await draft(page)).toBeNull();
  await file.setInputFiles(original); await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible(); expect(reservations).toBe(1);
});

test('R05 an oversized local original gives size correction without network acquisition or a recovery draft', async ({ page }) => {
  await signIn(page); await openEvidence(page);
  let mutations = 0;
  page.on('request', request => { if (['POST', 'PUT'].includes(request.method()) && request.url().includes('/evidence-reservations')) mutations++; });
  const file = page.getByLabel('Original file (up to 10 MiB)', { exact: true });
  await file.setInputFiles({ ...original, buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  await expect(page.locator('.evidence-pane').getByRole('alert')).toHaveText('Choose an original of 10 MiB or less.');
  expect(mutations).toBe(0); expect(await draft(page)).toBeNull();
  await expect(page.getByRole('heading', { name: 'Finish reserved acquisition' })).toHaveCount(0);
  await file.setInputFiles(original); await expect(page.getByRole('button', { name: 'Acquire and verify original', exact: true })).toBeEnabled();
});

test('R06 durable reservation saturation explains finishing existing custody and has no transient Retry-After', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page); const current = await session(page);
  for (let index = 0; index < 100; index++) {
    await reserve(page, current, { key: `repair-quota-${index}`, filename: `quota-${index}.txt`, identity: identity(), source: emptySource });
  }
  await openEvidence(page);
  const refusal = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/evidence-reservations?'));
  await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles(original);
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  const response = await refusal;
  expect(response.status()).toBe(409); expect(response.headers()['retry-after']).toBeUndefined();
  expect(await response.json()).toEqual({ error: 'evidence_reservation_limit' });
  await expect(page.locator('.evidence-pane').getByRole('alert')).toHaveText('You have 100 incomplete acquisitions in this engagement. Finish an existing reservation before starting another. Waiting alone does not free a place.');
  await page.locator('.evidence-recovery summary').click();
  const row = page.locator('.evidence-recovery li').first(); const filename = await row.locator('span').innerText();
  await row.getByRole('button', { name: 'Recover reservation' }).click();
  await page.getByLabel('Reselect identical original', { exact: true }).setInputFiles({ ...original, name: filename });
  await page.getByRole('button', { name: 'Retry same reservation', exact: true }).click();
  await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible();
  await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles(original);
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Evidence details' }).getByRole('heading', { name: original.name, exact: true })).toBeVisible();
});

test('R08 an accepted registration remains certain when only the following evidence list refresh fails', async ({ page }) => {
  await signIn(page); await openEvidence(page);
  let registered: Evidence | undefined;
  const listPatterns = ['**/api/engagements/engagement-a/evidence?*', '**/api/engagements/engagement-a/evidence-reservations?*'];
  for (const pattern of listPatterns) await page.route(pattern, async route => {
    if (registered && route.request().method() === 'GET') await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"evidence_unavailable"}' });
    else await route.continue();
  });
  await page.route('**/api/engagements/engagement-a/evidence-reservations/*/upload?*', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200); registered = await response.json(); await route.fulfill({ response });
  });
  await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles(original);
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  await expect(page.locator('.evidence-pane').getByRole('alert')).toHaveText('The original is registered, but the evidence lists could not be refreshed. Refresh evidence to update the lists.');
  await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible();
  const details = page.getByRole('region', { name: 'Evidence details' });
  await expect(fact(details, 'Evidence identity')).toHaveText(registered!.reservation.id);
  await expect(fact(details, 'Measured SHA-256')).toHaveText(registered!.reservation.request.identity.sha256);
  await expect(fact(details, 'Verified storage version')).toHaveText(registered!.version);
  expect(await draft(page)).toBeNull(); await expect(page.getByRole('button', { name: 'Retry same reservation', exact: true })).toHaveCount(0);
  for (const pattern of listPatterns) await page.unroute(pattern);
  await page.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
  await expect(page.locator('.evidence-registry li')).toHaveCount(1);
  await expect(fact(details, 'Evidence identity')).toHaveText(registered!.reservation.id);
});

test('R10 same-name incomplete originals expose distinct immutable expected identity and assertions before any upload', async ({ page }) => {
  await signIn(page); const current = await session(page);
  const first = await reserve(page, current, { key: 'repair-pending-a', filename: 'same-name.txt', identity: identity(Buffer.from('First expected original')), source: { ...emptySource, account: 'Asserted account A', source_version: 'Asserted version A' } });
  const second = await reserve(page, current, { key: 'repair-pending-b', filename: 'same-name.txt', identity: identity(Buffer.from('Second different expected original')), source: { ...emptySource, account: 'Asserted account B', source_version: 'Asserted version B' } });
  const ordered = [first, second].sort((a, b) => a.id < b.id ? -1 : 1);
  await openEvidence(page); await page.locator('.evidence-recovery summary').click();
  const puts = runtime.evidence!.stats().puts;
  for (let index = 0; index < ordered.length; index++) {
    await page.locator('.evidence-recovery li').nth(index).getByRole('button', { name: 'Recover reservation' }).click();
    const details = page.locator('.evidence-reserved-details'); await details.locator('summary').click();
    await expect(details.getByText('Expected identity, not yet independently verified.', { exact: false })).toBeVisible();
    await expect(fact(details, 'Expected size')).toHaveText(`${ordered[index]!.request.identity.size} bytes`);
    await expect(fact(details, 'Expected SHA-256')).toHaveText(ordered[index]!.request.identity.sha256);
    await expect(fact(details, 'Source account')).toHaveText(ordered[index]!.request.source.account!);
    await expect(fact(details, 'Source version')).toHaveText(ordered[index]!.request.source.source_version!);
    await expect(fact(details, 'Known coverage')).toHaveText('Unknown');
    await expect(details.locator('input')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry same reservation', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Discard browser draft', exact: true }).click();
  }
  expect(runtime.evidence!.stats().puts).toBe(puts);
});
