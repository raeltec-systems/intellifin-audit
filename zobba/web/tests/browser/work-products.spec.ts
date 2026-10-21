import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page, Request, TestInfo } from '@playwright/test';
import type { Evidence } from '../../src/evidence';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration } from './cleanup';

// Story 24.4 presentation. Drafting, every claim check, edits, refusals,
// currency and exports are proved end to end by
// `crates/worker/tests/work_product.rs` against a loopback model, real
// PostgreSQL and the real API; the exact export bytes open in LibreOffice in
// `work_product_office.rs`. This harness never composes a model: it fulfils
// the work-product reads with the JSON that suite recorded (its quote re-aimed
// at an original really registered through the UI, so Open exercises the real
// evidence viewer), answers the edit and export POSTs itself (checking what the
// browser sends) and checks what the auditor sees and can reach by keyboard.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const scope = 'organisation_id=org-a&client_id=client-a';
const recorded = JSON.parse(readFileSync(new URL('../fixtures/work-product.json', import.meta.url), 'utf8'));
const stale = JSON.parse(readFileSync(new URL('../fixtures/work-product-stale.json', import.meta.url), 'utf8'));
const docx = readFileSync(new URL('../../../fixtures/exports/working-paper.docx', import.meta.url));
const restore = fixtureRestoration(['actor-a'], `UPDATE public.identities SET active=true WHERE id='actor-a';
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE actor_id='actor-a' AND organisation_id='org-a';
UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id='actor-a' AND organisation_id='org-a';`);
test.beforeAll(async () => { runtime = await startAuthRuntime({ evidence: true }); await runtime.stopWorker(); });
test.beforeEach(async () => runtime.sqlAsync(restore('TRUNCATE public.evidence_reservations,public.tasks,public.task_counters CASCADE;')));
test.afterEach(async ({ context }) => {
  await runtime.sqlAsync(restore());
  for (const page of context.pages()) await page.getByLabel('Password', { exact: true }).fill('', { timeout: 100 }).catch(() => {});
});
test.afterAll(async () => { if (runtime) { try { await runtime.sqlAsync(restore()); } finally { await runtime.close(); } } });

async function capture(page: Page, info: TestInfo, filename: string) {
  const path = info.outputPath(filename);
  await page.screenshot({ path, fullPage: true });
  await info.attach(filename, { path, contentType: 'image/png' });
}
const notes = { name: 'Notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Opening balance 1,250.00 agreed to the ledger.\n') };
type Json = Record<string, any>;
const claims = (v: Json) => v.sections.flatMap((s: Json) => s.blocks).filter((b: Json) => b.claim);

/** The recorded JSON for this Task, its quote aimed at a real original. */
function aimed(body: Json, task: string, evidence: Evidence | null): Json {
  const old = body.product?.task_id ?? body.products?.[0]?.task_id ?? recorded.shelf.products[0].task_id;
  const text = JSON.stringify(body).replaceAll(old, task);
  const copy = JSON.parse(text);
  if (!evidence) return copy;
  const visit = (value: any) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      if (value.kind === 'quote' && value.source) {
        value.record_id = evidence.reservation.id;
        value.value = '1,250.00';
        value.locator = 'bytes:16-24';
        value.source = {
          original_id: evidence.reservation.id, readable: true, filename: 'Notes.txt', version: evidence.version, sha256: evidence.reservation.request.identity.sha256,
          locator: 'bytes:16-24', location: 'bytes 16–24', byte_start: 16, byte_end: 24, quote: '1,250.00', verification: 'verified', reason: null,
        };
      }
      Object.values(value).forEach(visit);
    }
  };
  visit(copy);
  return copy;
}

async function openTask(page: Page, options: { stale?: boolean; register?: boolean } = {}) {
  await page.goto(runtime.url);
  await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  await page.getByLabel('Account', { exact: true }).selectOption('auditor-a');
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  let evidence: Evidence | null = null;
  if (options.register) {
    await page.getByRole('button', { name: 'Evidence', exact: true }).click();
    await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles(notes);
    await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
    await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible();
    const listed = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence?${scope}`);
    evidence = (await listed.json()).items.find((item: Evidence) => item.reservation.request.filename === notes.name) as Evidence;
    await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  }
  await page.getByLabel('Send to', { exact: true }).selectOption('create');
  await page.getByLabel('Task objective', { exact: true }).fill('Assess approval of 2026 AP invoices');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect(page.locator('.task-card h3').filter({ hasText: 'Assess approval of 2026 AP invoices' })).toBeVisible();
  const taskOf = (request: Request) => new URL(request.url()).pathname.split('/tasks/')[1]!.split('/')[0]!;
  const version = (task: string) => aimed(options.stale ? stale : recorded.version, task, evidence);
  await page.route('**/api/engagements/engagement-a/tasks/*/work-products?*', async route => {
    expect(route.request().headers()['x-expected-session']).toBeTruthy();
    const task = taskOf(route.request());
    const shelf = aimed(recorded.shelf, task, evidence);
    // The stale case opens version 1 itself (as "Open the previous version" would).
    if (options.stale) shelf.products[0] = { ...version(task).product, version_id: stale.id, version: stale.version };
    await route.fulfill({ json: shelf });
  });
  const reads = async (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const path = new URL(route.request().url()).pathname;
    const task = taskOf(route.request());
    if (path.includes('/claims/')) {
      const support = aimed(recorded.support, task, evidence);
      support.block_id = path.split('/claims/')[1]!.split('/')[0];
      const block = claims(version(task)).find((b: Json) => b.id === support.block_id);
      support.claim = block.claim;
      support.statement = block.text;
      support.items = block.claim.assertions.map((a: Json, i: number) => ({ pinned: a, support: block.claim.support[i] ?? 'The record says what the claim says.' }));
      return route.fulfill({ json: support });
    }
    await route.fulfill({ json: version(task) });
  };
  await page.route('**/api/engagements/engagement-a/tasks/*/work-products/*/versions/*?*', reads);
  await page.route('**/api/engagements/engagement-a/tasks/*/work-products/*/versions/*/claims/*/support?*', reads);
  await page.getByRole('button', { name: 'Open Assess approval of 2026 AP invoices', exact: true }).click();
}

test('the shelf opens a version by template section; claim, support and citation each return focus', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openTask(page, { register: true });
  const shelf = page.locator('section.work-products');
  await expect(shelf).toContainText('1 work product');
  const item = shelf.locator('.work-product-item');
  await expect(item).toContainText('AP approvals working paper · Working paper · version 1 · Draft');
  await expect(item).toContainText('5 checked claims');
  await expect(item).toContainText('No claim needs refresh');
  await expect(item).toContainText('Required sections not completed in this version: conclusion');
  const opener = item.getByRole('button', { name: 'Open AP approvals working paper', exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  const document = page.getByRole('article', { name: 'AP approvals working paper', exact: true });
  await expect(document.getByRole('heading', { name: 'AP approvals working paper', exact: true })).toBeFocused();
  await expect(document).toContainText('Draft — not reviewed');
  await expect(document).toContainText('Every claim is current.');
  await expect(document.getByRole('region', { name: /^Conclusion/ })).toContainText('Not completed in this version.');
  await expect(document.locator('.judgment-label')).toHaveText("Zobba's judgment — not checked against records");
  await expect(document.locator('.work-product-claim').first()).toContainText('[1] 15 of 1,000 applicable invoices had no recorded approver.');
  await expect(document.locator('.coverage-line').first()).toContainText('Population complete');

  // Claim → support → Back to claim restores the claim and its keyboard focus.
  const show = document.getByRole('button', { name: 'Show support of claim 1', exact: true });
  await show.focus();
  await page.keyboard.press('Enter');
  const support = document.getByRole('region', { name: 'Claim support', exact: true });
  await expect(support).toBeFocused();
  await expect(support).toContainText('15 not met');
  await expect(document.locator('.work-product-claim.selected')).toHaveCount(1);
  await support.getByRole('button', { name: 'Back to claim', exact: true }).click();
  await expect(support).toHaveCount(0);
  await expect(show).toBeFocused();

  // Claim → citation chip → evidence viewer at the cited bytes → back to the chip.
  const quoted = document.locator('.work-product-claim').filter({ hasText: 'The policy requires' });
  const chip = quoted.getByRole('button', { name: 'Citation: Notes.txt', exact: true });
  await chip.focus();
  await chip.press('Enter');
  await quoted.getByRole('button', { name: 'Open at bytes 16–24', exact: true }).click();
  const inspector = page.getByRole('region', { name: 'Original source details', exact: true });
  await expect(inspector.getByRole('heading', { name: 'Notes.txt' })).toBeVisible();
  await expect(inspector.locator('mark.cited-range')).toHaveText('1,250.00');
  await page.getByRole('button', { name: 'Return to conversation and Task', exact: true }).click();
  await expect(chip).toBeFocused();
  await expect(page.locator('body')).not.toContainText('confidence');
  await expect(page.locator('body')).not.toContainText('%');

  // WCAG 2.2 AA: the document's text keeps 4.5:1 contrast on its background.
  const ratios = await document.evaluate(root => {
    const rgba = (color: string) => color.match(/[\d.]+/g)!.map(Number);
    const luminance = (color: string) => {
      const channels = rgba(color).slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
    };
    const background = (element: Element | null): string => {
      for (let node = element; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        const parts = rgba(color);
        if (parts.length < 4 || parts[3]! > 0) return color;
      }
      return 'rgb(255, 255, 255)';
    };
    return ['.judgment-label', '.claim-current', '.coverage-line', '.platform-label', '.not-completed', '.context-note', '.review-state', 'li']
      .flatMap(selector => [...root.querySelectorAll(selector)].slice(0, 4).map(element => {
        const foreground = luminance(getComputedStyle(element).color);
        const back = luminance(background(element));
        return { selector, ratio: (Math.max(foreground, back) + .05) / (Math.min(foreground, back) + .05) };
      }));
  });
  for (const selector of ['.judgment-label', '.claim-current', '.coverage-line', '.platform-label', '.not-completed']) expect(ratios.some(r => r.selector === selector), selector).toBe(true);
  for (const { selector, ratio } of ratios) expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
  await capture(page, info, 'work-product.png');
  expect(errors).toEqual([]);
});

test('a stale version says which claims need refresh and announces the newer version without swapping it in', async ({ page }, info) => {
  await openTask(page, { stale: true });
  const item = page.locator('section.work-products').locator('.work-product-item');
  await expect(item).toContainText(`${stale.product.refresh} claims need refresh`);
  await item.getByRole('button', { name: /^Open / }).click();
  const document = page.locator('.work-product-document');
  await expect(document).toContainText(`${stale.refresh} claims need refresh`);
  await expect(document.locator('.newer-version')).toContainText('A newer version');
  await expect(document.locator('.newer-version')).toContainText('This one is shown unchanged.');
  await expect(document.locator('.work-product-claim.stale').first()).toContainText('Needs refresh:');
  // A version that is not the latest offers no edit.
  await expect(document.getByRole('button', { name: 'Edit into a new version', exact: true })).toHaveCount(0);
  await capture(page, info, 'work-product-stale.png');
});

test('a person edits by keyboard into a new version, bound to the session; refusals say why', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openTask(page);
  const posted: Request[] = [];
  let refuse = true;
  await page.route('**/api/engagements/engagement-a/tasks/*/work-products/*/versions?*', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted.push(route.request());
    if (refuse) {
      refuse = false;
      return route.fulfill({ status: 409, json: { error: 'unsupported_figure', head: null, refusals: [{ block: 3, reason: 'unsupported_figure', words: 'the sentence states a figure none of its records holds', detail: '14' }] } });
    }
    return route.fulfill({ status: 409, json: { error: 'stale_base', head: recorded.version.id.replace(/.$/, 'f'), refusals: [] } });
  });
  await page.locator('section.work-products').getByRole('button', { name: 'Open AP approvals working paper', exact: true }).click();
  const document = page.getByRole('article', { name: 'AP approvals working paper', exact: true });
  await document.getByRole('button', { name: 'Edit into a new version', exact: true }).click();
  const editor = document.getByRole('form', { name: 'Edit AP approvals working paper', exact: true });
  const heading = editor.getByRole('textbox', { name: 'Heading in Objective', exact: true });
  await expect(heading).toBeFocused();
  const save = editor.getByRole('button', { name: 'Save as a new version', exact: true });
  await expect(save).toHaveAttribute('aria-disabled', 'true');
  const claim = editor.getByRole('textbox', { name: 'Claim [1] in Results', exact: true });
  await claim.fill('14 of 1,000 applicable invoices had no recorded approver.');
  await expect(editor.locator(`[id="${await claim.getAttribute('aria-describedby')}"]`)).toHaveText(`${new TextEncoder().encode('14 of 1,000 applicable invoices had no recorded approver.').length} of 1,000 bytes`);
  // Reorder by keyboard: the moved block keeps the focus on its control.
  const judgment = editor.getByRole('group', { name: 'Arrange Narrative (Zobba’s judgment) in Results', exact: true });
  const down = judgment.getByRole('button', { name: 'Move down', exact: true });
  await down.focus();
  await page.keyboard.press('Enter');
  await expect(down).toBeFocused();
  await save.focus();
  await page.keyboard.press('Enter');
  await expect(editor.getByRole('alert').first()).toContainText('the sentence states a figure none of its records holds');
  expect(posted).toHaveLength(1);
  const sent = posted[0]!;
  const headers = sent.headers();
  expect(headers['x-csrf-token']).toBeTruthy();
  expect(headers['x-expected-actor']).toBe('actor-a');
  expect(headers['x-expected-session']).toBe(headers['x-csrf-token']);
  const body = sent.postDataJSON();
  expect(Object.keys(body).sort()).toEqual(['base_version', 'blocks', 'key']);
  expect(body.base_version).toBe(recorded.version.id);
  expect(body.key).toMatch(/^[0-9a-f]{32}$/);
  const ids = recorded.version.sections.flatMap((s: Json) => s.blocks.map((b: Json) => b.id));
  expect(body.blocks).toHaveLength(ids.length);
  // Only the changed sentence carries text; every other block is kept by ID.
  expect(body.blocks.filter((b: Json) => 'text' in b)).toEqual([{ block: claims(recorded.version)[0].id, text: '14 of 1,000 applicable invoices had no recorded approver.' }]);
  expect(body.blocks.map((b: Json) => b.block)).not.toEqual(ids);
  await capture(page, info, 'work-product-edit.png');
  // Another request: a newer version was recorded first.
  await claim.fill('15 of 1,000 applicable invoices had no recorded approver (checked).');
  await save.click();
  await expect(editor.getByRole('alert').first()).toContainText('A newer version was recorded while you edited.');
  expect(posted[1]!.postDataJSON().key).not.toBe(body.key);
  expect(errors).toEqual([]);
});

test('an export renders this exact version and downloads bytes checked against its digest', async ({ page }) => {
  await openTask(page);
  const digest = createHash('sha256').update(docx).digest('hex');
  const exportId = `wpx-${'1'.repeat(40)}`;
  const posted: Request[] = [];
  await page.route('**/api/engagements/engagement-a/tasks/*/work-products/*/versions/*/exports?*', async route => {
    posted.push(route.request());
    await route.fulfill({ json: {
      id: exportId, version_id: recorded.version.id, format: 'docx', media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      renderer: 'zobba-export-v1', digest, size: String(docx.length), withheld_digest: 'b'.repeat(64), refresh_count: '0', recorded_us: '1',
    } });
  });
  await page.route(`**/api/engagements/engagement-a/tasks/*/work-products/*/exports/${exportId}/content?*`, route => route.fulfill({
    status: 200, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: docx,
  }));
  await page.locator('section.work-products').getByRole('button', { name: 'Open AP approvals working paper', exact: true }).click();
  const exports = page.getByRole('region', { name: 'Exports', exact: true });
  await exports.getByRole('button', { name: 'Export DOCX', exact: true }).click();
  await expect(exports.getByRole('status')).toHaveText('The DOCX export of version 1 is ready.');
  expect(posted[0]!.postDataJSON()).toMatchObject({ format: 'docx' });
  const link = exports.getByRole('link', { name: 'Download AP-approvals-working-paper-v1.docx', exact: true });
  await expect(link).toHaveAttribute('download', 'AP-approvals-working-paper-v1.docx');
  // A different viewer's export: what you may read changed.
  await page.unroute(`**/api/engagements/engagement-a/tasks/*/work-products/*/exports/${exportId}/content?*`);
  await page.route(`**/api/engagements/engagement-a/tasks/*/work-products/*/exports/${exportId}/content?*`, route => route.fulfill({ status: 409, json: { error: 'export_scope_changed', head: null, refusals: [] } }));
  await exports.getByRole('button', { name: 'Export DOCX', exact: true }).click();
  await expect(exports.getByRole('status')).toHaveText('What you may read changed since this export was made. Request a new export.');
});
