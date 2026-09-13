import { expect, test, type Page, type Request } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { deriveExecutablePlan, draftContext, refreshPreparation } from '@intellifin/domain';
import { initialPlanDerivation, planAuthoringDigest, type AuthoringDraftFields, type ProcedureVersionRecord } from '@intellifin/application';
import { createDb, createSqlClient, CryptoUuidV7Generator, PostgresProceduresUnitOfWork, type Sql } from '@intellifin/infrastructure';

import { executablePlanInputs } from '../fixtures/executable-plan';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { attachAuthoringScreenshot, openPlanDetail, openStep } from './builder';

/**
 * Real browser, Server Actions, application writer and installed SDK, with the explicit
 * test-only OpenAI transport preload in playwright.config.ts. These checks establish
 * workflow and failure behavior, not a live model's prose quality. Follow-up cases
 * check proposal provenance; an uncertain retry checks its original saved request.
 */
test.use({ storageState: AUTH_STATE.auditor });
test.describe.configure({ mode: 'serial' });
test.skip(process.env['PLAYWRIGHT_BASE_URL'] !== undefined, 'Writing assistance uses the isolated OpenAI transport fixture installed by playwright.config.ts; an unverified external server is not supported.');

const ids = new CryptoUuidV7Generator();
let sql: Sql;
let draft: ProcedureVersionRecord;

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for writing assistance browser tests.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 2 });
  const [actor] = await sql<{ id: string }[]>`SELECT id FROM auth_user WHERE email = ${ACCOUNTS.auditor.email}`;
  if (!actor) throw new Error('The seeded auditor is required.');
  const inputs = { ...executablePlanInputs(), controlName: `E2E writing assistance ${ids.next()}` };
  const compiled = deriveExecutablePlan(inputs);
  if (!compiled.ok) throw new Error(compiled.reason);
  draft = { ...inputs, ...initialPlanDerivation(), procedureId: ids.next(), versionId: ids.next(), versionNumber: 1, state: 'DRAFT',
    authorship: { createdBy: { type: 'human', id: actor.id }, responsibleAuthorId: actor.id, humanAuthorIds: [actor.id] },
    compiledPlan: compiled.plan, planStatus: 'succeeded', planDerivable: true,
  };
  draft = { ...draft, sectionPreparation: refreshPreparation(draft), planInputDigest: planAuthoringDigest(draft) };
  const uow = new PostgresProceduresUnitOfWork(createDb(sql));
  await uow.execute(async ({ procedures }) => { await procedures.insertProcedure(draft); await procedures.insertVersion(draft); });
  await page.goto(`/procedures/${draft.procedureId}/builder`);
  await expect(page.locator('[data-guided-preparation]')).toHaveAttribute('data-guided-ready', 'true');
  await expect(page.getByLabel('Objective', { exact: true })).toHaveValue(draftContext(draft.sections).objective);
});

test.afterEach(async () => {
  if (!sql) return;
  try {
    if (draft) {
      await sql`DELETE FROM pgboss.job WHERE data->>'versionId' = ${draft.versionId}`;
      await sql`DELETE FROM notification WHERE procedure_id = ${draft.procedureId}`;
      // The procedure owns its version and bounded authoring requests by cascading FK.
      await sql`DELETE FROM procedure WHERE procedure_id = ${draft.procedureId}`;
    }
  } finally { await sql.end({ timeout: 5 }); }
});

function actionFields(request: Request): Record<string, unknown> | null {
  if (request.method() !== 'POST') return null;
  try {
    const arguments_: unknown = JSON.parse(request.postData() ?? 'null');
    const fields: unknown = Array.isArray(arguments_) ? arguments_[0] : arguments_;
    return fields !== null && typeof fields === 'object' && !Array.isArray(fields) ? fields as Record<string, unknown> : null;
  } catch { return null; }
}

async function selectWriting(page: Page, section: 'objective' | 'scope'): Promise<void> {
  await expect(page.locator('[data-guided-ready="true"]')).toBeVisible();
  await page.locator(`[data-preparation-nav="${section === 'objective' ? 'context' : 'scope'}"]`).click();
  const editor = page.locator(`[data-preparation-panel="${section === 'objective' ? 'context' : 'scope'}"]`);
  if (section === 'scope') await editor.getByRole('button', { name: '1. Describe the scope', exact: true }).click();
  else if (await editor.getByRole('button', { name: 'Adjust the objective with the assistant', exact: true }).count())
    await editor.getByRole('button', { name: 'Adjust the objective with the assistant', exact: true }).click();
  await expect(page.locator(`[data-writing-section="${section}"]`)).toBeVisible();
}

async function requestStates(): Promise<readonly string[]> {
  const rows = await sql<{ state: string }[]>`SELECT record->>'state' AS state FROM procedure_authoring_request WHERE version_id = ${draft.versionId} ORDER BY created_at`;
  return rows.map(row => row.state);
}

test('chat sends with Enter, renders real partial replies, and keeps reading position until Jump to latest', async ({ page }, testInfo) => {
  await selectWriting(page, 'scope');
  const writing = page.locator('[data-writing-section="scope"]');
  const input = writing.getByLabel('Your answer', { exact: true });
  const notes = 'SYNTHETIC:STREAM ' + Array.from({ length: 10 }, (_, i) => `Synthetic note ${i + 1}: inspect every selected parameter and keep unreadable values unresolved.`).join('\n');
  await input.fill(notes);
  await input.press('End'); await input.press('Shift+Enter');
  await expect(input).toHaveValue(notes + '\n');
  expect(await requestStates()).toEqual([]);
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  expect(await requestStates()).toEqual([]);
  await input.press('Backspace'); await input.press('Enter');
  const thread = writing.getByRole('log', { name: 'Conversation with IntelliFin' });
  await expect(thread.getByRole('article', { name: 'Message from you', exact: true })).toContainText(notes);
  await expect(input).toHaveValue('');
  await expect(writing.locator('[data-streaming-response]')).toContainText('Synthetic provider fixture');
  await expect(writing.locator('[data-current-assistant-response]')).toHaveCount(0);
  await expect(writing.getByRole('button', { name: 'Use this draft', exact: true })).toHaveCount(0);
  expect(await requestStates()).toEqual(['pending']);
  await attachAuthoringScreenshot(page, testInfo, 'chat-streaming-response');
  // Reading earlier messages must not be undone by the next streamed snapshot.
  await thread.focus(); await thread.press('Control+Home');
  await expect(writing.getByRole('button', { name: 'Jump to latest', exact: true })).toBeVisible();
  await expect.poll(() => thread.evaluate(node => node.scrollTop)).toBe(0);
  const readingPosition = await thread.evaluate(node => node.scrollTop);
  await expect(writing.locator('[data-current-assistant-response]')).toContainText('Synthetic note 10');
  expect(await thread.evaluate(node => node.scrollTop)).toBe(readingPosition);
  await writing.getByRole('button', { name: 'Jump to latest', exact: true }).click();
  expect(await thread.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(2);
  expect(await requestStates()).toEqual(['ready']);
  await expect(page.getByLabel('Scope statement', { exact: true })).toHaveValue(draft.scope);
  await expect(page.locator('[data-preparation-progress]')).toContainText('0 of 6 sections reviewed');
});

test('generation keeps manual editing available, retains its section after switching, and refuses a stale proposal', async ({ page }, testInfo) => {
  const originalObjective = draftContext(draft.sections).objective;
  const savedObjective = 'Verify every production parameter and retain unresolved comparisons for review.';
  const proposal = 'All production parameters, including unresolved comparisons.';
  const notes = `SYNTHETIC:DELAY ${proposal}`;
  const address = /\/(?:api\/procedures\/authoring|procedures\/[^/]+\/builder)$/;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let responseReady = false;
  await page.route(address, async route => {
    if (actionFields(route.request())?.['notes'] !== notes) return route.continue();
    const response = await route.fetch();
    responseReady = true;
    await held;
    await route.fulfill({ response });
  });
  try {
    await selectWriting(page, 'scope');
    const scopeWriting = page.locator('[data-writing-section="scope"]');
    await scopeWriting.getByLabel('Your answer', { exact: true }).fill(notes);
    await openStep(page, 'Period and scope');
    await page.getByLabel('Scope statement', { exact: true }).fill('An unsaved scope change.');
    await selectWriting(page, 'scope');
    // Generation reads saved context and must not require discarding a rough manual edit.
    await expect(scopeWriting.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    await scopeWriting.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(scopeWriting.getByRole('button', { name: 'Responding…', exact: true })).toBeVisible();
    await expect(page.getByLabel('Scope statement', { exact: true })).toHaveValue('An unsaved scope change.');
    await openStep(page, 'Period and scope');
    await page.getByRole('button', { name: 'Use saved Period and scope', exact: true }).click();
    // A request alone adds no save/review/submit gate to this complete Draft.
    await openPlanDetail(page);
    await expect(page.getByRole('button', { name: 'Submit for approval', exact: true })).toBeEnabled();
    await selectWriting(page, 'objective');
    const objectiveWriting = page.locator('[data-writing-section="objective"]');
    await expect(objectiveWriting.getByRole('heading', { name: 'Procedure assistant', exact: true })).toBeVisible();
    await expect(objectiveWriting.getByRole('heading', { name: 'Procedure assistant', exact: true })).toBeFocused();
    await expect(objectiveWriting.getByRole('heading', { name: 'Proposed wording — not saved' })).toHaveCount(0);
    await openStep(page, 'Objective');
    await expect(page.getByLabel('Objective', { exact: true })).toBeEditable();
    await page.getByLabel('Objective', { exact: true }).fill(savedObjective);
    await expect(page.getByRole('button', { name: 'Save context', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Save context', exact: true }).click();
    // The real response is held so this assertion cannot accidentally observe a finished
    // generation. Next may queue the save, but the manual editor accepts it immediately.
    await expect(page.getByLabel('Objective', { exact: true })).toHaveValue(savedObjective);
    await expect.poll(() => responseReady).toBe(true);
    await attachAuthoringScreenshot(page, testInfo, 'writing-section-switch-pending');
    release();
    await expect(page.getByText('Saved. Context changes apply to this procedure only.', { exact: true })).toBeVisible();
    await expect(objectiveWriting.getByRole('heading', { name: 'Proposed wording — not saved' })).toHaveCount(0);
    await expect(page.getByLabel('Objective', { exact: true })).not.toHaveValue(originalObjective);
    await selectWriting(page, 'scope');
    await expect(scopeWriting.getByRole('heading', { name: 'Procedure assistant', exact: true })).toBeVisible();
    await expect(scopeWriting.locator('.ls-writing__version').last()).toContainText(proposal);
    const useDraft = scopeWriting.getByRole('button', { name: 'Use this draft', exact: true });
    await expect(useDraft).toBeDisabled();
    await expect(useDraft).toHaveAccessibleDescription(/saved procedure changed/);
    await useDraft.click({ force: true });
    await expect(page.getByLabel('Scope statement', { exact: true })).toHaveValue(draft.scope);
    await expect(page.locator('[data-preparation-progress]')).toContainText('0 of 6 sections reviewed');
    expect(await requestStates()).toEqual(['ready']);
    const reconcile = scopeWriting.getByRole('button', { name: 'Start again with this suggestion', exact: true });
    await expect(reconcile).toBeVisible();
    expect(await reconcile.evaluate(button => {
      const help = button.closest('.ls-writing');
      if (!help) throw new Error('Writing help is missing');
      return button.getBoundingClientRect().right - help.getBoundingClientRect().right;
    })).toBeLessThanOrEqual(1);
    await attachAuthoringScreenshot(page, testInfo, 'writing-stale-suggestion');
    await reconcile.click();
    await expect(scopeWriting.getByLabel('Your answer', { exact: true })).toHaveValue(proposal);
    await expect(scopeWriting.getByRole('heading', { name: 'Proposed wording — not saved' })).toHaveCount(0);
    await expect(page.getByLabel('Scope statement', { exact: true })).toHaveValue(draft.scope);
  } finally { release(); await page.unroute(address); }
});

test('provider failure leaves manual saves usable, questions stay unapplied, and an auditor can reject revised wording', async ({ page }, testInfo) => {
  const originalObjective = draftContext(draft.sections).objective;
  const manualScope = 'All production parameters. Missing information remains unresolved.';
  await selectWriting(page, 'scope');
  const scopeWriting = page.locator('[data-writing-section="scope"]');
  await scopeWriting.getByLabel('Your answer', { exact: true }).fill('SYNTHETIC:FAIL');
  await scopeWriting.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(scopeWriting.getByText(/could not produce a confirmed draft/)).toBeVisible();
  await expect(scopeWriting.getByText(/still edit and save the procedure yourself/)).toBeVisible();
  await expect(scopeWriting.getByRole('button', { name: 'Use this draft', exact: true })).toHaveCount(0);
  await openStep(page, 'Period and scope');
  await expect(page.getByLabel('Scope statement', { exact: true })).toBeEditable();
  await attachAuthoringScreenshot(page, testInfo, 'writing-provider-failure');
  await page.getByLabel('Scope statement', { exact: true }).fill(manualScope);
  await page.getByRole('button', { name: 'Save Period and scope', exact: true }).click();
  await expect(page.getByText('Saved. The Draft change is recorded in the audit chain.', { exact: true })).toBeVisible();
  await page.reload();
  await selectWriting(page, 'scope');
  await expect(page.getByLabel('Scope statement', { exact: true })).toHaveValue(manualScope);

  await selectWriting(page, 'objective');
  const writing = page.locator('[data-writing-section="objective"]');
  await writing.getByLabel('Your answer', { exact: true }).fill('SYNTHETIC:CLARIFY');
  await writing.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(writing.getByRole('heading', { name: 'Which approved criterion should this procedure use?', exact: true })).toBeVisible();
  await expect(writing.getByText('Which approved criterion should this procedure use?', { exact: true })).toBeVisible();
  await expect(writing.getByRole('button', { name: 'Use this draft', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Objective', { exact: true })).toHaveValue(originalObjective);
  await expect(page.locator('[data-preparation-progress]')).toContainText('0 of 6 sections reviewed');
  await attachAuthoringScreenshot(page, testInfo, 'writing-clarification');
  const revisedNotes = 'Compare every production parameter with the supplied baseline; keep a missing criterion unresolved.';
  await writing.getByLabel('Your reply', { exact: true }).fill(revisedNotes);
  await writing.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(writing.getByRole('heading', { name: 'Proposed wording — not saved' })).toBeVisible();
  await expect(writing.locator('.ls-writing__version').last()).toContainText(revisedNotes);
  await writing.getByRole('button', { name: 'Keep my wording', exact: true }).click();
  await expect(writing.getByText('Your saved wording is unchanged.', { exact: true })).toBeVisible();
  await expect(writing.getByRole('button', { name: 'Use this draft', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Objective', { exact: true })).toHaveValue(originalObjective);
  expect(await requestStates()).toEqual(['failed', 'ready', 'rejected']);
  await attachAuthoringScreenshot(page, testInfo, 'writing-rejected-suggestion');
  await page.reload();
  await expect(page.getByLabel('Objective', { exact: true })).toHaveValue(originalObjective);
  await openStep(page, 'Period and scope');
  await expect(page.getByLabel('Scope statement', { exact: true })).toHaveValue(manualScope);
});

test('an expired writing session shows a refusal and preserves manual scope editing', async ({ page }, testInfo) => {
  const address = '**/api/procedures/authoring';
  await page.route(address, route => route.fulfill({ status: 401, body: 'PRIVATE_AUTH_BODY' }));
  try {
    await selectWriting(page, 'scope');
    const writing = page.locator('[data-writing-section="scope"]');
    await writing.getByLabel('Your answer', { exact: true }).fill('Suggest to me');
    await writing.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(writing.getByText(/Your session has expired/)).toBeVisible();
    await expect(writing.getByRole('button', { name: 'Retry this request', exact: true })).toHaveCount(0);
    await expect(writing.getByText(/writing response was lost/)).toHaveCount(0);
    await expect(writing.getByRole('button', { name: 'Use this draft', exact: true })).toHaveCount(0);
    expect(await requestStates()).toEqual([]);
    await openStep(page, 'Period and scope');
    await expect(page.getByLabel('Scope statement', { exact: true })).toBeEditable();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await attachAuthoringScreenshot(page, testInfo, 'writing-session-expired');
    await page.getByLabel('Scope statement', { exact: true }).fill('Manual scope remains editable after a refused writing request.');
    await page.getByRole('button', { name: 'Save Period and scope', exact: true }).click();
    await expect(page.getByText('Saved. The Draft change is recorded in the audit chain.', { exact: true })).toBeVisible();
  } finally { await page.unroute(address); }
});

test('an uncertain generation retries its original request and an uncertain acceptance blocks submission until reload', async ({ page }, testInfo) => {
  const notes = 'Compare all production parameters with the supplied baseline and retain unresolved differences.';
  const address = /\/(?:api\/procedures\/authoring|procedures\/[^/]+\/builder)$/;
  const sent: AuthoringDraftFields[] = [];
  let loseGeneration = true, acceptanceCommitted = false;
  let releaseAcceptance!: () => void;
  const acceptanceHeld = new Promise<void>(resolve => { releaseAcceptance = resolve; });
  await page.route(address, async route => {
    const fields = actionFields(route.request());
    if (fields?.['notes'] === notes) {
      sent.push(fields as unknown as AuthoringDraftFields);
      if (loseGeneration) {
        loseGeneration = false;
        await route.fetch();
        return route.abort('failed');
      }
    }
    if (fields?.['replacement'] === notes) {
      await route.fetch();
      acceptanceCommitted = true;
      await acceptanceHeld;
      return route.abort('failed');
    }
    return route.continue();
  });
  try {
    await selectWriting(page, 'objective');
    const writing = page.locator('[data-writing-section="objective"]');
    await writing.getByLabel('Your answer', { exact: true }).fill(notes);
    await writing.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(writing.getByText(/writing response was lost/)).toBeVisible();
    await expect(writing.getByRole('textbox')).toHaveValue('');
    await expect(writing.getByRole('textbox')).not.toBeEditable();
    await writing.getByRole('button', { name: 'Retry this request', exact: true }).click();
    await expect(writing.getByRole('button', { name: 'Use this draft', exact: true })).toBeEnabled();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(await requestStates()).toEqual(['ready']);

    // A local manual edit is checked at acceptance time, including forced activation.
    await openStep(page, 'Objective');
    await page.getByLabel('Objective', { exact: true }).fill('An unsaved manual objective.');
    const useDraft = writing.getByRole('button', { name: 'Use this draft', exact: true });
    await expect(useDraft).toHaveAccessibleDescription(/unsaved changes in Risk, control and objective/);
    await useDraft.click({ force: true });
    expect(await requestStates()).toEqual(['ready']);
    await page.getByRole('button', { name: 'Use saved Risk, control and objective', exact: true }).click();
    await expect(useDraft).toBeEnabled();
    await useDraft.click();
    await expect.poll(() => acceptanceCommitted).toBe(true);
    await openPlanDetail(page);
    const submit = page.getByRole('button', { name: 'Submit for approval', exact: true });
    await expect(submit).toHaveAccessibleDescription(/Writing suggestion save to be acknowledged/);
    releaseAcceptance();
    await expect(submit).toHaveAccessibleDescription(/unknown save outcome in Writing suggestion/);
    await expect(page.getByRole('button', { name: 'Reload saved version', exact: true })).toBeVisible();
    await attachAuthoringScreenshot(page, testInfo, 'writing-unknown-acceptance');
    expect(await requestStates()).toEqual(['accepted']);
    await page.unroute(address);
    await page.getByRole('button', { name: 'Reload saved version', exact: true }).click();
    await expect(page.locator('[data-guided-preparation]')).toHaveAttribute('data-guided-ready', 'true');
    await expect(page.getByLabel('Objective', { exact: true })).toHaveValue(notes);
    await expect(page.locator('[data-preparation-progress]')).toContainText('0 of 6 sections reviewed');
  } finally { releaseAcceptance(); await page.unroute(address); }
});

test('the central test assistant keeps, drops and enhances a proposal before edited acceptance and review', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-preparation-nav="instructions"]').click();
  const panel = page.locator('[data-preparation-panel="instructions"]');
  const writing = panel.locator('[data-writing-section]');
  // It is present in the actual editing column without a Help Me Write activation.
  await expect(writing).toBeVisible();
  const work = page.locator('.ls-guided__work');
  const closedWidth = (await work.boundingBox())!.width;
  const help = page.locator('.ls-guided__help-disclosure');
  await help.locator('summary').click();
  const openWidth = (await work.boundingBox())!.width;
  expect(closedWidth - openWidth).toBeGreaterThan(150);
  await help.locator('summary').click();
  expect(await requestStates()).toEqual([]);
  await expect(panel).toContainText('ProdConsole');
  await expect(panel.locator('[data-guided-manual="instructions"]')).not.toHaveAttribute('open');
  const saved = page.getByLabel('What the agent should do in ProdConsole', { exact: true });
  await expect(saved).toHaveValue('Read all baseline parameters.');
  await panel.getByRole('button', { name: 'Mark reviewed and continue', exact: true }).click();
  await expect(page.locator('[data-preparation-progress]')).toContainText('1 of 6 sections reviewed');
  await openStep(page, 'Audit Instructions');
  await writing.getByLabel('Your answer', { exact: true }).fill('Synthetic test: Compare every baseline parameter in ProdConsole with the approved baseline. Keep evidence and flag values that cannot be read.');
  await writing.getByRole('button', { name: 'Send message', exact: true }).click();
  const proposed = writing.locator('[data-current-assistant-response]');
  await expect(proposed).toContainText('Add a separate summary by owner.');
  await expect(saved).toHaveValue('Read all baseline parameters.');
  await expect(page.locator('[data-preparation-progress]')).toContainText('1 of 6 sections reviewed');
  await writing.getByRole('button', { name: 'Edit', exact: true }).click();
  const fullProposal = '1. Read every baseline parameter in ProdConsole.\n2. Compare observed values with the approved baseline.\n3. Add a separate summary by owner.\n4. Leave missing values unresolved.\nHuman note: preserve exact parameter names.';
  await writing.getByLabel('Edit proposed replacement', { exact: true }).fill(fullProposal);
  const correction = 'Keep steps 1 and 2 exactly. Drop the summary by owner. Enhance unresolved handling: record why a value could not be read.';
  await writing.getByLabel('Your reply', { exact: true }).fill(correction);
  await writing.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(proposed).toContainText('Leave missing or unreadable values unresolved and record the reason.');
  await expect(proposed).not.toContainText('Add a separate summary by owner.');
  await expect(writing.getByRole('log', { name: 'Conversation with IntelliFin' })).toContainText(correction);
  await expect(writing.getByLabel('Your reply', { exact: true })).toHaveValue('');
  await expect(writing).toContainText('Kept the first two steps, removed the owner summary');
  await expect(saved).toHaveValue('Read all baseline parameters.');
  const receipts = await sql<{ record: { revision?: { draft: string; feedback: string } } }[]>`SELECT record FROM procedure_authoring_request WHERE version_id = ${draft.versionId} ORDER BY created_at`;
  expect(receipts).toHaveLength(2);
  expect(receipts[1]!.record.revision).toMatchObject({ draft: fullProposal, feedback: correction });
  await attachAuthoringScreenshot(page, testInfo, 'test-design-intent-revision');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await attachAuthoringScreenshot(page, testInfo, 'test-design-intent-mobile');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await writing.getByRole('button', { name: 'Edit', exact: true }).click();
  const accepted = '1. Read every baseline parameter in ProdConsole.\n2. Compare observed values with the approved baseline.\n3. Leave missing or unreadable values unresolved and record the reason.\nPreserve exact parameter names.';
  await writing.getByLabel('Edit proposed replacement', { exact: true }).fill(accepted);
  await writing.getByRole('button', { name: 'Use this draft', exact: true }).click();
  await expect(saved).toHaveValue(accepted);
  await expect(page.locator('[data-preparation-progress]')).toContainText('0 of 6 sections reviewed');
  await panel.getByRole('button', { name: 'Mark reviewed and continue', exact: true }).click();
  await expect(page.locator('[data-preparation-nav="instructions"] [data-preparation-status]')).toHaveAttribute('data-preparation-status', 'reviewed');
  await page.reload();
  await openStep(page, 'Audit Instructions');
  await expect(saved).toHaveValue(accepted);
});


test('the default journey confirms the control and guides scope and evidence choices before test design', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const context = page.locator('[data-preparation-panel="context"]');
  await expect(context.locator('[data-control-confirmation]')).toContainText(draft.controlName);
  await expect(context.getByLabel('Risk', { exact: true })).toBeHidden();
  await expect(context.getByLabel('Objective', { exact: true })).toBeHidden();
  await expect(context.getByRole('button', { name: 'Help Me Write', exact: true })).toBeHidden();
  await expect(context.getByRole('button', { name: 'Yes, use this control', exact: true })).toBeVisible();
  await attachAuthoringScreenshot(page, testInfo, 'dialogue-control-confirmation');
  await context.getByRole('button', { name: 'Yes, use this control', exact: true }).click();
  await expect(page.locator('[data-preparation-nav="scope"]')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('[data-preparation-progress]')).toContainText('1 of 6 sections reviewed');
  expect(await requestStates()).toEqual([]);

  const scope = page.locator('[data-preparation-panel="scope"]');
  const writing = scope.locator('[data-writing-section="scope"]');
  await expect(scope.getByLabel('Period start', { exact: true })).toBeHidden();
  await expect(scope.getByLabel('Scope statement', { exact: true })).toBeHidden();
  await expect(writing.locator('[data-writing-question]')).toContainText('Which records do you want this test to cover?');
  const intended = 'Every production parameter in the approved baseline. Do not sample; retain unresolved comparisons.';
  await writing.getByLabel('Your answer', { exact: true }).fill(intended);
  await attachAuthoringScreenshot(page, testInfo, 'dialogue-scope-question');
  await writing.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(writing.getByRole('button', { name: 'Use this draft', exact: true })).toBeEnabled();
  await expect(scope.getByLabel('Scope statement', { exact: true })).toHaveValue(draft.scope);
  await expect(page.locator('[data-preparation-progress]')).toContainText('1 of 6 sections reviewed');
  await writing.getByRole('button', { name: 'Use this draft', exact: true }).click();
  await expect(scope.getByLabel('Period start', { exact: true })).toBeVisible();
  await expect(scope.getByLabel('Period start', { exact: true })).toHaveValue(draft.period!.from);
  await expect(scope.getByLabel('Period end', { exact: true })).toHaveValue(draft.period!.to);
  await expect(scope.getByLabel('Scope statement', { exact: true })).toHaveValue(intended);
  await expect(scope.getByLabel('Scope statement', { exact: true })).toBeHidden();
  await scope.getByRole('button', { name: 'Save Period and scope', exact: true }).click();
  await expect(scope.locator('[data-guide-question="confirm"]')).toBeVisible();
  await expect(scope.locator('[data-guide-question="confirm"]')).toContainText(intended);

  // Evidence remains explicit manual choices. No model request is made by navigation.
  await page.locator('[data-preparation-nav="evidence"]').click();
  const evidence = page.locator('[data-preparation-panel="evidence"]');
  await expect(evidence.getByLabel('Where the records come from', { exact: true })).toBeVisible();
  await expect(evidence.getByLabel('Add a system', { exact: true })).toBeHidden();
  await evidence.getByRole('button', { name: 'Keep this source and choose systems', exact: true }).click();
  await expect(evidence.getByLabel('Add a system', { exact: true })).toBeVisible();
  await expect(evidence.getByText('Registered access details', { exact: true })).toBeVisible();
  await expect(evidence.getByText('Sign-in credential', { exact: true })).toBeHidden();
  await attachAuthoringScreenshot(page, testInfo, 'dialogue-system-choice');
  await evidence.getByRole('button', { name: 'Keep these systems and choose evidence', exact: true }).click();
  await expect(evidence.getByRole('button', { name: 'Add an evidence item', exact: true })).toBeVisible();
  await evidence.getByRole('button', { name: 'Add an evidence item', exact: true }).click();
  await expect(evidence.getByLabel('What to record', { exact: true }).first()).toBeVisible();
  await expect(evidence.getByLabel('Add a system', { exact: true })).toBeHidden();
  expect(await requestStates()).toEqual(['accepted']);

  await page.locator('[data-preparation-nav="instructions"]').click();
  const steps = page.locator('[data-preparation-panel="instructions"]');
  await expect(steps.getByLabel('What the agent should do in ProdConsole', { exact: true })).toBeHidden();
  await expect(steps.getByLabel('Your answer', { exact: true })).toBeVisible();
  await expect(steps.locator('[data-writing-question]')).toContainText('What do you want this check of ProdConsole to establish?');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await attachAuthoringScreenshot(page, testInfo, 'dialogue-test-intent-mobile');
});
