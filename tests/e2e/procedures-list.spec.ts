import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { deriveExecutablePlan } from '@intellifin/domain';
import { initialPlanDerivation, planAuthoringDigest, type ProcedureVersionRecord } from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  type Sql,
} from '@intellifin/infrastructure';

import { executablePlanInputs } from '../fixtures/executable-plan';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { OWNER_LABEL, SEARCH_LABEL, STATE_LABEL } from '../../apps/web/src/procedures/list/procedures-list-words';

/**
 * The Procedures list, searchable and filtered (UI cleanup 2026-09-22, UX-03, UX-04).
 *
 * `ProcedureList.test.ts` proves the reader and `procedures-list-words.test.ts` proves
 * the sentences; what only a browser can prove is that the `<form method="get">` a
 * reader actually submits narrows the real page, survives a reload, and works with no
 * JavaScript at all — which is the whole reason it is a GET rather than the product's
 * ordinary POST.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const stamp = `${Date.now()}`;

const ids = new CryptoUuidV7Generator();
const procedureIds = { p1: ids.next(), p2: ids.next() };
const versionIds = { p1: ids.next(), p2: ids.next() };
const controlNames = {
  p1: `E2E Filter needle ${stamp}`,
  p2: `E2E Filter haystack ${stamp}`,
};

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

async function draftFor(
  db: ReturnType<typeof createDb>,
  procedureId: string,
  versionId: string,
  controlName: string,
  authorId: string,
): Promise<void> {
  // The shared fixture compiles exactly one Template (P-4); overriding `templateId` on it
  // leaves inputs that belong to another Template and `deriveExecutablePlan` refuses them.
  // The two Drafts differ by NAME, which is what the search below narrows on.
  const inputs = { ...executablePlanInputs(), controlName };
  const plan = deriveExecutablePlan(inputs);
  if (!plan.ok) throw new Error(plan.reason);
  let row: ProcedureVersionRecord = {
    ...inputs, ...initialPlanDerivation(), procedureId, versionId, versionNumber: 1,
    state: 'DRAFT', compiledPlan: plan.plan, planStatus: 'succeeded', planDerivable: true,
    authorship: { createdBy: { type: 'human', id: authorId }, responsibleAuthorId: authorId, humanAuthorIds: [authorId] },
  };
  row = { ...row, planInputDigest: planAuthoringDigest(row) };
  await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
    await context.procedures.insertProcedure(row);
    await context.procedures.insertVersion(row);
  });
}

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Procedures list journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 2 });
  const db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the Procedures list journey.');
  auditorId = String(auditor.id);

  // Two Drafts deliberately sharing no word except "E2E Filter", so a search for one is
  // never a search that also matches the other by accident.
  await draftFor(db, procedureIds.p1, versionIds.p1, controlNames.p1, auditorId);
  await draftFor(db, procedureIds.p2, versionIds.p2, controlNames.p2, auditorId);
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    for (const procedureId of Object.values(procedureIds)) {
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test.describe('the Procedures list as an Auditor', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('the search box narrows to a name and survives a reload of the URL it produced', async ({ page }) => {
    await page.goto('/procedures');
    await expect(page.getByText(controlNames.p1)).toBeVisible();
    await expect(page.getByText(controlNames.p2)).toBeVisible();

    await page.getByLabel(SEARCH_LABEL, { exact: true }).fill('needle');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    // A GET form: the search term is a real query parameter, not client state.
    await expect(page).toHaveURL(/[?&]q=needle/);
    await expect(page.getByText(controlNames.p1)).toBeVisible();
    await expect(page.getByText(controlNames.p2)).toHaveCount(0);
    await expect(page.getByLabel(SEARCH_LABEL, { exact: true })).toHaveValue('needle');

    // The URL the form produced is bookmarkable and survives a reload with no state lost.
    await page.reload();
    await expect(page.getByText(controlNames.p1)).toBeVisible();
    await expect(page.getByLabel(SEARCH_LABEL, { exact: true })).toHaveValue('needle');

    await page.getByRole('link', { name: 'Clear', exact: true }).click();
    await expect(page).toHaveURL(/\/procedures$/);
    await expect(page.getByText(controlNames.p2)).toBeVisible();
  });

  test('the status and owner filters combine with the search to narrow to one Procedure', async ({ page }) => {
    await page.goto('/procedures');
    await page.getByLabel(STATE_LABEL, { exact: true }).selectOption('DRAFT');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page).toHaveURL(/[?&]state=DRAFT/);
    await expect(page.getByText(controlNames.p1)).toBeVisible();
    await expect(page.getByText(controlNames.p2)).toBeVisible();

    await page.getByLabel(OWNER_LABEL, { exact: true }).selectOption(auditorId);
    await page.getByLabel(SEARCH_LABEL, { exact: true }).fill('needle');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page).toHaveURL(/[?&]owner=/);
    await expect(page).toHaveURL(/[?&]state=DRAFT/);
    // All three filters together, and only ONE of these two fixtures matches every one:
    // the state and owner both match the haystack Draft as well, so only the search
    // narrows to the needle alone.
    await expect(page.getByText(controlNames.p1)).toBeVisible();
    await expect(page.getByText(controlNames.p2)).toHaveCount(0);

    await scan(page);
  });
});

test.describe('the Procedures filter with no JavaScript', () => {
  test.use({ storageState: AUTH_STATE.auditor, javaScriptEnabled: false });

  test('is a native GET submission that mutates nothing', async ({ page }) => {
    await page.goto('/procedures');
    await page.getByLabel(SEARCH_LABEL, { exact: true }).fill('haystack');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page).toHaveURL(/[?&]q=haystack/);
    await expect(page.getByText(controlNames.p2)).toBeVisible();
    await expect(page.getByText(controlNames.p1)).toHaveCount(0);
  });
});
