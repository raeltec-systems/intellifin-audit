import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { Evidence } from '../../src/evidence';
import type { KnowledgePage, KnowledgeReceipt } from '../../src/knowledge';
import { startAuthRuntime } from '../browser/auth-runtime';
import type { AuthRuntime } from '../browser/auth-runtime';

test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const query = 'organisation_id=org-a&client_id=client-a';
test.beforeAll(async () => {
  const cli = process.env.ZOBBA_TEST_SCHEMA9_CLI, api = process.env.ZOBBA_TEST_SCHEMA9_API;
  if (!cli || !api) throw new Error('Historical acquisition proof requires independently built baseline schema9 CLI/API artifacts; see tests/browser/README.md.');
  runtime = await startAuthRuntime({ evidence: true, schema9: { cli, api } });
});
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'wait' }); });
test.afterAll(async () => { if (runtime) await runtime.close(); });
async function headers(page: Page) {
  const response = await page.request.get(`${runtime.url}/api/auth/session`); expect(response.status()).toBe(200); const session = await response.json();
  return { Origin: runtime.url, 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, 'X-Expected-Session': session.csrf_token };
}

test('accepted schema9 public acquisition survives upgrade and current UI capture recovery with exact deduplication', async ({ page }, info) => {
  await page.goto(`${runtime.url}/api/auth/login`);
  await page.getByLabel('Account', { exact: true }).selectOption('manager-a');
  await page.getByLabel('Password', { exact: true }).fill(runtime.password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect.poll(async () => (await page.request.get(`${runtime.url}/api/auth/session`)).status()).toBe(200);
  const bytes = Buffer.from('\ufeffHistorical accepted original\r\n😀 ledger source\r\n'), digest = createHash('sha256').update(bytes).digest('hex');
  const request = { key: crypto.randomUUID(), filename: 'schema9-accepted-original.txt', identity: { sha256: digest, size: bytes.length }, source: { system: 'Management ledger assertion', account: null, source_version: 'asserted-version-7', selection: null, coverage: null } };
  const reservationResponse = await page.request.post(`${runtime.url}/api/engagements/engagement-a/evidence-reservations?${query}`, { headers: await headers(page), data: request });
  expect(reservationResponse.status()).toBe(200); const reservation = await reservationResponse.json();
  const uploadUrl = `${runtime.url}/api/engagements/engagement-a/evidence-reservations/${reservation.id}/upload?${query}`;
  const uploaded = await page.request.put(uploadUrl, { headers: { ...await headers(page), 'Content-Type': 'application/octet-stream' }, data: bytes });
  expect(uploaded.status()).toBe(200); const original = await uploaded.json() as Evidence;
  expect(original.reservation.request).toEqual(request); expect(runtime.evidence!.stats().objects).toBe(1);
  const beforeDownload = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence/${reservation.id}/download?${query}`);
  expect(beforeDownload.status()).toBe(200); expect(await beforeDownload.body()).toEqual(bytes);
  const oldSession = await headers(page);

  // Actual schema9 API is stopped; current migration and API start against the
  // same durable original and object version. No knowledge row is seeded/deleted.
  await runtime.upgradeKnowledgeSchema(); expect(await headers(page)).toEqual(oldSession);
  const sourceUrl = `${runtime.url}/api/engagements/engagement-a/knowledge/evidence/${reservation.id}?${query}`;
  const missing = await page.request.get(sourceUrl); expect(missing.status()).toBe(200);
  expect(await missing.json()).toMatchObject({ evidence_id: reservation.id, capture_revision: '0', omissions: ['legacy_not_captured'] });
  const created = await page.request.post(`${runtime.url}/api/engagements/engagement-a/task-commands?${query}`, { headers: await headers(page), data: { key: crypto.randomUUID(), kind: 'create', task_id: null, cycle_id: null, content: 'Recover knowledge for the accepted historical original' } });
  expect(created.status()).toBe(202); const task = (await created.json()).task_id as string;
  const knowledgeUrl = `${runtime.url}/api/engagements/engagement-a/tasks/${task}/knowledge?${query}`;
  const beforeKnowledge = await page.request.get(knowledgeUrl); expect(beforeKnowledge.status()).toBe(200);
  expect((await beforeKnowledge.json() as KnowledgePage).items).toHaveLength(0);
  await page.goto(`${runtime.url}/?organisation_id=org-a&client_id=client-a&engagement_id=engagement-a`);
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Evidence', exact: true }).click(); await page.locator(`[data-evidence-id="${reservation.id}"]`).click();
  const source = page.getByRole('region', { name: 'Source working knowledge', exact: true });
  await expect(source.getByRole('list', { name: 'Source capture limitations', exact: true })).toContainText('capture');
  let recovery: object | undefined, receipt: KnowledgeReceipt | undefined;
  const pattern = `**/api/engagements/engagement-a/knowledge/evidence/${reservation.id}/recover?*`;
  await page.route(pattern, async route => { recovery = route.request().postDataJSON(); const response = await route.fetch(); expect(response.status()).toBe(200); receipt = await response.json(); await route.fulfill({ response }); });
  await source.getByRole('button', { name: 'Check or recover automatic source capture', exact: true }).click();
  await expect(source.getByRole('status')).toContainText('Capture checked · event'); expect(receipt).toBeTruthy();
  await page.unroute(pattern);
  const recovered = await page.request.get(knowledgeUrl); expect(recovered.status()).toBe(200); const capture = await recovered.json() as KnowledgePage;
  expect(capture.items).toHaveLength(3);
  expect(capture.items.find(item => item.record.kind === 'observation')?.record).toMatchObject({ text: bytes.toString(), source: { evidence_id: reservation.id, storage_version: original.version, digest, byte_start: 0, byte_end: bytes.length, original_size: bytes.length, partial: false } });
  expect(capture.items.filter(item => item.record.kind === 'assertion').map(item => [item.record.source?.field_path, item.record.text]).sort()).toEqual([['source.source_version', request.source.source_version], ['source.system', request.source.system]]);
  const capturedStatus = await page.request.get(sourceUrl); expect(capturedStatus.status()).toBe(200); const status = await capturedStatus.json(); expect(status.omissions).toEqual([]);
  await runtime.restartApi();
  const recoveryUrl = `${runtime.url}/api/engagements/engagement-a/knowledge/evidence/${reservation.id}/recover?${query}`;
  const exactRetry = await page.request.post(recoveryUrl, { headers: await headers(page), data: recovery }); expect(exactRetry.status()).toBe(200); expect(await exactRetry.json()).toEqual(receipt);
  const secondKey = await page.request.post(recoveryUrl, { headers: await headers(page), data: { key: crypto.randomUUID() } }); expect(secondKey.status()).toBe(200);
  const originalRetry = await page.request.put(uploadUrl, { headers: { ...await headers(page), 'Content-Type': 'application/octet-stream' }, data: bytes }); expect(originalRetry.status()).toBe(200); expect(await originalRetry.json()).toEqual(original);
  const finalKnowledge = await page.request.get(knowledgeUrl); expect(finalKnowledge.status()).toBe(200); const final = await finalKnowledge.json() as KnowledgePage;
  expect(final.items.map(item => item.record).sort((a, b) => a.id.localeCompare(b.id))).toEqual(capture.items.map(item => item.record).sort((a, b) => a.id.localeCompare(b.id)));
  const finalStatus = await page.request.get(sourceUrl); expect(await finalStatus.json()).toEqual(status);
  const finalDownload = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence/${reservation.id}/download?${query}`); expect(finalDownload.status()).toBe(200); expect(await finalDownload.body()).toEqual(bytes);
  expect(runtime.evidence!.stats().objects).toBe(1);
  await info.attach('legacy-public-capture-proof', { contentType: 'application/json', body: JSON.stringify({ baseline: 'd38e1daed736415ef13e7606345dac71bd1d9f01', source_bytes: bytes.length, digest, version: original.version, old_capture_revision: '0', captured_records: final.items.length, exact_recovery_retry: true, second_key_no_duplicate_capture: true, original_receipt_unchanged: true, original_bytes_unchanged: true, api_restarted_after_recovery: true }, null, 2) });
});
