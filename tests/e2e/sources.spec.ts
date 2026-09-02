import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { MANUAL_UPLOAD_SENTENCE } from '../../apps/web/src/design/copy';

import { createSqlClient } from '@intellifin/infrastructure';

import { AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * Registering a Population Source binding through the real interface (FR-6, FR-41,
 * NFR-11).
 *
 * The unit and integration suites prove the digest, the refusals and the atomicity. What
 * only a browser can prove is what a person actually meets: that the confirmation dialog
 * stands between the click and the change, that the digest is shown in full on the
 * surface, that a binding with no declared count is SAVED and carries EXPERIENCE.md's
 * warning, that a manual upload says plainly that only a `once` Schedule may use it, that
 * an Auditor typing the path sees the refusal and no binding data at all, and that the
 * populated surface has no WCAG 2.1 AA violation.
 *
 * Every binding this file creates is namespaced so a re-run against the same throwaway
 * database does not collide with the last one.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Unique per run, and obviously synthetic. */
const stamp = `${Date.now()}`;
const versionedName = `E2E Leavers ${stamp}`;
const apiName = `E2E Accounts API ${stamp}`;
const uploadName = `E2E Upload ${stamp}`;
const noCountName = `E2E No count ${stamp}`;

/**
 * Delete the bindings this file created.
 *
 * The surface has no deletion, by design — retirement is a state, so a Run that froze a
 * digest can still resolve it. That makes a run which registers and stops leave rows
 * behind for every later run, so the suite cleans up the way the integration suite does,
 * over the same throwaway-database guard, and leaves the audit events alone because those
 * are exactly what must survive.
 */
test.afterAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl === '') return;
  assertThrowawayDatabase(databaseUrl);

  const sql = createSqlClient(databaseUrl, { max: 1 });
  try {
    await sql`DELETE FROM population_source_binding WHERE display_name LIKE ${`E2E %${stamp}%`}`;
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

/** Fill the create form. The kind decides whether a location field exists at all. */
async function fillForm(
  page: Page,
  options: {
    name: string;
    kind: 'manual-upload' | 'versioned-file' | 'read-only-api';
    location?: string;
    schema: string;
    mechanism: 'cover-sheet' | 'count-endpoint' | 'none';
    sensitive?: string;
  },
): Promise<void> {
  await page.getByLabel('Display name').fill(options.name);
  await page.getByLabel('Binding kind').selectOption(options.kind);
  if (options.kind !== 'manual-upload') {
    await page.getByLabel('Location').fill(options.location ?? '');
  }
  await page.getByLabel('Declared schema').fill(options.schema);
  await page.getByLabel('Declared-count mechanism').selectOption(options.mechanism);
  await page.getByLabel('Sensitive fields (optional)').fill(options.sensitive ?? '');
}

/** Submit the create form and confirm it in the dialog. */
async function submitAndConfirm(page: Page, label: 'Register binding' | 'Save changes') {
  await page.getByRole('button', { name: label }).click();
  await page.getByRole('dialog').getByRole('button', { name: label }).click();
}

test.describe('as a PoC Administrator', () => {
  test.use({ storageState: AUTH_STATE.administrator });

  test('registers a versioned file through the dialog and sees its digest', async ({ page }) => {
    await page.goto('/administration/sources');
    await expect(
      page.getByRole('heading', { name: 'Population Source bindings', level: 1 }),
    ).toBeVisible();

    // A submission that beats hydration must not put every field in the URL. With no
    // method a form submits as a GET, which would do exactly that.
    await expect(page.locator('form.ls-admin__form')).toHaveAttribute('method', 'post');

    // There is no file input on this surface, for any kind. This story registers a
    // BINDING; acquiring the population belongs to Epic 2's Adapters.
    await expect(page.locator('input[type="file"]')).toHaveCount(0);

    await fillForm(page, {
      name: versionedName,
      kind: 'versioned-file',
      location: 's3://synthetic-bucket/hr/leavers/2026-08.csv',
      schema: 'employee_id\nemployment_status\ntermination_date\nsalary',
      mechanism: 'cover-sheet',
      sensitive: 'salary',
    });

    await page.getByRole('button', { name: 'Register binding' }).click();

    // The dialog stands between the click and the change, and states the consequence.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('reconciles the rows it read against the declared count');
    // No Procedure exists yet, so the draft warning must NOT appear: "a draft for 0
    // Procedures" is a sentence that cannot be true.
    await expect(dialog).not.toContainText('platform-authored draft');

    // Nothing is registered until it is confirmed. The RELOAD is the assertion: the table
    // on screen was rendered before the click, so a check against it would pass whether or
    // not cancelling stored anything.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('rowheader', { name: versionedName })).toHaveCount(0);

    await fillForm(page, {
      name: versionedName,
      kind: 'versioned-file',
      location: 's3://synthetic-bucket/hr/leavers/2026-08.csv',
      schema: 'employee_id\nemployment_status\ntermination_date\nsalary',
      mechanism: 'cover-sheet',
      sensitive: 'salary',
    });
    await submitAndConfirm(page, 'Register binding');

    await expect(page.locator('.ls-banner--success')).toContainText(
      `Registered ${versionedName}.`,
    );

    // The digest is on the surface, in full: it is the value an auditor compares.
    const row = page.getByRole('row', { name: new RegExp(versionedName) });
    await expect(row).toBeVisible();
    expect(await row.locator('.ls-digest').innerText()).toMatch(/^[0-9a-f]{64}$/);
    // And what it froze is beside it: the location, the schema and the masked field.
    await expect(row).toContainText('s3://synthetic-bucket/hr/leavers/2026-08.csv');
    await expect(row).toContainText('termination_date');
    await expect(row).toContainText('Signed cover sheet');
  });

  test('registers a read-only API, and its digest differs from the file binding', async ({
    page,
  }) => {
    await page.goto('/administration/sources');
    await fillForm(page, {
      name: apiName,
      kind: 'read-only-api',
      location: 'https://accessgate.synthetic.invalid/api/accounts',
      schema: 'account_id\nowner\nstatus',
      mechanism: 'count-endpoint',
    });
    await submitAndConfirm(page, 'Register binding');
    await expect(page.locator('.ls-banner--success')).toContainText(`Registered ${apiName}.`);

    await page.reload();
    const apiRow = page.getByRole('row', { name: new RegExp(apiName) });
    const fileRow = page.getByRole('row', { name: new RegExp(versionedName) });
    const apiDigest = await apiRow.locator('.ls-digest').innerText();
    const fileDigest = await fileRow.locator('.ls-digest').innerText();
    expect(apiDigest).toMatch(/^[0-9a-f]{64}$/);
    // Two different contracts freeze two different numbers.
    expect(apiDigest).not.toBe(fileDigest);
    await expect(apiRow).toContainText('Count endpoint');
    await expect(apiRow).toContainText('None designated');
  });

  test('marks a manual upload upload-only and states the `once` restriction', async ({ page }) => {
    await page.goto('/administration/sources');

    // Both assertions below were true BEFORE the selection, because the form used to
    // open on `manual-upload`: they could not fail from the branch they name. The
    // starting state is asserted first, so the change is what is being tested.
    const uploadNotice = page.locator('.ls-banner--info');
    await expect(page.getByLabel('Location')).toBeVisible();
    await expect(uploadNotice).toHaveCount(0);

    await page.getByLabel('Binding kind').selectOption('manual-upload');
    // A manual upload names nowhere: the file arrives with the Run, so the field is gone
    // rather than present and ignored.
    await expect(page.getByLabel('Location')).toHaveCount(0);

    // The restriction is stated where it can still be acted on. FR-6 and AD-23: the
    // Builder enforces it in Epic 2, but nobody should first learn about it from somebody
    // else's blocked Submit. The sentence is EXPERIENCE.md's, character for character.
    await expect(uploadNotice).toHaveText(MANUAL_UPLOAD_SENTENCE);

    await fillForm(page, {
      name: uploadName,
      kind: 'manual-upload',
      schema: 'voucher_no\namount',
      mechanism: 'cover-sheet',
      sensitive: 'amount',
    });
    await submitAndConfirm(page, 'Register binding');
    await expect(page.locator('.ls-banner--success')).toContainText(`Registered ${uploadName}.`);

    await page.reload();
    const row = page.getByRole('row', { name: new RegExp(uploadName) });
    await expect(row).toContainText('Manual upload');
    await expect(row).toContainText('valid only for a `once` Schedule');
    // The location cell says what it means rather than being empty, which a reader takes
    // for a missing value.
    await expect(row).toContainText('Supplied with each Run');
  });

  test('SAVES a binding with no declared count, and warns what it costs', async ({ page }) => {
    await page.goto('/administration/sources');

    await fillForm(page, {
      name: noCountName,
      kind: 'versioned-file',
      location: 's3://synthetic-bucket/misc/unknown.csv',
      schema: 'row_id',
      mechanism: 'none',
    });

    // EXPERIENCE.md's sentence, character for character, on the form before the save.
    const warning = page.locator('.ls-banner--warning');
    await expect(warning).toContainText('Population Source must declare an expected record count.');

    await submitAndConfirm(page, 'Register binding');
    // Saved, not refused. The absence has to be visible somewhere a person can close it,
    // and a binding that does not exist shows nobody anything.
    await expect(page.locator('.ls-banner--success')).toContainText(`Registered ${noCountName}.`);

    await page.reload();
    const row = page.getByRole('row', { name: new RegExp(noCountName) });
    await expect(row).toBeVisible();
    await expect(row).toContainText('None declared');
    await expect(row).toContainText('Population Source must declare an expected record count.');
  });

  test('refuses a sensitive field the schema does not declare', async ({ page }) => {
    await page.goto('/administration/sources');
    const refusedName = `E2E Bad mask ${stamp}`;

    await fillForm(page, {
      name: refusedName,
      kind: 'versioned-file',
      location: 's3://synthetic-bucket/misc/masked.csv',
      schema: 'employee_id',
      mechanism: 'cover-sheet',
      sensitive: 'salary',
    });
    await submitAndConfirm(page, 'Register binding');

    await expect(page.locator('main#content').getByRole('alert')).toHaveText(
      'A sensitive field must be one of the declared schema fields.',
    );
    // Nothing was stored — read from the server, not from the table this page already
    // had. Without the reload this assertion cannot fail.
    await page.reload();
    await expect(page.getByRole('rowheader', { name: refusedName })).toHaveCount(0);
  });

  test('a name change leaves the digest where it was; a schema change moves it', async ({
    page,
  }) => {
    await page.goto('/administration/sources');
    await page.getByRole('link', { name: versionedName }).click();

    await expect(page.getByRole('heading', { name: versionedName, level: 1 })).toBeVisible();
    const shown = page.locator('dd.ls-digest-cell .ls-digest');
    const before = await shown.innerText();
    expect(before).toMatch(/^[0-9a-f]{64}$/);

    // A display name is not one of the five.
    await page.getByLabel('Display name').fill(`${versionedName} renamed`);
    await submitAndConfirm(page, 'Save changes');
    await expect(page.locator('.ls-banner--success')).toContainText('The digest did not change');
    await page.reload();
    await expect(page.locator('dd.ls-digest-cell .ls-digest')).toHaveText(before);

    // Reordering the declared schema IS a change: a schema declares field positions, and a
    // parser told the other order reads the wrong column.
    await page
      .getByLabel('Declared schema')
      .fill('salary\nemployee_id\nemployment_status\ntermination_date');
    await submitAndConfirm(page, 'Save changes');
    // The specific sentence, not a phrase both messages share: "recorded in the audit
    // chain" appears on the annotated path too, so this would pass with nothing published.
    await expect(page.locator('.ls-banner--success')).toContainText('The digest is now ');
    await page.reload();
    await expect(page.locator('dd.ls-digest-cell .ls-digest')).not.toHaveText(before);
  });

  test('the populated surface has no WCAG 2.1 AA violation', async ({ page }) => {
    await page.goto('/administration/sources');
    await expect(page.getByRole('table')).toBeVisible();
    await scan(page);
  });

  test('the surface with both warnings showing has no violation', async ({ page }) => {
    // The two Banners are the only markup this story adds that the registrations surface
    // does not have, so they get their own scan rather than relying on the default state.
    await page.goto('/administration/sources');
    await page.getByLabel('Binding kind').selectOption('manual-upload');
    await page.getByLabel('Declared-count mechanism').selectOption('none');
    await expect(page.locator('.ls-banner--warning')).toBeVisible();
    await expect(page.locator('.ls-banner--info')).toBeVisible();
    await scan(page);
  });

  test('the confirmation dialog, open over the populated surface, has no violation', async ({
    page,
  }) => {
    await page.goto('/administration/sources');
    await fillForm(page, {
      name: `E2E A11y ${stamp}`,
      kind: 'versioned-file',
      location: 's3://synthetic-bucket/a11y/rows.csv',
      schema: 'row_id',
      mechanism: 'cover-sheet',
    });
    await page.getByRole('button', { name: 'Register binding' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await scan(page);
  });
});

test.describe('as an Auditor', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('is refused the surface, and no binding data reaches the browser', async ({ page }) => {
    await page.goto('/administration/sources');

    await expect(page.locator('main#content').getByRole('alert')).toHaveText(
      'Your role does not permit this action.',
    );
    // Not the list, not the form, not one location, field name or digest.
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Register a Population Source binding' }),
    ).toHaveCount(0);
    await expect(page.getByText(versionedName)).toHaveCount(0);
    await expect(page.getByText('s3://')).toHaveCount(0);
    await expect(page.getByText('synthetic.invalid')).toHaveCount(0);
    await expect(page.getByText('employee_id')).toHaveCount(0);
  });

  test('is refused the DETAIL surface too, where authorize-before-lookup matters', async ({
    page,
  }) => {
    // The list page refuses before it reads anything. The detail page has an id to look
    // up, so it is the one where a check placed after the lookup would disclose whether
    // a binding exists — and it was the surface with no test.
    // A well-formed id that does not exist. That is the stronger case: if the role
    // check ran AFTER the lookup, this would answer 404 and disclose that no such
    // binding exists. It must answer the refusal instead.
    await page.goto('/administration/sources/018f0000-0000-7000-8000-0000000000ff');

    await expect(page.locator('main#content').getByRole('alert')).toHaveText(
      'Your role does not permit this action.',
    );
    await expect(page.getByText(versionedName)).toHaveCount(0);
    await expect(page.locator('.ls-digest')).toHaveCount(0);
  });

  test('a malformed id answers a page, never a 500', async ({ page }) => {
    // `/administration/sources/<anything a person types>` reaches a `uuid` column, and
    // PostgreSQL raises 22P02 on text that is not one. Unguarded that is a framework
    // 500 for a mistyped link. The repository reports absence instead.
    const response = await page.goto('/administration/sources/not-a-uuid');
    expect(response?.status()).toBeLessThan(500);
  });
});
