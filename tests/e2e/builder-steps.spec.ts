import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { BUILDER_STEPS, openStep } from './builder';

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

test('the Builder opens as a short list of questions', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/procedures/new');
  await page.getByLabel('Template').selectOption('P-1');
  await page.getByLabel('Control name').fill(CONTROL);
  await page.getByRole('button', { name: 'Create Procedure' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create Procedure' }).click();
  await expect(page.getByRole('heading', { level: 1, name: CONTROL })).toBeVisible();

  // Seven steps, each present exactly once, and a line saying how far through they are.
  const progress = page.locator('[data-builder-progress]');
  await expect(progress).toBeVisible();
  await expect(progress).toHaveText(/^\d+ of 7 answered\./);
  for (const heading of BUILDER_STEPS) {
    await expect(page.locator(`[data-step="${heading}"]`)).toHaveCount(1);
  }

  // A fresh P-1 Draft has no Period, no source and no system: those are the questions
  // in front of the auditor, so they are the steps already open.
  for (const heading of ['Period and scope', 'Population Source binding', 'Target System selection']) {
    const step = page.locator(`[data-step="${heading}"]`);
    await expect(step).toHaveAttribute('data-step-state', 'todo');
    await expect(step).toHaveJSProperty('open', true);
  }
  await expect(page.getByLabel('Period start')).toBeVisible();

  // The Template answered the Compliance Rule, so that step is closed — and says what it
  // holds without being opened. A closed step that said nothing would be hiding.
  const rules = page.locator('[data-step="Compliance Rule conditions"]');
  await expect(rules).toHaveAttribute('data-step-state', 'done');
  await expect(rules).toHaveJSProperty('open', false);
  await expect(rules.locator('.ls-step__title')).toHaveText('What counts as a finding');
  await expect(rules.locator('.ls-step__line')).toHaveText(/^\d+ rules?$/);
  await expect(rules.locator('.ls-step__mark')).toHaveText('Set');
  // Its editor is behind the fold — the save control, which is unambiguous. The rule
  // TEXT is a poor probe: the simple editor hides it whether the step is open or not.
  const saveRules = page.getByRole('button', { name: 'Save Compliance Rule', exact: true });
  await expect(saveRules).toBeHidden();

  // Opening it is one click, and the editor is there.
  await openStep(page, 'Compliance Rule conditions');
  await expect(saveRules).toBeVisible();
  await expect(page.locator('[data-simple-for="C1"]')).toBeVisible();

  // And with the keyboard alone, on a step nothing has opened yet.
  const schedule = page.locator('[data-step="Schedule"]');
  await expect(schedule).toHaveJSProperty('open', false);
  await schedule.locator('summary.ls-step__summary').focus();
  await page.keyboard.press('Enter');
  await expect(schedule).toHaveJSProperty('open', true);
  await expect(page.getByLabel('Frequency')).toBeVisible();

  // The plan the platform will execute is still reachable, one fold down, rather than
  // being the first thing an auditor meets.
  const plan = page.locator('[data-plan-detail]');
  await expect(plan).toHaveJSProperty('open', false);
  await plan.locator('summary').click();
  await expect(page.getByRole('heading', { level: 2, name: 'What the agent will do' })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((violation) => ({ id: violation.id, help: violation.help })),
    JSON.stringify(results.violations, null, 2),
  ).toEqual([]);
});
