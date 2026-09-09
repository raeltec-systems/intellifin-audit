import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { cancelRun, type CancelRunDependencies } from '@intellifin/application';
import { sha256HexOfBytes } from '@intellifin/domain';
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

import {
  LIVE_VIEW_DESKTOP_ONLY_SENTENCE,
  LIVE_VIEW_QUEUED_SENTENCE,
  SESSION_ISOLATION_NOTE,
} from '../../apps/web/src/design/copy';
import { LIVE_VIEW_STAGE } from '../../apps/web/src/runs/live-view';
import { activeRunVersion } from '../fixtures/active-run-version';
import { startSyntheticS3 } from '../fixtures/s3-server';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * Live View in a real browser (Story 5.3, FR-24, UX-DR24, UX-DR25, NFR-7).
 *
 * The frame read is entirely real: the page's `<img>` hits the Run's own protected route,
 * which authorizes, requests a durable grant, and waits for the PRODUCTION WORKER to sign
 * it; the route then downloads from the synthetic object store, verifies the registered
 * digest, and answers PNG bytes. Nothing here hands the browser an object-store URL, and
 * the assertions below would fail if anything did.
 *
 * The Run rows are seeded (the `run-surfaces.spec.ts` and `evidence-inspector.spec.ts`
 * pattern): what is under test is the SURFACE, and a Run that captured a frame needs the
 * whole agent stage to produce one.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();

// A one-pixel PNG. Real bytes, so the route's media-type and digest checks are real.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const SOURCE_LOCATION = 'https://loancore.invalid/accounts/E-000105';
/** Far enough out that no sweep can treat a seeded claim as expired mid-run. */
const LEASE = new Date(Date.now() + 3_600_000).toISOString();

let sql: Sql;
let storage: Awaited<ReturnType<typeof startSyntheticS3>>;
let stopWorker: (() => Promise<void>) | undefined;
let workerLog = '';
let author = '';
const runs: string[] = [];

const cancelDependencies = (): CancelRunDependencies => ({
  roles: new DrizzleRoleRepository(createDb(sql)),
  unitOfWork: new PostgresRunsUnitOfWork(createDb(sql)),
  repository: new PostgresRunCancellationRepository(createDb(sql)),
  ids,
  clock: new SystemClock(),
});

interface Seeded {
  readonly runId: string;
  readonly evidenceId: string;
  readonly digest: string;
}

/** A RUNNING Run with a workspace, a Step Execution, a Tool Action and one frame. */
async function seedRun(options: { readonly workspace: boolean; readonly frame: boolean; readonly state?: 'RUNNING' | 'PAUSED' }): Promise<Seeded> {
  const runId = ids.next();
  const evidenceId = ids.next();
  const stepExecutionId = ids.next();
  const toolActionId = ids.next();
  const at = new Date().toISOString();
  const day = String(runs.length + 1).padStart(2, '0');
  const digest = sha256HexOfBytes(new Uint8Array(PNG));
  await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
    procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
    VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Live View journey',
    ${`2026-08-${day}`},${`2026-08-${day}`},${options.state ?? 'RUNNING'},'STANDARD',${author},'live-view-fixture','auditor',${at})`;
  runs.push(runId);
  // The truthful checkpoints of a Run whose worker is holding it: its population is
  // ready and a claim's lease is still live. Without them the real worker's recovery
  // sweeps select the seeded Run — correctly, since a RUNNING Run with no population
  // IS abandoned — and execute it out from under the surface under test.
  await sql`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
    VALUES(${runId},1,'POPULATION_READY',1,${at},${at},${LEASE},'session-1',${ids.next()})`;
  await sql`INSERT INTO ${sql(options.workspace ? 'run_agent_execution' : 'run_execution')}(
    run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
    VALUES(${runId},1,'EXECUTING',1,${at},${at},${at},${LEASE},${ids.next()})`;
  if (options.workspace) {
    await sql`INSERT INTO run_workspace(run_id,revision,status,attempts,step_id,workspace_id,mode,
      expires_at,started_at,attempt_started_at,lease_until)
      VALUES(${runId},1,'OPEN',1,'session-1','sess_live_view','local',NULL,${at},${at},${at})`;
  }
  await sql`INSERT INTO run_session_step(run_id,step_id,ordinal,registration_id,display_name,action,state,attempts,diagnostic,evidence_id)
    VALUES(${runId},'session-2',2,'accessgate','AccessGate','extract-adapter','IN_PROGRESS',1,NULL,NULL)`;
  if (options.frame) {
    storage.objects.set(`screenshot/${runId}/${evidenceId}`, new Uint8Array(PNG));
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
      VALUES(${stepExecutionId},${runId},'target-1-1',NULL,'inspect-record','RUNNING',1,${at})`;
    await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
      action,method,destination,parameters,outcome,redirected,downloads,started_at,capture)
      VALUES(${toolActionId},${runId},${stepExecutionId},NULL,'agent','loancore','read-attribute','GET',
      ${SOURCE_LOCATION},'[]'::jsonb,'performed',false,0,${at},'PERMITTED')`;
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,
      state,required,captured_at,capture_method,capture_time_source)
      VALUES(${evidenceId},${runId},'screenshot','loancore',${`screenshot/${runId}/${evidenceId}`},'image/png',
      ${digest},${PNG.byteLength},'REGISTERED',false,${at},'agent','registration')`;
    await sql`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
      VALUES(${evidenceId},${runId},${toolActionId},${SOURCE_LOCATION})`;
  }
  return { runId, evidenceId, digest };
}

/** A QUEUED Run: no workspace, no Step Execution, nothing captured. */
async function seedQueuedRun(): Promise<string> {
  const runId = ids.next();
  const at = new Date().toISOString();
  const day = String(runs.length + 20).padStart(2, '0');
  await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
    procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
    VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Live View journey',
    ${`2026-09-${day}`},${`2026-09-${day}`},'QUEUED','STANDARD',${author},'live-view-fixture','auditor',${at})`;
  runs.push(runId);
  return runId;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('Live View browser verification requires its isolated database.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the synthetic Auditor first.');
  author = String(auditor.id);
  const version = activeRunVersion(procedureId, versionId, author);
  await new PostgresProceduresUnitOfWork(createDb(sql)).execute(async (context) => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });
  storage = await startSyntheticS3();
  // The real worker: it is what signs an Evidence read grant, and the frame route waits
  // for exactly that signature. A test that signed one itself would prove nothing about
  // the path a browser actually takes.
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
      await sql`DELETE FROM pgboss.job WHERE data->>'grantId' IN (SELECT grant_id::text FROM evidence_read_grant WHERE run_id=${runId})`;
      await sql`DELETE FROM evidence_read_grant WHERE run_id=${runId}`;
      await sql`DELETE FROM run_result WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
      await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
      await sql`DELETE FROM run_tool_action WHERE run_id=${runId}`;
      await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_agent_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM population_row WHERE run_id=${runId}`;
      await sql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
      await sql`DELETE FROM population_evidence WHERE run_id=${runId}`;
      await sql`DELETE FROM population_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
      await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
    }
    await sql`DELETE FROM run_initiation_request WHERE initiator_id=${author} AND procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test.describe('Live View', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('streams the captured frame through the Run’s own protected route, and names the session', async ({ page }) => {
    test.setTimeout(120_000);
    const seeded = await seedRun({ workspace: true, frame: true });
    await page.goto(`/runs/${seeded.runId}/live`);

    // The chrome: state word, workspace identity and the isolation note (UX-DR24).
    await expect(page.getByText('LIVE', { exact: true })).toBeVisible();
    await expect(page.getByText('sess_live_view')).toBeVisible();
    await expect(page.getByText(SESSION_ISOLATION_NOTE)).toBeVisible();

    // NFR-7: the frame is on screen within five seconds of the page opening. It is served
    // by the route, so the assertion is on a REAL image the browser decoded.
    const frame = page.locator('.ls-session__frame');
    await expect(frame).toBeVisible({ timeout: 5_000 });
    const source = await frame.getAttribute('src');
    expect(source).toBe(`/api/runs/${seeded.runId}/frames/${seeded.evidenceId}`);
    await expect.poll(
      async () => frame.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      { timeout: 10_000 },
    ).toBeGreaterThan(0);

    // The alt text narrates the Step, and the caption names where it was captured.
    const alt = await frame.getAttribute('alt');
    expect(alt).toContain('target-1-1');
    await expect(page.getByText(SOURCE_LOCATION)).toBeVisible();

    // No object-store URL reaches the browser: every image on this page is same-origin
    // and under this Run's own route.
    const sources = await page.locator('img').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('src') ?? ''));
    expect(sources.filter((src) => !src.startsWith(`/api/runs/${seeded.runId}/`))).toEqual([]);

    // The route itself: verified PNG bytes, an ETag that is the registered digest, and
    // headers that stop the image being interpreted as anything else.
    const response = await page.request.get(`/api/runs/${seeded.runId}/frames/${seeded.evidenceId}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
    expect(response.headers()['etag']).toBe(`"${seeded.digest}"`);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(await response.body()).equals(PNG)).toBe(true);
    // A grant really was issued and consumed, by the worker, for this artifact.
    const grants = await sql`SELECT status,locator FROM evidence_read_grant WHERE run_id=${seeded.runId}`;
    expect(grants.length).toBeGreaterThan(0);
    expect(grants.every((row) => row['locator'] === 'frame')).toBe(true);

    await expect(page).toHaveTitle(/.+/);
    const scan = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(scan.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
  });

  test('says why there is no screen on an adapter-only Run, and lists its Session Steps', async ({ page }) => {
    const seeded = await seedRun({ workspace: false, frame: false });
    await page.goto(`/runs/${seeded.runId}/live`);
    await expect(page.getByText(LIVE_VIEW_STAGE.adapterOnly)).toBeVisible();
    await expect(page.getByText('No Agent Workspace', { exact: true })).toBeVisible();
    await expect(page.locator('.ls-session__frame')).toHaveCount(0);
    // UX-DR25's adapter-only row: a log row instead of a screen.
    await expect(page.getByText('session-2')).toBeVisible();
    await expect(page.getByText('AccessGate')).toBeVisible();
  });

  test('a Queued Run disables Watch with the contract’s reason, and says so in Live View too', async ({ page }) => {
    const runId = await seedQueuedRun();
    await page.goto(`/runs/${runId}`);
    // EXPERIENCE.md's Run Detail / Queued row. The reason is visible text in the panel,
    // never a tooltip, and the control keeps its position.
    const watch = page.getByRole('button', { name: 'Watch' });
    await expect(watch).toBeVisible();
    await expect(watch).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(LIVE_VIEW_QUEUED_SENTENCE)).toBeVisible();

    await page.goto(`/runs/${runId}/live`);
    await expect(page.getByText(LIVE_VIEW_QUEUED_SENTENCE)).toBeVisible();
    // A Run that has not started has NO session word, rather than being called LIVE.
    await expect(page.getByText('LIVE', { exact: true })).toHaveCount(0);
    await expect(page.locator('.ls-session__frame')).toHaveCount(0);
  });

  test('an active Run offers Watch as a link that needs no JavaScript', async ({ page }) => {
    const seeded = await seedRun({ workspace: true, frame: false });
    await page.goto(`/runs/${seeded.runId}`);
    const watch = page.getByRole('link', { name: 'Watch' });
    await expect(watch).toHaveAttribute('href', `/runs/${seeded.runId}/live`);
    await watch.click();
    await expect(page).toHaveURL(new RegExp(`/runs/${seeded.runId}/live$`));
    await expect(page.getByText(LIVE_VIEW_STAGE.awaitingFirstFrame)).toBeVisible();
  });

  test('renders read-only below 1024px with the contract’s floor sentence', async ({ page }) => {
    const seeded = await seedRun({ workspace: true, frame: true });
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(`/runs/${seeded.runId}/live`);
    await expect(page.getByText(LIVE_VIEW_DESKTOP_ONLY_SENTENCE)).toBeVisible();
    // Above the floor the same sentence is in the document and hidden by the stylesheet.
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByText(LIVE_VIEW_DESKTOP_ONLY_SENTENCE)).toBeHidden();
  });

  test('flips to REPLAY and names the terminal state when the Run ends while it is open', async ({ page }) => {
    test.setTimeout(90_000);
    // PAUSED, deliberately. `RUN_CANCEL_TRANSITIONS` gives a PAUSED Run to the COMMAND —
    // no worker is holding it, so `cancelRun` performs the terminal transition here and
    // now. On a RUNNING Run the same call correctly only RECORDS the request, which a
    // worker honours at its next boundary, so the page would still say PAUSED/LIVE and
    // the test would be asserting a transition the product never promised to make.
    const seeded = await seedRun({ workspace: true, frame: true, state: 'PAUSED' });
    await page.goto(`/runs/${seeded.runId}/live`);
    await expect(page.getByText('PAUSED', { exact: true })).toBeVisible();
    await expect(page.locator('[data-live-status]')).toHaveAttribute('data-live-status', 'live', { timeout: 15_000 });
    // A marker a full document reload would destroy: the page re-reads on the server.
    await page.evaluate(() => { (window as unknown as { __liveMarker: number }).__liveMarker = 1; });

    const cancelled = await cancelRun(cancelDependencies(), {
      session: { userId: author, sessionId: `live-view-${author}` },
      request: { runId: seeded.runId, reason: null },
    });
    expect(cancelled).toEqual({ ok: true, state: 'CANCELED', pending: false });

    // UX-DR25's "Run ended while open" row: chrome REPLAY, a Banner naming the state and
    // a link to Run Detail.
    await expect(page.getByText('REPLAY', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('This Run has ended: CANCELED.')).toBeVisible();
    await expect(page.locator('.ls-banner').getByRole('link', { name: 'Open Run Detail' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __liveMarker?: number }).__liveMarker)).toBe(1);
  });
});
