import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createSqlClient, CryptoUuidV7Generator, DrizzleRunDetailRepository,
  PostgresAuditUnitOfWork, PostgresProceduresUnitOfWork, type Database, type Sql } from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';

const url = process.env.DATABASE_URL;
const ids = new CryptoUuidV7Generator();
const author = ids.next(), procedureId = ids.next(), versionId = ids.next(), runId = ids.next(), otherRun = ids.next();
let sql: Sql, db: Database;
let waits: string[] = [];
const uniqueWork = ids.next(), ambiguousWorks = [ids.next(), ids.next()], foreignWork = ids.next();
const uniqueEvidence = ids.next(), ambiguousEvidence = ids.next(), foreignEvidence = ids.next();
describe.skipIf(!url)('retained decision history on PostgreSQL 18', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) || !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))) throw new Error('Decision history requires a disposable database');
    sql = createSqlClient(url!, { max: 4 }); db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES(${author},'Decision Auditor',${author+'@test.invalid'})`;
    const version = activeRunVersion(procedureId, versionId, author);
    await new PostgresProceduresUnitOfWork(db).execute(async c => { await c.procedures.insertProcedure(version); await c.procedures.insertVersion(version); });
    for (const [i, id] of [runId, otherRun].entries()) await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,
      procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES(${ids.next()},${id},${ids.next()},${procedureId},${versionId},1,'Decision history',
      ${`2026-07-0${i+1}`},${`2026-07-0${i+1}`},'RUNNING','STANDARD',${author},'decisions','auditor',now())`;
    const bindings = [
      { run: runId, work: uniqueWork, evidence: uniqueEvidence, ordinal: 1 },
      { run: runId, work: ambiguousWorks[0]!, evidence: ambiguousEvidence, ordinal: 2 },
      { run: runId, work: ambiguousWorks[1]!, evidence: ambiguousEvidence, ordinal: 3 },
      { run: otherRun, work: foreignWork, evidence: foreignEvidence, ordinal: 1 },
    ];
    for (const binding of bindings) {
      await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required,captured_at,capture_method,capture_time_source,role)
        VALUES(${binding.evidence},${binding.run},'structural-snapshot','target',${`decisions/${binding.evidence}`},'application/json',${'a'.repeat(64)},1,'REGISTERED',false,now(),'agent','registration','evidence') ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,subject_key,state,attempts,cycles,observations)
        VALUES(${binding.work},${binding.run},'recorded-step',${binding.ordinal},'target','Target',${String(binding.ordinal)},'OBSERVED',1,0,0)`;
      const step = ids.next();
      await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
        VALUES(${step},${binding.run},'recorded-step',${binding.work},'inspect-record','SUCCEEDED',1,now())`;
      await sql`INSERT INTO run_agent_turn(run_id,sequence,work_item_id,step_execution_id,snapshot_evidence_id,status,reserved_tokens,response)
        VALUES(${binding.run},${binding.ordinal},${binding.work},${step},${binding.evidence},'COMPLETED',1,'{}'::jsonb)`;
    }
    waits = Array.from({ length: 52 }, () => ids.next());
    for (const [i, waitId] of waits.entries()) {
      const answer = i === 1 ? 'abort' : 'retry';
      await sql`INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,deadline,closed_at,closure_kind,answer_option_id,actor)
        VALUES(${waitId},${runId},'retry-or-skip',${sql.json([{ id: answer, label: 'Untrusted label' }])},now(),now()+interval '1 hour',now(),'answer',${answer},${author})`;
      await new PostgresAuditUnitOfWork(db).execute(async c => {
        await c.auditEvents.append({ actor: { type: 'system', id: 'escalation-platform' }, source: 'platform', outcome: 'success',
          eventType: 'execution.escalation-raised', aggregateId: runId, correlationId: ids.next(), sessionId: 'decisions',
          payload: { waitId, kind: 'retry-or-skip', ...([0, 2, 3].includes(i) ? { stepId: 'recorded-step', supportingEvidenceIds: [i === 0 ? uniqueEvidence : i === 2 ? ambiguousEvidence : foreignEvidence] } : {}) } });
        await c.auditEvents.append({ actor: { type: 'human', id: author }, source: 'web', outcome: 'success',
          eventType: 'execution.escalation-answered', aggregateId: runId, correlationId: ids.next(), sessionId: 'decisions',
          payload: { waitId, kind: 'retry-or-skip', answerOptionId: answer, closureKind: 'answer', recordedNote: 'Private note must not escape' } });
      });
    }
  }, 60_000);
  afterAll(async () => {
    if (!sql) return;
    try {
      for (const id of [runId, otherRun]) await sql.begin(async tx => {
        await tx`DELETE FROM run_wait WHERE run_id=${id}`;
        await tx`DELETE FROM run_agent_turn WHERE run_id=${id}`;
        await tx`DELETE FROM run_step_execution WHERE run_id=${id}`;
        await tx`DELETE FROM run_work_item WHERE run_id=${id}`;
        await tx`DELETE FROM run_evidence WHERE run_id=${id}`;
        await tx`DELETE FROM audit_events WHERE aggregate_id=${id}`;
        await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${id}`;
        await tx`DELETE FROM audit_run WHERE run_id=${id}`;
      });
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally { await sql.end({ timeout: 5 }); }
  });
  it('retains answer and abort, exact Step metadata and honest historical gaps without note text', async () => {
    const page = (await new DrizzleRunDetailRepository(db).readTimeline(runId)).decisions;
    expect(page.total).toBe(52);
    expect(page.rows[0]).toMatchObject({ actorId: author, answerOptionId: 'retry', stepId: 'recorded-step', workItemId: uniqueWork });
    expect(page.rows[1]).toMatchObject({ answerOptionId: 'abort', stepId: null, workItemId: null });
    expect(JSON.stringify(page)).not.toContain('Private note');
    expect(page.rows[2]).toMatchObject({ stepId: 'recorded-step', workItemId: null });
    expect(page.rows[3]).toMatchObject({ stepId: 'recorded-step', workItemId: null });
  });
  it('pages every decision exactly once and resolves a selected wait beyond the first page', async () => {
    const repo = new DrizzleRunDetailRepository(db);
    const first = (await repo.readTimeline(runId)).decisions;
    const next = (await repo.readTimeline(runId, undefined, first.nextCursor!)).decisions;
    expect(first.rows).toHaveLength(50); expect(next.rows).toHaveLength(2); expect(next.nextCursor).toBeNull();
    expect(new Set([...first.rows, ...next.rows].map(row => row.sequence)).size).toBe(52);
    expect((await repo.readTimeline(runId, undefined, 0, waits[51])).decisions.rows[0]?.waitId).toBe(waits[51]);
    expect((await repo.readTimeline(runId, undefined, 0, waits[51]!.toUpperCase())).decisions.rows[0]?.waitId).toBe(waits[51]);
    for (const selected of ['bad', ids.next()]) expect((await repo.readTimeline(runId, undefined, 0, selected)).decisions.selectionFound).toBe(false);
    expect((await repo.readTimeline(runId, undefined, 1, waits[0])).decisions.selectionFound).toBe(false);
    expect((await repo.readTimeline(runId, undefined, 999999)).decisions.selectionFound).toBe(false);
    expect((await repo.readTimeline(otherRun, undefined, 0, waits[51])).decisions).toEqual({ rows: [], total: 0, nextCursor: null, selectionFound: false });
  });
  it('does not join an answer envelope from another Run to this Run’s wait', async () => {
    await new PostgresAuditUnitOfWork(db).execute(c => c.auditEvents.append({
      actor: { type: 'human', id: author }, source: 'web', outcome: 'success', eventType: 'execution.escalation-answered',
      aggregateId: otherRun, correlationId: ids.next(), sessionId: 'decisions',
      payload: { waitId: waits[0]!, kind: 'retry-or-skip', answerOptionId: 'retry', closureKind: 'answer' },
    }));
    expect((await new DrizzleRunDetailRepository(db).readTimeline(otherRun)).decisions.total).toBe(0);
    expect((await new DrizzleRunDetailRepository(db).readTimeline(otherRun, undefined, 0, waits[0])).decisions.selectionFound).toBe(false);
  });
});
