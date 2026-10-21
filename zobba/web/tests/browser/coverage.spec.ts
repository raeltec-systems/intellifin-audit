import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration } from './cleanup';

// Story 24.2 presentation. The coverage records (a population manifest read
// from every row of `AP population.xlsx`, criterion opportunities, a seeded
// sample and summaries the database recounted) are produced by
// `crates/worker/tests/coverage.rs` against a loopback model and real
// PostgreSQL. This harness never composes a model, so it fulfils the work and
// member reads with the exact JSON that suite recorded, and checks what the
// auditor sees: counts in words with their units, "at least" and "not known"
// for an incomplete source, no percentages and never a pass where the counts
// do not allow one.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const assessment = JSON.parse(readFileSync(new URL('../fixtures/task-assessment.json', import.meta.url), 'utf8'));
const coverage = JSON.parse(readFileSync(new URL('../fixtures/task-coverage.json', import.meta.url), 'utf8'));
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

const recorded = {
  ...assessment,
  bases: [], total_bases: '0', facts: [], total_facts: '0', evaluations: [], total_evaluations: '0',
  criteria: coverage.criteria, total_criteria: String(coverage.criteria.length),
  populations: coverage.populations, total_populations: String(coverage.populations.length),
  samples: coverage.samples, total_samples: String(coverage.samples.length),
  summaries: coverage.summaries, total_summaries: String(coverage.summaries.length),
};

async function capture(page: Page, info: TestInfo, filename: string) {
  const path = info.outputPath(filename);
  await page.screenshot({ path, fullPage: true });
  await info.attach(filename, { path, contentType: 'image/png' });
}
async function openTask(page: Page) {
  await page.goto(runtime.url);
  await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  await page.getByLabel('Account', { exact: true }).selectOption('auditor-a');
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  await page.getByLabel('Send to', { exact: true }).selectOption('create');
  await page.getByLabel('Task objective', { exact: true }).fill('Test approval of every 2026 AP invoice');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect(page.locator('.task-card h3').filter({ hasText: 'Test approval of every 2026 AP invoice' })).toBeVisible();
  // The actual work read, with the coverage the worker suite recorded.
  await page.route('**/api/engagements/engagement-a/tasks/*/work?*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), assessment: recorded, assessment_unavailable: false } });
  });
  await page.route('**/api/engagements/engagement-a/tasks/*/assessment/populations/*/members?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('disposition') !== 'excluded') return route.fulfill({ status: 403, json: { error: 'access_denied' } });
    await route.fulfill({ json: coverage.members });
  });
  await page.getByRole('button', { name: 'Open Test approval of every 2026 AP invoice', exact: true }).click();
}

test('coverage shows exact counts in words, exclusions by reason and no pass the counts do not allow', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openTask(page);
  const region = page.getByRole('region', { name: 'Coverage', exact: true });
  await expect(region).toBeVisible();
  const summaries = region.locator('.coverage-summaries > li');
  await expect(summaries).toHaveCount(8);
  // AC2: the full population. Two grains, two names: failing invoices and
  // failing opportunities.
  const full = summaries.nth(0);
  await expect(full.locator('.coverage-conclusion')).toHaveText('Exceptions found; overall assessment inconclusive.');
  await expect(full).toContainText('1,200 invoices in scope.');
  await expect(full).toContainText('Invoices with at least one exception: 20 invoices');
  await expect(full).toContainText('Meeting every criterion that applies: 960 invoices');
  await expect(full).toContainText('Unresolved (no exception, but at least one result unknown): 20 invoices');
  await expect(full).toContainText('No criterion applies: 200 invoices');
  await expect(full).toContainText('Failing criterion opportunities (not invoices): 27 opportunities');
  const table = full.getByRole('table', { name: /Criterion opportunities/ });
  await expect(table.getByRole('row', { name: /approver/ })).toContainText('1,000');
  await expect(table.getByRole('row', { name: /approver/ }).getByRole('cell').nth(4)).toHaveText('15');
  await expect(table.getByRole('row', { name: /before/ }).getByRole('cell').nth(4)).toHaveText('12');
  // Zero applicable: no pass.
  await expect(summaries.nth(1).locator('.coverage-conclusion')).toHaveText('No eligible items; operating effectiveness was not demonstrated.');
  // A filtered export: counts are lower bounds and the total is not known.
  const filtered = summaries.nth(2);
  await expect(filtered.locator('.coverage-conclusion')).toHaveText('No items found; absence is not proven.');
  await expect(filtered).toContainText('The total is not known.');
  await expect(filtered).toContainText('at least 0 invoices found in scope.');
  await expect(filtered).toContainText('The total is not known: the population is incomplete.');
  await expect(filtered.getByRole('table', { name: /Criterion opportunities/ })).toContainText('at least 0');
  // A sample names its selected items only.
  await expect(summaries.nth(3).locator('.coverage-conclusion')).toContainText('Among the selected items only');
  await expect(summaries.nth(3)).toContainText('25 selected invoices; nothing is inferred about the rest.');
  for (const index of [0, 1, 2, 3, 4, 6]) {
    await expect(summaries.nth(index)).not.toContainText(/no exception found/i);
  }
  await expect(region).not.toContainText(/confiden|probab|%/i);
  // The Edge sheet: nothing covers its scope-unknown and unkeyed rows.
  const edge = summaries.nth(4);
  await expect(edge.locator('.coverage-conclusion')).toHaveText('Inconclusive.');
  await expect(edge.getByRole('list', { name: 'Coverage limitations' })).toContainText('3 invoices have an unknown scope; they are unresolved.');
  await expect(edge.getByRole('list', { name: 'Coverage limitations' })).toContainText('1 received row has no usable key; it was not assessed, so no conclusion covers it.');
  // The Dated sheet: the one complete population with no exception, and the
  // naive Excel date-times said in words; its sample concludes nothing
  // about the population.
  const dated = summaries.nth(5);
  await expect(dated.locator('.coverage-conclusion')).toHaveText('No exception found.');
  await expect(dated).toContainText('3 Excel date or date-time cells carry no time zone; they were read as UTC.');
  await expect(summaries.nth(6).locator('.coverage-conclusion')).toContainText('Among the selected items only');
  // The Lines sheet: one subject per invoice line.
  await expect(summaries.nth(7)).toContainText('6 invoice_lines in scope.');
  // The count mismatch is a reconciliation sentence with both numbers.
  const populations = region.locator('.coverage-populations > li');
  await expect(populations.filter({ hasText: 'Population cover' })).toContainText('the cited control count is 1,251; 1,250 distinct items were found');
  await expect(populations.filter({ hasText: 'Population ap' })).toContainText('Reconciled: the cited control count matches 1,250 distinct items.');
  // A non-empty incomplete population: every count is a lower bound, and its
  // total is said to be not known.
  const cover = populations.filter({ hasText: 'Population cover' });
  await expect(cover).toContainText('Rows received: at least 1,256 rows found; the total is not known');
  await expect(cover).toContainText('In scope: at least 1,200 invoices found');
  await expect(cover).toContainText('Duplicate rows collapsed: at least 6 rows found');
  // Exclusions are inspectable by reason, with an exact count, by keyboard.
  const ap = populations.filter({ hasText: 'Population ap' });
  const show = ap.getByRole('button', { name: 'Show excluded rows', exact: true });
  await show.focus();
  await page.keyboard.press('Enter');
  const rows = ap.getByRole('region', { name: 'Excluded rows', exact: true });
  await expect(rows).toContainText('50 rows · showing 50');
  await expect(rows.getByRole('row').nth(1)).toContainText('INV-00001');
  await expect(rows.getByRole('row').nth(1)).toContainText('Excluded · outside the basis period');
  // The same control now hides the rows, keeps focus and says it is open.
  const hide = ap.getByRole('button', { name: 'Hide excluded rows', exact: true });
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  await expect(hide).toBeFocused();
  // WCAG 2.2 AA: the panel's text keeps 4.5:1 contrast on its background.
  const ratios = await region.evaluate(root => {
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
    return ['.coverage-conclusion', 'td', 'th', '.context-note', 'li', 'button']
      .flatMap(selector => [...root.querySelectorAll(selector)].slice(0, 4).map(element => {
        const foreground = luminance(getComputedStyle(element).color);
        const back = luminance(background(element));
        return { selector, ratio: (Math.max(foreground, back) + .05) / (Math.min(foreground, back) + .05) };
      }));
  });
  for (const selector of ['.coverage-conclusion', 'td', 'th', '.context-note']) expect(ratios.some(r => r.selector === selector), selector).toBe(true);
  for (const { selector, ratio } of ratios) expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
  await capture(page, info, 'coverage.png');
  expect(errors).toEqual([]);
});

test('a member page that cannot be read is said plainly and shows nothing in its place', async ({ page }) => {
  await openTask(page);
  const ap = page.getByRole('region', { name: 'Coverage', exact: true }).locator('.coverage-populations > li').filter({ hasText: 'Population ap' });
  await ap.getByRole('button', { name: 'Show duplicate rows', exact: true }).click();
  const rows = ap.getByRole('region', { name: 'Duplicate rows', exact: true });
  await expect(rows.getByRole('alert')).toHaveText('These rows could not be read now. Nothing is shown in their place.');
  await expect(rows.getByRole('table')).toHaveCount(0);
});
