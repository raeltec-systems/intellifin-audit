import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { performPause } from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  PostgresWaitRepository,
  type Sql,
} from '@intellifin/infrastructure';

import { ESCALATION_PANEL_COPY, PAUSE_COPY } from '../../apps/web/src/design/copy';
import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * Pausing and resuming a Run, in a real browser (Story 5.4, FR-25, AD-16, UX-DR25).
 *
 * The SURFACE half is entirely real: the auditor's own session, the Server Actions, the
 * commands, PostgreSQL, the revision compare-and-set, the durable wake, and the Timeline.
 * The one thing standing in for production is the worker's Tool Action boundary — the
 * journey calls the SAME `performPause` the three stages call, through the same
 * `PostgresWaitRepository`, rather than starting a worker and racing it to a boundary. The
 * boundary itself (which marker it reads, what it supersedes, that the attempt is given
 * back, that a cancellation wins) is proven in `execute-agent-work-item.test.ts`,
 * `execute-agent-steps.test.ts` and `tests/integration/pause-run.test.ts`.
 *
 * Run rows are seeded, the `live-view.spec.ts` pattern: what is under test is the surface,
 * and the checkpoints are the truthful ones of a Run a worker is holding, so a concurrently
 * running worker spec's recovery sweeps cannot claim these Runs out from under it.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
/** Far enough out that no sweep can treat a seeded claim as expired mid-run. */
const LEASE = new Date(Date.now() + 3_600_000).toISOString();

let sql: Sql;
let author = '';
const runs: string[] = [];

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the pause journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the pause journey.');
  author = auditor.id as string;
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
      await sql`DELETE FROM notification WHERE run_id=${runId}`;
      await sql`DELETE FROM run_wait WHERE run_id=${runId}`;
      await sql`DELETE FROM run_result WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
      await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
      await sql`DELETE FROM run_agent_execution WHERE run_id=${runId}`;
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

async function seedRun(state: 'RUNNING' | 'AWAITING_AUDITOR'): Promise<string> {
  const runId = ids.next();
  const at = new Date().toISOString();
  const day = String(runs.length + 1).padStart(2, '0');
  await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
    procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
    VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Pause journey',
    ${`2026-08-${day}`},${`2026-08-${day}`},${state},'STANDARD',${author},'pause-fixture','auditor',${at})`;
  runs.push(runId);
  // The truthful checkpoints of a Run whose worker is holding it.
  await sql`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
    VALUES(${runId},1,'POPULATION_READY',1,${at},${at},${LEASE},'session-1',${ids.next()})`;
  await sql`INSERT INTO run_execution(run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
    VALUES(${runId},1,'EXECUTING',1,${at},${at},${at},${LEASE},${ids.next()})`;
  return runId;
}

/** Exactly what a stage does at its next boundary, through the same repository. */
async function honourPause(runId: string): Promise<string> {
  return new PostgresWaitRepository(createDb(sql)).transaction(runId, async (context) => {
    const run = context.run!;
    const request = run.pauseRequest!;
    await context.saveRunState('PAUSED');
    const wait = await performPause(context as never, {
      run,
      request,
      waitId: ids.next(),
      at: new Date().toISOString(),
    });
    return wait.waitId;
  });
}

test.describe('pausing and resuming a Run', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('holds a Running Run, says who paused it and when it ends, and resumes it', async ({ page }) => {
    test.setTimeout(120_000);
    const runId = await seedRun('RUNNING');

    await page.goto(`/runs/${runId}`);
    await expect(page.getByRole('heading', { name: /^Run · / })).toBeVisible();
    // Every mutating control needs a focus-trapping dialog, which cannot exist without
    // script — so the marker says when the handlers are attached rather than racing them.
    await expect(page.locator('#run-pause')).toHaveAttribute('data-client-ready', 'true');

    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('ends Inconclusive if it is still paused after 30 minutes', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: 'Pause Run', exact: true }).click();

    // The REQUEST succeeded. It never claims the Run is paused: the worker does that.
    await expect(page.getByText(PAUSE_COPY.requested, { exact: true })).toBeVisible();
    const [requested] = await sql`SELECT state, pause_requested_by FROM audit_run WHERE run_id=${runId}`;
    expect(requested).toMatchObject({ state: 'RUNNING', pause_requested_by: author });
    await page.reload();
    await expect(page.getByText(`Pause requested by ${author}`, { exact: false })).toBeVisible();

    // The worker's next Tool Action boundary.
    const waitId = await honourPause(runId);
    const [wait] = await sql`SELECT opened_by, opened_at, deadline FROM run_wait WHERE wait_id=${waitId}`;

    await page.reload();
    // EXPERIENCE.md's Run Detail / Paused banner, with the actor and both instants.
    await expect(page.getByText('Paused by', { exact: false })).toBeVisible();
    await expect(page.getByText('Resumes on your action; ends Inconclusive at', { exact: false })).toBeVisible();
    await expect(page.getByText(author, { exact: false }).first()).toBeVisible();
    // Resume REPLACES Pause on a Paused Run.
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);

    const paused = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(paused.violations).toEqual([]);

    // Live View carries the same control and the same banner.
    await page.goto(`/runs/${runId}/live`);
    await expect(page.getByRole('heading', { name: /^Live View · / })).toBeVisible();
    await expect(page.getByText('Session PAUSED.', { exact: false })).toBeVisible();
    await expect(page.getByText('Paused by', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    const live = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(live.violations).toEqual([]);

    // Resume is DIRECT: EXPERIENCE.md's confirmation table lists pause and not resume.
    await expect(page.locator('#run-pause')).toHaveAttribute('data-client-ready', 'true');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByText(PAUSE_COPY.resumed, { exact: true })).toBeVisible();

    const [resumed] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
    expect(resumed).toMatchObject({ state: 'RUNNING' });
    const [closed] = await sql`SELECT closure_kind, answer_option_id, actor FROM run_wait WHERE wait_id=${waitId}`;
    // `resume`, never `answer`: generation 45 refuses the other pairing outright.
    expect(closed).toMatchObject({ closure_kind: 'resume', answer_option_id: 'resume', actor: author });
    const events = await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${runId} ORDER BY sequence`;
    expect(events.map((row) => row.event_type)).toEqual([
      'lifecycle.run-pause-requested',
      'lifecycle.run-paused',
      'lifecycle.run-resumed',
    ]);
    // The pause is over, so the Run has no open wait and Pause is offered again.
    expect(new Date(wait!.deadline as string).getTime() - new Date(wait!.opened_at as string).getTime()).toBe(30 * 60 * 1000);
    await page.goto(`/runs/${runId}`);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  });

  test('disables Pause on a Run waiting on an answer, and says why in words', async ({ page }) => {
    const runId = await seedRun('AWAITING_AUDITOR');
    await page.goto(`/runs/${runId}`);

    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    // `aria-disabled`, never `disabled`: a disabled element cannot be focused, so its
    // reason would be unreachable by keyboard — the tooltip-only explanation DESIGN.md
    // forbids. The reason is also rendered visibly.
    await expect(pause).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(ESCALATION_PANEL_COPY.pauseUnavailable, { exact: false }).first()).toBeVisible();

    // Refused at the command as well, not only hidden on the surface.
    await pause.click({ force: true });
    const [row] = await sql`SELECT state, pause_requested_at FROM audit_run WHERE run_id=${runId}`;
    expect(row).toMatchObject({ state: 'AWAITING_AUDITOR', pause_requested_at: null });

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
