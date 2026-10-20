import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page, Request, TestInfo } from '@playwright/test';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration } from './cleanup';

// Story 24.3a presentation. Revision chains, carried facts and dispositions
// are produced and refused end to end by `crates/worker/tests/revision.rs`
// against a loopback model, real PostgreSQL and the real API. This harness
// never composes a model: it fulfils the work and history reads with the
// exact JSON those suites recorded, answers the disposition POST itself
// (checking what the browser sends), and checks what the auditor sees and
// can reach by keyboard.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const assessment = JSON.parse(readFileSync(new URL('../fixtures/task-assessment.json', import.meta.url), 'utf8'));
const recorded = JSON.parse(readFileSync(new URL('../fixtures/task-revision.json', import.meta.url), 'utf8'));
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

const replaceIds = (value: unknown, from: string, to: string): unknown => JSON.parse(JSON.stringify(value).replaceAll(`"${from}"`, `"${to}"`));
const evaluationOf = (key: string) => {
  const criterion = assessment.criteria.find((c: { key: string }) => c.key === key);
  return assessment.evaluations.find((e: { criterion_id: string; subject: string }) => e.criterion_id === criterion.id && e.subject === 'INV-0042');
};
const approval = evaluationOf('approval');
const segregation = evaluationOf('segregation');
// The approval chain's history as recorded: revision 3 is its head.
const history = replaceIds(recorded, recorded.chain_id, approval.id) as typeof recorded;
const head = history.entries.at(-1);
const withChains = () => {
  const body = JSON.parse(JSON.stringify(assessment));
  for (const e of body.evaluations) {
    if (e.id === approval.id) e.chain = { ...e.chain, head_id: head.id, revision: head.revision, basis_id: head.basis_id, criterion_id: head.criterion_id, verdict: head.verdict, reason: head.reason, causes: head.causes, effective_verdict: head.verdict };
  }
  return body;
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
  await page.getByLabel('Task objective', { exact: true }).fill('Assess approval of 2026 AP invoices');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect(page.locator('.task-card h3').filter({ hasText: 'Assess approval of 2026 AP invoices' })).toBeVisible();
  await page.route('**/api/engagements/engagement-a/tasks/*/work?*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), assessment: withChains(), assessment_unavailable: false } });
  });
  await page.route('**/api/engagements/engagement-a/tasks/*/assessment/chains/*/history?*', async route => {
    const url = new URL(route.request().url());
    const after = url.searchParams.get('cursor');
    expect(route.request().headers()['x-expected-session']).toBeTruthy();
    const entries = after ? history.entries.filter((e: { revision: string }) => BigInt(e.revision) > BigInt(after)) : history.entries;
    await route.fulfill({ json: { ...history, entries } });
  });
  await page.getByRole('button', { name: 'Open Assess approval of 2026 AP invoices', exact: true }).click();
}

test('a revised evaluation shows its closed causes, its history and its review state', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openTask(page);
  const review = page.getByRole('group', { name: 'Review of approval for INV-0042', exact: true });
  await expect(review).toContainText('Revision 3 · because the facts it reads changed, the basis was revised, a person asked for reconsideration');
  await expect(review).toContainText('Not reviewed yet');
  // The history opens by keyboard and lists every revision with its causes,
  // the facts that changed and the person's words, as quoted text.
  const toggle = review.getByRole('button', { name: 'Show revision history', exact: true });
  await toggle.focus();
  await page.keyboard.press('Enter');
  // The same button now says it hides the history, and stays focused.
  const hide = review.getByRole('button', { name: 'Hide revision history', exact: true });
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  await expect(hide).toBeFocused();
  const region = page.getByRole('region', { name: 'Revision history of approval for INV-0042', exact: true });
  await expect(region.locator('.revision-history > li')).toHaveCount(3);
  await expect(region).toContainText('3 revisions · showing 3');
  await expect(region.locator('.revision-history > li').nth(0)).toContainText('The first evaluation');
  await expect(region.locator('.revision-history > li').nth(1)).toContainText('Because the facts it reads changed');
  await expect(region.locator('.revision-history > li').nth(1)).toContainText('Asked Zobba to reconsider · about the facts');
  await expect(region.locator('.revision-history > li').nth(1)).toContainText('The amount cell was re-keyed after approval');
  await expect(region.locator('.revision-history > li').nth(2)).toContainText('Replaced amount');
  // A rule verdict is never replaced: the form does not offer it.
  const form = review.getByRole('form', { name: 'Review revision 3', exact: true });
  await expect(form.getByRole('radio', { name: /Replace/ })).toHaveCount(0);
  await expect(form).toContainText('A rule verdict cannot be replaced');
  await expect(page.locator('body')).not.toContainText('confidence');
  // WCAG 2.2 AA: the review's text keeps 4.5:1 contrast on its background.
  const ratios = await review.evaluate(root => {
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
    return ['.review', '.context-note', 'legend', 'label', '.revision-history p']
      .flatMap(selector => [...root.querySelectorAll(selector)].slice(0, 3).map(element => {
        const foreground = luminance(getComputedStyle(element).color);
        const back = luminance(background(element));
        return { selector, ratio: (Math.max(foreground, back) + .05) / (Math.min(foreground, back) + .05) };
      }));
  });
  for (const selector of ['.review', '.context-note', 'legend', 'label']) expect(ratios.some(r => r.selector === selector), selector).toBe(true);
  for (const { selector, ratio } of ratios) expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
  await capture(page, info, 'revision-history.png');
  expect(errors).toEqual([]);
});

test('a person replaces Zobba\'s judgment by keyboard, citing a verified source, bound to the session', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openTask(page);
  const posted: Request[] = [];
  await page.route('**/api/engagements/engagement-a/tasks/*/assessment/revisions/*/dispositions?*', async route => {
    posted.push(route.request());
    const body = route.request().postDataJSON();
    await route.fulfill({ json: {
      id: `disp-${'a'.repeat(40)}`, actor_id: 'actor-a', actor_label: 'Alex Auditor', chain_id: segregation.id, revision: '1', revision_id: segregation.id,
      kind: body.kind, concern: body.concern, verdict: body.verdict, rationale: body.rationale, recorded_us: '1',
      references: body.references.map((r: { original_id: string; locator: string; quote: string }) => ({ original_id: r.original_id, readable: true, filename: 'AP invoices.xlsx', version: 'v1', sha256: 'a'.repeat(64), locator: r.locator, location: r.locator.replace('cell:', ''), byte_start: null, byte_end: null, quote: r.quote, verification: 'verified', reason: null })),
    } });
  });
  const review = page.getByRole('group', { name: 'Review of segregation for INV-0042', exact: true });
  const form = review.getByRole('form', { name: 'Review revision 1', exact: true });
  const replace = form.getByRole('radio', { name: 'Replace Zobba\'s judgment with my verdict', exact: true });
  await replace.focus();
  await page.keyboard.press('Space');
  await expect(replace).toBeChecked();
  await form.getByLabel('My verdict', { exact: true }).selectOption('not_met');
  const reasons = form.getByRole('textbox', { name: 'Your reasons', exact: true });
  await reasons.fill('The requester and J. Smith share a manager — see the approver cell.');
  // The byte counter counts UTF-8 bytes (the dash is three).
  await expect(form.locator('[aria-live="polite"]')).toHaveText(`${new TextEncoder().encode('The requester and J. Smith share a manager — see the approver cell.').length} of 2,000 bytes`);
  const chip = form.getByRole('checkbox', { name: /approver · Sheet1!D2 · “J. Smith”/ });
  await chip.focus();
  await page.keyboard.press('Space');
  await expect(chip).toBeChecked();
  await form.getByRole('button', { name: 'Save review', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(review.getByRole('status')).toHaveText('Saved: Replaced with a person\'s verdict · Not met (exception). The revision itself is unchanged.');
  expect(posted).toHaveLength(1);
  const sent = posted[0]!;
  const headers = sent.headers();
  expect(headers['x-csrf-token']).toBeTruthy();
  expect(headers['x-expected-actor']).toBe('actor-a');
  expect(headers['x-expected-session']).toBe(headers['x-csrf-token']);
  expect(new URL(sent.url()).pathname).toContain(`/assessment/revisions/${segregation.id}/dispositions`);
  const body = sent.postDataJSON();
  expect(Object.keys(body).sort()).toEqual(['concern', 'key', 'kind', 'rationale', 'references', 'verdict']);
  expect(body).toMatchObject({ kind: 'replaced', verdict: 'not_met', concern: null, references: [{ original_id: 'ap-invoices', locator: 'cell:Sheet1!D2', quote: 'J. Smith' }] });
  expect(body.key).toMatch(/^[0-9a-f]{32}$/);
  await capture(page, info, 'revision-disposition.png');
  expect(errors).toEqual([]);
});

test('a refused disposition says why, names the newest revision, and saves nothing', async ({ page }) => {
  await openTask(page);
  await page.route('**/api/engagements/engagement-a/tasks/*/assessment/revisions/*/dispositions?*', route => route.fulfill({
    status: 409, json: { error: 'revision_superseded', head_id: `rev-${'b'.repeat(40)}`, index: null },
  }));
  const review = page.getByRole('group', { name: 'Review of segregation for INV-0042', exact: true });
  const form = review.getByRole('form', { name: 'Review revision 1', exact: true });
  // An empty reason is not sent.
  const save = form.getByRole('button', { name: 'Save review', exact: true });
  await expect(save).toHaveAttribute('aria-disabled', 'true');
  await form.getByRole('textbox', { name: 'Your reasons', exact: true }).fill('Agreed.');
  await save.click();
  await expect(form.getByRole('alert')).toContainText('A newer revision was recorded. Nothing was saved');
  await expect(form.getByRole('alert')).toContainText('Newest revision: rev-bbbbbbbbb');
  await expect(review.getByRole('status')).toHaveCount(0);
});
