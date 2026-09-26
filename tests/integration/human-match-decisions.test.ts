import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  answerEscalation,
  ESCALATION_OPTION_IDS,
  initiateRun,
  NO_CORROBORATION,
  NO_EVALUATION,
  ObservationRegistrationError,
  raiseEscalation,
  registerObservations,
  type Clock,
  type ObservationBatchItem,
} from '@intellifin/application';
import {
  observationDigest,
  observationIdFor,
  RESULT_SAMPLE_LIMIT,
  sha256HexOfBytes,
  TARGET_DRAFT_LIMITS,
  utf8Bytes,
  type ObservationRecord,
} from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  HUMAN_MATCH_LIST_LIMIT,
  MATCH_DECISION_SELECTOR_LIMIT,
  PostgresProceduresUnitOfWork,
  PostgresRunsUnitOfWork,
  readHumanMatches,
  readRunHumanMatches,
  RUN_DETAIL_PAGE_SIZE,
  SystemClock,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { withRunExecutionContext } from '../../packages/infrastructure/src/runs/adapter-execution-repository.js';
import { PostgresWaitRepository, WAIT_QUEUE } from '../../packages/infrastructure/src/runs/wait-repository.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * Story 10.6 (legacy 4.7) against PostgreSQL 18: a human-selected match is registered WITH
 * the answered choose-candidate wait that matched it, and every surface's read follows
 * exactly that link.
 *
 * The link is produced by the REAL commands — `raiseEscalation`, `answerEscalation` and
 * `registerObservations` over the Run's own transaction — and read back by the read the
 * surfaces use. The historical row (a human-matched Observation an earlier build wrote with
 * no link) is inserted raw, because the current command refuses to write one; that is the
 * point of the guard.
 */
const url = process.env.DATABASE_URL;

class FixedClock implements Clock {
  constructor(private readonly value: Date) {}
  now(): Date { return new Date(this.value); }
}

describe.skipIf(!url)('the decision behind a human-selected match on PostgreSQL', () => {
  let sql: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const author = ids.next();
  const procedureId = ids.next();
  const versionId = ids.next();
  const runIds: string[] = [];
  const session = { userId: author, sessionId: `${author}-human-match` };
  const baseNow = new Date('2026-09-07T09:00:00.000Z');

  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
        !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))) {
      throw new Error('Human-match tests require an isolated local or CI test database');
    }
    sql = createSqlClient(url!, { max: 6 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'Human match test auditor',${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
    const version = activeRunVersion(procedureId, versionId, author);
    await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
      await context.procedures.insertProcedure(version);
      await context.procedures.insertVersion(version);
    });
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const runId of runIds) {
        await sql`DELETE FROM pgboss.job WHERE name IN ('runs',${WAIT_QUEUE}) AND data->>'runId'=${runId}`;
        await sql`DELETE FROM notification WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM run_wait WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM run_initiation_request WHERE run_id=${runId} OR refused_run_id=${runId}`;
      }
      await sql`DELETE FROM run_initiation_request WHERE initiator_id=${author}`;
      await sql`DELETE FROM audit_run WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM user_role WHERE user_id=${author}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  async function startRun(from: string, to: string): Promise<string> {
    const result = await initiateRun(
      { roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock: new SystemClock() },
      { session, request: { procedureId, period: { from, to }, requestToken: ids.next() } },
    );
    if (!result.ok) throw new Error(result.reason);
    runIds.push(result.runId);
    await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${result.runId}`;
    return result.runId;
  }

  /** Raise a wait of `kind` through the real command, then answer it through the real command. */
  async function answered(runId: string, kind: 'choose-candidate' | 'retry-or-skip', answer: string): Promise<string> {
    const raised = await raiseEscalation(
      { repository: new PostgresWaitRepository(db), ids, clock: new FixedClock(baseNow) },
      {
        runId,
        kind,
        ...(kind === 'choose-candidate'
          ? { options: [
              { id: 'candidate-1', label: 'Ada Musonda' },
              { id: 'candidate-2', label: 'Ada Musonda (second account)' },
              { id: ESCALATION_OPTION_IDS.markAmbiguous, label: 'Mark the record ambiguous' },
            ] }
          : {}),
      },
    );
    if (!raised.ok) throw new Error(`raise failed: ${raised.reason}`);
    const [run] = await sql<{ revision: number }[]>`SELECT revision FROM audit_run WHERE run_id=${runId}`;
    const result = await answerEscalation(
      {
        repository: new PostgresWaitRepository(db),
        roles: new DrizzleRoleRepository(db),
        unitOfWork: new PostgresRunsUnitOfWork(db),
        ids,
        clock: new FixedClock(new Date(baseNow.getTime() + 60_000)),
      },
      { session, request: { runId, waitId: raised.wait.waitId, expectedRunRevision: Number(run!.revision), answerOptionId: answer } },
    );
    if (!result.ok) throw new Error(`answer failed: ${result.code}`);
    return raised.wait.waitId;
  }

  interface Registered { readonly observationId: string; readonly record: ObservationRecord }

  /** One found Observation, registered through the real command in the Run's own transaction. */
  async function register(
    runId: string,
    key: string,
    matchOrigin: ObservationRecord['matchOrigin'],
    matchDecision: ObservationBatchItem['matchDecision'],
  ): Promise<Registered> {
    const workItemId = ids.next();
    const stepExecutionId = ids.next();
    const evidenceId = ids.next();
    const at = new Date().toISOString();
    const bytes = utf8Bytes(JSON.stringify({ schemaVersion: 1, nodes: [{ label: 'Employee ID', value: key }] }));
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required,role)
      VALUES(${evidenceId},${runId},'structural-snapshot','loancore',${`human-match/${runId}/${evidenceId}`},
        'application/vnd.intellifin.web-tree+json',${sha256HexOfBytes(bytes)},${bytes.byteLength},'REGISTERED',false,'evidence')`;
    const record: ObservationRecord = {
      schemaVersion: 1,
      observationId: observationIdFor(workItemId, key),
      workItemId,
      populationRecordKey: key,
      targetSystem: 'loancore',
      found: 'true',
      observedAt: at,
      stepExecutionId,
      captureMethod: 'agent',
      matchOrigin,
      identity: {
        name: 'employee_id', originalValue: key, normalizedValue: key, corroboration: null,
        grounding: { evidenceId, locator: '$.nodes[0].value', label: 'Employee ID', extractedText: key },
      },
      attributes: [],
      evidenceIds: [evidenceId],
    };
    await db.transaction((tx) => withRunExecutionContext(tx, runId, async (context) => {
      // P-1 has one Work Item per population key, as the agent path writes it.
      await context.saveWorkItem({ workItemId, subjectKey: key, stepId: 'inspect', ordinal: 1, registrationId: 'loancore', displayName: 'LoanCore',
        state: 'OBSERVED', attempts: 1, cycles: 0, diagnostic: null, evidenceId, observations: 1 });
      await context.saveStepExecution({ stepExecutionId, planStepId: 'inspect', workItemId, action: 'inspect-record',
        state: 'SUCCEEDED', attempt: 1, startedAt: at, completedAt: at, diagnostic: null });
      await registerObservations(context, {
        run: context.run!, workItemId, stepExecutionId, targetSystem: 'loancore', templateId: 'P-1', runStartedAt: at, registeredAt: at,
        // An agent capture batch names its frozen requirements; none are needed to prove
        // the link, and the checks they would drive are recorded, never refused.
        evidenceRequirements: [],
        items: [{ record, observedAtSource: at, absence: null, expectedQueryKeys: [{ key: 'employee_id', value: key }],
          ...(matchDecision === undefined ? {} : { matchDecision }) }],
      }, {
        corroboration: NO_CORROBORATION,
        evaluation: NO_EVALUATION,
        exceptions: { keyId: 'unused-human-match-test', fingerprint: () => { throw new Error('No evaluation raises an Exception here'); } },
      });
    }));
    return { observationId: record.observationId, record };
  }

  it('links a new human-selected match to the answered question, and every other shape says it is not linked', async () => {
    const runId = await startRun('2026-08-01', '2026-08-31');
    const otherRunId = await startRun('2026-07-01', '2026-07-31');
    const chosen = await answered(runId, 'choose-candidate', 'candidate-2');
    const [closed] = await sql<{ closed_at: string }[]>`
      SELECT to_char(closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS closed_at FROM run_wait WHERE wait_id=${chosen}`;

    const linked = await register(runId, 'E-1', 'human-matched', { waitId: chosen });
    const platform = await register(runId, 'E-2', 'platform', null);
    // A link that names a wait which is not an answered CANDIDATE choice establishes nothing.
    const retried = await answered(runId, 'retry-or-skip', ESCALATION_OPTION_IDS.retry);
    const wrongKind = await register(runId, 'E-3', 'human-matched', { waitId: retried });
    // A link naming a wait nobody raised, and one naming ANOTHER Run's answered question.
    const unknown = await register(runId, 'E-5', 'human-matched', { waitId: ids.next() });
    const elsewhere = await answered(otherRunId, 'choose-candidate', 'candidate-1');
    const crossRun = await register(runId, 'E-6', 'human-matched', { waitId: elsewhere });

    // An Observation an earlier build registered: human-matched, with no link at all. The
    // command now refuses that shape, so it is written the way the older build wrote it.
    const historical = await register(runId, 'E-4', 'platform', null);
    const legacy: ObservationRecord = { ...historical.record, observationId: ids.next(), populationRecordKey: 'E-4h', matchOrigin: 'human-matched' };
    await sql`INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,
        found,observed_at,step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,
        observed_at_source,corroboration)
      SELECT ${legacy.observationId},run_id,work_item_id,schema_version,'E-4h',target_system,found,observed_at,step_execution_id,
        capture_method,'human-matched',identity,attributes,evidence_ids,${observationDigest(legacy)},coverage,observed_at_source,corroboration
      FROM run_observation WHERE observation_id=${historical.observationId}`;

    // The registration event carries the link for the ONE human match it registered, and
    // nothing in events whose batch held none.
    const events = await sql<{ payload: { humanMatchDecisions?: unknown } }[]>`
      SELECT payload FROM audit_events WHERE aggregate_id=${runId} AND event_type='execution.observations-registered' ORDER BY sequence`;
    const links = events.flatMap((event) => (event.payload.humanMatchDecisions as { observationId: string; waitId: string }[] | undefined) ?? []);
    expect(links).toEqual([
      { observationId: linked.observationId, waitId: chosen },
      { observationId: wrongKind.observationId, waitId: retried },
      { observationId: unknown.observationId, waitId: expect.any(String) },
      { observationId: crossRun.observationId, waitId: elsewhere },
    ]);
    expect(events.filter((event) => event.payload.humanMatchDecisions === undefined)).toHaveLength(2);

    const all = [linked, platform, wrongKind, unknown, crossRun, historical].map((row) => row.observationId).concat(legacy.observationId);
    const matches = await readHumanMatches(db, runId, { observationIds: all });
    const byKey = new Map(matches.map((match) => [match.populationRecordKey, match.decision]));
    expect(byKey.get('E-1')).toEqual({
      state: 'linked', waitId: chosen, candidate: 2, candidates: 2, candidateLabel: 'Ada Musonda (second account)',
      decidedBy: author, decidedAt: closed!.closed_at,
    });
    for (const key of ['E-3', 'E-5', 'E-6', 'E-4h']) expect(byKey.get(key), key).toEqual({ state: 'not-linked' });
    // A platform match is ABSENT: it has no decision and no flag.
    expect(byKey.has('E-2')).toBe(false);
    expect(byKey.has('E-4')).toBe(false);
    expect(matches).toHaveLength(5);

    // The Result names records by system and key; the same decisions come back that way.
    expect((await readHumanMatches(db, runId, { records: [
      { targetSystem: 'loancore', populationRecordKey: 'E-1' },
      { targetSystem: 'loancore', populationRecordKey: 'E-2' },
      { targetSystem: 'accessgate', populationRecordKey: 'E-3' },
    ] })).map((match) => match.observationId)).toEqual([linked.observationId]);

    // The Result's own list: the exact total, a bounded list in record order.
    const listed = await readRunHumanMatches(db, runId);
    expect(listed.total).toBe(5);
    expect(listed.rows.map((row) => row.populationRecordKey)).toEqual(['E-1', 'E-3', 'E-4h', 'E-5', 'E-6']);
    const bounded = await readRunHumanMatches(db, runId, 2);
    expect(bounded).toMatchObject({ total: 5 });
    expect(bounded.rows.map((row) => row.populationRecordKey)).toEqual(['E-1', 'E-3']);
    // The other Run's own answered question matched nothing there.
    expect(await readRunHumanMatches(db, otherRunId)).toEqual({ total: 0, rows: [] });
  });

  it('establishes no decision from a link to another kind of question, or from two links', async () => {
    const runId = await startRun('2026-05-01', '2026-05-31');
    // A question of another kind, answered with an option that is not one of the platform's
    // own: no command can write it (the other kinds' options are fixed), so it is written
    // raw. Only its KIND says it was not a candidate choice.
    const otherKind = ids.next();
    await sql`INSERT INTO run_wait(wait_id,run_id,kind,options,deadline,opened_at,closed_at,closure_kind,answer_option_id,actor)
      VALUES(${otherKind},${runId},'unnamed-value',${JSON.stringify([{ id: 'value-a', label: 'Value A' }])}::text::jsonb,
        ${new Date(baseNow.getTime() + 4 * 60 * 60 * 1000).toISOString()}::timestamptz,${baseNow.toISOString()}::timestamptz,
        ${new Date(baseNow.getTime() + 60_000).toISOString()}::timestamptz,'answer','value-a',${author})`;
    const byOtherKind = await register(runId, 'E-7', 'human-matched', { waitId: otherKind });

    // One record whose registration named one answered choice, and a second link — written
    // by the real appender, as a forged or duplicated registration event would be — naming a
    // DIFFERENT answered choice for the same record. Two links establish no single decision.
    const first = await answered(runId, 'choose-candidate', 'candidate-1');
    const twice = await register(runId, 'E-8', 'human-matched', { waitId: first });
    const second = await answered(runId, 'choose-candidate', 'candidate-2');
    await new PostgresRunsUnitOfWork(db).execute(async (context) => {
      const [run] = await sql<{ correlation_id: string; session_id: string }[]>`
        SELECT correlation_id, session_id FROM audit_run WHERE run_id=${runId}`;
      await context.auditEvents.append({
        actor: { type: 'system', id: 'observation-registrar' },
        eventType: 'execution.observations-registered',
        source: 'worker',
        outcome: 'success',
        aggregateId: runId,
        correlationId: run!.correlation_id,
        sessionId: run!.session_id,
        payload: { registered: 0, humanMatchDecisions: [{ observationId: twice.observationId, waitId: second }] },
      });
    });

    const matches = await readHumanMatches(db, runId, { observationIds: [byOtherKind.observationId, twice.observationId] });
    const byKey = new Map(matches.map((match) => [match.populationRecordKey, match.decision]));
    expect(byKey.get('E-7')).toEqual({ state: 'not-linked' });
    expect(byKey.get('E-8')).toEqual({ state: 'not-linked' });
  });

  it('refuses a human-selected match registered without its decision, and writes nothing', async () => {
    const runId = await startRun('2026-06-01', '2026-06-30');
    const before = await sql`SELECT count(*)::int AS n FROM run_observation WHERE run_id=${runId}`;
    await expect(register(runId, 'E-9', 'human-matched', null)).rejects.toSatisfy((error: unknown) =>
      error instanceof ObservationRegistrationError && error.refusal === 'match-decision');
    await expect(register(runId, 'E-9', 'platform', { waitId: ids.next() })).rejects.toSatisfy((error: unknown) =>
      error instanceof ObservationRegistrationError && error.refusal === 'match-decision');
    expect(await sql`SELECT count(*)::int AS n FROM run_observation WHERE run_id=${runId}`).toEqual(before);
    expect(await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${runId} AND event_type='execution.observations-registered'`).toHaveLength(0);
  });

  it('bounds the selection by what a surface renders, refusing more rather than cutting it', async () => {
    // The largest selection any surface makes: a record review page of 50 rows, each with
    // one Observation per selected Target System; an Exceptions page; the Result's samples.
    expect(MATCH_DECISION_SELECTOR_LIMIT).toBeGreaterThanOrEqual(50 * TARGET_DRAFT_LIMITS.targets);
    expect(MATCH_DECISION_SELECTOR_LIMIT).toBeGreaterThanOrEqual(RUN_DETAIL_PAGE_SIZE);
    expect(MATCH_DECISION_SELECTOR_LIMIT).toBeGreaterThanOrEqual(2 * RESULT_SAMPLE_LIMIT);
    expect(HUMAN_MATCH_LIST_LIMIT).toBeGreaterThan(0);
    const tooMany = Array.from({ length: MATCH_DECISION_SELECTOR_LIMIT + 1 }, () => ids.next());
    await expect(readHumanMatches(db, ids.next(), { observationIds: tooMany })).rejects.toBeInstanceOf(RangeError);
    expect(await readHumanMatches(db, 'not-a-run', { observationIds: [ids.next()] })).toEqual([]);
  });
});
