import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeRun, NO_CORROBORATION, NO_EVALUATION, observationAbsenceDigest, registerObservations, type ObservationBatch } from '@intellifin/application';
import { observationDigest, observationIdFor, sha256HexOfBytes, utf8Bytes, type ObservationAbsenceProof, type ObservationRecord } from '@intellifin/domain';
import { createDb, createSqlClient, CryptoUuidV7Generator, DrizzleRunDetailRepository, PostgresProceduresUnitOfWork, type Database, type Sql } from '@intellifin/infrastructure';
import { withRunExecutionContext } from '../../packages/infrastructure/src/runs/adapter-execution-repository.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';

const url = process.env.DATABASE_URL;
const ids = new CryptoUuidV7Generator();
const author = ids.next(), procedureId = ids.next(), versionId = ids.next();
const expectedKeys = [{ key: 'employee_id', value: 'E-absent' }, { key: 'full_name', value: 'Pat Example' }];
const runs: string[] = [];
let sql: Sql, db: Database;

describe.skipIf(!url)('immutable absence provenance through shared registration on PostgreSQL', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost','127.0.0.1','[::1]','postgres','db'].includes(target.hostname) || !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))) throw new Error('Absence tests require a disposable test database');
    sql = createSqlClient(url!, { max: 4 }); db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES(${author},'Absence provenance test',${author+'@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES(${author},'auditor')`;
    const version = activeRunVersion(procedureId, versionId, author);
    await new PostgresProceduresUnitOfWork(db).execute(async c => { await c.procedures.insertProcedure(version); await c.procedures.insertVersion(version); });
  });
  afterAll(async () => {
    if (!sql) return;
    try {
      for (const runId of runs) {
        await sql`DELETE FROM run_result_review WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
        // The proof follows the lifetime of its immutable parent Observation.
        await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
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

  async function fixture(mode: 'complete' | 'partial' | 'mistyped' | 'missing' = 'complete') {
    const runId = ids.next(), workItemId = ids.next(), stepExecutionId = ids.next(), evidenceId = ids.next();
    const at = new Date().toISOString();
    const day = String(runs.length + 1).padStart(2,'0');
    runs.push(runId);
    await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
      VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,'Absence provenance',${`2026-08-${day}`},${`2026-08-${day}`},'RUNNING','STANDARD',${author},'absence-test','auditor',${at})`;
    const bytes = utf8Bytes(JSON.stringify({ schemaVersion: 1, nodes: [], search: { complete: true } }));
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required)
      VALUES(${evidenceId},${runId},'structural-snapshot','loancore',${`absence/${runId}`},'application/vnd.intellifin.web-tree+json',${sha256HexOfBytes(bytes)},${bytes.byteLength},'REGISTERED',false)`;
    const record: ObservationRecord = { schemaVersion: 1, observationId: observationIdFor(workItemId,'E-absent'), workItemId, populationRecordKey: 'E-absent',
      targetSystem: 'loancore', found: 'false', observedAt: at, stepExecutionId, captureMethod: 'adapter', matchOrigin: 'platform', identity: null, attributes: [], evidenceIds: [evidenceId] };
    const proof: ObservationAbsenceProof | null = mode === 'missing' ? null : {
      queryKeys: mode === 'mistyped' ? [{ key: 'employee_id', value: 'E-wrong' }, expectedKeys[1]!] : expectedKeys,
      emptyResultEvidenceId: evidenceId, extractionComplete: mode !== 'partial',
    };
    let offered!: ObservationBatch;
    await db.transaction(tx => withRunExecutionContext(tx, runId, async c => {
      await c.saveWorkItem({ workItemId, stepId: 'inspect', ordinal: 1, registrationId: 'loancore', displayName: 'LoanCore', state: 'OBSERVED', attempts: 1, cycles: 0, diagnostic: null, evidenceId, observations: 1 });
      await c.saveStepExecution({ stepExecutionId, planStepId: 'inspect', workItemId, action: 'inspect-record', state: 'SUCCEEDED', attempt: 1, startedAt: at, completedAt: at, diagnostic: null });
      offered = { run: c.run!, workItemId, stepExecutionId, targetSystem: 'loancore', templateId: 'P-1', runStartedAt: at, registeredAt: at,
        items: [{ record, observedAtSource: at, absence: proof, expectedQueryKeys: expectedKeys }] };
      await registerObservations(c, offered, { corroboration: NO_CORROBORATION, evaluation: NO_EVALUATION,
        exceptions: { keyId: 'unused-absence-test', fingerprint: () => { throw new Error('No evaluation can raise an Exception in this persistence fixture'); } } });
    }));
    return { runId, record, proof, offered, evidenceId };
  }

  it.each(['complete','partial','mistyped','missing'] as const)('retains %s proof without changing the wire digest or the one absence judge', async mode => {
    const row = await fixture(mode);
    const [stored] = await sql`SELECT proof,expected_query_keys,digest FROM run_observation_absence WHERE observation_id=${row.record.observationId}`;
    expect(stored).toEqual({ proof: row.proof, expected_query_keys: expectedKeys,
      digest: observationAbsenceDigest(row.record.observationId, row.proof, expectedKeys) });
    const [observation] = await sql`SELECT digest,coverage FROM run_observation WHERE observation_id=${row.record.observationId}`;
    expect(observation).toEqual({ digest: observationDigest(row.record), coverage: mode === 'complete' ? 'COVERED' : 'UNINSPECTED' });
    const [event] = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${row.runId} AND event_type='execution.observations-registered'`;
    expect(event!.payload.absenceDigests).toEqual([{ observationId: row.record.observationId, digest: stored!.digest }]);
    expect(JSON.stringify(event!.payload)).not.toContain('Pat Example');
    const detail = new DrizzleRunDetailRepository(db);
    expect((await detail.readObservations(row.runId)).rows[0]?.absence)
      .toEqual({ proof: row.proof, expectedQueryKeys: expectedKeys, integrityValid: true });
    await db.transaction(tx => withRunExecutionContext(tx, row.runId, async c => {
      expect(await registerObservations(c, row.offered, { corroboration: NO_CORROBORATION, evaluation: NO_EVALUATION,
        exceptions: { keyId: 'unused-absence-test', fingerprint: () => { throw new Error('No Exception'); } } })).toMatchObject({ registered: 0, alreadyRegistered: 1 });
    }));
    expect(await sql`SELECT observation_id FROM run_observation_absence WHERE observation_id=${row.record.observationId}`).toHaveLength(1);
  });

  it('rejects rewriting or deleting proof and refuses changed replay provenance', async () => {
    const row = await fixture();
    await expect(sql`UPDATE run_observation_absence SET proof=NULL WHERE observation_id=${row.record.observationId}`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`DELETE FROM run_observation_absence WHERE observation_id=${row.record.observationId}`).rejects.toMatchObject({ code: '23514' });
    const changed = { ...row.offered, items: [{ ...row.offered.items[0]!, absence: { ...row.proof!, extractionComplete: false } }] };
    await expect(db.transaction(tx => withRunExecutionContext(tx, row.runId, c => registerObservations(c, changed, {
      corroboration: NO_CORROBORATION, evaluation: NO_EVALUATION, exceptions: { keyId: 'unused-absence-test', fingerprint: () => { throw new Error('No Exception'); } },
    })))).rejects.toMatchObject({ refusal: 'digest-mismatch' });
    await db.transaction(tx => withRunExecutionContext(tx, row.runId, async c => {
      await completeRun(c, { run: c.run!, state: 'INCONCLUSIVE', at: new Date().toISOString(), plan: null });
    }));
    await expect(sql`UPDATE run_observation_absence SET digest=${'0'.repeat(64)} WHERE observation_id=${row.record.observationId}`).rejects.toMatchObject({ code: '23514' });
    // BEFORE INSERT must refuse sealed enrichment, independently of the PK's duplicate error.
    await expect(sql`INSERT INTO run_observation_absence(observation_id,run_id,proof,expected_query_keys,digest)
      VALUES(${row.record.observationId},${row.runId},NULL,'[]'::jsonb,${'0'.repeat(64)})`).rejects.toMatchObject({ code: '23514' });
  });
});
