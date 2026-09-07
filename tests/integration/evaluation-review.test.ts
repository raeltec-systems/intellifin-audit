import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeRun, confirmEvaluation, dispatchEvaluationReview, executeEvaluationReviewCommand, rejectEvaluation, type AgentJudgedEvaluationRow } from '@intellifin/application';
import { exceptionFingerprint, GATE_CHECKS, observationDigest, utf8Bytes, type ObservationRecord } from '@intellifin/domain';
import { createDb, createExceptionFingerprinter, createSqlClient, CryptoUuidV7Generator, DrizzleRoleRepository, EVALUATION_REVIEW_QUEUE, PostgresProceduresUnitOfWork, PostgresRunsUnitOfWork, SystemClock, type Database, type Sql } from '@intellifin/infrastructure';
import { PostgresEvaluationReviewRepository } from '../../packages/infrastructure/src/runs/evaluation-review-repository.js';
import { withRunExecutionContext } from '../../packages/infrastructure/src/runs/adapter-execution-repository.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';

// Storage/command acceptance, not a live agent journey. Pending machine rows are fixture inputs.
const url = process.env.DATABASE_URL;
describe.skipIf(!url)('human evaluation review on PostgreSQL', () => {
  let sql: Sql; let db: Database;
  const ids = new CryptoUuidV7Generator(), clock = new SystemClock();
  const author = ids.next(), procedureId = ids.next(), versionId = ids.next();
  const runIds: string[] = [];
  const session = { userId: author, sessionId: 'evaluation-review-test' };
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost','127.0.0.1','[::1]','postgres','db'].includes(target.hostname) || !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))) throw new Error('Review tests require an isolated test database');
    sql = createSqlClient(url!, { max: 5 }); db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'Review test',${author+'@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
    const version = activeRunVersion(procedureId, versionId, author);
    await new PostgresProceduresUnitOfWork(db).execute(async c => { await c.procedures.insertProcedure(version); await c.procedures.insertVersion(version); });
  });
  afterAll(async () => {
    if (!sql) return;
    try {
      for (const runId of runIds) {
        // Review history follows the evaluation's lifetime; direct ledger deletion is forbidden.
        await sql`DELETE FROM pgboss.job WHERE name=${EVALUATION_REVIEW_QUEUE} AND data->>'runId'=${runId}`;
        await sql`DELETE FROM run_evaluation_review_command WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result_review WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result WHERE run_id=${runId}`;
        await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
      }
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally { await sql.end({ timeout: 5 }); }
  });
  const dependencies = () => ({ repository: new PostgresEvaluationReviewRepository(db), roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock });
  async function seed(count = 2, conditionId = 'C2') {
    const runId = ids.next(); runIds.push(runId);
    const at = clock.now().toISOString();
    await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES (${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Review test','2026-08-01','2026-08-31','RUNNING','STANDARD',${author},${session.sessionId},'auditor',${at})`;
    const observationIds: string[] = [];
    await db.transaction(tx => withRunExecutionContext(tx, runId, async c => {
      for (let i=0;i<count;i++) {
        const workItemId = ids.next(), stepExecutionId = ids.next(), evidenceId = ids.next(), observationId = ids.next(); observationIds.push(observationId);
        await c.saveWorkItem({ workItemId, subjectKey: `E-${i}`, stepId: 'inspect-record', ordinal: i+1, registrationId: 'review-target', displayName: 'Review target', state: 'OBSERVED', attempts: 1, cycles: 0, diagnostic: null, evidenceId: null, observations: 1 });
        await c.saveStepExecution({ stepExecutionId, planStepId: 'inspect-record', workItemId, action: 'inspect-record', state: 'SUCCEEDED', attempt: 1, startedAt: at, completedAt: at, diagnostic: null });
        const record: ObservationRecord = { schemaVersion: 1, observationId, workItemId, populationRecordKey: `E-${i}`, targetSystem: 'review-target', found: 'true', observedAt: at, stepExecutionId, captureMethod: 'agent', matchOrigin: 'platform', identity: { name: 'employee_id', originalValue: `E-${i}`, normalizedValue: `E-${i}`, grounding: { evidenceId, locator: '$.nodes[0].value', label: 'Employee ID', extractedText: `E-${i}` }, corroboration: 'matched' }, attributes: [], evidenceIds: [evidenceId] };
        await c.saveObservations([{ record, digest: observationDigest(record), coverage: 'COVERED', corroboration: 'MATCHED', observedAtSource: at }]);
        // This fixture intentionally starts with a pending machine input. It is an
        // AgentJudgedEvaluationRow so every original proposal column is populated by the
        // normal adapter path before a human review overlays the effective value.
        const evaluation: AgentJudgedEvaluationRow = {
          observationId,
          coverage: 'COVERED',
          corroboration: 'MATCHED',
          evaluation: {
            conditionId,
            origin: 'AGENT_JUDGED',
            value: 'COMPLIANT',
            confirmation: 'pending',
            confidence: '0.950000',
            rationale: 'Synthetic original machine proposal',
            diagnostic: null,
            evidenceIds: [evidenceId],
          },
          agentProposal: {
            observationId,
            conditionId,
            value: 'COMPLIANT',
            confidence: '0.950000',
            rationale: 'Synthetic original machine proposal',
          },
        };
        await c.saveObservationEvaluations([evaluation]);
      }
      await c.saveGateChecks(GATE_CHECKS.map(check => ({ check, outcome: 'PASS', diagnostics: [], targetSystems: [], workItems: [], records: [], total: 0 })));
      await c.saveRunState('COMPLETED');
      expect(await completeRun(c, { run: c.run!, state: 'COMPLETED', at, plan: await c.frozenPlan() })).toMatchObject({ outcome: 'PENDING_CONFIRMATION', version: 1, sealed: false });
    }));
    return { runId, observationIds };
  }
  it('serializes concurrent answers, preserves the proposal, and seals only the last decision', async () => {
    const {runId, observationIds} = await seed();
    const originals = await sql`SELECT * FROM run_observation_evaluation WHERE run_id=${runId} ORDER BY observation_id`;
    expect(originals.every(row => row.agent_proposed_value === 'COMPLIANT' && Number(row.agent_proposed_confidence) === 0.95 && row.agent_proposed_rationale === 'Synthetic original machine proposal')).toBe(true);
    const packageBefore = await sql`SELECT * FROM run_evidence_package WHERE run_id=${runId}`;
    const answers = await Promise.all(observationIds.map(observationId => confirmEvaluation(dependencies(), { session, request: {runId, observationId, conditionId: 'C2', expectedReviewRevision: 0} })));
    expect(answers.filter(a=>a.ok)).toHaveLength(1);
    expect(answers.filter(a=>!a.ok)).toMatchObject([{ok:false,code:'stale-revision'}]);
    expect(await sql`SELECT version,sealed,outcome FROM run_result WHERE run_id=${runId}`).toEqual([{version:1,sealed:false,outcome:'PENDING_CONFIRMATION'}]);
    const undecided = observationIds[answers.findIndex(a=>!a.ok)]!;
    const result = await rejectEvaluation(dependencies(), {session, request:{runId,observationId:undecided,conditionId:'C2',expectedReviewRevision:1,replacementValue:'UNEVALUATED',rationale:'Evidence is insufficient for my confirmation'}});
    expect(result).toMatchObject({ok:true,result:{version:2,sealed:true,outcome:'INCONCLUSIVE'}});
    expect(await sql`SELECT * FROM run_observation_evaluation WHERE run_id=${runId} ORDER BY observation_id`).toEqual(originals);
    expect(await sql`SELECT * FROM run_evidence_package WHERE run_id=${runId}`).toEqual(packageBefore);
    expect(await sql`SELECT revision FROM run_result_review WHERE run_id=${runId}`).toEqual([{revision:2}]);
    expect(await sql`SELECT count(*)::int AS n FROM run_evaluation_review WHERE run_id=${runId}`).toEqual([{n:2}]);
    await expect(sql`UPDATE run_evaluation_review SET original_rationale='rewrite' WHERE run_id=${runId}`).rejects.toMatchObject({code:'23514'});
    await expect(sql`DELETE FROM run_evaluation_review WHERE run_id=${runId}`).rejects.toMatchObject({code:'23514'});
    const replay = await confirmEvaluation(dependencies(), {session,request:{runId,observationId:undecided,conditionId:'C2',expectedReviewRevision:2}});
    expect(replay.ok).toBe(false);
    expect(await sql`SELECT version FROM run_result WHERE run_id=${runId}`).toEqual([{version:2}]);
  });
  it('refuses missing rationale and revoked roles without writing a decision', async () => {
    const {runId,observationIds} = await seed(1);
    const request = {runId,observationId:observationIds[0],conditionId:'C2',expectedReviewRevision:0};
    expect(await rejectEvaluation(dependencies(), {session,request:{...request,replacementValue:'UNEVALUATED',rationale:'  '}})).toMatchObject({ok:false,code:'rationale-required'});
    await sql`DELETE FROM user_role WHERE user_id=${author}`;
    try { expect(await confirmEvaluation(dependencies(),{session,request})).toMatchObject({ok:false,code:'unauthorized'}); }
    finally { await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`; }
    expect(await sql`SELECT count(*)::int AS n FROM run_evaluation_review WHERE run_id=${runId}`).toEqual([{n:0}]);
  });
  it('confirms a sole pending evaluation and seals Pass', async () => {
    const {runId,observationIds} = await seed(1);
    const result = await confirmEvaluation(dependencies(), {session,request:{runId,observationId:observationIds[0],conditionId:'C2',expectedReviewRevision:0}});
    expect(result).toMatchObject({ok:true,action:'confirm',result:{version:2,sealed:true,outcome:'PASS',runState:'COMPLETED'}});
    expect(await sql`SELECT action,effective_origin,effective_value,effective_confirmation,replacement_value,rejection_rationale FROM run_evaluation_review WHERE run_id=${runId}`).toEqual([{
      action: 'confirm', effective_origin: 'AGENT_JUDGED', effective_value: 'COMPLIANT', effective_confirmation: 'confirmed', replacement_value: null, rejection_rationale: null,
    }]);
  });
  it('refuses an unconfigured direct Exception review before it can seal the Result', async () => {
    const {runId,observationIds} = await seed(1);
    await expect(rejectEvaluation(dependencies(), {session,request:{runId,observationId:observationIds[0],conditionId:'C2',expectedReviewRevision:0,replacementValue:'EXCEPTION',rationale:'The reviewed record violates the control'}})).rejects.toThrow('worker signer unavailable');
    expect(await sql`SELECT count(*)::int AS n FROM run_evaluation_review WHERE run_id=${runId}`).toEqual([{n:0}]);
    expect(await sql`SELECT version,sealed,outcome FROM run_result WHERE run_id=${runId}`).toEqual([{version:1,sealed:false,outcome:'PENDING_CONFIRMATION'}]);
  });

  it('dispatches a durable worker command and creates the signed Exception in the same transaction', async () => {
    const {runId, observationIds} = await seed(1, 'C1');
    const observationId = observationIds[0]!;
    const request = {
      runId,
      observationId,
      conditionId: 'C1',
      expectedReviewRevision: 0,
      replacementValue: 'EXCEPTION',
      rationale: 'The reviewed record violates the control.',
    } as const;
    const accepted = await dispatchEvaluationReview({
      dispatcher: new PostgresEvaluationReviewRepository(db),
      roles: new DrizzleRoleRepository(db),
      unitOfWork: new PostgresRunsUnitOfWork(db),
      ids,
      clock,
    }, { session, request }, 'reject');
    expect(accepted).toMatchObject({ ok: true, status: 'accepted', pending: true, action: 'reject', runId });
    if (!accepted.ok) return;
    const conflicting = await dispatchEvaluationReview({
      dispatcher: new PostgresEvaluationReviewRepository(db),
      roles: new DrizzleRoleRepository(db),
      unitOfWork: new PostgresRunsUnitOfWork(db),
      ids,
      clock,
    }, { session, request: { runId, observationId, conditionId: 'C1', expectedReviewRevision: 0 } }, 'confirm');
    expect(conflicting).toMatchObject({ ok: false, code: 'already-pending' });

    const key = 'review-worker-test-fingerprint-key';
    const worker = await executeEvaluationReviewCommand({
      repository: new PostgresEvaluationReviewRepository(db, {
        exceptions: createExceptionFingerprinter({ keyId: 'review-worker-test', key }),
      }),
      ids,
      clock,
    }, accepted.commandId);
    expect(worker).toMatchObject({ ok: true, action: 'reject', result: { sealed: true, outcome: 'CONTROL_FAILURE' } });
    expect(await executeEvaluationReviewCommand({
      repository: new PostgresEvaluationReviewRepository(db, {
        exceptions: createExceptionFingerprinter({ keyId: 'review-worker-test', key }),
      }),
      ids,
      clock,
    }, accepted.commandId)).toBeNull();

    const [command] = await sql`SELECT status,decision_id::text AS decision_id,review_revision,result_version,result_outcome,result_sealed FROM run_evaluation_review_command WHERE command_id=${accepted.commandId}`;
    expect(command).toMatchObject({ status: 'SUCCEEDED', review_revision: 1, result_version: 2, result_outcome: 'CONTROL_FAILURE', result_sealed: true });
    const [raised] = await sql`SELECT exception_id::text AS exception_id,condition_ids,diagnostics,fingerprint,fingerprint_key_id FROM run_exception WHERE run_id=${runId} AND observation_id=${observationId}`;
    expect(raised).toMatchObject({ condition_ids: ['C1'], diagnostics: [], fingerprint_key_id: 'review-worker-test' });
    expect(raised?.fingerprint).toBe(exceptionFingerprint(utf8Bytes(key), {
      procedureId,
      templateId: 'P-4',
      targetSystem: 'review-target',
      populationRecordKey: 'E-0',
      conditionIds: ['C1'],
    }));
    expect(await sql`SELECT count(*)::int AS n FROM run_evaluation_review WHERE run_id=${runId}`).toEqual([{n: 1}]);
  });

  it('keeps a refused command as history while allowing an authorized retry of the same revision', async () => {
    const {runId, observationIds} = await seed(1, 'C1');
    const observationId = observationIds[0]!;
    const request = { runId, observationId, conditionId: 'C1', expectedReviewRevision: 0 } as const;
    const enqueue = () => dispatchEvaluationReview({
      dispatcher: new PostgresEvaluationReviewRepository(db),
      roles: new DrizzleRoleRepository(db),
      unitOfWork: new PostgresRunsUnitOfWork(db),
      ids,
      clock,
    }, { session, request }, 'confirm');
    const first = await enqueue();
    expect(first).toMatchObject({ ok: true, pending: true });
    if (!first.ok) return;

    await sql`DELETE FROM user_role WHERE user_id=${author}`;
    try {
      const refused = await executeEvaluationReviewCommand({
        repository: new PostgresEvaluationReviewRepository(db, {
          exceptions: createExceptionFingerprinter({ keyId: 'review-worker-test', key: 'review-worker-test-key' }),
        }),
        ids,
        clock,
      }, first.commandId);
      expect(refused).toMatchObject({ ok: false, code: 'unauthorized' });
    } finally {
      await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
    }

    const second = await enqueue();
    expect(second).toMatchObject({ ok: true, pending: true });
    if (!second.ok) return;
    expect(second.commandId).not.toBe(first.commandId);
    await executeEvaluationReviewCommand({
      repository: new PostgresEvaluationReviewRepository(db, {
        exceptions: createExceptionFingerprinter({ keyId: 'review-worker-test', key: 'review-worker-test-key' }),
      }),
      ids,
      clock,
    }, second.commandId);
    expect(await sql`SELECT status FROM run_evaluation_review_command WHERE run_id=${runId} ORDER BY requested_at,command_id`).toEqual([{status:'REFUSED'},{status:'SUCCEEDED'}]);
  });
});
