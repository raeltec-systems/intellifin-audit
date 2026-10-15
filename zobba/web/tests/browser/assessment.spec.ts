import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration } from './cleanup';

// Story 24.1 presentation. The assessment records themselves (criterion
// versions with checked authority, the basis, typed facts verified at their
// cells, and evaluations) are produced by `crates/worker/tests/assessment.rs`
// against a loopback model and real PostgreSQL. This harness never composes a
// model, so it fulfils the work read with the exact assessment JSON that suite
// recorded, and checks what the auditor sees and can reach by keyboard.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const assessment = JSON.parse(readFileSync(new URL('../fixtures/task-assessment.json', import.meta.url), 'utf8'));
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
async function openTask(page: Page, work: (body: Record<string, unknown>) => Record<string, unknown>) {
  await page.goto(runtime.url);
  await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  await page.getByLabel('Account', { exact: true }).selectOption('auditor-a');
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  await page.getByLabel('Send to', { exact: true }).selectOption('create');
  await page.getByLabel('Task objective', { exact: true }).fill('Assess approval of 2026 AP invoices');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect(page.locator('.task-card h3').filter({ hasText: 'Assess approval of 2026 AP invoices' })).toBeVisible();
  // The actual work read, with the assessment the worker suite recorded.
  await page.route('**/api/engagements/engagement-a/tasks/*/work?*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: work(await response.json()) });
  });
  await page.getByRole('button', { name: 'Open Assess approval of 2026 AP invoices', exact: true }).click();
}

test('the work panel shows the basis, typed facts and evaluations with separate verdict words', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openTask(page, body => ({ ...body, assessment, assessment_unavailable: false }));
  const region = page.getByRole('region', { name: 'Assessment basis', exact: true });
  await expect(region).toBeVisible();
  await expect(region.getByRole('heading', { name: 'Basis versions', exact: true })).toBeVisible();
  await expect(region).toContainText('period 2026-01-01 to 2026-12-31');
  await expect(region.getByRole('list', { name: 'Population references' })).toContainText('AP invoices.xlsx · invoice');
  // Authority is shown as checked or not, with its reason.
  await expect(region.locator('.assessment-criteria')).toContainText('unverified · not found at location');
  await expect(region.locator('.assessment-criteria')).toContainText('Method AP-1 criterion 1 · verified');
  // Typed facts: exact subject, measure, source offset and support.
  const facts = region.locator('.assessment-facts li');
  await expect(facts).toHaveCount(assessment.facts.length);
  await expect(facts.filter({ hasText: 'invoice 000123 · invoice_id' })).toContainText('000123');
  await expect(facts.filter({ hasText: 'INV-0042 · amount' })).toContainText('1250.00 USD');
  await expect(facts.filter({ hasText: 'INV-0042 · approved_at' })).toContainText('2026-03-05T23:30:00-05:00 (UTC 2026-03-06 04:30:00');
  await expect(facts.filter({ hasText: 'INV-0050 · amount' })).toContainText('Unsupported · the source does not show this value');
  await expect(facts.filter({ hasText: 'INV-0053 · approver' })).toContainText('Unsupported · the analysis it depends on failed');
  // Applicability, execution, verdict and origin are four separate words.
  const evaluations = region.locator('.assessment-evaluations > li');
  await expect(evaluations).toHaveCount(assessment.evaluations.length);
  const exception = evaluations.filter({ has: page.locator('.verdict-exception') });
  await expect(exception).toHaveCount(1);
  await expect(exception).toContainText('history · INV-0054');
  await expect(exception.locator('dt')).toHaveText(['Applicability', 'Execution', 'Verdict', 'Origin']);
  await expect(exception.locator('dd')).toHaveText(['Applies', 'Evaluation completed', 'Not met (exception)', 'Decided by a platform rule']);
  const failed = evaluations.filter({ hasText: 'approval · INV-0053' });
  await expect(failed.locator('dd').nth(2)).toHaveText('No verdict · the analysis failed');
  const missing = evaluations.filter({ hasText: 'approval · INV-0051' });
  await expect(missing.locator('dd').nth(2)).toHaveText('Undetermined · a required fact is missing');
  const judged = evaluations.filter({ hasText: 'segregation · INV-0042' });
  await expect(judged.locator('dd').nth(3)).toHaveText('Zobba proposes — awaiting your review');
  await expect(judged).toContainText('Uncertainty: The organisation chart in the evidence is dated 2025.');
  // No numeric confidence anywhere.
  await expect(region).not.toContainText(/confiden|probab|%/i);
  // A fact's source is the ordinary keyboard-reachable citation chip.
  const chip = facts.filter({ hasText: 'INV-0042 · amount' }).getByRole('button', { name: /^Citation: AP invoices\.xlsx$/ });
  await chip.focus();
  const card = facts.filter({ hasText: 'INV-0042 · amount' }).getByRole('group', { name: 'Citation sources', exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Sheet1!B2');
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(chip).toBeFocused();
  await capture(page, info, 'assessment-basis.png');
  expect(errors).toEqual([]);
});

test('an unreadable assessment is said plainly and the rest of the work stays shown', async ({ page }) => {
  await openTask(page, body => ({ ...body, assessment: null, assessment_unavailable: true }));
  await expect(page.getByRole('status').filter({ hasText: 'The assessment basis could not be read just now.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Assessment basis', exact: true })).toHaveCount(0);
});
