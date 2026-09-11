import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { BUILDER_CONTROL_NAME_EDITABLE_SENTENCE, BUILDER_DESKTOP_ONLY_SENTENCE, BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE, PROCEDURE_CARD_ABSENT, DECLARED_COUNT_MISSING_SENTENCE, MANUAL_UPLOAD_SENTENCE } from '../../apps/web/src/design/copy';
import { TARGET_SELECTION_MISSING, targetCoverageMissing } from '../../apps/web/src/procedures/labels';

import { DENIAL_REASONS, COMPLIANCE_MESSAGES, POPULATION_DRAFT_MESSAGES, bindingDigest, registrationDigest } from '@intellifin/domain';

import { AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { BUILDER_STEPS, keepBuilderStepsOpen } from './builder';

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
    await sql`DELETE FROM population_source_binding WHERE display_name LIKE ${`E2E population ${stamp}%`}`;
    await sql`DELETE FROM target_system_registration WHERE display_name LIKE ${`E2E %${stamp}%`}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

/**
 * Keep the Builder's steps open for this file.
 *
 * The Builder is a list of questions whose answered steps start closed. This file's
 * subject is what is INSIDE those steps, so it opens them all rather than clicking a
 * disclosure before every assertion; the disclosure itself is proved by "the Builder
 * opens as a short list of questions" in `procedures.spec.ts`, which runs without this.
 */
test.beforeEach(async ({ page }) => {
  await keepBuilderStepsOpen(page);
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

  test('a pending plan refresh preserves dirty Period edits, blocks overwrites and recovers a lost response', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/procedures/new');
    await page.getByLabel('Template').selectOption('P-4');
    await page.getByLabel('Control name').fill(`E2E period conflict ${stamp}`);
    await page.getByRole('button', { name: 'Create Procedure' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create Procedure' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Set this up' })).toBeVisible();
    await expect(async () => {
      await page.getByLabel('Scope statement').focus();
      await page.getByLabel('Scope statement').blur();
      await expect(page.getByText(POPULATION_DRAFT_MESSAGES.PERIOD, { exact: true })).toBeVisible();
    }).toPass();
    await page.getByLabel('Period start', { exact: true }).fill('2026-08-01');
    await page.getByLabel('Period end', { exact: true }).fill('2026-08-31');
    await page.getByLabel('Scope statement').fill('Local unsaved scope');
    const other = await page.context().newPage();
    try {
      await other.goto(page.url());
      // A full-page load can show server markup before React hydrates. This visible
      // blur validation proves the handler is active before entering authoring values.
      await expect(async () => {
        await other.getByLabel('Scope statement').focus();
        await other.getByLabel('Scope statement').blur();
        await expect(other.getByText(POPULATION_DRAFT_MESSAGES.PERIOD, { exact: true })).toBeVisible();
      }).toPass();
      await other.getByLabel('Period start', { exact: true }).fill('2026-07-01');
      await other.getByLabel('Period end', { exact: true }).fill('2026-07-31');
      await other.getByLabel('Scope statement').fill('Saved in another session');
      await expect(other.getByLabel('Period start', { exact: true })).toHaveValue('2026-07-01');
      await expect(other.getByLabel('Period end', { exact: true })).toHaveValue('2026-07-31');
      await expect(other.getByLabel('Scope statement')).toHaveValue('Saved in another session');
      await other.getByRole('button', { name: 'Save Period and scope', exact: true }).click();
      await expect(other.getByText('Saved. The Draft change is recorded in the audit chain.')).toBeVisible();
      // Chromium may throttle a background tab. Resume the edited tab, then allow
      // the bounded poll's ten-second backoff plus its server response to finish.
      await page.bringToFront();
      await expect(page.getByText('Period and scope changed in another session. Review the saved values before replacing them.')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByLabel('Scope statement')).toHaveValue('Local unsaved scope');
      await page.getByRole('button', { name: 'Save Period and scope', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: 'Use saved Period and scope' }).click();
      await expect(page.getByLabel('Scope statement')).toHaveValue('Saved in another session');
      await expect(page.getByLabel('Period start', { exact: true })).toHaveValue('2026-07-01');
      await scan(page);
      // Commit, then lose the acknowledgement: inspect persisted state before retrying.
      await page.getByLabel('Scope statement').fill('Committed despite lost response');
      const builderUrl = page.url();
      await page.route(builderUrl, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        await route.fetch();
        await route.abort('failed');
      });
      await page.getByRole('button', { name: 'Save Period and scope', exact: true }).click();
      await expect(page.getByRole('paragraph').filter({ hasText: 'The save response was lost.' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save Period and scope', exact: true })).toHaveAttribute('aria-disabled', 'true');
      await page.unroute(builderUrl);
      await page.getByRole('button', { name: 'Reload saved version' }).click();
      await expect(page.getByLabel('Scope statement')).toHaveValue('Committed despite lost response');
    } finally { await other.close(); }
  });

  test('blocks Compliance Rule retry after a committed save loses its response', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/procedures/new');
    await page.getByLabel('Template').selectOption('P-1');
    await page.getByLabel('Control name').fill(`E2E compliance lost response ${stamp}`);
    await page.getByRole('button', { name: 'Create Procedure' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create Procedure' }).click();
    // P-1's C1 opens in the SIMPLE editor; prose has no simple form, so the advanced
    // mode is where it is written. Checking the radio is also this test's hydration
    // proof: the radios exist only once React has rendered the client tree.
    await page.locator('[data-condition-id="C1"]').getByLabel('Write it out myself').check();
    const conditionText = page.getByLabel('Rule text C1', { exact: true });
    const savedText = 'Confirm that each retained access right has a documented business reason.';
    await expect(async () => {
      await conditionText.fill(savedText);
      await conditionText.blur();
      await expect(page.locator('[data-condition-id="C1"]').getByText('Agent-Judged (pending)', { exact: true })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20000 });
    const builderUrl = page.url();
    let posts = 0;
    await page.route(builderUrl, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posts += 1;
      await route.fetch();
      await route.abort('failed');
    });
    try {
      const save = page.getByRole('button', { name: 'Save Compliance Rule', exact: true });
      await save.click();
      await expect(page.getByRole('paragraph').filter({ hasText: 'The save response was lost.' })).toBeVisible();
      await expect(save).toHaveAttribute('aria-disabled', 'true');
      await save.press('Enter');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(posts).toBe(1);
      await page.unroute(builderUrl);
      await page.getByRole('button', { name: 'Reload saved version' }).click();
      await expect(conditionText).toHaveValue(savedText);
      await expect(save).not.toHaveAttribute('aria-disabled', 'true');
      await scan(page);
    } finally { if (!page.isClosed()) await page.unroute(builderUrl); }
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

      // EXPERIENCE.md requires a confirmation dialog on every mutating action, and
      // creating a Draft writes two rows and an immutable audit event. The dialog
      // stands between the click and the change, and states the consequence.
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(template.label);
      await dialog.getByRole('button', { name: 'Create Procedure' }).click();

      // Creation lands on the Builder for the new Draft, with the Control name and
      // Template identity in the header (UX-DR7).
      await expect(page.getByRole('heading', { level: 1, name: controlName })).toBeVisible();
      await expect(page.getByText(`Template ${template.id} · ${template.label}`)).toBeVisible();

      // Control and Objective are pre-filled and read-only, read once at the top under
      // the pinned sentence rather than as two cards each repeating it.
      const sections = page.locator('.ls-card', { hasText: 'Objective' });
      await expect(sections.first()).toBeVisible();
      await expect(page.getByText(BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE).first()).toBeVisible();
      // Every step states what is set in it and says whether it still needs an answer.
      await expect(page.locator('[data-builder-progress]')).toBeVisible();
      for (const step of BUILDER_STEPS) {
        await expect(page.locator(`[data-step="${step}"]`)).toHaveCount(1);
      }

      await expect(page.getByLabel('Period start')).toBeVisible();
      await expect(page.getByLabel('Where the records come from')).toBeVisible();
      // Compliance Rule conditions are editable too (Story 2.4). Evidence Requirements
      // and the Schedule are editable now too (Story 2.5): exactly TWO sections remain
      // read-only — Control, Objective.
      await expect(page.getByLabel('Add a system')).toBeVisible();
      // The Compliance Rule is editable in both modes. A condition with a simple form
      // opens on it and its authored text is one radio away; one with no simple form
      // says so and shows the text directly. Exactly one of those, never neither.
      const c1Editor = page.locator('[data-condition-id="C1"]');
      const advancedRadio = c1Editor.getByLabel('Write it out myself');
      const hasSimple = (await advancedRadio.count()) > 0;
      expect(hasSimple || (await c1Editor.locator('[data-simple-unavailable]').count()) > 0).toBe(true);
      if (hasSimple) await advancedRadio.check();
      await expect(page.getByLabel('Rule text C1', { exact: true })).toBeVisible();
      await expect(page.getByLabel('How certain the agent must be')).toHaveValue('0.80');
      await expect(page.locator('[data-condition-id="C1"]').getByText('Rule-Classified', { exact: true })).toBeVisible();
      if (template.id === 'P-1') {
        await expect(page.locator('[data-condition-id="C2"]').getByText('Agent-Judged (pending)', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Applies to C1', { exact: true })).toHaveValue('all records');
        await expect(page.getByLabel('Applies to C2', { exact: true })).toHaveValue('found = true');
      }
      await expect(page.getByLabel('Frequency')).toBeVisible();
      await expect(page.getByLabel('Start time (UTC)')).toBeVisible();
      if (template.id === 'P-1') {
        await expect(page.getByLabel('What to record').first()).toBeVisible();
      }
      // Said once, over the one panel that carries both Template sections, and the panel
      // has nothing to edit in it.
      await expect(page.getByText(BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE)).toHaveCount(1);
      const readOnly = page.locator('.ls-card').filter({ hasText: BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE });
      await expect(readOnly.locator('input, select, textarea')).toHaveCount(0);
      // The Control says where its editable half is, exactly once, and the Objective —
      // which has no editable half — does not repeat it.
      await expect(page.getByText(BUILDER_CONTROL_NAME_EDITABLE_SENTENCE)).toHaveCount(1);
      await expect(
        page
          .locator('.ls-template-fact')
          .filter({ hasText: 'Objective' })
          .getByText(BUILDER_CONTROL_NAME_EDITABLE_SENTENCE),
      ).toHaveCount(0);

      // The Builder forms are real forms and post. Story 2.3 added a second one (the
      // Target System picker), so this asserts EVERY form on the surface names
      // `method="post"` rather than assuming a single one: a form with no method
      // submits as a GET and puts whatever was typed into the URL and the access log.
      const builderForms = page.locator('form.ls-admin__form');
      const builderFormCount = await builderForms.count();
      expect(builderFormCount).toBeGreaterThan(0);
      for (let formIndex = 0; formIndex < builderFormCount; formIndex += 1) {
        await expect(builderForms.nth(formIndex)).toHaveAttribute('method', 'post');
      }
    });
  }

  test('a cancelled confirmation creates nothing', async ({ page }) => {
    const abandoned = `${nameFor('P-1')} abandoned`;
    await page.goto('/procedures/new');
    await page.getByLabel('Template').selectOption('P-1');
    await page.getByLabel('Control name').fill(abandoned);
    await page.getByRole('button', { name: 'Create Procedure' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    // Reload first: a list rendered BEFORE the click cannot prove nothing was stored.
    await page.goto('/procedures');
    await page.reload();
    await expect(page.locator('.ls-card').filter({ hasText: abandoned })).toHaveCount(0);
  });

  test('edits Period and Population Source with accessible confirmation and persistent blockers', async ({ page }) => {
    test.setTimeout(90_000);
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) throw new Error('The Builder journey requires the throwaway database.');
    assertThrowawayDatabase(databaseUrl);
    const { createSqlClient, CryptoUuidV7Generator } = await import('@intellifin/infrastructure');
    const sql = createSqlClient(databaseUrl, { max: 1 });
    const sourceId = new CryptoUuidV7Generator().next();
    const manualId = new CryptoUuidV7Generator().next();
    const fields = { kind: 'versioned-file' as const, location: 'https://population.synthetic.invalid/leavers.csv', declaredSchema: ['employment_status', 'termination_effective_date'], declaredCountMechanism: 'none' as const, sensitiveFields: [] };
    try {
      for (const [id, kind, location] of [[sourceId, 'versioned-file', fields.location], [manualId, 'manual-upload', '']] as const) {
        const digest = bindingDigest({ ...fields, kind, location });
        await sql`INSERT INTO population_source_binding (binding_id, display_name, kind, location, declared_schema, declared_count_mechanism, sensitive_fields, note, status, digest) VALUES (${id}, ${`E2E population ${stamp} ${kind}`}, ${kind}, ${location}, ${fields.declaredSchema}, 'none', ${fields.sensitiveFields}, '', 'active', ${digest})`;
      }
    } finally { await sql.end({ timeout: 5 }); }
    await page.goto('/procedures/new');
    await page.getByLabel('Template').selectOption('P-1');
    await page.getByLabel('Control name').fill(`E2E population control ${stamp}`);
    await page.getByRole('button', { name: 'Create Procedure' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create Procedure' }).click();
    await expect(page.getByLabel('Period start')).toBeVisible();
    await page.getByLabel('Period start').fill('2026-08-01');
    await page.getByLabel('Period end').fill('2026-08-31');
    await page.getByLabel('Scope statement').fill('  All terminated staff in August.  ');
    await page.getByRole('button', { name: 'Save Period and scope', exact: true }).click();
    // An ordinary Draft section save is direct: no dialog stands between the click and
    // the change (owner decision 2026-09-08, EXPERIENCE.md confirmation table).
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await scan(page);
    await expect(page.getByText('Saved. The Draft change is recorded in the audit chain.')).toBeVisible();
    await page.getByLabel('Where the records come from').selectOption(manualId);
    // P-1 starts weekly. The selected upload immediately shows the pairing warning,
    // and saving remains available because it is a completeness blocker.
    await expect(page.getByText(MANUAL_UPLOAD_SENTENCE, { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Save records to test', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Saved. The Draft change is recorded in the audit chain.')).toBeVisible();

    // Saving a recurring Schedule now surfaces the pairing as a completeness blocker on
    // BOTH sections, never as a refusal on either.
    await page.getByLabel('Frequency').selectOption('weekly');
    await page.getByLabel('Start time (UTC)').fill('02:00');
    await page.getByRole('button', { name: 'Save Schedule', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Saved. The Schedule is recorded in the audit chain.')).toBeVisible();
    await page.reload();
    await expect(page.getByText(MANUAL_UPLOAD_SENTENCE, { exact: true })).toHaveCount(2);

    await page.getByLabel('Where the records come from').selectOption(sourceId);
    await expect(page.getByText(DECLARED_COUNT_MISSING_SENTENCE, { exact: true })).toBeVisible();
    await expect(page.getByLabel('Field 2')).toHaveValue('termination_effective_date');
    await page.getByLabel('Let this procedure pass when no records match').check();
    await page.getByRole('button', { name: 'Save records to test', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The Banner arrives with the command's answer; reload only after persistence.
    await expect(page.getByText('Saved. The Draft change is recorded in the audit chain.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Period start')).toHaveValue('2026-08-01');
    await expect(page.getByLabel('Scope statement')).toHaveValue('  All terminated staff in August.  ');
    await expect(page.getByLabel('Where the records come from')).toHaveValue('retain');
    await expect(page.getByLabel('Let this procedure pass when no records match')).toBeChecked();
    await expect(page.getByLabel('Allow the same record to appear more than once')).not.toBeChecked();
    await expect(page.getByText(DECLARED_COUNT_MISSING_SENTENCE, { exact: true })).toBeVisible();
    // The bound source is now versioned-file, so the upload/frequency blocker is gone —
    // it moves with the CURRENT binding kind, not the one that once triggered it.
    await expect(page.getByText(MANUAL_UPLOAD_SENTENCE, { exact: true })).toHaveCount(0);
    await scan(page);
  });

  test('authors Compliance Rule conditions, preserves dirty sections, and saves with the keyboard', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const controlName = `E2E compliance control ${stamp}`;
    await page.goto('/procedures/new');
    await page.getByLabel('Template').selectOption('P-1');
    await page.getByLabel('Control name').fill(controlName);
    await page.getByRole('button', { name: 'Create Procedure' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create Procedure' }).click();
    await expect(page).toHaveURL(/\/procedures\/[^/]+\/builder$/);
    await expect(page).toHaveTitle('Builder · IntelliFin Audit');
    const c1 = page.locator('[data-condition-id="C1"]');
    const c1Text = page.getByLabel('Rule text C1', { exact: true });
    const applicability = page.getByLabel('Applies to C1', { exact: true });
    const threshold = page.getByLabel('How certain the agent must be');
    await expect(c1.getByText('Rule-Classified', { exact: true })).toBeVisible();

    // No prior compiled badge may survive an unsupported prose edit. Retrying this
    // first interaction covers a fill that arrives before React hydration completes.
    const prose = '  Check whether this account has a justified business need.  ';
    await c1.getByLabel('Write it out myself').check();
    await expect(async () => {
      await c1Text.fill(prose);
      await c1Text.blur();
      await expect(c1.getByText('Agent-Judged (pending)', { exact: true })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await threshold.fill('0.8500');
    await page.getByLabel('New Control name').fill(`${controlName} renamed`);
    await page.getByRole('button', { name: 'Save Control name', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: `${controlName} renamed` })).toBeVisible();
    await expect(c1Text).toHaveValue(prose);
    await expect(threshold).toHaveValue('0.8500');

    await applicability.fill('unknown_observation = true');
    await applicability.blur();
    await expect(c1.getByText(COMPLIANCE_MESSAGES.APPLICABILITY)).toBeVisible();
    await page.getByRole('button', { name: 'Save Compliance Rule', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(c1Text).toHaveValue(prose);
    await applicability.fill('all records');
    await threshold.fill('NaN');
    await threshold.blur();
    await expect(page.getByText(COMPLIANCE_MESSAGES.CONFIDENCE, { exact: true })).toBeVisible();
    await threshold.fill('0.8500');
    await threshold.blur();

    // Add is keyboard reachable and puts focus in the new condition. Its stable id
    // survives deletion of an earlier row, saves, and a server reload.
    const add = page.getByRole('button', { name: 'Add a rule', exact: true });
    await add.focus();
    await page.keyboard.press('Enter');
    const added = page.locator('[data-condition-id]').last();
    const addedId = await added.getAttribute('data-condition-id');
    expect(addedId).toBeTruthy();
    await expect(added.getByRole('textbox', { name: /^Rule text/ })).toBeFocused();
    await added.getByRole('textbox', { name: /^Rule text/ }).fill('account_status in [disabled] else [active]');
    await expect(added.getByText('Rule-Classified', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Remove rule C2', exact: true }).click();
    await expect(page.locator('[data-condition-id="C2"]')).toHaveCount(0);

    // The reverse direction matters too: a Compliance Rule save must retain dirty
    // Period inputs and move the token used by that later save.
    await page.getByLabel('Period start').fill('2026-08-01');
    await page.getByLabel('Period end').fill('2026-08-31');
    await page.getByLabel('Scope statement').fill('Unsaved August scope');
    const save = page.getByRole('button', { name: 'Save Compliance Rule', exact: true });
    // The keyboard alone saves: focus the control, press Enter, and the save happens
    // with no dialog to step through. Focus stays on the button the person pressed —
    // a save that moved focus somewhere else would lose a keyboard user their place.
    await save.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Saved. The Compliance Rule is recorded in the audit chain.', { exact: true })).toBeVisible();
    await expect(save).toBeFocused();
    await expect(c1Text).toHaveValue(prose);
    await scan(page);
    await expect(page.getByLabel('Scope statement')).toHaveValue('Unsaved August scope');
    await page.getByRole('button', { name: 'Save Period and scope', exact: true }).click();
    await expect(page.getByText('Saved. The Draft change is recorded in the audit chain.', { exact: true })).toBeVisible();

    await page.reload();
    await expect(c1Text).toHaveValue(prose);
    await expect(threshold).toHaveValue('0.8500');
    // A reload has no memory of which editor was open, and the added condition's saved
    // text IS a status list, so it comes back in the simple editor showing exactly that
    // rule. Both halves are asserted: the values the simple editor read out of the saved
    // text, and the authored text itself, one radio away and byte for byte.
    const added2 = page.locator(`[data-condition-id="${addedId}"]`);
    await expect(added2.getByLabel(/^Values that count as Compliant/)).toHaveValue('disabled');
    await expect(added2.getByLabel(/^Values that count as an Exception/)).toHaveValue('active');
    await added2.getByLabel('Write it out myself').check();
    await expect(added2.getByRole('textbox', { name: /^Rule text/ })).toHaveValue('account_status in [disabled] else [active]');
    await expect(page.locator('[data-condition-id="C2"]')).toHaveCount(0);
    await expect(page.getByLabel('Scope statement')).toHaveValue('Unsaved August scope');
    await scan(page);
    await testInfo.attach('compliance-editor-desktop', { body: await page.screenshot({ fullPage: false }), contentType: 'image/png' });
    await page.setViewportSize({ width: 899, height: 900 });
    await expect(page.getByText(BUILDER_DESKTOP_ONLY_SENTENCE)).toBeVisible();
    await expect(c1Text).toBeHidden();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(c1Text).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('saves exact numeric boundaries and the optional 24-hour condition', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/procedures/new');
    await page.getByLabel('Template').selectOption('P-3');
    await page.getByLabel('Control name').fill(`E2E comparison control ${stamp}`);
    await page.getByRole('button', { name: 'Create Procedure' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create Procedure' }).click();
    const boundary = page.getByLabel('A record exactly at the limit C1', { exact: true });
    const amount = page.getByLabel('Limit C1', { exact: true });
    const tolerance = page.getByLabel('Allowed difference C1', { exact: true });
    await expect(boundary).toHaveValue('inclusive');
    await expect(amount).toHaveValue('100000');
    await expect(tolerance).toHaveValue('0');
    await expect(page.getByLabel('Applies to C1', { exact: true })).toHaveValue('all records');
    await expect(async () => {
      await amount.fill('1e5');
      await amount.blur();
      await expect(page.getByText(COMPLIANCE_MESSAGES.NUMBER, { exact: true })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Save Compliance Rule', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await amount.fill('100000.0100');
    await tolerance.fill('0.0100');
    await boundary.selectOption('exclusive');
    await page.getByRole('button', { name: 'Save Compliance Rule', exact: true }).click();
    await expect(page.getByText('Saved. The Compliance Rule is recorded in the audit chain.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(boundary).toHaveValue('exclusive');
    await expect(amount).toHaveValue('100000.0100');
    await expect(tolerance).toHaveValue('0.0100');

    // The P-3 comparison edit must not change the separate Population inclusion rule.
    await expect(page.getByLabel('Value 2')).toHaveValue('100000');
    await expect(page.getByLabel('Test 2')).toHaveValue('decimal:gte');

    await page.goto('/procedures/new');
    await page.getByLabel('Template').selectOption('P-1');
    await page.getByLabel('Control name').fill(`E2E window control ${stamp}`);
    await page.getByRole('button', { name: 'Create Procedure' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create Procedure' }).click();
    // The 24-hour window is P-1's optional THIRD condition, added from the Timing controls
    // beside the account-status rule. It never replaces C1: an Active account has no
    // disablement instant at all, so C1 is what makes that account an Exception.
    const c1Simple = page.locator('[data-simple-for="C1"]');
    await expect(c1Simple).toBeVisible();
    await expect(page.locator('[data-window-condition]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add the 24-hour disablement window', exact: true }).click();
    const c3 = page.locator('[data-condition-id="C3"]');
    await expect(c3.getByLabel('Rule text C3', { exact: true })).toHaveValue('disabled_time - termination_time <= 24h');
    await expect(c3.getByText('Rule-Classified', { exact: true })).toBeVisible();
    await expect(page.locator('[data-window-condition="C3"]')).toBeVisible();
    const hours = page.getByLabel('Limit C3', { exact: true });
    const windowBoundary = page.getByLabel('A record exactly at the limit C3', { exact: true });
    const windowTolerance = page.getByLabel('Allowed difference C3', { exact: true });
    await expect(hours).toHaveValue('24');
    await expect(windowBoundary).toHaveValue('inclusive');
    await windowTolerance.fill('0.001');
    await page.getByRole('button', { name: 'Save Compliance Rule', exact: true }).click();
    await expect(page.getByText('Saved. The Compliance Rule is recorded in the audit chain.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(hours).toHaveValue('24');
    await expect(windowTolerance).toHaveValue('0.001');
    // C1 came back exactly as the Template wrote it, one radio away from its own text.
    await expect(page.locator('[data-condition-id="C1"]').getByLabel('Values that count as Compliant C1')).toHaveValue('disabled');
    await expect(page.locator('[data-condition-id="C1"]').getByLabel('Values that count as an Exception C1')).toHaveValue('active');
    await scan(page);
  });

  test('authors Evidence Requirements and the Schedule, refusing ungrounded attributes and recording model-read', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/procedures/new');
    await page.getByLabel('Template').selectOption('P-1');
    await page.getByLabel('Control name').fill(`E2E evidence control ${stamp}`);
    await page.getByRole('button', { name: 'Create Procedure' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create Procedure' }).click();

    // P-1's structured defaults are platform-captured: no agent-driven Target System is
    // selected yet, so nothing here starts platform-captured, but the Template still
    // seeds three attributes.
    const attributeNames = page.getByLabel('What to record');
    await expect(attributeNames).toHaveCount(3);

    // The grounding rule: a screenshot or a recording segment alone never grounds an
    // attribute value.
    const first = page.locator('fieldset', { hasText: 'Evidence item 1' });
    await first.getByLabel('A saved copy of the page it was read from').uncheck();
    await first.getByLabel('The lines of the source file it came from').uncheck();
    await page.getByRole('button', { name: 'Save Evidence Requirements', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/Attribute "username": Ground every attribute value/)).toBeVisible();

    // Declaring model-read exempts it from deterministic grounding.
    await first.getByLabel('Accept a reading with no saved proof behind it').check();
    await page.getByRole('button', { name: 'Save Evidence Requirements', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Saved. Evidence Requirements are recorded in the audit chain.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(first.getByLabel('Accept a reading with no saved proof behind it')).toBeChecked();
    await expect(first.getByLabel('A saved copy of the page it was read from')).not.toBeChecked();

    // Adding a new Evidence Requirement is keyboard reachable and focuses its name field.
    const add = page.getByRole('button', { name: 'Add an evidence item', exact: true });
    await add.focus();
    await page.keyboard.press('Enter');
    const added = page.getByLabel('What to record').last();
    await expect(added).toBeFocused();
    await added.fill(' USERNAME ');
    const addedFieldset = page.locator('fieldset', { hasText: 'Evidence item 4' });
    await addedFieldset.getByLabel('The lines of the source file it came from').check();
    await page.getByRole('button', { name: 'Save Evidence Requirements', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(addedFieldset.getByText(/An attribute can appear only once/)).toBeVisible();
    await added.fill('note');
    await page.getByRole('button', { name: 'Save Evidence Requirements', exact: true }).click();
    await expect(page.getByText('Saved. Evidence Requirements are recorded in the audit chain.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('What to record')).toHaveCount(4);
    const stableId = await page.getByLabel('What to record').nth(1).getAttribute('id');
    await page.getByRole('button', { name: 'Remove evidence item 1', exact: true }).click();
    await expect(page.getByLabel('What to record').first()).toHaveAttribute('id', stableId!);
    await expect(page.getByLabel('What to record').first()).toBeFocused();
    for (let count = 3; count > 0; count -= 1) {
      await page.getByRole('button', { name: `Remove evidence item ${count}`, exact: true }).click();
    }
    await expect(add).toBeFocused();
    await page.reload();

    // The Schedule: a frequency, a fixed UTC start, and the recorded period-derivation
    // rule — this Procedure Version records it and never runs it.
    await page.getByLabel('Frequency').selectOption('daily');
    await page.getByLabel('Start time (UTC)').fill('06:00');
    await expect(page.getByText('Each run covers: Previous calendar day, in UTC.')).toBeVisible();
    await page.getByRole('button', { name: 'Save Schedule', exact: true }).click();
    await expect(page.getByText('Saved. The Schedule is recorded in the audit chain.', { exact: true })).toBeVisible();
    await page.getByLabel('Frequency').selectOption('');
    await page.getByLabel('Frequency').blur();
    await expect(page.getByLabel('Frequency')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Start time (UTC)')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Saved. The Schedule is recorded in the audit chain.', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel('Frequency')).toHaveValue('daily');
    await expect(page.getByLabel('Start time (UTC)')).toHaveValue('06:00');
    await scan(page);
  });

  test('preserves pending Schedule edits across refreshes and reports a lost committed response honestly', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/procedures/new');
    await page.getByLabel('Template').selectOption('P-1');
    await page.getByLabel('Control name').fill(`E2E schedule refresh ${stamp}`);
    await page.getByRole('button', { name: 'Create Procedure' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create Procedure' }).click();
    await page.getByLabel('Frequency').selectOption('daily');
    await page.getByLabel('Start time (UTC)').fill('06:00');
    await page.getByLabel('New Control name').fill(`E2E schedule refresh renamed ${stamp}`);
    await page.getByRole('button', { name: 'Save Control name', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: `E2E schedule refresh renamed ${stamp}` })).toBeVisible();
    await expect(page.getByLabel('Frequency')).toHaveValue('daily');
    await expect(page.getByLabel('Start time (UTC)')).toHaveValue('06:00');

    let committed!: () => void;
    const committedResponse = new Promise<void>((resolve) => { committed = resolve; });
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const builderUrl = page.url();
    await page.route(builderUrl, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      committed();
      await released;
      await route.fulfill({ response });
    });
    try {
      await page.getByRole('button', { name: 'Save Schedule', exact: true }).click();
      await committedResponse;
      await page.getByLabel('Start time (UTC)').fill('07:00');
      release();
      await expect(page.getByRole('button', { name: 'Save Schedule', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByLabel('Start time (UTC)')).toHaveValue('07:00');
      await expect(page.getByText('Saved. The Schedule is recorded in the audit chain.')).toHaveCount(0);
    } finally { release(); await page.unroute(builderUrl); }

    // Commit the pending edit but deliberately lose its response. A retry is blocked
    // until the auditor reloads and sees that the transaction actually committed.
    await page.route(builderUrl, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch();
      await route.abort('failed');
    });
    await page.getByRole('button', { name: 'Save Schedule', exact: true }).click();
    await expect(page.getByText(/The save response was lost/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Schedule', exact: true })).toHaveAttribute('aria-disabled', 'true');
    await page.unroute(builderUrl);
    await page.getByRole('button', { name: 'Reload saved version' }).click();
    await expect(page.getByLabel('Start time (UTC)')).toHaveValue('07:00');
    await expect(page.getByLabel('Frequency')).toHaveValue('daily');
    await scan(page);
  });

  test('removes forced Evidence after target deselection while preserving authored choices and dirty edits', async ({ page }) => {
    test.setTimeout(90_000);
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) throw new Error('The Builder journey requires the throwaway database.');
    assertThrowawayDatabase(databaseUrl);
    const { createSqlClient, CryptoUuidV7Generator } = await import('@intellifin/infrastructure');
    const sql = createSqlClient(databaseUrl, { max: 1 });
    const webId = new CryptoUuidV7Generator().next();
    const apiId = new CryptoUuidV7Generator().next();
    try {
      for (const [id, kind] of [[webId, 'web'], [apiId, 'api']] as const) {
        const fields = { kind, allowedOrigins: ['https://capture.synthetic.invalid'], applicationIdentity: '', credentialRef: 'vault://audit/capture', permittedActions: ['read-attribute'] as const, attributeLabelPatterns: ['Status'], secondaryKey: '' };
        await sql`INSERT INTO target_system_registration (registration_id, display_name, kind, allowed_origins, application_identity, credential_ref, permitted_actions, attribute_label_patterns, secondary_key, note, status, digest) VALUES (${id}, ${`Capture ${kind} ${stamp}`}, ${kind}, ${fields.allowedOrigins}, '', ${fields.credentialRef}, ${fields.permittedActions}, ${fields.attributeLabelPatterns}, '', '', 'active', ${registrationDigest(fields)})`;
      }
    } finally { await sql.end({ timeout: 5 }); }
    await page.goto('/procedures/new');
    await page.getByLabel('Template').selectOption('P-1');
    await page.getByLabel('Control name').fill(`E2E capture ${stamp}`);
    await page.getByRole('button', { name: 'Create Procedure' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create Procedure' }).click();
    const first = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: /^Evidence item 1$/ }) });
    await first.getByLabel('A saved copy of the page it was read from').uncheck();
    await first.getByLabel('Screenshot of the page').uncheck();
    await first.getByLabel('Accept a reading with no saved proof behind it').check();
    await first.getByLabel('What to record').fill('retained_name');
    await page.getByLabel('Add a system').selectOption(webId);
    await page.getByRole('button', { name: 'Add Target System', exact: true }).click();
    await page.getByRole('button', { name: 'Save Target Systems', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save Target Systems', exact: true }).click();
    await expect(first.getByLabel('What to record')).toHaveValue('retained_name');
    await expect(first.getByLabel('A saved copy of the page it was read from')).toBeDisabled();
    await expect(first.getByLabel('A saved copy of the page it was read from')).toBeChecked();
    await expect(first.getByLabel('Screenshot of the page (always kept for a system the agent drives)', { exact: true })).toBeChecked();
    await expect(first.getByLabel('Screenshot of the page (always kept for a system the agent drives)', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Add an evidence item', exact: true }).click();
    const addedCapture = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: /^Evidence item 4$/ }) });
    await addedCapture.getByLabel('What to record').fill('capture_note');
    await expect(addedCapture.getByLabel('A saved copy of the page it was read from')).toBeChecked();
    await expect(addedCapture.getByLabel('A saved copy of the page it was read from')).toBeDisabled();
    await expect(addedCapture.getByLabel('Screenshot of the page (always kept for a system the agent drives)', { exact: true })).toBeChecked();
    await expect(addedCapture.getByLabel('Screenshot of the page (always kept for a system the agent drives)', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Save Evidence Requirements', exact: true }).click();
    await expect(page.getByText('Saved. Evidence Requirements are recorded in the audit chain.', { exact: true })).toBeVisible();
    // A reload and an unrelated evidence edit must not turn forced capture into authorship.
    await page.reload();
    await addedCapture.getByLabel('What to record').fill('capture_note_edited');
    await page.getByRole('button', { name: 'Save Evidence Requirements', exact: true }).click();
    await expect(page.getByText('Saved. Evidence Requirements are recorded in the audit chain.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Remove Capture web ${stamp}`, exact: true }).click();
    await page.getByLabel('Add a system').selectOption(apiId);
    await page.getByRole('button', { name: 'Add Target System', exact: true }).click();
    await page.getByRole('button', { name: 'Save Target Systems', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save Target Systems', exact: true }).click();
    await expect(first.getByLabel('A saved copy of the page it was read from')).toBeEnabled();
    await expect(first.getByLabel('A saved copy of the page it was read from')).not.toBeChecked();
    await expect(first.getByLabel('Screenshot of the page')).not.toBeChecked();
    await expect(first.getByLabel('Screenshot of the page')).toBeEnabled();
    await expect(first.getByLabel('What to record')).toHaveValue('retained_name');
    await page.reload();
    await expect(first.getByLabel('Accept a reading with no saved proof behind it')).toBeChecked();
    await expect(first.getByLabel('A saved copy of the page it was read from')).not.toBeChecked();
    await expect(first.getByLabel('Screenshot of the page')).not.toBeChecked();
    await expect(addedCapture.getByLabel('A saved copy of the page it was read from')).not.toBeChecked();
    await expect(addedCapture.getByLabel('Screenshot of the page')).not.toBeChecked();
    const authored = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: /^Evidence item 2$/ }) });
    await expect(authored.getByLabel('A saved copy of the page it was read from')).toBeChecked();
    await expect(authored.getByLabel('Screenshot of the page')).toBeChecked();
    await addedCapture.getByLabel('The lines of the source file it came from').check();
    await page.getByRole('button', { name: 'Save Evidence Requirements', exact: true }).click();
    await expect(page.getByText('Saved. Evidence Requirements are recorded in the audit chain.', { exact: true })).toBeVisible();
    await scan(page);
  });

  test('selects Target Systems, freezes their contracts, and flags a scope-widening instruction', async ({ page }) => {
    test.setTimeout(90_000);
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) throw new Error('The Builder journey requires the throwaway database.');
    assertThrowawayDatabase(databaseUrl);
    const { createSqlClient, CryptoUuidV7Generator } = await import('@intellifin/infrastructure');
    const sql = createSqlClient(databaseUrl, { max: 1 });
    const webId = new CryptoUuidV7Generator().next();
    const desktopId = new CryptoUuidV7Generator().next();
    const web = { kind: 'web' as const, allowedOrigins: ['http://localhost:4300/loancore'], applicationIdentity: '', credentialRef: 'vault://audit/loancore', permittedActions: ['navigate', 'read-attribute'] as const, attributeLabelPatterns: ['Status', 'Username'], secondaryKey: 'Full name' };
    const desktop = { kind: 'desktop' as const, allowedOrigins: [] as string[], applicationIdentity: 'com.northstar.ledgerdesk', credentialRef: 'vault://audit/ledgerdesk', permittedActions: ['navigate', 'read-attribute'] as const, attributeLabelPatterns: ['Status'], secondaryKey: '' };
    try {
      for (const [id, name, f] of [[webId, `E2E LoanCore ${stamp}`, web], [desktopId, `E2E LedgerDesk ${stamp}`, desktop]] as const) {
        await sql`INSERT INTO target_system_registration (registration_id, display_name, kind, allowed_origins, application_identity, credential_ref, permitted_actions, attribute_label_patterns, secondary_key, note, status, digest) VALUES (${id}, ${name}, ${f.kind}, ${f.allowedOrigins}, ${f.applicationIdentity}, ${f.credentialRef}, ${f.permittedActions}, ${f.attributeLabelPatterns}, ${f.secondaryKey}, '', 'active', ${registrationDigest(f)})`;
      }
    } finally {
      await sql.end({ timeout: 5 });
    }

    await page.goto('/procedures/new');
    await page.getByLabel('Template').selectOption('P-1');
    await page.getByLabel('Control name').fill(`E2E targets control ${stamp}`);
    await page.getByRole('button', { name: 'Create Procedure' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create Procedure' }).click();
    await expect(page.getByLabel('Add a system')).toBeVisible();

    // Template guidance is visible, but no registration is selected or silently inferred.
    // Scoped to the suggestion list: a bare `getByText('LoanCore (web)')` also matches the
    // picker's own `<option>` the moment a deployment registers a system called LoanCore,
    // which every seeded environment does — and strict mode then fails an assertion that
    // is about the guidance and not about the picker at all.
    const suggested = page.locator('[data-suggested-targets] li');
    await expect(suggested.filter({ hasText: 'LoanCore (web)' })).toHaveCount(1);
    await expect(suggested.filter({ hasText: 'LedgerDesk (desktop)' })).toHaveCount(1);
    await expect(page.getByText('Template default Audit Instructions (read-only)')).toBeVisible();
    const unavailableSave = page.getByRole('button', { name: 'Save Target Systems', exact: true });
    await expect(unavailableSave).toHaveAttribute('aria-disabled', 'true');
    const unavailableSaveDescription = await unavailableSave.getAttribute('aria-describedby');
    expect(unavailableSaveDescription).toBeTruthy();
    await expect(page.locator(`[id="${unavailableSaveDescription}"]`)).toContainText(TARGET_SELECTION_MISSING);

    // P-1 names web AND desktop coverage; with nothing selected, both diagnostics show.
    await expect(page.getByText(targetCoverageMissing('web'))).toBeVisible();
    await expect(page.getByText(targetCoverageMissing('desktop'))).toBeVisible();

    // Select LoanCore (web); the section shows its credential reference and frozen digest.
    await page.getByLabel('Add a system').selectOption(webId);
    await page.getByRole('button', { name: 'Add Target System' }).click();
    // `li.ls-card`, not `.ls-card`: the selected systems are list items INSIDE the
    // section's own `.ls-card`, so the bare class matches the section as well as the
    // entry and the assertion would be ambiguous rather than about this one system.
    const loancoreCard = page.locator('li.ls-card').filter({ hasText: `E2E LoanCore ${stamp}` });
    await expect(loancoreCard).toContainText('vault://audit/loancore');
    await expect(loancoreCard.locator('.ls-digest')).toContainText(registrationDigest(web));
    // Web coverage is now met; desktop is still missing.
    await expect(page.getByText(targetCoverageMissing('web'))).toHaveCount(0);
    await expect(page.getByText(targetCoverageMissing('desktop'))).toBeVisible();

    await page.getByLabel('Add a system').selectOption(desktopId);
    await page.getByRole('button', { name: 'Add Target System' }).click();
    await expect(page.getByText(targetCoverageMissing('desktop'))).toHaveCount(0);

    const pendingName = `E2E targets control ${stamp} pending`;
    await page.getByLabel('New Control name').fill(pendingName);
    await page.getByRole('button', { name: 'Save Control name', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: pendingName })).toBeVisible();
    await expect(loancoreCard).toBeVisible();
    await expect(page.locator('li.ls-card').filter({ hasText: `E2E LedgerDesk ${stamp}` })).toBeVisible();

    await page.getByRole('button', { name: 'Save Target Systems' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save Target Systems' }).click();
    await expect(page.getByText('The Target System selection is recorded in the audit chain.')).toBeVisible();

    // Reload from the server; the frozen selection and the instruction editors survive.
    await page.reload();
    const instruction = page.getByLabel(`What the agent should do in E2E LoanCore ${stamp}`);
    await expect(instruction).toBeVisible();
    await expect(page.getByLabel(`What the agent should do in E2E LedgerDesk ${stamp}`)).toBeVisible();

    // A refresh caused by a different section must not discard prose that has not been
    // saved yet. Renaming is a separate guarded Draft edit and forces that refresh.
    const unsavedInstruction = 'Open the account record and keep this unsaved note.';
    await instruction.fill(unsavedInstruction);
    await page.getByLabel('New Control name').fill(`E2E targets control ${stamp} renamed`);
    await page.getByRole('button', { name: 'Save Control name', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: `E2E targets control ${stamp} renamed` })).toBeVisible();
    await expect(instruction).toHaveValue(unsavedInstruction);

    // A scope-widening instruction is flagged inline on blur — advisory, never blocking.
    //
    // Retry the fill-and-blur rather than asserting once. The advisory check is a
    // client-side enhancement (FR-8 makes it advisory; execution-time denial is the
    // enforced control), so it only runs once React has hydrated after the reload
    // above. A blur that lands first sets no state, and because the textarea is
    // React-controlled a fill that lands first is overwritten by hydration — so the
    // single-shot form passes alone and fails under full-suite load. The assertion
    // itself is unchanged: the warning must still name the write verb.
    const scopeWarning = page.getByText('write action "disable"');
    const originWarning = page.getByText('outside the selected Target Systems\' allowed origins');
    const systemWarning = page.getByText('This instruction names UnknownSystem, which is not a selected Target System.');
    await expect(async () => {
      await instruction.fill('Where you find an active account, disable it, check UnknownSystem, and open https://evil.invalid/admin.');
      await instruction.blur();
      await expect(scopeWarning).toBeVisible({ timeout: 1_000 });
      await expect(originWarning).toBeVisible({ timeout: 1_000 });
      await expect(systemWarning).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });

    // Correcting the text and re-checking clears the warning; no stale warning.
    await instruction.fill('Open the account record and note its status, username, and roles.');
    await instruction.blur();
    await expect(page.getByText('write action "disable"')).toHaveCount(0);
    await expect(originWarning).toHaveCount(0);
    await expect(systemWarning).toHaveCount(0);

    await page.getByRole('button', { name: 'Save Audit Instructions' }).click();
    await expect(page.getByText('The Audit Instructions are recorded in the audit chain.')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(`What the agent should do in E2E LoanCore ${stamp}`)).toHaveValue(
      'Open the account record and note its status, username, and roles.',
    );
    await scan(page);
    await page.setViewportSize({ width: 899, height: 900 });
    await expect(page.getByText(BUILDER_DESKTOP_ONLY_SENTENCE)).toBeVisible();
    await expect(instruction).toBeHidden();
    await expect(page.getByRole('button', { name: 'Save Target Systems', exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(instruction).toBeVisible();
  });

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
      // The sections are on the Builder; the detail surface lists versions.
      await page.getByRole('link', { name: 'Open Builder' }).click();
      await expect(page.getByRole('heading', { level: 3, name: 'Objective' })).toBeVisible();
      // The Objective's own block: Control and Objective share one panel now, so the
      // first paragraph of the card is the Control statement, not this.
      const objective = await page
        .locator('.ls-template-fact')
        .filter({ has: page.getByRole('heading', { level: 3, name: 'Objective' }) })
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
    // "Active version: Draft" would be worse than the dash the rule forbids: it states
    // a fact that is not true. Nothing this story writes is ever ACTIVE.
    await expect(card).toContainText(PROCEDURE_CARD_ABSENT.activeVersion);
    await expect(card).not.toContainText('Draft');
    await expect(card).toContainText(PROCEDURE_CARD_ABSENT.schedule);
    await expect(card).toContainText(PROCEDURE_CARD_ABSENT.nextRun);
    await expect(card).toContainText(PROCEDURE_CARD_ABSENT.lastOutcome);
    // The Control name and Template identity are on the card (UX-DR7).
    await expect(card).toContainText(nameFor('P-1'));
    await expect(card).toContainText('P-1');
  });

  test('renames the Draft from the Builder with a direct save', async ({ page }) => {
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

    // An ordinary Draft section save is DIRECT (owner decision 2026-09-08): no dialog
    // stands between the click and the change, and the Banner names the value that was
    // saved — which is what the dialog used to restate, said after the fact instead of
    // before it. The audit chain still records who made the change.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.ls-banner--success')).toContainText(
      'The Control name is now',
    );
    await expect(page.locator('.ls-banner--success')).toContainText(renamed);

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
    await expect(page.getByRole('heading', { level: 3, name: 'Objective' })).toBeVisible();
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
      DENIAL_REASONS.ADMIN_CANNOT_AUTHOR,
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
      DENIAL_REASONS.ADMIN_CANNOT_AUTHOR,
    );
    // No section content, no editable field.
    await expect(page.getByLabel('New Control name')).toHaveCount(0);
    await expect(page.getByText(BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE)).toHaveCount(0);
  });
});
