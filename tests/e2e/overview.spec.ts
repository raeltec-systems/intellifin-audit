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
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase, signIn } from './accounts';
import {
  ADMIN_ENVIRONMENT_HEADING,
  ADMIN_OVERVIEW_HEADING,
  MANAGER_RESULT_REVIEW_NOTE,
  MY_DRAFTS_HEADING,
  OVERVIEW_NOT_YOUR_SUMMARY,
  REVIEWS_LINK,
} from '../../apps/web/src/overview/overview-words';

/**
 * The Overview as each role's home (UI cleanup 2026-09-22, UX-01, UX-37, role landing).
 *
 * `AttentionList.test.ts` proves the ORDERING algorithm and `RoleLanding.test.ts` proves
 * each component in isolation; what only a browser can prove is that a real signed-in
 * person, of each of the three roles, meets the right page — an Auditor's own Draft
 * before anything else, an Audit Manager's approval queue leading their attention list
 * with the half of their work this release does not have said plainly, and a PoC
 * Administrator's administration summary with no refusal in sight.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const stamp = `${Date.now()}`;

const ids = new CryptoUuidV7Generator();
const draftProcedureId = ids.next();
const draftVersionId = ids.next();
const submittedProcedureId = ids.next();
const submittedVersionId = ids.next();
const draftControlName = `E2E Overview draft ${stamp}`;
const submittedControlName = `E2E Overview submitted ${stamp}`;

let sql: Sql;
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

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Overview journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 2 });
  const db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the Overview journey.');
  auditorId = String(auditor.id);

  const unitOfWork = new PostgresProceduresUnitOfWork(db);
  const repository = new DrizzleProcedureRepository(db);

  // One Draft, left exactly there — the "carry on where you left off" case.
  const draftInputs = { ...executablePlanInputs(), controlName: draftControlName };
  const draftPlan = deriveExecutablePlan(draftInputs);
  if (!draftPlan.ok) throw new Error(draftPlan.reason);
  let draftRow: ProcedureVersionRecord = {
    ...draftInputs, ...initialPlanDerivation(), procedureId: draftProcedureId, versionId: draftVersionId,
    versionNumber: 1, state: 'DRAFT', compiledPlan: draftPlan.plan, planStatus: 'succeeded', planDerivable: true,
    authorship: { createdBy: { type: 'human', id: auditorId }, responsibleAuthorId: auditorId, humanAuthorIds: [auditorId] },
  };
  draftRow = { ...draftRow, planInputDigest: planAuthoringDigest(draftRow) };
  await unitOfWork.execute(async (context) => {
    await context.procedures.insertProcedure(draftRow);
    await context.procedures.insertVersion(draftRow);
  });

  // One version SUBMITTED and left there, unapproved — the Manager's queue and the
  // Reviews Procedures tab both read this same row.
  const submittedInputs = { ...executablePlanInputs(), controlName: submittedControlName };
  const submittedPlan = deriveExecutablePlan(submittedInputs);
  if (!submittedPlan.ok) throw new Error(submittedPlan.reason);
  let submittedRow: ProcedureVersionRecord = {
    ...submittedInputs, ...initialPlanDerivation(), procedureId: submittedProcedureId, versionId: submittedVersionId,
    versionNumber: 1, state: 'DRAFT', compiledPlan: submittedPlan.plan, planStatus: 'succeeded', planDerivable: true,
    authorship: { createdBy: { type: 'human', id: auditorId }, responsibleAuthorId: auditorId, humanAuthorIds: [auditorId] },
  };
  submittedRow = { ...submittedRow, planInputDigest: planAuthoringDigest(submittedRow) };
  await unitOfWork.execute(async (context) => {
    await context.procedures.insertProcedure(submittedRow);
    await context.procedures.insertVersion(submittedRow);
  });
  const outcome = await transitionVersion(
    { roles: new DrizzleRoleRepository(db), unitOfWork, ids },
    {
      procedureId: submittedProcedureId, versionId: submittedVersionId,
      expectedRowVersion: procedureVersionRowVersion(submittedRow),
      session: { userId: auditorId, sessionId: `overview-fixture-${auditorId}` }, correlationId: ids.next(),
    },
    'submit',
  );
  if (!outcome.ok) throw new Error(`Overview fixture submit: ${outcome.reason}`);
  const saved = await repository.findVersion(submittedVersionId);
  if (!saved) throw new Error('Overview fixture version was not readable after submit.');
  expect(saved.state).toBe('SUBMITTED');
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    for (const procedureId of [draftProcedureId, submittedProcedureId]) {
      // Submitting notifies every Audit Manager, and that row names the version with a
      // real foreign key — so it goes first, or the whole teardown throws.
      await sql`DELETE FROM notification WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test.describe('the Overview as an Auditor', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('leads with the Auditor’s own Drafts, before Needs attention', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
    // "Your audit work and the items that need your attention." (UI cleanup lede).
    await expect(page.getByText('Your audit work and the items that need your attention.')).toBeVisible();

    const drafts = page.getByRole('heading', { name: MY_DRAFTS_HEADING });
    const attention = page.getByRole('heading', { name: 'Needs attention' });
    await expect(drafts).toBeVisible();
    await expect(attention).toBeVisible();
    // MyDrafts is FIRST: its heading's bounding box sits above Needs attention's.
    const draftsBox = await drafts.boundingBox();
    const attentionBox = await attention.boundingBox();
    expect(draftsBox).not.toBeNull();
    expect(attentionBox).not.toBeNull();
    expect(draftsBox!.y).toBeLessThan(attentionBox!.y);

    const draftsSection = page.getByRole('region', { name: MY_DRAFTS_HEADING });
    await expect(draftsSection.getByRole('link', { name: draftControlName })).toHaveAttribute(
      'href',
      `/procedures/${draftProcedureId}`,
    );
    // Read-only for this role: no version-approval queue is asked for on an Auditor's own
    // home, so the version this fixture submitted does not appear here (it appears on
    // Reviews instead, under "Your versions waiting for an Audit Manager").
    await expect(page.getByRole('heading', { name: MANAGER_RESULT_REVIEW_NOTE, exact: false })).toHaveCount(0);

    await scan(page);
  });
});

test.describe('the Overview as an Audit Manager', () => {
  test('leads the attention list with Procedure Versions awaiting approval', async ({ page }) => {
    // Required, never skipped: a skipped manager journey would read as a passed one.
    const managerEmail = process.env['E2E_MANAGER_EMAIL'];
    if (!managerEmail) throw new Error('E2E_MANAGER_EMAIL is required for the Overview manager journey.');
    await signIn(page, managerEmail);

    const attention = page.getByRole('region', { name: 'Needs attention' });
    await expect(attention).toBeVisible();
    await expect(attention).toContainText(submittedControlName);
    await expect(attention).toContainText('Submitted for review');
    // No Auditor-only Drafts section on a Manager's home.
    await expect(page.getByRole('heading', { name: MY_DRAFTS_HEADING })).toHaveCount(0);

    // The version item is the FIRST item in the attention list for this role
    // (`MANAGER_ATTENTION_ORDER`): its own list item sits above every other kind this
    // fixture did not also seed, which the ordering unit tests prove in general — this is
    // the same rule read off a real, signed-in Manager's own page.
    const items = attention.locator('li.ls-attention__item');
    await expect(items.first()).toContainText(submittedControlName);

    // The half of a Manager's work this release does not have, said out loud rather than
    // silently absent (owner finding: a manager not told this reads an approvals queue as
    // the whole of their responsibility).
    await expect(page.getByText(MANAGER_RESULT_REVIEW_NOTE, { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: REVIEWS_LINK })).toHaveAttribute('href', '/review');

    await scan(page);
  });
});

test.describe('the Overview as a PoC Administrator', () => {
  test.use({ storageState: AUTH_STATE.administrator });

  test('lands on an administration summary, never a refusal', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
    // `[REPAIRED]` They used to meet a Banner saying the summary was for other people.
    await expect(page.getByText(OVERVIEW_NOT_YOUR_SUMMARY)).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);

    await expect(page.getByRole('heading', { name: ADMIN_OVERVIEW_HEADING })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/administration');
    await expect(page.getByRole('link', { name: 'Population sources' })).toHaveAttribute(
      'href',
      '/administration/sources',
    );
    await expect(page.getByRole('link', { name: 'Systems' })).toHaveAttribute(
      'href',
      '/administration/registrations',
    );
    await expect(page.getByRole('heading', { name: ADMIN_ENVIRONMENT_HEADING })).toBeVisible();
    // No Run or Review fact is on this page at all — not hidden, never READ.
    await expect(page.getByRole('heading', { name: 'Needs attention' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recent Runs' })).toHaveCount(0);

    await scan(page);
  });
});
