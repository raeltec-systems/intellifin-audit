import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { raiseEscalation } from '@intellifin/application';
import { sha256HexOfBytes } from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  PostgresRunsUnitOfWork,
  PostgresWaitRepository,
  SystemClock,
  type Sql,
} from '@intellifin/infrastructure';

import { REPLAY_COPY } from '../../apps/web/src/design/copy';
import { activeRunVersion } from '../fixtures/active-run-version';
import { startSyntheticS3 } from '../fixtures/s3-server';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * Replay in a real browser, with the Workspace Provider BLOCKED AT THE NETWORK
 * (Story 5.8, FR-30, UX-DR24, UX-DR26, UX-DR37, AD-12, addendum §F).
 *
 * The block is the point of the file. FR-30 says a terminal Run replays from assets the
 * platform owns even when the provider's own recording has expired or its host cannot be
 * reached, and the only honest way to assert that is to make every destination but this
 * application's own origin fail, then require the surface to render whole. Anything the
 * page tried to fetch elsewhere is aborted AND counted, so a later change that reached for
 * a provider would fail here rather than in a deployment whose provider happened to answer.
 *
 * The frame read itself is entirely real: the `<img>` hits the Run's own protected route,
 * which authorizes, requests a durable Evidence read grant, waits for the PRODUCTION
 * WORKER to sign it, downloads from the synthetic object store and verifies the registered
 * digest before answering PNG bytes.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const controlName = `E2E Replay ${procedureId}`;

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

interface Replayed {
  readonly runId: string;
  readonly frames: readonly string[];
  readonly workItems: readonly string[];
  readonly recordKey: string;
  readonly waitKind: string;
}

/**
 * A terminal Run with three frames across two Work Items, one Exception and one answered
 * Escalation — one of everything the jump list names.
 */
async function seedReplayRun(): Promise<Replayed> {
  const runId = ids.next();
  const at = Date.now();
  const stamp = (offsetSeconds: number): string => new Date(at + offsetSeconds * 1_000).toISOString();
  const day = String(runs.length + 1).padStart(2, '0');
  const workItems = [ids.next(), ids.next()];
  const frames = [ids.next(), ids.next(), ids.next()];
  const recordKey = 'E-000106';

  await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
    procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
    VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,${controlName},
    ${`2026-07-${day}`},${`2026-07-${day}`},'RUNNING','STANDARD',${author},'replay-fixture','auditor',${stamp(0)})`;
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
  for (const [index, workItemId] of workItems.entries()) {
    await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,
      subject_key,state,attempts,cycles,diagnostic,evidence_id,observations)
      VALUES(${workItemId},${runId},'target-1-1',${index + 1},'loancore',${`Leaver ${index + 1}`},
      ${`E-00010${index + 5}`},'OBSERVED',1,0,NULL,NULL,1)`;
  }

  let observationStepExecutionId = '';
  for (const [index, evidenceId] of frames.entries()) {
    const workItemId = workItems[index === 0 ? 0 : 1]!;
    const stepExecutionId = ids.next();
    observationStepExecutionId = stepExecutionId;
    const toolActionId = ids.next();
    storage.objects.set(`screenshot/${runId}/${evidenceId}`, new Uint8Array(PNG));
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
      VALUES(${stepExecutionId},${runId},'target-1-1',${workItemId},'inspect-record','SUCCEEDED',1,${stamp(index * 10)})`;
    await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
      action,method,destination,parameters,outcome,status,redirected,downloads,started_at,completed_at,capture)
      VALUES(${toolActionId},${runId},${stepExecutionId},${workItemId},'agent','loancore','read-attribute','GET',
      ${LOCATIONS[index]!},'[]'::jsonb,'performed',200,false,0,${stamp(index * 10)},${stamp(index * 10 + 1)},'PERMITTED')`;
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,
      state,required,captured_at,capture_method,capture_time_source,role)
      VALUES(${evidenceId},${runId},'screenshot','loancore',${`screenshot/${runId}/${evidenceId}`},'image/png',
      ${DIGEST},${PNG.byteLength},'REGISTERED',false,${stamp(index * 10)},'agent','registration','evidence')`;
    await sql`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
      VALUES(${evidenceId},${runId},${toolActionId},${LOCATIONS[index]!})`;
  }

  // An Escalation, raised through the real command between the second and third frames,
  // so its jump target is decided by the stored instant and not by a number in this file.
  await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${runId}`;
  const raised = await raiseEscalation(
    { repository: new PostgresWaitRepository(createDb(sql)), ids, clock: { now: () => new Date(at + 15_000) } },
    {
      runId,
      kind: 'choose-candidate',
      options: [
        { id: 'candidate-a', label: 'Alice A' },
        { id: 'mark-ambiguous', label: 'ignored persisted label' },
      ],
      stepId: 'target-1-1',
      supportingEvidenceIds: [frames[1]!],
    },
  );
  if (!raised.ok) throw new Error(`Replay fixture could not raise its Escalation: ${raised.reason}`);
  await sql`UPDATE run_wait SET closed_at=${stamp(20)}, closure_kind='answer', answer_option_id='candidate-a',
    actor=${author} WHERE wait_id=${raised.wait.waitId}`;

  // One Observation and the Exception raised against it.
  const observationId = ids.next();
  await sql`INSERT INTO run_observation(observation_id,run_id,work_item_id,step_execution_id,target_system,
    population_record_key,schema_version,capture_method,match_origin,digest,observed_at_source,found,
    coverage,corroboration,identity,attributes,evidence_ids,observed_at)
    VALUES(${observationId},${runId},${workItems[1]!},${observationStepExecutionId},'loancore',
    ${recordKey},1,'agent','platform',${'b'.repeat(64)},${stamp(12)},'true',
    'COVERED','MATCHED',${'{"locator":"$.rows[0].id","corroboration":"matched"}'}::jsonb,'[]'::jsonb,
    ${JSON.stringify([frames[1]])}::jsonb,${stamp(12)})`;
  await sql`INSERT INTO run_exception(exception_id,run_id,observation_id,work_item_id,target_system,
    population_record_key,condition_ids,diagnostics,fingerprint,fingerprint_key_id,raised_at)
    VALUES(${ids.next()},${runId},${observationId},${workItems[1]!},'loancore',${recordKey},
    '["C1"]'::jsonb,'[]'::jsonb,${'c'.repeat(64)},'e2e-key',${stamp(12)})`;

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
    VALUES(${runId},'SEALED','COMPLETED',now(),0,3,'[]'::jsonb,'[]'::jsonb)`;
  await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
    VALUES(${runId},1,'CONTROL_FAILURE','control-failure',true,'COMPLETED',true,now(),NULL,'{}'::jsonb)`;
  await sql`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${runId}`;

  return { runId, frames, workItems, recordKey, waitKind: 'choose-candidate' };
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

test.describe('Replay with the Workspace Provider unreachable', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('renders the whole Run from platform-owned assets, and reaches nothing else', async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    const seeded = await seedReplayRun();

    // EVERY destination but this application's own origin fails, and each attempt is
    // recorded. This is FR-30's "with the provider blocked at the network" made literal.
    const offOrigin: string[] = [];
    const origin = new URL(baseURL!).origin;
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) { await route.fallback(); return; }
      offOrigin.push(url);
      await route.abort();
    });

    await page.goto(`/runs/${seeded.runId}/replay`);
    await expect(page.getByRole('heading', { name: /^Replay · / })).toBeVisible();
    await expect(page.getByText('REPLAY', { exact: true })).toBeVisible();

    // Paused at the FIRST frame (UX-DR26), and the frame really loaded: the route signed a
    // grant, downloaded the object and verified the registered digest to answer it.
    await expect(page.getByRole('button', { name: REPLAY_COPY.play, exact: true })).toBeVisible();
    await expect(page.getByText('Frame 1 of 3')).toBeVisible();
    const frame = page.locator('.ls-session__frame');
    await expect(frame).toHaveAttribute('src', `/api/runs/${seeded.runId}/frames/${seeded.frames[0]}`);
    await expect.poll(async () => frame.evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 30_000 }).toBe(1);
    // The frame's own sentence is its Step's (UX-DR37).
    const alt = await frame.getAttribute('alt');
    expect(alt).toBeTruthy();
    await expect(page.getByText(alt!, { exact: true }).first()).toBeVisible();

    // The jump list names one of each thing EXPERIENCE.md's Replay row lists.
    await expect(page.getByRole('button', { name: /^Work Item · Leaver 1$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: `Exception · ${seeded.recordKey}` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Escalation · ${seeded.waitKind}` })).toBeVisible();

    // The auditor's own frozen words, verbatim.
    await expect(page.getByRole('heading', { name: 'Audit Instructions', exact: true })).toBeVisible();
    await expect(page.getByText('Read all baseline parameters.')).toBeVisible();

    const scan = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([]);

    // Nothing left this origin. Not for a provider, not for a recording, not for a font.
    expect(offOrigin).toEqual([]);
  });

  test('steps, plays and jumps from the keyboard alone', async ({ page }) => {
    test.setTimeout(120_000);
    const seeded = await seedReplayRun();
    await page.goto(`/runs/${seeded.runId}/replay`);
    await expect(page.getByText('Frame 1 of 3')).toBeVisible();

    // Arrow keys step frames when the VIEWER has focus (UX-DR24).
    const viewer = page.getByRole('group', { name: REPLAY_COPY.viewerLabel });
    await viewer.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('Frame 2 of 3')).toBeVisible();
    await expect(page.locator('.ls-session__frame')).toHaveAttribute('src', `/api/runs/${seeded.runId}/frames/${seeded.frames[1]}`);
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText('Frame 1 of 3')).toBeVisible();
    await page.keyboard.press('End');
    await expect(page.getByText('Frame 3 of 3')).toBeVisible();
    await page.keyboard.press('Home');
    await expect(page.getByText('Frame 1 of 3')).toBeVisible();

    // Space toggles play and pause, and playing really advances the session.
    await page.keyboard.press(' ');
    await expect(page.getByRole('button', { name: REPLAY_COPY.pause, exact: true })).toBeVisible();
    await expect(page.getByText('Frame 2 of 3')).toBeVisible({ timeout: 15_000 });
    await viewer.focus();
    await page.keyboard.press(' ');
    await expect(page.getByRole('button', { name: REPLAY_COPY.play, exact: true })).toBeVisible();

    // Space and Enter on a scrubber pill jump, because a pill is a real button. Space on
    // the pill must NOT also toggle playback: one keystroke, one thing.
    const pills = page.locator('.ls-scrubber-pill');
    await expect(pills).toHaveCount(3);
    await pills.nth(2).focus();
    await page.keyboard.press(' ');
    await expect(page.getByText('Frame 3 of 3')).toBeVisible();
    await expect(page.getByRole('button', { name: REPLAY_COPY.play, exact: true })).toBeVisible();
    await pills.nth(0).press('Enter');
    await expect(page.getByText('Frame 1 of 3')).toBeVisible();

    // A jump row lands where the asset set says it should: the Escalation was raised
    // between the second and third frames, so it opens the SECOND.
    await page.getByRole('button', { name: `Escalation · ${seeded.waitKind}` }).press('Enter');
    await expect(page.locator('.ls-session__frame')).toHaveAttribute('src', `/api/runs/${seeded.runId}/frames/${seeded.frames[1]}`);
  });

  test('offers Replay from a terminal Run’s rail, and says a live Run has none yet', async ({ page }) => {
    const seeded = await seedReplayRun();
    await page.goto(`/runs/${seeded.runId}`);
    const replay = page.getByRole('link', { name: 'Replay', exact: true });
    await expect(replay).toHaveAttribute('href', `/runs/${seeded.runId}/replay`);
    await expect(page.getByRole('link', { name: 'Watch', exact: true })).toHaveCount(0);
    await replay.click();
    await expect(page).toHaveURL(new RegExp(`/runs/${seeded.runId}/replay$`));

    // A Run that has not finished is WATCHED, not replayed, and the surface says which.
    await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${seeded.runId}`;
    await page.goto(`/runs/${seeded.runId}/replay`);
    await expect(page.getByText(REPLAY_COPY.notTerminal)).toBeVisible();
    await expect(page.locator('.ls-session__frame')).toHaveCount(0);
    await sql`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${seeded.runId}`;
  });
});

test.describe('Replay as an administrator', () => {
  test.use({ storageState: AUTH_STATE.administrator });

  test('authorizes for ITSELF, before any Run fact reaches the page', async ({ page }) => {
    // Replay is its own route, so reaching Run Detail is not a precondition for reading
    // it and being refused Run Detail is not a precondition for being refused this. The
    // sentence is the gating table's own, and nothing about the Run is rendered beside it.
    const seeded = await seedReplayRun();
    await page.goto(`/runs/${seeded.runId}/replay`);
    await expect(page.getByText('PoC Administrator cannot author Procedures or start Runs.', { exact: true })).toBeVisible();
    await expect(page.getByText(controlName)).toHaveCount(0);
    await expect(page.locator('.ls-session')).toHaveCount(0);
  });
});
