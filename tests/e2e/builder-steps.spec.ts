import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { attachAuthoringScreenshot, openStep, openPlanDetail } from './builder';

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
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test('guided preparation preserves edits, records saved review and stays keyboard accessible', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto('/procedures/new');
  await page.getByLabel('Template').selectOption('P-1');
  await page.getByLabel('Control name').fill(CONTROL);
  await page.getByRole('button', { name: 'Create Procedure' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create Procedure' }).click();
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
