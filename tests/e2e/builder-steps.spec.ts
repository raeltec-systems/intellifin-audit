import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { bindingDigest } from '@intellifin/domain';

import { AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { attachAuthoringScreenshot, openStep, openPlanDetail } from './builder';
import { COMPOSER_HINTS, DATED_SCOPE_ACCEPT_LABEL, datedScopeLead } from '../../apps/web/src/procedures/assistant-words';
import { NO_SOURCE_FIELDS_YET } from '../../apps/web/src/procedures/source-words';
import { plannedFrequencyLine, START_RUN_LINK_LABEL } from '../../apps/web/src/design/run-start-words';

/**
 * The Builder as an auditor meets it: a short list of questions, not nine open forms.
 *
 * This is the one spec that does NOT keep the steps open. Every other Builder spec is
 * about what is inside a step and expands them all up front; this one is about the
 * disclosure itself — that an answered step starts closed, that a closed step still
 * says what is set in it, that clicking or pressing Enter on it opens the editor, and
 * that a step nobody has answered is open already so the work in front of you is the
 * work you can see.
 *
 * It exists because the owner rejected the previous Builder in exactly these terms:
 * "so many whistles and bells..should be a few clicks". A collapsed step that said
 * nothing would be hiding rather than simplifying, so the summary line is asserted as
 * hard as the toggle is.
 */

const stamp = `${Date.now()}`;
const CONTROL = `E2E builder steps ${stamp}`;

test.use({ storageState: AUTH_STATE.auditor });

test.afterAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl === '') return;
  assertThrowawayDatabase(databaseUrl);
  const { createSqlClient } = await import('@intellifin/infrastructure');
  const sql = createSqlClient(databaseUrl, { max: 1 });
  try {
    await sql`DELETE FROM procedure WHERE control_name LIKE ${`E2E builder steps ${stamp}%`}`;
    await sql`DELETE FROM population_source_binding WHERE display_name LIKE ${`E2E builder steps ${stamp}%`}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test('guided preparation preserves edits, records saved review and stays keyboard accessible', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto('/procedures/new');
  await page.getByLabel('Template').selectOption('P-1');
  await page.getByLabel('Procedure name').fill(CONTROL);
  // UX-07: creating a Draft is one action; no dialog stands between the click and it.
  await page.getByRole('button', { name: 'Create Procedure' }).click();
  await expect(page.getByRole('heading', { level: 1, name: CONTROL })).toBeVisible();
  await expect(page.locator('[data-guided-ready="true"]')).toBeVisible();
  await expect(page.locator('[data-preparation-progress]')).toContainText('0 of 6 sections reviewed');
  await expect(page.getByLabel('Risk', { exact: true })).toHaveValue(/^Synthetic example:/);
  await expect(page.getByLabel('Criterion reference', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Period start')).toBeHidden();

  // Question jumps are allowed; they cannot acknowledge missing saved content.
  await page.locator('[data-preparation-nav="scope"]').click();
  await page.getByRole('button', { name: '3. Check scope', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Does this saved scope match your assignment?', exact: true })).toBeFocused();
  let review = page.locator('[data-section-review="scope"] button');
  await expect(review).toHaveAccessibleDescription(/Save the scope and dates/);
  await review.click({ force: true });
  await expect(page.locator('[data-preparation-progress]')).toContainText('0 of 6 sections reviewed');
  await page.locator('[data-preparation-nav="evidence"]').click();
  await page.getByRole('button', { name: '4. Check choices', exact: true }).click();
  review = page.locator('[data-section-review="evidence"] button');
  await expect(review).toHaveAccessibleDescription(/Choose and save the population source and systems/);
  await review.click({ force: true });
  await expect(page.locator('[data-preparation-progress]')).toContainText('0 of 6 sections reviewed');

  await openStep(page, 'Period and scope');
  await page.getByLabel('Scope statement').fill('All August leavers, without sampling.');
  await openStep(page, 'Compliance Rule conditions');
  await expect(page.getByRole('button', { name: 'Save Compliance Rule', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Yes, use this control|Mark reviewed and continue)$/ })).toHaveAttribute('aria-disabled', 'true');
  await openStep(page, 'Period and scope');
  await expect(page.getByLabel('Scope statement')).toHaveValue('All August leavers, without sampling.');
  await page.getByRole('button', { name: 'Use saved Period and scope' }).click();
  await openStep(page, 'Risk');
  // The background plan check may have moved the whole-row token. Follow the same
  // visible reload remedy as an auditor, without bypassing the command's guard.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: /^(Yes, use this control|Mark reviewed and continue)$/ }).click();
    const success = page.getByText('Review recorded for Risk, control and objective.', { exact: true });
    const stale = page.getByText('That procedure changed since this page was loaded. Reload the page and try again.', { exact: true });
    await expect(success.or(stale)).toBeVisible();
    if (await success.isVisible()) break;
    await page.reload();
    await openStep(page, 'Risk');
  }
  await expect(page.locator('[data-preparation-nav="context"]')).toContainText('Reviewed by auditor');
  await expect(page.locator('[data-preparation-nav="scope"]')).toHaveAttribute('aria-current', 'step');
  await page.locator('[data-preparation-nav="frequency"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Frequency', { exact: true })).toBeVisible();
  await expect(page.locator('[data-preparation-panel="frequency"] h2')).toBeFocused();
  await openPlanDetail(page);
  await expect(page.getByRole('heading', { level: 2, name: 'What the agent will do' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit for approval', exact: true })).toHaveAttribute('aria-disabled', 'true');

  await openStep(page, 'Risk');
  await attachAuthoringScreenshot(page, testInfo, 'guided-preparation-desktop');
  for (const width of [1440, 899, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByLabel('Objective', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
  }
  await attachAuthoringScreenshot(page, testInfo, 'guided-preparation-mobile');
});

/**
 * UI cleanup 2026-09-22 — the Builder's first viewport and its words (UX-08, UX-09,
 * UX-10, UX-11, UX-12, UX-14, UX-15), on a laptop-sized screen.
 */
test('the first viewport shows the task, and the Builder speaks the auditor’s language end to end', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const name = `${CONTROL} layout`;
  // Two registered sources: one that declares every field P-1 needs, one that lacks the
  // termination date — so the chooser has a row to suggest and a row to explain.
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('The Builder journey requires the throwaway database.');
  assertThrowawayDatabase(databaseUrl);
  const { createSqlClient, CryptoUuidV7Generator } = await import('@intellifin/infrastructure');
  const sql = createSqlClient(databaseUrl, { max: 1 });
  try {
    for (const [suffix, schema] of [
      ['suited', ['employee_id', 'full_name', 'employment_status', 'termination_effective_date']],
      ['lacking', ['employee_id', 'full_name', 'employment_status']],
    ] as const) {
      const fields = { kind: 'versioned-file' as const, location: `https://population.synthetic.invalid/${suffix}.csv`, declaredSchema: [...schema], declaredCountMechanism: 'none' as const, sensitiveFields: [] as string[] };
      await sql`INSERT INTO population_source_binding (binding_id, display_name, kind, location, declared_schema, declared_count_mechanism, sensitive_fields, note, status, digest) VALUES (${new CryptoUuidV7Generator().next()}, ${`E2E builder steps ${stamp} source ${suffix}`}, 'versioned-file', ${fields.location}, ${fields.declaredSchema}, 'none', ${fields.sensitiveFields}, '', 'active', ${bindingDigest(fields)})`;
    }
  } finally { await sql.end({ timeout: 5 }); }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/procedures/new');
  await expect(page.locator('[data-new-procedure-ready]')).toHaveAttribute('data-new-procedure-ready', 'true');
  await page.getByLabel('Template').selectOption('P-1');
  await page.getByLabel('Procedure name').fill(name);
  await page.getByRole('button', { name: 'Create Procedure' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.locator('[data-guided-ready="true"]')).toBeVisible();

  // UX-08: the title, the outline and the current step's card begin inside the first
  // viewport, and the page does not scroll sideways at either laptop size.
  const inFirstViewport = async (selector: string) => {
    const box = await page.locator(selector).first().boundingBox();
    expect(box, selector).not.toBeNull();
    expect(box!.y, selector).toBeLessThan(768);
  };
  await page.evaluate(() => window.scrollTo(0, 0));
  await inFirstViewport('h1');
  await inFirstViewport('[data-preparation-outline]');
  await inFirstViewport('[data-preparation-panel="context"]');
  for (const [width, height] of [[1366, 768], [1280, 720]] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}x${height}`).toBe(true);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  // The conversation is sized to the viewport and scrolls inside itself, so the composer
  // is reachable without the page growing under it.
  const chat = page.locator('[data-preparation-panel="context"] .ls-chat').first();
  const chatBox = await chat.boundingBox();
  expect(chatBox!.height).toBeLessThanOrEqual(768);
  // On the evidence step, where the conversation opens the step, its composer is inside
  // the first viewport when the page is at the top — on an ordinary visit, without the
  // one-time "Draft created" notice above it.
  await page.goto(page.url().replace('?created=1', ''));
  await expect(page.locator('[data-guided-ready="true"]')).toBeVisible();
  await page.locator('[data-preparation-nav="evidence"]').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const composer = await page.locator('[data-preparation-panel="evidence"] [data-preparation-action-panel] textarea').boundingBox();
  expect(composer, 'evidence composer').not.toBeNull();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(768);

  // UX-09/UX-10: a scope request that names dates is proposed WITH those dates.
  await page.locator('[data-preparation-nav="scope"]').click();
  const scopeWriting = page.locator('[data-preparation-panel="scope"] [data-writing-section="scope"]');
  await expect(scopeWriting.locator('[data-composer-hint]')).toHaveAttribute('data-composer-hint', 'first-answer');
  await scopeWriting.getByLabel('Your answer', { exact: true }).fill('Employees terminated during August 2026');
  await scopeWriting.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(scopeWriting.locator('[data-proposed-period="2026-08-01/2026-08-31"]')).toBeVisible();
  await expect(scopeWriting.locator('[data-proposed-period]')).toHaveText(datedScopeLead({ from: '2026-08-01', to: '2026-08-31' }));
  await expect(scopeWriting.locator('[data-composer-hint]')).toHaveAttribute('data-composer-hint', 'dated-proposal');
  await expect(scopeWriting.locator('[data-composer-hint]')).toContainText(COMPOSER_HINTS['dated-proposal']);
  await scopeWriting.getByRole('button', { name: DATED_SCOPE_ACCEPT_LABEL, exact: true }).click();
  const scope = page.locator('[data-preparation-panel="scope"]');
  await expect(scope.locator('[data-guide-question="confirm"]')).toContainText('1–31 Aug 2026, both dates included (UTC).');
  await expect(scope.locator('[data-guide-question="confirm"]')).toContainText('Employees terminated during August 2026');

  // UX-11/UX-12: the evidence step leads with a searchable chooser, and filters wait for
  // a source instead of calling their fields missing from "this source".
  await page.locator('[data-preparation-nav="evidence"]').click();
  const evidence = page.locator('[data-preparation-panel="evidence"]');
  await expect(evidence.locator('[data-source-chooser]')).toBeVisible();
  await expect(evidence.locator('[data-filters-await-source]')).toHaveText(NO_SOURCE_FIELDS_YET);
  await expect(evidence.getByText('(this source does not provide it)')).toHaveCount(0);
  await expect(evidence.locator('[data-choices-listed-beside]')).toBeVisible();
  const suggested = evidence.locator('[data-source-group="suggested"] [data-source-choice]').first();
  await expect(suggested).toBeVisible();
  await expect(evidence.locator('[data-source-group="other"]')).toContainText('Missing: termination effective date');
  // The search filters the rows by what the auditor types.
  await evidence.getByLabel('Search sources', { exact: true }).fill(`${stamp} source lacking`);
  await expect(evidence.locator('[data-source-group="suggested"]')).toHaveCount(0);
  await evidence.getByLabel('Search sources', { exact: true }).fill(`${stamp} source suited`);
  await expect(evidence.locator('[data-source-group="other"]')).toHaveCount(0);
  await expect(evidence.locator('[data-source-chooser]')).not.toContainText('employee_id');
  await suggested.getByRole('button', { name: /^Choose / }).click();
  await expect(evidence.locator('[data-source-choice-outcome="saved"]')).toContainText('Existing filters were kept.');
  await expect(evidence.locator('[data-source-chosen]')).toHaveCount(1);

  // UX-14: the frequency step says it is a plan and names the one action that starts a Run.
  await page.locator('[data-preparation-nav="frequency"]').click();
  const frequency = page.locator('[data-preparation-panel="frequency"]');
  await expect(frequency.getByRole('heading', { level: 2, name: 'Planned frequency' })).toBeVisible();
  await expect(frequency.locator('[data-planned-frequency]')).toHaveText(plannedFrequencyLine('weekly'));
  await expect(frequency.locator('[data-frequency-start-run]')).toContainText(START_RUN_LINK_LABEL);

  // UX-15: readiness names the Builder's own section and its link opens that step.
  await page.locator('[data-preparation-nav="review"]').click();
  const item = page.locator('[data-readiness-item="targets-missing"]');
  await expect(item).toBeVisible();
  await expect(item).not.toContainText('Target System selection');
  await item.locator('[data-readiness-link="evidence"]').click();
  await expect(page.locator('[data-preparation-nav="evidence"]')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('[data-preparation-panel="evidence"] h2')).toBeFocused();

  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
  await attachAuthoringScreenshot(page, testInfo, 'builder-first-viewport');
});
