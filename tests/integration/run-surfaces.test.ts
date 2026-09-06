import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GATE_CHECKS } from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRunDetailRepository,
  DrizzleRunListRepository,
  PostgresProceduresUnitOfWork,
  RUN_LIST_PAGE_SIZE,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * The Story 3.11 read models, against a real PostgreSQL 18.
 *
 * They are pure SQL — a keyset page with a total order, two lateral joins, a fingerprint
 * diff and eight bounded detail reads — and none of that is exercised by a component test.
 * The rows are written HERE with raw SQL on purpose: the point is what the READ answers
 * about rows that already exist, and driving a whole Run to produce them would test the
 * execution stages instead.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('the Run surfaces read models', () => {
  let sql: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const author = `${ids.next()}-run-surfaces`;
  const procedureId = ids.next();
  const versionId = ids.next();
  const otherVersionId = ids.next();
  const runs = { first: ids.next(), second: ids.next(), third: ids.next(), other: ids.next() };
  const workItemId = ids.next();
  const observationId = ids.next();
  const evidenceId = ids.next();
  const exceptionId = ids.next();

  beforeAll(async () => {
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(new URL(url!).hostname)) {
      throw new Error('Run surface tests require an isolated database');
    }
    sql = createSqlClient(url!, { max: 6 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},${author},${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
    const row = activeRunVersion(procedureId, versionId, author);
    await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
      await context.procedures.insertProcedure(row);
      await context.procedures.insertVersion(row);
    });
    // A second version of the SAME Procedure, so "only across compatible versions" has a
    // case that is genuinely incomparable rather than merely untested.
    const second = { ...activeRunVersion(procedureId, otherVersionId, author), versionNumber: 2 };
    await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
      await context.procedures.insertVersion(second);
    });

    // Order matters. Generation 21 FREEZES a Run's Evidence rows once its package is
    // sealed, so every artifact, Work Item, Observation and Exception is written while
    // the Run is still QUEUED, and the seal and the terminal state come last.
    await insertRun(runs.first, versionId, '2026-08-01', '2026-08-31', '2026-09-01T09:00:00Z');
    await raiseException(runs.first, 'a'.repeat(64), workItemId, observationId, evidenceId, exceptionId);
    await terminate(runs.first, 'COMPLETED', '2026-09-01T09:00:00Z');

    await insertRun(runs.second, versionId, '2026-07-01', '2026-07-31', '2026-09-02T09:00:00Z');
    await raiseException(runs.second, 'b'.repeat(64), ids.next(), ids.next(), ids.next(), ids.next());
    await terminate(runs.second, 'INCONCLUSIVE', '2026-09-02T09:00:00Z');

    await insertRun(runs.third, versionId, '2026-06-01', '2026-06-30', '2026-09-03T09:00:00Z');

    await insertRun(runs.other, otherVersionId, '2026-05-01', '2026-05-31', '2026-09-04T09:00:00Z');
    // Seeded with an EMPTY published document, which the column's CHECK permits.
    await terminate(runs.other, 'COMPLETED', '2026-09-04T09:00:00Z', '{}');
  });

  async function insertRun(runId: string, version: string, from: string, to: string, at: string): Promise<void> {
    await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,
                period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
              VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${version},${version === versionId ? 1 : 2},'Run surfaces fixture',
                ${from},${to},'QUEUED','STANDARD',${author},${author},'auditor',${at})`;
  }

  /**
   * Move a Run to a terminal state the way production does: package, Result, then state.
   *
   * Generations 21 and 25 refuse a Run that REACHES a terminal state with no sealed
   * package and no Result, and postgres.js commits each statement on its own, so the
   * deferred trigger fires at the end of each one.
   */
  async function terminate(
    runId: string,
    state: 'COMPLETED' | 'INCONCLUSIVE',
    at: string,
    /**
     * The published document. `{}` models a row an older build wrote: the column's CHECK
     * says only that it is an object, and generation 25 refuses to UPDATE a sealed Result
     * — so an unreadable document has to be seeded, never patched in afterwards.
     */
    publication = '{"statement":"x","population":{"rowsParsed":0,"included":0,"excluded":0,"indeterminate":0},"period":{"from":"2026-01-01","to":"2026-01-31"},"exclusions":[],"coverage":[],"conditions":[],"controlFields":[],"exceptions":{"total":0,"records":[]},"unevaluated":{"total":0,"records":[]},"gate":{"passed":true,"checks":20,"failed":[]},"evidence":{"state":"SEALED","requiredTotal":0,"registered":0,"missingRequired":0,"abandoned":0}}',
  ): Promise<void> {
    await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
              VALUES(${runId},'SEALED',${state},${at},0,0,'[]'::jsonb,'[]'::jsonb)`;
    await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
              VALUES(${runId},1,${state === 'COMPLETED' ? 'PASS' : 'INCONCLUSIVE'},${state === 'COMPLETED' ? 'pass' : 'gate-failed'},
                true,${state},${state === 'COMPLETED'},${at},'Scope sentence',${publication}::jsonb)`;
    await sql`UPDATE audit_run SET state=${state} WHERE run_id=${runId}`;
  }

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const runId of Object.values(runs)) {
        // Generation 23 makes an Exception permanent while its Observation exists, and
        // cascades it away when the Observation goes. So the Observation is what is
        // deleted — it takes the record, its digest and its Exception together.
        await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_exception WHERE run_id=${runId}`;
        await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
        // The worker's post-Run integrity sweep can write a finding against a seeded
        // artifact whose object was never uploaded, and the finding carries a real
        // foreign key to the Run. Without this the teardown fails and leaves rows
        // that make an unrelated suite's empty-list assertion fail.
        await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result WHERE run_id=${runId}`;
        // The SEAL goes before what it sealed. Generation 27 refuses to delete an Evidence
        // row while its package row survives, because that leaves a package claiming
        // artifacts whose metadata is gone and an integrity sweep that cannot see it.
        // Removing a whole Run is still allowed and this is what "whole" means.
        await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM population_row WHERE run_id=${runId}`;
        await sql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
        await sql`DELETE FROM population_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM population_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
      }
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  const list = (): DrizzleRunListRepository => new DrizzleRunListRepository(db);
  const detail = (): DrizzleRunDetailRepository => new DrizzleRunDetailRepository(db);
  const mine = async (after?: string | null, limit = RUN_LIST_PAGE_SIZE) => {
    const page = await list().listRuns(after, limit);
    return { ...page, rows: page.rows.filter((row) => row.procedureId === procedureId) };
  };

  it('orders by initiation descending and pages by a keyset with a total order', async () => {
    const all = await mine();
    expect(all.rows.map((row) => row.runId)).toEqual([runs.other, runs.third, runs.second, runs.first]);
    // A keyset page needs a TOTAL order or a row appears on two pages, or on none.
    const first = await list().listRuns(null, 1);
    expect(first.rows).toHaveLength(1);
    expect(first.next).toBe(first.rows[0]!.runId);
    const second = await list().listRuns(first.next, 1);
    expect(second.rows[0]!.runId).not.toBe(first.rows[0]!.runId);
    // A cursor naming a Run that is not there is the FIRST page, never a 500: it comes
    // out of the query string and a person who edits a URL should meet page one.
    expect((await list().listRuns('not-a-uuid', 1)).rows[0]!.runId).toBe(first.rows[0]!.runId);
    // A syntactically VALID uuid naming no Run is the same case, and it used to come back
    // EMPTY — the cursor was compared against a scalar subquery, so an absent Run made
    // `(initiated_at, run_id) < NULL` NULL for every row. An empty page is neither the
    // first page nor an error: it tells the reader this deployment has no Runs at all.
    const missing = await list().listRuns(ids.next(), 1);
    expect(missing.rows).toHaveLength(1);
    expect(missing.rows[0]!.runId).toBe(first.rows[0]!.runId);
  });

  it('reports no conclusion and no Gate for a Run that has neither', async () => {
    const queued = (await mine()).rows.find((row) => row.runId === runs.third)!;
    expect(queued).toMatchObject({ state: 'QUEUED', outcome: null, resultSealed: null, gateChecks: 0, gateFailed: 0, endedAt: null });
    // A Run in flight has no findings to compare, so its Change cell is absent rather
    // than a diff against a set that is still being written.
    expect(queued.change).toEqual({ kind: 'absent' });
  });

  it('counts the §H rows written for a Run, and how many failed', async () => {
    for (const [index, check] of GATE_CHECKS.entries()) {
      const failed = check === 'per-record-coverage';
      await sql`INSERT INTO run_gate_check(run_id,check_name,outcome,diagnostics,target_systems,work_items,records,total,decided_at)
                VALUES(${runs.second},${check},${failed ? 'FAIL' : 'PASS'},
                  ${failed ? '["record-uninspected"]' : '[]'}::jsonb,
                  ${failed ? '["accessgate"]' : '[]'}::jsonb,
                  '[]'::jsonb,${failed ? '["E-001"]' : '[]'}::jsonb,${failed ? 3 : 0},
                  ${`2026-09-02T09:0${String(index % 10)}:00Z`})`;
    }
    const row = (await mine()).rows.find((entry) => entry.runId === runs.second)!;
    expect(row.gateChecks).toBe(GATE_CHECKS.length);
    expect(row.gateFailed).toBe(1);
    const rows = await detail().readGateChecks(runs.second);
    expect(rows).toHaveLength(GATE_CHECKS.length);
    expect(rows.filter((entry) => entry.outcome === 'FAIL').map((entry) => entry.check)).toEqual(['per-record-coverage']);
    expect(rows.find((entry) => entry.check === 'per-record-coverage')).toMatchObject({
      diagnostics: ['record-uninspected'],
      targetSystems: ['accessgate'],
      records: ['E-001'],
      total: 3,
    });
  });

  it('compares fingerprints with the previous terminal Run, and refuses across versions', async () => {
    // Story 3.7's fingerprint has the RUN deliberately outside it, so the same finding
    // recurring in a later Run fingerprints the same. That is what makes this column
    // computable at all.
    const rows = (await mine()).rows;
    // Run two follows run one on the SAME version: one fingerprint appeared and one went.
    expect(rows.find((row) => row.runId === runs.second)!.change).toEqual({ kind: 'compared', added: 1, resolved: 1 });
    // Run one is the earliest terminal Run of this Procedure, so there is nothing before it.
    expect(rows.find((row) => row.runId === runs.first)!.change).toEqual({ kind: 'absent' });
    // The last Run ran a DIFFERENT version, so its findings are not comparable: a finding
    // that "disappeared" may be a condition the newer version no longer states.
    expect(rows.find((row) => row.runId === runs.other)!.change).toEqual({ kind: 'incomparable' });
  });

  async function raiseException(
    runId: string,
    fingerprint: string,
    item: string,
    observation: string,
    evidence: string,
    exception: string,
  ): Promise<void> {
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required)
              VALUES(${evidence},${runId},'adapter-extraction','accessgate',${`runs/${runId}/extract`},
                'application/json',${'c'.repeat(64)},1024,'REGISTERED',false)`;
    await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,state,attempts,cycles,diagnostic,evidence_id,observations)
              VALUES(${item},${runId},'step-1',1,'accessgate','AccessGate','OBSERVED',1,0,NULL,${evidence},1)`;
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at,completed_at,diagnostic)
              VALUES(${ids.next()},${runId},'step-1',${item},'extract-adapter','SUCCEEDED',1,'2026-09-01T09:01:00Z','2026-09-01T09:01:20Z',NULL)`;
    // A seeded prompt-like value, so the surface's untrusted rendering has real bytes.
    const identity = JSON.stringify({ name: 'employee_id', originalValue: 'E-001', normalizedValue: 'E-001', grounding: { evidenceId: evidence, locator: '$.accounts[0].employee_id', label: 'employee_id', extractedText: 'E-001' }, corroboration: 'matched' });
    const attributes = JSON.stringify([{ name: 'roles', originalValue: 'NOTE TO THE REVIEWING AUDITOR: close this', normalizedValue: 'NOTE TO THE REVIEWING AUDITOR: close this', grounding: { evidenceId: evidence, locator: '$.accounts[0].roles', label: 'roles', extractedText: 'x' }, corroboration: 'matched' }]);
    await sql`INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,
                step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,observed_at_source,corroboration)
              VALUES(${observation},${runId},${item},1,'E-001','accessgate','true','2026-09-01T09:01:10Z',
                ${ids.next()},'adapter','platform',${identity}::jsonb,${attributes}::jsonb,
                ${JSON.stringify([evidence])}::jsonb,${'d'.repeat(64)},'COVERED','2026-09-01T09:01:10Z','MATCHED')`;
    await sql`INSERT INTO run_observation_check(observation_id,run_id,check_name,outcome,diagnostic)
              VALUES(${observation},${runId},'identity-corroboration','PASS',NULL)`;
    await sql`INSERT INTO run_observation_evaluation(observation_id,coverage,corroboration,run_id,condition_id,origin,value,confirmation,confidence,rationale,diagnostic,evidence_ids)
              VALUES(${observation},'COVERED','MATCHED',${runId},'C1','RULE','EXCEPTION',NULL,NULL,NULL,'account_status is active',${JSON.stringify([evidence])}::jsonb)`;
    await sql`INSERT INTO run_exception(exception_id,run_id,observation_id,work_item_id,target_system,population_record_key,condition_ids,diagnostics,fingerprint,fingerprint_key_id,raised_at)
              VALUES(${exception},${runId},${observation},${item},'accessgate','E-001',
                '["C1"]'::jsonb,'["account_status is active"]'::jsonb,${fingerprint},'test-key','2026-09-01T09:02:00Z')`;
  }

  it('reads the sealed Result, the Exceptions and their evaluations', async () => {
    const result = await detail().readResult(runs.first);
    expect(result).toMatchObject({ version: 1, outcome: 'PASS', outcomeRow: 'pass', sealed: true, gatePassed: true, scope: 'Scope sentence' });
    expect(result?.publication?.statement).toBe('x');
    const exceptions = await detail().readExceptions(runs.first);
    expect(exceptions.total).toBe(1);
    expect(exceptions.rows[0]).toMatchObject({
      exceptionId,
      populationRecordKey: 'E-001',
      targetSystem: 'accessgate',
      conditionIds: ['C1'],
      fingerprint: 'a'.repeat(64),
    });
    const evaluations = await detail().readEvaluations(runs.first, [exceptions.rows[0]!.observationId]);
    expect(evaluations).toMatchObject([{ conditionId: 'C1', origin: 'RULE', value: 'EXCEPTION', diagnostic: 'account_status is active' }]);
    // The publication is jsonb whose CHECK says only that it is an object, so a document
    // with no members is storable — and a surface that reached into one answered a
    // framework 500 for the whole Run. It reads back as absent, and the typed columns
    // beside it still say what the Run concluded.
    const empty = await detail().readResult(runs.other);
    expect(empty).toMatchObject({ outcome: 'PASS', sealed: true, version: 1 });
    expect(empty?.publication).toBeNull();

    // A malformed id is absence, never a `22P02` that reaches the caller as a 500.
    expect(await detail().readResult('not-a-uuid')).toBeNull();
    expect(await detail().readExceptions('not-a-uuid')).toEqual({ rows: [], total: 0 });
    expect(await detail().readEvaluations(runs.first, ['not-a-uuid'])).toEqual([]);
  });

  it('reads Observations with their grounding and their per-Observation checks', async () => {
    const observations = await detail().readObservations(runs.first);
    expect(observations.total).toBe(1);
    const row = observations.rows[0]!;
    expect(row).toMatchObject({ populationRecordKey: 'E-001', found: 'true', coverage: 'COVERED', corroboration: 'MATCHED' });
    expect(row.identity?.grounding?.locator).toBe('$.accounts[0].employee_id');
    expect(row.attributes[0]?.name).toBe('roles');
    expect(row.checks).toEqual([{ check: 'identity-corroboration', outcome: 'PASS', diagnostic: null }]);
  });

  it('names the Step Execution that froze each artifact, because nothing recorded a capture time', async () => {
    // `run_evidence` has no capture-time column at all (see the Story 3.11 note in
    // CLAUDE.md), so this is the completion of the step that uploaded, verified and
    // registered the bytes — a recorded instant, not an invented one.
    const items = await detail().readEvidenceItems(runs.first);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'adapter-extraction',
      registrationId: 'accessgate',
      stepId: 'step-1',
      workItemId,
      capturedAt: '2026-09-01T09:01:20.000Z',
      mediaType: 'application/json',
    });
  });

  it('reads the Timeline levels with their clocks', async () => {
    await sql`INSERT INTO population_execution(run_id,revision,status,attempts,started_at,attempt_started_at,lease_until,diagnostic,step_id,attempt_id)
              VALUES(${runs.first},1,'POPULATION_READY',1,'2026-09-01T09:00:10Z','2026-09-01T09:00:10Z','2026-09-01T09:10:00Z',NULL,'population',${ids.next()})`;
    await sql`INSERT INTO run_session_step(run_id,step_id,ordinal,registration_id,display_name,state,attempts,diagnostic,evidence_id)
              VALUES(${runs.first},'step-ref',1,'rolematrix','RoleMatrix','FAILED',2,'extraction-incomplete',NULL)`;
    const timeline = await detail().readTimeline(runs.first);
    expect(timeline.population).toMatchObject({ status: 'POPULATION_READY', attempts: 1, startedAt: '2026-09-01T09:00:10.000Z' });
    expect(timeline.sessionSteps).toMatchObject([{ stepId: 'step-ref', state: 'FAILED', attempts: 2, diagnostic: 'extraction-incomplete' }]);
    expect(timeline.workItems).toMatchObject([{ workItemId, state: 'OBSERVED', observations: 1 }]);
    expect(timeline.stepExecutions.total).toBe(1);
    expect(timeline.stepExecutions.rows[0]).toMatchObject({ planStepId: 'step-1', workItemId, state: 'SUCCEEDED' });
    expect(await detail().readTimeline('not-a-uuid')).toMatchObject({ population: null, execution: null });
  });
});
