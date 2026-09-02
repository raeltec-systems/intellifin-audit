import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { ACCOUNTS, AUTH_STATE, PASSWORD, signIn } from './accounts';

/**
 * Managing users through the real interface (FR-2, FR-7, NFR-11).
 *
 * The unit and integration suites prove the commands and their audit events. What only a
 * browser can prove is the part a person actually touches: that the confirmation dialog
 * stands between the click and the change, that the outcome is announced in a Banner,
 * that an Auditor typing the path sees the refusal and no user data at all, and that the
 * populated surface has no WCAG 2.1 AA violation.
 *
 * Every account this file creates is namespaced so a re-run against the same throwaway
 * database does not collide with the last one — the surface has no user deletion, by
 * design, so a fixed address would be taken the second time.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Unique per run, and obviously synthetic. */
const stamp = `${Date.now()}`;
const newUserEmail = `e2e-created-${stamp}@synthetic.invalid`;
const newUserName = `E2E Created ${stamp}`;

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

test.describe('as a PoC Administrator', () => {
  test.use({ storageState: AUTH_STATE.administrator });

  test('creates a user through the confirmation dialog and sees the result in a Banner', async ({
    page,
  }) => {
    await page.goto('/administration');
    await expect(page.getByRole('heading', { name: 'Administration', level: 1 })).toBeVisible();

    await page.getByLabel('Email address').fill(newUserEmail);
    await page.getByLabel('Full name').fill(newUserName);
    await page.getByLabel('Initial password').fill(PASSWORD);
    await page.getByLabel('Role', { exact: true }).selectOption('auditor');
    await page.getByRole('button', { name: 'Create user' }).click();

    // The dialog stands between the click and the change, and states the consequence.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('holds the Auditor role from its first request');
    // Nothing confirms until it is confirmed: cancelling creates nobody.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('cell', { name: newUserEmail })).toHaveCount(0);

    await page.getByRole('button', { name: 'Create user' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create user' }).click();

    await expect(page.getByRole('status')).toContainText(`Created ${newUserEmail} as Auditor.`);
    await expect(page.getByRole('cell', { name: newUserEmail })).toBeVisible();
    // The password field is cleared: a credential must not sit on screen at a shared
    // workstation after it has been used.
    await expect(page.getByLabel('Initial password')).toHaveValue('');
  });

  test('refuses a second account for the same address, without creating one', async ({ page }) => {
    await page.goto('/administration');

    await page.getByLabel('Email address').fill(newUserEmail);
    await page.getByLabel('Full name').fill('Somebody Else');
    await page.getByLabel('Initial password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create user' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create user' }).click();

    await expect(page.locator('main#content').getByRole('alert')).toContainText(
      'That email address already has an account.',
    );
    // One row, not two.
    await expect(page.getByRole('cell', { name: newUserEmail })).toHaveCount(1);
  });

  test('changes a role, confirming first and reporting the outcome', async ({ page }) => {
    await page.goto('/administration');

    const control = page.getByLabel(`Role for ${newUserName}`);
    await expect(control).toHaveValue('auditor');
    await control.selectOption('audit-manager');

    const row = page.getByRole('row', { name: new RegExp(newUserName) });
    await row.getByRole('button', { name: 'Change role' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Their current session is not ended.');
    await dialog.getByRole('button', { name: 'Change role' }).click();

    await expect(page.getByRole('status')).toContainText(
      'Set the role to Audit Manager. It applies on their next request.',
    );
    await expect(page.getByLabel(`Role for ${newUserName}`)).toHaveValue('audit-manager');
  });

  test('removes a role, and says the account and its sessions survive', async ({ page }) => {
    await page.goto('/administration');

    await page.getByLabel(`Role for ${newUserName}`).selectOption('');
    const row = page.getByRole('row', { name: new RegExp(newUserName) });
    await row.getByRole('button', { name: 'Change role' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('keeps their account and their current session');
    await dialog.getByRole('button', { name: 'Remove role' }).click();

    await expect(page.getByRole('status')).toContainText(
      'Removed the role. The account and its sessions are unchanged.',
    );
    // The account is still listed, now with no role.
    await expect(row).toContainText('No role');
  });

  test('the populated surface has no WCAG 2.1 AA violation', async ({ page }) => {
    await page.goto('/administration');
    await expect(page.getByRole('table')).toBeVisible();
    await scan(page);
  });

  test('the create dialog, open over the populated surface, has no violation', async ({ page }) => {
    await page.goto('/administration');
    await page.getByLabel('Email address').fill(`e2e-a11y-${stamp}@synthetic.invalid`);
    await page.getByLabel('Full name').fill('E2E A11y');
    await page.getByLabel('Initial password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await scan(page);
  });
});

test.describe('as an Auditor', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('is refused the surface, and no user data reaches the browser', async ({ page }) => {
    await page.goto('/administration');

    await expect(page.locator('main#content').getByRole('alert')).toHaveText(
      'Your role does not permit this action.',
    );
    // Not the list, not the form, not one address.
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Add a user' })).toHaveCount(0);
    await expect(page.getByText(newUserEmail)).toHaveCount(0);
    await expect(page.getByText('@example.test')).toHaveCount(0);
  });
});

/**
 * Sign-out signs in FIRST, rather than reusing a saved state.
 *
 * The saved cookies in `playwright/.auth` are one session row each, shared by every
 * other spec in the suite. Ending one of those would sign the rest of the run out. This
 * block therefore makes a session of its own and destroys that one — which is also the
 * more honest test, since it exercises sign-in and sign-out end to end.
 */
test.describe('sign out', () => {
  test('ends the session and returns to the sign-in page', async ({ page }) => {
    await signIn(page, ACCOUNTS.auditor.email);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    // And this session really is gone: a protected path redirects instead of rendering.
    await page.goto('/runs');
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
