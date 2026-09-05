import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { derivePlan, initialPlanDerivation, queuePlanDerivation, type ProcedureVersionRecord, type ModelGateway } from '@intellifin/application';
import { deriveExecutablePlan } from '@intellifin/domain';
import { createSqlClient, createDb, createProceduresQueue, startProceduresWorker, DrizzleProcedureRepository, PostgresProceduresUnitOfWork, CryptoUuidV7Generator } from '@intellifin/infrastructure';
import { executablePlanInputs } from '../fixtures/executable-plan';
import { AUTH_STATE, assertThrowawayDatabase } from './accounts';

test.use({ storageState: AUTH_STATE.auditor });
test('queued preview progresses from pending through failure to a read-only accessible plan', async ({ page }) => {
  test.setTimeout(90_000);
  const databaseUrl = process.env['DATABASE_URL']!; assertThrowawayDatabase(databaseUrl);
  const sql = createSqlClient(databaseUrl); const db = createDb(sql); const ids = new CryptoUuidV7Generator();
  const procedureId = ids.next(); const versionId = ids.next(); const queue = createProceduresQueue(db);
  const unitOfWork = new PostgresProceduresUnitOfWork(db);
  const identity = { provider: 'test-provider', modelId: 'demonstration-model', promptVersion: '1' };
  const model = { identity, derive: async (input: Parameters<typeof deriveExecutablePlan>[0]) => { const result = deriveExecutablePlan(input); if (!result.ok) throw new Error(result.reason); return result.plan; } };
  const dependencies = { repository: new DrizzleProcedureRepository(db), unitOfWork, ids, clock: { now: () => new Date() }, model: model as ModelGateway | null };
  try {
    // This dedicated queue is synthetic in the guarded browser-test database. Previous
    // stopped test workers must not leave a backlog that delays this browser journey.
    await sql`DELETE FROM pgboss.job WHERE name = 'procedures'`;
    const row: ProcedureVersionRecord = { ...executablePlanInputs(), ...initialPlanDerivation(identity), procedureId, versionId, versionNumber: 1, state: 'DRAFT', controlName: `E2E executable plan ${versionId}`, sourceSnapshot: null };
    await unitOfWork.execute(async ({ procedures }) => { await procedures.insertProcedure({ procedureId, controlName: row.controlName, templateId: row.templateId }); await procedures.insertVersion(row); });
    await page.goto(`/procedures/${procedureId}/builder`);
    const preview = page.getByTestId('executable-plan-preview');
    await expect(preview).toContainText('Re-deriving');
    await page.getByLabel('New Control name').fill(`E2E queued plan ${versionId}`);
    await page.getByRole('button', { name: 'Save Control name', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save Control name', exact: true }).click();
    await expect.poll(async () => Number((await sql`SELECT count(*) AS n FROM pgboss.job WHERE data->>'versionId' = ${versionId}`)[0]?.['n'])).toBe(1);
    await expect(preview).toContainText('Re-deriving');
    await startProceduresWorker(queue, (job) => derivePlan(dependencies, job));
    await expect(preview).toContainText('Cannot derive: Choose a Population Source.');
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
    dependencies.model = null;
    await unitOfWork.execute(async ({ procedures, derivationJobs }) => {
      const current = (await procedures.findVersionForUpdate(versionId))!;
      await procedures.updateVersion(await queuePlanDerivation({ ...current, sourceSnapshot: executablePlanInputs().sourceSnapshot }, derivationJobs));
    });
    await page.reload();
    await expect(preview).toContainText('The frozen derivation model configuration is unavailable.');
    dependencies.model = model;
    await page.getByRole('button', { name: 'Retry plan derivation', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Queue derivation attempt' }).click();
    await expect(preview).toContainText('Re-derived');
    await expect(preview.getByRole('heading', { name: 'Session Steps', exact: true })).toBeVisible();
    await expect(preview.getByRole('heading', { name: 'Ordered Plan Steps per Target System' })).toBeVisible();
    await expect(preview).toContainText('vault://synthetic/prod');
    await expect(preview).toContainText('Rule-Classified');
    await expect(preview).toContainText('test-provider / demonstration-model');
    await expect(preview.locator('input, textarea, select, button, [contenteditable="true"]')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.getByText('Open on a desktop browser to author or approve.', { exact: true })).toBeVisible();
    await expect(preview).not.toBeVisible();
  } finally {
    await queue.stop();
    await sql`DELETE FROM pgboss.job WHERE data->>'versionId' = ${versionId}`;
    await sql`DELETE FROM procedure WHERE procedure_id = ${procedureId}`;
    await sql.end({ timeout: 5 });
  }
});
