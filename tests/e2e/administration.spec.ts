import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { createSqlClient } from '@intellifin/infrastructure';

import { ACCOUNTS, AUTH_STATE, PASSWORD, assertThrowawayDatabase, signIn } from './accounts';

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

/**
 * Delete the accounts this file created.
 *
 * The surface has no user deletion, by design — removing a role is the revocation and
 * deleting an account would orphan the audit history that names it. So a run that creates
 * accounts and stops leaves them behind for every later run, and the database grows one
 * unusable synthetic account per run per address. The integration suite cleans up after
 * itself for the same reason; this does it the same way, over the same guard, and leaves
 * the audit events alone because those are exactly what must survive.
 */
test.afterAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl === '') return;
  assertThrowawayDatabase(databaseUrl);

  const sql = createSqlClient(databaseUrl, { max: 1 });
  try {
    await sql`DELETE FROM auth_user WHERE email LIKE ${`e2e-created-${stamp}%`}`;
    await sql`DELETE FROM auth_user WHERE email LIKE ${`e2e-a11y-${stamp}%`}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

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

    // A submission that beats hydration must not put the password in a URL. With no
    // method a form submits as a GET, which would do exactly that.
    await expect(page.locator('form.ls-admin__form')).toHaveAttribute('method', 'post');

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

  test('cannot change their own role, and the reason is on the page', async ({ page }) => {
    // The command refuses this — that is the control — but a person must not have to be
    // refused to find out. Self-demotion and removing the last administrator are the two
    // ways to lock this deployment out of itself, and recovery is shell access.
    await page.goto('/administration');

    const ownRow = page.getByRole('row', { name: /administrator@example\.test/ });
    const ownSelect = ownRow.getByRole('combobox');
    await expect(ownSelect).toBeDisabled();

    const ownButton = ownRow.getByRole('button', { name: 'Change role' });
    await expect(ownButton).toHaveAttribute('aria-disabled', 'true');
    // The reason is reachable, not a tooltip: `aria-disabled` keeps it focusable.
    const describedBy = await ownButton.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    await expect(page.locator(`#${describedBy as string}`)).toHaveText(
      'You cannot change your own role. Ask another PoC Administrator to change it.',
    );
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
 * Sign-out, with JavaScript DISABLED.
 *
 * This is the assertion that would have caught the defect this control was shipped with.
 * The first version was a `fetch` inside an `onClick` handler, so a click before React
 * hydrated did nothing at all — and the JavaScript-enabled test caught it only
 * intermittently, when it happened to click inside that window. Running the same journey
 * with no JavaScript at all removes the timing from the question: if the control needs a
 * bundle, it fails here every time.
 *
 * It is the real-world case as well as the deterministic one. At a shared workstation a
 * person clicks Sign out, sees nothing happen, and walks away believing the session
 * ended.
 *
 * Sign-in still needs JavaScript, so the session is established in a JavaScript-enabled
 * context and its cookies are handed to a JavaScript-disabled one. That also keeps this
 * block from ending a session the rest of the suite shares: the saved states in
 * `playwright/.auth` are one session row each, and signing one out would sign the rest
 * of the run out with it.
 */
test.describe('sign out', () => {
  test('works with no JavaScript: ends the session and lands on the sign-in page', async ({
    browser,
    baseURL,
  }) => {
    const signedIn = await browser.newContext({ baseURL });
    const signInPage = await signedIn.newPage();
    await signIn(signInPage, ACCOUNTS.auditor.email);
    const storageState = await signedIn.storageState();
    await signedIn.close();

    const noScript = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
      storageState,
    });
    const page = await noScript.newPage();
    try {
      await page.goto('/');
      // The shell rendered server-side, so the control is really on the page.
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

      // A real form, submitted by the browser itself.
      const form = page.locator('form.ls-signout');
      await expect(form).toHaveAttribute('method', 'post');
      await expect(form).toHaveAttribute('action', '/api/auth/sign-out');

      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/sign-in$/);

      // And this session really is gone: a protected path redirects instead of rendering.
      await page.goto('/runs');
      await expect(page).toHaveURL(/\/sign-in$/);

      // Signing out again is not an error. A double submit, a resubmitted form and a
      // second tab all land here, and none of them may meet a 500.
      const again = await page.request.post('/api/auth/sign-out', { maxRedirects: 0 });
      expect(again.status()).toBe(303);
      expect(again.headers()['location']).toContain('/sign-in');
    } finally {
      await noScript.close();
    }
  });
});
