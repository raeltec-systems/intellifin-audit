import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { POPULATION_CHECK_NAMES, ZERO_HASH, createCanonicalAuditEvent, sha256HexOfBytes } from '@intellifin/domain';
import {
  computeAuditEventHash,
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresAuditChainReader,
  PostgresProceduresUnitOfWork,
  type Sql,
} from '@intellifin/infrastructure';

import { REPLAY_COPY } from '../../apps/web/src/design/copy';
import { REPLAY_BOUND_WORDS, replayJumpBoundSentence } from '../../apps/web/src/runs/replay';
import { activeRunVersion } from '../fixtures/active-run-version';
import { startSyntheticS3 } from '../fixtures/s3-server';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase } from './accounts';

/**
 * Replay past every bound its default view reads with (Story 10.9, legacy 5.8).
 *
 * One terminal P-4 Run holds more of everything than one page: 520 frames, 510 Escalations
 * (and two pauses, which are not Escalations), 600 Exceptions raised in the reverse of the
 * record order, and 600 Observation registrations. The default view used to read the first
 * 500 of each and say nothing, so the count beside a frame stopped at 500 and the jump
 * list read as every question and Exception the Run had. The journey here: the view says
 * what it covers in the owner's words, the count is exact, an Escalation whose frame lies
 * past the frames read opens the inspection page that holds it, and an Exception the list
 * does not name is reached the way the sentence says -- its record in the record review,
 * then Replay. Every destination but the application's own origin is refused and counted.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const runId = ids.next();
const workItemId = ids.next();
const TARGET = '018f0000-0000-7000-8000-0000000000a1';
const BASE = Date.parse('2026-09-10T09:00:00.000Z');
const stamp = (seconds: number): string => new Date(BASE + seconds * 1_000).toISOString();

const FRAMES = 520;
const ESCALATIONS = 510;
const PAUSES = 2;
const RECORDS = 600;
const REGISTRATIONS = 600;
const SHOWN = 500;

// A one-pixel PNG. Real bytes, so the frame route's media-type and digest checks are real.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const DIGEST = sha256HexOfBytes(new Uint8Array(PNG));
const LOCATION = 'https://prodconsole.invalid/configuration';
const key = (ordinal: number): string => `parameter-${String(ordinal).padStart(4, '0')}`;

let sql: Sql;
let storage: Awaited<ReturnType<typeof startSyntheticS3>>;
let stopWorker: (() => Promise<void>) | undefined;
let workerLog = '';
let author = '';
const frames: { readonly evidenceId: string; readonly stepExecutionId: string; readonly toolActionId: string }[] = [];

async function scan(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const violations = result.violations.map((violation) => ({
    id: violation.id, impact: violation.impact, nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

/**
 * The whole terminal Run in ONE transaction. The spec's own worker is up (frame grants
 * need it), so a Run it could see half-written would be one its recovery sweeps might
 * claim; committed whole, it is never visible as anything but a sealed, completed Run.
 */
async function seedBoundedRun(): Promise<void> {
  const version = activeRunVersion(procedureId, versionId, author);
  const plan = version.compiledPlan;
  if (plan === null) throw new Error('The bounded Replay fixture could not derive its frozen plan.');
  const target = plan.targetSystems.find((entry) => entry.registrationId === TARGET);
  const inspectStep = target?.planSteps.find((step) => step.action === 'inspect-record');
  const signInStep = plan.sessionSteps.find((step) => step.action === 'sign-in' && step.targetSystemId === TARGET);
  if (!inspectStep || !signInStep) throw new Error('The P-4 fixture plan is missing its frozen Target step mapping.');
  const conditionIds = plan.inputs.complianceConditions.map((condition) => condition.conditionId);
  await new PostgresProceduresUnitOfWork(createDb(sql)).execute(async (context) => {
    await context.procedures.insertProcedure(version);
    await context.procedures.insertVersion(version);
  });

  for (let index = 0; index < FRAMES; index += 1) frames.push({ evidenceId: ids.next(), stepExecutionId: ids.next(), toolActionId: ids.next() });
  // The bytes are in storage BEFORE the Run commits: the worker's integrity sweep verifies
  // a sealed package's artifacts, and a missing object would be a permanent finding.
  for (const frame of frames) storage.objects.set(`screenshot/${runId}/${frame.evidenceId}`, new Uint8Array(PNG));
  const frameJson = JSON.stringify(frames.map((frame, index) => ({
    evidence_id: frame.evidenceId, step_execution_id: frame.stepExecutionId, tool_action_id: frame.toolActionId,
    at: stamp((index + 1) * 10),
  })));
  const first = frames[0]!;

  // Escalation i lands on frame i + 10. The first 500 RAISED are listed; of those, the last
  // ten land on frames 501..510, past the 500 frames the view reads.
  const waits = [
    ...Array.from({ length: PAUSES }, (_, index) => ({ wait_id: ids.next(), kind: 'pause', opened_at: stamp(index + 1),
      opened_by: author, closure_kind: 'resume', answer_option_id: 'resume' })),
    ...Array.from({ length: ESCALATIONS }, (_, index) => ({ wait_id: ids.next(), kind: 'choose-candidate',
      opened_at: stamp((index + 11) * 10 + 5), opened_by: null, closure_kind: 'answer', answer_option_id: 'candidate-a' })),
  ];

  // Record n's Exception is raised at 20,000 - n seconds, so the first 500 RAISED are the
  // records 600 down to 101 and records 1..100 are the ones the list does not name.
  const attribute = (name: string, value: string, locator: string) => ({
    name, originalValue: value, normalizedValue: value,
    grounding: { evidenceId: first.evidenceId, locator, label: name, extractedText: value }, corroboration: 'matched',
  });
  const records = Array.from({ length: RECORDS }, (_, index) => {
    const ordinal = index + 1;
    const observedAt = stamp(ordinal);
    return {
      ordinal, key: key(ordinal), observation_id: ids.next(), exception_id: ids.next(), observed_at: observedAt,
      observed_at_source: observedAt, raised_at: stamp(20_000 - ordinal),
      identity: attribute('parameter', key(ordinal), `$.parameters[${index}].parameter`),
      attributes: [
        attribute('observed_value', 'legacy', `$.parameters[${index}].observed_value`),
        attribute('approved_value', 'approved', `$.parameters[${index}].approved_value`),
        attribute('observation_time', observedAt, `$.parameters[${index}].observation_time`),
      ],
    };
  });
  const recordJson = JSON.stringify(records);

  // 120 registrations after each of the first five frames: 600 in all, so from the sixth
  // frame on the Run had registered 600 -- more than a page of 500 events could ever sum.
  const events: { readonly occurredAt: string }[] = [];
  for (let frame = 1; frame <= 5; frame += 1)
    for (let entry = 0; entry < REGISTRATIONS / 5; entry += 1) events.push({ occurredAt: stamp(frame * 10 + 1) });
  let hash = ZERO_HASH;
  const chain = events.map((event, index) => {
    const canonical = createCanonicalAuditEvent({
      actor: { type: 'system', id: 'observation-registrar' }, eventType: 'execution.observations-registered',
      source: 'worker', outcome: 'success', aggregateId: runId, correlationId: ids.next(), sessionId: 'replay-bounded-history',
      payload: { workItemId, registrationId: TARGET, schemaVersion: 1, registered: 1 },
    }, { eventId: ids.next(), sequence: index + 1, occurredAt: event.occurredAt });
    const previousHash = hash;
    hash = computeAuditEventHash(previousHash, canonical);
    return { event_id: canonical.eventId, actor_type: canonical.actor.type, actor_id: canonical.actor.id,
      event_type: canonical.eventType, occurred_at: canonical.occurredAt, source: canonical.source,
      outcome: canonical.outcome, session_id: canonical.sessionId, correlation_id: canonical.correlationId,
      aggregate_id: canonical.aggregateId, sequence: canonical.sequence, payload: canonical.payload,
      previous_hash: previousHash, event_hash: hash };
  });

  await sql.begin(async (tx) => {
    await tx`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
      procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,${version.controlName},
      '2026-08-01','2026-08-31','RUNNING','STANDARD',${author},'replay-bounded-history','auditor',${stamp(0)})`;

    // The frozen Population Source the record review projects over.
    await tx`INSERT INTO population_snapshot(run_id,included,excluded,indeterminate,rows_digest,checks,generated_at,
      declared_count,retrieved_count)
      VALUES(${runId},${RECORDS},0,0,${'a'.repeat(64)},
      ${JSON.stringify(POPULATION_CHECK_NAMES.map((name) => ({ name, passed: true })))}::text::jsonb,
      '2026-09-01T00:00:00.000Z',${RECORDS},${RECORDS})`;
    await tx`INSERT INTO population_row(run_id,ordinal,values,disposition,reasons)
      SELECT ${runId}::uuid, r.ordinal, jsonb_build_object('parameter', r.key), 'included', '[]'::jsonb
      FROM jsonb_to_recordset(${recordJson}::text::jsonb) AS r(ordinal int, key text)`;
    await tx`INSERT INTO run_session_step(run_id,step_id,ordinal,registration_id,display_name,action,state,attempts,diagnostic,evidence_id)
      VALUES(${runId},${signInStep.id},${plan.sessionSteps.indexOf(signInStep) + 1},${TARGET},'ProdConsole','sign-in','ACQUIRED',1,NULL,NULL)`;

    // P-4 inspects a page, so ONE Work Item with no subject of its own holds every frame.
    await tx`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,subject_key,registration_id,display_name,state,
      attempts,cycles,diagnostic,evidence_id,observations)
      VALUES(${workItemId},${runId},${inspectStep.id},1,NULL,${TARGET},'ProdConsole','OBSERVED',1,0,NULL,NULL,${RECORDS})`;
    await tx`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at,completed_at)
      SELECT f.step_execution_id, ${runId}::uuid, ${inspectStep.id}, ${workItemId}::uuid, 'inspect-record', 'SUCCEEDED', 1, f.at, f.at
      FROM jsonb_to_recordset(${frameJson}::text::jsonb) AS f(step_execution_id uuid, at timestamptz)`;
    await tx`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
      action,method,destination,parameters,outcome,status,redirected,downloads,started_at,completed_at,capture)
      SELECT f.tool_action_id, ${runId}::uuid, f.step_execution_id, ${workItemId}::uuid, 'agent', ${TARGET}, 'read-attribute', 'GET',
        ${LOCATION}, '[]'::jsonb, 'performed', 200, false, 0, f.at, f.at, 'PERMITTED'
      FROM jsonb_to_recordset(${frameJson}::text::jsonb) AS f(tool_action_id uuid, step_execution_id uuid, at timestamptz)`;
    await tx`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,
      state,required,captured_at,capture_method,capture_time_source,role)
      SELECT f.evidence_id, ${runId}::uuid, 'screenshot', ${TARGET}, ${`screenshot/${runId}/`} || f.evidence_id::text, 'image/png',
        ${DIGEST}, ${PNG.byteLength}, 'REGISTERED', false, f.at, 'agent', 'registration', 'evidence'
      FROM jsonb_to_recordset(${frameJson}::text::jsonb) AS f(evidence_id uuid, at timestamptz)`;
    await tx`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
      SELECT f.evidence_id, ${runId}::uuid, f.tool_action_id, ${LOCATION}
      FROM jsonb_to_recordset(${frameJson}::text::jsonb) AS f(evidence_id uuid, tool_action_id uuid)`;

    // Every question closed, as the product closes it.
    await tx`INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,opened_by,deadline,closed_at,closure_kind,answer_option_id,actor)
      SELECT w.wait_id, ${runId}::uuid, w.kind, '[{"id":"candidate-a","label":"Candidate A"}]'::jsonb, w.opened_at, w.opened_by,
        w.opened_at + interval '30 minutes', w.opened_at + interval '1 second', w.closure_kind, w.answer_option_id, ${author}
      FROM jsonb_to_recordset(${JSON.stringify(waits)}::text::jsonb) AS w(wait_id uuid, kind text, opened_at timestamptz,
        opened_by text, closure_kind text, answer_option_id text)`;

    // One Observation per record, each judged on every frozen condition, every check
    // passed, and each an Exception -- the shape a completed P-4 inspection registers.
    await tx`INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,
      found,observed_at,step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,
      observed_at_source,corroboration)
      SELECT r.observation_id, ${runId}::uuid, ${workItemId}::uuid, 1, r.key, ${TARGET}, 'true', r.observed_at,
        ${first.stepExecutionId}::uuid, 'agent', 'platform', r.identity, r.attributes,
        jsonb_build_array(${first.evidenceId}::text), ${'d'.repeat(64)}, 'COVERED', r.observed_at_source, 'MATCHED'
      FROM jsonb_to_recordset(${recordJson}::text::jsonb)
        AS r(observation_id uuid, key text, observed_at timestamptz, observed_at_source text, identity jsonb, attributes jsonb)`;
    await tx`INSERT INTO run_observation_evaluation(observation_id,coverage,corroboration,run_id,condition_id,origin,value,
      confirmation,confidence,rationale,diagnostic,evidence_ids)
      SELECT r.observation_id, 'COVERED', 'MATCHED', ${runId}::uuid, c.condition_id, 'RULE', 'EXCEPTION', NULL, NULL, NULL, NULL,
        jsonb_build_array(${first.evidenceId}::text)
      FROM jsonb_to_recordset(${recordJson}::text::jsonb) AS r(observation_id uuid)
      CROSS JOIN jsonb_array_elements_text(${JSON.stringify(conditionIds)}::text::jsonb) AS c(condition_id)`;
    await tx`INSERT INTO run_observation_check(observation_id,run_id,check_name,outcome,diagnostic)
      SELECT r.observation_id, ${runId}::uuid, c.check_name, 'PASS', NULL
      FROM jsonb_to_recordset(${recordJson}::text::jsonb) AS r(observation_id uuid)
      CROSS JOIN (VALUES ('identity-corroboration'), ('search-completeness'), ('ambiguous-match'),
        ('required-evidence'), ('freshness'), ('observation-corroboration')) AS c(check_name)`;
    await tx`INSERT INTO run_exception(exception_id,run_id,observation_id,work_item_id,target_system,population_record_key,
      condition_ids,diagnostics,fingerprint,fingerprint_key_id,raised_at)
      SELECT r.exception_id, ${runId}::uuid, r.observation_id, ${workItemId}::uuid, ${TARGET}, r.key,
        ${JSON.stringify(conditionIds)}::text::jsonb, '["P-4 baseline differs from the approved value."]'::jsonb,
        ${'e'.repeat(64)}, 'replay-bounded-history', r.raised_at
      FROM jsonb_to_recordset(${recordJson}::text::jsonb) AS r(exception_id uuid, observation_id uuid, key text, raised_at timestamptz)`;

    // The Run's own chain: every registration, canonical and hash-linked from the start.
    await tx`INSERT INTO audit_event_heads(aggregate_id,last_sequence,last_event_hash) VALUES(${runId},${chain.length},${hash})`;
    for (let offset = 0; offset < chain.length; offset += 300) {
      await tx`INSERT INTO audit_events(event_id,actor_type,actor_id,event_type,occurred_at,source,outcome,
        session_id,correlation_id,aggregate_id,sequence,payload,previous_hash,event_hash)
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(chain.slice(offset, offset + 300))}::text::jsonb) AS event(
          event_id uuid,actor_type text,actor_id text,event_type text,occurred_at timestamptz,source text,outcome text,
          session_id text,correlation_id text,aggregate_id text,sequence bigint,payload jsonb,previous_hash text,event_hash text)`;
    }

    // Terminal and sealed, in the same transaction the deferred triggers check at commit.
    await tx`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
      VALUES(${runId},'SEALED','COMPLETED',${stamp(30_000)},0,${FRAMES},'[]'::jsonb,'[]'::jsonb)`;
    await tx`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
      VALUES(${runId},1,'CONTROL_FAILURE','control-failure',true,'COMPLETED',true,${stamp(30_000)},${version.scope},
      ${JSON.stringify({
        templateId: version.templateId, controlName: version.controlName, period: version.period, scope: version.scope,
        population: { rowsParsed: RECORDS, included: RECORDS, excluded: 0, indeterminate: 0 },
        exclusions: [], coverage: [], conditions: [],
        exceptions: { total: RECORDS, records: [key(RECORDS)] },
        unevaluated: { total: 0, records: [] },
        controlFields: ['observed_value', 'approved_value'],
        gate: { passed: true, checks: 20, failed: [] },
        evidence: { state: 'SEALED', requiredTotal: 0, registered: FRAMES, missingRequired: 0, abandoned: 0 },
        statement: 'Every baseline parameter was inspected.',
      })}::text::jsonb)`;
    await tx`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${runId}`;
  });
  expect(await new PostgresAuditChainReader(createDb(sql)).verify(runId)).toMatchObject({ valid: true, eventCount: REGISTRATIONS });
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('Replay browser verification requires its isolated database.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the synthetic Auditor first.');
  author = String(auditor.id);
  storage = await startSyntheticS3();
  await seedBoundedRun();
  // Frame grants are worker-signed, so the real worker is up for the frame reads.
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
    await sql`DELETE FROM pgboss.job WHERE data->>'grantId' IN (SELECT grant_id::text FROM evidence_read_grant WHERE run_id=${runId})`;
    // The whole Run in one transaction, the Run locked first. An Exception is permanent
    // while its Observation exists (generation 23), so the Observation carries it away.
    await sql.begin(async (tx) => {
      await tx`SELECT run_id FROM audit_run WHERE run_id=${runId} FOR UPDATE`;
      await tx`DELETE FROM evidence_read_grant WHERE run_id=${runId}`;
      await tx`DELETE FROM run_result WHERE run_id=${runId}`;
      await tx`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
      await tx`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
      await tx`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
      await tx`DELETE FROM run_observation_check WHERE run_id=${runId}`;
      await tx`DELETE FROM run_observation WHERE run_id=${runId}`;
      await tx`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
      await tx`DELETE FROM run_tool_action WHERE run_id=${runId}`;
      await tx`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      await tx`DELETE FROM run_session_step WHERE run_id=${runId}`;
      await tx`DELETE FROM run_work_item WHERE run_id=${runId}`;
      await tx`DELETE FROM run_evidence WHERE run_id=${runId}`;
      await tx`DELETE FROM notification WHERE run_id=${runId}`;
      await tx`DELETE FROM run_wait WHERE run_id=${runId}`;
      await tx`DELETE FROM population_row WHERE run_id=${runId}`;
      await tx`DELETE FROM population_snapshot WHERE run_id=${runId}`;
      await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
      await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
    });
    await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test.describe('Replay past its default view’s bounds', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('says what it covers, counts exactly, and keeps the rest reachable', async ({ page, baseURL }) => {
    test.setTimeout(300_000);
    const origin = new URL(baseURL!).origin;
    const offOrigin: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) {
        offOrigin.push(url.origin);
        await route.abort();
        return;
      }
      await route.fallback();
    });
    const frame = page.locator('.ls-session__frame');
    const showsFrame = async (index: number): Promise<void> => {
      await expect(frame).toHaveAttribute('src', `/api/runs/${runId}/frames/${frames[index]!.evidenceId}`);
      await expect.poll(() => frame.evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 30_000 }).toBe(1);
    };

    await page.goto(`/runs/${runId}/replay`);
    const jump = page.getByRole('region', { name: 'Jump to', exact: true });
    await expect(jump).toBeVisible();
    await showsFrame(0);
    // The counter places a frame among EVERY frame the Run retained, as the inspection
    // pages do: "of 500" would present the bound as the session.
    await expect(page.getByText('Frame 1 of 520', { exact: true })).toBeVisible();

    // What the list covers, in the owner's words, with the exact totals: the two pauses
    // are not Escalations, so they are neither listed nor counted.
    await expect(jump.getByText(replayJumpBoundSentence('escalation', SHOWN, ESCALATIONS)!, { exact: true })).toBeVisible();
    await expect(jump.getByText(replayJumpBoundSentence('exception', SHOWN, RECORDS)!, { exact: true })).toBeVisible();
    await expect(jump.getByText('Showing the first 500 of 510 Escalations.', { exact: true })).toBeVisible();
    await expect(jump.getByText('Showing the first 500 of 600 Exceptions.', { exact: true })).toBeVisible();
    // One note, not three items: the two bounds and the way to the rest, in that order.
    const note = jump.locator('[data-jump-bounds]');
    await expect(note).toHaveText(
      `${replayJumpBoundSentence('escalation', SHOWN, ESCALATIONS)!} ${replayJumpBoundSentence('exception', SHOWN, RECORDS)!} ${REPLAY_BOUND_WORDS.rest}`);
    const rest = note.locator('span').last();
    await expect(rest).toHaveText(REPLAY_BOUND_WORDS.rest);
    await expect(rest.getByRole('link', { name: REPLAY_BOUND_WORDS.restLink, exact: true }))
      .toHaveAttribute('href', `/runs/${runId}/evidence`);
    // Said BEFORE the list, so a reader knows it is partial before reading it.
    const bounds = await jump.locator('[data-jump-bounds]').boundingBox();
    const list = await jump.locator('.ls-session__jumps').boundingBox();
    expect(bounds!.y).toBeLessThan(list!.y);

    // The list is exactly what the sentences say: one Work Item, 500 of each kind.
    const rows = jump.locator('.ls-session__jumps > li');
    await expect(rows).toHaveCount(1 + SHOWN + SHOWN);
    await expect(rows.filter({ hasText: /^Escalation ·/ })).toHaveCount(SHOWN);
    await expect(rows.filter({ hasText: /^Exception ·/ })).toHaveCount(SHOWN);
    // Raised first, listed; raised among the last 100, not listed. They all land on the
    // page's one frame, so they are listed as they were raised: the first raised first.
    await expect(rows.filter({ hasText: key(600) })).toHaveCount(1);
    await expect(rows.filter({ hasText: key(5) })).toHaveCount(0);
    await expect(rows.filter({ hasText: /^Exception ·/ }).first()).toHaveText(`Exception · ${key(600)}`);
    await expect(rows.filter({ hasText: /^Exception ·/ }).nth(1)).toHaveText(`Exception · ${key(599)}`);

    // The count beside a frame is EXACT. The sixth frame on had 600 registered, where a
    // page of 500 registration events stopped at 500.
    await expect(page.getByText(REPLAY_COPY.observationsThrough.replace('{count}', '0 Observations'), { exact: true })).toBeVisible();
    const viewer = page.getByRole('group', { name: REPLAY_COPY.viewerLabel, exact: true });
    await viewer.focus();
    await viewer.press('End');
    await showsFrame(SHOWN - 1);
    await expect(page.getByText('Frame 500 of 520', { exact: true })).toBeVisible();
    await expect(page.getByText(REPLAY_COPY.observationsThrough.replace('{count}', '600 Observations'), { exact: true })).toBeVisible();
    await expect(page.getByText(REPLAY_COPY.bounded.replace('{shown}', String(SHOWN)).replace('{total}', String(FRAMES)), { exact: true }))
      .toBeVisible();
    await scan(page);

    // An Escalation whose frame lies past the 500 frames read is listed, says so, and
    // opens the inspection page that HOLDS its frame -- never the last frame read.
    const late = rows.filter({ hasText: REPLAY_COPY.frameNotRead.replace('{shown}', String(SHOWN)) });
    await expect(late).toHaveCount(10);
    await expect(late.filter({ hasText: /^Escalation ·/ })).toHaveCount(10);
    await expect(late.first()).toHaveText(
      `Escalation · Choose candidate · ${REPLAY_COPY.frameNotRead.replace('{shown}', String(SHOWN))} · Open inspection Replay`);
    // A row with no frame is text, not a button, and still keeps the buttons' text edge and
    // row height, so the list has one left edge and one rhythm.
    const edge = (row: Locator) => row.evaluate((item) => {
      const box = item.firstElementChild as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(document.createTreeWalker(box, NodeFilter.SHOW_TEXT).nextNode()!);
      return { text: Math.round(range.getBoundingClientRect().left), height: Math.round(box.getBoundingClientRect().height) };
    });
    const buttonRow = rows.filter({ hasText: /^Escalation ·/ }).filter({ has: page.locator('button') }).first();
    expect(await edge(late.first())).toEqual(await edge(buttonRow));
    const inspection = `/runs/${runId}/replay?workItem=${workItemId}&cursor=500`;
    await expect(late.first().getByRole('link', { name: 'Open inspection Replay', exact: true })).toHaveAttribute('href', inspection);
    await late.first().getByRole('link', { name: 'Open inspection Replay', exact: true }).click();
    await expect(page).toHaveURL(`${origin}${inspection}`);
    await expect(page.getByText('Inspection frames 501–520 of 520.', { exact: false })).toBeVisible();
    // The first of them was raised after frame 501, so its frame is the first on this page.
    await showsFrame(SHOWN);
    await expect(page.getByText('Frame 501 of 520', { exact: false })).toBeVisible();
    await expect(page.getByText(REPLAY_COPY.observationsThrough.replace('{count}', '600 Observations'), { exact: true })).toBeVisible();
    await scan(page);

    // An Exception the list does not name is reached the way the sentence says: its
    // record, in the record review, then Replay.
    await page.goto(`/runs/${runId}/replay`);
    await expect(jump).toBeVisible();
    await jump.getByRole('link', { name: REPLAY_BOUND_WORDS.restLink, exact: true }).click();
    await expect(page).toHaveURL(`${origin}/runs/${runId}/evidence`);
    const queue = page.getByRole('region', { name: 'Records and findings', exact: true });
    await expect(queue).toBeVisible();
    await queue.getByLabel('Search records').fill(key(5));
    await queue.getByRole('button', { name: 'Apply', exact: true }).click();
    const found = queue.locator('ol[aria-label="Record review queue"] > li');
    await expect(found).toHaveCount(1);
    await expect(found.first().getByRole('heading', { name: key(5), exact: true })).toBeVisible();
    await found.first().getByRole('link', { name: 'Review evidence', exact: true }).click();
    const inspector = page.getByRole('region', { name: 'Record inspector', exact: true });
    await expect(inspector.getByRole('heading', { name: key(5), exact: true })).toBeVisible();
    const replay = inspector.getByRole('link', { name: 'Replay this inspection', exact: true });
    await expect(replay).toHaveAttribute('href', `/runs/${runId}/replay?workItem=${workItemId}`);
    await replay.click();
    await expect(page.getByRole('heading', { name: /^Selected inspection:/ })).toBeVisible();
    await expect(page.getByText('Inspection frames 1–100 of 520.', { exact: false })).toBeVisible();
    // An Exception opens at the first frame of the record it was raised against.
    await showsFrame(0);
    await expect(page.getByText('Frame 1 of 520', { exact: false })).toBeVisible();
    await scan(page);

    // Replay reached nothing outside this platform and threw nothing.
    expect(offOrigin).toEqual([]);
    expect(errors).toEqual([]);
  });
});
