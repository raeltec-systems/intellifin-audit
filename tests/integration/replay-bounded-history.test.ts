import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCanonicalAuditEvent } from '@intellifin/domain';
import {
  computeAuditEventHash, createDb, createSqlClient, CryptoUuidV7Generator, DrizzleRunDetailRepository, PostgresAuditChainReader,
  PostgresProceduresUnitOfWork, PostgresRunsUnitOfWork, REPLAY_FRAME_LIMIT, REPLAY_PAGE_SIZE,
  type Database, type RunReplayObservationDelta, type Sql,
} from '@intellifin/infrastructure';
import { replayJumpTargets, replayObservationsThrough } from '../../apps/web/src/runs/replay.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * Replay's default view past every bound it reads with (Story 10.9).
 *
 * The page read the first 500 waits, Observation registrations and Exceptions and said
 * nothing of the rest. This Run holds more of each than that: 620 frames, 547 Escalations
 * (and three pauses, which are not Escalations), 620 Exceptions raised in the REVERSE of
 * their identifier order, and 1,142 chain events of which 1,140 register Observations. The
 * reads must answer exact totals beside their pages, an exact Observation count beside
 * every frame, and where each Escalation lands in the WHOLE session.
 */

const url = process.env.DATABASE_URL;
const ids = new CryptoUuidV7Generator();
const author = ids.next(), procedureId = ids.next(), versionId = ids.next(), runId = ids.next();
const MAIN = ids.next(), LATE = ids.next();
const stamp = (seconds: number) => new Date(Date.UTC(2026, 8, 26) + seconds * 1000).toISOString();
const source = 'https://prodconsole.invalid/configuration';

// Frame k (1-based) is captured at stamp(10k). Frames 1..520 are MAIN's, frame 600 is a
// session capture that belongs to no record, and every other frame is LATE's.
const FRAME_COUNT = 620;
const ownerOf = (k: number): string | null => k <= 520 ? MAIN : k === 600 ? null : LATE;
const frames: { readonly evidenceId: string; readonly stepExecutionId: string; readonly toolActionId: string }[] = [];

// The Escalations whose landing this file asserts, and the three pauses that must not count.
const W = { before: ids.next(), at300: ids.next(), at500: ids.next(), at501: ids.next(), late: ids.next(),
  session: ids.next(), end: ids.next() } as const;
const SPECIALS: readonly (readonly [string, number])[] = [
  [W.before, 5], [W.at300, 3_005], [W.at500, 5_000], [W.at501, 5_010], [W.late, 5_605], [W.session, 6_005], [W.end, 6_205],
];
const FILLERS = 540;
const escalationsInOrder: string[] = [];
const PAUSES = 3;

// Exceptions n = 1..620 are GENERATED in that order and RAISED in the reverse one.
const EXCEPTIONS = 620;
const exceptionIds: string[] = [];

let sql: Sql, db: Database, detail: DrizzleRunDetailRepository;

describe.skipIf(!url)('Replay’s bounded history on PostgreSQL (Story 10.9)', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1)))
      throw new Error('Replay bounded-history tests require a disposable test database');
    sql = createSqlClient(url!, { max: 2 }); db = createDb(sql); detail = new DrizzleRunDetailRepository(db);
    console.info(JSON.stringify({ fixture: 'replay-bounded-history', runId, procedureId, versionId, author }));
    await sql`INSERT INTO auth_user(id,name,email) VALUES(${author},'Replay bounded history test',${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES(${author},'auditor')`;
    const version = activeRunVersion(procedureId, versionId, author);
    await new PostgresProceduresUnitOfWork(db).execute(async (c) => {
      await c.procedures.insertProcedure(version); await c.procedures.insertVersion(version);
    });
    await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
      procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Replay bounded history',
      '2026-07-01','2026-07-01','RUNNING','STANDARD',${author},'replay-bounded-history','auditor',${stamp(0)})`;
    for (const [index, [workItemId, key]] of ([[MAIN, 'E-MAIN'], [LATE, 'E-LATE']] as const).entries()) {
      await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,
        subject_key,state,attempts,cycles,observations)
        VALUES(${workItemId},${runId},'target-1-1',${index + 1},'prodconsole','ProdConsole',${key},'OBSERVED',1,0,0)`;
    }

    // The frames, one statement per table: every row is a real bound, registered capture.
    for (let k = 1; k <= FRAME_COUNT; k++) frames.push({ evidenceId: ids.next(), stepExecutionId: ids.next(), toolActionId: ids.next() });
    const rows = frames.map((frame, index) => ({ evidence_id: frame.evidenceId, step_execution_id: frame.stepExecutionId,
      tool_action_id: frame.toolActionId, owner: ownerOf(index + 1), at: stamp((index + 1) * 10) }));
    const json = JSON.stringify(rows);
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
      SELECT r.step_execution_id, ${runId}::uuid, CASE WHEN r.owner IS NULL THEN 'session-1' ELSE 'target-1-1' END, r.owner,
        CASE WHEN r.owner IS NULL THEN 'create-workspace' ELSE 'inspect-record' END, 'SUCCEEDED', 1, r.at
      FROM jsonb_to_recordset(${json}::text::jsonb) AS r(step_execution_id uuid, owner uuid, at timestamptz)`;
    await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
      action,method,destination,parameters,outcome,status,redirected,downloads,started_at,completed_at,capture)
      SELECT r.tool_action_id, ${runId}::uuid, r.step_execution_id, r.owner, 'agent', 'prodconsole', 'read-attribute', 'GET',
        ${source}, '[]'::jsonb, 'performed', 200, false, 0, r.at, r.at, 'PERMITTED'
      FROM jsonb_to_recordset(${json}::text::jsonb) AS r(tool_action_id uuid, step_execution_id uuid, owner uuid, at timestamptz)`;
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,
      state,required,captured_at,capture_method,capture_time_source,role)
      SELECT r.evidence_id, ${runId}::uuid, 'screenshot', 'prodconsole', 'replay-bounded-history/' || r.evidence_id::text,
        'image/png', ${'a'.repeat(64)}, 11, 'REGISTERED', false, r.at, 'agent', 'registration', 'evidence'
      FROM jsonb_to_recordset(${json}::text::jsonb) AS r(evidence_id uuid, at timestamptz)`;
    await sql`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
      SELECT r.evidence_id, ${runId}::uuid, r.tool_action_id, ${source}
      FROM jsonb_to_recordset(${json}::text::jsonb) AS r(evidence_id uuid, tool_action_id uuid)`;

    // The waits: seven placed Escalations, 540 more after every frame, and three pauses
    // before all of them. Closed as the product closes them; a pause is resumed.
    for (const [waitId] of SPECIALS) escalationsInOrder.push(waitId);
    const waits = [
      ...Array.from({ length: PAUSES }, (_, index) => ({ wait_id: ids.next(), kind: 'pause', opened_at: stamp(index + 1),
        opened_by: author, closure_kind: 'resume', answer_option_id: 'resume', actor: author })),
      ...SPECIALS.map(([waitId, seconds]) => ({ wait_id: waitId, kind: 'choose-candidate', opened_at: stamp(seconds),
        opened_by: null, closure_kind: 'answer', answer_option_id: 'candidate-a', actor: author })),
      ...Array.from({ length: FILLERS }, (_, index) => {
        const waitId = ids.next();
        escalationsInOrder.push(waitId);
        return index % 2 === 0
          ? { wait_id: waitId, kind: 'unnamed-value', opened_at: stamp(7_000 + index), opened_by: null,
              closure_kind: 'answer', answer_option_id: 'unevaluated', actor: author }
          : { wait_id: waitId, kind: 'retry-or-skip', opened_at: stamp(7_000 + index), opened_by: null,
              closure_kind: 'timeout', answer_option_id: null, actor: 'wait-wake' };
      }),
    ];
    await sql`INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,opened_by,deadline,closed_at,closure_kind,answer_option_id,actor)
      SELECT w.wait_id, ${runId}::uuid, w.kind, '[{"id":"candidate-a","label":"Candidate A"}]'::jsonb, w.opened_at, w.opened_by,
        w.opened_at + interval '30 minutes', w.opened_at + interval '1 second', w.closure_kind, w.answer_option_id, w.actor
      FROM jsonb_to_recordset(${JSON.stringify(waits)}::text::jsonb) AS w(wait_id uuid, kind text, opened_at timestamptz,
        opened_by text, closure_kind text, answer_option_id text, actor text)`;

    // Observations and the Exceptions raised against them, all on MAIN.
    const exceptions = Array.from({ length: EXCEPTIONS }, (_, index) => {
      const n = index + 1;
      const exceptionId = ids.next();
      exceptionIds.push(exceptionId);
      return { observation_id: ids.next(), exception_id: exceptionId, key: `parameter-${String(n).padStart(4, '0')}`,
        raised_at: stamp(20_000 - n) };
    });
    const exceptionJson = JSON.stringify(exceptions);
    await sql`INSERT INTO run_observation(observation_id,run_id,work_item_id,step_execution_id,target_system,
      population_record_key,schema_version,capture_method,match_origin,digest,observed_at_source,found,
      coverage,corroboration,identity,attributes,evidence_ids,observed_at)
      SELECT x.observation_id, ${runId}::uuid, ${MAIN}::uuid, ${frames[0]!.stepExecutionId}::uuid, 'prodconsole', x.key, 1,
        'agent', 'platform', ${'b'.repeat(64)}, ${stamp(10)}, 'true', 'COVERED', 'MATCHED',
        '{"locator":"$.rows[0].id","corroboration":"matched"}'::jsonb, '[]'::jsonb,
        jsonb_build_array(${frames[0]!.evidenceId}::text), ${stamp(10)}::timestamptz
      FROM jsonb_to_recordset(${exceptionJson}::text::jsonb) AS x(observation_id uuid, key text)`;
    await sql`INSERT INTO run_exception(exception_id,run_id,observation_id,work_item_id,target_system,
      population_record_key,condition_ids,diagnostics,fingerprint,fingerprint_key_id,raised_at)
      SELECT x.exception_id, ${runId}::uuid, x.observation_id, ${MAIN}::uuid, 'prodconsole', x.key,
        '["C1"]'::jsonb, '[]'::jsonb, ${'c'.repeat(64)}, 'replay-bounded-history', x.raised_at
      FROM jsonb_to_recordset(${exceptionJson}::text::jsonb) AS x(exception_id uuid, observation_id uuid, key text, raised_at timestamptz)`;

    // The chain. Two registrations after each of MAIN's frames, one of three after each
    // later record frame, one AT frame 20's own instant (at-or-before counts it), one whose
    // `registered` is text (never counted) and one of another type (never counted). The
    // first goes through the real appender, which opens the head; the rest are canonical,
    // hash-linked events under the same Run/head lock order, verified whole below.
    const registration = (seconds: number, registered: number | string,
      eventType: `execution.${string}` = 'execution.observations-registered') => ({ seconds, registered, eventType });
    const events = [
      ...Array.from({ length: 520 }, (_, index) => [registration((index + 1) * 10 + 1, 1), registration((index + 1) * 10 + 2, 1)]).flat(),
      ...Array.from({ length: 100 }, (_, index) => index + 521).filter((k) => k !== 600).map((k) => registration(k * 10 + 1, 3)),
      registration(200, 5),
      registration(105, '100'),
      registration(3_001, 1_000, 'execution.capture-registered'),
    ].sort((left, right) => left.seconds - right.seconds);
    const [first, ...rest] = events;
    await new PostgresRunsUnitOfWork(db, { clock: { now: () => new Date(stamp(first!.seconds)) } }).execute((c) => c.auditEvents.append({
      actor: { type: 'system', id: 'observation-registrar' }, eventType: first!.eventType, source: 'worker', outcome: 'success',
      aggregateId: runId, correlationId: ids.next(), sessionId: 'replay-bounded-history',
      payload: { workItemId: MAIN, registered: first!.registered },
    }));
    await sql.begin(async (tx) => {
      await tx`SELECT run_id FROM audit_run WHERE run_id=${runId} FOR KEY SHARE`;
      const [head] = await tx<{ sequence: number; hash: string }[]>`
        SELECT last_sequence::int AS sequence,last_event_hash AS hash FROM audit_event_heads
        WHERE aggregate_id=${runId} FOR UPDATE`;
      if (!head) throw new Error('Replay bounded-history fixture audit head missing');
      let hash = head.hash, sequence = head.sequence;
      for (let offset = 0; offset < rest.length; offset += 500) {
        const batch = rest.slice(offset, offset + 500).map((event) => {
          const canonical = createCanonicalAuditEvent({
            actor: { type: 'system', id: 'observation-registrar' }, eventType: event.eventType,
            source: 'worker', outcome: 'success', aggregateId: runId, correlationId: ids.next(), sessionId: 'replay-bounded-history',
            payload: { workItemId: MAIN, registered: event.registered },
          }, { eventId: ids.next(), sequence: ++sequence, occurredAt: stamp(event.seconds) });
          const previousHash = hash;
          hash = computeAuditEventHash(previousHash, canonical);
          return { event_id: canonical.eventId, actor_type: canonical.actor.type, actor_id: canonical.actor.id,
            event_type: canonical.eventType, occurred_at: canonical.occurredAt, source: canonical.source,
            outcome: canonical.outcome, session_id: canonical.sessionId, correlation_id: canonical.correlationId,
            aggregate_id: canonical.aggregateId, sequence: canonical.sequence, payload: canonical.payload,
            previous_hash: previousHash, event_hash: hash };
        });
        await tx`INSERT INTO audit_events(event_id,actor_type,actor_id,event_type,occurred_at,source,outcome,
          session_id,correlation_id,aggregate_id,sequence,payload,previous_hash,event_hash)
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(batch)}::text::jsonb) AS event(
            event_id uuid,actor_type text,actor_id text,event_type text,occurred_at timestamptz,source text,outcome text,
            session_id text,correlation_id text,aggregate_id text,sequence bigint,payload jsonb,previous_hash text,event_hash text)`;
      }
      await tx`UPDATE audit_event_heads SET last_sequence=${sequence},last_event_hash=${hash} WHERE aggregate_id=${runId}`;
    });
    expect(await new PostgresAuditChainReader(db).verify(runId)).toMatchObject({ valid: true, eventCount: events.length });
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    try {
      // The whole Run in one transaction, children first. An Exception is permanent while
      // its Observation exists (generation 23), so the Observation is what carries it away.
      await sql.begin(async (tx) => {
        await tx`SELECT run_id FROM audit_run WHERE run_id=${runId} FOR UPDATE`;
        await tx`DELETE FROM run_observation WHERE run_id=${runId}`;
        await tx`DELETE FROM run_wait WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
        await tx`DELETE FROM run_tool_action WHERE run_id=${runId}`;
        await tx`DELETE FROM run_step_execution WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await tx`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
      });
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally { await sql.end({ timeout: 5 }); }
  });

  /** Every registration the chain holds, as the reference rule reads them. */
  async function everyRegistration(): Promise<readonly RunReplayObservationDelta[]> {
    // Instants as text and the payload's value with its JSON type: a client `createDb` has
    // wrapped returns neither a Date nor a parsed object dependably (CLAUDE.md, 2026-09-19).
    // Ordered by the sequence COLUMN, qualified: the text alias would put '10' before '9'.
    const rows = await sql<{ sequence: string; occurred_at: string; type: string | null; registered: string | null }[]>`
      SELECT sequence::text AS sequence,
        to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at,
        jsonb_typeof(payload->'registered') AS type, payload->>'registered' AS registered
      FROM audit_events
      WHERE aggregate_id=${runId} AND event_type='execution.observations-registered'
      ORDER BY audit_events.sequence`;
    return rows.map((row) => ({
      sequence: Number(row.sequence), occurredAt: row.occurred_at,
      workItemId: MAIN, stepExecutionId: null,
      // What the page's own read took: a number is a count, anything else is absent.
      registered: row.type === 'number' ? Number(row.registered) : 0,
    }));
  }

  it('counts every frame’s Observations EXACTLY, over the whole registration history', async () => {
    const read = await detail.readFrames(runId);
    expect(read.total).toBe(FRAME_COUNT);
    expect(read.rows).toHaveLength(REPLAY_FRAME_LIMIT);
    expect(read.rows.map((row) => row.evidenceId)).toEqual(frames.slice(0, REPLAY_FRAME_LIMIT).map((frame) => frame.evidenceId));
    // By hand: two per earlier MAIN frame, and the five registered AT frame 20's instant.
    expect(read.rows[0]!.observations).toBe(0);
    expect(read.rows[18]!.observations).toBe(36);
    expect(read.rows[19]!.observations).toBe(43);
    expect(read.rows[499]!.observations).toBe(1_003);
    // The reference rule, over EVERY registration the chain holds, agrees at every frame.
    const registrations = await everyRegistration();
    expect(registrations).toHaveLength(1_141);
    for (const row of read.rows) expect(row.observations).toBe(replayObservationsThrough(registrations, row));
    // What the page used to say: the same rule over the first 500 registrations only,
    // which stops at 503 from the 250th frame on while the Run went on registering.
    expect(replayObservationsThrough(registrations.slice(0, REPLAY_PAGE_SIZE), read.rows[499]!)).toBe(503);
  });

  it('agrees with an independent count of the same history, and with the inspection pages', async () => {
    const read = await detail.readFrames(runId);
    // A correlated sum per frame: a second formulation of the rule, not a copy of the window.
    const independent = await sql<{ evidence_id: string; expected: number }[]>`
      SELECT e.evidence_id::text AS evidence_id, (SELECT coalesce(sum((ev.payload->>'registered')::numeric), 0)
          FROM audit_events ev WHERE ev.aggregate_id = ${runId} AND ev.event_type = 'execution.observations-registered'
            AND jsonb_typeof(ev.payload->'registered') = 'number' AND ev.occurred_at <= a.started_at)::int AS expected
      FROM run_evidence e
      JOIN run_evidence_capture c ON c.evidence_id = e.evidence_id AND c.run_id = e.run_id
      JOIN run_tool_action a ON a.tool_action_id = c.tool_action_id AND a.run_id = e.run_id
      WHERE e.run_id = ${runId} AND e.kind = 'screenshot'`;
    const expected = new Map(independent.map((row) => [row.evidence_id, row.expected]));
    for (const row of read.rows) expect(row.observations).toBe(expected.get(row.evidenceId));
    // One frame never says two numbers on the two views: frames 401..500 on MAIN's own page.
    const page = await detail.readInspectionReplay(runId, MAIN, 400);
    expect(page.kind).toBe('inspection'); if (page.kind !== 'inspection') return;
    const prefix = new Map(read.rows.map((row) => [row.evidenceId, row.observations]));
    expect(page.rows.map((row) => row.globalOrdinal)).toEqual(Array.from({ length: 100 }, (_, index) => 401 + index));
    for (const row of page.rows) expect(row.observations).toBe(prefix.get(row.frame.evidenceId));
  });

  it('reads the Escalations with their EXACT total, and never a pause', async () => {
    const read = await detail.readEscalations(runId, REPLAY_PAGE_SIZE);
    expect(read.total).toBe(SPECIALS.length + FILLERS);
    expect(read.rows).toHaveLength(REPLAY_PAGE_SIZE);
    // The first 500 Escalations raised, in the order they were raised: three pauses opened
    // before all of them take no place on the page and add nothing to the total.
    expect(read.rows.map((row) => row.waitId)).toEqual(escalationsInOrder.slice(0, REPLAY_PAGE_SIZE));
    expect(read.rows.some((row) => row.kind === 'pause')).toBe(false);
    // A smaller page keeps the same total; a larger one is still Replay's bound.
    const small = await detail.readEscalations(runId, 3);
    expect(small).toMatchObject({ total: SPECIALS.length + FILLERS });
    expect(small.rows.map((row) => row.waitId)).toEqual([W.before, W.at300, W.at500]);
    expect((await detail.readEscalations(runId, 10_000)).rows).toHaveLength(REPLAY_PAGE_SIZE);
    expect(await detail.readEscalations('not-a-run')).toEqual({ rows: [], total: 0 });
  });

  it('places each Escalation in the WHOLE session, and names the inspection page that holds its frame', async () => {
    const read = await detail.readEscalations(runId, REPLAY_PAGE_SIZE);
    const of = (waitId: string) => read.rows.find((row) => row.waitId === waitId)!;
    // No frame before it at all.
    expect(of(W.before)).toMatchObject({ framesThrough: 0, landing: null });
    // Inside the 500 frames read: the 300th, on MAIN's third page.
    expect(of(W.at300)).toMatchObject({ framesThrough: 300, landing: { workItemId: MAIN, cursor: 200 } });
    // A frame captured at the SAME instant is at or before it.
    expect(of(W.at500)).toMatchObject({ framesThrough: 500, landing: { workItemId: MAIN, cursor: 400 } });
    // Past the frames read: the 501st, on MAIN's sixth page.
    expect(of(W.at501)).toMatchObject({ framesThrough: 501, landing: { workItemId: MAIN, cursor: 500 } });
    // Another record's capture, counted among ITS captures: LATE's 40th.
    expect(of(W.late)).toMatchObject({ framesThrough: 560, landing: { workItemId: LATE, cursor: 0 } });
    // A session capture belongs to no record, so there is no inspection to open.
    expect(of(W.session)).toMatchObject({ framesThrough: 600, landing: null });
    expect(of(W.end)).toMatchObject({ framesThrough: FRAME_COUNT, landing: { workItemId: LATE, cursor: 0 } });

    // The inspection page each landing names really holds that frame.
    for (const [waitId, workItemId, cursor, ordinal] of [[W.at501, MAIN, 500, 501], [W.late, LATE, 0, 560], [W.end, LATE, 0, 620]] as const) {
      const page = await detail.readInspectionReplay(runId, workItemId, cursor);
      expect(page.kind, waitId).toBe('inspection'); if (page.kind !== 'inspection') return;
      expect(page.rows.find((row) => row.globalOrdinal === ordinal)?.frame.evidenceId).toBe(frames[ordinal - 1]!.evidenceId);
    }

    // And the jump list built from these reads lands each one truthfully.
    const prefix = await detail.readFrames(runId);
    const targets = replayJumpTargets({ frames: prefix.rows, framesTotal: prefix.total, workItems: [], exceptions: [], waits: read.rows });
    const target = (waitId: string) => targets.find((item) => item.id === waitId)!;
    expect(target(W.before)).toMatchObject({ frameIndex: null, absence: 'none-before' });
    expect(target(W.at300)).toMatchObject({ frameIndex: 299, absence: null });
    expect(target(W.at500)).toMatchObject({ frameIndex: 499, absence: null });
    expect(target(W.at501)).toMatchObject({ frameIndex: null, absence: 'not-read', workItemId: MAIN, inspectionCursor: 500 });
    expect(target(W.session)).toMatchObject({ frameIndex: null, absence: 'not-read' });
    expect(target(W.session).workItemId).toBeUndefined();
  });

  it('reads the Exceptions in the order they were RAISED, with their exact total', async () => {
    const read = await detail.readReplayExceptions(runId, REPLAY_PAGE_SIZE);
    expect(read.total).toBe(EXCEPTIONS);
    expect(read.rows).toHaveLength(REPLAY_PAGE_SIZE);
    // Raised in the reverse of generation order, so the first 500 raised are the LAST 500
    // generated -- which an identifier-ordered page would never have named.
    expect(read.rows.map((row) => row.exceptionId)).toEqual(exceptionIds.slice(EXCEPTIONS - REPLAY_PAGE_SIZE).reverse());
    expect(read.rows.map((row) => row.populationRecordKey).slice(0, 2)).toEqual(['parameter-0620', 'parameter-0619']);
    expect(read.rows.every((row, index) => index === 0 || row.raisedAt >= read.rows[index - 1]!.raisedAt)).toBe(true);
    expect(read.rows.every((row) => row.workItemId === MAIN)).toBe(true);
    const small = await detail.readReplayExceptions(runId, 2);
    expect(small).toMatchObject({ total: EXCEPTIONS });
    expect(small.rows.map((row) => row.exceptionId)).toEqual([exceptionIds[EXCEPTIONS - 1], exceptionIds[EXCEPTIONS - 2]]);
    expect(await detail.readReplayExceptions('not-a-run')).toEqual({ rows: [], total: 0 });
  });
});
