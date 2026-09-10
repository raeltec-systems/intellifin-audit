import { expect, test, type Locator, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createSqlClient, CryptoUuidV7Generator, type Sql } from '@intellifin/infrastructure';

import { startSyntheticS3 } from '../fixtures/s3-server';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase, signIn } from './accounts';
import {
  CREDENTIAL_TOKENS,
  EXCEPTION_FINGERPRINT_KEY,
  EXCEPTION_FINGERPRINT_KEY_ID,
} from './credentials';
import { openStep, openPlanDetail } from './builder';

/**
 * The journey a person actually walks: create a Procedure, get it approved, run it, read
 * what it found — every step through the interface, with nothing seeded behind it.
 *
 * Each half of this is already proven somewhere. `hero-workflow.spec.ts` authors a P-1
 * Draft up to Submit and stops there because no worker runs in it; `version-review.spec.ts`
 * drives submit → reject → edit → approve; `clean-source.spec.ts` runs a P-2 Procedure to
 * a sealed Result from a version it INSERTS. Nothing joined them, and the seam is exactly
 * where the deployment was broken: `procedure.version.approve` belongs to an Audit Manager
 * alone and is denied to the version's own author, so a deployment holding one auditor and
 * one administrator cannot approve anything — and no suite could notice, because every
 * suite that approves mints its own audit-manager by raw SQL first.
 *
 * P-2 is the Template this walks because it needs no browser: AccessGate is an API, so the
 * Run is the Adapter path and a deployment with no `SOLARI_API_KEY` executes it in full.
 */

const ids = new CryptoUuidV7Generator();
const STAMP = Date.now();
const CONTROL = `Owner walkthrough ${STAMP}`;
const SCOPE = 'Every active AccessGate account for August 2026.';
const MANAGER_ID = `walkthrough-manager-${STAMP}`;
const MANAGER_EMAIL = `${MANAGER_ID}@example.test`;

let sql: Sql | undefined;
let storage: Awaited<ReturnType<typeof startSyntheticS3>> | undefined;
let stopWorker: (() => Promise<void>) | undefined;
let workerLog = '';
let procedureId = '';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: AUTH_STATE.auditor });

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });

  // The Audit Manager this journey needs. Its password hash is copied from the seeded
  // auditor's credential row rather than read into a payload, which is how
  // `version-review.spec.ts` does it: the value never enters this process.
  await sql`INSERT INTO auth_user(id,name,email,email_verified) VALUES (${MANAGER_ID},'Walkthrough Audit Manager',${MANAGER_EMAIL},true)`;
  await sql`INSERT INTO auth_account(id,issuer,account_id,provider_id,user_id,password)
    SELECT ${ids.next()},issuer,${MANAGER_ID},provider_id,${MANAGER_ID},password FROM auth_account
    WHERE user_id = (SELECT id FROM auth_user WHERE email = ${ACCOUNTS.auditor.email}) AND provider_id = 'credential'`;
  await sql`INSERT INTO user_role(user_id,role) VALUES (${MANAGER_ID},'audit-manager')`;

  storage = await startSyntheticS3();
  // The model identity a version freezes comes from the WEB, and `playwright.config.ts`
  // gives its server `anthropic` / `synthetic-http-fixture` — so the worker that derives
  // the plan has to hold the same identity and the fixture that answers for it, exactly
  // as `version-review.spec.ts` does. A worker with no model configured reports the
  // frozen one as unavailable and the Draft never becomes submittable.
  const worker = spawn(process.execPath, [
    '--import', pathToFileURL(resolve('tests/fixtures/anthropic-worker-preload.mjs')).href,
    resolve('apps/worker/dist/main.js'),
  ], {
    cwd: process.cwd(),
    windowsHide: true,
    env: {
      ...process.env, ...storage.env, SERVICE_NAME: 'worker',
      MODEL_PROVIDER: 'anthropic', MODEL_ID: 'synthetic-http-fixture',
      MODEL_PROMPT_VERSION: '1', MODEL_API_KEY: 'isolated-synthetic-http-fixture',
      MODEL_MAX_OUTPUT_TOKENS: '65536',
      CREDENTIAL_TOKENS, EXCEPTION_FINGERPRINT_KEY, EXCEPTION_FINGERPRINT_KEY_ID,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let failure: string | null = null;
  worker.on('error', error => { failure = error.name; });
  const exited = new Promise<void>(done => worker.once('close', code => {
    if (code !== null && code !== 0) failure = `Worker exited ${String(code)}`;
    done();
  }));
  worker.stdout.on('data', data => { workerLog += String(data); });
  worker.stderr.on('data', data => { workerLog += String(data); });
  stopWorker = async () => { worker.kill('SIGTERM'); await exited; };
  await expect.poll(() => {
    if (failure) throw new Error(`${failure}: ${workerLog}`);
    return workerLog.includes('Heartbeat loop started');
  }, { timeout: 60_000 }).toBe(true);
});

test.afterAll(async () => {
  await stopWorker?.();
  await storage?.close();
  if (!sql) return;
  try {
    if (procedureId) {
      const runs = await sql<{ run_id: string }[]>`SELECT run_id FROM audit_run WHERE procedure_id = ${procedureId}`;
      const runIds = runs.map(row => row.run_id);
      if (runIds.length) {
        // Children first, deepest first. Only eight of `audit_run`'s thirty-odd children
        // cascade; the rest record an OUTCOME and refuse to be removed silently, which is
        // correct and makes this list the price. A teardown that does not know about one
        // table throws, and then EVERY row this file created survives and some unrelated
        // file's empty-list assertion fails for a reason that is not its own.
        for (const table of [
          'run_observation_absence', 'run_observation_check', 'run_observation_evaluation', 'run_observation',
          'run_agent_work', 'run_agent_turn', 'run_agent_execution',
          'run_evidence_capture', 'run_tool_action', 'run_step_execution', 'run_work_item', 'run_session_step',
          'run_evaluation_review_command', 'run_evaluation_review',
          'notification', 'run_wait',
          'run_gate_check', 'run_evidence_integrity', 'run_result', 'run_evidence_package',
          'run_evidence', 'population_evidence', 'population_row', 'population_snapshot',
          'population_execution', 'run_execution', 'run_initiation_request',
        ]) {
          // Every one of these carries `run_id` — `population_row`'s IS its foreign key
          // to the snapshot, which does not cascade either.
          await sql`DELETE FROM ${sql(table)} WHERE run_id = ANY(${runIds}::uuid[])`;
        }
        await sql`DELETE FROM run_initiation_request WHERE procedure_id = ${procedureId}`;
        await sql`DELETE FROM audit_run WHERE run_id = ANY(${runIds}::uuid[]) AND predecessor_run_id IS NOT NULL`;
        await sql`DELETE FROM audit_run WHERE run_id = ANY(${runIds}::uuid[])`;
      }
      // Submitted/approved notices name the VERSION, so they go before it.
      await sql`DELETE FROM notification WHERE procedure_id = ${procedureId}`;
      await sql`DELETE FROM procedure_succession WHERE procedure_id = ${procedureId}`;
      await sql`DELETE FROM procedure_version WHERE procedure_id = ${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id = ${procedureId}`;
    }
    await sql`DELETE FROM notification WHERE recipient_id = ${MANAGER_ID}`;
    await sql`DELETE FROM user_role WHERE user_id = ${MANAGER_ID}`;
    await sql`DELETE FROM auth_session WHERE user_id = ${MANAGER_ID}`;
    await sql`DELETE FROM auth_account WHERE user_id = ${MANAGER_ID}`;
    await sql`DELETE FROM auth_user WHERE id = ${MANAGER_ID}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

/** Choose the one option in a native select whose visible label matches. */
async function chooseOption(select: Locator, pattern: RegExp): Promise<string> {
  const labels = await select.locator('option').allTextContents();
  const values = await select.locator('option').evaluateAll(
    (nodes) => nodes.map((node) => (node as HTMLOptionElement).value),
  );
  const matches = labels
    .map((label, index) => ({ label, value: values[index] ?? '' }))
    .filter((option) => pattern.test(option.label) && option.value !== '');
  expect(matches, `no option matched ${String(pattern)} in [${labels.join(' | ')}]`).toHaveLength(1);
  await select.selectOption(matches[0]!.value);
  return matches[0]!.label;
}

/**
 * Save one Builder step the way the surface asks a person to.
 *
 * Every save carries the row version the page was rendered with, and creating a Procedure
 * immediately queues a plan derivation whose attempt record lands on that same row within
 * a second or two. A save made before the Builder's own poll has caught up is therefore
 * refused with "That procedure changed since this page was loaded" — the optimistic guard
 * working, and the sentence names its own remedy. A person filling three fields takes
 * longer than the first poll and rarely meets it; a browser filling them in 300ms meets it
 * every time, so this does what the sentence says: reload, redo, save.
 */
const STALE = 'That procedure changed since this page was loaded. Reload the page and try again.';

async function step(
  page: Page,
  heading: string,
  fill: () => Promise<void>,
  save: () => Promise<void>,
  saved: string | RegExp,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openStep(page, heading);
    await fill();
    await save();
    const ok = page.getByText(saved).first();
    const stale = page.getByText(STALE).first();
    await expect(ok.or(stale).first()).toBeVisible();
    if (await ok.isVisible()) return;
    await page.reload();
  }
  throw new Error(`${heading} would not save: the row version kept moving underneath it.`);
}

/** Confirm a control that keeps its focus-trapping dialog. */
async function confirmed(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('an auditor creates a Procedure, a manager approves it, and the Run reports what it found', async ({ page, browser, baseURL }) => {
  test.setTimeout(360_000);

  /* ------------------------------------------------------------ 1. create --- */
  await page.goto('/procedures/new');
  await page.getByLabel('Template').selectOption('P-2');
  await page.getByLabel('Control name').fill(CONTROL);
  await confirmed(page, 'Create Procedure');
  await expect(page.getByRole('heading', { level: 1, name: CONTROL })).toBeVisible();
  procedureId = new URL(page.url()).pathname.split('/')[2] ?? '';
  expect(procedureId).not.toBe('');

  /* ------------------------------------------------- 2. Period and scope ---- */
  await step(page, 'Period and scope', async () => {
    await page.getByLabel('Period start', { exact: true }).fill('2026-08-01');
    await page.getByLabel('Period end', { exact: true }).fill('2026-08-31');
    await page.getByLabel('Scope statement').fill(SCOPE);
  }, async () => {
    await page.getByRole('button', { name: 'Save Period and scope', exact: true }).click();
  }, 'Saved. The Draft change is recorded in the audit chain.');

  /* ------------------------------------------------- 3. records to test ----- */
  await step(page, 'Population Source binding', async () => {
    await chooseOption(page.getByLabel('Where the records come from'), /AccessGate active accounts/);
  }, async () => {
    await page.getByRole('button', { name: 'Save records to test', exact: true }).click();
  }, 'Saved. The Draft change is recorded in the audit chain.');

  /* ------------------------------------------------- 4. systems to check ---- */
  // Adding a system WIDENS scope, so this one save keeps its confirmation. The Template
  // suggests AccessGate and nothing adds it for you.
  await step(page, 'Target System selection', async () => {
    await expect(page.locator('[data-suggested-target="AccessGate"]')).toContainText('ready to add below.');
    await chooseOption(page.getByLabel('Add a system'), /^AccessGate \(/);
    await page.getByRole('button', { name: 'Add Target System', exact: true }).click();
  }, async () => {
    await confirmed(page, 'Save Target Systems');
  }, /Saved\. The Target System selection is recorded/);

  /* ------------------------------------------------------- 5. Schedule ------ */
  // P-2 names no Schedule, so it starts unset — and activation requires one.
  await step(page, 'Schedule', async () => {
    await page.getByLabel('Frequency').selectOption('monthly');
    // P-1 arrives with 00:00 already here because its Template pins a Schedule. P-2 names
    // none, so the field is EMPTY and the save refuses until it is filled — the one step
    // on this Template a person has to discover from an error message.
    await page.getByLabel('Start time (UTC)').fill('00:00');
  }, async () => {
    await page.getByRole('button', { name: 'Save Schedule', exact: true }).click();
  }, 'Saved. The Schedule is recorded in the audit chain.');

  /* --------------------------------------------- 6. the plan derives -------- */
  const submit = page.getByRole('button', { name: 'Submit for approval', exact: true });
  // The BLOCKER, not just the fact: "Submit is disabled" names nothing a reader can act
  // on, and the surface already states the reason beside the control — so a failure here
  // reports the sentence the auditor would have read.
  let blocker = '(not read)';
  const available = await expect.poll(async () => {
    await page.reload();
    blocker = await submit.getAttribute('aria-disabled') === 'true'
      ? await submit.evaluate((node) => {
          const id = node.getAttribute('aria-describedby')?.split(' ')[0];
          return (id ? document.getElementById(id)?.textContent : null) ?? '(no reason given)';
        })
      : '';
    return submit.getAttribute('aria-disabled');
  }, { timeout: 120_000, intervals: [3_000] }).toBeNull().then(() => true, (error: unknown) => {
    throw new Error(`Submit stayed unavailable. It says: "${blocker}"\nWorker log:\n${workerLog}\n${String(error)}`);
  });
  expect(available).toBe(true);
  await openPlanDetail(page);

  /* ----------------------------------------------------------- 7. submit ---- */
  await confirmed(page, 'Submit for approval');
  await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
  const reviewUrl = page.url();

  // The author is refused, by name, on the surface.
  await expect(page.getByRole('button', { name: 'Approve', exact: true }))
    .toHaveAccessibleDescription(/You cannot approve a version you authored\./);

  /* ---------------------------------------------------------- 8. approve ---- */
  const managerContext = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const manager = await managerContext.newPage();
  try {
    await signIn(manager, MANAGER_EMAIL);
    await manager.goto('/notifications');
    await expect(manager.getByRole('link', { name: /Procedure Version submitted/ }).filter({ hasText: CONTROL }))
      .toBeVisible({ timeout: 20_000 });
    await manager.goto(reviewUrl);
    await confirmed(manager, 'Approve');
    await expect(manager.getByText('Active', { exact: true }).first()).toBeVisible();
  } finally {
    await managerContext.close();
  }

  /* ------------------------------------------------------- 9. run it -------- */
  await page.goto(`/procedures/${procedureId}`);
  await expect(page.getByRole('heading', { name: 'Initiate Run' })).toBeVisible();
  await page.getByLabel('Period from').fill('2026-08-01');
  await page.getByLabel('Period to').fill('2026-08-31');
  await confirmed(page, 'Initiate Run');
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}/, { timeout: 20_000 });
  const runId = new URL(page.url()).pathname.split('/')[2] ?? '';
  expect(runId).not.toBe('');

  /* ---------------------------------------------------- 10. read the output - */
  const terminal = await expect.poll(async () => {
    const rows = await sql!<{ state: string }[]>`SELECT state FROM audit_run WHERE run_id = ${runId}::uuid`;
    return rows[0]?.state ?? '';
  }, { timeout: 240_000, intervals: [2_000], message: `Run never finished. Worker log:\n${workerLog}` })
    .toMatch(/^(COMPLETED|INCONCLUSIVE|RUN_FAILED|CANCELED)$/);
  void terminal;

  const [result] = await sql!<{ outcome: string; sealed: boolean; gate_passed: boolean; scope: string }[]>`
    SELECT outcome, sealed, gate_passed, scope FROM run_result WHERE run_id = ${runId}::uuid`;
  const failed = await sql!<{ check_name: string; diagnostics: unknown }[]>`
    SELECT check_name, diagnostics FROM run_gate_check
    WHERE run_id = ${runId}::uuid AND outcome <> 'PASS' ORDER BY check_name`;
  const observations = await sql!<{ n: number }[]>`
    SELECT count(*)::int AS n FROM run_observation o
    JOIN run_work_item w ON w.work_item_id = o.work_item_id WHERE w.run_id = ${runId}::uuid`;

  // Recorded rather than asserted to a single value: what P-2 concludes over the golden
  // AccessGate population is Inconclusive by construction (a duplicate Source key), and
  // this file's subject is that the JOURNEY reaches a sealed Result at all.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    runId, procedureId,
    outcome: result?.outcome, sealed: result?.sealed, gatePassed: result?.gate_passed,
    failedGateChecks: failed.map(row => ({ check: row.check_name, diagnostics: row.diagnostics })),
    observations: observations[0]?.n,
  }, null, 2));

  // The Run reached a SEALED Result with an outcome from the §E.1 vocabulary. Which one
  // is the golden population's business, not this file's: `population.spec.ts` owns that
  // and reaches Inconclusive on the duplicate AccessGate key, by construction.
  expect(result?.sealed).toBe(true);
  expect(result?.outcome).toMatch(/^[A-Z_]+$/);
  expect(result?.scope).toBe(SCOPE);
  // The Result is the Run's own page, and it prints the auditor's scope sentence
  // VERBATIM (Story 3.9) — which is what makes the output theirs and not the platform's.
  await page.goto(`/runs/${runId}`);
  await expect(page.getByText(SCOPE)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
