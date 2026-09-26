import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCanonicalAuditEvent } from '@intellifin/domain';
import {
  createDb, createSqlClient, CryptoUuidV7Generator, DrizzleRunDetailRepository, computeAuditEventHash, PostgresAuditChainReader,
  PostgresProceduresUnitOfWork, PostgresRunsUnitOfWork, REPLAY_INSPECTION_PAGE_SIZE,
  type Database, type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';

const url = process.env.DATABASE_URL;
const ids = new CryptoUuidV7Generator();
const author = ids.next(), procedureId = ids.next(), versionId = ids.next();
const runId = ids.next(), foreignRunId = ids.next();
const early = ids.next(), selected = ids.next(), empty = ids.next(), foreign = ids.next();
const stamp = (seconds: number) => new Date(Date.UTC(2026, 8, 20) + seconds * 1000).toISOString();
const source = 'https://loancore.invalid/accounts/E-LATE';
let sql: Sql, db: Database, detail: DrizzleRunDetailRepository;
const selectedFrames: string[] = [];
let firstSelectedAction = '', firstSelectedStep = '';
const ties: string[] = [];

describe.skipIf(!url)('selected Replay beyond the chronological prefix on PostgreSQL', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1)))
      throw new Error('Selected Replay tests require a disposable test database');
    sql = createSqlClient(url!, { max: 2 }); db = createDb(sql); detail = new DrizzleRunDetailRepository(db);
    console.info(JSON.stringify({ fixture: 'selected-replay', runIds: [runId, foreignRunId], procedureId, versionId, author }));
    await sql`INSERT INTO auth_user(id,name,email) VALUES(${author},'Selected Replay test',${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES(${author},'auditor')`;
    const version = activeRunVersion(procedureId, versionId, author);
    await new PostgresProceduresUnitOfWork(db).execute(async c => {
      await c.procedures.insertProcedure(version); await c.procedures.insertVersion(version);
    });
    for (const [index, id] of [runId, foreignRunId].entries()) {
      const day = `2026-07-0${index + 1}`;
      await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
        procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
        VALUES(${ids.next()},${id},${ids.next()},${procedureId},${versionId},1,'Selected Replay',
        ${day},${day},'RUNNING','STANDARD',${author},'selected-replay','auditor',${stamp(0)})`;
    }
    for (const [index, id] of [early, selected, empty, foreign].entries()) {
      await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,
        subject_key,state,attempts,cycles,observations)
        VALUES(${id},${id === foreign ? foreignRunId : runId},'target-1-1',${index + 1},'loancore','LoanCore',
        ${['E-EARLY', 'E-LATE', 'E-EMPTY', 'E-FOREIGN'][index]!},'OBSERVED',1,0,0)`;
    }
    // More than 500 Step Executions AND actions precede the selected inspection. Every
    // selected action has a NULL owner and resolves through its same-Run Step instead.
    for (let index = 0; index < 608; index++) {
      const late = index >= 505;
      const owner = late ? selected : early;
      const step = ids.next(), action = ids.next(), evidence = ids.next();
      const at = stamp(late ? 600 : index);
      await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
        VALUES(${step},${runId},${late ? 'late-inspection-step' : 'early-inspection-step'},${owner},'inspect-record','SUCCEEDED',1,${at})`;
      await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
        action,method,destination,parameters,outcome,status,redirected,downloads,started_at,completed_at,capture)
        VALUES(${action},${runId},${step},${late ? null : owner},'agent','loancore','read-attribute','GET',
        ${source},'[]'::jsonb,'performed',200,false,0,${at},${at},'PERMITTED')`;
      await capture(evidence, action, at);
      if (late) selectedFrames.push(evidence);
      if (index === 505) { firstSelectedAction = action; firstSelectedStep = step; }
      if (index === 607) {
        // Same time, same action, reverse insertion: Evidence UUID is the final tie-break.
        ties.push(...[ids.next(), ids.next()].sort());
        await capture(ties[1]!, action, at); await capture(ties[0]!, action, at);
        selectedFrames.push(...ties);
      }
    }
    // The append adapter controls event timestamps; no immutable chain rows are edited.
    await new PostgresRunsUnitOfWork(db, { clock: { now: () => new Date(stamp(550)) } }).execute(async c => {
      for (let index = 0; index < 505; index++) await c.auditEvents.append({
        actor: { type: 'system', id: 'observation-registrar' }, eventType: 'execution.observations-registered',
        source: 'worker', outcome: 'success', aggregateId: runId, correlationId: ids.next(), sessionId: 'selected-replay',
        payload: { workItemId: selected, registered: 1 },
      });
    });
    for (const [seconds, registered] of [[600, 7], [601, 9], [599, '100']] as const) {
      await new PostgresRunsUnitOfWork(db, { clock: { now: () => new Date(stamp(seconds)) } }).execute(c => c.auditEvents.append({
        actor: { type: 'system', id: 'observation-registrar' }, eventType: 'execution.observations-registered',
        source: 'worker', outcome: 'success', aggregateId: runId, correlationId: ids.next(), sessionId: 'selected-replay',
        payload: { workItemId: selected, registered },
      }));
    }
    await sql`INSERT INTO run_observation(observation_id,run_id,work_item_id,step_execution_id,target_system,
      population_record_key,schema_version,capture_method,match_origin,digest,observed_at_source,found,
      coverage,corroboration,identity,attributes,evidence_ids,observed_at)
      SELECT overlay(overlay(md5(${runId} || 'observation-' || n) placing '7' from 13) placing '8' from 17)::uuid, ${runId}, ${selected}, ${firstSelectedStep}, 'loancore',
        'LATE-' || n, 1, 'agent', 'platform', repeat('b',64), ${stamp(600)}, 'true',
        'COVERED', 'MATCHED', '{"locator":"$.rows[0].id","corroboration":"matched"}'::jsonb, '[]'::jsonb,
        ${JSON.stringify([selectedFrames[0]])}::jsonb, ${stamp(600)} FROM generate_series(1,501) n`;
    await sql`INSERT INTO run_exception(exception_id,run_id,observation_id,work_item_id,target_system,
      population_record_key,condition_ids,diagnostics,fingerprint,fingerprint_key_id,raised_at)
      SELECT overlay(overlay(md5(${runId} || 'exception-' || n) placing '7' from 13) placing '8' from 17)::uuid, ${runId}, overlay(overlay(md5(${runId} || 'observation-' || n) placing '7' from 13) placing '8' from 17)::uuid,
        ${selected}, 'loancore', 'LATE-' || n, '["C1"]'::jsonb, '[]'::jsonb,
        repeat('c',64), 'test-key', ${stamp(600)} FROM generate_series(1,501) n`;
    await sql`INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,deadline,closed_at,closure_kind,actor)
      SELECT overlay(overlay(md5(${runId} || 'wait-' || n) placing '7' from 13) placing '8' from 17)::uuid, ${runId}, 'choose-candidate', '[{"id":"one","label":"One"}]'::jsonb,
        ${stamp(600)}::timestamptz + n * interval '1 millisecond', ${stamp(700)}, ${stamp(700)}, 'timeout', 'wait-wake'
      FROM generate_series(1,501) n`;
    await sql`INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,opened_by,deadline,closed_at,closure_kind,actor,answer_option_id)
      SELECT overlay(overlay(md5(${runId} || 'pause-' || n) placing '7' from 13) placing '8' from 17)::uuid,
        ${runId}, 'pause', '[{"id":"resume","label":"Resume"}]'::jsonb,
        ${stamp(600)}::timestamptz + n * interval '1 millisecond', ${author}, ${stamp(700)}, ${stamp(700)}, 'resume', ${author}, 'resume'
      FROM generate_series(499,501) n`;
  }, 90_000);

  async function capture(evidenceId: string, action: string, at: string, ownerRun = runId) {
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,
      state,required,captured_at,capture_method,capture_time_source,role)
      VALUES(${evidenceId},${ownerRun},'screenshot','loancore',${`selected-replay/${ownerRun}/${evidenceId}`},'image/png',
      ${'a'.repeat(64)},11,'REGISTERED',false,${at},'agent','registration','evidence')`;
    await sql`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
      VALUES(${evidenceId},${ownerRun},${action},${source})`;
  }

  afterAll(async () => {
    if (!sql) return;
    try {
      // Adversarial links cross these TWO fixture-owned aggregates. Delete their
      // captures/actions before any referenced Steps, in one transaction; never weaken
      // the foreign keys or delete rows outside these saved Run identities.
      await sql.begin(async tx => {
        await tx`DELETE FROM run_exception WHERE run_id IN (${runId}, ${foreignRunId})`;
        await tx`DELETE FROM run_observation WHERE run_id IN (${runId}, ${foreignRunId})`;
        await tx`DELETE FROM run_wait WHERE run_id IN (${runId}, ${foreignRunId})`;
        await tx`DELETE FROM run_evidence_capture WHERE run_id IN (${runId}, ${foreignRunId})`;
        await tx`DELETE FROM run_tool_action WHERE run_id IN (${runId}, ${foreignRunId})`;
        await tx`DELETE FROM run_step_execution WHERE run_id IN (${runId}, ${foreignRunId})`;
        await tx`DELETE FROM run_evidence WHERE run_id IN (${runId}, ${foreignRunId})`;
        await tx`DELETE FROM run_work_item WHERE run_id IN (${runId}, ${foreignRunId})`;
        await tx`DELETE FROM audit_events WHERE aggregate_id IN (${runId}, ${foreignRunId})`;
        await tx`DELETE FROM audit_event_heads WHERE aggregate_id IN (${runId}, ${foreignRunId})`;
        await tx`DELETE FROM audit_run WHERE run_id IN (${runId}, ${foreignRunId})`;
      });
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally { await sql.end({ timeout: 5 }); }
  });

  it('counts every registration for a default frame page without serializing the event history', async () => {
    const read = await detail.readInspectionReplay(runId, selected);
    if (read.kind !== 'inspection') throw new Error('Fixture inspection missing');
    const counts = await detail.readReplayObservationCounts(runId, read.rows.map(row => row.frame));
    expect(counts.size).toBe(100);
    expect([...counts.values()].every(value => value === 512)).toBe(true);
    const events = await detail.readObservationDeltas(runId, 500);
    const tail = await detail.readObservationDeltas(runId, 500, 500);
    expect(events.total).toBe(508); expect(events.rows).toHaveLength(500);
    expect(tail.total).toBe(508); expect(tail.rows).toHaveLength(8);
    expect(tail.rows[0]!.sequence).toBeGreaterThan(events.rows.at(-1)!.sequence);
    expect(await detail.readReplayObservationCounts(foreignRunId, read.rows.map(row => row.frame)))
      .toEqual(new Map(read.rows.map(row => [row.frame.evidenceId, 0])));
  });

  it('retains exact bounded wait totals, continuation, landing and deep-link location', async () => {
    const prefix = await detail.readWaits(runId, 500, 0, true);
    const tail = await detail.readWaits(runId, 500, 500, true);
    expect(prefix.rows).toHaveLength(500); expect(prefix.total).toBe(501);
    expect((await detail.readWaits(runId, 500)).total).toBe(504);
    expect(prefix.rows.every(row => row.kind !== 'pause')).toBe(true);
    expect(tail.rows).toHaveLength(1); expect(tail.total).toBe(501);
    const target = tail.rows[0]!;
    expect(prefix.rows.some(row => row.waitId === target.waitId)).toBe(false);
    expect(target.frameEvidenceId).toBe(ties.at(-1));
    expect(target.frameWorkItemId).toBe(selected);
    expect(await detail.readReplayWaitCursor(runId, target.waitId)).toBe(500);
    expect(await detail.readReplayWaitCursor(foreignRunId, target.waitId)).toBeNull();
    expect(await detail.readReplayWaitCursor(runId, 'invalid')).toBeNull();
    expect(await detail.readWaits(runId, 500, 1)).toEqual({ rows: [], total: 0 });
  });

  it('counts and reaches every Exception beyond the first 500 without cross-Run rows', async () => {
    const prefix = await detail.readExceptions(runId, 500);
    const tail = await detail.readExceptions(runId, 500, 500);
    expect(prefix.total).toBe(501); expect(prefix.rows).toHaveLength(500);
    expect(tail.total).toBe(501); expect(tail.rows).toHaveLength(1);
    expect(tail.rows[0]!.workItemId).toBe(selected);
    expect(prefix.rows.some(row => row.exceptionId === tail.rows[0]!.exceptionId)).toBe(false);
    expect(await detail.readExceptions(foreignRunId, 500, 500)).toEqual({ rows: [], total: 0 });
  });

  it('keeps the 500-frame prefix while selecting the exact late capture and full context', async () => {
    const prefix = await detail.readFrames(runId);
    expect(prefix.rows).toHaveLength(500); expect(prefix.total).toBe(610);
    expect(prefix.rows.every(row => !selectedFrames.includes(row.evidenceId))).toBe(true);
    const started = performance.now();
    const read = await detail.readInspectionReplay(runId, selected);
    console.info(`Selected Replay: 610 retained frames, 508 registration events; bounded page read ${(performance.now() - started).toFixed(1)}ms`);
    expect(read.kind).toBe('inspection'); if (read.kind !== 'inspection') return;
    expect(read.rows).toHaveLength(REPLAY_INSPECTION_PAGE_SIZE);
    expect(read).toMatchObject({ total: 105, framesTotal: 610, cursor: 0, previousCursor: null, nextCursor: 100,
      workItem: { workItemId: selected, subjectKey: 'E-LATE', registrationId: 'loancore', displayName: 'LoanCore' } });
    expect(read.rows[0]).toMatchObject({ globalOrdinal: 506, inspectionOrdinal: 1, observations: 512,
      frame: { evidenceId: selectedFrames[0], workItemId: selected, toolActionId: firstSelectedAction },
      step: { stepExecutionId: firstSelectedStep, planStepId: 'late-inspection-step', workItemId: selected },
      action: { toolActionId: firstSelectedAction, method: 'GET', destination: source, outcome: 'performed' } });
    expect(Date.parse(read.rows[0]!.action.startedAt)).toBe(Date.parse(stamp(600)));
    expect(read.rows.every(row => row.observations === 512)).toBe(true);
    expect(read.rows.map(row => row.frame.evidenceId)).toEqual(selectedFrames.slice(0, 100));
    expect(JSON.stringify(read)).not.toMatch(/objectKey|object_key|workspace_id/);
  });

  it('pages only this inspection in stable action/evidence order with exact global positions', async () => {
    const read = await detail.readInspectionReplay(runId, selected, 100);
    expect(read.kind).toBe('inspection'); if (read.kind !== 'inspection') return;
    expect(read).toMatchObject({ total: 105, framesTotal: 610, cursor: 100, previousCursor: 0, nextCursor: null });
    expect(read.rows.map(row => row.globalOrdinal)).toEqual([606, 607, 608, 609, 610]);
    expect(read.rows.map(row => row.inspectionOrdinal)).toEqual([101, 102, 103, 104, 105]);
    expect(read.rows.map(row => row.frame.evidenceId)).toEqual(selectedFrames.slice(100));
    expect(read.rows.slice(-2).map(row => row.frame.evidenceId)).toEqual(ties);
    expect((await detail.readLatestFrame(runId))?.evidenceId).toBe(ties[1]);
    expect(await detail.readInspectionReplay(runId, selected, 100)).toEqual(read);
  });

  it('distinguishes a valid empty inspection from foreign/unknown identity and invalid pages', async () => {
    expect(await detail.readInspectionReplay(runId, empty)).toMatchObject({ kind: 'inspection', rows: [], total: 0,
      framesTotal: 610, cursor: 0, previousCursor: null, nextCursor: null });
    for (const work of [foreign, ids.next(), 'bad']) expect(await detail.readInspectionReplay(runId, work)).toEqual({ kind: 'unavailable' });
    for (const cursor of [-100, 1, 50, 101, 200, NaN, Infinity, 2_147_483_700])
      expect(await detail.readInspectionReplay(runId, selected, cursor)).toEqual({ kind: 'unavailable' });
    expect(await detail.readInspectionReplay(runId, empty, 100)).toEqual({ kind: 'unavailable' });
    expect(await detail.readInspectionReplay('bad', selected)).toEqual({ kind: 'unavailable' });
  });

  it('keeps interleaved pages honest and resolves action-only and conflicting Step-first owners', async () => {
    const other = ids.next();
    await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,subject_key,state,attempts,cycles,observations)
      VALUES(${other},${foreignRunId},'target-1-1',5,'loancore','LoanCore','E-INTERLEAVED','OBSERVED',1,0,0)`;
    const selectedIds: string[] = [];
    const add = async (stepOwner: string | null, actionOwner: string | null, index: number, existingStep?: string) => {
      const step = existingStep ?? ids.next(), action = ids.next(), evidence = ids.next();
      if (existingStep === undefined) await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
        VALUES(${step},${foreignRunId},'interleaved-step',${stepOwner},'inspect-record','SUCCEEDED',1,${stamp(index)})`;
      await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
        action,method,destination,parameters,outcome,status,redirected,downloads,started_at,completed_at,capture)
        VALUES(${action},${foreignRunId},${step},${actionOwner},'agent','loancore','read-attribute','GET',
        ${source},'[]'::jsonb,'performed',200,false,0,${stamp(index)},${stamp(index)},'PERMITTED')`;
      await capture(evidence, action, stamp(index), foreignRunId);
      return evidence;
    };
    for (let index = 0; index < 205; index++) {
      const owner = index % 2 === 0 ? foreign : other;
      const evidence = await add(index === 0 ? null : owner, index === 0 ? foreign : index === 2 ? other : null, index);
      if (owner === foreign) selectedIds.push(evidence);
    }
    // Current storage permits these individual FK relationships. The reader must not
    // turn them into same-Run captures: foreign Step and foreign effective owner refuse.
    const foreignStepFrame = await add(null, foreign, 206, firstSelectedStep);
    const foreignOwnerFrame = await add(selected, foreign, 207);
    const first = await detail.readInspectionReplay(foreignRunId, foreign);
    expect(first.kind).toBe('inspection'); if (first.kind !== 'inspection') return;
    expect(first).toMatchObject({ total: 103, framesTotal: 205, nextCursor: 100 });
    expect(first.rows.map(row => row.globalOrdinal)).toEqual(Array.from({ length: 100 }, (_, index) => index * 2 + 1));
    expect(first.rows[0]).toMatchObject({ frame: { workItemId: foreign }, step: { workItemId: null } });
    expect(first.rows[1]).toMatchObject({ frame: { workItemId: foreign }, step: { workItemId: foreign } });
    const second = await detail.readInspectionReplay(foreignRunId, foreign, 100);
    expect(second.kind).toBe('inspection'); if (second.kind !== 'inspection') return;
    expect(second.rows.map(row => row.globalOrdinal)).toEqual([201, 203, 205]);
    expect([...first.rows, ...second.rows].map(row => row.frame.evidenceId)).toEqual(selectedIds);
    const all = await detail.readFrames(foreignRunId);
    expect(all.total).toBe(205);
    expect(all.rows.some(row => [foreignStepFrame, foreignOwnerFrame].includes(row.evidenceId))).toBe(false);
    expect(await detail.readFrame(foreignRunId, foreignStepFrame)).toBeNull();
    expect(await detail.readFrame(foreignRunId, foreignOwnerFrame)).toBeNull();
    // Evidence/capture/Tool Action cross-Run binding is independently refused by the
    // actual validate_evidence_capture trigger, before a forged row reaches any read.
    await expect(sql`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
      VALUES(${selectedFrames[0]!},${foreignRunId},${firstSelectedAction},${source})`).rejects.toMatchObject({ code: '23514' });
  });

  it('selects the exact late owned capture beyond its first inspection page, and no-owner captures', async () => {
    const lastOwned = await detail.readReplayCapture(runId, ties[1]!);
    expect(lastOwned).toMatchObject({ kind: 'capture', total: 1, framesTotal: 610,
      rows: [{ globalOrdinal: 610, frame: { evidenceId: ties[1] }, observations: 512 }] });
    if (lastOwned.kind !== 'capture') throw new Error('Exact capture missing');
    expect(lastOwned.rows).toHaveLength(1); expect(lastOwned.workItem?.workItemId).toBe(selected);
    expect(await detail.readReplayCapture(foreignRunId, ties[1]!)).toEqual({ kind: 'unavailable' });
    expect(await detail.readReplayCapture(runId, 'bad')).toEqual({ kind: 'unavailable' });
    const step = ids.next(), action = ids.next(), evidence = ids.next();
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
      VALUES(${step},${runId},'no-owner-capture',NULL,'inspect-record','SUCCEEDED',1,${stamp(700)})`;
    await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
      action,method,destination,parameters,outcome,status,redirected,downloads,started_at,completed_at,capture)
      VALUES(${action},${runId},${step},NULL,'agent','loancore','read-attribute','GET',${source},'[]'::jsonb,
        'performed',200,false,0,${stamp(700)},${stamp(700)},'PERMITTED')`;
    await capture(evidence, action, stamp(700));
    const unowned = await detail.readReplayCapture(runId, evidence);
    expect(unowned).toMatchObject({ kind: 'capture', workItem: null, total: 1, framesTotal: 611,
      rows: [{ globalOrdinal: 611, frame: { evidenceId: evidence, workItemId: null }, observations: 521 }] });
    if (unowned.kind === 'capture') expect(unowned.rows).toHaveLength(1);
  });

  it('counts a larger distinct-timestamp history once while retaining a bounded frame page', async () => {
    const fixtureStarted = performance.now();
    // The first 508 events above exercise the production appender. This larger
    // read-volume fixture batches canonical, hash-linked events under the same Run/head
    // lock order, preserving all database guards; it does not benchmark 5,000 command
    // projections unrelated to Replay. Verify the full persisted chain before reading.
    await sql.begin(async tx => {
      await tx`SELECT run_id FROM audit_run WHERE run_id=${runId} FOR KEY SHARE`;
      const [head] = await tx<{ sequence: number; hash: string }[]>`
        SELECT last_sequence::int AS sequence,last_event_hash AS hash FROM audit_event_heads
        WHERE aggregate_id=${runId} FOR UPDATE`;
      if (!head) throw new Error('Selected Replay fixture audit head missing');
      let hash = head.hash, sequence = head.sequence;
      for (let offset = 0; offset < 5000; offset += 500) {
        const rows = Array.from({ length: 500 }, (_, index) => {
          const canonical = createCanonicalAuditEvent({
            actor: { type: 'system', id: 'observation-registrar' }, eventType: 'execution.observations-registered',
            source: 'worker', outcome: 'success', aggregateId: runId, correlationId: ids.next(), sessionId: 'selected-replay',
            payload: { workItemId: selected, registered: 1 },
          }, { eventId: ids.next(), sequence: ++sequence,
            occurredAt: new Date(Date.parse(stamp(555)) + offset + index).toISOString() });
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
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS event(
            event_id uuid,actor_type text,actor_id text,event_type text,occurred_at timestamptz,source text,outcome text,
            session_id text,correlation_id text,aggregate_id text,sequence bigint,payload jsonb,previous_hash text,event_hash text)`;
      }
      await tx`UPDATE audit_event_heads SET last_sequence=${sequence},last_event_hash=${hash} WHERE aggregate_id=${runId}`;
    });
    expect(await new PostgresAuditChainReader(db).verify(runId)).toMatchObject({ valid: true, eventCount: 5508 });
    const fixtureSetupMs = performance.now() - fixtureStarted;
    const started = performance.now();
    const read = await detail.readInspectionReplay(runId, selected);
    console.info(`Selected Replay larger history: 610 frames, 5508 registration events, 100-frame page; queryOnlyMs=${(performance.now() - started).toFixed(1)}; fixtureSetupMs=${fixtureSetupMs.toFixed(1)}`);
    expect(read.kind).toBe('inspection'); if (read.kind !== 'inspection') return;
    expect(read.rows).toHaveLength(100); expect(read.rows.every(row => row.observations === 5512)).toBe(true);
  }, 90_000);

});
