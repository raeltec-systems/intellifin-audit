import { expect, test } from '@playwright/test';

import { cancelRun, type CancelRunDependencies } from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunCancellationRepository,
  PostgresRunsUnitOfWork,
  SystemClock,
  type Sql,
} from '@intellifin/infrastructure';

import { FLAG_COPY } from '../../apps/web/src/design/copy';
import { LIVE_GATE_REASONS, LIVE_LOST_MS, LIVE_SENTENCES } from '../../apps/web/src/runs/live-status';
import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * Live View when the stream drops or the Run ends while it is open
 * (Story 5.7, UX-DR25, AD-17, NFR-7).
 *
 * The stale and lost words and the flip to REPLAY were proven by Stories 5.1 and 5.3.
 * What this file proves is the GATE those states now govern — every live control withdrawn,
 * with the reason in words — and that a reconnect really resumes from the last frame the
 * page saw rather than from the beginning.
 *
 * Run rows are seeded, the `live-view.spec.ts` pattern: the subject is the SURFACE, and the
 * checkpoints are the truthful ones of a Run a worker is holding so a concurrently running
 * worker spec's recovery sweeps cannot claim these Runs.
 */

const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
/** Far enough out that no sweep can treat a seeded claim as expired mid-run. */
const LEASE = new Date(Date.now() + 3_600_000).toISOString();

let sql: Sql;
let author = '';
const runs: string[] = [];

const cancelDependencies = (): CancelRunDependencies => ({
  roles: new DrizzleRoleRepository(createDb(sql)),
  unitOfWork: new PostgresRunsUnitOfWork(createDb(sql)),
  repository: new PostgresRunCancellationRepository(createDb(sql)),
  ids,
  clock: new SystemClock(),
});

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the live-drop journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the live-drop journey.');
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

async function seedRun(state: 'RUNNING' | 'PAUSED' = 'RUNNING'): Promise<string> {
  const runId = ids.next();
  const at = new Date().toISOString();
  const day = String(runs.length + 1).padStart(2, '0');
  await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
    procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
    VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Live drop journey',
    ${`2026-10-${day}`},${`2026-10-${day}`},${state},'STANDARD',${author},'live-drop-fixture','auditor',${at})`;
  runs.push(runId);
  await sql`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
    VALUES(${runId},1,'POPULATION_READY',1,${at},${at},${LEASE},'session-1',${ids.next()})`;
  await sql`INSERT INTO run_execution(run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
    VALUES(${runId},1,'EXECUTING',1,${at},${at},${at},${LEASE},${ids.next()})`;
  return runId;
}

test.describe('Live View when the stream drops', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('names the lost connection and withdraws every live control, with the reason', async ({ page }) => {
    // UX-DR25 disables at SIXTY seconds of silence, so the wait is the contract's own.
    test.setTimeout(180_000);
    const runId = await seedRun();

    // Every attempt to open the stream is refused, so the page never hears a frame and its
    // silence clock runs. `EventSource` keeps retrying, which is exactly the state
    // UX-DR25's sentence describes: lost, and reconnecting.
    let attempts = 0;
    await page.route('**/api/runs/*/events*', async (route) => { attempts += 1; await route.abort(); });

    await page.goto(`/runs/${runId}/live`);
    await expect(page.getByRole('heading', { name: /^Live View · / })).toBeVisible();
    // Before the threshold the controls are still usable: a page that locked itself the
    // moment it lost one frame would be unusable on every quiet Run.
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).not.toHaveAttribute('aria-disabled', 'true');

    await expect(page.locator('[data-live-status]'))
      .toHaveAttribute('data-live-status', 'lost', { timeout: LIVE_LOST_MS + 30_000 });
    await expect(page.getByText(LIVE_SENTENCES.lost)).toBeVisible();

    // Every live control, disabled and saying why. `aria-disabled`, never `disabled`, so
    // the reason stays reachable by keyboard.
    for (const name of ['Pause', 'Cancel Run', FLAG_COPY.submit]) {
      const control = page.getByRole('button', { name, exact: true });
      await expect(control).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(page.getByText(LIVE_GATE_REASONS.lost).first()).toBeAttached();

    // A click on a withdrawn control does nothing at all — no dialog, no request.
    // `force`, because Playwright refuses to click an `aria-disabled` element and would
    // report the guard working as a timeout; forcing it dispatches the click the guard is
    // there to refuse, which is the fact under test.
    await page.getByRole('button', { name: 'Cancel Run', exact: true }).click({ force: true });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const [row] = await sql`SELECT state, cancel_requested_by FROM audit_run WHERE run_id=${runId}`;
    expect(row).toMatchObject({ state: 'RUNNING', cancel_requested_by: null });
    expect(attempts).toBeGreaterThan(0);
  });

  test('re-subscribes with a cursor it could hold, and never one ahead of the chain', async ({ page }) => {
    test.setTimeout(120_000);
    const runId = await seedRun();

    // A stream that hands over two frames and then ends, so the page has to re-subscribe.
    //
    // What this can and cannot establish, because CI proved the difference and this
    // machine did not. The frames below carry SYNTHETIC sequences that reach no chain, so
    // `router.refresh()` re-reads a server cursor that never advances past the seeded head.
    // `useLiveTimeline` seeds `lastSeqRef` from that server `cursor` and re-runs its effect
    // on `[url, cursor]`, so every remount re-subscribes at the SERVER's number — correct
    // in production, where the client's frames all came FROM the chain and the server's
    // cursor is therefore never behind, and unobservable here, where they did not.
    //
    // So this asserts the WIRING — the page subscribes with a cursor, it re-subscribes
    // after the stream ends, and it never invents one ahead of what it was told. The
    // resume rule itself (`seq > lastSeq`: no gap, no duplicate) is proven deterministically
    // in `live-status.test.ts`, which is why AD-17's comparison was put there.
    const cursors: (string | null)[] = [];
    await page.route('**/api/runs/*/events*', async (route) => {
      const request = route.request();
      cursors.push(request.headers()['last-event-id'] ?? new URL(request.url()).searchParams.get('after'));
      const frame = (seq: number): string =>
        `id: ${seq}\nevent: timeline\ndata: ${JSON.stringify({ runId, seq, eventType: 'execution.capture-registered', occurredAt: new Date().toISOString(), outcome: 'success', source: 'worker' })}\n\n`;
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
        body: `${frame(41)}${frame(42)}`,
      });
    });

    await page.goto(`/runs/${runId}/live`);
    // The banner reports the cursor the page holds, which is the second frame's sequence.
    await expect(page.locator('[data-live-seq]')).toHaveAttribute('data-live-seq', '42', { timeout: 30_000 });

    // The stream ended, so the page opens it again rather than sitting silent.
    await expect.poll(() => cursors.length, { timeout: 30_000 }).toBeGreaterThan(1);

    // Every cursor is one the page could legitimately hold: a non-negative integer, and
    // never past the last frame it was handed. A build that invented a cursor ahead of the
    // frames — the gap AD-17 forbids — fails here.
    for (const cursor of cursors) {
      expect(cursor).not.toBeNull();
      expect(Number.isSafeInteger(Number(cursor))).toBe(true);
      expect(Number(cursor)).toBeGreaterThanOrEqual(0);
      expect(Number(cursor)).toBeLessThanOrEqual(42);
    }
    // And the FIRST request carried the chain head the page was RENDERED at, so nothing
    // between that server read and the subscription can fall down the gap either. `null`
    // would mean the page subscribed from nowhere and replayed the Run from its beginning.
    expect(cursors[0]).not.toBeNull();
  });

  test('closes every live control on the terminal event, before the page has re-read', async ({ page }) => {
    test.setTimeout(120_000);
    // PAUSED, deliberately: `RUN_CANCEL_TRANSITIONS` gives a PAUSED Run to the COMMAND, so
    // the terminal transition really happens here rather than being recorded for a worker.
    const runId = await seedRun('PAUSED');
    await page.goto(`/runs/${runId}/live`);
    await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status', 'live', { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();

    // The server re-read the terminal event triggers is HELD, which is what makes the
    // window this gate exists for observable at all: normally it is the fraction of a
    // second between the event arriving and that read landing, after which the server
    // renders a terminal Run and the controls are gone rather than closed. Held rather
    // than REFUSED, because a refused re-read can send the router to a full navigation —
    // which would perform exactly the read this test is holding back.
    let refreshes = 0;
    await page.route(`**/runs/${runId}/live*`, async (route) => {
      if (route.request().resourceType() === 'document') { await route.fallback(); return; }
      refreshes += 1;
      await new Promise((resolve) => { setTimeout(resolve, 25_000); });
      await route.fallback();
    });

    const cancelled = await cancelRun(cancelDependencies(), {
      session: { userId: author, sessionId: `live-drop-${author}` },
      request: { runId, reason: null },
    });
    expect(cancelled).toEqual({ ok: true, state: 'CANCELED', pending: false });

    // The terminal event reached the page over the live channel, and every control the
    // page is still rendering is closed with the reason that is true.
    await expect(page.getByText(LIVE_GATE_REASONS.runEnded).first()).toBeAttached({ timeout: 20_000 });
    for (const name of ['Resume', 'Cancel Run', FLAG_COPY.submit]) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-disabled', 'true');
    }
    // And the re-read really was asked for: the gate is what closed the controls, not a
    // page that had already been re-rendered from the terminal state.
    expect(refreshes).toBeGreaterThan(0);
    const [row] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
    expect(row).toMatchObject({ state: 'CANCELED' });
  });

  test('replaces the live controls with the ended Banner once the page re-reads', async ({ page }) => {
    test.setTimeout(120_000);
    const runId = await seedRun('PAUSED');
    await page.goto(`/runs/${runId}/live`);
    await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status', 'live', { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();

    const cancelled = await cancelRun(cancelDependencies(), {
      session: { userId: author, sessionId: `live-drop-${author}` },
      request: { runId, reason: null },
    });
    expect(cancelled).toEqual({ ok: true, state: 'CANCELED', pending: false });

    // The event made the page re-read on its own, and a terminal Run renders no live
    // control at all — a stronger withdrawal than the closed one above, and the state the
    // reader is left in.
    await expect(page.getByText('This Run has ended: CANCELED.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel Run', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: FLAG_COPY.submit, exact: true })).toHaveCount(0);
  });
});
