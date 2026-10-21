import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import type { Evidence } from '../../src/evidence';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration } from './cleanup';

// Story 22.6 presentation. The recorded facts themselves (method outline, skill
// loads, resource fetches, the sandboxed script, gaps, questions and the binding
// switch) are produced by `crates/worker/tests/investigation.rs` against a
// loopback model, and the Admin proposal path by
// `crates/api/tests/methodology_proposal.rs`. This harness never composes a
// model, so it fulfils those two reads with the exact API JSON those suites
// recorded, and checks what the auditor and Admin see and can reach by keyboard.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const scope = 'organisation_id=org-a&client_id=client-a';
const investigation = JSON.parse(readFileSync(new URL('../fixtures/task-investigation.json', import.meta.url), 'utf8'));
const proposal = JSON.parse(readFileSync(new URL('../fixtures/methodology-proposal.json', import.meta.url), 'utf8'));
const restore = fixtureRestoration(['actor-a', 'actor-manager'], `UPDATE public.identities SET active=true WHERE id IN ('actor-a','actor-manager');
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE actor_id='actor-a' AND organisation_id='org-a';
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['audit_manager','admin'] WHERE organisation_id='org-a' AND actor_id='actor-manager';
UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id IN ('actor-a','actor-manager') AND organisation_id='org-a';`);
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
async function signIn(page: Page, account: string) {
  await page.goto(runtime.url);
  await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  await page.getByLabel('Account', { exact: true }).selectOption(account);
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
const notes = { name: 'Notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Payments in the sample agree to the ledger.\n') };

test('the work panel shows the method versions, skills used, gaps, questions and cited Zobba statements', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await signIn(page, 'auditor-a');
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles(notes);
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible();
  const listed = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence?${scope}`);
  const evidence = (await listed.json()).items.find((item: Evidence) => item.reservation.request.filename === notes.name) as Evidence;
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await page.getByLabel('Send to', { exact: true }).selectOption('create');
  await page.getByLabel('Task objective', { exact: true }).fill('Test AP payments');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect(page.locator('.task-card h3').filter({ hasText: 'Test AP payments' })).toBeVisible();

  // The actual work read, with the investigation the worker suite recorded.
  await page.route('**/api/engagements/engagement-a/tasks/*/work?*', async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, attention: 'method_question', investigation } });
  });
  // The statement's answer (invocation id-3) cites the registered original.
  const source = {
    original_id: evidence.reservation.id, readable: true, filename: 'Notes.txt', version: evidence.version, sha256: evidence.reservation.request.identity.sha256,
    locator: 'bytes:0-43', location: 'bytes 0–43', byte_start: 0, byte_end: 43, quote: 'Payments in the sample agree to the ledger.', verification: 'verified', reason: null,
  };
  const answer = { invocation_id: 'id-3', text: 'Payments in the sample agree to the ledger.', segments: [{ text: 'Payments in the sample agree to the ledger.', sources: [source] }], limitations: [], verification_failed: false };
  await page.route('**/api/engagements/engagement-a/tasks/*/answers?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answers: [answer] }) }));
  await page.getByRole('button', { name: 'Open Test AP payments', exact: true }).click();

  const method = page.getByRole('region', { name: 'Method and skills', exact: true });
  await expect(method).toBeVisible();
  await expect(method).toContainText('Incomplete — parts of the method are missing');
  await expect(method.locator('.method-versions code')).toHaveText(['method-version-1']);
  await expect(method).toContainText('openai fixture-model · profile loopback revision 1');
  const skills = method.locator('.skills-used li');
  await expect(skills).toHaveCount(1);
  const pure = investigation.skills.find((use: { name: string | null }) => use.name === 'AP matching');
  await expect(skills.first()).toContainText(`AP matching v1 · digest ${pure.digest.slice(0, 8)}`);
  // Each use is labelled by its recorded outcome.
  await expect(skills.first()).toContainText('loaded, resource checklist read, script summarise ran in the sandbox');
  await expect(skills.first()).toContainText('script fail did not complete (program failed)');
  await expect(skills.first()).toContainText('script flood did not complete (program limit)');
  await expect(method.getByRole('list', { name: 'Skill requests not performed' })).toContainText('Send confirmations · not available');
  const gaps = method.locator('.method-gaps li');
  await expect(gaps).toHaveCount(3);
  await expect(gaps.filter({ hasText: 'platform fact' })).toHaveCount(2);
  await expect(method).toContainText('1 question is waiting for your answer');
  await expect(method.locator('.method-questions li')).toContainText('AP-2 · Open · Which vendor master applies to the 2025 payments?');
  await expect(method).not.toContainText(/complete(d)? requirement|requirement is complete/i);
  const statement = method.locator('.method-statements li');
  await expect(statement).toContainText('Payments in the sample agree to the ledger.');
  // The statement's citation is the ordinary keyboard-reachable chip.
  const chip = statement.getByRole('button', { name: /^Citation: Notes\.txt$/ });
  await chip.focus();
  const card = statement.getByRole('group', { name: 'Citation sources', exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText('bytes 0–43');
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(chip).toBeFocused();
  // Attention names the question without claiming any requirement is done.
  await expect(page.getByRole('region', { name: 'Task details' })).toContainText('Zobba asked a question about the method');
  await capture(page, info, 'method-and-skills.png');
  expect(errors).toEqual([]);
});

test('an Admin reviews a cited methodology proposal and nothing changes until Save', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await signIn(page, 'manager-a');
  await expect(page.getByRole('heading', { name: 'Your engagements', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Methodology and skills', exact: true }).click();
  const organisation = page.getByRole('button', { name: /Northstar.*Manage methodology/ });
  await page.getByRole('button', { name: 'New methodology', exact: true }).or(organisation).first().waitFor({ state: 'visible' });
  if (await organisation.isVisible()) await organisation.click();
  const before = await (await page.request.get(`${runtime.url}/api/methodology/organisations/org-a`)).json();

  // The composed API has no proposal transport, as in production.
  const panel = page.getByRole('region', { name: 'Draft from a methodology document', exact: true });
  const document = { name: 'AP method 2025.md', mimeType: 'text/markdown', buffer: Buffer.from('# Accounts payable method 2025\n') };
  await panel.getByLabel('Methodology document (text or Markdown)').setInputFiles(document);
  await panel.getByLabel('Model profile ID').fill('loopback');
  const refused = page.waitForResponse(response => response.url().includes('/proposals') && response.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Draft proposal', exact: true }).click();
  expect((await refused).status()).toBe(503);
  await expect(panel.getByRole('alert')).toContainText('was not confirmed');

  // The recorded API JSON of a drafted proposal, for the review screen.
  await page.route('**/api/methodology/organisations/org-a/proposals', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const sent = route.request().postDataJSON();
    expect(sent.media_type).toBe('text/markdown');
    expect(sent.filename).toBe('AP method 2025.md');
    await route.fulfill({ status: 200, json: { ...proposal, key: sent.key } });
  });
  await panel.getByRole('button', { name: 'Retry exact proposal request', exact: true }).click();
  const result = panel.getByRole('article', { name: 'Methodology proposal', exact: true });
  await expect(result).toContainText('Proposal only — not saved.');
  const first = result.getByRole('region', { name: 'Proposed requirement AP-1', exact: true });
  await expect(first).toContainText('Payments over 10,000 have two approvals');
  // The byte range is visible text, reachable by keyboard and screen reader.
  await expect(first).toContainText('line 4, bytes 76–116: Payments over 10,000 have two approvals.');
  await expect(result.getByRole('region', { name: 'Missing criteria', exact: true })).toContainText('AP-2');
  await expect(result.getByRole('region', { name: 'Interpretation conflicts', exact: true })).toContainText('Two different change thresholds are stated.');
  await result.getByText(/proposed values were left out/).click();
  await expect(result).toContainText('proposed requirement 2 (AP-7)');
  await capture(page, info, 'methodology-proposal.png');

  // Review in editor opens a new, unsaved methodology attributed to the proposal.
  await result.getByRole('button', { name: 'Review in editor', exact: true }).click();
  const editor = page.getByRole('form', { name: 'Edit methodology', exact: true });
  await expect(editor.getByLabel('Package name')).toHaveValue('Accounts payable method 2025');
  await expect(editor.getByLabel('Source kind')).toHaveValue('imported_proposal');
  const after = await (await page.request.get(`${runtime.url}/api/methodology/organisations/org-a`)).json();
  expect(after.revision).toBe(before.revision);
  expect(after.versions.length).toBe(before.versions.length);
  expect(errors).toEqual([]);
});
