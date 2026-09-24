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

import { REPLAY_COPY } from '../../apps/web/src/design/copy';
import { activeRunVersion } from '../fixtures/active-run-version';
import { createRecordReviewBrowserFixture } from '../fixtures/record-review-browser';
import { startSyntheticS3 } from '../fixtures/s3-server';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

// A separate fixture owns its worker and storage so this proof runs sequentially.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const controlName = `E2E Selected Replay ${procedureId}`;

// A one-pixel PNG. Real bytes, so the route's media-type and digest checks are real.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const DIGEST = sha256HexOfBytes(new Uint8Array(PNG));
const LOCATIONS = [
  'https://loancore.invalid/accounts/E-000105',
  'https://loancore.invalid/accounts/E-000106',
  'https://loancore.invalid/accounts/E-000107',
];

let sql: Sql;
let storage: Awaited<ReturnType<typeof startSyntheticS3>>;
let stopWorker: (() => Promise<void>) | undefined;
let workerLog = '';
let author = '';
const runs: string[] = [];

/** The real cancel command, so a Run ending elsewhere is the platform's own event. */
const cancelDependencies = (): CancelRunDependencies => {
  const db = createDb(sql);
  return { roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db),
    repository: new PostgresRunCancellationRepository(db), ids, clock: new SystemClock() };
};

interface Replayed {
  readonly runId: string;
  readonly frames: readonly string[];
  readonly workItems: readonly string[];
  readonly recordKey: string;
}

async function seedReplayRun(): Promise<Replayed> {
  const runId = ids.next();
  const at = Date.now();
  const stamp = (offsetSeconds: number): string => new Date(at + offsetSeconds * 1_000).toISOString();
  const day = String(runs.length + 1).padStart(2, '0');
  const workItems = [ids.next(), ids.next()];
  const frames = Array.from({ length: 610 }, () => ids.next());
  const recordKey = 'E-000106';

  // The Run is RUNNING while the rest of this fixture is written, and the spec's own worker
  // is up (the frame grants need it) — so the Run has to carry the checkpoints a held Run
  // really has, or the population recovery sweep (`startPopulationRecovery`, every five
  // seconds) claims it as abandoned, reserves a REQUIRED population artifact it can never
  // acquire, and generation 21 then refuses the seal below. `live-view.spec.ts` seeds the same
  // pair for the same reason; here the row and its claims commit TOGETHER, so there is no
  // window at all rather than a small one.
  const lease = stamp(3_600);
  await sql.begin(async (tx) => {
    await tx`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
      procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,${controlName},
      ${`2026-07-${day}`},${`2026-07-${day}`},'RUNNING','STANDARD',${author},'replay-fixture','auditor',${stamp(0)})`;
    await tx`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
      VALUES(${runId},1,'POPULATION_READY',1,${stamp(0)},${stamp(0)},${lease},'session-1',${ids.next()})`;
    await tx`INSERT INTO run_agent_execution(run_id,revision,status,attempts,run_started_at,started_at,attempt_started_at,lease_until,attempt_id)
      VALUES(${runId},1,'EXECUTING',1,${stamp(0)},${stamp(0)},${stamp(0)},${lease},${ids.next()})`;
  });
  runs.push(runId);
  // RELEASED, with the instant it was released: `run_workspace_released_at` refuses the
  // pairing without it, which is the truthful shape of a terminal Run's workspace.
  await sql`INSERT INTO run_workspace(run_id,revision,status,attempts,step_id,workspace_id,mode,
    expires_at,started_at,attempt_started_at,lease_until,released_at)
    VALUES(${runId},1,'RELEASED',1,'session-1','sess_replay','solari',NULL,${stamp(0)},${stamp(0)},${stamp(0)},${stamp(30)})`;
  // An ACQUIRED acquisition has Evidence, which `run_session_step_acquired` refuses to
  // hold without — so the adapter Session Step carries the artifact it really froze. It
  // renders as a log row rather than a screen (UX-DR25's adapter-only row).
  const adapterEvidenceId = ids.next();
  await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,
    state,required,captured_at,capture_method,capture_time_source,role)
    VALUES(${adapterEvidenceId},${runId},'adapter-extraction','accessgate',${`adapter/${runId}/1`},'application/json',
    ${'d'.repeat(64)},64,'REGISTERED',false,${stamp(2)},'adapter','registration','evidence')`;
  await sql`INSERT INTO run_session_step(run_id,step_id,ordinal,registration_id,display_name,action,state,attempts,diagnostic,evidence_id)
    VALUES(${runId},'session-2',2,'accessgate','AccessGate','extract-adapter','ACQUIRED',1,NULL,${adapterEvidenceId})`;

  // One Work Item per SUBJECT: `run_work_item_run_step` is unique on
  // `(run_id, step_id, coalesce(subject_key, ''))`, which is the shape a real agent Run has
  // — one Work Item per population record inside one plan step.
  //
  // Both carry the SAME `display_name`, because that column is the Target System's name and
  // both name registration `loancore`. The fixture used to give each one its own, which is
  // a row no Run can produce — and is why the suite could not see that the jump list was
  // labelling every Work Item with it.
  for (const [index, workItemId] of workItems.entries()) {
    await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,
      subject_key,state,attempts,cycles,diagnostic,evidence_id,observations)
      VALUES(${workItemId},${runId},'target-1-1',${index + 1},'loancore','LoanCore',
      ${`E-00010${index + 5}`},'OBSERVED',1,0,NULL,NULL,1)`;
  }

  for (const [index, evidenceId] of frames.entries()) {
    const workItemId = workItems[index < 505 ? 0 : 1]!;
    const stepExecutionId = ids.next();
    const toolActionId = ids.next();
    storage.objects.set(`screenshot/${runId}/${evidenceId}`, new Uint8Array(PNG));
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
      VALUES(${stepExecutionId},${runId},'target-1-1',${workItemId},'inspect-record','SUCCEEDED',1,${stamp(index * 10)})`;
    await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
      action,method,destination,parameters,outcome,status,redirected,downloads,started_at,completed_at,capture)
      VALUES(${toolActionId},${runId},${stepExecutionId},${index < 505 ? workItemId : null},'agent','loancore','read-attribute','GET',
      ${LOCATIONS[index < 505 ? 0 : 1]!},'[]'::jsonb,'performed',200,false,0,${stamp(index * 10)},${stamp(index * 10 + 1)},'PERMITTED')`;
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,
      state,required,captured_at,capture_method,capture_time_source,role)
      VALUES(${evidenceId},${runId},'screenshot','loancore',${`screenshot/${runId}/${evidenceId}`},'image/png',
      ${DIGEST},${PNG.byteLength},'REGISTERED',false,${stamp(index * 10)},'agent','registration','evidence')`;
    await sql`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
      VALUES(${evidenceId},${runId},${toolActionId},${LOCATIONS[index < 505 ? 0 : 1]!})`;
  }

  // The Observation delta, appended to the Run's own chain through the real writer.
  await new PostgresRunsUnitOfWork(createDb(sql)).execute(async (context) => {
    const event = await context.auditEvents.append({
      actor: { type: 'system', id: 'observation-registrar' },
      eventType: 'execution.observations-registered',
      source: 'worker',
      outcome: 'success',
      aggregateId: runId,
      correlationId: ids.next(),
      sessionId: 'replay-fixture',
      payload: { workItemId: workItems[1]!, registrationId: 'loancore', schemaVersion: 1, registered: 1 },
    });
    await context.notifyTimeline(runId, event.sequence);
  });

  // Terminal, sealed. Two statements, because postgres.js autocommits each one and
  // generation 21's DEFERRED trigger fires at the end of the second.
  await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
    VALUES(${runId},'SEALED','COMPLETED',now(),0,611,'[]'::jsonb,'[]'::jsonb)`;
  await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
    VALUES(${runId},1,'CONTROL_FAILURE','control-failure',true,'COMPLETED',true,now(),NULL,'{}'::jsonb)`;
  await sql`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${runId}`;
  // The Run has ended, so its agent phase has too: a live claim on a terminal Run is a
  // state no worker leaves behind. Written after the terminal transition, because a
  // TERMINAL agent phase on a RUNNING Run is exactly what the adapter sweep selects.
  await sql`UPDATE run_agent_execution SET status='TERMINAL' WHERE run_id=${runId}`;

  return { runId, frames, workItems, recordKey };
}
test.beforeAll(async () => {
  test.setTimeout(120_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('Replay browser verification requires its isolated database.');
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
      // An Exception is permanent while its Observation exists (generation 23), so the
      // Observation is what carries it away.
      await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
      await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
      await sql`DELETE FROM run_tool_action WHERE run_id=${runId}`;
      await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
      // The held-Run checkpoints seeded above, and the population rows a sweep that DID
      // claim a Run would leave — so a fixture that lost that race still cleans up after
      // itself instead of taking every later delete in this loop with it.
      await sql`DELETE FROM run_agent_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM population_row WHERE run_id=${runId}`;
      await sql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
      await sql`DELETE FROM population_evidence WHERE run_id=${runId}`;
      await sql`DELETE FROM population_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
      await sql`DELETE FROM notification WHERE run_id=${runId}`;
      await sql`DELETE FROM run_wait WHERE run_id=${runId}`;
      await sql`DELETE FROM run_workspace WHERE run_id=${runId}`;
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

test.describe('an inspection beyond the first 500 Replay captures', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('decodes the exact protected late frame, reloads and pages paused, refuses foreign identity and failed bytes', async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    const seeded = await seedReplayRun();
    // The other Run has no capture. Its Work Item is real, and still cannot be selected here.
    const foreignRun = ids.next(), foreignWork = ids.next();
    // Held, and committed WITH its population checkpoint: a QUEUED Run with no checkpoint is
    // exactly what the real worker's population recovery sweep picks up, and a sweep that
    // took this Run would end it at a moment nobody chose — a run-ending event mid-walk.
    // It ends below, when this test says so, through the real cancel command.
    const held = new Date(Date.now() + 3_600_000).toISOString();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
        procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
        VALUES(${ids.next()},${foreignRun},${ids.next()},${procedureId},${versionId},1,${controlName},
        '2026-07-28','2026-07-28','QUEUED','STANDARD',${author},'selected-replay-foreign','auditor',now())`;
      await tx`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,step_id,attempt_id)
        VALUES(${foreignRun},1,'POPULATION_READY',1,now(),now(),${held},'session-1',${ids.next()})`;
    });
    runs.push(foreignRun);
    await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,subject_key,state,attempts,cycles,observations)
      VALUES(${foreignWork},${foreignRun},'target-1-1',1,'loancore','LoanCore','E-FOREIGN','OBSERVED',1,0,0)`;
    const origin = new URL(baseURL!).origin, offOrigin: string[] = [], errors: string[] = [];
    const imageRequests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) {
        offOrigin.push(url.origin); await route.abort(); return;
      }
      if (url.pathname.startsWith(`/api/runs/${seeded.runId}/frames/`)) imageRequests.push(url.pathname);
      await route.fallback();
    });
    const before = await sql`SELECT state, revision FROM audit_run WHERE run_id=${seeded.runId}`;
    const events = await sql`SELECT event_id, sequence, event_type FROM audit_events
      WHERE aggregate_id=${seeded.runId} AND event_type NOT LIKE 'evidence-access.%' ORDER BY sequence`;
    const href = `/runs/${seeded.runId}/replay?workItem=${seeded.workItems[1]}`;
    const frame = page.locator('.ls-session__frame');
    const assertFrame = async (index: number) => {
      await expect(frame).toHaveAttribute('src', `/api/runs/${seeded.runId}/frames/${seeded.frames[index]}`);
      await expect.poll(() => frame.evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 30_000 }).toBe(1);
      await expect(page.getByText(`Frame ${index + 1} of 610`, { exact: false })).toBeVisible();
    };
    // Follow the real prefix builder's Work Item link, rather than constructing the
    // selected URL as the first user action. This scene has Work Items, no source queue.
    await page.goto(`/runs/${seeded.runId}/replay`);
    const lateJump = page.locator('.ls-session__jumps li').filter({ hasText: 'Work Item · E-000106' });
    await expect(lateJump.getByRole('link', { name: 'Open inspection Replay', exact: true })).toHaveAttribute('href', href);
    imageRequests.length = 0;
    await lateJump.getByRole('link', { name: 'Open inspection Replay', exact: true }).click();
    await assertFrame(505);
    await expect(page.getByRole('heading', { name: 'Selected inspection: E-000106 · LoanCore' })).toBeVisible();
    // The rail names the record and counts in words (UX-28, UX-31).
    await expect(page.getByText('Record: E-000106 · LoanCore', { exact: true })).toBeVisible();
    await expect(page.getByText(REPLAY_COPY.observationsThrough.replace('{count}', '1 Observation'), { exact: true })).toBeVisible();
    await expect(page.getByText('Inspection frames 1–100 of 105.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(page.getByText('Showing the first', { exact: false })).toHaveCount(0);
    await page.reload(); await assertFrame(505);
    expect(imageRequests.every(path => path.endsWith(seeded.frames[505]!))).toBe(true);

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(frame).toHaveAttribute('src', `/api/runs/${seeded.runId}/frames/${seeded.frames[506]}`); // the timer really advanced
    await page.getByRole('link', { name: 'Next inspection frames', exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${href}&cursor=100`);
    await assertFrame(605);
    await expect(page.getByText('Inspection frames 101–105 of 105.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Next inspection frames', exact: true })).toHaveCount(0);
    const viewer = page.getByRole('group', { name: REPLAY_COPY.viewerLabel, exact: true });
    await viewer.focus(); await viewer.press('End'); await assertFrame(609);
    await viewer.press('Home'); await assertFrame(605);
    await viewer.press('ArrowRight'); await assertFrame(606);
    await viewer.press('End'); await viewer.press('ArrowLeft'); await assertFrame(608);
    // Any Run ending anywhere makes the shell's bell re-read this page (BellLive). The
    // re-read must leave the reader on the frame they chose: with the read time in the
    // viewer's key it restarted at this page's first frame, which is how this spec failed
    // on the live branch whenever another Run happened to end mid-walk. Here a real
    // run-ending event, from the real cancel command on the other Run, drives it.
    const readAt = page.locator('p.ls-caption', { hasText: 'Read at' }).locator('time');
    const readBefore = await readAt.getAttribute('datetime');
    expect(readBefore).not.toBeNull();
    await page.evaluate(() => { (window as unknown as { __viewer: Element | null }).__viewer = document.querySelector('.ls-session'); });
    expect(await cancelRun(cancelDependencies(), { session: { userId: author, sessionId: 'selected-replay-cancel' },
      request: { runId: foreignRun, reason: null } })).toEqual({ ok: true, state: 'CANCELED', pending: false });
    await expect(readAt).not.toHaveAttribute('datetime', readBefore ?? '', { timeout: 15_000 });
    expect(await page.evaluate(() => document.querySelector('.ls-session')
      === (window as unknown as { __viewer: Element | null }).__viewer)).toBe(true);
    await assertFrame(608);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await assertFrame(609);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await assertFrame(609);
    await page.getByRole('link', { name: 'Previous inspection frames', exact: true }).click(); await assertFrame(505);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

    for (const query of [`workItem=${foreignWork}`, `workItem=${seeded.workItems[1]}&cursor=200`,
      `workItem=${seeded.workItems[1]}&cursor=100&cursor=100`]) {
      imageRequests.length = 0;
      await page.goto(`/runs/${seeded.runId}/replay?${query}`);
      await expect(page.getByRole('status')).toContainText('The requested inspection is not available');
      await expect(frame).toHaveCount(0); expect(imageRequests).toEqual([]);
    }
    expect((await page.request.get(`/api/runs/${foreignRun}/frames/${seeded.frames[505]}`)).status()).toBe(404);
    expect(await sql`SELECT state, revision FROM audit_run WHERE run_id=${seeded.runId}`).toEqual(before);
    expect(await sql`SELECT event_id, sequence, event_type FROM audit_events WHERE aggregate_id=${seeded.runId}
      AND event_type NOT LIKE 'evidence-access.%' ORDER BY sequence`).toEqual(events);

    // The next image is not cached from prior steps. Stored bytes now disagree with the
    // registered digest, so the protected route must refuse and Replay must clear its stage.
    storage.objects.set(`screenshot/${seeded.runId}/${seeded.frames[580]}`, new Uint8Array([1, 2, 3]));
    await page.goto(href); await assertFrame(505);
    const refused = page.waitForResponse(response => response.url().endsWith(`/frames/${seeded.frames[580]}`));
    await page.getByRole('button', { name: /^Frame 581 of 610:/ }).click();
    expect((await refused).status()).toBe(502);
    await expect(page.getByText('This recorded frame could not be read from Evidence storage. Its Evidence record is unchanged.', { exact: true })).toBeVisible();
    await expect(frame).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(page.getByText('Frame 581 of 610', { exact: false })).toBeVisible();
    await expect(page.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    // The frame's facts stay when its bytes are refused. The UI cleanup moved them out of
    // one caption line (UX-28): where and when the screen was captured is its own section,
    // and the integrity digest is under the rail's Technical details.
    const source = page.getByRole('region', { name: 'Where this screen was captured', exact: true });
    await expect(source).toContainText(LOCATIONS[1]!);
    await expect(source).toContainText('Captured');
    await expect(page.locator('details.ls-technical', { has: page.locator('dt', { hasText: 'Frame integrity digest' }) }))
      .toContainText(DIGEST);
    storage.objects.set(`screenshot/${seeded.runId}/${seeded.frames[580]}`, new Uint8Array(PNG));
    imageRequests.length = 0;
    await page.getByRole('button', { name: 'Retry this frame', exact: true }).click();
    await assertFrame(580);
    expect(imageRequests).toEqual([`/api/runs/${seeded.runId}/frames/${seeded.frames[580]}`]);
    expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
    await viewer.focus(); await viewer.press('ArrowRight'); await assertFrame(581);
    // A fresh request after role revocation must refuse, including a subsequent image
    // within this already-open page and a newly requested inspection page.
    const [role] = await sql<{ role: string; assigned_by: string | null; assigned_at: string }[]>`
      SELECT role, assigned_by, assigned_at::text FROM user_role WHERE user_id=${author}`;
    if (!role) throw new Error('The fixture Auditor role is missing');
    try {
      await sql`DELETE FROM user_role WHERE user_id=${author}`;
      expect((await page.request.get(`/api/runs/${seeded.runId}/frames/${seeded.frames[583]}`)).status()).toBe(403);
      const denied = page.waitForResponse(response => response.url().endsWith(`/frames/${seeded.frames[582]}`));
      await viewer.press('ArrowRight');
      expect((await denied).status()).toBe(403);
      await expect(frame).toHaveCount(0);
      await expect(page.getByRole('status')).toContainText('This recorded frame could not be read');
      imageRequests.length = 0;
      await page.goto(`${href}&cursor=100`);
      await expect(page.getByRole('alert').first()).toBeVisible();
      await expect(frame).toHaveCount(0); expect(imageRequests).toEqual([]);
      await expect(page.getByRole('heading', { name: /^Selected inspection:/ })).toHaveCount(0);
    } finally {
      await sql`INSERT INTO user_role(user_id,role,assigned_at,assigned_by)
        VALUES(${author},${role.role},${role.assigned_at}::timestamptz,${role.assigned_by})
        ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,assigned_at=excluded.assigned_at,assigned_by=excluded.assigned_by`;
    }
    // This measures browser destinations. It is not server/worker network telemetry.
    expect(offOrigin).toEqual([]); expect(errors).toEqual([]);
    expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
  });

  test('follows the actual record-review inspection link and distinguishes its empty retained capture set', async ({ page }) => {
    test.setTimeout(120_000);
    const fixture = await createRecordReviewBrowserFixture();
    try {
      await page.goto(`/runs/${fixture.runId}/evidence?selected=1`);
      const replay = page.getByRole('link', { name: 'Replay this inspection', exact: true });
      const href = await replay.getAttribute('href');
      const [owner] = await fixture.sql<{ work_item_id: string }[]>`SELECT work_item_id FROM run_work_item WHERE run_id=${fixture.runId}`;
      expect(href).toBe(`/runs/${fixture.runId}/replay?workItem=${owner!.work_item_id}`);
      await replay.click();
      await expect(page.getByRole('heading', { name: /^Selected inspection:/ })).toBeVisible();
      await expect(page.getByRole('status')).toContainText('No retained capture exists for this inspection');
      await expect(page.locator('.ls-session__frame')).toHaveCount(0);
      await page.reload();
      await expect(page).toHaveURL(new URL(href!, page.url()).toString());
      await expect(page.getByRole('status')).toContainText('No retained capture exists for this inspection');
    } finally { await fixture.cleanup(); }
  });

});
