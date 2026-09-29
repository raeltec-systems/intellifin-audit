import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeRun, copyRecording, RECORDING_COPY_TIMEOUT_MS, type ResolvedCredential } from '@intellifin/application';
import {
  bytesDiscloseCompiled,
  compileSecret,
  redactCompiled,
  replayRecordingObjectKey,
  sha256HexOfBytes,
  utf8Bytes,
  FRAME_MISSING_EVENT,
  MISSING_FRAME_SAMPLE_LIMIT,
  RECORDING_COPIED_EVENT,
} from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRunDetailRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunsUnitOfWork,
  PostgresWorkspaceRepository,
  REPLAY_GAP_LIMIT,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { withRunExecutionContext } from '../../packages/infrastructure/src/runs/adapter-execution-repository.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * Story 5.2 against a real PostgreSQL 18: which Tool Actions owe a Replay frame.
 *
 * The predicate lives in SQL, so nothing but a real database can exercise it. Every case
 * here seeds `run_tool_action` and `run_evidence_capture` rows directly and then reads
 * through the SAME context the terminal transaction uses, because a reader tested through
 * a fake proves nothing about the query.
 *
 * The rule the story exists for is asserted in BOTH directions: an action that owes a
 * frame and has none is reported, and a credential-entry action — whose capture the
 * platform suppressed on purpose — is not. Reporting the second would raise a finding
 * against the guarantee that produced it.
 */
const url = process.env.DATABASE_URL;
const ids = new CryptoUuidV7Generator();
const author = ids.next(), procedureId = ids.next(), versionId = ids.next();
const runs: string[] = [];
let sql: Sql, db: Database;

const SOURCE = 'http://localhost:4300/loancore/accounts';

describe.skipIf(!url)('the Replay asset set on PostgreSQL', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost','127.0.0.1','[::1]','postgres','db'].includes(target.hostname) || !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))) throw new Error('Replay asset tests require a disposable test database');
    sql = createSqlClient(url!, { max: 4 }); db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES(${author},'Replay asset test',${author+'@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES(${author},'auditor')`;
    const version = activeRunVersion(procedureId, versionId, author);
    await new PostgresProceduresUnitOfWork(db).execute(async c => { await c.procedures.insertProcedure(version); await c.procedures.insertVersion(version); });
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const runId of runs) {
        await sql`DELETE FROM run_replay_recording WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
        await sql`DELETE FROM run_tool_action WHERE run_id=${runId}`;
        await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM run_wait WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
      }
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally { await sql.end({ timeout: 5 }); }
  });

  /** A RUNNING Run with one Step Execution and nothing captured yet. */
  async function seedRun(): Promise<{ runId: string; stepExecutionId: string }> {
    const runId = ids.next(), stepExecutionId = ids.next();
    const at = new Date().toISOString();
    const day = String(runs.length + 1).padStart(2, '0');
    runs.push(runId);
    await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
      procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Replay assets',
      ${`2026-07-${day}`},${`2026-07-${day}`},'RUNNING','STANDARD',${author},'replay-assets','auditor',${at})`;
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
      VALUES(${stepExecutionId},${runId},'target-1-1',NULL,'inspect-record','RUNNING',1,${at})`;
    return { runId, stepExecutionId };
  }

  /**
   * One Tool Action, and optionally the frame it left.
   *
   * `frame: 'registered'` is the ordinary case; `'reserved'` is an upload that never
   * completed; `null` is no artifact at all. A `'reserved'` binding is REFUSED by the
   * published trigger (`Capture must link registered Evidence to its permitted reading
   * action in the same Run`), which is asserted rather than worked around: it means the
   * reader's own `state='REGISTERED'` clause is a second lock on a door the database
   * already holds, and both are kept.
   */
  async function toolAction(
    run: { runId: string; stepExecutionId: string },
    options: {
      readonly outcome: 'performed' | 'denied' | 'failed';
      readonly capture: 'PERMITTED' | 'SUPPRESSED';
      readonly frame: 'registered' | 'reserved' | null;
      readonly kind?: 'screenshot' | 'structural-snapshot';
      /** When the action started. Given explicitly where a test's subject is session ORDER. */
      readonly at?: string;
      /** The record the action inspected, on the action itself (the Step names none). */
      readonly workItemId?: string;
    },
  ): Promise<string> {
    const toolActionId = ids.next();
    const at = options.at ?? new Date().toISOString();
    await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
      action,method,destination,parameters,outcome,redirected,downloads,started_at,completed_at,capture,capture_suppression,denial)
      VALUES(${toolActionId},${run.runId},${run.stepExecutionId},${options.workItemId ?? null},'agent','loancore','read-attribute','GET',
      ${SOURCE},'[]'::jsonb,${options.outcome},false,0,${at},${at},${options.capture},
      ${options.capture === 'SUPPRESSED' ? 'credential-entry' : null},
      ${options.outcome === 'denied' ? 'action-not-permitted' : null})`;
    if (options.frame !== null) {
      const evidenceId = ids.next();
      const kind = options.kind ?? 'screenshot';
      const registered = options.frame === 'registered';
      await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,
        state,required,captured_at,capture_method,capture_time_source,role)
        VALUES(${evidenceId},${run.runId},${kind},'loancore',${`${kind}/${run.runId}/${evidenceId}`},
        ${kind === 'screenshot' ? 'image/png' : 'application/vnd.intellifin.web-tree+json'},
        ${registered ? 'a'.repeat(64) : null},${registered ? 11 : null},
        ${registered ? 'REGISTERED' : 'RESERVED'},false,
        ${registered ? at : null},${registered ? 'agent' : null},${registered ? 'registration' : null},'evidence')`;
      await sql`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
        VALUES(${evidenceId},${run.runId},${toolActionId},${SOURCE})`;
    }
    return toolActionId;
  }

  const missingFrames = async (runId: string) =>
    db.transaction(tx => withRunExecutionContext(tx, runId, async context => context.readMissingFrames()));

  it('names the performed actions that left no registered frame, and no others', async () => {
    const run = await seedRun();
    // Owes a frame and left one. Not a gap.
    await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'registered' });
    // Owes a frame and left nothing.
    const nothing = await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: null });
    // A Structural Snapshot is not a frame. An action that froze one and no screenshot
    // still owes Replay a picture of the page.
    const snapshotOnly = await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'registered', kind: 'structural-snapshot' });
    // The gate refused it, so nothing was performed and no frame was ever owed.
    await toolAction(run, { outcome: 'denied', capture: 'PERMITTED', frame: null });
    // The platform suppressed the capture ITSELF, while a credential was on the wire.
    // Reporting this as a missing frame would raise a finding against the guarantee that
    // produced it (AD-4). It is `SUPPRESSED` on the row, and the predicate reads that.
    await toolAction(run, { outcome: 'performed', capture: 'SUPPRESSED', frame: null });

    const frames = await missingFrames(run.runId);
    expect(frames.total).toBe(2);
    expect(frames.sample.map(entry => entry.toolActionId).sort()).toEqual([nothing, snapshotOnly].sort());
    expect(frames.sample.every(entry => entry.stepExecutionId === run.stepExecutionId)).toBe(true);
    expect(frames.sample.every(entry => entry.targetSystem === 'loancore')).toBe(true);
  });

  it('cannot be given a capture bound to Evidence that is not registered', async () => {
    const run = await seedRun();
    // The reader looks for a REGISTERED screenshot, and the database refuses to bind an
    // action to anything else — so an unfinished upload is a gap for the honest reason
    // that no binding exists, never because a half-uploaded artifact was accepted as one.
    await expect(
      toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'reserved' }),
    ).rejects.toThrow(/registered Evidence/i);
    expect((await missingFrames(run.runId)).total).toBe(1);
  });

  it('answers nothing missing for a Run whose every performed action left its frame', async () => {
    const run = await seedRun();
    await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'registered' });
    await toolAction(run, { outcome: 'performed', capture: 'SUPPRESSED', frame: null });
    expect(await missingFrames(run.runId)).toEqual({ total: 0, sample: [] });
  });

  it('counts EVERY gap while sampling at most the bound', async () => {
    const run = await seedRun();
    const total = MISSING_FRAME_SAMPLE_LIMIT + 5;
    for (let index = 0; index < total; index += 1) {
      await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: null });
    }
    const frames = await missingFrames(run.runId);
    // The count is `count(*)`, never the sample's length: a `LIMIT` answers the sample's
    // question and not the count's, and this codebase has shipped that confusion before.
    expect(frames.total).toBe(total);
    expect(frames.sample).toHaveLength(MISSING_FRAME_SAMPLE_LIMIT);
  });

  it('records one failure event and flags the Result, without blocking the seal', async () => {
    const run = await seedRun();
    await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: null });
    await toolAction(run, { outcome: 'performed', capture: 'SUPPRESSED', frame: null });

    const result = await db.transaction(tx =>
      withRunExecutionContext(tx, run.runId, async context => {
        await context.saveRunState('RUN_FAILED');
        return completeRun(context, { run: context.run!, state: 'RUN_FAILED', at: new Date().toISOString(), plan: null });
      }),
    );

    // The Run concluded. That is the criterion: a `replay`-role asset never gates a seal.
    expect(result).not.toBeNull();
    expect(result!.publication.evidence.state).toBe('SEALED');
    // One gap, and only one: the suppressed action is not a gap.
    expect(result!.publication.evidence.framesMissing).toBe(1);
    expect(result!.publication.evidence.missingRequired).toBe(0);

    const events = await sql<{ event_type: string; outcome: string; payload: Record<string, unknown> }[]>`
      SELECT event_type, outcome, payload FROM audit_events
      WHERE aggregate_id=${run.runId} AND event_type=${FRAME_MISSING_EVENT}`;
    expect(events).toHaveLength(1);
    expect(events[0]!.outcome).toBe('failure');
    expect(events[0]!.payload['missing']).toBe(1);
    expect((events[0]!.payload['actions'] as unknown[])).toHaveLength(1);
  });

  /**
   * Replay's gaps (Story 10.6, legacy 5.2). Replay played the frames a Run registered and
   * said nothing about the actions that left none, so a session with a gap looked complete.
   * The read counts missing frames with the SAME predicate the terminal transition used, so
   * the two must agree, and it places each gap among the frames in Replay's own order.
   */
  const replayGaps = async (runId: string) => new DrizzleRunDetailRepository(db).readReplayGaps(runId);
  const at = (second: number) => new Date(Date.UTC(2026, 6, 1, 9, 0, second)).toISOString();

  it('marks each gap among the frames, keeps a suppressed capture apart, and counts as the Result counted', async () => {
    const run = await seedRun();
    // In session order, one second apart, so the order is the one written here.
    const signIn = await toolAction(run, { outcome: 'performed', capture: 'SUPPRESSED', frame: null, at: at(1) });
    await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'registered', at: at(2) });
    const lost = await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: null, at: at(3) });
    await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'registered', at: at(4) });
    // Refused by the gate: nothing reached a screen, so nothing is owed and nothing is marked.
    await toolAction(run, { outcome: 'denied', capture: 'PERMITTED', frame: null, at: at(5) });
    // A Structural Snapshot is not a frame: this action still owes Replay a picture.
    const snapshotOnly = await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'registered', kind: 'structural-snapshot', at: at(6) });

    const gaps = await replayGaps(run.runId);
    expect(gaps.rows.map((gap) => [gap.toolActionId, gap.kind, gap.framesBefore])).toEqual([
      [signIn, 'suppressed', 0],
      [lost, 'missing', 1],
      [snapshotOnly, 'missing', 2],
    ]);
    expect(gaps.missing).toBe(2);
    // The suppressed capture is counted on its own and NEVER among the missing.
    expect(gaps.suppressed).toBe(1);
    expect(gaps.rows[0]!.captureSuppression).toBe('credential-entry');
    expect(gaps.rows.filter((gap) => gap.kind === 'missing').every((gap) => gap.captureSuppression === null)).toBe(true);
    expect(gaps.rows.every((gap) => gap.stepExecutionId === run.stepExecutionId && gap.targetSystem === 'loancore')).toBe(true);
    // One predicate: Replay's count is the terminal transition's count.
    expect(gaps.missing).toBe((await missingFrames(run.runId)).total);
  });

  // Owner decision D2 b (2026-09-29): the one-record Replay states that record's own gaps.
  // The scope is the frame read's Work Item rule, so another record's gap and a gap with no
  // record are not this record's; each gap is placed among the record's own frames too.
  it('reads one record’s own gaps, placed among that record’s frames, and no other record’s', async () => {
    const run = await seedRun();
    const [mine, other] = [ids.next(), ids.next()];
    for (const [index, id] of [mine, other].entries()) {
      await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,
        subject_key,state,attempts,cycles,observations)
        VALUES(${id},${run.runId},'target-1-1',${index + 1},'loancore','LoanCore',${['E-MINE', 'E-OTHER'][index]!},'OBSERVED',1,0,0)`;
    }
    await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'registered', at: at(1), workItemId: mine });
    await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'registered', at: at(2), workItemId: other });
    const lost = await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: null, at: at(3), workItemId: mine });
    await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: null, at: at(4), workItemId: other });
    const signIn = await toolAction(run, { outcome: 'performed', capture: 'SUPPRESSED', frame: null, at: at(5), workItemId: mine });
    await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'registered', at: at(6), workItemId: mine });
    // No record at all: the session's gap, never this record's.
    await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: null, at: at(7) });

    const detail = new DrizzleRunDetailRepository(db);
    const record = await detail.readRecordReplayGaps(run.runId, mine);
    expect(record.rows.map((gap) => [gap.toolActionId, gap.kind, gap.framesBefore, gap.recordFramesBefore])).toEqual([
      // Two session frames before it (one of them the other record's), one of its own.
      [lost, 'missing', 2, 1],
      [signIn, 'suppressed', 2, 1],
    ]);
    expect(record.missing).toBe(1);
    expect(record.suppressed).toBe(1);
    expect(record.rows.every((gap) => gap.workItemId === mine)).toBe(true);
    // The session read is unchanged: every gap, and no per-record numbering.
    const session = await replayGaps(run.runId);
    expect(session.missing).toBe(3);
    expect(session.rows.every((gap) => gap.recordFramesBefore === undefined)).toBe(true);
    // A record of another Run, or an identifier that is not one, reads nothing.
    expect(await detail.readRecordReplayGaps(run.runId, ids.next())).toEqual({ missing: 0, suppressed: 0, rows: [], window: [] });
    expect(await detail.readRecordReplayGaps(run.runId, 'not-a-record')).toEqual({ missing: 0, suppressed: 0, rows: [], window: [] });
  });

  it('answers no gap for a Run whose every performed action left its frame', async () => {
    const run = await seedRun();
    await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'registered', at: at(1) });
    expect(await replayGaps(run.runId)).toEqual({ missing: 0, suppressed: 0, rows: [], window: [] });
  });

  it('counts EVERY gap exactly while listing at most the bound', async () => {
    const run = await seedRun();
    const total = REPLAY_GAP_LIMIT + 7;
    await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
      action,method,destination,parameters,outcome,redirected,downloads,started_at,completed_at,capture,capture_suppression,denial)
      SELECT gen_random_uuid(),${run.runId},${run.stepExecutionId},NULL,'agent','loancore','read-attribute','GET',
        ${SOURCE},'[]'::jsonb,'performed',false,0,
        ${at(0)}::timestamptz + make_interval(secs => n),${at(0)}::timestamptz + make_interval(secs => n),'PERMITTED',NULL,NULL
      FROM generate_series(1, ${total}) AS n`;
    const gaps = await replayGaps(run.runId);
    // A count is `count(*)`, never the length of the bounded list.
    expect(gaps.missing).toBe(total);
    expect(gaps.rows).toHaveLength(REPLAY_GAP_LIMIT);
    expect(gaps.missing).toBe((await missingFrames(run.runId)).total);
  });

  /**
   * Story 10.12, item 1: the markers follow the frames SHOWN. 120 gaps come before a record's
   * first frame, so the bounded list (the first 100 by time) is full of them; the record then
   * has 150 frames, and one more gap sits after its 110th -- on its SECOND inspection page and
   * inside the whole-session prefix. The old read drew its markers from the list, so that gap
   * had none on either view.
   */
  it('reads the gaps among the frames shown, past the bounded list, on both views', async () => {
    const run = await seedRun();
    const record = ids.next();
    await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,
      subject_key,state,attempts,cycles,observations)
      VALUES(${record},${run.runId},'target-1-1',1,'loancore','LoanCore','E-PAGED','OBSERVED',1,0,0)`;
    const EARLY = REPLAY_GAP_LIMIT + 20, FRAMES = 150;
    // The early gaps, one second apart, all before the record's first frame.
    await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
      action,method,destination,parameters,outcome,redirected,downloads,started_at,completed_at,capture,capture_suppression,denial)
      SELECT gen_random_uuid(),${run.runId},${run.stepExecutionId},${record},'agent','loancore','read-attribute','GET',
        ${SOURCE},'[]'::jsonb,'performed',false,0,
        ${at(0)}::timestamptz + make_interval(secs => n),${at(0)}::timestamptz + make_interval(secs => n),'PERMITTED',NULL,NULL
      FROM generate_series(1, ${EARLY}) AS n`;
    // The record's frames at seconds 1000..1149, each a registered, bound screenshot.
    const frames = Array.from({ length: FRAMES }, (_, k) => ({ tool_action_id: ids.next(), evidence_id: ids.next(),
      at: new Date(Date.parse(at(0)) + (1_000 + k) * 1_000).toISOString() }));
    const json = JSON.stringify(frames);
    await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
      action,method,destination,parameters,outcome,redirected,downloads,started_at,completed_at,capture)
      SELECT r.tool_action_id,${run.runId},${run.stepExecutionId},${record},'agent','loancore','read-attribute','GET',
        ${SOURCE},'[]'::jsonb,'performed',false,0,r.at,r.at,'PERMITTED'
      FROM jsonb_to_recordset(${json}::text::jsonb) AS r(tool_action_id uuid, at timestamptz)`;
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,
      state,required,captured_at,capture_method,capture_time_source,role)
      SELECT r.evidence_id,${run.runId},'screenshot','loancore','screenshot/' || r.evidence_id::text,'image/png',
        ${'a'.repeat(64)},11,'REGISTERED',false,r.at,'agent','registration','evidence'
      FROM jsonb_to_recordset(${json}::text::jsonb) AS r(evidence_id uuid, at timestamptz)`;
    await sql`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
      SELECT r.evidence_id,${run.runId},r.tool_action_id,${SOURCE}
      FROM jsonb_to_recordset(${json}::text::jsonb) AS r(evidence_id uuid, tool_action_id uuid)`;
    // The late gap, half a second after the record's 110th frame.
    const late = await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: null, workItemId: record,
      at: new Date(Date.parse(at(0)) + 1_109_500).toISOString() });

    const detail = new DrizzleRunDetailRepository(db);
    // The whole-session view: the list is the first 100 by time and does not name it; the
    // prefix's markers do, at its place among the 500 frames the view shows.
    const session = await detail.readReplayGaps(run.runId);
    expect(session.missing).toBe(EARLY + 1);
    expect(session.rows).toHaveLength(REPLAY_GAP_LIMIT);
    expect(session.rows.some((gap) => gap.toolActionId === late)).toBe(false);
    expect(session.window).toHaveLength(EARLY + 1);
    expect(session.window.find((gap) => gap.toolActionId === late)).toMatchObject({ kind: 'missing', framesBefore: 110 });

    // The record's second page (cursor 100): only its own gap, at the record's 110th frame.
    const second = await detail.readRecordReplayGaps(run.runId, record, 100);
    expect(second.missing).toBe(EARLY + 1);
    expect(second.rows).toHaveLength(REPLAY_GAP_LIMIT);
    expect(second.rows.some((gap) => gap.toolActionId === late)).toBe(false);
    expect(second.window.map((gap) => [gap.toolActionId, gap.framesBefore, gap.recordFramesBefore])).toEqual([[late, 110, 110]]);
    // Its first page: the early gaps, every one of them, and not the late one.
    const first = await detail.readRecordReplayGaps(run.runId, record, 0);
    expect(first.window).toHaveLength(EARLY);
    expect(first.window.every((gap) => gap.recordFramesBefore === 0)).toBe(true);
    // And the placement agrees with an independent count of the frames before it.
    const [counted] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM run_evidence e
      JOIN run_evidence_capture c ON c.evidence_id = e.evidence_id
      JOIN run_tool_action a ON a.tool_action_id = c.tool_action_id
      WHERE e.run_id = ${run.runId} AND e.kind = 'screenshot'
        AND a.started_at < (SELECT started_at FROM run_tool_action WHERE tool_action_id = ${late})`;
    expect(counted!.n).toBe(110);
  });

  /**
   * Story 10.12, item 5: ONE rule for an Escalation's record. When the raise's Evidence
   * establishes a record by the Timeline's rule (every id resolves, through its capture, its
   * Tool Action and that action's Step Execution, to ONE Work Item at the raise's plan step),
   * Replay lands on the frame that Evidence was captured with; otherwise on the last frame at
   * or before the raise. Here the two rules pick different frames: the question is about
   * E-ASKED's second screen, and E-NEXT's screen was captured after it and before the raise.
   */
  it('lands an Escalation on the frame its Evidence cites, and on the time rule otherwise', async () => {
    const run = await seedRun();
    const [asked, next] = [ids.next(), ids.next()];
    for (const [index, [id, key]] of ([[asked, 'E-ASKED'], [next, 'E-NEXT']] as const).entries()) {
      await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,
        subject_key,state,attempts,cycles,observations)
        VALUES(${id},${run.runId},'target-1-1',${index + 1},'loancore','LoanCore',${key},'OBSERVED',1,0,0)`;
    }
    const evidenceOf = async (toolActionId: string): Promise<string> =>
      (await sql<{ id: string }[]>`SELECT evidence_id::text AS id FROM run_evidence_capture WHERE tool_action_id=${toolActionId}`)[0]!.id;
    // Frames 1 and 2 are E-ASKED's, frame 3 E-NEXT's.
    const asked1 = await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'registered', at: at(10), workItemId: asked });
    const asked2 = await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'registered', at: at(20), workItemId: asked });
    const next1 = await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'registered', at: at(30), workItemId: next });
    // The Structural Snapshot captured with frame 2, as the agent captures both on one action.
    const snapshot = ids.next();
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,
      state,required,captured_at,capture_method,capture_time_source,role)
      VALUES(${snapshot},${run.runId},'structural-snapshot','loancore',${`snapshot/${snapshot}`},
      'application/vnd.intellifin.web-tree+json',${'b'.repeat(64)},11,'REGISTERED',false,${at(20)},'agent','registration','evidence')`;
    await sql`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
      VALUES(${snapshot},${run.runId},${asked2},${SOURCE})`;
    // An action that froze a snapshot and no frame: its Evidence resolves, to no frame.
    const frameless = await toolAction(run, { outcome: 'performed', capture: 'PERMITTED', frame: 'registered',
      kind: 'structural-snapshot', at: at(25), workItemId: asked });
    const [frame1, frame2, frame3, framelessSnapshot] = (await Promise.all([asked1, asked2, next1, frameless].map(evidenceOf))) as [string, string, string, string];

    let second = 40;
    const raise = async (options: {
      readonly cites: readonly (string | number)[] | undefined;
      readonly stepId?: string;
      readonly writer?: string;
      readonly raises?: number;
    }): Promise<string> => {
      const waitId = ids.next();
      const openedAt = at(second += 2);
      await sql`INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,opened_by,deadline,closed_at,closure_kind,answer_option_id,actor)
        VALUES(${waitId},${run.runId},'choose-candidate','[{"id":"candidate-a","label":"Candidate A"}]'::jsonb,${openedAt},NULL,
        ${openedAt}::timestamptz + interval '30 minutes',${openedAt}::timestamptz + interval '1 second','answer','candidate-a',${author})`;
      for (let index = 0; index < (options.raises ?? 1); index += 1) {
        await new PostgresRunsUnitOfWork(db, { clock: { now: () => new Date(openedAt) } }).execute((c) => c.auditEvents.append({
          actor: { type: 'system', id: options.writer ?? 'escalation-platform' }, eventType: 'execution.escalation-raised',
          source: 'platform', outcome: 'success', aggregateId: run.runId, correlationId: ids.next(), sessionId: 'replay-assets',
          payload: { waitId, runId: run.runId, kind: 'choose-candidate', stepId: options.stepId ?? 'target-1-1',
            ...(options.cites === undefined ? {} : { supportingEvidenceIds: [...options.cites] }) },
        }));
      }
      return waitId;
    };
    const cited = await raise({ cites: [snapshot] });
    const citedFrame = await raise({ cites: [frame2.toUpperCase()] });
    const citedBoth = await raise({ cites: [snapshot, frame1] });
    const twoRecords = await raise({ cites: [snapshot, frame3] });
    const mixed = await raise({ cites: [snapshot, ids.next()] });
    const otherStep = await raise({ cites: [snapshot], stepId: 'target-2-1' });
    const forged = await raise({ cites: [snapshot], writer: 'someone-else' });
    const twice = await raise({ cites: [snapshot], raises: 2 });
    const noFrame = await raise({ cites: [framelessSnapshot] });
    const none = await raise({ cites: undefined });
    const notText = await raise({ cites: [snapshot, 7] });

    const read = await new DrizzleRunDetailRepository(db).readEscalations(run.runId, 100);
    const of = (waitId: string) => read.rows.find((row) => row.waitId === waitId)!;
    // The Evidence rule: E-ASKED's second screen, not the last one before the raise.
    expect(of(cited)).toMatchObject({ framesThrough: 2, landedBy: 'cited-evidence', landing: { workItemId: asked, cursor: 0 } });
    // The cited Evidence IS a frame (any letter case): that frame.
    expect(of(citedFrame)).toMatchObject({ framesThrough: 2, landedBy: 'cited-evidence' });
    // Two of one record's frames cited: the later one.
    expect(of(citedBoth)).toMatchObject({ framesThrough: 2, landedBy: 'cited-evidence' });
    // Every other raise establishes no record, so the time rule: frame 3, E-NEXT's.
    for (const [name, waitId] of Object.entries({ twoRecords, mixed, otherStep, forged, twice, noFrame, none, notText }))
      expect(of(waitId), name).toMatchObject({ framesThrough: 3, landedBy: 'raised-at', landing: { workItemId: next, cursor: 0 } });
  });

  it('reads no gap for an identifier that names no Run', async () => {
    expect(await replayGaps('not-a-run')).toEqual({ missing: 0, suppressed: 0, rows: [], window: [] });
  });

  /**
   * The provider's session recording, copied at Run end (Story 5.2, acceptance criterion 4).
   *
   * The LIVE leg is not provable here and cannot be: `SOLARI_RECORDING` is off by default,
   * the flag cannot be turned on for a session that already exists, and this environment
   * holds no provider key. What these cases prove is everything the platform owns — the row,
   * its four CHECKs, the credential wall and the first-answer-wins rule — against a real
   * PostgreSQL 18 and a synthetic provider.
   */
  describe('the session recording copy on PostgreSQL', () => {
    const TOKEN = 'SECRET-TOKEN-replay-recording-do-not-store-me';
    const BYTES = utf8Bytes('{"type":"meta","href":"http://localhost:4300/loancore"}\n');

    /** The same shape the infrastructure factory builds: methods, never a field. */
    const credential = (reference: string, token: string): ResolvedCredential => {
      const secret = compileSecret(token);
      return {
        reference,
        authorize: (headers) => headers.set('authorization', `Bearer ${token}`),
        enter: (field) => field.set(token),
        redact: (text) => redactCompiled(text, secret),
        discloses: (bytes) => bytesDiscloseCompiled(bytes, secret),
      };
    };

    const store = () => {
      const objects = new Map<string, Uint8Array>();
      return {
        objects,
        putIfAbsent: async (key: string, bytes: Uint8Array) => {
          if (!objects.has(key)) objects.set(key, bytes);
        },
        read: async (key: string) => objects.get(key) ?? null,
      };
    };

    const copy = async (runId: string, bytes: Uint8Array | null, objects = store()) => {
      const recording = await new PostgresWorkspaceRepository(db).transaction(runId, async (context) =>
        copyRecording(
          { downloadRecording: async () => bytes } as never,
          context,
          {
            ref: { runId, workspaceId: 'sess_replay_recording', mode: 'solari' },
            run: context.run!,
            copy: {
              store: objects,
              credentials: { resolve: async (reference: string) => credential(reference, TOKEN) },
              timeoutMs: RECORDING_COPY_TIMEOUT_MS,
            },
            now: () => new Date().toISOString(),
          },
        ),
      );
      return { recording, objects };
    };

    it('stores a verified copy, and the row says what it holds', async () => {
      const run = await seedRun();
      const { recording, objects } = await copy(run.runId, BYTES);
      expect(recording).toMatchObject({ state: 'REGISTERED', digest: sha256HexOfBytes(BYTES), size: BYTES.byteLength });
      expect(objects.objects.get(replayRecordingObjectKey(run.runId))).toEqual(BYTES);

      const rows = await sql<{ state: string; digest: string; diagnostic: string | null }[]>`
        SELECT state, digest, diagnostic FROM run_replay_recording WHERE run_id=${run.runId}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: 'REGISTERED', digest: sha256HexOfBytes(BYTES), diagnostic: null });
      const events = await sql<{ outcome: string }[]>`
        SELECT outcome FROM audit_events WHERE aggregate_id=${run.runId} AND event_type=${RECORDING_COPIED_EVENT}`;
      expect(events).toEqual([{ outcome: 'success' }]);
    });

    it('refuses one that discloses a credential, and stores nothing at all', async () => {
      const run = await seedRun();
      const leaked = utf8Bytes(`{"type":"input","text":"${TOKEN}"}\n`);
      const { recording, objects } = await copy(run.runId, leaked);
      expect(recording).toMatchObject({ state: 'UNAVAILABLE', diagnostic: 'recording-credential-disclosed' });
      expect(objects.objects.size).toBe(0);
      // And the assertion that matters most: the value is nowhere in the row it wrote.
      const rows = await sql<{ row: string }[]>`
        SELECT run_replay_recording::text AS row FROM run_replay_recording WHERE run_id=${run.runId}`;
      expect(rows[0]!.row.includes(TOKEN)).toBe(false);
    });

    it('answers once per Run, so a reaper retry cannot buy a second recording', async () => {
      const run = await seedRun();
      await copy(run.runId, BYTES);
      const { recording } = await copy(run.runId, utf8Bytes('{"type":"different"}\n'));
      // The FIRST answer wins, in the database and not only in the command.
      expect(recording).toMatchObject({ state: 'REGISTERED', digest: sha256HexOfBytes(BYTES) });
      const events = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_events WHERE aggregate_id=${run.runId} AND event_type=${RECORDING_COPIED_EVENT}`;
      expect(events[0]!.n).toBe(1);
    });

    it('refuses a row that says it is stored and has nothing behind it', async () => {
      const run = await seedRun();
      // `run_replay_recording_registered`: REGISTERED means bytes whose size and SHA-256 were
      // verified before the transaction said so. A constraint tested through the command
      // proves nothing about the constraint.
      await expect(sql`INSERT INTO run_replay_recording(run_id,workspace_id,object_key,media_type,state)
        VALUES(${run.runId},'sess_x','k','application/x-ndjson','REGISTERED')`).rejects.toMatchObject({ code: '23514' });
      // `run_replay_recording_unavailable`: either half alone permits a row that reads as the
      // other — a diagnostic on a stored recording, or an UNAVAILABLE row with no reason.
      await expect(sql`INSERT INTO run_replay_recording(run_id,workspace_id,object_key,media_type,state)
        VALUES(${run.runId},'sess_x','k','application/x-ndjson','UNAVAILABLE')`).rejects.toMatchObject({ code: '23514' });
      await expect(sql`INSERT INTO run_replay_recording(run_id,workspace_id,object_key,media_type,state,digest,size,copied_at,diagnostic)
        VALUES(${run.runId},'sess_x','k','application/x-ndjson','REGISTERED',${'a'.repeat(64)},1,now(),'recording-unavailable')`)
        .rejects.toMatchObject({ code: '23514' });
      await expect(sql`INSERT INTO run_replay_recording(run_id,workspace_id,object_key,media_type,state,digest)
        VALUES(${run.runId},'sess_x','k','application/x-ndjson','RESERVED','not-a-digest')`).rejects.toMatchObject({ code: '23514' });
    });
  });
});
