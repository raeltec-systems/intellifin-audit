import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { cancelRun, type CancelRunDependencies } from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresAuditUnitOfWork,
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
    // The flag form opens from a disclosure in the page header (UI cleanup 2026-09-22,
    // UX-48); a role locator does not see a control inside a closed one.
    await page.locator('#run-flag > summary').click();
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

  test('keeps a lost stream gated while another Run ends and the server cursor advances', async ({ page }) => {
    test.setTimeout(180_000);
    const runId = await seedRun();
    const otherRun = await seedRun('PAUSED');
    let recover = false;
    let attempts = 0;
    await page.route(`**/api/runs/${runId}/events*`, async route => {
      attempts += 1;
      if (!recover) { await route.abort(); return; }
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' },
        body: 'event: heartbeat\ndata: {}\n\n' });
    });
    await page.goto(`/runs/${runId}/live`);
    const status = page.locator('[data-live-status]');
    await expect(status).toHaveAttribute('data-live-status', 'lost', { timeout: LIVE_LOST_MS + 30_000 });
    await page.locator('#run-flag > summary').click();
    // Observe every status mutation, not merely the final value after the re-read.
    await status.evaluate(node => {
      const observed: string[] = [];
      Object.assign(window, { story108Status: observed, story108Document: 'same-document' });
      new MutationObserver(records => {
        for (const record of records) if (record.type === 'attributes') observed.push(node.getAttribute('data-live-status') ?? 'missing');
      }).observe(node, { attributes: true, attributeFilter: ['data-live-status'] });
    });
    // This real append advances the server cursor, but this Run's stream is still blocked.
    await new PostgresAuditUnitOfWork(createDb(sql)).execute(async context => {
      await context.auditEvents.append({ actor: { type: 'system', id: 'live-drop-proof' },
        eventType: 'security.denied', source: 'web', outcome: 'denied', aggregateId: runId,
        sessionId: 'live-drop-proof', correlationId: ids.next(), payload: {} });
    });
    const attemptsBefore = attempts;
    const read = page.waitForResponse(response => response.url().includes(`/runs/${runId}/live`)
      && response.request().resourceType() !== 'document' && response.ok());
    void read.catch(() => undefined);
    const cancelled = await cancelRun(cancelDependencies(), {
      session: { userId: author, sessionId: `live-drop-${author}` }, request: { runId: otherRun, reason: null },
    });
    expect(cancelled).toEqual({ ok: true, state: 'CANCELED', pending: false });
    await read;
    await expect.poll(() => attempts).toBeGreaterThan(attemptsBefore);
    await expect(status).toHaveAttribute('data-live-status', 'lost');
    await expect(page.getByText(LIVE_SENTENCES.lost)).toBeVisible();
    for (const name of ['Pause', 'Cancel Run', FLAG_COPY.submit]) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-disabled', 'true');
    }
    expect(await page.evaluate(() => Reflect.get(window, 'story108Document'))).toBe('same-document');
    expect(await page.evaluate(() => Reflect.get(window, 'story108Status'))).toEqual([]);
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(scan.violations).toEqual([]);
    // Navigate through the application's links to remove and recreate the live gate.
    // The document stays mounted, but this must be a different gate DOM node/subscription.
    await status.evaluate(node => { Reflect.set(window, 'story108OldGate', node); });
    const beforeRemount = attempts;
    await page.getByRole('link', { name: 'Open Run Detail', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
    await page.getByRole('link', { name: 'Watch', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/runs/${runId}/live$`));
    await expect.poll(() => attempts).toBeGreaterThan(beforeRemount);
    expect(await status.evaluate(node => node === Reflect.get(window, 'story108OldGate'))).toBe(false);
    expect(await page.evaluate(() => Reflect.get(window, 'story108Document'))).toBe('same-document');
    await expect(status).toHaveAttribute('data-live-status', 'lost');
    await expect(page.getByText(LIVE_SENTENCES.lost)).toBeVisible();
    if (!await page.locator('#run-flag').evaluate(node => (node as HTMLDetailsElement).open)) {
      await page.locator('#run-flag > summary').click();
    }
    for (const name of ['Pause', 'Cancel Run', FLAG_COPY.submit]) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-disabled', 'true');
    }
    // Opening a transport alone never recovers it; this response contains a heartbeat.
    recover = true;
    await expect(status).toHaveAttribute('data-live-status', 'live', { timeout: 20_000 });
    for (const name of ['Pause', 'Cancel Run', FLAG_COPY.submit]) {
      await expect(page.getByRole('button', { name, exact: true })).not.toHaveAttribute('aria-disabled', 'true');
    }
  });

  test('retains a terminal event across a real gate remount over an active server snapshot', async ({ page }) => {
    test.setTimeout(90_000);
    const runId = await seedRun();
    let sendTerminal = false;
    let sentTerminal = false;
    let attempts = 0;
    await page.route(`**/api/runs/${runId}/events*`, async route => {
      attempts += 1;
      const terminal = sendTerminal && !sentTerminal;
      sentTerminal ||= terminal;
      // Keep the server snapshot active to isolate the race: the stream has told the
      // gate the Run ended, while the page it can re-read still carries its old state.
      const body = terminal
        ? `id: 1\nevent: timeline\ndata: ${JSON.stringify({ runId, seq: 1, eventType: 'lifecycle.result-sealed',
          occurredAt: new Date().toISOString(), outcome: 'success', source: 'worker' })}\n\n`
        : 'event: heartbeat\ndata: {}\n\n';
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body });
    });
    await page.goto(`/runs/${runId}/live`);
    const status = page.locator('[data-live-status]');
    await expect(status).toHaveAttribute('data-live-status', 'live');
    sendTerminal = true;
    await expect(page.getByText(LIVE_GATE_REASONS.runEnded).first()).toBeAttached({ timeout: 20_000 });
    await status.evaluate(node => {
      Reflect.set(window, 'story108OldGate', node);
      Reflect.set(window, 'story108Document', 'same-document');
    });
    const beforeRemount = attempts;
    await page.getByRole('link', { name: 'Open Run Detail', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
    await page.getByRole('link', { name: 'Watch', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/runs/${runId}/live$`));
    await expect.poll(() => attempts).toBeGreaterThan(beforeRemount);
    expect(await status.evaluate(node => node === Reflect.get(window, 'story108OldGate'))).toBe(false);
    expect(await page.evaluate(() => Reflect.get(window, 'story108Document'))).toBe('same-document');
    // The new stream receives only heartbeats. They recover health, never terminality.
    await expect(status).toHaveAttribute('data-live-status', 'live');
    await expect(page.getByText(LIVE_GATE_REASONS.runEnded).first()).toBeAttached();
    if (!await page.locator('#run-flag').evaluate(node => (node as HTMLDetailsElement).open)) {
      await page.locator('#run-flag > summary').click();
    }
    for (const name of ['Pause', 'Cancel Run', FLAG_COPY.submit]) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-disabled', 'true');
    }
    const [row] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
    expect(row).toMatchObject({ state: 'RUNNING' });
  });

  test('dismisses a confirmation that was already open, and refuses its confirm in words', async ({ page }) => {
    /**
     * The one path that can still COMMIT after the gate closes (PR 29 review).
     *
     * Every other control is withdrawn before it is pressed. A dialog opened while the
     * gate was open is different: its Confirm is what performs the action, and it lives
     * inside `ConfirmDialog` rather than in the control that opened it. Both halves of
     * that guard -- the auto-dismissal and the refusal in `handleConfirm` -- were reached
     * by NO test, so deleting either left every suite green.
     *
     * It cannot be a unit test: `ConfirmDialog` portals to a container set in an effect,
     * so under `renderToStaticMarkup` in the `node` environment it renders nothing at all.
     * This is the only place the DOM is real.
     */
    test.setTimeout(180_000);
    const runId = await seedRun();

    let attempts = 0;
    await page.route('**/api/runs/*/events*', async (route) => { attempts += 1; await route.abort(); });

    await page.goto(`/runs/${runId}/live`);
    await expect(page.getByRole('heading', { name: /^Live View · / })).toBeVisible();
    await expect(page.locator('#run-cancel')).toHaveAttribute('data-client-ready', 'true');

    // Opened while the page still knows what the Run is doing.
    await expect(page.getByRole('button', { name: 'Cancel Run', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: 'Cancel Run', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Now the stream goes quiet under it.
    await expect(page.locator('[data-live-status]'))
      .toHaveAttribute('data-live-status', 'lost', { timeout: LIVE_LOST_MS + 30_000 });

    // The dialog takes itself away rather than sitting there over a page that no longer
    // knows the Run's state.
    await expect(dialog).toHaveCount(0);
    expect(attempts).toBeGreaterThan(0);

    // And nothing was committed: this is the assertion the guard exists for.
    const [row] = await sql`SELECT state, cancel_requested_by FROM audit_run WHERE run_id=${runId}`;
    expect(row).toMatchObject({ state: 'RUNNING', cancel_requested_by: null });
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
    // The flag form opens from a disclosure in the page header (UI cleanup 2026-09-22,
    // UX-48); a role locator does not see a control inside a closed one.
    await page.locator('#run-flag > summary').click();
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
    // A role locator skips a control inside a closed disclosure, so the assertion above
    // alone would pass over a live form hidden in the header's flag opener; this one
    // counts hidden elements too.
    await expect(page.locator('#run-flag button[type="submit"]')).toHaveCount(0);
  });
});
