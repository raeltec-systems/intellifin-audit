import { expect, test } from '@playwright/test';

import { flagRun, type SessionSnapshot } from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleNotificationRepository,
  DrizzleRoleRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunFlagRepository,
  PostgresRunsUnitOfWork,
  SystemClock,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';

import { ATTENTION_HEADING } from '../../apps/web/src/overview/overview-words';
import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * The bell and the Overview after a burst, with no reload (Story 10.7).
 *
 * `BellLive` is the shell's one subscription to the list stream, and its re-read of the
 * page is what keeps both the bell's count and the Overview's attention list current: the
 * Overview opens no stream of its own (owner decision 2026-09-25). Its throttle used to be
 * leading-edge only, so a second qualifying event inside one second of the last re-read
 * was dropped and nothing re-read the page later — a burst ended one change short.
 *
 * The page's clock is FIXED. That pins every event after the first re-read inside the
 * one-second window, whatever this machine's speed: with a real clock a slow dev server
 * can stretch the gap past a second, and the leading-edge throttle would then pass by
 * accident. Timers still run, so a trailing re-read still fires one real second later.
 * The Runs are flagged through the real command, whose transaction issues the wake-up;
 * the page under test is never touched between loading and the last assertion.
 */

const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
/** Far enough out that no sweep can treat a seeded claim as expired mid-run. */
const LEASE = new Date(Date.now() + 3_600_000).toISOString();
/** The Overview's own bound on open items (`OPEN_ITEM_LIMIT` in `apps/web/app/page.tsx`). */
const OVERVIEW_OPEN_ITEMS = 10;
/** A deferred re-read fires one second after the event, then the page is read again. */
const SETTLE_MS = 15_000;

let sql: Sql;
let db: Database;
let session: SessionSnapshot;
const runs: string[] = [];

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the bell burst journey.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the bell burst journey.');
  session = { userId: auditor.id as string, sessionId: 'bell-burst' };
  const version = activeRunVersion(procedureId, versionId, session.userId);
  await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
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

/**
 * A RUNNING Run of the auditor's, published in ONE transaction with the checkpoints of a
 * Run a worker is holding, so no recovery sweep of a worker another spec started can
 * claim it. Each Run covers its own day, because two active Standard Runs of one
 * Procedure may not share a period.
 */
async function seedRun(): Promise<string> {
  const runId = ids.next();
  const at = new Date().toISOString();
  const day = String(runs.length + 1).padStart(2, '0');
  await sql.begin(async (tx) => {
    await tx`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
      procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Bell burst',
      ${`2026-09-${day}`},${`2026-09-${day}`},'RUNNING','STANDARD',${session.userId},'bell-burst','auditor',${at})`;
    await tx`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
      VALUES(${runId},1,'POPULATION_READY',1,${at},${at},${LEASE},'session-1',${ids.next()})`;
    await tx`INSERT INTO run_execution(run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
      VALUES(${runId},1,'EXECUTING',1,${at},${at},${at},${LEASE},${ids.next()})`;
  });
  runs.push(runId);
  return runId;
}

/** The real command: its transaction appends `lifecycle.run-flagged` and issues the wake-up. */
async function flag(runId: string): Promise<void> {
  const outcome = await flagRun(
    {
      roles: new DrizzleRoleRepository(db),
      unitOfWork: new PostgresRunsUnitOfWork(db),
      repository: new PostgresRunFlagRepository(db),
      ids,
      clock: new SystemClock(),
    },
    { session, request: { runId, note: null } },
  );
  if (!outcome.ok) throw new Error(outcome.reason);
}

/** What the bell must say: the count the server itself answers, as `NotificationBell` words it. */
async function expectedBell(): Promise<string> {
  const count = await new DrizzleNotificationRepository(db).countOpenFor(session);
  return `${count} unread`;
}

declare global {
  interface Window {
    /** Every `EventSource` the page opened, open or closed (StrictMode opens one and closes it). */
    __liveSubscriptions: EventSource[];
    /** Heartbeats received: the first proves the server's LISTEN is armed. */
    __liveHeartbeats: number;
    /** Set once after the page loads. A reload would take it away. */
    __burstMarker?: string;
  }
}

test.describe('the bell and the Overview after a burst', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('end the burst showing the last flag, re-read through the bell\'s one subscription, with no reload', async ({ page }) => {
    test.setTimeout(120_000);
    const first = await seedRun();
    const second = await seedRun();

    await page.clock.setFixedTime(new Date());
    // Watch every subscription the page opens without changing what it does.
    await page.addInitScript(() => {
      const Native = window.EventSource;
      window.__liveSubscriptions = [];
      window.__liveHeartbeats = 0;
      window.EventSource = class extends Native {
        constructor(url: string | URL, init?: EventSourceInit) {
          super(url, init);
          window.__liveSubscriptions.push(this);
          this.addEventListener('heartbeat', () => { window.__liveHeartbeats += 1; });
        }
      };
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    // The list stream sends its first heartbeat only after its LISTEN is armed, and it has
    // no replay: a flag committed before then would reach no page.
    await expect.poll(() => page.evaluate(() => window.__liveHeartbeats), { timeout: 30_000 }).toBeGreaterThan(0);
    const marker = ids.next();
    await page.evaluate((value) => { window.__burstMarker = value; }, marker);

    const attention = page.getByRole('region', { name: ATTENTION_HEADING });
    const bell = page.locator('.ls-bell__count');
    const flagged = (runId: string) => attention.locator(`a[href="/runs/${runId}/live"]`);
    await expect(flagged(first)).toHaveCount(0);
    await expect(flagged(second)).toHaveCount(0);

    // The first flag of the burst: re-read at once, which starts the one-second window.
    await flag(first);
    await expect(bell).toHaveText(await expectedBell(), { timeout: SETTLE_MS });
    await expect(flagged(first)).toBeVisible({ timeout: SETTLE_MS });

    // The last flag of the burst lands inside that window. A throttle may delay the re-read
    // that shows it; it may never drop it.
    await flag(second);
    const last = await expectedBell();
    const inbox = await new DrizzleNotificationRepository(db).openFor(session, OVERVIEW_OPEN_ITEMS);
    expect(
      inbox.some((item) => item.kind === 'flag' && item.runId === second),
      'the Overview lists its first open items only; clear leftover open Escalations from the test database',
    ).toBe(true);
    await expect(bell).toHaveText(last, { timeout: SETTLE_MS });
    await expect(flagged(second)).toBeVisible({ timeout: SETTLE_MS });
    await expect(flagged(first)).toBeVisible();

    // No reload: the page that loaded is the page that shows the last change.
    expect(await page.evaluate(() => window.__burstMarker)).toBe(marker);
    // And the Overview opened no stream of its own: the one subscription still open is the
    // bell's, on the list stream, and it is what re-read the page.
    expect(await page.evaluate(() => window.__liveSubscriptions
      .filter((source) => source.readyState !== EventSource.CLOSED)
      .map((source) => new URL(source.url).pathname))).toEqual(['/api/runs/events']);
  });
});
