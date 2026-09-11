import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  type Sql,
} from '@intellifin/infrastructure';

import { FLAG_COPY } from '../../apps/web/src/design/copy';
import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * Flagging a Run to the Audit Managers, and cancelling it, from Live View
 * (Story 5.5, FR-27, FR-28, UX-DR24).
 *
 * The whole path is real: the auditor's own session, the form, the Server Action, the
 * command, PostgreSQL, the notification rows and the inbox. Run rows are seeded the
 * `live-view.spec.ts` way — what is under test is the surface, and the checkpoints are the
 * truthful ones of a Run a worker is holding, so a concurrently running worker spec's
 * recovery sweeps cannot claim these Runs out from under it.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
/** Far enough out that no sweep can treat a seeded claim as expired mid-run. */
const LEASE = new Date(Date.now() + 3_600_000).toISOString();

let sql: Sql;
let author = '';
/** The auditor's own display name, read from the row rather than from a copy of a default. */
let authorName = '';
const runs: string[] = [];

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the flag journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  const [auditor] = await sql`SELECT id, name FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the flag journey.');
  author = auditor.id as string;
  authorName = auditor.name as string;
  const version = activeRunVersion(procedureId, versionId, author);
  await new PostgresProceduresUnitOfWork(createDb(sql)).execute(async (context) => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    for (const runId of runs) {
      await sql`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
      // Notification rows point AT the flag, so they go first whatever the cascade says.
      await sql`DELETE FROM notification WHERE run_id=${runId}`;
      await sql`DELETE FROM run_flag WHERE run_id=${runId}`;
      await sql`DELETE FROM run_result WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
      await sql`DELETE FROM run_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM population_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM run_initiation_request WHERE run_id=${runId} OR refused_run_id=${runId}`;
    }
    await sql`DELETE FROM audit_run WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

async function seedRun(state: 'RUNNING' | 'QUEUED' = 'RUNNING'): Promise<string> {
  const runId = ids.next();
  const at = new Date().toISOString();
  const day = String(runs.length + 1).padStart(2, '0');
  await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
    procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
    VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Flag journey',
    ${`2026-09-${day}`},${`2026-09-${day}`},${state},'STANDARD',${author},'flag-fixture','auditor',${at})`;
  runs.push(runId);
  if (state === 'RUNNING') {
    await sql`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
      VALUES(${runId},1,'POPULATION_READY',1,${at},${at},${LEASE},'session-1',${ids.next()})`;
    await sql`INSERT INTO run_execution(run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
      VALUES(${runId},1,'EXECUTING',1,${at},${at},${at},${LEASE},${ids.next()})`;
  }
  return runId;
}

test.describe('flagging a Run from Live View', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('flags a Running Run with a note, notifies, and changes nothing about the Run', async ({ page }) => {
    test.setTimeout(120_000);
    const runId = await seedRun();
    const [before] = await sql`SELECT * FROM audit_run WHERE run_id=${runId}`;

    await page.goto(`/runs/${runId}/live`);
    await expect(page.getByRole('heading', { name: /^Live View · / })).toBeVisible();
    const panel = page.locator('#run-flag');
    await expect(panel.getByRole('heading', { name: FLAG_COPY.heading })).toBeVisible();
    // The sentence an auditor needs before pressing it.
    await expect(panel.getByText(FLAG_COPY.explanation)).toBeVisible();
    await expect(panel.getByText(FLAG_COPY.none)).toBeVisible();

    await panel.getByLabel(FLAG_COPY.noteLabel).fill('The LoanCore step looks wrong.');
    await panel.getByRole('button', { name: FLAG_COPY.submit }).click();

    await expect(page.getByText(FLAG_COPY.raised, { exact: true })).toBeVisible();
    // The message never claims the Run changed, because it did not.
    await expect(page.getByText(FLAG_COPY.raisedBody)).toBeVisible();
    await expect(panel.getByText('The LoanCore step looks wrong.')).toBeVisible();
    // The actor is a NAME, not the opaque user id the row stores.
    await expect(panel.getByText(`Flagged by ${authorName}`, { exact: false })).toBeVisible();
    await expect(panel.getByText(author, { exact: false })).toHaveCount(0);

    const [flag] = await sql`SELECT * FROM run_flag WHERE run_id=${runId}`;
    expect(flag).toMatchObject({ flagged_by: author, note: 'The LoanCore step looks wrong.' });
    const notifications = await sql`SELECT kind, recipient_id, flag_id FROM notification WHERE run_id=${runId}`;
    expect(notifications).toEqual([{ kind: 'flag', recipient_id: author, flag_id: flag!.flag_id }]);
    // The note is on the Run and in no notification row.
    expect(JSON.stringify(notifications)).not.toContain('LoanCore');

    // The whole Run row is untouched, revision included.
    const [after] = await sql`SELECT * FROM audit_run WHERE run_id=${runId}`;
    expect(after).toEqual(before);

    const scan = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(scan.violations).toEqual([]);
  });

  test('submits the flag with JavaScript disabled', async ({ browser }) => {
    test.setTimeout(120_000);
    const runId = await seedRun();
    // The standing rule: JavaScript may enhance a control, never be its only path. Flag is
    // the one control on this surface that can honour it, because EXPERIENCE.md's
    // confirmation table does not list flagging and it therefore needs no dialog.
    const context = await browser.newContext({ storageState: AUTH_STATE.auditor, javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.goto(`/runs/${runId}/live`);
      await page.getByLabel(FLAG_COPY.noteLabel).fill('Typed without script.');
      await page.getByRole('button', { name: FLAG_COPY.submit }).click();
      await expect(page.getByText(FLAG_COPY.raised, { exact: true })).toBeVisible();
      const [flag] = await sql`SELECT note FROM run_flag WHERE run_id=${runId}`;
      expect(flag).toEqual({ note: 'Typed without script.' });
    } finally {
      await context.close();
    }
  });

  test('flags once and only once when the acknowledgement is lost in transit', async ({ page }) => {
    test.setTimeout(120_000);
    const runId = await seedRun();
    await page.goto(`/runs/${runId}/live`);
    const panel = page.locator('#run-flag');
    await expect(panel.getByRole('heading', { name: FLAG_COPY.heading })).toBeVisible();

    // Commit the Server Action, then drop its acknowledgement — the `runs.spec.ts`
    // pattern. A flag deliberately carries NO request token (`flagId` is minted per
    // call), so a second submission would write a second `run_flag` row and a second
    // full fan-out of notifications to every Audit Manager.
    const liveUrl = page.url().split('#')[0]!;
    await page.route(liveUrl, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch();
      await route.abort('failed');
    });
    await panel.getByLabel(FLAG_COPY.noteLabel).fill('The response will be lost.');
    await panel.getByRole('button', { name: FLAG_COPY.submit }).click();

    // The form's action IS the Server Action (that is what makes this the one control
    // that works without JavaScript), so a lost RSC response is not something the
    // component can catch: the surface fails closed to the route error boundary, taking
    // the submit control with it. Which is a STRONGER withdrawal than a disabled button
    // — there is nothing left to press — and it is why the retry cannot happen here.
    // The withdrawal the component owns is for the case the action itself reports, and
    // that is asserted in `RunFlagControl.test.ts`.
    await expect(page.getByRole('heading', { name: 'This page could not be loaded' })).toBeVisible();
    await expect(page.getByRole('button', { name: FLAG_COPY.submit })).toHaveCount(0);
    await page.unroute(liveUrl);

    // The flag committed once and exactly once, notifications included.
    const flags = await sql`SELECT note FROM run_flag WHERE run_id=${runId}`;
    expect(flags).toEqual([{ note: 'The response will be lost.' }]);
    const notifications = await sql`SELECT kind FROM notification WHERE run_id=${runId}`;
    expect(notifications).toEqual([{ kind: 'flag' }]);
  });

  test('offers no flag form on a Queued Run, and says so rather than showing nothing', async ({ page }) => {
    const runId = await seedRun('QUEUED');
    await page.goto(`/runs/${runId}/live`);
    const panel = page.locator('#run-flag');
    await expect(panel.getByRole('heading', { name: FLAG_COPY.heading })).toBeVisible();
    await expect(panel.getByRole('button', { name: FLAG_COPY.submit })).toHaveCount(0);
    await expect(panel.getByText(FLAG_COPY.none)).toBeVisible();
  });

  test('shows a flagged Run in the inbox with no countdown, and drops it when the Run ends', async ({ page }) => {
    test.setTimeout(120_000);
    const runId = await seedRun();
    await page.goto(`/runs/${runId}/live`);
    await page.getByLabel(FLAG_COPY.noteLabel).fill('Look at this one.');
    await page.getByRole('button', { name: FLAG_COPY.submit }).click();
    await expect(page.getByText(FLAG_COPY.raised, { exact: true })).toBeVisible();

    await page.goto('/notifications');
    // Scoped to THIS Run. Earlier cases in this file flag Runs that are still active, so
    // an unqualified match counts theirs too — the failure that reads as a duplicate and
    // is a locator that named a state rather than a subject.
    const item = page.getByRole('listitem')
      .filter({ hasText: 'flagged for an Audit Manager' })
      .filter({ hasText: runId });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(`Flagged by ${authorName}`);
    // A flag has no deadline; a countdown here would be a fact nobody measured.
    await expect(item).not.toContainText('Time remaining');
    await expect(item.getByRole('link')).toHaveAttribute('href', `/runs/${runId}/live`);

    // The Run ends. Nothing else ever closes a flag, so this is what stops it needing
    // attention. Two statements, because the deferred trigger fires at the end of the
    // second and postgres.js autocommits each one.
    await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
      VALUES(${runId},'SEALED','INCONCLUSIVE',now(),0,0,'[]'::jsonb,'[]'::jsonb)`;
    await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
      VALUES(${runId},1,'INCONCLUSIVE','gate-failed',true,'INCONCLUSIVE',false,now(),NULL,'{}'::jsonb)`;
    await sql`UPDATE audit_run SET state='INCONCLUSIVE' WHERE run_id=${runId}`;

    await page.goto('/notifications');
    await expect(page.getByRole('listitem')
      .filter({ hasText: 'flagged for an Audit Manager' })
      .filter({ hasText: runId })).toHaveCount(0);
  });

  test('cancels a Running Run from Live View, through the same control Run Detail carries', async ({ page }) => {
    test.setTimeout(120_000);
    const runId = await seedRun();
    await page.goto(`/runs/${runId}/live`);
    // Cancel needs a focus-trapping dialog, which cannot exist without script, so the
    // marker says when the handlers are attached rather than racing them.
    await expect(page.locator('#run-cancel')).toHaveAttribute('data-client-ready', 'true');

    await page.getByRole('button', { name: 'Cancel Run', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Evidence already collected is preserved', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel Run', exact: true }).click();

    // A RUNNING Run is held by a worker, so the COMMAND only records the request.
    await expect(page.getByText('Cancellation requested.', { exact: true })).toBeVisible();
    const [row] = await sql`SELECT state, cancel_requested_by FROM audit_run WHERE run_id=${runId}`;
    expect(row).toMatchObject({ state: 'RUNNING', cancel_requested_by: author });
  });
});
