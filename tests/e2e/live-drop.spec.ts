import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
import { LIVE_GATE_REASONS, LIVE_LOST_MS, LIVE_SENTENCES, LIVE_WORDS } from '../../apps/web/src/runs/live-status';
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

/**
 * The Run's chain moves on, the way a worker's own progress moves it: one event appended
 * through the real writer, with the notification every writer issues. Nothing on the page
 * reads this event's content; what it changes is the chain HEAD, which is the cursor the
 * next server read of Live View hands the subscription.
 */
async function appendProgress(runId: string): Promise<void> {
  await new PostgresRunsUnitOfWork(createDb(sql)).execute(async (context) => {
    const event = await context.auditEvents.append({
      actor: { type: 'system', id: 'live-drop-fixture' }, source: 'worker', outcome: 'success',
      eventType: 'lifecycle.run-progressed', aggregateId: runId, correlationId: ids.next(),
      sessionId: 'live-drop-progress', payload: {},
    });
    await context.notifyTimeline(runId, event.sequence);
  });
}

/**
 * What a reader is told about the live channel and what the live controls permit, read in
 * ONE page read so no fact can change between two reads of it (a poll that reads a count
 * and then a text can report a state the page was never in).
 */
async function liveFacts(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate((reason) => {
    const banner = document.querySelector('[data-live-status]');
    const button = (name: string): Element | null =>
      [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === name) ?? null;
    // What a withdrawn control says to a screen reader: the text of what it is described by.
    const described = (name: string): string | null => {
      const ids = button(name)?.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? [];
      return ids.length === 0 ? null : ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ');
    };
    return {
      status: banner?.getAttribute('data-live-status') ?? null,
      // The WORD is what the polite region announces; the sentence beside it is not.
      word: banner?.querySelector('[aria-live]')?.textContent ?? null,
      sentence: banner?.querySelector('[aria-hidden="true"]')?.textContent ?? null,
      pause: button('Pause')?.getAttribute('aria-disabled') ?? null,
      cancel: button('Cancel Run')?.getAttribute('aria-disabled') ?? null,
      pauseReason: described('Pause'),
      cancelReason: described('Cancel Run'),
      // The flag form sits in a disclosure in the header (UX-48); its submit is in the DOM
      // whether or not the disclosure is open.
      flag: document.querySelector('#run-flag button[type="submit"]')?.getAttribute('aria-disabled') ?? null,
      // The reason a SIGHTED reader can see: an element whose own text is the reason, laid
      // out and painted, and not the visually hidden description a screen reader gets.
      // `textContent` of the whole page would count hidden text too.
      reasonShown: [...document.querySelectorAll('body *')].some((element) => {
        if (element.children.length > 0 || (element.textContent ?? '').trim() !== reason) return false;
        if (element.closest('.ls-visually-hidden') !== null) return false;
        const box = element.getBoundingClientRect();
        return element.checkVisibility() && box.width > 1 && box.height > 1;
      }),
    };
  }, LIVE_GATE_REASONS.lost);
}

/**
 * Open the flag disclosure, whose caption is where a sighted reader is told why the live
 * controls are withdrawn. After hydration, always: a native `<details>` clicked before React
 * attaches gets an `open` the server never rendered, which is a hydration mismatch.
 */
async function openFlagPanel(page: Page): Promise<void> {
  await expect(page.locator('#run-cancel')).toHaveAttribute('data-client-ready', 'true');
  if (!(await page.locator('#run-flag').evaluate((details) => (details as HTMLDetailsElement).open))) {
    await page.locator('#run-flag > summary').click();
  }
  await expect(page.locator('#run-flag')).toHaveJSProperty('open', true);
}

/** A lost stream as Live View must state it: the word, the sentence, and every live control withdrawn with its reason. */
const LOST_LIVE_VIEW = {
  status: 'lost',
  word: LIVE_WORDS.lost,
  sentence: LIVE_SENTENCES.lost,
  pause: 'true',
  cancel: 'true',
  pauseReason: LIVE_GATE_REASONS.lost,
  cancelReason: LIVE_GATE_REASONS.lost,
  flag: 'true',
  reasonShown: true,
} as const;

/**
 * Read the facts several times over a few seconds. The defect this guards against is a
 * page that flips back to `live` a moment AFTER a re-read lands, so one read is not
 * "throughout"; each sample is still a single page read.
 */
async function expectThroughout(page: Page, expected: Record<string, unknown>, samples = 8): Promise<void> {
  for (let sample = 0; sample < samples; sample += 1) {
    expect(await liveFacts(page), `sample ${sample + 1} of ${samples}`).toMatchObject(expected);
    await page.waitForTimeout(500);
  }
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
    await openFlagPanel(page);
    for (const name of ['Pause', 'Cancel Run', FLAG_COPY.submit]) {
      const control = page.getByRole('button', { name, exact: true });
      await expect(control).toHaveAttribute('aria-disabled', 'true');
    }
    // Seen, not only present: the caption under the flag note is the reason a sighted
    // reader reads, and each withdrawn button is described by it for a screen reader.
    await expect(page.locator('#run-flag-note-withdrawn')).toBeVisible();
    await expect(page.locator('#run-flag-note-withdrawn')).toHaveText(LIVE_GATE_REASONS.lost);
    expect(await liveFacts(page)).toMatchObject(LOST_LIVE_VIEW);

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

  test('stays lost through a server re-read and a remount, and comes back only when the stream does (Story 10.8)', async ({ page }) => {
    /**
     * The defect: `useLiveTimeline` restarted its silence clock whenever its `[url, cursor]`
     * effect ran, and a server re-read that moves the cursor re-runs it. So a re-read that
     * landed during a drop — the shell's bell refreshing because ANOTHER Run ended — made
     * the page say `live` and reopened every live control while the stream was still down.
     *
     * The re-read here is exactly that one: this Run's chain moves on while its stream is
     * unreachable, then another Run ends, the bell re-reads the page, and the page comes
     * back with a new cursor. The test first proves the re-read really re-subscribed (a
     * new `EventSource` for this Run) — without that it would pass against the defect —
     * and then reads the word, the sentence and the controls several times over.
     */
    test.setTimeout(240_000);
    const runId = await seedRun();
    // PAUSED, so the COMMAND ends it (`RUN_CANCEL_TRANSITIONS`) and the terminal events
    // really reach the list stream the bell follows.
    const otherRunId = await seedRun('PAUSED');
    const stream = `/api/runs/${runId}/events`;

    // Every `EventSource` the page constructs, by URL. A reconnect `EventSource` makes by
    // itself constructs nothing; only the subscription effect does.
    await page.addInitScript(() => {
      const Native = window.EventSource;
      const opened: string[] = [];
      Object.defineProperty(window, '__liveStreamsOpened', { value: opened });
      window.EventSource = class extends Native {
        constructor(url: string | URL, init?: EventSourceInit) {
          super(url, init);
          opened.push(String(url));
        }
      };
    });
    const subscriptions = (): Promise<number> => page.evaluate((prefix) =>
      ((window as unknown as { __liveStreamsOpened?: string[] }).__liveStreamsOpened ?? [])
        .filter((url) => url.startsWith(prefix)).length, stream);

    // Until the drop, each connection to THIS Run's stream answers with one heartbeat and
    // closes, so the page is live and reconnects on its own every two seconds. From the
    // drop on, every attempt fails at the network, as a real drop does. The list stream the
    // bell follows is a different URL and is never touched.
    let dropping = false;
    let attemptsWhileDropping = 0;
    await page.route(`**${stream}*`, async (route) => {
      if (dropping) {
        attemptsWhileDropping += 1;
        await route.abort();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
        body: `retry: 2000\n\nevent: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`,
      });
    });

    await page.goto(`/runs/${runId}/live`);
    const banner = page.locator('[data-live-status]');
    await expect(banner).toHaveAttribute('data-live-status', 'live', { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).not.toHaveAttribute('aria-disabled', 'true');

    dropping = true;
    await expect(banner).toHaveAttribute('data-live-status', 'lost', { timeout: LIVE_LOST_MS + 30_000 });
    await openFlagPanel(page);
    await expectThroughout(page, LOST_LIVE_VIEW, 2);

    // The Run's chain moves on while the page cannot hear it.
    await appendProgress(runId);
    const before = await subscriptions();

    // An UNRELATED re-read: another Run ends and the shell's bell re-reads the page.
    const reRead = page.waitForResponse((response) => {
      const request = response.request();
      return request.method() === 'GET' && request.resourceType() === 'fetch'
        && new URL(response.url()).pathname === `/runs/${runId}/live`;
    }, { timeout: 30_000 });
    // Observed at once, so a failure of the command below cannot leave it unhandled.
    void reRead.catch(() => undefined);
    const cancelled = await cancelRun(cancelDependencies(), {
      session: { userId: author, sessionId: `live-drop-${author}` },
      request: { runId: otherRunId, reason: null },
    });
    expect(cancelled).toEqual({ ok: true, state: 'CANCELED', pending: false });
    await reRead;

    // The precondition that lets this test fail: the re-read handed the page a new cursor,
    // so the subscription effect ran again and opened a new connection.
    await expect.poll(subscriptions, { timeout: 15_000 }).toBeGreaterThan(before);
    await expectThroughout(page, LOST_LIVE_VIEW);

    // WCAG 2.1 AA on the surface in exactly this state.
    await expect(page).toHaveTitle(/.+/);
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(scan.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);

    // A remount is not recovery either. Run Detail and the Auditor Workspace follow the SAME
    // stream, so moving between them hands the clock on rather than starting it again: every
    // page says `lost` at once. A fresh clock would say `connecting` for fifteen seconds and
    // then `stale` — and neither is a gate reason, so the live controls would be back for a
    // whole minute on a stream that is still down.
    await page.getByRole('link', { name: 'Open Run Detail' }).click();
    await expect(page.getByRole('link', { name: 'Execution Timeline', exact: true })).toBeVisible();
    await expect(banner).toHaveAttribute('data-live-status', 'lost', { timeout: 5_000 });
    await expect(banner.locator('[aria-hidden="true"]')).toHaveText(LIVE_SENTENCES.lost);
    // WCAG 2.1 AA on Run Detail in the state it inherited.
    await expect(page).toHaveTitle(/.+/);
    const detailScan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(detailScan.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);

    await page.getByRole('link', { name: 'Open Auditor Workspace', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/runs/${runId}/workspace$`));
    await expect(banner).toHaveAttribute('data-live-status', 'lost', { timeout: 5_000 });
    await expect(banner.locator('[aria-hidden="true"]')).toHaveText(LIVE_SENTENCES.lost);
    await expect(banner.locator('[aria-live]')).toHaveText(LIVE_WORDS.lost);

    await page.goBack();
    await expect(page.getByRole('link', { name: 'Execution Timeline', exact: true })).toBeVisible();
    await expect(banner).toHaveAttribute('data-live-status', 'lost', { timeout: 5_000 });
    await page.goBack();
    await expect(page.getByRole('heading', { name: /^Live View · / })).toBeVisible();
    await openFlagPanel(page);
    await expectThroughout(page, LOST_LIVE_VIEW);

    // The stream returns: the browser's own retry reaches the real route, the stream itself
    // answers, and only now is the page live and its controls back.
    await page.unroute(`**${stream}*`);
    await expect(banner).toHaveAttribute('data-live-status', 'live', { timeout: 30_000 });
    await expect(page.getByText(LIVE_SENTENCES.live)).toBeVisible();
    for (const name of ['Pause', 'Cancel Run', FLAG_COPY.submit]) {
      await expect(page.getByRole('button', { name, exact: true })).not.toHaveAttribute('aria-disabled', 'true');
    }
    // Every control back, and the reason gone with the state it described.
    expect(await liveFacts(page)).toMatchObject({
      status: 'live', pause: null, cancel: null, flag: null, pauseReason: null, cancelReason: null, reasonShown: false,
    });
    expect(attemptsWhileDropping).toBeGreaterThan(0);

    // None of this changed the Run being watched.
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
    // `useLiveTimeline` seeds its last sequence (`LiveStreamState.lastSeq`) from that server
    // `cursor` when it mounts, so every remount re-subscribes at the SERVER's number — correct
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
