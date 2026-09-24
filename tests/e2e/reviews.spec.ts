import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { deriveExecutablePlan } from '@intellifin/domain';
import {
  initialPlanDerivation,
  planAuthoringDigest,
  procedureVersionRowVersion,
  transitionVersion,
  type ProcedureVersionRecord,
} from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleProcedureRepository,
  DrizzleRoleRepository,
  PostgresProceduresUnitOfWork,
  type Sql,
} from '@intellifin/infrastructure';

import { executablePlanInputs } from '../fixtures/executable-plan';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase, mintAuditManager, signIn, type MintedAuditManager } from './accounts';
import {
  OPEN_RESULT,
  OPEN_VERSION_REVIEW,
  PROCEDURES_TAB_AUDITOR_HEADING,
  PROCEDURES_TAB_HEADING,
  RESULT_REVIEW_MANAGER_NOTE,
  RESULT_REVIEW_UNAVAILABLE_TITLE,
} from '../../apps/web/src/review/review-words';

/**
 * Reviews — the two queues that were, until this cleanup, one unconditional empty state
 * (UI cleanup 2026-09-22, UX-30, UX-35, UX-36).
 *
 * `ReviewQueues.test.ts` proves each panel in isolation from a fixture; what only a
 * browser can prove is that TWO different auditors' submitted versions are not the same
 * list to an auditor and are the whole queue to a manager, and that the Results tab
 * states an unavailable capability truthfully instead of as an empty queue.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const stamp = `${Date.now()}`;

const ids = new CryptoUuidV7Generator();
const ownProcedureId = ids.next();
const ownVersionId = ids.next();
const foreignProcedureId = ids.next();
const foreignVersionId = ids.next();
const foreignAuthorId = `reviews-e2e-${ids.next()}`;
const ownControlName = `E2E Reviews own ${stamp}`;
const foreignControlName = `E2E Reviews foreign ${stamp}`;

const runId = ids.next();
const runProcedureId = ids.next();
const runVersionId = ids.next();
const runControlName = `E2E Reviews pending Result ${stamp}`;

let sql: Sql;
let manager: MintedAuditManager | undefined;
let auditorId: string;

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

/** A DRAFT version by `authorId`, submitted and left SUBMITTED. */
async function submittedVersion(
  db: ReturnType<typeof createDb>,
  procedureId: string,
  versionId: string,
  controlName: string,
  authorId: string,
): Promise<void> {
  const inputs = { ...executablePlanInputs(), controlName };
  const plan = deriveExecutablePlan(inputs);
  if (!plan.ok) throw new Error(plan.reason);
  let row: ProcedureVersionRecord = {
    ...inputs, ...initialPlanDerivation(), procedureId, versionId, versionNumber: 1,
    state: 'DRAFT', compiledPlan: plan.plan, planStatus: 'succeeded', planDerivable: true,
    authorship: { createdBy: { type: 'human', id: authorId }, responsibleAuthorId: authorId, humanAuthorIds: [authorId] },
  };
  row = { ...row, planInputDigest: planAuthoringDigest(row) };
  const unitOfWork = new PostgresProceduresUnitOfWork(db);
  await unitOfWork.execute(async (context) => {
    await context.procedures.insertProcedure(row);
    await context.procedures.insertVersion(row);
  });
  const outcome = await transitionVersion(
    { roles: new DrizzleRoleRepository(db), unitOfWork, ids },
    {
      procedureId, versionId, expectedRowVersion: procedureVersionRowVersion(row),
      session: { userId: authorId, sessionId: `reviews-fixture-${authorId}` }, correlationId: ids.next(),
    },
    'submit',
  );
  if (!outcome.ok) throw new Error(`Reviews fixture submit (${controlName}): ${outcome.reason}`);
  const saved = await new DrizzleProcedureRepository(db).findVersion(versionId);
  if (!saved) throw new Error('Reviews fixture version was not readable after submit.');
  expect(saved.state).toBe('SUBMITTED');
}

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Reviews journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 2 });
  manager = await mintAuditManager(sql, 'reviews');
  const db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the Reviews journey.');
  auditorId = String(auditor.id);

  await sql`INSERT INTO auth_user(id,name,email,email_verified)
            VALUES (${foreignAuthorId},'Synthetic Reviews foreign auditor',${`${foreignAuthorId}@example.test`},true)`;
  await sql`INSERT INTO user_role(user_id,role) VALUES (${foreignAuthorId},'auditor')`;

  await submittedVersion(db, ownProcedureId, ownVersionId, ownControlName, auditorId);
  await submittedVersion(db, foreignProcedureId, foreignVersionId, foreignControlName, foreignAuthorId);

  // A Run whose Result is unsealed and waiting for a decision — the Results tab's own
  // queue, distinct from the Procedures tab's version-approval queue.
  const runInputs = { ...executablePlanInputs(), controlName: runControlName };
  const runPlan = deriveExecutablePlan(runInputs);
  if (!runPlan.ok) throw new Error(runPlan.reason);
  let runRow: ProcedureVersionRecord = {
    ...runInputs, ...initialPlanDerivation(), procedureId: runProcedureId, versionId: runVersionId,
    versionNumber: 1, state: 'DRAFT', compiledPlan: runPlan.plan, planStatus: 'succeeded', planDerivable: true,
    authorship: { createdBy: { type: 'human', id: auditorId }, responsibleAuthorId: auditorId, humanAuthorIds: [auditorId] },
  };
  runRow = { ...runRow, planInputDigest: planAuthoringDigest(runRow) };
  await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
    await context.procedures.insertProcedure(runRow);
    await context.procedures.insertVersion(runRow);
  });
  await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,
              period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
            VALUES(${ids.next()},${runId},${ids.next()},${runProcedureId},${runVersionId},1,${runControlName},
              '2026-09-01','2026-09-15','QUEUED','STANDARD',${auditorId},'reviews-e2e-fixture','auditor',now())`;
  await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
            VALUES(${runId},'SEALED','COMPLETED',now(),0,0,'[]'::jsonb,'[]'::jsonb)`;
  await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
            VALUES(${runId},1,'PENDING_CONFIRMATION','pending-confirmation',false,'COMPLETED',true,now(),NULL,'{}'::jsonb)`;
  // Generations 21 and 25 refuse a terminal Run with no package or Result, and each
  // statement here commits on its own — so the Run is inserted QUEUED and made COMPLETED
  // only once both rows exist, the order `stoppedAtAcquisition` in runs.spec.ts uses.
  await sql`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${runId}`;
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM run_result WHERE run_id=${runId}`;
    await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
    await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
    // A submission notifies every Audit Manager and that row names the version with a
    // real foreign key, so the notifications go before the versions they name.
    await sql`DELETE FROM notification WHERE procedure_id IN (${ownProcedureId},${foreignProcedureId},${runProcedureId})`;
    for (const procedureId of [ownProcedureId, foreignProcedureId, runProcedureId]) {
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
    }
    await sql`DELETE FROM auth_user WHERE id=${foreignAuthorId}`;
  } finally {
    await manager?.remove();
    await sql.end({ timeout: 5 });
  }
});

test.describe('Reviews — Procedures, as the Auditor who submitted one of the two', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('sees only their own submitted version, waiting for an Audit Manager', async ({ page }) => {
    await page.goto('/review');
    await expect(page.getByRole('heading', { name: 'Reviews', level: 1 })).toBeVisible();
    // The sidebar link lands on Procedures; the Results tab is one click away.
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByRole('link', { name: 'Results' })).toHaveAttribute('href', '/review/results');

    await expect(page.getByRole('heading', { name: PROCEDURES_TAB_AUDITOR_HEADING })).toBeVisible();
    await expect(page.getByRole('heading', { name: PROCEDURES_TAB_HEADING })).toHaveCount(0);
    await expect(page.getByText(ownControlName)).toBeVisible();
    await expect(page.getByText(foreignControlName)).toHaveCount(0);
    await expect(page.getByRole('link', { name: OPEN_VERSION_REVIEW, exact: true }).first()).toHaveAttribute(
      'href',
      `/procedures/${ownProcedureId}/versions/${ownVersionId}`,
    );

    await scan(page);
  });
});

test.describe('Reviews as an Audit Manager', () => {
  test('sees the whole queue, and the Results tab states what is not available', async ({ page }) => {
    if (manager === undefined) throw new Error('The spec did not mint its Audit Manager: read the FIRST failure in this run.');
    await signIn(page, manager.email);

    await page.goto('/review');
    await expect(page.getByRole('heading', { name: PROCEDURES_TAB_HEADING })).toBeVisible();
    // A manager decides, so BOTH auditors' submitted work is on the one queue.
    await expect(page.getByText(ownControlName)).toBeVisible();
    await expect(page.getByText(foreignControlName)).toBeVisible();

    await page.getByRole('link', { name: 'Results' }).click();
    await expect(page).toHaveURL(/\/review\/results$/);
    // Stated PLAINLY, as a Banner — never as an ordinary empty queue that reads as "nothing
    // is happening" when the truth is "this cannot be sent to you at all".
    await expect(page.getByText(RESULT_REVIEW_UNAVAILABLE_TITLE)).toBeVisible();
    await expect(page.getByText(RESULT_REVIEW_MANAGER_NOTE)).toBeVisible();
    // The one thing a person really can do here: confirm the agent's own assessments.
    await expect(page.getByText(runControlName)).toBeVisible();
    // Scoped to THIS Run's row: other suites' pending Results may share the page.
    const openResult = page.locator(`a[href="/runs/${runId}"]`).filter({ hasText: OPEN_RESULT });
    await expect(openResult).toHaveCount(1);

    await scan(page);

    // FOLLOWED, not only read: both queues once linked `/runs/{id}/result`, which is no
    // route, and an assertion on the `href` alone agreed with the component that wrote it.
    await openResult.click();
    await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(runControlName);
  });
});
