import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptDeferredPause,
  acquireRunControlLease,
  answerEscalation,
  ESCALATION_OPTION_IDS,
  initiateRun,
  MARK_AMBIGUOUS_OPTION,
  pauseRun,
  performPause,
  raiseEscalation,
  wakeEscalation,
  type Clock,
} from '@intellifin/application';
import { classifyPlanTargets, sha256HexOfBytes, utf8Bytes, type AuditEventType } from '@intellifin/domain';
import {
  createAuditEventWriter,
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  ESCALATION_ANSWER_LIMIT,
  PAUSE_REQUEST_LIMIT,
  PostgresDeferredPauseRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunControlLeaseRepository,
  PostgresRunsUnitOfWork,
  readEscalationAnswers,
  readPauseRequests,
  SystemClock,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { auditRun } from '../../packages/infrastructure/src/db/schema.js';
import { ConversationContentCipher } from '../../packages/infrastructure/src/runs/conversation-content.js';
import { PostgresRunConversationRepository } from '../../packages/infrastructure/src/runs/run-conversation-repository.js';
import { PostgresWaitRepository, WAIT_QUEUE } from '../../packages/infrastructure/src/runs/wait-repository.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * Story 10.10 against PostgreSQL 18: the decisions a Run recorded, read the way the
 * Execution Timeline reads them.
 *
 * Every decision is produced by the REAL commands — `raiseEscalation`, `answerEscalation`,
 * `pauseRun`, `acceptDeferredPause` and the durable wake that ends a Run through
 * `completeRun` — and read back by `readEscalationAnswers` and `readPauseRequests`. The
 * capture chain an Escalation's supporting Evidence reaches is the one the agent path
 * writes: a Work Item, its Step Execution, a Tool Action and the capture binding.
 */
const url = process.env.DATABASE_URL;

class FixedClock implements Clock {
  constructor(private readonly value: Date) {}
  now(): Date { return new Date(this.value); }
}

describe.skipIf(!url)('the decisions on the Execution Timeline, on PostgreSQL', () => {
  let sql: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const author = ids.next();
  const procedureId = ids.next();
  const versionId = ids.next();
  const runIds: string[] = [];
  const session = { userId: author, sessionId: `${author}-decisions` };
  const version = activeRunVersion(procedureId, versionId, author);
  const target = classifyPlanTargets(version.compiledPlan!).agents[0]!;
  /** The fixture plan's own record step: "Inspect the record" on ProdConsole. */
  const INSPECT = target.stepId;
  const baseNow = new Date('2026-09-07T09:00:00.000Z');
  let minute = 0;
  const next = (): Date => new Date(baseNow.getTime() + (minute += 1) * 60_000);

  beforeAll(async () => {
    const targetUrl = new URL(url!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(targetUrl.hostname) ||
        !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(targetUrl.pathname.slice(1))) {
      throw new Error('Decision history tests require an isolated local or CI test database');
    }
    sql = createSqlClient(url!, { max: 6 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'Decision history test auditor',${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
    await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
      await context.procedures.insertProcedure(version);
      await context.procedures.insertVersion(version);
    });
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const runId of runIds) {
        // One transaction per Run, the Run locked first: a deferred marker's Work Item key
        // is checked at commit, and a Run's retained control and command facts leave with it.
        await sql.begin(async (tx) => {
          await tx`SELECT 1 FROM audit_run WHERE run_id=${runId} FOR UPDATE`;
          await tx`DELETE FROM pgboss.job WHERE name IN ('runs',${WAIT_QUEUE}) AND data->>'runId'=${runId}`;
          await tx`DELETE FROM notification WHERE run_id=${runId}`;
          await tx`DELETE FROM run_wait WHERE run_id=${runId}`;
          await tx`DELETE FROM run_result WHERE run_id=${runId}`;
          await tx`DELETE FROM run_gate_check WHERE run_id=${runId}`;
          await tx`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
          await tx`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
          await tx`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
          await tx`DELETE FROM run_tool_action WHERE run_id=${runId}`;
          await tx`DELETE FROM run_step_execution WHERE run_id=${runId}`;
          await tx`DELETE FROM run_agent_work WHERE run_id=${runId}`;
          await tx`DELETE FROM run_evidence WHERE run_id=${runId}`;
          await tx`DELETE FROM run_work_item WHERE run_id=${runId}`;
          await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
          await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
          await tx`DELETE FROM run_initiation_request WHERE run_id=${runId} OR refused_run_id=${runId}`;
          await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
        });
      }
      await sql`DELETE FROM run_initiation_request WHERE initiator_id=${author}`;
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM user_role WHERE user_id=${author}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  // A distinct period per Run: one Procedure holds one ACTIVE Standard Run per period.
  let period = 0;
  async function startRun(): Promise<string> {
    const month = String((period % 12) + 1).padStart(2, '0');
    const year = 2030 + Math.floor(period / 12);
    period += 1;
    const result = await initiateRun(
      { roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock: new SystemClock() },
      { session, request: { procedureId, period: { from: `${year}-${month}-01`, to: `${year}-${month}-28` }, requestToken: ids.next() } },
    );
    if (!result.ok) throw new Error(result.reason);
    runIds.push(result.runId);
    // A worker claim normally makes this transition; the revision trigger records it.
    await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${result.runId}`;
    return result.runId;
  }

  /**
   * One captured Structural Snapshot of one Work Item, the way the agent path writes it:
   * the Work Item at `stepId`, its Step Execution, a Tool Action that names NO Work Item of
   * its own (so the owner is found through the Step Execution first), and the capture
   * binding. Returns the Work Item and the captured Evidence.
   */
  async function captured(runId: string, subjectKey: string | null, stepId = INSPECT): Promise<{ workItemId: string; evidenceId: string }> {
    const workItemId = ids.next(), stepExecutionId = ids.next(), toolActionId = ids.next(), evidenceId = ids.next();
    const at = new Date().toISOString();
    const [ordinal] = await sql<{ n: number }[]>`SELECT count(*)::int + 1 AS n FROM run_work_item WHERE run_id=${runId}`;
    await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,subject_key,registration_id,display_name,state,attempts,cycles,observations)
      VALUES(${workItemId},${runId},${stepId},${ordinal!.n},${subjectKey},${target.target.registrationId},'ProdConsole','AWAITING',1,0,0)`;
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at)
      VALUES(${stepExecutionId},${runId},${stepId},${workItemId},'inspect-record','FAILED',1,${at})`;
    await sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,work_item_id,surface,target_system,
        action,method,destination,parameters,outcome,status,redirected,downloads,started_at,completed_at,capture)
      VALUES(${toolActionId},${runId},${stepExecutionId},NULL,'agent',${target.target.registrationId},'read-attribute','GET',
        'https://synthetic.invalid/prodconsole','[]'::jsonb,'performed',200,false,0,${at},${at},'PERMITTED')`;
    await evidence(runId, evidenceId);
    await sql`INSERT INTO run_evidence_capture(evidence_id,run_id,tool_action_id,source_location)
      VALUES(${evidenceId},${runId},${toolActionId},'https://synthetic.invalid/prodconsole')`;
    return { workItemId, evidenceId };
  }

  /** A registered Structural Snapshot, bound to nothing unless the caller binds it. */
  async function evidence(runId: string, evidenceId = ids.next()): Promise<string> {
    const bytes = utf8Bytes(JSON.stringify({ schemaVersion: 1, nodes: [] }));
    await sql`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required,
        captured_at,capture_method,capture_time_source,role)
      VALUES(${evidenceId},${runId},'structural-snapshot',${target.target.registrationId},${`decisions/${runId}/${evidenceId}`},
        'application/vnd.intellifin.web-tree+json',${sha256HexOfBytes(bytes)},${bytes.byteLength},'REGISTERED',false,
        now(),'agent','registration','evidence')`;
    return evidenceId;
  }

  /** Raise an Escalation through the real command, at the next fixture minute. */
  async function raise(runId: string, kind: 'choose-candidate' | 'unnamed-value' | 'retry-or-skip', raised: {
    readonly stepId?: string;
    readonly supportingEvidenceIds?: readonly string[];
    readonly at?: Date;
  } = {}): Promise<string> {
    const result = await raiseEscalation(
      { repository: new PostgresWaitRepository(db), ids, clock: new FixedClock(raised.at ?? next()) },
      {
        runId,
        kind,
        ...(kind === 'choose-candidate'
          ? { options: [
              { id: 'candidate-1', label: 'Ada Musonda' },
              { id: 'candidate-2', label: '<b>Ada Musonda</b> (second account)' },
              MARK_AMBIGUOUS_OPTION,
            ] }
          : {}),
        ...(raised.stepId === undefined ? {} : { stepId: raised.stepId }),
        ...(raised.supportingEvidenceIds === undefined ? {} : { supportingEvidenceIds: raised.supportingEvidenceIds }),
      },
    );
    if (!result.ok) throw new Error(`raise failed: ${result.reason}`);
    return result.wait.waitId;
  }

  /** Answer an open Escalation through the real command. */
  async function answer(runId: string, waitId: string, answerOptionId: string): Promise<void> {
    const [run] = await sql<{ revision: number }[]>`SELECT revision FROM audit_run WHERE run_id=${runId}`;
    const result = await answerEscalation(
      { repository: new PostgresWaitRepository(db), roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock: new FixedClock(next()) },
      { session, request: { runId, waitId, expectedRunRevision: Number(run!.revision), answerOptionId } },
    );
    if (!result.ok) throw new Error(`answer failed: ${result.code}`);
  }

  /**
   * End a Run the way no Tool Action boundary is involved in: an Escalation raised five
   * hours ago, so its four-hour deadline has passed, and the durable wake that times it
   * out and ends the Run Inconclusive through `completeRun`.
   */
  async function endByTimeout(runId: string): Promise<string> {
    const waitId = await raise(runId, 'retry-or-skip', { stepId: INSPECT, at: new Date(Date.now() - 5 * 60 * 60 * 1000) });
    const woken = await wakeEscalation({ repository: new PostgresWaitRepository(db), clock: new SystemClock() }, { schemaVersion: 1, runId, waitId });
    expect(woken).toMatchObject({ ok: true, status: 'timed-out' });
    return waitId;
  }

  async function closedAt(waitId: string): Promise<string> {
    const [row] = await sql<{ closed_at: string }[]>`
      SELECT to_char(closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS closed_at FROM run_wait WHERE wait_id=${waitId}`;
    return row!.closed_at;
  }

  /** Historical answer rows can lack a matching event; never rewrite an existing event. */
  async function historicalAnswer(runId: string): Promise<string> {
    const waitId = ids.next();
    const at = next();
    await sql`INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,deadline,closed_at,closure_kind,answer_option_id,actor)
      VALUES(${waitId},${runId},'retry-or-skip','[{"id":"abort","label":"Abort"}]'::jsonb,
        ${at.toISOString()}::timestamptz,${new Date(at.getTime() + 240 * 60_000).toISOString()}::timestamptz,
        ${at.toISOString()}::timestamptz,'answer','abort',${author})`;
    return waitId;
  }

  /** Insert a concurrent commit after the first real SELECT has obtained its snapshot. */
  function afterFirstSelect(commit: () => Promise<void>): Database {
    let first = true;
    const wrap = (builder: object): object => new Proxy(builder, {
      get(target, key) {
        if (key === 'then') return async (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          try {
            const result: unknown = await target;
            if (first) { first = false; await commit(); }
            return resolve(result);
          } catch (error) { return reject(error); }
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? (...args: unknown[]) => {
          const result: unknown = value.apply(target, args);
          return result !== null && typeof result === 'object' ? wrap(result) : result;
        } : value;
      },
    });
    return new Proxy(db, {
      get(target, key) {
        if (key === 'select') return (...args: Parameters<Database['select']>) => wrap(target.select(...args));
        return Reflect.get(target, key);
      },
    });
  }

  describe('every Escalation a person answered', () => {
    it('keeps the exact total and bounded answers on one snapshot when an answer commits during the read', async () => {
      const runId = await startRun();
      const first = await raise(runId, 'retry-or-skip');
      await answer(runId, first, ESCALATION_OPTION_IDS.retry);
      const second = await raise(runId, 'retry-or-skip');
      const history = await readEscalationAnswers(afterFirstSelect(() => answer(runId, second, ESCALATION_OPTION_IDS.retry)), runId);
      expect(history.total).toBe(1);
      expect(history.entries.map((entry) => entry.waitId)).toEqual([first]);
      expect((await readEscalationAnswers(db, runId)).total).toBe(2);
    });

    it('resolves uppercase Evidence UUIDs accepted by the raise command', async () => {
      const runId = await startRun();
      const capture = await captured(runId, 'E-000106');
      const waitId = await raise(runId, 'retry-or-skip', { stepId: INSPECT, supportingEvidenceIds: [capture.evidenceId.toUpperCase()] });
      await answer(runId, waitId, ESCALATION_OPTION_IDS.retry);
      expect((await readEscalationAnswers(db, runId)).entries).toMatchObject([
        { waitId, raise: { kind: 'recorded', workItem: { workItemId: capture.workItemId, subjectKey: 'E-000106' } } },
      ]);
    });

    it('requires every field of the raise writer independently before establishing the step', async () => {
      const runId = await startRun();
      const writers = [
        { actor: { type: 'agent', id: 'escalation-platform' }, source: 'platform', outcome: 'success' },
        { actor: { type: 'system', id: 'other-platform-writer' }, source: 'platform', outcome: 'success' },
        { actor: { type: 'system', id: 'escalation-platform' }, source: 'worker', outcome: 'success' },
        { actor: { type: 'system', id: 'escalation-platform' }, source: 'platform', outcome: 'failure' },
      ] as const;
      for (const writer of writers) {
        const waitId = await historicalAnswer(runId);
        await db.transaction((tx) => createAuditEventWriter(tx, new SystemClock(), ids).append({
          ...writer, eventType: 'execution.escalation-raised', aggregateId: runId,
          correlationId: ids.next(), sessionId: session.sessionId, payload: { waitId, stepId: INSPECT },
        }));
      }
      const history = await readEscalationAnswers(db, runId);
      expect(history.entries).toHaveLength(writers.length);
      expect(history.entries.map((entry) => entry.raise)).toEqual(writers.map(() => ({ kind: 'not-recorded' })));
    });

    it('requires one matching human answer event before attributing cancellation to an Abort', async () => {
      const runId = await startRun();
      const absent = await historicalAnswer(runId);
      const scenarios = [
        { actorType: 'system', actorId: author, answerOptionId: 'abort', state: 'CANCELED', copies: 1 },
        { actorType: 'human', actorId: ids.next(), answerOptionId: 'abort', state: 'CANCELED', copies: 1 },
        { actorType: 'human', actorId: author, answerOptionId: 'retry', state: 'CANCELED', copies: 1 },
        { actorType: 'human', actorId: author, answerOptionId: 'abort', state: 'RUNNING', copies: 1 },
        { actorType: 'human', actorId: author, answerOptionId: 'abort', state: 'CANCELED', copies: 2 },
      ] as const;
      for (const scenario of scenarios) {
        const waitId = await historicalAnswer(runId);
        for (let copy = 0; copy < scenario.copies; copy += 1) {
          await db.transaction((tx) => createAuditEventWriter(tx, new SystemClock(), ids).append({
            actor: { type: scenario.actorType, id: scenario.actorId }, source: 'web', outcome: 'success',
            eventType: 'execution.escalation-answered', aggregateId: runId, correlationId: ids.next(), sessionId: session.sessionId,
            payload: { waitId, answerOptionId: scenario.answerOptionId, state: scenario.state },
          }));
        }
      }
      const history = await readEscalationAnswers(db, runId);
      expect(history.entries).toHaveLength(scenarios.length + 1);
      expect(history.entries[0]?.waitId).toBe(absent);
      expect(history.entries.map((entry) => entry.canceledRun)).toEqual(Array(scenarios.length + 1).fill(false));
      expect(history.entries.every((entry) => entry.answer.kind === 'option' && entry.answer.optionId === 'abort')).toBe(true);
    });

    it('reads the answer, who gave it and when, and the Work Item the raise’s own Evidence reaches', async () => {
      const runId = await startRun();
      const inspected = await captured(runId, 'E-000102');
      const chose = await raise(runId, 'choose-candidate', { stepId: INSPECT, supportingEvidenceIds: [inspected.evidenceId] });
      await answer(runId, chose, 'candidate-2');

      // Evidence nothing captured: the step is recorded, the Work Item is not established.
      const loose = await evidence(runId);
      const unbound = await raise(runId, 'retry-or-skip', { stepId: INSPECT, supportingEvidenceIds: [loose] });
      await answer(runId, unbound, ESCALATION_OPTION_IDS.retry);

      // Evidence of two different Work Items: which one the question was about is not established.
      const second = await captured(runId, 'E-000103');
      const split = await raise(runId, 'retry-or-skip', { stepId: INSPECT, supportingEvidenceIds: [inspected.evidenceId, second.evidenceId] });
      await answer(runId, split, ESCALATION_OPTION_IDS.skip);

      // One id captured and one nothing captured: EVERY id the raise named must resolve, so
      // the captured one alone does not establish the Work Item.
      const mixed = await raise(runId, 'retry-or-skip', { stepId: INSPECT, supportingEvidenceIds: [inspected.evidenceId, loose] });
      await answer(runId, mixed, ESCALATION_OPTION_IDS.retry);

      // A Work Item at another plan step than the one the raise recorded: not the same step.
      const elsewhere = await captured(runId, 'E-000104', `${INSPECT}-other`);
      const mismatch = await raise(runId, 'unnamed-value', { stepId: INSPECT, supportingEvidenceIds: [elsewhere.evidenceId] });
      await answer(runId, mismatch, ESCALATION_OPTION_IDS.markUnevaluated);

      // A raise that recorded no step (a historical record): the decision, and no step.
      const historical = await raise(runId, 'choose-candidate', { supportingEvidenceIds: [inspected.evidenceId] });
      await answer(runId, historical, ESCALATION_OPTION_IDS.markAmbiguous);

      // A pause is a wait and never an Escalation answer; an OPEN Escalation is not answered.
      const open = await raise(runId, 'retry-or-skip', { stepId: INSPECT });

      const history = await readEscalationAnswers(db, runId);
      expect(history.total).toBe(6);
      expect(history.entries.map((entry) => entry.waitId)).toEqual([chose, unbound, split, mixed, mismatch, historical]);
      expect(history.entries.map((entry) => entry.waitId)).not.toContain(open);
      const [first, second_, third, mixedEntry, fourth, fifth] = history.entries;
      expect(first).toEqual({
        waitId: chose,
        kind: 'choose-candidate',
        answeredBy: author,
        answeredAt: await closedAt(chose),
        answer: { kind: 'candidate', candidate: 2, candidates: 2, label: '<b>Ada Musonda</b> (second account)' },
        canceledRun: false,
        raise: { kind: 'recorded', planStepId: INSPECT, workItem: { workItemId: inspected.workItemId, subjectKey: 'E-000102' } },
      });
      expect(second_).toMatchObject({ kind: 'retry-or-skip', answer: { kind: 'option', optionId: 'retry' },
        raise: { kind: 'recorded', planStepId: INSPECT, workItem: null } });
      expect(third).toMatchObject({ answer: { kind: 'option', optionId: 'skip' }, raise: { kind: 'recorded', planStepId: INSPECT, workItem: null } });
      expect(mixedEntry).toMatchObject({ answer: { kind: 'option', optionId: 'retry' }, raise: { kind: 'recorded', planStepId: INSPECT, workItem: null } });
      expect(fourth).toMatchObject({ kind: 'unnamed-value', answer: { kind: 'option', optionId: 'mark-unevaluated' },
        raise: { kind: 'recorded', planStepId: INSPECT, workItem: null } });
      expect(fifth).toMatchObject({ answer: { kind: 'option', optionId: 'mark-ambiguous' }, raise: { kind: 'not-recorded' } });
      expect(history.entries.every((entry) => entry.canceledRun === false)).toBe(true);

      // The exact total beside a bounded list, and no list at all past a refused bound.
      expect(await readEscalationAnswers(db, runId, 2)).toMatchObject({ total: 6, entries: [{ waitId: chose }, { waitId: unbound }] });
      expect(await readEscalationAnswers(db, runId, 0)).toEqual({ total: 6, entries: [] });
      expect((await readEscalationAnswers(db, runId, ESCALATION_ANSWER_LIMIT + 50)).entries).toHaveLength(6);
      expect(await readEscalationAnswers(db, 'not-a-run')).toEqual({ total: 0, entries: [] });
    });

    it('says an Abort canceled the Run from the answer’s own event, and reads nothing of another Run', async () => {
      const runId = await startRun();
      const otherRunId = await startRun();
      // Another Run's captured Evidence, named by this Run's raise: the chain is bound to
      // the Run, so it establishes nothing here.
      const foreign = await captured(otherRunId, 'E-000199');
      const other = await raise(otherRunId, 'retry-or-skip', { stepId: INSPECT, supportingEvidenceIds: [foreign.evidenceId] });
      await answer(otherRunId, other, ESCALATION_OPTION_IDS.retry);

      const aborted = await raise(runId, 'retry-or-skip', { stepId: INSPECT, supportingEvidenceIds: [foreign.evidenceId] });
      await answer(runId, aborted, ESCALATION_OPTION_IDS.abort);
      const [run] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
      expect(run).toMatchObject({ state: 'CANCELED' });

      const history = await readEscalationAnswers(db, runId);
      expect(history.total).toBe(1);
      expect(history.entries[0]).toMatchObject({
        waitId: aborted,
        answer: { kind: 'option', optionId: 'abort' },
        canceledRun: true,
        raise: { kind: 'recorded', planStepId: INSPECT, workItem: null },
      });
      // The other Run's answer is its own, and a Retry cancels nothing.
      expect((await readEscalationAnswers(db, otherRunId)).entries).toMatchObject([
        { waitId: other, canceledRun: false, raise: { workItem: { workItemId: foreign.workItemId, subjectKey: 'E-000199' } } },
      ]);
    });

    it('establishes nothing from a wait with more than one raise event, and never reads a timed-out wait as answered', async () => {
      const runId = await startRun();
      const inspected = await captured(runId, 'E-000105');
      const doubled = await raise(runId, 'retry-or-skip', { stepId: INSPECT, supportingEvidenceIds: [inspected.evidenceId] });
      // A second raise event naming the same wait: a record that does not establish the
      // raise exactly establishes none. Appended through the real chain writer.
      await db.transaction((tx) => createAuditEventWriter(tx, new SystemClock(), ids).append({
        actor: { type: 'system', id: 'escalation-platform' }, eventType: 'execution.escalation-raised', source: 'platform', outcome: 'success',
        aggregateId: runId, correlationId: ids.next(), sessionId: session.sessionId,
        payload: { waitId: doubled, kind: 'retry-or-skip', optionIds: ['retry', 'skip', 'abort'], stepId: INSPECT, supportingEvidenceIds: [inspected.evidenceId] },
      }));
      await answer(runId, doubled, ESCALATION_OPTION_IDS.retry);

      // A wait no raise command wrote (a raw row, answered), whose ONE raise-looking event
      // came from a writer that is not the platform: the step it names is not recorded.
      const unwritten = ids.next();
      await sql`INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,opened_by,deadline,closed_at,closure_kind,answer_option_id,actor)
        VALUES(${unwritten},${runId},'retry-or-skip',
          ${JSON.stringify([{ id: 'retry', label: 'Retry' }, { id: 'skip', label: 'Skip' }, { id: 'abort', label: 'Abort' }])}::text::jsonb,
          ${new Date(baseNow.getTime() + 50 * 60_000).toISOString()}::timestamptz,NULL,
          ${new Date(baseNow.getTime() + 290 * 60_000).toISOString()}::timestamptz,
          ${new Date(baseNow.getTime() + 51 * 60_000).toISOString()}::timestamptz,'answer','skip',${author})`;
      await db.transaction((tx) => createAuditEventWriter(tx, new SystemClock(), ids).append({
        actor: { type: 'human', id: author }, eventType: 'execution.escalation-raised', source: 'web', outcome: 'success',
        aggregateId: runId, correlationId: ids.next(), sessionId: session.sessionId,
        payload: { waitId: unwritten, kind: 'retry-or-skip', optionIds: ['retry', 'skip', 'abort'], stepId: INSPECT },
      }));
      const timedOut = await endByTimeout(runId);

      const history = await readEscalationAnswers(db, runId);
      expect(history.total).toBe(2);
      expect(history.entries.map((entry) => entry.waitId)).toEqual([doubled, unwritten]);
      expect(history.entries[0]).toMatchObject({ waitId: doubled, raise: { kind: 'not-recorded' } });
      expect(history.entries[1]).toMatchObject({ answer: { kind: 'option', optionId: 'skip' }, raise: { kind: 'not-recorded' } });
      expect(history.entries.map((entry) => entry.waitId)).not.toContain(timedOut);
    });
  });

  describe('every pause request the Run never honoured', () => {
    it('keeps the pause-request total and rows on one snapshot while another supersession commits', async () => {
      const runId = await startRun();
      const append = () => db.transaction((tx) => createAuditEventWriter(tx, new SystemClock(), ids).append({
        actor: { type: 'system', id: 'result-sealer' }, source: 'worker', outcome: 'failure',
        eventType: 'lifecycle.pause-superseded', aggregateId: runId, correlationId: ids.next(), sessionId: session.sessionId,
        payload: { requestedBy: author, requestedAt: new Date().toISOString() },
      }));
      const first = await append();
      const history = await readPauseRequests(afterFirstSelect(async () => { await append(); }), runId);
      expect(history.total).toBe(1);
      expect(history.entries.map((entry) => entry.eventId)).toEqual([first.eventId]);
      expect((await readPauseRequests(db, runId)).total).toBe(2);
    });

    it('reads a request to pause at once that the Run outran, with who asked and when', async () => {
      const runId = await startRun();
      const paused = await pauseRun(
        { roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db),
          repository: new PostgresWaitRepository(db), ids, clock: new SystemClock() },
        { session, request: { runId } },
      );
      expect(paused).toMatchObject({ ok: true });
      const [marker] = await sql<{ requested_at: string }[]>`
        SELECT to_char(pause_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS requested_at FROM audit_run WHERE run_id=${runId}`;
      // No Tool Action boundary ever honours it: the Run ends through the Escalation timeout.
      await endByTimeout(runId);
      const [superseded] = await sql<{ event_id: string; occurred_at: string }[]>`
        SELECT event_id::text, to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at
        FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.pause-superseded'`;
      expect(superseded).toBeDefined();

      const requests = await readPauseRequests(db, runId);
      expect(requests).toEqual({
        total: 1,
        entries: [{
          eventId: superseded!.event_id,
          mode: 'immediate',
          requestedBy: author,
          requestedAt: marker!.requested_at,
          supersededAt: superseded!.occurred_at,
          outcome: 'run-ended',
          inspection: null,
        }],
      });
      // The Escalation the Run ended on timed out; nobody answered it.
      expect(await readEscalationAnswers(db, runId)).toEqual({ total: 0, entries: [] });
      expect(await readPauseRequests(db, 'not-a-run')).toEqual({ total: 0, entries: [] });
      expect((await readPauseRequests(db, runId, 0)).entries).toEqual([]);
      expect((await readPauseRequests(db, runId, PAUSE_REQUEST_LIMIT + 1)).entries).toHaveLength(1);
    });

    it('reads nothing for a pause the Run really honoured, and nothing written by any other writer', async () => {
      const runId = await startRun();
      const repository = new PostgresWaitRepository(db);
      expect(await pauseRun(
        { roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db),
          repository, ids, clock: new SystemClock() },
        { session, request: { runId } },
      )).toMatchObject({ ok: true });
      // The worker's next boundary HONOURS it — the same `performPause` every stage calls —
      // an hour ago, so its thirty-minute wait has run out. Honouring clears the marker.
      const pauseWaitId = await repository.transaction(runId, async (context) => {
        const run = context.run!;
        await context.saveRunState('PAUSED');
        const wait = await performPause(context as never, {
          run,
          request: run.pauseRequest!,
          waitId: ids.next(),
          at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          hold: { planStepId: 'session-3', workItemId: null, superseded: null },
        });
        return wait.waitId;
      });
      // The Run then ends while PAUSED: a request that took effect is not a superseded one.
      expect(await wakeEscalation({ repository, clock: new SystemClock() }, { schemaVersion: 1, runId, waitId: pauseWaitId }))
        .toMatchObject({ ok: true, status: 'timed-out' });
      const [ended] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
      expect(ended).toMatchObject({ state: 'INCONCLUSIVE' });

      // Superseded-looking events, each from a writer that differs from the true one in
      // exactly ONE field, so every field of the writer filter is what refuses one of them.
      const forge = (eventType: AuditEventType, actor: { readonly type: 'human' | 'agent' | 'adapter' | 'system'; readonly id: string },
        source: 'web' | 'worker' | 'adapter' | 'platform', outcome: 'success' | 'failure' | 'denied') =>
        db.transaction((tx) => createAuditEventWriter(tx, new SystemClock(), ids).append({
          actor, eventType, source, outcome, aggregateId: runId, correlationId: ids.next(), sessionId: session.sessionId,
          payload: eventType === 'lifecycle.pause-superseded'
            ? { requestedBy: author, requestedAt: new Date().toISOString(), state: 'INCONCLUSIVE', outcome: 'INCONCLUSIVE', occurredAt: new Date().toISOString() }
            : { commandId: ids.next(), requestedBy: author, workItemId: ids.next(), subjectKey: null, registrationId: target.target.registrationId, reason: 'run-finalized' },
        }));
      const sealer = { type: 'system', id: 'result-sealer' } as const;
      const coordinator = { type: 'system', id: 'deferred-pause-coordinator' } as const;
      await forge('lifecycle.pause-superseded', { type: 'system', id: 'deferred-pause-coordinator' }, 'worker', 'failure');
      await forge('lifecycle.pause-superseded', { type: 'agent', id: 'result-sealer' }, 'worker', 'failure');
      await forge('lifecycle.pause-superseded', sealer, 'web', 'failure');
      await forge('lifecycle.pause-superseded', sealer, 'worker', 'success');
      await forge('lifecycle.deferred-pause-superseded', { type: 'system', id: 'result-sealer' }, 'worker', 'failure');
      await forge('lifecycle.deferred-pause-superseded', { type: 'agent', id: 'deferred-pause-coordinator' }, 'worker', 'failure');
      await forge('lifecycle.deferred-pause-superseded', coordinator, 'platform', 'failure');
      await forge('lifecycle.deferred-pause-superseded', coordinator, 'worker', 'success');
      await forge('lifecycle.pause-superseded', { type: 'human', id: author }, 'web', 'failure');

      const events = await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${runId} ORDER BY sequence`;
      expect(events.map((row) => String(row.event_type))).toEqual(expect.arrayContaining(['lifecycle.run-paused', 'execution.pause-timeout']));
      expect(await readPauseRequests(db, runId)).toEqual({ total: 0, entries: [] });
    });

    it('reads a "pause after this inspection" request: the inspection it named, when it was asked, and what retired it', async () => {
      const replaced = await deferredFixture();
      const [marker] = await sql<{ requested_at: string }[]>`
        SELECT to_char(requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS requested_at FROM run_deferred_pause WHERE command_id=${replaced.commandId}`;
      // A request to pause at once retires the latch without the Run ending.
      expect(await pauseRun(
        { roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), repository: new PostgresWaitRepository(db), ids, clock: new SystemClock() },
        { session, request: { runId: replaced.runId } },
      )).toMatchObject({ ok: true, pending: true });
      let requests = await readPauseRequests(db, replaced.runId);
      expect(requests.total).toBe(1);
      expect(requests.entries[0]).toMatchObject({
        mode: 'after-inspection',
        requestedBy: author,
        requestedAt: marker!.requested_at,
        outcome: 'replaced',
        inspection: { planStepId: INSPECT, workItem: { workItemId: replaced.workItemId, subjectKey: null } },
      });
      // Then the Run ends with the immediate request still outstanding: a second entry,
      // in the order the chain recorded them.
      await endByTimeout(replaced.runId);
      requests = await readPauseRequests(db, replaced.runId);
      expect(requests.total).toBe(2);
      expect(requests.entries.map((entry) => [entry.mode, entry.outcome])).toEqual([['after-inspection', 'replaced'], ['immediate', 'run-ended']]);

      // A latch the Run finalized past says the Run ended first.
      const finalized = await deferredFixture();
      await endByTimeout(finalized.runId);
      expect((await readPauseRequests(db, finalized.runId)).entries).toMatchObject([
        { mode: 'after-inspection', outcome: 'run-ended', inspection: { planStepId: INSPECT, workItem: { workItemId: finalized.workItemId } } },
      ]);
      const [settled] = await sql`SELECT state, superseded_reason FROM run_deferred_pause WHERE command_id=${finalized.commandId}`;
      expect(settled).toMatchObject({ state: 'SUPERSEDED', superseded_reason: 'run-finalized' });
    });
  });

  /**
   * A Run held at a page inspection whose auditor asked, through the conversation, to pause
   * after it, and whose latch the real command accepted — the `deferred-pause.test.ts`
   * fixture, on this file's own Procedure.
   */
  let deferredYear = 2090;
  async function deferredFixture(): Promise<{ runId: string; commandId: string; workItemId: string }> {
    const runId = ids.next(), itemId = ids.next();
    runIds.push(runId);
    const year = (deferredYear += 1);
    await db.insert(auditRun).values({ runId, requestToken: ids.next(), correlationId: ids.next(), procedureId, versionId,
      versionNumber: 1, procedureName: 'Decision history deferred fixture', periodFrom: `${year}-01-01`, periodTo: `${year}-01-31`,
      state: 'RUNNING', kind: 'STANDARD', initiatorId: author, sessionId: session.sessionId, authorizationRole: 'auditor', initiatedAt: new Date() });
    await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,subject_key,registration_id,display_name,state,attempts,cycles,observations)
      VALUES(${itemId},${runId},${INSPECT},1,NULL,${target.target.registrationId},'Configuration page','IN_PROGRESS',1,0,0)`;
    await sql`INSERT INTO run_agent_work(run_id,revision,status,run_started_at,lease_until,attempt_id,work_item_id,next_turn,tokens,reserved_tokens)
      VALUES(${runId},1,'EXECUTING',clock_timestamp(),clock_timestamp()+interval '1 minute',${ids.next()},${itemId},1,0,0)`;
    const lease = await acquireRunControlLease({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db),
      repository: new PostgresRunControlLeaseRepository(db), ids, allowEnrollment: true },
      { session, request: { runId, expectedEpoch: 0 } });
    expect(lease).toMatchObject({ ok: true, lease: { epoch: 1 } });
    const clock = new SystemClock();
    const conversation = new PostgresRunConversationRepository(db, new ConversationContentCipher('35'.repeat(32)), () => clock.now());
    const inspection = await conversation.readCurrentInspection({ runId, actorId: author });
    if (inspection.status !== 'ready') throw new Error(`Inspection fixture unavailable: ${inspection.reason}`);
    const proposal = await conversation.append({ actorId: author, sessionId: session.sessionId, request: {
      runId, idempotencyKey: ids.next(), text: 'pause after this inspection', selectedSourceOrdinal: null,
      replyToWaitId: null, currentInspection: inspection.anchor,
    } });
    if (!proposal.ok) throw new Error(proposal.reason);
    const [command] = await sql<{ command_id: string }[]>`SELECT command_id::text FROM run_interaction_command WHERE message_id=${proposal.messageId}`;
    if (!command) throw new Error('Deferred proposal missing');
    expect(await acceptDeferredPause(
      { roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), repository: new PostgresDeferredPauseRepository(db),
        ids, clock, commandId: command.command_id },
      { session, request: { runId, anchor: inspection.anchor, expectedControlEpoch: 1 } },
    )).toMatchObject({ ok: true });
    return { runId, commandId: command.command_id, workItemId: itemId };
  }
});
