import { expect, test, type Page, type Request } from '@playwright/test';

import { deriveExecutablePlan, draftContext, refreshPreparation } from '@intellifin/domain';
import { initialPlanDerivation, planAuthoringDigest, type AuthoringDraftFields, type ProcedureVersionRecord } from '@intellifin/application';
import { createDb, createSqlClient, CryptoUuidV7Generator, PostgresProceduresUnitOfWork, type Sql } from '@intellifin/infrastructure';

import { executablePlanInputs } from '../fixtures/executable-plan';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { openPlanDetail, openStep } from './builder';

/**
 * Real browser, Server Actions, application writer and installed SDK, with the explicit
 * test-only OpenAI transport preload in playwright.config.ts. These checks establish
 * workflow and failure behavior, not a live model's prose quality. The three cases make
 * five new requests in total; an uncertain retry checks its original saved request.
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
    const fields: unknown = Array.isArray(arguments_) ? arguments_[0] : null;
    return fields !== null && typeof fields === 'object' && !Array.isArray(fields) ? fields as Record<string, unknown> : null;
  } catch { return null; }
}

async function selectWriting(page: Page, section: 'objective' | 'scope', mode = 'Help Me Write'): Promise<void> {
  await openStep(page, section === 'objective' ? 'Objective' : 'Period and scope');
  const editor = page.locator(`[data-preparation-panel="${section === 'objective' ? 'context' : 'scope'}"]`);
  await editor.getByRole('button', { name: mode, exact: true }).click();
  await expect(page.locator(`[data-writing-section="${section}"]`)).toBeVisible();
}

async function requestStates(): Promise<readonly string[]> {
  const rows = await sql<{ state: string }[]>`SELECT record->>'state' AS state FROM procedure_authoring_request WHERE version_id = ${draft.versionId} ORDER BY created_at`;
  return rows.map(row => row.state);
}

test('generation keeps manual editing available, retains its section after switching, and refuses a stale proposal', async ({ page }, testInfo) => {
  const originalObjective = draftContext(draft.sections).objective;
  const savedObjective = 'Verify every production parameter and retain unresolved comparisons for review.';
  const proposal = 'All production parameters, including unresolved comparisons.';
  const notes = `SYNTHETIC:DELAY ${proposal}`;
  const address = page.url();
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
    await scopeWriting.getByLabel('Rough notes for Scope note', { exact: true }).fill(notes);
    await page.getByLabel('Scope statement', { exact: true }).fill('An unsaved scope change.');
    await expect(scopeWriting.getByRole('button', { name: 'Prepare draft', exact: true })).toHaveAccessibleDescription(/unsaved changes in Period and scope/);
    await scopeWriting.getByRole('button', { name: 'Prepare draft', exact: true }).click({ force: true });
    expect(await requestStates()).toEqual([]);
    await page.getByRole('button', { name: 'Use saved Period and scope', exact: true }).click();
    await scopeWriting.getByRole('button', { name: 'Prepare draft', exact: true }).click();
    await expect(scopeWriting.getByRole('button', { name: 'Preparing a draft…', exact: true })).toBeVisible();
    // A request alone adds no save/review/submit gate to this complete Draft.
    await openPlanDetail(page);
    await expect(page.getByRole('button', { name: 'Submit for approval', exact: true })).toBeEnabled();
    await selectWriting(page, 'objective');
    const objectiveWriting = page.locator('[data-writing-section="objective"]');
    await expect(objectiveWriting.getByRole('heading', { name: 'Writing help: Objective', exact: true })).toBeVisible();
    await expect(objectiveWriting.getByRole('heading', { name: 'Proposed replacement — not applied' })).toHaveCount(0);
    await expect(page.getByLabel('Objective', { exact: true })).toBeEditable();
    await page.getByLabel('Objective', { exact: true }).fill(savedObjective);
    await expect(page.getByRole('button', { name: 'Save context', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Save context', exact: true }).click();
    // The real response is held so this assertion cannot accidentally observe a finished
    // generation. Next may queue the save, but the manual editor accepts it immediately.
    await expect(page.getByLabel('Objective', { exact: true })).toHaveValue(savedObjective);
    await expect.poll(() => responseReady).toBe(true);
    await testInfo.attach('writing-section-switch-pending', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    release();
    await expect(page.getByText('Saved. Context changes apply to this procedure only.', { exact: true })).toBeVisible();
    await expect(objectiveWriting.getByRole('heading', { name: 'Proposed replacement — not applied' })).toHaveCount(0);
    await expect(page.getByLabel('Objective', { exact: true })).not.toHaveValue(originalObjective);
    await selectWriting(page, 'scope');
    await expect(scopeWriting.getByRole('heading', { name: 'Writing help: Scope note', exact: true })).toBeVisible();
    await expect(scopeWriting.locator('.ls-writing__version').last()).toContainText(proposal);
    const useDraft = scopeWriting.getByRole('button', { name: 'Use this draft', exact: true });
    await expect(useDraft).toBeDisabled();
    await expect(useDraft).toHaveAccessibleDescription(/saved procedure changed/);
    await useDraft.click({ force: true });
    await expect(page.getByLabel('Scope statement', { exact: true })).toHaveValue(draft.scope);
    await expect(page.locator('[data-preparation-progress]')).toContainText('0 of 6 sections reviewed');
    expect(await requestStates()).toEqual(['ready']);
    await testInfo.attach('writing-stale-suggestion', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await scopeWriting.getByRole('button', { name: 'Start again with this suggestion', exact: true }).click();
    await expect(scopeWriting.getByLabel('Rough notes for Scope note', { exact: true })).toHaveValue(proposal);
    await expect(scopeWriting.getByRole('heading', { name: 'Proposed replacement — not applied' })).toHaveCount(0);
    await expect(page.getByLabel('Scope statement', { exact: true })).toHaveValue(draft.scope);
  } finally { release(); await page.unroute(address); }
});

test('provider failure leaves manual saves usable, questions stay unapplied, and an auditor can reject revised wording', async ({ page }, testInfo) => {
  const originalObjective = draftContext(draft.sections).objective;
  const manualScope = 'All production parameters. Missing information remains unresolved.';
  await selectWriting(page, 'scope');
  const scopeWriting = page.locator('[data-writing-section="scope"]');
  await scopeWriting.getByLabel('Rough notes for Scope note', { exact: true }).fill('SYNTHETIC:FAIL');
  await scopeWriting.getByRole('button', { name: 'Prepare draft', exact: true }).click();
  await expect(scopeWriting.getByText(/could not produce a confirmed draft/)).toBeVisible();
  await expect(scopeWriting.getByText(/still edit and save the procedure yourself/)).toBeVisible();
  await expect(scopeWriting.getByRole('button', { name: 'Use this draft', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Scope statement', { exact: true })).toBeEditable();
  await testInfo.attach('writing-provider-failure', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await page.getByLabel('Scope statement', { exact: true }).fill(manualScope);
  await page.getByRole('button', { name: 'Save Period and scope', exact: true }).click();
  await expect(page.getByText('Saved. The Draft change is recorded in the audit chain.', { exact: true })).toBeVisible();
  await page.reload();
  await selectWriting(page, 'scope');
  await expect(page.getByLabel('Scope statement', { exact: true })).toHaveValue(manualScope);

  await selectWriting(page, 'objective');
  const writing = page.locator('[data-writing-section="objective"]');
  await writing.getByLabel('Rough notes for Objective', { exact: true }).fill('SYNTHETIC:CLARIFY');
  await writing.getByRole('button', { name: 'Prepare draft', exact: true }).click();
  await expect(writing.getByRole('heading', { name: 'Questions to resolve', exact: true })).toBeVisible();
  await expect(writing.getByText('Which approved criterion should this procedure use?', { exact: true })).toBeVisible();
  await expect(writing.getByRole('button', { name: 'Use this draft', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Objective', { exact: true })).toHaveValue(originalObjective);
  await expect(page.locator('[data-preparation-progress]')).toContainText('0 of 6 sections reviewed');
  await testInfo.attach('writing-clarification', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await writing.getByRole('button', { name: 'Ask for changes', exact: true }).click();
  const revisedNotes = 'Compare every production parameter with the supplied baseline; keep a missing criterion unresolved.';
  await writing.getByLabel('Rough notes for Objective', { exact: true }).fill(revisedNotes);
  await writing.getByLabel('What should change?', { exact: true }).fill('No additional policy criterion has been supplied. Do not invent one.');
  await writing.getByRole('button', { name: 'Prepare revised draft', exact: true }).click();
  await expect(writing.getByRole('heading', { name: 'Proposed replacement — not applied' })).toBeVisible();
  await expect(writing.locator('.ls-writing__version').last()).toContainText(revisedNotes);
  await writing.getByRole('button', { name: 'Keep my wording', exact: true }).click();
  await expect(writing.getByText('Your saved wording is unchanged.', { exact: true })).toBeVisible();
  await expect(writing.getByRole('button', { name: 'Use this draft', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Objective', { exact: true })).toHaveValue(originalObjective);
  expect(await requestStates()).toEqual(['failed', 'ready', 'rejected']);
  await testInfo.attach('writing-rejected-suggestion', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await page.reload();
  await expect(page.getByLabel('Objective', { exact: true })).toHaveValue(originalObjective);
  await openStep(page, 'Period and scope');
  await expect(page.getByLabel('Scope statement', { exact: true })).toHaveValue(manualScope);
});

test('an uncertain generation retries its original request and an uncertain acceptance blocks submission until reload', async ({ page }, testInfo) => {
  const notes = 'Compare all production parameters with the supplied baseline and retain unresolved differences.';
  const address = page.url();
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
    await writing.getByLabel('Rough notes for Objective', { exact: true }).fill(notes);
    await writing.getByRole('button', { name: 'Prepare draft', exact: true }).click();
    await expect(writing.getByText(/writing response was lost/)).toBeVisible();
    await expect(writing.getByLabel('Rough notes for Objective', { exact: true })).not.toBeEditable();
    await writing.getByRole('button', { name: 'Retry this request', exact: true }).click();
    await expect(writing.getByRole('button', { name: 'Use this draft', exact: true })).toBeEnabled();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(await requestStates()).toEqual(['ready']);

    // A local manual edit is checked at acceptance time, including forced activation.
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
    await testInfo.attach('writing-unknown-acceptance', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(await requestStates()).toEqual(['accepted']);
    await page.unroute(address);
    await page.getByRole('button', { name: 'Reload saved version', exact: true }).click();
    await expect(page.locator('[data-guided-preparation]')).toHaveAttribute('data-guided-ready', 'true');
    await expect(page.getByLabel('Objective', { exact: true })).toHaveValue(notes);
    await expect(page.locator('[data-preparation-progress]')).toContainText('0 of 6 sections reviewed');
  } finally { releaseAcceptance(); await page.unroute(address); }
});
