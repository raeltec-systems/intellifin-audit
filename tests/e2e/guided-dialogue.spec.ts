import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { bindingDigest, registrationDigest, deriveExecutablePlan, draftContext, sectionReview } from '@intellifin/domain';
import { derivePlan, planAuthoringDigest } from '@intellifin/application';
import { createDb, createSqlClient, CryptoUuidV7Generator, DrizzleProcedureRepository, PostgresProceduresUnitOfWork, type Sql } from '@intellifin/infrastructure';
import { AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { attachAuthoringScreenshot } from './builder';

test.use({ storageState: AUTH_STATE.auditor });
test.skip(process.env['PLAYWRIGHT_BASE_URL'] !== undefined, 'This journey requires the isolated synthetic authoring transport and throwaway database.');

const ids = new CryptoUuidV7Generator();
let sql: Sql;
let sourceId = '', targetId = '', procedureId = '', versionId = '';
const scopeAnswer = 'Every production parameter in the approved baseline. Do not sample; retain unresolved comparisons.';
const roughAnswer = 'Synthetic test: Compare every baseline parameter in ProdConsole with the approved baseline. Keep evidence and flag values that cannot be read.';
const workingDraft = '1. Read every baseline parameter in ProdConsole.\n2. Compare observed values with the approved baseline.\n3. Add a separate summary by owner.\n4. Leave missing values unresolved.\nHuman note: preserve exact parameter names.';
const correction = 'Keep steps 1 and 2 exactly. Drop the summary by owner. Enhance unresolved handling: record why a value could not be read.';
const acceptedSteps = '1. Read every baseline parameter in ProdConsole.\n2. Compare observed values with the approved baseline.\n3. Leave missing or unreadable values unresolved and record the reason.\nHuman note: preserve exact parameter names.';

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('The guided journey requires the throwaway database.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 2 });
  sourceId = ids.next(); targetId = ids.next();
  // Administration owns these catalogues. Seed only two valid synthetic catalogue
  // entries; the auditor creates and prepares the actual procedure through the UI.
  const source = { kind: 'versioned-file' as const, location: 'https://synthetic.invalid/population.csv', declaredSchema: ['parameter'], declaredCountMechanism: 'cover-sheet' as const, sensitiveFields: [] };
  const target = { kind: 'web' as const, allowedOrigins: ['https://synthetic.invalid'], applicationIdentity: '', credentialRef: 'vault://synthetic/prod', permittedActions: ['navigate', 'read-attribute'] as const, attributeLabelPatterns: ['Parameter'], secondaryKey: '' };
  await sql`INSERT INTO population_source_binding (binding_id, display_name, kind, location, declared_schema, declared_count_mechanism, sensitive_fields, note, status, digest)
    VALUES (${sourceId}, 'Baseline', ${source.kind}, ${source.location}, ${source.declaredSchema}, ${source.declaredCountMechanism}, ${source.sensitiveFields}, '', 'active', ${bindingDigest(source)})`;
  await sql`INSERT INTO target_system_registration (registration_id, display_name, kind, allowed_origins, application_identity, credential_ref, permitted_actions, attribute_label_patterns, secondary_key, note, status, digest)
    VALUES (${targetId}, 'ProdConsole', ${target.kind}, ${target.allowedOrigins}, ${target.applicationIdentity}, ${target.credentialRef}, ${target.permittedActions}, ${target.attributeLabelPatterns}, ${target.secondaryKey}, '', 'active', ${registrationDigest(target)})`;
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    if (versionId) await sql`DELETE FROM pgboss.job WHERE data->>'versionId' = ${versionId}`;
    if (procedureId) {
      await sql`DELETE FROM notification WHERE procedure_id = ${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id = ${procedureId}`;
    }
    if (targetId) await sql`DELETE FROM target_system_registration WHERE registration_id = ${targetId}`;
    if (sourceId) await sql`DELETE FROM population_source_binding WHERE binding_id = ${sourceId}`;
  } finally { await sql.end({ timeout: 5 }); }
});

async function chooseSection(page: Page, section: string) {
  await expect(page.locator('[data-guided-ready="true"]')).toBeVisible();
  await page.locator(`[data-preparation-nav="${section}"]`).click();
  await expect(page.locator(`[data-preparation-panel="${section}"]`)).toBeVisible();
}

test('a fresh Template leads through choices, a precise test-design reply, saved review and the actual compiled plan', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/procedures/new');
  await page.getByLabel('Template', { exact: true }).selectOption('P-4');
  const controlName = `Synthetic production configuration review ${ids.next()}`;
  await page.getByLabel('Control name', { exact: true }).fill(controlName);
  await page.getByRole('button', { name: 'Create Procedure', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create Procedure', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: controlName })).toBeVisible();
  procedureId = /\/procedures\/([^/]+)\/builder/.exec(page.url())![1]!;
  const [created] = await sql<{ version_id: string }[]>`SELECT version_id FROM procedure_version WHERE procedure_id = ${procedureId} AND state = 'DRAFT' ORDER BY version_number DESC LIMIT 1`;
  versionId = created!.version_id;
  const uow = new PostgresProceduresUnitOfWork(createDb(sql));
  const saved = async () => uow.execute(({ procedures }) => procedures.findVersion(versionId));
  const original = (await saved())!;
  await expect(page.locator('[data-guided-ready="true"]')).toBeVisible();
  const context = page.locator('[data-preparation-panel="context"]');
  await expect(context.locator('[data-control-confirmation]')).toContainText(draftContext(original.sections).control!);
  await expect(context.getByLabel('Risk', { exact: true })).toBeHidden();
  await expect(context.getByLabel('Objective', { exact: true })).toBeHidden();
  await expect(context.getByRole('button', { name: 'Help Me Write', exact: true })).toBeHidden();
  await attachAuthoringScreenshot(page, testInfo, 'fresh-dialogue-control');
  await context.getByRole('button', { name: 'Yes, use this control', exact: true }).click();
  await expect(page.locator('[data-preparation-nav="scope"]')).toHaveAttribute('aria-current', 'step');
  expect(draftContext((await saved())!.sections)).toEqual(draftContext(original.sections));
  expect(sectionReview((await saved())!, 'context')).not.toBeNull();

  const scope = page.locator('[data-preparation-panel="scope"]');
  const scopeWriting = scope.locator('[data-writing-section="scope"]');
  await expect(scope.getByLabel('Period start', { exact: true })).toBeHidden();
  await scopeWriting.getByLabel('Your answer', { exact: true }).fill(scopeAnswer);
  await attachAuthoringScreenshot(page, testInfo, 'fresh-dialogue-scope');
  await scopeWriting.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(scopeWriting.getByRole('button', { name: 'Use this draft', exact: true })).toBeEnabled();
  expect((await saved())!.scope).toBe('');
  expect(sectionReview((await saved())!, 'scope')).toBeNull();
  await scopeWriting.getByRole('button', { name: 'Use this draft', exact: true }).click();
  await expect(scope.getByLabel('Period start', { exact: true })).toBeVisible();
  await expect(scope.getByLabel('Scope statement', { exact: true })).toHaveValue(scopeAnswer);
  await expect(scope.getByLabel('Scope statement', { exact: true })).toBeHidden();
  await scope.getByLabel('Period start', { exact: true }).fill('2026-08-01');
  await scope.getByLabel('Period end', { exact: true }).fill('2026-08-31');
  await scope.getByRole('button', { name: 'Save Period and scope', exact: true }).click();
  await expect(scope.locator('[data-guide-question="confirm"]')).toContainText('2026-08-01 to 2026-08-31');

  await chooseSection(page, 'evidence');
  const evidence = page.locator('[data-preparation-panel="evidence"]');
  await evidence.getByLabel('Where the records come from', { exact: true }).selectOption(sourceId);
  await evidence.getByRole('button', { name: 'Save records to test', exact: true }).click();
  await expect(evidence.getByLabel('Add a system', { exact: true })).toBeVisible();
  await evidence.getByLabel('Add a system', { exact: true }).selectOption(targetId);
  await evidence.getByRole('button', { name: 'Add Target System', exact: true }).click();
  await attachAuthoringScreenshot(page, testInfo, 'fresh-dialogue-systems');
  await evidence.getByRole('button', { name: 'Save Target Systems', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save Target Systems', exact: true }).click();
  await expect(page.getByText('Target systems saved. Next, choose the proof to retain.', { exact: true })).toBeVisible();
  await evidence.getByRole('button', { name: 'Save Evidence Requirements', exact: true }).click();
  await expect(evidence.locator('[data-guide-question="confirm"]')).toBeVisible();
  await expect(evidence.locator('[data-guide-question="confirm"]')).toContainText('ProdConsole');

  await chooseSection(page, 'instructions');
  const steps = page.locator('[data-preparation-panel="instructions"]');
  const writing = steps.locator(`[data-writing-section="instructions:${targetId}"]`);
  const manualSteps = steps.getByLabel('What the agent should do in ProdConsole', { exact: true });
  await expect(manualSteps).toBeHidden();
  await expect(manualSteps).toHaveValue('');
  await writing.getByLabel('Your answer', { exact: true }).fill(roughAnswer);
  await writing.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(writing.locator('[data-current-assistant-response]')).toContainText('Add a separate summary by owner.');
  expect((await saved())!.instructions.every(instruction => instruction.text === '')).toBe(true);
  expect(sectionReview((await saved())!, 'instructions')).toBeNull();
  await writing.getByRole('button', { name: 'Edit', exact: true }).click();
  await writing.getByLabel('Edit proposed replacement', { exact: true }).fill(workingDraft);
  await writing.getByLabel('Your reply', { exact: true }).fill(correction);
  await writing.getByRole('button', { name: 'Update draft', exact: true }).click();
  const response = writing.locator('[data-current-assistant-response]');
  await expect(response).toContainText(acceptedSteps);
  await expect(response).not.toContainText('Add a separate summary by owner.');
  await expect(writing.getByRole('list', { name: 'Earlier proposals and your corrections' })).toContainText(correction);
  await expect(writing.getByLabel('Your reply', { exact: true })).toHaveValue('');
  const receipts = await sql<{ record: { revision?: { draft: string; feedback: string } } }[]>`SELECT record FROM procedure_authoring_request WHERE version_id = ${versionId} ORDER BY created_at`;
  expect(receipts.at(-1)!.record.revision).toMatchObject({ draft: workingDraft, feedback: correction });
  await attachAuthoringScreenshot(page, testInfo, 'fresh-dialogue-revision');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await attachAuthoringScreenshot(page, testInfo, 'fresh-dialogue-mobile');
  await writing.getByRole('button', { name: 'Use this draft', exact: true }).click();
  await expect(manualSteps).toHaveValue(acceptedSteps);
  expect(sectionReview((await saved())!, 'instructions')).toBeNull();
  await steps.getByRole('button', { name: 'Mark reviewed and continue', exact: true }).click();
  await expect(page.locator('[data-preparation-nav="instructions"] [data-preparation-status]')).toHaveAttribute('data-preparation-status', 'reviewed');

  await chooseSection(page, 'frequency');
  await page.getByLabel('Frequency', { exact: true }).selectOption('once');
  await page.getByLabel('Start time (UTC)', { exact: true }).fill('00:00');
  await page.getByRole('button', { name: 'Save Schedule', exact: true }).click();
  await expect(page.getByText('Saved. The Schedule is recorded in the audit chain.', { exact: true })).toBeVisible();
  // Invoke the real compiler worker use case and audited PostgreSQL writer. Its
  // existing plan-check port is an explicitly synthetic fixture, not a live model.
  // Never inject a compiledPlan into the row or bypass the derivation command.
  const beforeCompile = (await saved())!;
  expect(beforeCompile.derivationModel).toEqual({ provider: 'anthropic', modelId: 'synthetic-http-fixture', promptVersion: '1' });
  expect(beforeCompile.planStatus).toBe('pending');
  const compiled = await derivePlan({ unitOfWork: uow, repository: new DrizzleProcedureRepository(createDb(sql)), clock: { now: () => new Date() }, ids,
    model: { identity: beforeCompile.derivationModel!, derive: async (inputs, compilerVersion) => {
      const result = deriveExecutablePlan(inputs, compilerVersion);
      if (!result.ok) throw new Error(result.reason);
      return result.plan;
    } },
  }, { schemaVersion: 1, versionId, inputDigest: planAuthoringDigest(beforeCompile) });
  expect(compiled).toEqual({ ok: true, outcome: 'success' });
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const section of ['context', 'scope', 'evidence', 'instructions', 'assessment', 'frequency']) {
    await chooseSection(page, section);
    const panel = page.locator(`[data-preparation-panel="${section}"]`);
    await panel.getByRole('button', { name: section === 'context' ? 'Yes, use this control' : 'Mark reviewed and continue', exact: true }).click();
    await expect(page.locator(`[data-preparation-nav="${section}"] [data-preparation-status]`)).toHaveAttribute('data-preparation-status', 'reviewed');
  }
  await expect(page.locator('[data-preparation-progress]')).toContainText('6 of 6 sections reviewed');
  const preview = page.getByTestId('executable-plan-preview');
  await expect(preview).toContainText(acceptedSteps);
  await expect(preview.getByRole('heading', { name: 'C1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit for approval', exact: true })).toBeEnabled();
  const complete = (await saved())!;
  expect(complete.state).toBe('DRAFT');
  expect(complete.scope).toBe(scopeAnswer);
  expect(complete.instructions).toEqual([{ registrationId: targetId, text: acceptedSteps }]);
  expect(draftContext(complete.sections).criterionReference).toBeNull();
  expect(complete.compiledPlan!.inputs.instructions).toEqual(complete.instructions);
  expect(complete.compiledPlan!.inputs.schedule?.frequency).toBe('once');
  await attachAuthoringScreenshot(page, testInfo, 'fresh-dialogue-plan');
});
