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
  PostgresProceduresUnitOfWork,
  PostgresWorkspaceRepository,
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
        await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
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
    },
  ): Promise<string> {
    const toolActionId = ids.next();
    const at = new Date().toISOString();
    await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
      action,method,destination,parameters,outcome,redirected,downloads,started_at,completed_at,capture,capture_suppression,denial)
      VALUES(${toolActionId},${run.runId},${run.stepExecutionId},NULL,'agent','loancore','read-attribute','GET',
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
