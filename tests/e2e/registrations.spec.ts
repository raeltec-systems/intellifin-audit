import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { createSqlClient } from '@intellifin/infrastructure';

import { AUTH_STATE, assertThrowawayDatabase } from './accounts';
import {
  READ_ONLY_CREDENTIAL,
  READ_ONLY_REFUSAL,
  UNDECLARED_CREDENTIAL,
  WRITE_CAPABLE_CREDENTIAL,
} from './credentials';

/**
 * Registering a Target System through the real interface (FR-8, AD-2, AD-10, NFR-11).
 *
 * The unit and integration suites prove the digest, the refusals and the atomicity. What
 * only a browser can prove is what a person actually meets: that the confirmation dialog
 * stands between the click and the change, that the digest is shown in full on the
 * surface, that a write-capable credential is refused with the exact sentence FR-8
 * specifies, that an Auditor typing the path sees the refusal and no registration data at
 * all, and that the populated surface has no WCAG 2.1 AA violation.
 *
 * Every registration this file creates is namespaced so a re-run against the same
 * throwaway database does not collide with the last one.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Unique per run, and obviously synthetic. */
const stamp = `${Date.now()}`;
const systemName = `E2E Northstar ${stamp}`;
const refusedName = `E2E Refused ${stamp}`;

/**
 * Delete the registrations this file created.
 *
 * The surface has no deletion, by design — retirement is a state, so a Run that froze a
 * digest can still resolve it. That makes a run which registers and stops leave rows
 * behind for every later run, so the suite cleans up the way the integration suite does,
 * over the same throwaway-database guard, and leaves the audit events alone because
 * those are exactly what must survive.
 */
test.afterAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl === '') return;
  assertThrowawayDatabase(databaseUrl);

  const sql = createSqlClient(databaseUrl, { max: 1 });
  try {
    await sql`DELETE FROM target_system_registration WHERE display_name LIKE ${`E2E %${stamp}%`}`;
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

/** Fill the create form. The kind decides which locator field exists. */
async function fillForm(
  page: Page,
  options: { name: string; credential: string; origin: string },
): Promise<void> {
  await page.getByLabel('Display name').fill(options.name);
  await page.getByLabel('System kind').selectOption('web');
  await page.getByLabel('Allowed origins').fill(options.origin);
  await page.getByLabel('Credential reference').fill(options.credential);
  await page.getByRole('checkbox', { name: 'Navigate' }).check();
  await page.getByRole('checkbox', { name: 'Read an attribute' }).check();
}

test.describe('as a PoC Administrator', () => {
  test.use({ storageState: AUTH_STATE.administrator });

  test('registers a system through the confirmation dialog and sees its digest', async ({
    page,
  }) => {
    await page.goto('/administration/registrations');
    await expect(
      page.getByRole('heading', { name: 'Target System registrations', level: 1 }),
    ).toBeVisible();

    // A submission that beats hydration must not put every field in the URL. With no
    // method a form submits as a GET, which would do exactly that.
    await expect(page.locator('form.ls-admin__form')).toHaveAttribute('method', 'post');

    await fillForm(page, {
      name: systemName,
      credential: READ_ONLY_CREDENTIAL,
      origin: 'https://northstar.synthetic.invalid',
    });
    await page.getByRole('button', { name: 'Register system' }).click();

    // The dialog stands between the click and the change, and states the consequence.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('using a credential that must be read-only');
    // No Procedure exists yet, so the draft warning must NOT appear: "a draft for 0
    // Procedures" is a sentence that cannot be true.
    await expect(dialog).not.toContainText('platform-authored draft');

    // Nothing is registered until it is confirmed.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('rowheader', { name: systemName })).toHaveCount(0);

    await page.getByRole('button', { name: 'Register system' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Register system' }).click();

    await expect(page.getByRole('status')).toContainText(`Registered ${systemName}.`);

    // The digest is on the surface, in full: it is the value an auditor compares.
    const row = page.getByRole('row', { name: new RegExp(systemName) });
    await expect(row).toBeVisible();
    const digest = await row.locator('.ls-digest').innerText();
    expect(digest).toMatch(/^[0-9a-f]{64}$/);

    // And connectivity says plainly that nothing has been observed.
    await expect(row).toContainText('Never probed');
    await expect(row).toContainText('This page never contacts a Target System.');
  });

  test('refuses a write-capable credential with the verbatim sentence', async ({ page }) => {
    await page.goto('/administration/registrations');

    await fillForm(page, {
      name: refusedName,
      credential: WRITE_CAPABLE_CREDENTIAL,
      origin: 'https://writes.synthetic.invalid',
    });
    await page.getByRole('button', { name: 'Register system' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Register system' }).click();

    await expect(page.locator('main#content').getByRole('alert')).toHaveText(READ_ONLY_REFUSAL);
    // Nothing was stored.
    await expect(page.getByRole('rowheader', { name: refusedName })).toHaveCount(0);
  });

  test('refuses a credential nobody has vouched for, with the same sentence', async ({ page }) => {
    await page.goto('/administration/registrations');

    await fillForm(page, {
      name: `${refusedName} unknown`,
      credential: UNDECLARED_CREDENTIAL,
      origin: 'https://unknown.synthetic.invalid',
    });
    await page.getByRole('button', { name: 'Register system' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Register system' }).click();

    // Identical to the write-capable refusal on purpose: unproven is not proven.
    await expect(page.locator('main#content').getByRole('alert')).toHaveText(READ_ONLY_REFUSAL);
    await expect(page.getByRole('rowheader', { name: `${refusedName} unknown` })).toHaveCount(0);
  });

  test('a name change leaves the digest where it was; an origin change moves it', async ({
    page,
  }) => {
    await page.goto('/administration/registrations');
    await page.getByRole('link', { name: systemName }).click();

    await expect(page.getByRole('heading', { name: systemName, level: 1 })).toBeVisible();
    const shown = page.locator('dd.ls-digest');
    const before = await shown.innerText();
    expect(before).toMatch(/^[0-9a-f]{64}$/);

    // A display name is not one of the six.
    await page.getByLabel('Display name').fill(`${systemName} renamed`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toContainText('The digest did not change');
    await page.reload();
    await expect(page.locator('dd.ls-digest')).toHaveText(before);

    // An origin is.
    await page.getByLabel('Allowed origins').fill('https://moved.synthetic.invalid');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toContainText('recorded in the audit chain');
    await page.reload();
    await expect(page.locator('dd.ls-digest')).not.toHaveText(before);
  });

  test('the populated surface has no WCAG 2.1 AA violation', async ({ page }) => {
    await page.goto('/administration/registrations');
    await expect(page.getByRole('table')).toBeVisible();
    await scan(page);
  });

  test('the confirmation dialog, open over the populated surface, has no violation', async ({
    page,
  }) => {
    await page.goto('/administration/registrations');
    await fillForm(page, {
      name: `E2E A11y ${stamp}`,
      credential: READ_ONLY_CREDENTIAL,
      origin: 'https://a11y.synthetic.invalid',
    });
    await page.getByRole('button', { name: 'Register system' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await scan(page);
  });
});

test.describe('as an Auditor', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('is refused the surface, and no registration data reaches the browser', async ({ page }) => {
    await page.goto('/administration/registrations');

    await expect(page.locator('main#content').getByRole('alert')).toHaveText(
      'Your role does not permit this action.',
    );
    // Not the list, not the form, not one origin, credential reference or digest.
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Register a Target System' })).toHaveCount(0);
    await expect(page.getByText(systemName)).toHaveCount(0);
    await expect(page.getByText('cred://')).toHaveCount(0);
    await expect(page.getByText('synthetic.invalid')).toHaveCount(0);
  });
});
