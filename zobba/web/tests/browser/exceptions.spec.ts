import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page, Request, TestInfo } from '@playwright/test';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration } from './cleanup';

// Story 24.3b presentation. Exceptions, their derived statuses, the
// effective summary and exception dispositions are produced and refused end
// to end by `crates/worker/tests/exception.rs` against a loopback model, real
// PostgreSQL and the real API. This harness never composes a model: it
// fulfils the work and exception reads with the exact JSON those suites
// recorded, answers the disposition POST itself (checking what the browser
// sends), and checks what the auditor sees and can reach by keyboard.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const assessment = JSON.parse(readFileSync(new URL('../fixtures/task-assessment.json', import.meta.url), 'utf8'));
// The recorded list's criterion lineages (crit-1 the rule, crit-2 the
// judgment) named as the assessment fixture's history and segregation.
const recordedText = readFileSync(new URL('../fixtures/task-exceptions.json', import.meta.url), 'utf8')
  .replaceAll('"crit-1"', '"@history"').replaceAll('"crit-2"', '"@segregation"')
  .replaceAll('"@history"', '"crit-2"').replaceAll('"@segregation"', '"crit-5"');
const recorded = JSON.parse(recordedText);
const NOT_REMEDIATION = 'not observed in the latest revision; this is not evidence of remediation';
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

/** The recorded list (its INV-0054 rule exception is open and the latest
 * revision did not observe it, so its sentence says this is not
 * remediation). */
const listed = (mayClose = true) => {
  const body = JSON.parse(JSON.stringify(recorded));
  body.may_close = mayClose;
  return body;
};
const open = () => recorded.exceptions.find((e: { subject: string; first_source_kind: string }) => e.subject === 'INV-0054' && e.first_source_kind === 'opportunity');

async function capture(page: Page, info: TestInfo, filename: string) {
  const path = info.outputPath(filename);
  await page.screenshot({ path, fullPage: true });
  await info.attach(filename, { path, contentType: 'image/png' });
}
async function openTask(page: Page, mayClose = true) {
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
  await page.route('**/api/engagements/engagement-a/tasks/*/work?*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), assessment, assessment_unavailable: false } });
  });
  await page.route('**/api/engagements/engagement-a/tasks/*/assessment/exceptions?*', async route => {
    expect(route.request().headers()['x-expected-session']).toBeTruthy();
    await route.fulfill({ json: listed(mayClose) });
  });
  await page.route('**/api/engagements/engagement-a/tasks/*/assessment/exceptions/exc-*?*', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    const exception = listed(mayClose).exceptions.find((e: { id: string }) => e.id === id);
    await route.fulfill({ json: {
      exception,
      occurrences: [{ source_kind: exception.first_source_kind, source_id: exception.first_source_id, population_id: exception.first_source_kind === 'opportunity' ? 'pop-1' : null, member_ordinal: exception.first_source_kind === 'opportunity' ? '2' : null, criterion_id: exception.criterion_root, basis_id: 'basis-1', origin: exception.first_source_kind === 'opportunity' ? 'deterministic' : 'model_proposal', evidence: ['0'.repeat(64)], source_us: '1', seq: '1' }],
      dispositions: exception.disposition ? [exception.disposition] : [],
      next_cursor: null,
    } });
  });
  await page.getByRole('button', { name: 'Open Assess approval of 2026 AP invoices', exact: true }).click();
}

test('the exceptions show their derived status, exact counts and the effective summary', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openTask(page);
  const section = page.getByRole('region', { name: 'Exceptions', exact: true });
  await expect(section.getByRole('list', { name: 'Exceptions by status', exact: true })).toContainText('6 exceptions over 5 distinct subjects');
  await expect(section.getByRole('list', { name: 'Exceptions by status', exact: true })).toContainText('Closed by disposition: 1');
  const rows = section.getByRole('group', { name: 'Exception list', exact: true }).locator('tbody tr');
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(0)).toContainText('Replaced by human judgment');
  await expect(rows.nth(3)).toContainText('Closed by disposition');
  // INV-0051 was closed; a judgment over evidence its closure never saw
  // reopened it.
  await expect(rows.nth(2)).toContainText('Open: a current observation does not meet the criterion.');
  // The open exception the latest revision did not observe says it is not
  // evidence of remediation.
  await expect(section).toContainText(`Open: ${NOT_REMEDIATION}.`);
  // The effective summaries: the later supersedes the earlier, and a
  // closure never drops the failing count.
  const effective = section.locator('.coverage-summaries > li');
  await expect(effective).toHaveCount(2);
  await expect(effective.nth(1)).toContainText('supersedes');
  await expect(effective.nth(1)).toContainText('Subjects with at least one exception: 3');
  await expect(effective.nth(1)).toContainText('Exceptions found; overall assessment inconclusive.');
  await expect(effective.nth(1)).toContainText('3 exceptions of these subjects are open: while one is open, no summary concludes that no exception exists.');
  await expect(page.locator('body')).not.toContainText('confidence');
  await expect(page.locator('body')).not.toContainText('%');
  // WCAG 2.2 AA: the section's text keeps 4.5:1 contrast on its background.
  const ratios = await section.evaluate(root => {
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
    return ['.exception-status', '.context-note', 'th', 'td', 'li']
      .flatMap(selector => [...root.querySelectorAll(selector)].slice(0, 4).map(element => {
        const foreground = luminance(getComputedStyle(element).color);
        const back = luminance(background(element));
        return { selector, ratio: (Math.max(foreground, back) + .05) / (Math.min(foreground, back) + .05) };
      }));
  });
  for (const selector of ['.exception-status', '.context-note', 'th', 'td']) expect(ratios.some(r => r.selector === selector), selector).toBe(true);
  for (const { selector, ratio } of ratios) expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
  await capture(page, info, 'exceptions.png');
  expect(errors).toEqual([]);
});

test('the accountable person closes an exception by keyboard, citing verified evidence, bound to the session', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openTask(page);
  const target = open();
  const posted: Request[] = [];
  await page.route('**/api/engagements/engagement-a/tasks/*/assessment/exceptions/*/dispositions?*', async route => {
    posted.push(route.request());
    const body = route.request().postDataJSON();
    await route.fulfill({ json: {
      id: `xdisp-${'a'.repeat(40)}`, exception_id: target.id, actor_id: 'actor-a', actor_label: 'Alex Auditor', kind: body.kind, rationale: body.rationale, recorded_us: '1',
      references: body.references.map((r: { original_id: string; locator: string; quote: string }) => ({ original_id: r.original_id, readable: true, filename: 'AP invoices.xlsx', version: 'v1', sha256: 'a'.repeat(64), locator: r.locator, location: r.locator.replace('cell:', ''), byte_start: null, byte_end: null, quote: r.quote, verification: 'verified', reason: null })),
    } });
  });
  const section = page.getByRole('region', { name: 'Exceptions', exact: true });
  const row = section.locator('tbody tr').nth(4);
  await expect(row).toContainText('INV-0054');
  const details = row.getByRole('button', { name: 'Show details', exact: true });
  await details.focus();
  await page.keyboard.press('Enter');
  await expect(row.getByRole('button', { name: 'Hide details', exact: true })).toBeFocused();
  const form = row.getByRole('form', { name: 'Close exception INV-0054', exact: true });
  const close = form.getByRole('button', { name: 'Close exception', exact: true });
  // Without reasons and evidence the closure is not sent.
  await expect(close).toHaveAttribute('aria-disabled', 'true');
  const reasons = form.getByRole('textbox', { name: 'Why this exception is closed', exact: true });
  await reasons.fill('The approval history was corrected — see the approver cell.');
  await expect(form.locator('[aria-live="polite"]')).toHaveText(`${new TextEncoder().encode('The approval history was corrected — see the approver cell.').length} of 2,000 bytes`);
  await expect(close).toHaveAttribute('aria-disabled', 'true');
  const chip = form.getByRole('checkbox', { name: /approver · Sheet1!D2 · “J. Smith”/ });
  await chip.focus();
  await page.keyboard.press('Space');
  await expect(chip).toBeChecked();
  await expect(close).not.toHaveAttribute('aria-disabled', 'true');
  await close.focus();
  await page.keyboard.press('Enter');
  await expect(row.getByRole('status')).toHaveText('Saved: closed. Its occurrences and verdicts are unchanged.');
  expect(posted).toHaveLength(1);
  const sent = posted[0]!;
  const headers = sent.headers();
  expect(headers['x-csrf-token']).toBeTruthy();
  expect(headers['x-expected-actor']).toBe('actor-a');
  expect(headers['x-expected-session']).toBe(headers['x-csrf-token']);
  expect(new URL(sent.url()).pathname).toContain(`/assessment/exceptions/${target.id}/dispositions`);
  const body = sent.postDataJSON();
  expect(Object.keys(body).sort()).toEqual(['key', 'kind', 'rationale', 'references']);
  expect(body).toMatchObject({ kind: 'closed', references: [{ original_id: 'ap-invoices', locator: 'cell:Sheet1!D2', quote: 'J. Smith' }] });
  expect(body.key).toMatch(/^[0-9a-f]{32}$/);
  await capture(page, info, 'exception-close.png');
  expect(errors).toEqual([]);
});

test('a refused closure says why and saves nothing', async ({ page }) => {
  await openTask(page);
  await page.route('**/api/engagements/engagement-a/tasks/*/assessment/exceptions/*/dispositions?*', route => route.fulfill({
    status: 403, json: { error: 'exception_close_forbidden', index: null },
  }));
  const row = page.getByRole('region', { name: 'Exceptions', exact: true }).locator('tbody tr').nth(4);
  await row.getByRole('button', { name: 'Show details', exact: true }).click();
  const form = row.getByRole('form', { name: 'Close exception INV-0054', exact: true });
  await form.getByRole('textbox', { name: 'Why this exception is closed', exact: true }).fill('Agreed.');
  await form.getByRole('checkbox', { name: /approver · Sheet1!D2 · “J. Smith”/ }).check();
  await form.getByRole('button', { name: 'Close exception', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText("Only an Audit manager or the Task's accountable person may close or reopen an exception. Nothing was saved.");
  await expect(row.getByRole('status')).toHaveCount(0);
});

test('a person without closing authority sees every status but no closing form', async ({ page }) => {
  await openTask(page, false);
  const section = page.getByRole('region', { name: 'Exceptions', exact: true });
  await expect(section).toContainText("Only an Audit manager or the Task's accountable person may close or reopen an exception.");
  const row = section.locator('tbody tr').nth(4);
  await row.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(row.getByRole('list', { name: 'Occurrences', exact: true })).toContainText('rule evaluated by the platform');
  await expect(row.getByRole('form')).toHaveCount(0);
});
