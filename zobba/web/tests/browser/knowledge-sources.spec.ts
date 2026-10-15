import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { Evidence } from '../../src/evidence';
import type { KnowledgePage, KnowledgeReceipt } from '../../src/knowledge';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';

test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const query = 'organisation_id=org-a&client_id=client-a';
test.beforeAll(async () => { runtime = await startAuthRuntime({ evidence: true }); });
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'wait' }); });
test.afterAll(async () => { if (runtime) await runtime.close(); });

async function signIn(page: Page) {
  await page.goto(`${runtime.url}/api/auth/login`);
  await page.getByLabel('Account', { exact: true }).selectOption('manager-a');
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
}
async function headers(page: Page) {
  const response = await page.request.get(`${runtime.url}/api/auth/session`); expect(response.status()).toBe(200);
  const session = await response.json();
  return { Origin: runtime.url, 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, 'X-Expected-Session': session.csrf_token };
}
async function createTask(page: Page, objective: string) {
  const response = await page.request.post(`${runtime.url}/api/engagements/engagement-a/task-commands?${query}`, { headers: await headers(page), data: { key: crypto.randomUUID(), kind: 'create', task_id: null, cycle_id: null, content: objective } });
  expect(response.status()).toBe(202); const id = (await response.json()).task_id as string;
  await page.getByRole('button', { name: `Open ${objective}`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record an assertion', exact: true })).toBeEnabled(); return id;
}
async function acquire(page: Page, name: string, bytes: Buffer) {
  if (!await page.getByRole('heading', { name: 'Registered originals', exact: true }).isVisible()) await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
  const uploaded = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/upload?'));
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click(); expect((await uploaded).status()).toBe(200);
  await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible();
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence?${query}`); expect(response.status()).toBe(200);
  return (await response.json()).items.find((item: Evidence) => item.reservation.request.filename === name) as Evidence;
}
async function knowledge(page: Page, task: string): Promise<KnowledgePage> {
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/tasks/${task}/knowledge?${query}`); expect(response.status()).toBe(200); return response.json();
}
async function download(page: Page, evidence: Evidence, bytes: Buffer) {
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence/${evidence.reservation.id}/download?${query}`);
  expect(response.status()).toBe(200); expect(await response.body()).toEqual(bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(evidence.reservation.request.identity.sha256);
}

test('unsupported originals with no captured records can be corrected through an explicitly selected Task', async ({ page }) => {
  await signIn(page); const task = await createTask(page, 'Correct an original without extracted knowledge');
  const beforeBytes = Buffer.from([0, 255, 1, 2, 3]), afterBytes = Buffer.from([0, 254, 4, 5, 6]);
  const before = await acquire(page, `unsupported-before-${crypto.randomUUID()}.bin`, beforeBytes);
  const after = await acquire(page, `unsupported-after-${crypto.randomUUID()}.bin`, afterBytes);
  expect(Object.values(before.reservation.request.source).every(value => value === null)).toBe(true);
  expect((await knowledge(page, task)).items.some(item => [before.reservation.id, after.reservation.id].includes(item.record.source?.evidence_id ?? ''))).toBe(false);
  await page.locator(`[data-evidence-id="${before.reservation.id}"]`).click();
  const source = page.getByRole('region', { name: 'Source working knowledge', exact: true });
  await source.getByText('Declare a replacement for this original', { exact: true }).click();
  await expect(source).toContainText(before.reservation.id);
  await source.getByRole('button', { name: 'Return to Task source correction', exact: true }).click();
  await page.getByRole('button', { name: 'Declare an original source correction', exact: true }).click();
  const form = page.getByRole('form', { name: 'Working knowledge change', exact: true });
  await form.getByLabel('Registered original to correct', { exact: true }).fill(before.reservation.id);
  await form.getByLabel('Replacement registered original ID', { exact: true }).fill(after.reservation.id);
  await form.getByLabel('Knowledge change reason', { exact: true }).fill('The provider replaced this unsupported original; preserve both originals.');
  const accepted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes(`/tasks/${task}/knowledge/commands?`));
  await expect(form.getByRole('button', { name: 'Record knowledge change', exact: true })).toBeEnabled();
  await form.getByRole('button', { name: 'Record knowledge change', exact: true }).click(); const response = await accepted;
  expect(response.status()).toBe(200); expect(response.request().postDataJSON().action).toMatchObject({ kind: 'correct_source', predecessor_id: before.reservation.id, replacement_id: after.reservation.id });
  await expect(form).toHaveCount(0);
  const status = await page.request.get(`${runtime.url}/api/engagements/engagement-a/knowledge/evidence/${before.reservation.id}?${query}`);
  expect(status.status()).toBe(200); expect(await status.json()).toMatchObject({ replacement_id: after.reservation.id, correction_actor_id: 'actor-manager' });
  await download(page, before, beforeBytes); await download(page, after, afterBytes);
});

test('public excerpt capture survives source I/O beyond twelve seconds and retains exact nonzero UTF-8 bytes', async ({ page }, info) => {
  await signIn(page); const task = await createTask(page, 'Inspect an exact range after bounded source I/O');
  const bytes = Buffer.from('\ufeffprefix\r\n😀 exact selected source\r\ntail');
  const original = await acquire(page, `nonzero-range-${crypto.randomUUID()}.txt`, bytes);
  const byteStart = Buffer.byteLength('\ufeffprefix\r\n'), byteEnd = bytes.length - Buffer.byteLength('tail');
  const source = page.getByRole('region', { name: 'Source working knowledge', exact: true });
  await source.getByText('Capture an exact source range', { exact: true }).click();
  await source.getByLabel('Original byte start', { exact: true }).fill(String(byteStart));
  await source.getByLabel('Original byte end (exclusive)', { exact: true }).fill(String(byteEnd));
  await expect(source.getByRole('button', { name: 'Capture exact registered excerpt', exact: true })).toBeEnabled();
  const originalObjects = runtime.evidence!.stats().objects, hold = runtime.evidence!.holdNext('GET');
  let receipt: KnowledgeReceipt | undefined, posted: object | undefined;
  await page.route('**/api/engagements/engagement-a/knowledge/excerpts?*', async route => {
    posted = route.request().postDataJSON(); const response = await route.fetch(); expect(response.status()).toBe(200);
    receipt = await response.json(); await route.fulfill({ response });
  });
  const started = Date.now();
  try {
    await source.getByRole('button', { name: 'Capture exact registered excerpt', exact: true }).click(); await hold.entered;
    await new Promise(resolve => setTimeout(resolve, 13_250));
    await expect(source.getByRole('button', { name: 'Capture exact registered excerpt', exact: true })).toBeDisabled();
    await expect(source.getByRole('button', { name: 'Retry exact source capture', exact: true })).toBeDisabled();
    hold.release();
    await expect(source.getByRole('status')).toContainText('Capture checked · event');
  } finally { hold.release(); }
  const elapsed = Date.now() - started; expect(elapsed).toBeGreaterThan(12_000); expect(receipt).toBeTruthy();
  expect(receipt!.record?.record).toMatchObject({ kind: 'observation', text: bytes.subarray(byteStart, byteEnd).toString(), source: { evidence_id: original.reservation.id, storage_version: original.version, digest: original.reservation.request.identity.sha256, byte_start: byteStart, byte_end: byteEnd, original_size: bytes.length, partial: true } });
  const endpoint = `${runtime.url}/api/engagements/engagement-a/knowledge/excerpts?${query}`;
  const replay = await page.request.post(endpoint, { headers: await headers(page), data: posted }); expect(replay.status()).toBe(200); expect(await replay.json()).toEqual(receipt);
  const invalid = await page.request.post(endpoint, { headers: await headers(page), data: { ...posted, key: crypto.randomUUID(), byte_start: byteStart + 1 } }); expect(invalid.status()).toBe(400);
  const current = await knowledge(page, task); expect(current.items.filter(item => item.record.id === receipt!.record!.record.id)).toHaveLength(1);
  expect(runtime.evidence!.stats().objects).toBe(originalObjects); await download(page, original, bytes);
  await info.attach('public-source-io-proof', { contentType: 'application/json', body: JSON.stringify({ elapsed_ms: elapsed, byte_start: byteStart, byte_end: byteEnd, selected_utf8: bytes.subarray(byteStart, byteEnd).toString(), exact_retry: true, original_unchanged: true }) });
});
