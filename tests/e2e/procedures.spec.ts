import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { BUILDER_SECTION_NOT_EDITABLE_SENTENCE, PROCEDURE_CARD_ABSENT } from '../../apps/web/src/design/copy';

import { AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * Authoring a Procedure from a Template through the real interface (FR-4, FR-5, UX-DR7,
 * NFR-11).
 *
 * The unit and integration suites prove the refusals, the atomicity and the §C pin.
 * What only a browser can prove is what a person actually meets: the empty state whose
 * only action is "New procedure", a card whose four absent cells say so in words, the
 * picker with NO default selection, the four Templates pre-filling four different
 * Builders, the read-only sections under the pinned sentence, and that a PoC
 * Administrator is refused the surface with no Procedure data in the response.
 *
 * Every Procedure this file creates is namespaced so a re-run against the same
 * throwaway database does not collide with the last one.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Unique per run, and obviously synthetic. */
const stamp = `${Date.now()}`;
const nameFor = (template: string) => `E2E ${template} control ${stamp}`;

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

/**
 * Delete the Procedures this file created.
 *
 * The surface has no deletion, and the audit events are exactly what must survive, so
 * the suite cleans up the way the integration suite does, over the same
 * throwaway-database guard.
 */
test.afterAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl === '') return;
  assertThrowawayDatabase(databaseUrl);

  const { createSqlClient } = await import('@intellifin/infrastructure');
  const sql = createSqlClient(databaseUrl, { max: 1 });
  try {
    await sql`DELETE FROM procedure WHERE control_name LIKE ${`E2E %${stamp}%`}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test.describe('as an Auditor', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('the empty list shows the EmptyState with New procedure as its only action', async ({
    page,
  }) => {
    await page.goto('/procedures');
    await expect(
      page.getByRole('heading', { name: 'Procedures', level: 1 }),
    ).toBeVisible();

    // The empty list must never read as a passed control, and its only action is the
    // link to /procedures/new.
    const empty = page.locator('.ls-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No Procedures yet.');
    const link = empty.getByRole('link', { name: 'New procedure' });
    await expect(link).toHaveAttribute('href', '/procedures/new');
    // ONLY that action.
    await expect(empty.getByRole('link')).toHaveCount(1);
  });

  for (const [index, template] of [
    { id: 'P-1', label: 'Terminated Users Retaining Access', hero: true },
    { id: 'P-2', label: 'Segregation-of-Duties Conflicts', hero: false },
    { id: 'P-3', label: 'High-Value Transactions Without Required Approval', hero: false },
    { id: 'P-4', label: 'Production Configuration Deviation', hero: false },
  ].entries()) {
    test(`creates a Procedure from ${template.id} and sees its pre-filled Builder`, async ({
      page,
    }, testInfo) => {
      testInfo.setTimeout(60_000);
      void index;

      const controlName = nameFor(template.id);
      await page.goto('/procedures/new');

      // The picker has NO default: a choice with a default is a choice the form made.
      const picker = page.getByLabel('Template');
      await expect(picker).toHaveValue('');

      // The hero is marked "(recommended)" — the flag is data on the record.
      if (template.hero) {
        await expect(picker).toContainText('recommended');
      }

      await picker.selectOption(template.id);
      await page.getByLabel('Control name').fill(controlName);
      await page.getByRole('button', { name: 'Create Procedure' }).click();

      // Creation lands on the Builder for the new Draft, with the Control name and
      // Template identity in the header (UX-DR7).
      await expect(page.getByRole('heading', { level: 1, name: controlName })).toBeVisible();
      await expect(page.getByText(`Template ${template.id} · ${template.label}`)).toBeVisible();

      // The sections are pre-filled and read-only, each under the pinned sentence.
      const sections = page.locator('.ls-card', { hasText: 'Objective' });
      await expect(sections.first()).toBeVisible();
      await expect(page.getByText(BUILDER_SECTION_NOT_EDITABLE_SENTENCE).first()).toBeVisible();

      // No edit controls anywhere in the sections: there is no editable section input
      // in this release. The one editable field is the Control name below.
      await expect(page.locator('.ls-card input, .ls-card select, .ls-card textarea')).toHaveCount(
        0,
      );

      // The Builder form is a real form and posts.
      await expect(page.locator('form.ls-admin__form')).toHaveAttribute('method', 'post');
    });
  }

  test('the four pre-fills differ where §C says they differ', async ({ page }) => {
    // Read each Builder's Objective section after the creates above; the objectives are
    // per-Template, so two Templates showing the same objective would mean the picker
    // pre-filled from the wrong record.
    const objectives = new Set<string>();
    for (const template of ['P-1', 'P-2', 'P-3', 'P-4']) {
      await page.goto('/procedures');
      const card = page
        .locator('.ls-card')
        .filter({ hasText: nameFor(template) })
        .first();
      await card.getByRole('link').click();
      await expect(page.getByRole('heading', { level: 2, name: 'Objective' })).toBeVisible();
      const objective = await page
        .locator('.ls-card')
        .filter({ hasText: 'Objective' })
        .first()
        .locator('p')
        .first()
        .innerText();
      objectives.add(objective);
    }
    expect(objectives.size).toBe(4);
  });

  test('the card shows the four absent cells in words, never a dash', async ({ page }) => {
    await page.goto('/procedures');
    const card = page
      .locator('.ls-card')
      .filter({ hasText: nameFor('P-1') })
      .first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(PROCEDURE_CARD_ABSENT.activeVersion);
    await expect(card).toContainText(PROCEDURE_CARD_ABSENT.schedule);
    await expect(card).toContainText(PROCEDURE_CARD_ABSENT.nextRun);
    await expect(card).toContainText(PROCEDURE_CARD_ABSENT.lastOutcome);
    // The Control name and Template identity are on the card (UX-DR7).
    await expect(card).toContainText(nameFor('P-1'));
    await expect(card).toContainText('P-1');
  });

  test('renames the Draft from the Builder after confirming', async ({ page }) => {
    await page.goto('/procedures');
    const card = page
      .locator('.ls-card')
      .filter({ hasText: nameFor('P-1') })
      .first();
    await card.getByRole('link').click();
    await page.getByRole('link', { name: 'Open Builder' }).click();

    const renamed = `${nameFor('P-1')} renamed`;
    await page.getByLabel('New Control name').fill(renamed);
    await page.getByRole('button', { name: 'Save Control name' }).click();

    // The dialog stands between the click and the change, and names the exact value.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(renamed);
    await dialog.getByRole('button', { name: 'Save Control name' }).click();

    await expect(page.locator('.ls-banner--success')).toContainText(
      'The Control name is now',
    );

    // Reload and read the header from the server, not from this page's state.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();
  });

  test('refuses an idle save: nothing changed, nothing recorded', async ({ page }) => {
    await page.goto('/procedures');
    const card = page
      .locator('.ls-card')
      .filter({ hasText: nameFor('P-2') })
      .first();
    await card.getByRole('link').click();
    await page.getByRole('link', { name: 'Open Builder' }).click();

    // Submit the name the Draft already carries — the honest idle save.
    const current = await page.getByRole('heading', { level: 1 }).innerText();
    await page.getByLabel('New Control name').fill(current);
    await page.getByRole('button', { name: 'Save Control name' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save Control name' }).click();

    await expect(page.locator('.ls-banner--success')).toContainText('Nothing changed');
  });

  test('the populated list has no WCAG 2.1 AA violation', async ({ page }) => {
    await page.goto('/procedures');
    await expect(page.locator('.ls-card').first()).toBeVisible();
    await scan(page);
  });

  test('the Builder has no WCAG 2.1 AA violation', async ({ page }) => {
    await page.goto('/procedures');
    const card = page
      .locator('.ls-card')
      .filter({ hasText: nameFor('P-1') })
      .first();
    await card.getByRole('link').click();
    await page.getByRole('link', { name: 'Open Builder' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Objective' })).toBeVisible();
    await scan(page);
  });

  test('a malformed id answers a page, never a 500', async ({ page }) => {
    // The repository reports absence for a malformed UUID; the page answers 404.
    const response = await page.goto('/procedures/not-a-uuid');
    expect(response?.status()).toBeLessThan(500);
  });
});

test.describe('as a PoC Administrator', () => {
  test.use({ storageState: AUTH_STATE.administrator });

  test('is refused the New-procedure surface, with no Procedure data in the response', async ({
    page,
  }) => {
    // Typed straight to the path: hiding the nav item is never the control.
    await page.goto('/procedures/new');

    await expect(page.locator('main#content').getByRole('alert')).toHaveText(
      'Your role does not permit this action.',
    );
    // Not the picker, not the field, not one Template name.
    await expect(page.getByLabel('Template')).toHaveCount(0);
    await expect(page.getByLabel('Control name')).toHaveCount(0);
    await expect(page.getByText('Terminated Users Retaining Access')).toHaveCount(0);
  });

  test('is refused the Builder for an existing Draft', async ({ page }) => {
    await page.goto('/procedures');
    // The list itself is readable — reading is not gated — so find any card and try
    // its Builder.
    const card = page.locator('.ls-card').first();
    if ((await card.count()) === 0) {
      // No Procedure exists in this environment; the refusal above is the whole proof.
      test.skip();
    }
    const href = await card.getByRole('link').first().getAttribute('href');
    await page.goto(`${href}/builder`);

    await expect(page.locator('main#content').getByRole('alert')).toHaveText(
      'Your role does not permit this action.',
    );
    // No section content, no editable field.
    await expect(page.getByLabel('New Control name')).toHaveCount(0);
    await expect(page.getByText(BUILDER_SECTION_NOT_EDITABLE_SENTENCE)).toHaveCount(0);
  });
});
