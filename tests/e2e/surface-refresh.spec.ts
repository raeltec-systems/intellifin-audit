import { expect, test, type Locator, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { sha256HexOfBytes, utf8Bytes } from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresAuditUnitOfWork,
  PostgresProceduresUnitOfWork,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';

import { activeRunVersion } from '../fixtures/active-run-version';
import { startSyntheticS3 } from '../fixtures/s3-server';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * A Run surface does not re-read itself on the reads of its own evidence (Story 10.7 review).
 *
 * Every append to a Run's chain wakes the live channel, reads included: reading a stored
 * snapshot cell or a frame asks the WORKER for a grant (`evidence-access.grant-issued`) and
 * records the read (`evidence-access.read`), both on the Run's own chain. A surface that
 * re-read on those would read again, append two more, and re-read again, about once a
 * second, for as long as it is open on an active Run. `refreshesSurface` skips them.
 *
 * Both reads here are the real path: the page's server render or `<img>` asks for a durable
 * grant, the PRODUCTION WORKER signs it, and the bytes come from the synthetic object store.
 * Each Run is published in ONE transaction with the checkpoints of a Run a worker is
 * holding, so no recovery sweep of the running worker takes it over mid-test.
 */

const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
/** Far enough out that no sweep can treat a seeded claim as expired mid-run. */
const LEASE = new Date(Date.now() + 3_600_000).toISOString();
const LOCATOR = '$.nodes[1].value';
const SNAPSHOT_MEDIA_TYPE = 'application/vnd.intellifin.web-tree+json';
// A one-pixel PNG. Real bytes, so the frame route's media-type and digest checks are real.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** Past the stream's ten-second heartbeat: whatever a heartbeat could set off has happened. */
const PAST_A_HEARTBEAT_MS = 12_000;

let sql: Sql;
let db: Database;
let storage: Awaited<ReturnType<typeof startSyntheticS3>>;
let stopWorker: (() => Promise<void>) | undefined;
let workerLog = '';
let author = '';
const runs: string[] = [];

interface HeldRun {
  readonly runId: string;
  /** A registered Structural Snapshot with a grounded Observation at `LOCATOR`. */
  readonly snapshotId: string;
  /** A registered frame bound to a performed Tool Action, or `null`. */
  readonly frameId: string | null;
}

/**
 * A RUNNING Run, published in ONE transaction: the checkpoints of a Run a worker is holding
 * (a ready population, an executing agent phase and an open workspace, each under a live
 * lease), a registered Structural Snapshot with the Work Item, Step Execution and grounded
 * Observation the inspector reads, and, when asked, a captured frame (`live-view.spec.ts`).
 */
async function seedHeldRun(options: { readonly frame: boolean }): Promise<HeldRun> {
  const runId = ids.next();
  const snapshotId = ids.next();
  const frameId = options.frame ? ids.next() : null;
  const workItem = ids.next();
  const inspection = ids.next();
  const observation = ids.next();
  const capture = ids.next();
  const toolAction = ids.next();
  const at = new Date().toISOString();
  const day = String(runs.length + 1).padStart(2, '0');
  const snapshot = utf8Bytes(JSON.stringify({ schemaVersion: 1, nodes: [
    { group: 'record:0', role: 'datum', label: 'Employee ID', value: 'E-001', target: null },
    { group: 'record:0', role: 'datum', label: 'Status', value: 'Disabled', target: null },
  ] }));
  storage.objects.set(`structural-snapshot/${runId}/${snapshotId}`, snapshot);
  if (frameId !== null) storage.objects.set(`screenshot/${runId}/${frameId}`, new Uint8Array(PNG));
  const attribute = (name: string, value: string, locator: string, label: string) => ({ name, originalValue: value, normalizedValue: value,
    grounding: { evidenceId: snapshotId, locator, label, extractedText: value }, corroboration: 'matched' });
  await sql.begin(async (tx) => {
    await tx`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
      procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Surface re-read',
      ${`2026-08-${day}`},${`2026-08-${day}`},'RUNNING','STANDARD',${author},'surface-refresh','auditor',${at})`;
    await tx`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
      VALUES(${runId},1,'POPULATION_READY',1,${at},${at},${LEASE},'session-1',${ids.next()})`;
    await tx`INSERT INTO run_agent_execution(run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
      VALUES(${runId},1,'EXECUTING',1,${at},${at},${at},${LEASE},${ids.next()})`;
    await tx`INSERT INTO run_workspace(run_id,revision,status,attempts,step_id,workspace_id,mode,
      expires_at,started_at,attempt_started_at,lease_until)
      VALUES(${runId},1,'OPEN',1,'session-1','sess_surface_refresh','local',NULL,${at},${at},${at})`;
    await tx`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required,captured_at,capture_method,capture_time_source,role)
      VALUES(${snapshotId},${runId},'structural-snapshot','loancore',${`structural-snapshot/${runId}/${snapshotId}`},${SNAPSHOT_MEDIA_TYPE},
      ${sha256HexOfBytes(snapshot)},${snapshot.byteLength},'REGISTERED',false,${at},'agent','registration','evidence')`;
    await tx`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,state,attempts,cycles,diagnostic,evidence_id,observations)
      VALUES(${workItem},${runId},'inspect',1,'loancore','LoanCore','OBSERVED',1,0,NULL,${snapshotId},1)`;
    await tx`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at,completed_at,diagnostic)
      VALUES(${inspection},${runId},'inspect',${workItem},'inspect-record','SUCCEEDED',1,${at},${at},NULL)`;
    await tx`INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,
      step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,observed_at_source,corroboration)
      VALUES(${observation},${runId},${workItem},1,'E-001','loancore','true',${at},${inspection},'agent','platform',
      ${JSON.stringify(attribute('employee_id', 'E-001', '$.nodes[0].value', 'Employee ID'))}::jsonb,
      ${JSON.stringify([attribute('status', 'Disabled', LOCATOR, 'Status')])}::jsonb,${JSON.stringify([snapshotId])}::jsonb,
      ${'d'.repeat(64)},'COVERED',${at},'MATCHED')`;
    if (frameId !== null) {
      await tx`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
        VALUES(${capture},${runId},'target-1-1',NULL,'inspect-record','RUNNING',1,${at})`;
      await tx`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
        action,method,destination,parameters,outcome,redirected,downloads,started_at,capture)
        VALUES(${toolAction},${runId},${capture},NULL,'agent','loancore','read-attribute','GET',
        'https://loancore.invalid/accounts/E-001','[]'::jsonb,'performed',false,0,${at},'PERMITTED')`;
      await tx`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,
        state,required,captured_at,capture_method,capture_time_source,role)
        VALUES(${frameId},${runId},'screenshot','loancore',${`screenshot/${runId}/${frameId}`},'image/png',
        ${sha256HexOfBytes(new Uint8Array(PNG))},${PNG.byteLength},'REGISTERED',false,${at},'agent','registration','evidence')`;
      await tx`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
        VALUES(${frameId},${runId},${toolAction},'https://loancore.invalid/accounts/E-001')`;
    }
  });
  runs.push(runId);
  return { runId, snapshotId, frameId };
}

/** The Run's `evidence-access.*` events, in chain order. */
async function evidenceAccess(runId: string): Promise<readonly string[]> {
  const rows = await sql`SELECT event_type FROM audit_events
    WHERE aggregate_id=${runId} AND event_type LIKE 'evidence-access.%' ORDER BY sequence`;
  return rows.map((row) => String(row['event_type']));
}

/** The head of the Run's chain: the sequence a page that has seen everything has reached. */
async function chainHead(runId: string): Promise<number> {
  const [head] = await sql`SELECT last_sequence FROM audit_event_heads WHERE aggregate_id=${runId}`;
  return head === undefined ? 0 : Number(head['last_sequence']);
}

/**
 * Every server re-read of `path` the page asks for: `router.refresh()` fetches the current
 * route's server payload (an `RSC: 1` request that is not a prefetch). The document load
 * itself is a navigation and is not one.
 */
function countRereads(page: Page, path: string): () => number {
  let count = 0;
  page.on('request', (request) => {
    const headers = request.headers();
    if (request.method() !== 'GET' || headers['rsc'] !== '1' || headers['next-router-prefetch'] !== undefined) return;
    if (new URL(request.url()).pathname === path) count += 1;
  });
  return () => count;
}

/** The one live banner on a Run surface, which carries the channel's status and last sequence. */
const liveBanner = (page: Page): Locator => page.locator('[data-live-status]');

/** The page has seen every event on the Run's chain, re-read or not. */
async function expectCaughtUp(page: Page, runId: string): Promise<void> {
  await expect.poll(async () => Number(await liveBanner(page).getAttribute('data-live-seq')) === await chainHead(runId), {
    message: 'the page\'s live stream never reached the head of the Run\'s chain',
    timeout: 15_000,
  }).toBe(true);
}

/**
 * An ordinary Run event, appended by the real append path (the event every agent retry
 * appends). It passes the surface filter, so it re-reads the page, and it is NOT one of the
 * bell's events, so the shell's list stream does not re-read the page as well: a flag would
 * be re-read by both, and how many re-reads it caused would depend on timing.
 */
async function appendRetry(runId: string): Promise<void> {
  await new PostgresAuditUnitOfWork(db).execute(({ auditEvents }) => auditEvents.append({
    actor: { type: 'system', id: 'worker' }, eventType: 'failure.retry', source: 'worker', outcome: 'failure',
    sessionId: 'surface-refresh', correlationId: ids.next(), aggregateId: runId, payload: { attempt: 1 },
  }));
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('The surface re-read journey requires its isolated database.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the synthetic Auditor first.');
  author = String(auditor['id']);
  const version = activeRunVersion(procedureId, versionId, author);
  await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });
  storage = await startSyntheticS3();
  // The real worker: it is what signs an Evidence read grant, and both reads wait for it.
  const worker = spawn(process.execPath, [resolve('apps/worker/dist/main.js')], {
    cwd: process.cwd(), windowsHide: true,
    env: { ...process.env, ...storage.env, SERVICE_NAME: 'worker', MODEL_PROVIDER: '', MODEL_ID: '',
      ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', SOLARI_API_KEY: '', CREDENTIAL_TOKENS: '',
      EXCEPTION_FINGERPRINT_KEY: '', EXCEPTION_FINGERPRINT_KEY_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let failure: string | null = null;
  worker.on('error', (error) => { failure = error.name; });
  const exited = new Promise<void>((resolveExit) => worker.once('close', (code) => {
    if (code !== null && code !== 0) failure = `Worker exited ${String(code)}`;
    resolveExit();
  }));
  worker.stdout.on('data', (data) => { workerLog += String(data); });
  worker.stderr.on('data', (data) => { workerLog += String(data); });
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
    for (const runId of runs) {
      // One transaction per Run, the Run locked first (the sibling live specs' teardown).
      await sql.begin(async (tx) => {
        await tx`SELECT 1 FROM audit_run WHERE run_id=${runId} FOR UPDATE`;
        await tx`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
        await tx`DELETE FROM pgboss.job WHERE data->>'grantId' IN (SELECT grant_id::text FROM evidence_read_grant WHERE run_id=${runId})`;
        await tx`DELETE FROM evidence_read_grant WHERE run_id=${runId}`;
        await tx`DELETE FROM run_observation WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
        await tx`DELETE FROM run_tool_action WHERE run_id=${runId}`;
        await tx`DELETE FROM run_step_execution WHERE run_id=${runId}`;
        await tx`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await tx`DELETE FROM run_workspace WHERE run_id=${runId}`;
        await tx`DELETE FROM run_agent_execution WHERE run_id=${runId}`;
        await tx`DELETE FROM population_execution WHERE run_id=${runId}`;
        await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
      });
    }
    await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test.describe('a Run surface and the reads of its own evidence', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('the Evidence inspector on an active Run is re-read once for a Run event, and never for its own reads', async ({ page }) => {
    test.setTimeout(120_000);
    const run = await seedHeldRun({ frame: false });
    const path = `/runs/${run.runId}/evidence/${run.snapshotId}`;
    const rereads = countRereads(page, path);

    await page.goto(`${path}?locator=${encodeURIComponent(LOCATOR)}`);
    await expect(page.getByRole('heading', { name: 'Stored Structural Snapshot' })).toBeVisible();
    await expect(page.locator('.ls-untrusted').filter({ hasText: 'as read at the stored snapshot locator' }).locator('pre'))
      .toHaveText(JSON.stringify('Disabled'));
    await expect(liveBanner(page)).toHaveAttribute('data-live-status', 'live', { timeout: 30_000 });
    // What one render writes: the worker's grant decision and the web's read record.
    expect(await evidenceAccess(run.runId)).toEqual(['evidence-access.grant-issued', 'evidence-access.read']);
    await expectCaughtUp(page, run.runId);

    // An event the surface renders re-reads it ONCE, and that render reads the stored cell
    // again: two more `evidence-access.*` events on the Run's own chain, which reach the page.
    await appendRetry(run.runId);
    await expect.poll(() => rereads(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => evidenceAccess(run.runId), { timeout: 15_000 }).toEqual([
      'evidence-access.grant-issued', 'evidence-access.read', 'evidence-access.grant-issued', 'evidence-access.read',
    ]);
    await expectCaughtUp(page, run.runId);

    // Past a heartbeat, the page has re-read for none of them: the count stays at what that
    // one re-read wrote. A surface that re-read on its own reads would still be growing it.
    await page.waitForTimeout(PAST_A_HEARTBEAT_MS);
    expect(await evidenceAccess(run.runId)).toHaveLength(4);
    expect(rereads()).toBe(1);
    await expectCaughtUp(page, run.runId);
  });

  test('Live View reads its frame and is not re-read for that read', async ({ page }) => {
    test.setTimeout(120_000);
    const run = await seedHeldRun({ frame: true });
    const path = `/runs/${run.runId}/live`;
    const rereads = countRereads(page, path);

    await page.goto(path);
    const frame = page.locator('.ls-session__frame');
    await expect(frame).toBeVisible({ timeout: 10_000 });
    expect(await frame.getAttribute('src')).toBe(`/api/runs/${run.runId}/frames/${run.frameId}`);
    await expect.poll(async () => frame.evaluate((node) => (node as HTMLImageElement).naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0);
    // The frame was served from storage through a worker-signed grant: two events on the
    // Run's own chain, written after the page was rendered...
    await expect.poll(() => evidenceAccess(run.runId), { timeout: 15_000 })
      .toEqual(['evidence-access.grant-issued', 'evidence-access.read']);
    // ...and delivered to the page by its live stream.
    await expectCaughtUp(page, run.runId);

    // Neither re-read the page.
    await page.waitForTimeout(3_000);
    expect(rereads()).toBe(0);
    expect(await evidenceAccess(run.runId)).toHaveLength(2);
  });
});
