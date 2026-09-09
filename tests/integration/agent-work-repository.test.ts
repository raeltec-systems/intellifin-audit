import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXED_ESCALATION_OPTIONS, raiseEscalation, type AgentWorkCheckpoint, type AgentTurnRecord, type EvidenceStore } from '@intellifin/application';
import { createDb, createSqlClient, CryptoUuidV7Generator, PostgresWaitRepository, SystemClock, PostgresProceduresUnitOfWork, type Database, type Sql } from '@intellifin/infrastructure';
import { utf8Bytes, WEB_TREE_MEDIA_TYPE, type SanitizedToolAction } from '@intellifin/domain';
import { PostgresAgentWorkRepository } from '../../packages/infrastructure/src/runs/agent-work-repository.js';
import { freezeAgentCapture } from '../../packages/application/src/runs/agent-capture.js';
import { NO_CREDENTIALS } from '../../packages/application/src/runs/credential-guard.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';

const url = process.env['DATABASE_URL'];
describe.skipIf(!url)('agent work uses the shared PostgreSQL evidence and execution context', () => {
  let sql: Sql; let db: Database; let repository: PostgresAgentWorkRepository;
  const ids = new CryptoUuidV7Generator();
  const author = ids.next(), procedureId = ids.next(), versionId = ids.next(), runId = ids.next();
  const workItemId = ids.next(), stepExecutionId = ids.next(), toolActionId = ids.next();
  const at = '2026-09-07T10:00:00.000Z';
  let snapshotId: string;
  const action: SanitizedToolAction = { toolActionId, runId, workItemId, stepExecutionId,
    surface: 'agent', targetSystem: 'synthetic-target', action: 'read-attribute', method: 'GET',
    destination: 'https://synthetic.invalid/record', parameters: [], outcome: 'performed', denial: null,
    offending: null, status: 200, redirected: false, downloads: 0, startedAt: at, completedAt: at,
    diagnostic: null, capture: 'PERMITTED', captureSuppression: null };
  const checkpoint: AgentWorkCheckpoint = { revision: 1, status: 'EXECUTING', runStartedAt: at,
    leaseUntil: '2026-09-07T10:02:00.000Z', attemptId: ids.next(), workItemId: null, waitId: null,
    pendingWait: null, nextTurn: 1, tokens: 0, reservedTokens: 0, model: null, diagnostic: null };
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost','127.0.0.1','[::1]','postgres','db'].includes(target.hostname) || !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))) throw new Error('Agent work tests require an isolated test database');
    sql = createSqlClient(url!, { max: 4 }); db = createDb(sql); repository = new PostgresAgentWorkRepository(db);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'Agent work test',${author + '@test.invalid'})`;
    const version = activeRunVersion(procedureId, versionId, author);
    await new PostgresProceduresUnitOfWork(db).execute(async c => { await c.procedures.insertProcedure(version); await c.procedures.insertVersion(version); });
    await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES (${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Agent work test','2026-08-01','2026-08-31','RUNNING','STANDARD',${author},'agent-work-test','auditor',${at})`;
    await repository.transaction(runId, async c => {
      await c.saveWorkItem({ workItemId, subjectKey: 'E-1', stepId: 'inspect-record', ordinal: 1, registrationId: 'synthetic-target', displayName: 'Synthetic target', state: 'IN_PROGRESS', attempts: 1, cycles: 0, diagnostic: null, evidenceId: null, observations: 0 });
      await c.saveStepExecution({ stepExecutionId, planStepId: 'inspect-record', workItemId, action: 'inspect-record', state: 'RUNNING', attempt: 1, startedAt: at, completedAt: null, diagnostic: null });
      await c.saveToolAction(action);
    });
  });
  afterAll(async () => {
    if (!sql) return;
    try {
      await sql`DELETE FROM notification WHERE run_id=${runId}`;
      await sql`DELETE FROM pgboss.job WHERE name='waits' AND data->>'runId'=${runId}`;
      await sql`DELETE FROM run_wait WHERE run_id=${runId}`;
      await sql`DELETE FROM run_agent_turn WHERE run_id=${runId}`;
      await sql`DELETE FROM run_agent_work WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
      await sql`DELETE FROM run_tool_action WHERE run_id=${runId}`;
      await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
      await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
      await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
      await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
      await sql`DELETE FROM procedure_version WHERE version_id=${versionId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally { await sql.end({ timeout: 5 }); }
  });
  it('preserves exact Tool Action identity on redelivery and refuses a changed collision', async () => {
    await repository.transaction(runId, c => c.saveToolAction(action));
    await expect(repository.transaction(runId, c => c.saveToolAction({ ...action, targetSystem: 'other-target' }))).rejects.toThrow('Tool Action identity conflict');
    const stored = await repository.transaction(runId, async c => c.toolActions);
    expect(stored).toEqual([action]);
  });
  it('registers verified bytes and capture binding through the existing Evidence tables', async () => {
    const objects = new Map<string, Uint8Array>();
    const store: EvidenceStore = { async putIfAbsent(k,b) { if (!objects.has(k)) objects.set(k,b.slice()); }, async read(k) { return objects.get(k)?.slice() ?? null; } };
    const bytes = utf8Bytes('{"schemaVersion":1,"nodes":[]}');
    const captured = await freezeAgentCapture({ runId, targetSystem: action.targetSystem, templateId: 'P-1', toolActionId,
      sourceLocation: action.destination, artifacts: [{ kind: 'structural-snapshot', mediaType: WEB_TREE_MEDIA_TYPE, location: action.destination, bytes }],
      store, guard: NO_CREDENTIALS, budget: () => 5000, now: () => at,
      commit: work => repository.transaction(runId, async c => { await work(c); return true; }) });
    expect(captured?.snapshot.bytes).toEqual(bytes); snapshotId = captured!.snapshot.evidenceId;
    const facts = await repository.transaction(runId, async c => ({ evidence: c.evidence, captures: c.captures }));
    expect(facts.evidence).toHaveLength(1);
    expect(facts.evidence[0]).toMatchObject({ evidenceId: snapshotId, state: 'REGISTERED', captureMethod: 'agent' });
    expect(facts.captures).toEqual([{ evidenceId: snapshotId, runId, toolActionId, sourceLocation: action.destination }]);
    await expect(repository.transaction(runId, c => c.saveCapture({ evidenceId: snapshotId, toolActionId, sourceLocation: 'https://other.invalid' }))).rejects.toThrow('Evidence capture binding refused');
  });
  it('persists an unknown model reservation on restart and never rewrites a completed turn', async () => {
    const turn: AgentTurnRecord = { sequence: 1, workItemId, stepExecutionId, snapshotEvidenceId: snapshotId, status: 'RESERVED', reservedTokens: 25000, response: null, diagnostic: null };
    await repository.transaction(runId, async c => { await c.saveTurn(turn); await c.saveCheckpoint({ ...checkpoint, nextTurn: 2, reservedTokens: 25000 }, 'RUNNING'); });
    const restarted = new PostgresAgentWorkRepository(db);
    const facts = await restarted.transaction(runId, async c => ({ checkpoint: c.checkpoint, turns: c.turns }));
    expect(facts.checkpoint).toMatchObject({ nextTurn: 2, reservedTokens: 25000, tokens: 0 });
    expect(facts.turns[0]).toMatchObject(turn);
    await restarted.transaction(runId, c => c.saveTurn({ ...turn, status: 'FAILED', diagnostic: 'model-unavailable' }));
    await expect(restarted.transaction(runId, c => c.saveTurn({ ...turn, status: 'FAILED', diagnostic: 'different' }))).rejects.toThrow('Agent turn completion conflict');
    await expect(sql`UPDATE run_agent_turn SET diagnostic='rewrite' WHERE run_id=${runId} AND sequence=1`).rejects.toMatchObject({ code: '23514' });
  });
  it('holds the shared Run lock until the checkpoint transaction commits', async () => {
    let release!: () => void; let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const first = repository.transaction(runId, async c => { entered(); await held; await c.saveCheckpoint({ ...c.checkpoint!, revision: 2 }, 'RUNNING'); });
    await started;
    let secondEntered = false;
    const second = repository.transaction(runId, async c => { secondEntered = true; return c.checkpoint?.revision; });
    try { await new Promise(resolve => setTimeout(resolve, 25)); expect(secondEntered).toBe(false); }
    finally { release(); }
    await first; expect(await second).toBe(2);
  });
  it('binds the pending wait intent before a crash can lose an auditor answer', async () => {
    const pendingWait = { kind: 'unnamed-value' as const, options: FIXED_ESCALATION_OPTIONS['unnamed-value'] };
    await repository.transaction(runId, c => c.saveCheckpoint({ ...c.checkpoint!, status: 'WAITING', pendingWait }, 'RUNNING'));
    const waits = new PostgresWaitRepository(db);
    const raised = await raiseEscalation({ repository: waits, ids, clock: new SystemClock() }, { runId, kind: pendingWait.kind });
    expect(raised.ok).toBe(true);
    if (!raised.ok) throw new Error(raised.reason);
    // No post-raise checkpoint attachment is made. A fresh process must still find it.
    const fresh = new PostgresAgentWorkRepository(db);
    const waiting = await fresh.transaction(runId, async c => ({ checkpoint: c.checkpoint, wait: c.wait }));
    expect(waiting.checkpoint?.waitId).toBe(raised.wait.waitId);
    await waits.transaction(runId, async c => c.closeWait({ waitId: raised.wait.waitId, expectedRunRevision: c.run!.revision,
      answerOptionId: 'mark-unevaluated', actor: author, now: new Date().toISOString(), stateAfterClose: 'RUNNING' }));
    expect(await fresh.transaction(runId, async c => c.wait?.answerOptionId)).toBe('mark-unevaluated');
  });

});
