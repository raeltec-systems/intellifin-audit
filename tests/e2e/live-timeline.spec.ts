import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { cancelRun, initiateRun, type CancelRunDependencies, type RunDependencies } from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunCancellationRepository,
  PostgresRunsUnitOfWork,
  SystemClock,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';

import { LIVE_SENTENCES } from '../../apps/web/src/runs/live-status';
import { activeRunVersion } from '../fixtures/active-run-version.js';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * The live Timeline channel in a real browser (Story 5.1, AD-17, UX-DR25, NFR7).
 *
 * What only a browser can prove: that a Timeline event committed by the real command
 * reaches an open Run Detail within 5 seconds with NO reload, that a terminal Run keeps
 * the plain refresh banner, that the stale indicator appears after 15 seconds without a
 * frame and clears when the stream is back, and that the Runs list gains a Run that was
 * just initiated. No worker runs in this suite, so every Run stays QUEUED — which is
 * active, and exactly what a subscribing surface has to follow.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ids = new CryptoUuidV7Generator();
let sql: Sql;
let db: Database;
let auditorId = '';
const procedures: string[] = [];

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('The live channel journey requires the throwaway database.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 2 });
  db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the live channel journey.');
  auditorId = auditor.id as string;
});

test.afterAll(async () => {
  if (!sql) return;
  try {
    for (const procedureId of procedures) {
      const runs = await sql`SELECT run_id::text AS id FROM audit_run WHERE procedure_id=${procedureId}`;
      for (const run of runs) {
        await sql`DELETE FROM pgboss.job WHERE name='runs' AND data->>'runId'=${run.id}`;
        await sql`DELETE FROM audit_events WHERE aggregate_id=${run.id}`;
        await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${run.id}`;
      }
      await sql`DELETE FROM run_result WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${procedureId})`;
      await sql`DELETE FROM run_evidence_package WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${procedureId})`;
      await sql`DELETE FROM run_initiation_request WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM audit_run WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM notification WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
    }
    await sql`DELETE FROM run_initiation_request WHERE initiator_id=${auditorId} AND procedure_id = ANY(${procedures}::uuid[])`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

const session = () => ({ userId: auditorId, sessionId: `live-timeline-${auditorId}` });
const runDependencies = (): RunDependencies => ({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock: new SystemClock() });
const cancelDependencies = (): CancelRunDependencies =>
  ({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), repository: new PostgresRunCancellationRepository(db), ids, clock: new SystemClock() });

/** An ACTIVE Procedure Version and a queued Run of it, made by the real commands. */
async function queuedRun(): Promise<string> {
  const row = activeRunVersion(ids.next(), ids.next(), auditorId);
  procedures.push(row.procedureId);
  await new PostgresProceduresUnitOfWork(db).execute(async context => {
    await context.procedures.insertProcedure(row);
    await context.procedures.insertVersion(row);
  });
  const outcome = await initiateRun(runDependencies(), {
    session: session(),
    request: { procedureId: row.procedureId, period: { from: '2026-08-01', to: '2026-08-31' }, requestToken: ids.next() },
  });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.runId;
}

test.describe('the live Timeline channel', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('Run Detail follows a committed event within 5 seconds, with no reload, and stops following a terminal Run', async ({ page }) => {
    test.setTimeout(90_000);
    const runId = await queuedRun();
    await page.goto(`/runs/${runId}`);
    const status = page.locator('[data-live-status]');
    await expect(status).toHaveAttribute('data-live-status', 'live', { timeout: 15_000 });
    await expect(page.getByText(LIVE_SENTENCES.live)).toBeVisible();
    // The banner still carries the read instant and the link that works without script.
    await expect(page.getByRole('link', { name: 'Refresh.' })).toBeVisible();
    await expect(page).toHaveTitle(/.+/);
    const scan = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(scan.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);

    // A marker that a full document reload would destroy.
    await page.evaluate(() => { (window as unknown as { __liveMarker: number }).__liveMarker = 1; });
    const cancelled = await cancelRun(cancelDependencies(), { session: session(), request: { runId, reason: null } });
    expect(cancelled).toEqual({ ok: true, state: 'CANCELED', pending: false });

    // Within 5 seconds the page shows the terminal state, re-read from the server.
    await expect(page.getByText('Canceled', { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    expect(await page.evaluate(() => (window as unknown as { __liveMarker?: number }).__liveMarker)).toBe(1);
    // A terminal Run is a request-time read again: no subscription, the plain banner.
    await expect(status).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Refresh.' })).toBeVisible();
  });

  test('says stale after 15 seconds without a frame, and live again once the stream is back', async ({ page }) => {
    test.setTimeout(120_000);
    const runId = await queuedRun();
    // Every attempt to open the stream fails at the network, so no frame ever arrives.
    await page.route('**/api/runs/*/events*', (route) => route.abort());
    await page.goto(`/runs/${runId}`);
    const status = page.locator('[data-live-status]');
    await expect(status).toHaveAttribute('data-live-status', 'connecting');
    await expect(status).toHaveAttribute('data-live-status', 'stale', { timeout: 25_000 });
    await expect(page.getByText(/No update for \d+ seconds\./)).toBeVisible();
    await expect(page.locator('.ls-banner--warning [data-live-status]')).toHaveCount(1);
    // The stream returns: the browser's own retry connects and the page is live again.
    await page.unroute('**/api/runs/*/events*');
    await expect(status).toHaveAttribute('data-live-status', 'live', { timeout: 15_000 });
    await expect(page.getByText(LIVE_SENTENCES.live)).toBeVisible();
    await cancelRun(cancelDependencies(), { session: session(), request: { runId, reason: null } });
  });

  test('the Runs list gains a Run initiated elsewhere without a reload', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/runs');
    const status = page.locator('[data-live-status]');
    await expect(status).toHaveAttribute('data-live-status', 'live', { timeout: 15_000 });
    await page.evaluate(() => { (window as unknown as { __liveMarker: number }).__liveMarker = 2; });
    const runId = await queuedRun();
    await expect(page.getByRole('link', { name: runId })).toBeVisible({ timeout: 5_000 });
    expect(await page.evaluate(() => (window as unknown as { __liveMarker?: number }).__liveMarker)).toBe(2);
    await cancelRun(cancelDependencies(), { session: session(), request: { runId, reason: null } });
  });
});
