import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  BUILDER_CONTROL_NAME_EDITABLE_SENTENCE,
  BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE,
} from '../../apps/web/src/design/copy';
import {
  EXACT_VALUE_SENTENCE,
  readSimpleCondition,
} from '../../apps/web/src/procedures/simple-condition';

import { READINESS_NO_GUARANTEE, bindingDigest, registrationDigest } from '@intellifin/domain';

import { AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { openPlanDetail, openStep } from './builder';

/**
 * The hero workflow, end to end in a real browser: create a Procedure from the P-1
 * Template, author it, and submit it.
 *
 * What only a browser can prove is what a person actually meets — that a section save
 * happens with nothing in the way, that the Compliance Rule can be authored by choosing
 * values rather than by writing an expression, that the two modes really are one saved
 * rule, that the readiness panel appears and clears, and that Submit is still the one
 * step that stops and asks. A screenshot is taken at each state, named by step, so the
 * journey can be read without running it.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const stamp = `${Date.now()}`;
const CONTROL = `E2E hero control ${stamp}`;

/**
 * Where the journey's screenshots go. The default is under `test-results/`, which git
 * ignores, so an ordinary run never dirties the tree and the mutation harnesses (which
 * refuse a dirty tree) are not tripped by a browser run before them. The curated set the
 * owner reads lives in `_bmad-output/implementation-artifacts/hero-ux-screenshots/` and is
 * copied there from ONE verified run by pointing `HERO_UX_SCREENSHOTS` at that folder.
 */
const SHOTS =
  process.env['HERO_UX_SCREENSHOTS'] ??
  fileURLToPath(new URL('../../test-results/hero-ux-screenshots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

let step = 0;
/**
 * One picture per proven state. A `target` frames the element the state is about — the
 * readiness panel, one condition, the dialog — because a full-page capture of the Builder
 * is ten thousand pixels tall, unreadable at any zoom and three quarters of a megabyte;
 * without a target the viewport is captured. JPEG, because these are pictures of a page
 * and not fixtures anything reads back.
 */
async function shot(page: Page, name: string, target?: Locator): Promise<void> {
  step += 1;
  const options = { path: path.join(SHOTS, `${String(step).padStart(2, '0')}-${name}.jpg`), type: 'jpeg' as const, quality: 85 };
  if (target) await target.screenshot(options);
  else await page.screenshot({ ...options, fullPage: false });
}

async function scan(page: Page): Promise<void> {
  // The title is asserted BEFORE the scan: a navigation that has begun committing
  // briefly has no <title>, and re-running an intermittent accessibility failure until
  // it is green is exactly what the no-allowlist gate exists to prevent.
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

async function openReview(page: Page): Promise<void> {
  await expect(page.locator('[data-guided-ready="true"]')).toBeVisible();
  await page.locator('[data-preparation-nav="review"]').click();
  await expect(page.locator('[data-preparation-panel="review"]')).toBeVisible();
  await expect(page.locator('[data-readiness]')).toBeVisible();
}

/**
 * One versioned-file Population Source and one web Target System, so the hero Draft can
 * be completed and submitted. They are seeded directly because this journey is about the
 * AUTHORING surfaces; registering them is Story 1.6 and 1.7's own browser coverage.
 */
let sourceId = '';
let targetId = '';

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('The hero journey requires the throwaway database.');
  assertThrowawayDatabase(databaseUrl);
  const { createSqlClient, CryptoUuidV7Generator } = await import('@intellifin/infrastructure');
  const sql = createSqlClient(databaseUrl, { max: 1 });
  sourceId = new CryptoUuidV7Generator().next();
  targetId = new CryptoUuidV7Generator().next();
  try {
    const binding = {
      kind: 'versioned-file' as const,
      location: 'https://population.synthetic.invalid/leavers.csv',
      // P-1 looks up by employee ID and falls back to the full name, so the source has
      // to declare BOTH lookup columns or the Draft is incomplete.
      declaredSchema: ['employee_id', 'full_name', 'employment_status', 'termination_effective_date'],
      declaredCountMechanism: 'cover-sheet' as const,
      sensitiveFields: [],
    };
    await sql`INSERT INTO population_source_binding (binding_id, display_name, kind, location, declared_schema, declared_count_mechanism, sensitive_fields, note, status, digest) VALUES (${sourceId}, ${`E2E hero leavers ${stamp}`}, 'versioned-file', ${binding.location}, ${binding.declaredSchema}, 'cover-sheet', ${binding.sensitiveFields}, '', 'active', ${bindingDigest(binding)})`;
    // Trimmed, deduplicated and SORTED, exactly as the registration command stores them.
    // A raw-SQL seed that stores an unsorted list disagrees with the frozen snapshot's
    // own normalized envelope, so the Target System editor reconciles a value it never
    // changed and reports a saved-value CONFLICT — which then blocks submission for a
    // reason that has nothing to do with the journey.
    const registration = {
      kind: 'web' as const,
      allowedOrigins: ['https://loancore.synthetic.invalid'],
      applicationIdentity: '',
      credentialRef: 'vault://audit/hero',
      permittedActions: ['navigate', 'read-attribute', 'search'] as const,
      attributeLabelPatterns: ['Roles', 'Status', 'Username'],
      secondaryKey: 'Full name',
    };
    await sql`INSERT INTO target_system_registration (registration_id, display_name, kind, allowed_origins, application_identity, credential_ref, permitted_actions, attribute_label_patterns, secondary_key, note, status, digest) VALUES (${targetId}, ${`E2E hero LoanCore ${stamp}`}, 'web', ${registration.allowedOrigins}, '', ${registration.credentialRef}, ${registration.permittedActions}, ${registration.attributeLabelPatterns}, ${registration.secondaryKey}, '', 'active', ${registrationDigest(registration)})`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test.afterAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl === '') return;
  assertThrowawayDatabase(databaseUrl);
  const { createSqlClient } = await import('@intellifin/infrastructure');
  const sql = createSqlClient(databaseUrl, { max: 1 });
  try {
    await sql`DELETE FROM procedure WHERE control_name LIKE ${`E2E hero %${stamp}%`}`;
    await sql`DELETE FROM population_source_binding WHERE display_name LIKE ${`E2E hero %${stamp}%`}`;
    await sql`DELETE FROM target_system_registration WHERE display_name LIKE ${`E2E hero %${stamp}%`}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test.describe('the hero workflow', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('creates P-1, authors it in business language, and submits it', async ({ page }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(20_000);

    /* ---------------------------------------------------- create from P-1 ---- */
    await page.goto('/procedures/new');
    await page.getByLabel('Template').selectOption('P-1');
    await page.getByLabel('Control name').fill(CONTROL);
    await shot(page, 'new-procedure-form');
    await page.getByRole('button', { name: 'Create Procedure' }).click();
    // Creation writes two rows and an immutable event, and it keeps its confirmation.
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Create Procedure' }).click();
    await expect(page.getByRole('heading', { level: 1, name: CONTROL })).toBeVisible();
    await openStep(page, 'Objective');
    await shot(page, 'builder-opened');

    /* ------------------------------------------- the Draft says it is editable */
    // The context is pre-filled from the Template and can be edited for this procedure.
    // The Control copy also points to the separate name editor.
    await expect(page.getByText(BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE)).toHaveCount(1);
    await expect(page.getByText(BUILDER_CONTROL_NAME_EDITABLE_SENTENCE)).toHaveCount(1);
    await expect(page.getByText('not editable yet')).toHaveCount(0);

    /* --------------------------------- what the agent will do, and readiness -- */
    // Readiness is what an auditor must meet before spending a Run, so it is on the
    // page. The compiled plan is one fold down, where somebody who wants it can get it.
    await openReview(page);
    await expect(page.locator('[data-plan-detail]')).toHaveJSProperty('open', false);
    await openPlanDetail(page);
    const summary = page.locator('[data-agent-summary]');
    await expect(summary).toBeVisible();
    await expect(page.getByText(READINESS_NO_GUARANTEE)).toBeVisible();
    // A fresh P-1 Draft has selected no Target System and bound no source, so both are
    // listed — and C2 is Agent-Judged over a Roles field with no policy frozen.
    for (const code of ['targets-missing', 'source-not-bound', 'agent-judged-without-policy']) {
      await expect(page.locator(`[data-readiness-item="${code}"]`), code).toHaveCount(1);
    }
    await shot(page, 'readiness-on-a-fresh-draft', page.locator('[data-readiness]'));

    /* ------------------------------- C1 in business language, in simple mode -- */
    // The Template already answered this step, so it opens closed with its own summary.
    // The auditor clicks it to change the rule; so does this journey.
    await openStep(page, 'Compliance Rule conditions');
    const c1 = page.locator('[data-condition-id="C1"]');
    // The simple block only exists once React has rendered the client tree, so waiting
    // for it is also the hydration proof this file needs before it types anything.
    const simpleBlock = page.locator('[data-simple-for="C1"]');
    await expect(simpleBlock).toBeVisible();
    // The Template's C1 ships as PROSE compiled from the rule frozen beside it; the
    // simple editor opens on that rule's own values.
    const compliant = c1.getByLabel('Values that count as Compliant C1');
    const exception = c1.getByLabel('Values that count as an Exception C1');
    await expect(compliant).toHaveValue('disabled');
    await expect(exception).toHaveValue('active');
    await expect(page.getByText(EXACT_VALUE_SENTENCE)).toBeVisible();
    await shot(page, 'compliance-simple-mode', c1);

    // Resolve the casing explicitly, the way a LoanCore auditor would.
    await compliant.fill('Disabled');
    await exception.fill('Active');
    const saved = 'found = false or account_status in [Disabled] else [Active]';
    await expect(c1.locator('[data-simple-text="C1"]')).toHaveText(saved);
    // Still Rule-Classified: the explicit expression compiles to the same kind of rule.
    await expect(c1.getByText('Rule-Classified', { exact: true })).toBeVisible();
    // The one saved string is exactly what the module reads back.
    expect(readSimpleCondition(saved, 'P-1', 'C1')).toEqual({
      kind: 'status-set',
      field: 'account_status',
      provenAbsence: true,
      compliant: ['Disabled'],
      exception: ['Active'],
    });

    /* ------------------ advanced shows the SAME text; switching writes nothing - */
    await c1.getByLabel('Write it out myself').check();
    const text = c1.getByLabel('Rule text C1', { exact: true });
    await expect(text).toBeVisible();
    await expect(text).toHaveValue(saved);
    await shot(page, 'compliance-advanced-mode', c1);
    await c1.getByLabel('Pick the values from a list').check();
    await expect(text).toBeHidden();
    await expect(compliant).toHaveValue('Disabled');

    /* ---------------------------------------- C2's role-privilege policy ------ */
    const c2 = page.locator('[data-condition-id="C2"]');
    await c2.getByRole('button', { name: 'Add the list of privileged roles C2' }).click();
    // `exact`: "Privileged roles C2" is a substring of "Known non-privileged roles C2".
    const privileged = c2.getByLabel('Privileged roles C2', { exact: true });
    const nonPrivileged = c2.getByLabel('Known non-privileged roles C2');
    await privileged.fill('LOAN_ADMIN\nSYSTEM_ADMIN');
    await nonPrivileged.fill('LOAN_ADMIN');
    // A role in both lists is named while it is typed, not met as the compiler's one
    // sentence covering every way a policy can be wrong.
    await expect(c2.getByText(/A role cannot be both privileged and non-privileged.*LOAN_ADMIN/)).toBeVisible();
    await nonPrivileged.fill('VIEWER');
    await expect(c2.locator('[data-policy-counts="C2"]')).toContainText('2 privileged, 1 known non-privileged');
    await shot(page, 'role-privilege-policy', c2);

    /* ------------------------------------------- a direct save, with state ---- */
    // Unsaved state is visible BEFORE the save.
    await expect(page.getByText('Compliance Rule has unsaved changes.')).toBeVisible();
    const save = page.getByRole('button', { name: 'Save Compliance Rule', exact: true });
    // Keyboard only: focus the control, press Enter. No dialog, and focus stays put.
    await save.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Saved. The Compliance Rule is recorded in the audit chain.')).toBeVisible();
    await expect(save).toBeFocused();
    await expect(page.getByText('Compliance Rule has unsaved changes.')).toHaveCount(0);
    await shot(page, 'compliance-saved-directly', page.locator('[data-preparation-panel="assessment"]'));

    // The saved rule survives a reload, in the author's own spelling and casing.
    await page.reload();
    await openStep(page, 'Compliance Rule conditions');
    await expect(page.locator('[data-condition-id="C1"]').getByLabel('Values that count as Compliant C1')).toHaveValue('Disabled');
    await expect(page.locator('[data-condition-id="C2"]').getByLabel('Privileged roles C2', { exact: true })).toHaveValue('LOAN_ADMIN\nSYSTEM_ADMIN');
    // The readiness item C2 raised is gone now that a policy is frozen with it.
    await openReview(page);
    await expect(page.locator('[data-readiness-item="agent-judged-without-policy"]')).toHaveCount(0);
    await shot(page, 'readiness-after-policy', page.locator('[data-readiness]'));

    /* -------------------------------------------- keyboard reach and axe ------ */
    // The simple editor is operable without a mouse, which is the floor for every
    // control on this surface. A radio GROUP is one tab stop — arrow keys move within
    // it and select as they go, and Tab leaves it — so this drives the real contract
    // rather than the one a Tab-per-radio assumption would invent.
    await openStep(page, 'Compliance Rule conditions');
    const c1After = page.locator('[data-condition-id="C1"]');
    const simpleRadio = c1After.getByLabel('Pick the values from a list');
    const advancedRadio = c1After.getByLabel('Write it out myself');
    await simpleRadio.focus();
    await expect(simpleRadio).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(advancedRadio).toBeFocused();
    await expect(advancedRadio).toBeChecked();
    await expect(c1After.getByLabel('Rule text C1', { exact: true })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(simpleRadio).toBeChecked();
    await expect(c1After.getByLabel('Rule text C1', { exact: true })).toBeHidden();
    // Tab leaves the group and lands on the next control, which Space operates: the
    // proven-absence choice rewrites the one saved rule, by keyboard alone.
    await page.keyboard.press('Tab');
    const absence = c1After.getByLabel(/proven absence/);
    await expect(absence).toBeFocused();
    await page.keyboard.press('Space');
    await expect(absence).not.toBeChecked();
    await expect(c1After.locator('[data-simple-text="C1"]')).toHaveText('account_status in [Disabled] else [Active]');
    await page.keyboard.press('Space');
    await expect(absence).toBeChecked();
    await expect(c1After.locator('[data-simple-text="C1"]')).toHaveText(saved);
    await scan(page);
    await shot(page, 'builder-scanned', c1After);

    /* --------------------------- readiness CLEARS as the Draft is completed --- */
    // Submit is unavailable while the Draft is incomplete, and it says why — the same
    // gaps the readiness panel is listing, stated where the action is.
    await openReview(page);
    const submit = page.getByRole('button', { name: 'Submit for approval', exact: true });
    await expect(submit).toHaveAttribute('aria-disabled', 'true');

    await openStep(page, 'Period and scope');
    await page.getByLabel('Period start', { exact: true }).fill('2026-08-01');
    await page.getByLabel('Period end', { exact: true }).fill('2026-08-31');
    await page.getByLabel('Scope statement').fill('Employees terminated in August 2026.');
    await page.getByRole('button', { name: 'Save Period and scope', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Saved. The Draft change is recorded in the audit chain.').first()).toBeVisible();

    await openStep(page, 'Population Source binding');
    await page.getByLabel('Where the records come from').selectOption(sourceId);
    await page.getByRole('button', { name: 'Save records to test', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Saved. The Draft change is recorded in the audit chain.').first()).toBeVisible();
    await openReview(page);
    await expect(page.locator('[data-readiness-item="source-not-bound"]')).toHaveCount(0);
    await shot(page, 'readiness-after-source', page.locator('[data-readiness]'));

    /* ------------------- the optional timing rule, and what it needs ---------- */
    // P-1's 24-hour disablement window ADDS a condition beside the account-status one.
    // It must not replace it: an Active account has no disablement instant at all, so
    // the status condition is what makes that an Exception, and a swap would silently
    // drop the finding the Template exists to make.
    await openStep(page, 'Compliance Rule conditions');
    const timing = page.locator('[data-timing-choice]');
    await expect(timing).toBeVisible();
    await expect(page.locator('[data-window-condition]')).toHaveCount(0);
    await timing.getByRole('button', { name: 'Add the 24-hour disablement window', exact: true }).click();

    const c3 = page.locator('[data-condition-id="C3"]');
    await expect(c3).toBeVisible();
    await expect(c3.getByLabel('Rule text C3', { exact: true })).toHaveValue('disabled_time - termination_time <= 24h');
    // Exactly 24 hours is Compliant, and both halves stay editable.
    await expect(c3.getByLabel('Limit C3', { exact: true })).toHaveValue('24');
    await expect(c3.getByLabel('A record exactly at the limit C3', { exact: true })).toHaveValue('inclusive');
    await expect(c3.getByText('Rule-Classified', { exact: true })).toBeVisible();
    // C1 is untouched — the assertion that fails if the button ever replaces it again.
    await expect(page.locator('[data-condition-id="C1"]').locator('[data-simple-text="C1"]')).toHaveText(saved);

    await page.getByRole('button', { name: 'Save Compliance Rule', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Saved. The Compliance Rule is recorded in the audit chain.')).toBeVisible();
    await shot(page, 'timing-window-condition', c3);

    // Readiness now says both things this Draft cannot substantiate, BEFORE a Run is
    // paid for: the bound source declares a termination DATE, and nothing captures the
    // disablement time. Each names its own subject rather than one vague warning.
    await openReview(page);
    const precision = page.locator('[data-readiness-item="termination-time-precision-missing"]');
    const capture = page.locator('[data-readiness-item="disablement-capture-missing"]');
    await expect(precision).toHaveCount(1);
    await expect(precision).toContainText('termination_effective_time');
    await expect(capture).toHaveCount(1);
    await expect(capture).toContainText('disabled_time');
    await shot(page, 'timing-window-readiness', page.locator('[data-readiness]'));

    // The capture gap is closed where it belongs — in Evidence Requirements, whose own
    // command owns that section — and the Builder offers the exact requirement rather
    // than leaving somebody to type an attribute name the rule may not match.
    await openStep(page, 'Evidence Requirements');
    const offer = page.locator('[data-add-capture="disabled_time"]');
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: 'Add the disabled_time requirement', exact: true }).click();
    const captureRow = page.getByRole('textbox', { name: 'What to record' }).last();
    await expect(captureRow).toHaveValue('disabled_time');
    await page.getByRole('button', { name: 'Save Evidence Requirements', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Saved. Evidence Requirements are recorded in the audit chain.', { exact: true })).toBeVisible();
    await shot(page, 'timing-capture-declared', page.locator('[data-preparation-panel="evidence"]'));
    await openReview(page);
    await expect(page.locator('[data-readiness-item="disablement-capture-missing"]')).toHaveCount(0);
    // The source gap is NOT cleared by declaring a capture: they are two findings.
    await expect(page.locator('[data-readiness-item="termination-time-precision-missing"]')).toHaveCount(1);

    // Withdrawing the choice clears the finding, which is the other half of "readiness
    // shows and clears". The account-status rule is still exactly as it was authored.
    await openStep(page, 'Compliance Rule conditions');
    await timing.getByRole('button', { name: 'Remove the 24-hour disablement window', exact: true }).click();
    await page.getByRole('button', { name: 'Save Compliance Rule', exact: true }).click();
    await expect(page.getByText('Saved. The Compliance Rule is recorded in the audit chain.')).toBeVisible();
    await expect(page.locator('[data-condition-id="C3"]')).toHaveCount(0);
    await expect(page.locator('[data-condition-id="C1"]').locator('[data-simple-text="C1"]')).toHaveText(saved);
    await openReview(page);
    await expect(page.locator('[data-readiness-item="termination-time-precision-missing"]')).toHaveCount(0);

    // Adding a Target System EXPANDS the audited scope, so this one save still confirms
    // — and the dialog names the system being added rather than restating the section.
    await openStep(page, 'Target System selection');
    await page.getByLabel('Add a system').selectOption(targetId);
    await page.getByRole('button', { name: 'Add Target System', exact: true }).click();
    await page.getByRole('button', { name: 'Save Target Systems', exact: true }).click();
    const scopeDialog = page.getByRole('dialog');
    await expect(scopeDialog).toBeVisible();
    await expect(scopeDialog).toContainText(`E2E hero LoanCore ${stamp}`);
    await shot(page, 'scope-expansion-confirmation', scopeDialog);
    await scan(page);
    await scopeDialog.getByRole('button', { name: 'Save Target Systems', exact: true }).click();
    await expect(page.getByText('Saved. The Target System selection is recorded in the audit chain.')).toBeVisible();
    await openReview(page);
    await expect(page.locator('[data-readiness-item="targets-missing"]')).toHaveCount(0);

    await openStep(page, 'Audit Instructions');
    await page.getByLabel(`What the agent should do in E2E hero LoanCore ${stamp}`).fill(
      'Search by employee ID, then by full name. Open the account record and read its status, username and roles.',
    );
    await page.getByRole('button', { name: 'Save Audit Instructions', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Saved. The Audit Instructions are recorded in the audit chain.')).toBeVisible();
    await openPlanDetail(page);
    await shot(page, 'draft-complete', page.locator('[data-agent-summary]'));

    /* ---------------------------------- submit stops, and says what it needs -- */
    // Every SECTION of the Draft is complete now, so the only thing left between it and
    // approval is the executable plan — which the WORKER derives, and no worker runs in
    // this journey. Submit therefore stays unavailable and states that reason rather
    // than a missing section, which is what proves the authoring above actually landed.
    //
    // The submit CONFIRMATION itself is proven in `version-review.spec.ts`, which spawns
    // a real worker with the synthetic model fixture and drives submit → reject → edit →
    // approve through the dialog. Rebuilding that harness here would duplicate it and
    // make a usability journey depend on a model fixture; what this file owns is that
    // the ordinary saves above needed no dialog and this one still does.
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Wait for the executable plan to finish deriving.')).toBeVisible();
    await shot(page, 'submit-unavailable-with-its-reason', submit.locator('xpath=..'));

    // And the reason is NOT a missing section: every completeness blocker the Builder
    // could raise is gone, and readiness lists nothing about targets or the source.
    for (const cleared of ['targets-missing', 'source-not-bound', 'agent-judged-without-policy']) {
      await expect(page.locator(`[data-readiness-item="${cleared}"]`), cleared).toHaveCount(0);
    }
    await scan(page);
  });
});
