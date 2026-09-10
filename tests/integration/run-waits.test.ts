import { queueDatabase } from '../../packages/infrastructure/src/procedures/derivation-queue.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AWAITING_AUDITOR_TIMEOUT_MS,
  ANSWER_ESCALATION_REFUSALS,
  ESCALATION_OPTION_IDS,
  answerEscalation,
  initiateRun,
  raiseEscalation,
  wakeEscalation,
  type Clock,
  type WaitContext,
} from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  createProceduresQueue,
  DrizzleNotificationRepository,
  DrizzleRoleRepository,
  InAppNotificationSender,
  PostgresProceduresUnitOfWork,
  PostgresRunsUnitOfWork,
  SystemClock,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';
import { PostgresWaitRepository, WAIT_QUEUE } from '../../packages/infrastructure/src/runs/wait-repository.js';

/**
 * Story 4.7/4.8's database boundary against PostgreSQL.
 *
 * The application tests exercise the closed option sets and command refusal matrix with
 * an in-memory context. These cases exercise the durable facts those tests cannot see:
 * the Run lock, the partial-open wait invariant, the one delayed pg-boss job, revision
 * compare-and-set, and terminal timeout sealing.
 */
const url = process.env.DATABASE_URL;

class FixedClock implements Clock {
  constructor(private readonly value: Date) {}
  now(): Date { return new Date(this.value); }
}

describe.skipIf(!url)('durable Escalation waits', () => {
  let sql: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const author = ids.next();
  const manager = ids.next();
  const procedureId = ids.next();
  const versionId = ids.next();
  const runIds: string[] = [];
  const session = { userId: author, sessionId: `${author}-wait-session` };
  const baseNow = new Date('2026-09-07T09:00:00.000Z');

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))
    ) {
      throw new Error('Escalation wait tests require an isolated local or CI test database');
    }
    sql = createSqlClient(url!, { max: 8 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'Wait test',${author + '@test.invalid'})`;
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${manager},'Wait manager',${manager + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${manager},'audit-manager')`;
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
        // A timeout may have written the terminal rows through CompleteRun. Every child
        // is removed before the Run so this teardown remains valid as the shared context
        // grows additional evidence tables in later stories.
        await sql`DELETE FROM run_wait WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result WHERE run_id=${runId}`;
        await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_exception WHERE run_id=${runId}`;
        await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
        await sql`DELETE FROM run_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM population_row WHERE run_id=${runId}`;
        await sql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
        await sql`DELETE FROM population_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM population_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM run_initiation_request WHERE run_id=${runId} OR refused_run_id=${runId}`;
      }
      await sql`DELETE FROM audit_run WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
      await sql`DELETE FROM auth_user WHERE id=${manager}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  async function startRun(periodFrom: string, periodTo: string): Promise<string> {
    const result = await initiateRun(
      {
        roles: new DrizzleRoleRepository(db),
        unitOfWork: new PostgresRunsUnitOfWork(db),
        ids,
        clock: new SystemClock(),
      },
      {
        session,
        request: {
          procedureId,
          period: { from: periodFrom, to: periodTo },
          requestToken: ids.next(),
        },
      },
    );
    if (!result.ok) throw new Error(result.reason);
    runIds.push(result.runId);
    // A worker claim normally makes this transition. The revision trigger records that
    // state change, so the wait tests begin at revision 1 at this boundary.
    await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${result.runId}`;
    return result.runId;
  }

  function waitRepository(): PostgresWaitRepository {
    return new PostgresWaitRepository(db);
  }

  async function raise(runId: string, kind: 'choose-candidate' | 'unnamed-value' | 'retry-or-skip', now = baseNow) {
    return raiseEscalation(
      { repository: waitRepository(), ids, clock: new FixedClock(now) },
      {
        runId,
        kind,
        ...(kind === 'choose-candidate'
          ? {
              options: [
                { id: 'candidate-1', label: 'Ada Musonda' },
                { id: 'candidate-2', label: 'Ada Musonda (duplicate)' },
                { id: ESCALATION_OPTION_IDS.markAmbiguous, label: 'Mark the record ambiguous' },
              ],
            }
          : {}),
      },
    );
  }

  it('commits the Awaiting Auditor state, one open wait and one delayed wake', async () => {
    const runId = await startRun('2026-08-01', '2026-08-31');
    const result = await raise(runId, 'choose-candidate');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [run] = await sql`SELECT state,revision FROM audit_run WHERE run_id=${runId}`;
    expect(run).toMatchObject({ state: 'AWAITING_AUDITOR', revision: 2 });
    const [wait] = await sql`
      SELECT wait_id::text AS wait_id,run_id::text AS run_id,kind,options,deadline,closed_at,closure_kind,answer_option_id,actor
      FROM run_wait WHERE run_id=${runId}`;
    expect(wait).toMatchObject({
      wait_id: result.wait.waitId,
      run_id: runId,
      kind: 'choose-candidate',
      closed_at: null,
      closure_kind: null,
      answer_option_id: null,
      actor: null,
    });
    expect(wait!.options).toEqual(result.wait.options);

    const notifications = await sql`
      SELECT send_key,recipient_id,kind,run_id::text AS run_id,wait_id::text AS wait_id,
        escalation_kind,deadline,delivered_at,email_outcome
      FROM notification WHERE run_id=${runId} ORDER BY recipient_id
    `;
    expect(notifications).toHaveLength(2);
    expect(notifications.map(row => row.recipient_id)).toEqual([author, manager].sort());
    expect(notifications.every(row => row.kind === 'escalation' && row.run_id === runId && row.wait_id === result.wait.waitId && row.escalation_kind === 'choose-candidate' && row.delivered_at === null && row.email_outcome === null)).toBe(true);
    expect(notifications.map(row => row.send_key).sort()).toEqual([
      `escalation:${result.wait.waitId}:${author}`,
      `escalation:${result.wait.waitId}:${manager}`,
    ].sort());
    // AD-20's current inbox is an open-wait query, so it remains visible before the worker
    // consumes either delivery row.
    const openNotifications = await new DrizzleNotificationRepository(db).openFor(session);
    expect(openNotifications.filter((notice) => notice.runId === runId)).toMatchObject([{
      recipientId: author,
      runId,
      waitId: result.wait.waitId,
      kind: 'escalation',
      escalationKind: 'choose-candidate',
    }]);

    const jobs = await sql`
      SELECT data,start_after,singleton_key,state
      FROM pgboss.job WHERE name=${WAIT_QUEUE} AND data->>'runId'=${runId}`;
    expect(jobs).toHaveLength(1);
    expect(Object.keys(jobs[0]!.data).sort()).toEqual(['runId', 'schemaVersion', 'waitId']);
    expect(jobs[0]!.data).toEqual({ schemaVersion: 1, runId, waitId: result.wait.waitId });
    expect(jobs[0]!.singleton_key).toBe(`wait:${result.wait.waitId}`);
    expect(new Date(jobs[0]!.start_after).getTime()).toBe(new Date(result.wait.deadline).getTime());
  });

  it('rejects partial wait closures at the SQL boundary', async () => {
    const runId = await startRun('2026-04-01', '2026-04-30');
    const raised = await raise(runId, 'unnamed-value');
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;

    await expect(sql`
      UPDATE run_wait
      SET closed_at=${baseNow.toISOString()}, closure_kind=NULL, answer_option_id=NULL, actor=NULL
      WHERE wait_id=${raised.wait.waitId}
    `).rejects.toThrow(/run_wait_closure/);
    await expect(sql`
      UPDATE run_wait
      SET closed_at=${baseNow.toISOString()}, closure_kind='answer', answer_option_id=${ESCALATION_OPTION_IDS.markUnevaluated}, actor=NULL
      WHERE wait_id=${raised.wait.waitId}
    `).rejects.toThrow(/run_wait_closure/);

    const [wait] = await sql`SELECT closed_at,closure_kind,answer_option_id,actor FROM run_wait WHERE wait_id=${raised.wait.waitId}`;
    expect(wait).toMatchObject({ closed_at: null, closure_kind: null, answer_option_id: null, actor: null });
  });

  it('closes once with the expected revision and leaves the original wake as the sole job', async () => {
    const runId = await startRun('2026-07-01', '2026-07-31');
    const raised = await raise(runId, 'unnamed-value');
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;
    const deps = {
      repository: waitRepository(),
      roles: new DrizzleRoleRepository(db),
      unitOfWork: new PostgresRunsUnitOfWork(db),
      ids,
      clock: new FixedClock(new Date(baseNow.getTime() + 60 * 60 * 1000)),
    };
    const stale = await answerEscalation(deps, {
      session,
      request: {
        runId,
        waitId: raised.wait.waitId,
        expectedRunRevision: 1,
        answerOptionId: ESCALATION_OPTION_IDS.markUnevaluated,
      },
    });
    expect(stale).toMatchObject({ ok: false, code: 'stale-revision' });
    const answered = await answerEscalation(deps, {
      session,
      request: {
        runId,
        waitId: raised.wait.waitId,
        expectedRunRevision: 2,
        answerOptionId: ESCALATION_OPTION_IDS.markUnevaluated,
        note: 'Recorded, not sent to the agent',
      },
    });
    expect(answered).toMatchObject({ ok: true, state: 'RUNNING', answerOptionId: ESCALATION_OPTION_IDS.markUnevaluated });
    const duplicate = await answerEscalation(deps, {
      session,
      request: {
        runId,
        waitId: raised.wait.waitId,
        expectedRunRevision: 3,
        answerOptionId: ESCALATION_OPTION_IDS.markUnevaluated,
      },
    });
    expect(duplicate).toEqual({ ok: false, code: 'closed', reason: ANSWER_ESCALATION_REFUSALS.closed });
    const [run] = await sql`SELECT state,revision FROM audit_run WHERE run_id=${runId}`;
    expect(run).toMatchObject({ state: 'RUNNING', revision: 3 });
    const [wait] = await sql`SELECT closed_at,closure_kind,answer_option_id,actor FROM run_wait WHERE wait_id=${raised.wait.waitId}`;
    expect(wait).toMatchObject({ closure_kind: 'answer', answer_option_id: ESCALATION_OPTION_IDS.markUnevaluated, actor: author });
    expect(await sql`SELECT id FROM pgboss.job WHERE name=${WAIT_QUEUE} AND data->>'waitId'=${raised.wait.waitId}`).toHaveLength(1);
    // A delivery that loses the wait lock after the answer is acknowledged as superseded;
    // it must not create a delivered in-app item or claim that email was sent.
    const notifications = new DrizzleNotificationRepository(db);
    const sender = new InAppNotificationSender(db);
    for (const notice of (await notifications.pending(100)).filter(notice => notice.kind === 'escalation' && notice.runId === runId)) {
      await sender.send(notice);
    }
    const [delivery] = await sql`SELECT delivered_at,in_app_outcome,email_outcome FROM notification WHERE run_id=${runId} AND wait_id=${raised.wait.waitId} AND recipient_id=${author}`;
    expect(delivery).toMatchObject({ in_app_outcome: 'superseded', email_outcome: 'superseded' });
    expect((await notifications.deliveredFor(session)).items.filter(notice => notice.kind === 'escalation' && notice.waitId === raised.wait.waitId)).toHaveLength(0);
    expect((await notifications.openFor(session)).filter(notice => notice.runId === runId)).toHaveLength(0);
  });

  it('times out an open wait into Inconclusive, seals the Result, and skips a replayed wake', async () => {
    const runId = await startRun('2026-06-01', '2026-06-30');
    const raised = await raise(runId, 'retry-or-skip');
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;
    const afterDeadline = new Date(baseNow.getTime() + AWAITING_AUDITOR_TIMEOUT_MS);
    const wake = await wakeEscalation({ repository: waitRepository(), clock: new FixedClock(afterDeadline) }, {
      schemaVersion: 1,
      runId,
      waitId: raised.wait.waitId,
    });
    expect(wake).toMatchObject({ ok: true, status: 'timed-out', wait: { closureKind: 'timeout', actor: 'wait-wake' } });
    // The OTHER direction of the kind-derived timeout event: an Escalation keeps its own
    // event type, actor and prior state. Asserted here as well as on the pause case,
    // because a build that wrote `pause-timeout` for every kind would satisfy that one
    // alone (`pause-run.test.ts` → "is found by the recovery read").
    const [timedOut] = await sql`
      SELECT event_type, actor_id, payload
      FROM audit_events
      WHERE aggregate_id=${runId} AND payload->>'waitId'=${raised.wait.waitId} AND payload->>'closureKind'='timeout'
    `;
    expect(timedOut).toMatchObject({ event_type: 'execution.escalation-timeout', actor_id: 'escalation-wake' });
    expect(timedOut!.payload).toMatchObject({ kind: 'retry-or-skip', priorState: 'AWAITING_AUDITOR' });
    expect(await sql`SELECT state,revision FROM audit_run WHERE run_id=${runId}`).toMatchObject([{ state: 'INCONCLUSIVE', revision: 3 }]);
    expect(await sql`SELECT outcome,run_state FROM run_result WHERE run_id=${runId}`).toMatchObject([{ outcome: 'INCONCLUSIVE', run_state: 'INCONCLUSIVE' }]);
    expect(await sql`SELECT state,run_state FROM run_evidence_package WHERE run_id=${runId}`).toMatchObject([{ state: 'SEALED', run_state: 'INCONCLUSIVE' }]);
    const replay = await wakeEscalation({ repository: waitRepository(), clock: new FixedClock(new Date(afterDeadline.getTime() + 1)) }, {
      schemaVersion: 1,
      runId,
      waitId: raised.wait.waitId,
    });
    expect(replay).toMatchObject({ ok: true, status: 'superseded' });
    expect(await sql`SELECT count(*)::int AS count FROM run_result WHERE run_id=${runId}`).toEqual([{ count: 1 }]);
  });

  it('serializes an uncommitted answer against a competing timeout and second answer', async () => {
    const runId = await startRun('2026-05-01', '2026-05-31');
    const raised = await raise(runId, 'unnamed-value');
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    class HeldAnswerRepository extends PostgresWaitRepository {
      override transaction<T>(id: string, work: (context: WaitContext) => Promise<T>): Promise<T> {
        return super.transaction(id, async context => {
          const result = await work(context);
          // The actual closing command has written its answer, cancellation and seal,
          // but this real transaction remains open while both competitors arrive.
          entered(); await held; return result;
        });
      }
    }
    const request = { runId, waitId: raised.wait.waitId, expectedRunRevision: 2, answerOptionId: ESCALATION_OPTION_IDS.abort };
    const deps = { repository: waitRepository(), roles: new DrizzleRoleRepository(db),
      unitOfWork: new PostgresRunsUnitOfWork(db), ids,
      clock: new FixedClock(new Date(baseNow.getTime() + 60 * 60 * 1000)) };
    const answering = answerEscalation({ ...deps, repository: new HeldAnswerRepository(db) }, { session, request });
    await Promise.race([ready, answering.then(() => { throw new Error('The first answer did not reach its transaction hold.'); })]);
    const timingOut = wakeEscalation({ repository: waitRepository(),
      clock: new FixedClock(new Date(baseNow.getTime() + AWAITING_AUDITOR_TIMEOUT_MS)) },
      { schemaVersion: 1, runId, waitId: raised.wait.waitId });
    const duplicate = answerEscalation(deps, { session, request });
    try {
      await expect.poll(async () => Number((await sql`
        SELECT count(*) FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%audit_run%for update%'
      `)[0]!.count)).toBeGreaterThanOrEqual(2);
      expect(await sql`SELECT state FROM audit_run WHERE run_id=${runId}`).toEqual([{ state: 'AWAITING_AUDITOR' }]);
      expect(await sql`SELECT closed_at FROM run_wait WHERE wait_id=${raised.wait.waitId}`).toEqual([{ closed_at: null }]);
    } finally {
      release();
      await Promise.allSettled([answering, timingOut, duplicate]);
    }
    expect(await answering).toMatchObject({ ok: true, state: 'CANCELED' });
    expect(await timingOut).toMatchObject({ ok: true, status: 'superseded' });
    expect(await duplicate).toMatchObject({ ok: false, code: 'closed' });
    expect(await sql`SELECT closure_kind,actor FROM run_wait WHERE wait_id=${raised.wait.waitId}`).toEqual([{ closure_kind: 'answer', actor: author }]);
    expect(await sql`SELECT state FROM audit_run WHERE run_id=${runId}`).toEqual([{ state: 'CANCELED' }]);
    expect(await sql`SELECT outcome,sealed FROM run_result WHERE run_id=${runId}`).toEqual([{ outcome: 'CANCELED', sealed: true }]);
    expect(await sql`SELECT state FROM run_evidence_package WHERE run_id=${runId}`).toEqual([{ state: 'SEALED' }]);
  });

  it('refuses a duplicate singleton wake while the first enqueue is uncommitted', async () => {
    const runId = await startRun('2026-02-01', '2026-02-28');
    const raised = await raise(runId, 'retry-or-skip');
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;

    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    // Remove only this disposable fixture's scheduled job, then hold its replacement
    // INSERT uncommitted. Locking an already-committed row does not block PostgreSQL's
    // ON CONFLICT DO NOTHING path and would not test a singleton enqueue race.
    await sql`DELETE FROM pgboss.job WHERE name=${WAIT_QUEUE} AND data->>'waitId'=${raised.wait.waitId}`;
    const blocker = db.transaction(async transaction => {
      const adapter = queueDatabase(transaction);
      const queue = createProceduresQueue(db);
      expect(await queue.send(WAIT_QUEUE, { schemaVersion: 1, runId, waitId: raised.wait.waitId }, {
        db: adapter, startAfter: new Date(raised.wait.deadline),
        singletonKey: `wait:${raised.wait.waitId}`, singletonSeconds: AWAITING_AUDITOR_TIMEOUT_MS / 1000,
      })).not.toBeNull();
      entered();
      await held;
    });
    await ready;

    // The queue factory is the same pg-boss implementation used by the process. The
    // blocker above keeps this duplicate's real PostgreSQL insert pending until the
    // original row lock releases its singleton index entry.
    const duplicate = createProceduresQueue(db).send(
      WAIT_QUEUE,
      { schemaVersion: 1, runId, waitId: raised.wait.waitId },
      {
        startAfter: new Date(raised.wait.deadline),
        singletonKey: `wait:${raised.wait.waitId}`,
        singletonSeconds: AWAITING_AUDITOR_TIMEOUT_MS / 1000,
      },
    );
    try {
      await expect.poll(async () => Number((await sql`
        SELECT count(*)
        FROM pg_stat_activity
        WHERE datname=current_database()
          AND wait_event_type='Lock'
          AND cardinality(pg_blocking_pids(pid)) > 0
          AND query ILIKE '%insert%' AND query ILIKE '%pgboss%' AND query ILIKE '%job%'
      `)[0]!.count)).toBeGreaterThan(0);
    } finally {
      release();
      await blocker;
    }
    expect(await duplicate).toBeNull();
    expect(await sql`SELECT count(*)::int AS count FROM pgboss.job WHERE name=${WAIT_QUEUE} AND data->>'waitId'=${raised.wait.waitId}`).toEqual([{ count: 1 }]);
  });

  it('recreated wait repository recovers an open wait after a worker restart', async () => {
    const runId = await startRun('2026-01-01', '2026-01-31');
    // Make the persisted deadline already due so startup recovery can discover it without
    // relying on the host clock matching the fixture's calendar date.
    const raised = await raise(
      runId,
      'retry-or-skip',
      new Date(Date.now() - AWAITING_AUDITOR_TIMEOUT_MS - 1_000),
    );
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;

    const restartedRepository = new PostgresWaitRepository(db);
    const recovered = await restartedRepository.recoverableWaits(100);
    expect(recovered).toContainEqual({ runId, waitId: raised.wait.waitId });

    const state = await restartedRepository.transaction(runId, async context => ({
      run: context.run,
      wait: context.wait,
    }));
    expect(state.run).toMatchObject({ state: 'AWAITING_AUDITOR', revision: 2 });
    expect(state.wait).toMatchObject({
      runId,
      waitId: raised.wait.waitId,
      kind: 'retry-or-skip',
      closedAt: null,
      closureKind: null,
      answerOptionId: null,
      actor: null,
    });
  });

  it('removes open-wait metadata from a revoked initiating auditor while retaining manager access', async () => {
    const runId = await startRun('2026-03-01', '2026-03-31');
    expect((await raise(runId, 'unnamed-value')).ok).toBe(true);
    const notifications = new DrizzleNotificationRepository(db);
    expect((await notifications.openFor(session)).some(row => row.runId === runId)).toBe(true);
    const countBeforeRevocation = await notifications.countOpenFor(session);
    expect(countBeforeRevocation).toBeGreaterThan(0);
    expect(countBeforeRevocation).toBe((await notifications.openFor(session)).length);
    await sql`DELETE FROM user_role WHERE user_id=${author} AND role='auditor'`;
    try {
      expect(await notifications.openFor(session)).toEqual([]);
      expect(await notifications.countOpenFor(session)).toBe(0);
      const managerSession = { userId: manager, sessionId: 'manager-notification-test' };
      const managerInbox = await notifications.openFor(managerSession);
      expect(managerInbox.some(row => row.runId === runId)).toBe(true);
      expect(await notifications.countOpenFor(managerSession)).toBe(managerInbox.length);
    } finally { await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`; }
    expect(await notifications.countOpenFor(session)).toBe(countBeforeRevocation);
  });

});
