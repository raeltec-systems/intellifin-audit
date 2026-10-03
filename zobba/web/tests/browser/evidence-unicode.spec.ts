import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import type { Session } from '../../src/auth';
import type { AcquisitionDraft, Evidence, Reservation, ReservationRequest } from '../../src/evidence';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';

// No Browser plugin is available. These regressions use the repository's real
// HTTPS OIDC, guarded disposable PostgreSQL and owned S3 protocol fixture.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const scope = 'organisation_id=org-a&client_id=client-a';
const draftKey = 'zobba.evidence-draft.v1';
const sourceLabels = {
  system: 'Source system', account: 'Source account', source_version: 'Source version',
  selection: 'Query or selection', coverage: 'Known coverage',
} as const;
const sourceKeys = Object.keys(sourceLabels) as (keyof typeof sourceLabels)[];
type Original = { name: string; mimeType: string; buffer: Buffer };
type OriginalCase = { file: Original; suggestedFilename: string; request: ReservationRequest };
let errors: string[];
let signingIn: boolean;

test.beforeAll(async () => {
  runtime = await startAuthRuntime({ evidence: true });
});
test.beforeEach(async ({ page }) => {
  await runtime.sqlAsync('TRUNCATE public.evidence_reservations,public.tasks,public.task_counters CASCADE;');
  errors = []; signingIn = true;
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return;
    // The initial anonymous session probe is the sole expected refusal. No
    // evidence request, later session refusal, warning or runtime error is exempt.
    if (signingIn && message.type() === 'error' &&
      message.location().url === `${runtime.url}/api/auth/session` &&
      /^Failed to load resource: the server responded with a status of 401 \((?:Unauthorized)?\)$/.test(message.text())) return;
    errors.push(`${message.type()}: ${message.text()}`);
  });
});
test.afterEach(async ({ context }, info) => {
  for (const page of context.pages()) await page.getByLabel('Password', { exact: true }).fill('', { timeout: 100 }).catch(() => {});
  // Persist only counts and the test outcome, never session tokens or URLs.
  await mkdir(info.outputDir, { recursive: true });
  try { expect(errors).toEqual([]); }
  finally {
    await writeFile(info.outputPath('unicode-console.json'),
      JSON.stringify({ test: info.title, status: errors.length ? 'failed' : info.status, unexpectedErrors: errors.length }, null, 2));
  }
});
test.afterAll(async () => { if (runtime) await runtime.close(); });

async function signIn(page: Page) {
  await page.goto(runtime.url);
  await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  await page.getByLabel('Account', { exact: true }).selectOption('auditor-a');
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  signingIn = false;
}
async function openEvidence(page: Page) {
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Registered originals', exact: true })).toBeVisible();
}
async function reloadEvidence(page: Page) {
  await page.reload();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  await openEvidence(page);
}
async function currentSession(page: Page): Promise<Session> {
  const response = await page.request.get(`${runtime.url}/api/auth/session`);
  expect(response.status()).toBe(200); return response.json();
}
function headers(session: Session) {
  return { Origin: runtime.url, 'X-CSRF-Token': session.csrf_token, 'X-Expected-Session': session.csrf_token };
}
function originalCases(prefix: 'unicode-registered' | 'unicode-pending'): OriginalCase[] {
  // Chromium suggests "download" for the FEFF-only fixture's "_" attachment.
  const attachmentNames = {
    'unicode-registered': ['unicode-registered-normal.txt', '_unicode-registered-leading.txt', 'unicode-registered-trailing.txt_', 'uni_code-registered-internal.txt', 'download'],
    'unicode-pending': ['unicode-pending-normal.txt', '_unicode-pending-leading.txt', 'unicode-pending-trailing.txt_', 'uni_code-pending-internal.txt', 'download'],
  };
  const variants = [
    { name: 'normal', value: (value: string) => value },
    { name: 'leading', value: (value: string) => `\uFEFF${value}` },
    { name: 'trailing', value: (value: string) => `${value}\uFEFF` },
    { name: 'internal', value: (value: string) => `${value.slice(0, 3)}\uFEFF${value.slice(3)}` },
    { name: 'alone', value: (_value: string) => '\uFEFF' },
  ];
  return variants.map((variant, index) => {
    const file = { name: variant.value(`${prefix}-${variant.name}.txt`), mimeType: 'text/plain',
      buffer: Buffer.from(`Immutable ${prefix} ${variant.name} original\nDebit 42\nCredit 42\n`) };
    return { file, suggestedFilename: attachmentNames[prefix][index]!, request: {
      key: `${prefix}-${variant.name}`, filename: file.name,
      identity: { size: file.buffer.length, sha256: createHash('sha256').update(file.buffer).digest('hex') },
      source: Object.fromEntries(sourceKeys.map(key => [key, variant.value(`${key}-${variant.name}`)])) as ReservationRequest['source'],
    } };
  });
}
async function reserve(page: Page, session: Session, request: ReservationRequest): Promise<Reservation> {
  const response = await page.request.post(`${runtime.url}/api/engagements/engagement-a/evidence-reservations?${scope}`, {
    headers: headers(session), data: request,
  });
  expect(response.status()).toBe(200);
  const reservation: Reservation = await response.json();
  expect(reservation.request).toEqual(request);
  return reservation;
}
async function upload(page: Page, session: Session, reservation: Reservation, file: Original): Promise<Evidence> {
  const response = await page.request.put(`${runtime.url}/api/engagements/engagement-a/evidence-reservations/${reservation.id}/upload?${scope}`, {
    headers: { ...headers(session), 'Content-Type': 'application/octet-stream' }, data: file.buffer,
  });
  expect(response.status()).toBe(200);
  const item: Evidence = await response.json();
  expect(item.reservation).toEqual(reservation);
  return item;
}
function fact(container: Locator, label: string) {
  return container.getByText(label, { exact: true }).locator('..').locator('dd');
}
async function exactSource(container: Locator, source: ReservationRequest['source']) {
  // Playwright text matchers normalize whitespace, including U+FEFF. Read raw
  // DOM text so a stripped/changed accepted value cannot pass this regression.
  for (const key of sourceKeys) {
    await expect.poll(() => fact(container, sourceLabels[key]).textContent()).toBe(source[key] ?? 'Unknown');
  }
}
async function draft(page: Page) {
  return page.evaluate(key => sessionStorage.getItem(key), draftKey);
}
async function exactRegistry(page: Page, reservations: Reservation[]) {
  const ordered = [...reservations].sort((a, b) => a.id < b.id ? -1 : 1);
  await expect.poll(() => page.locator('.evidence-open-item').evaluateAll(elements => elements.map(element => ({
    id: element.getAttribute('data-evidence-id'), filename: element.querySelector('strong')!.textContent,
  })))).toEqual(ordered.map(reservation => ({ id: reservation.id, filename: reservation.request.filename })));
}
async function inspectAndDownload(page: Page, reservation: Reservation, file: Original, suggestedFilename: string) {
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence/${reservation.id}?${scope}`);
  expect(response.status()).toBe(200);
  const item: Evidence = await response.json();
  expect(item.reservation).toEqual(reservation);
  await page.locator(`[data-evidence-id="${reservation.id}"]`).click();
  const details = page.getByRole('region', { name: 'Evidence details' });
  await expect.poll(() => details.getByRole('heading', { level: 3 }).textContent()).toBe(file.name);
  await expect.poll(() => fact(details, 'Evidence identity').textContent()).toBe(reservation.id);
  await expect.poll(() => fact(details, 'Measured SHA-256').textContent()).toBe(reservation.request.identity.sha256);
  await expect.poll(() => fact(details, 'Measured size').textContent()).toBe(`${file.buffer.length} bytes`);
  await expect.poll(() => fact(details, 'Verified storage version').textContent()).toBe(item.version);
  await exactSource(details, reservation.request.source);
  if (file.name.endsWith('.txt')) {
    await expect.poll(() => page.locator('.evidence-preview').textContent()).toBe(file.buffer.toString('utf8'));
  } else {
    // Trailing FEFF and FEFF-only names do not have a supported text suffix.
    await expect(details.getByText('Download only. This original has no supported inert plain-text preview.', { exact: true })).toBeVisible();
    await expect(page.locator('.evidence-preview')).toHaveCount(0);
  }
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download verified original', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(suggestedFilename);
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(file.buffer);
  expect(await download.failure()).toBeNull();
  // Download filename sanitation is a separate contract; immutable metadata
  // above and the downloaded bytes must remain exact even for FEFF-only names.
  await expect(page.locator('.evidence-pane').getByRole('alert')).toHaveCount(0);
}

test('mixed API-created normal and FEFF originals retain exact metadata and download bytes', async ({ page }, info) => {
  await signIn(page);
  const session = await currentSession(page);
  const originals = originalCases('unicode-registered');
  const registered: Evidence[] = [];
  for (const original of originals) {
    const reservation = await reserve(page, session, original.request);
    registered.push(await upload(page, session, reservation, original.file));
  }
  await openEvidence(page);
  await exactRegistry(page, registered.map(item => item.reservation));
  for (let index = 0; index < originals.length; index++) {
    await inspectAndDownload(page, registered[index]!.reservation, originals[index]!.file, originals[index]!.suggestedFilename);
  }
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence?${scope}`);
  expect(response.status()).toBe(200);
  const listed: Evidence[] = (await response.json()).items;
  expect(listed).toEqual([...registered].sort((a, b) => a.reservation.id < b.reservation.id ? -1 : 1));
  await page.getByRole('button', { name: 'Back to evidence list', exact: true }).click();
  await page.locator('.evidence-pane').evaluate(element => { element.scrollTop = 0; });
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath('mixed-registered-originals.png'), fullPage: true });
  await page.locator('.evidence-registry').evaluate(element => element.scrollIntoView({ block: 'start' }));
  // Complete provenance makes the registered list taller than its scroll pane.
  // Every row must be fully readable when reached, not fit simultaneously.
  for (const item of registered) {
    const row = page.locator(`[data-evidence-id="${item.reservation.id}"]`);
    await row.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await expect(row).toBeInViewport({ ratio: 1 });
  }
  await page.screenshot({ path: info.outputPath('mixed-affected-registry.png'), fullPage: true });
});

test('mixed API-created pending reservations recover exact drafts after reload and register the same originals', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  const session = await currentSession(page);
  const originals = originalCases('unicode-pending');
  const pending: Reservation[] = [];
  for (const original of originals) pending.push(await reserve(page, session, original.request));
  const puts = runtime.evidence!.stats().puts;
  const retried: ReservationRequest[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/engagements/engagement-a/evidence-reservations') {
      retried.push(request.postDataJSON());
    }
  });
  await reloadEvidence(page);
  await expect(page.locator('.evidence-registry li')).toHaveCount(0);
  const completed: Reservation[] = [];
  for (let index = 0; index < pending.length; index++) {
    const reservation = pending[index]!;
    const remaining = pending.slice(index).sort((a, b) => a.id < b.id ? -1 : 1);
    const recovery = page.locator('.evidence-recovery');
    await recovery.evaluate(element => { (element as HTMLDetailsElement).open = true; });
    await expect.poll(() => recovery.locator('li > span').allTextContents()).toEqual(remaining.map(item => item.request.filename));
    const rowIndex = remaining.findIndex(item => item.id === reservation.id);
    await recovery.locator('li').nth(rowIndex).getByRole('button', { name: 'Recover reservation', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Finish reserved acquisition', exact: true })).toBeVisible();
    const retained = await draft(page);
    expect(retained).not.toBeNull();
    const parsed: AcquisitionDraft = JSON.parse(retained!);
    expect(parsed.reservationId).toBe(reservation.id);
    expect(parsed.request).toEqual(originals[index]!.request);
    expect(parsed.audience).toMatch(/^[0-9a-f]{64}$/);
    await reloadEvidence(page);
    await expect(page.getByRole('heading', { name: 'Finish reserved acquisition', exact: true })).toBeVisible();
    expect(await draft(page)).toBe(retained);
    await expect.poll(() => page.locator('.evidence-acquisition .notice strong').textContent()).toBe(reservation.request.filename);
    const details = page.locator('.evidence-reserved-details');
    await details.locator('summary').click();
    await exactSource(details, reservation.request.source);
    await expect.poll(() => fact(details, 'Expected SHA-256').textContent()).toBe(reservation.request.identity.sha256);
    await expect.poll(() => fact(details, 'Expected size').textContent()).toBe(`${reservation.request.identity.size} bytes`);
    await page.getByLabel('Reselect identical original', { exact: true }).setInputFiles(originals[index]!.file);
    await page.getByRole('button', { name: 'Retry same reservation', exact: true }).click();
    await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible();
    expect(retried).toEqual(originals.slice(0, index + 1).map(original => original.request));
    expect(await draft(page)).toBeNull();
    completed.push(reservation);
    await exactRegistry(page, completed);
    await inspectAndDownload(page, reservation, originals[index]!.file, originals[index]!.suggestedFilename);
  }
  expect(runtime.evidence!.stats().puts).toBe(puts + pending.length);
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence-reservations?${scope}`);
  expect(response.status()).toBe(200);
  expect((await response.json()).items).toEqual([]);
  await reloadEvidence(page);
  await exactRegistry(page, pending);
  await expect(page.locator('.evidence-recovery li')).toHaveCount(0);
  expect(await draft(page)).toBeNull();
});

test('new source entry trims Rust whitespace and preserves FEFF in all five assertion fields', async ({ page }) => {
  await signIn(page); await openEvidence(page);
  const entered = {
    system: '\u2003\uFEFFsystem\u00A0', account: '\u0085account\uFEFF\u202F',
    source_version: '\u3000v\uFEFF7\u2000', selection: '\u00A0\uFEFF\u0085',
    coverage: '\uFEFF coverage \uFEFF',
  };
  const expected = {
    system: '\uFEFFsystem', account: 'account\uFEFF', source_version: 'v\uFEFF7',
    selection: '\uFEFF', coverage: '\uFEFF coverage \uFEFF',
  };
  await page.getByText('Source assertions (optional)', { exact: true }).click();
  for (const key of sourceKeys) {
    const input = page.getByLabel(sourceLabels[key], { exact: true });
    await input.fill(entered[key]);
    expect(await input.inputValue()).toBe(entered[key]);
  }
  const file = { name: '\uFEFFnew-unicode-assertions.txt', mimeType: 'text/plain', buffer: Buffer.from('New source assertion original\n') };
  const reserved = page.waitForResponse(response => response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/engagements/engagement-a/evidence-reservations', { timeout: 12_000 });
  await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles(file);
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  const response = await reserved;
  expect(response.status()).toBe(200);
  const request: ReservationRequest = response.request().postDataJSON();
  expect(request.filename).toBe('\uFEFFnew-unicode-assertions.txt');
  expect(request.source).toEqual(expected);
  await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible();
  // The real UI must consume the receipt before inspecting canonical custody;
  // avoid Chromium's transient response-body cache for this observation.
  const registry = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence?${scope}`);
  expect(registry.status()).toBe(200);
  const persisted: Evidence[] = (await registry.json()).items;
  const matching = persisted.filter(item => item.reservation.request.key === request.key);
  expect(matching).toHaveLength(1);
  const reservation = matching[0]!.reservation;
  expect(reservation.request).toEqual(request);
  await exactRegistry(page, [reservation]);
  await inspectAndDownload(page, reservation, file, '_new-unicode-assertions.txt');
  expect(await draft(page)).toBeNull();
});
