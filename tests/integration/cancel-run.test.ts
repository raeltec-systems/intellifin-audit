import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cancelRun,
  initiateRun,
  rerunRun,
  NO_RUN_OWNER,
  RUN_ALREADY_ACTIVE,
  type CancelRunDependencies,
  type RunDependencies,
} from '@intellifin/application';
import { DENIAL_REASONS, RUN_CANCELED_DEFAULT_REASON, RUN_CANCEL_REFUSALS, RUN_RERUN_DEFAULT_REASON, RUN_RERUN_REFUSALS } from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  DrizzleRunRepository,
  PostgresAuditChainReader,
  PostgresRunCancellationRepository,
  PostgresRunsUnitOfWork,
  PostgresProceduresUnitOfWork,
  SystemClock,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * Cancellation and rerun against a real PostgreSQL 18 (Story 3.10).
 *
 * Every row of the story's I/O matrix that the database decides: the atomic queued
 * cancellation, the recorded request for a Run a worker owns, the refusals, the
 * cancel-meets-claim race with the claim's transaction held OPEN, and the rerun rules.
 *
 * `tests/integration/population.test.ts` carries the other half — the worker honouring a
 * recorded request at its own checkpoint boundary — because the population fixtures live
 * there.
 */

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('cancelling a Run and starting a linked rerun', () => {
  let sql: Sql, db: Database;
  const ids = new CryptoUuidV7Generator();
  const author = `${ids.next()}-cancel-author`;
  const procedures: string[] = [];
  const session = { userId: author, sessionId: `${author}-session` };
  const period = { from: '2026-08-01', to: '2026-08-31' };

  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1)))
      throw new Error('Cancellation tests require an isolated local or CI test database');
    sql = createSqlClient(url!, { max: 6 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'Cancel test',${`${author}@test.invalid`})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const id of procedures) {
        const runs = await sql`SELECT run_id::text AS id FROM audit_run WHERE procedure_id=${id}`;
        for (const run of runs) {
          await sql`DELETE FROM pgboss.job WHERE name='runs' AND data->>'runId'=${run.id}`;
          await sql`DELETE FROM audit_events WHERE aggregate_id=${run.id}`;
          await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${run.id}`;
        }
        // `run_result`, `run_gate_check`, `run_evidence_package` and
        // `run_evidence_integrity` all carry a real foreign key to `audit_run`.
        await sql`DELETE FROM run_result WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
        await sql`DELETE FROM run_gate_check WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
        await sql`DELETE FROM run_evidence_integrity WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
        await sql`DELETE FROM run_evidence_package WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
        await sql`DELETE FROM run_initiation_request WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
        // The rerun link is a self-referencing foreign key, so a successor must go first.
        await sql`DELETE FROM audit_run WHERE procedure_id=${id} AND predecessor_run_id IS NOT NULL`;
        await sql`DELETE FROM audit_run WHERE procedure_id=${id}`;
        await sql`DELETE FROM procedure_succession WHERE procedure_id=${id}`;
        await sql`DELETE FROM procedure_version WHERE procedure_id=${id}`;
        await sql`DELETE FROM procedure WHERE procedure_id=${id}`;
      }
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  const runDependencies = (): RunDependencies => ({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock: new SystemClock() });
  const cancelDependencies = (repository = new PostgresRunCancellationRepository(db)): CancelRunDependencies =>
    ({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), repository, ids, clock: new SystemClock() });

  async function seed(): Promise<{ procedureId: string; versionId: string }> {
    const row = activeRunVersion(ids.next(), ids.next(), author);
    procedures.push(row.procedureId);
    await new PostgresProceduresUnitOfWork(db).execute(async c => {
      await c.procedures.insertProcedure(row);
      await c.procedures.insertVersion(row);
    });
    return { procedureId: row.procedureId, versionId: row.versionId };
  }

  async function start(procedureId: string, dates = period): Promise<string> {
    const outcome = await initiateRun(runDependencies(), { session, request: { procedureId, period: dates, requestToken: ids.next() } });
    if (!outcome.ok) throw new Error(outcome.reason);
    return outcome.runId;
  }

  it('cancels a queued Run and removes its dispatch job in one transaction', async () => {
    const { procedureId } = await seed();
    const runId = await start(procedureId);
    expect(await sql`SELECT id FROM pgboss.job WHERE name='runs' AND data->>'runId'=${runId}`).toHaveLength(1);

    expect(await cancelRun(cancelDependencies(), { session, request: { runId, reason: null } }))
      .toEqual({ ok: true, state: 'CANCELED', pending: false });

    const [row] = await sql`SELECT state,cancel_requested_by,cancel_requested_session,cancel_reason,cancel_requested_at FROM audit_run WHERE run_id=${runId}`;
    expect(row).toMatchObject({ state: 'CANCELED', cancel_requested_by: author, cancel_requested_session: session.sessionId, cancel_reason: RUN_CANCELED_DEFAULT_REASON });
    expect(row!.cancel_requested_at).not.toBeNull();
    // No worker can pick it up afterwards: the job is gone, in the same transaction.
    expect(await sql`SELECT id FROM pgboss.job WHERE name='runs' AND data->>'runId'=${runId}`).toHaveLength(0);
    // A cancellation IS a terminal transition. Generation 25's deferred trigger would
    // have refused the commit without a Result, and generation 21's without a package.
    expect(await sql`SELECT outcome,outcome_row,run_state,gate_passed FROM run_result WHERE run_id=${runId}`)
      .toMatchObject([{ outcome: 'CANCELED', outcome_row: 'canceled', run_state: 'CANCELED', gate_passed: false }]);
    expect(await sql`SELECT state,run_state FROM run_evidence_package WHERE run_id=${runId}`).toMatchObject([{ run_state: 'CANCELED' }]);
    // CANCELED is the one outcome that does not require the Gate to have run.
    expect(await sql`SELECT check_name FROM run_gate_check WHERE run_id=${runId}`).toHaveLength(0);
    const events = await sql`SELECT event_type,actor_id,session_id,payload FROM audit_events WHERE aggregate_id=${runId} ORDER BY sequence`;
    expect(events.map(event => event.event_type)).toEqual(['lifecycle.run-queued', 'lifecycle.run-canceled', 'lifecycle.evidence-package-sealed', 'lifecycle.result-sealed']);
    expect(events[1]).toMatchObject({ actor_id: author, session_id: session.sessionId, payload: { priorState: 'QUEUED', state: 'CANCELED', performedBy: 'web' } });
    expect(await new PostgresAuditChainReader(db).verify(runId)).toMatchObject({ valid: true });
  });

  it('records a request for a Run a worker owns and performs no transition', async () => {
    const { procedureId } = await seed();
    const runId = await start(procedureId, { from: '2026-07-01', to: '2026-07-31' });
    // What a claim does: the worker takes the Run RUNNING inside its own transaction.
    await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${runId}`;

    expect(await cancelRun(cancelDependencies(), { session, request: { runId, reason: 'Wrong period.' } }))
      .toEqual({ ok: true, state: 'RUNNING', pending: true });

    expect(await sql`SELECT state,cancel_reason FROM audit_run WHERE run_id=${runId}`).toMatchObject([{ state: 'RUNNING', cancel_reason: 'Wrong period.' }]);
    expect(await sql`SELECT run_id FROM run_result WHERE run_id=${runId}`).toHaveLength(0);
    // The dispatch job stays: the worker that owns the Run has to reach its boundary.
    expect(await sql`SELECT id FROM pgboss.job WHERE name='runs' AND data->>'runId'=${runId}`).toHaveLength(1);
    const events = await sql`SELECT event_type,payload FROM audit_events WHERE aggregate_id=${runId} ORDER BY sequence`;
    expect(events.map(event => event.event_type)).toEqual(['lifecycle.run-queued', 'lifecycle.run-cancel-requested']);
    expect(events[1]!.payload).toMatchObject({ state: 'RUNNING', performedBy: 'worker' });

    // Duplicate cancel: one marker, one event, and the first requester survives.
    expect(await cancelRun(cancelDependencies(), { session: { userId: author, sessionId: 'second-session' }, request: { runId, reason: 'A different note.' } }))
      .toEqual({ ok: true, state: 'RUNNING', pending: true });
    expect(await sql`SELECT cancel_requested_session,cancel_reason FROM audit_run WHERE run_id=${runId}`)
      .toMatchObject([{ cancel_requested_session: session.sessionId, cancel_reason: 'Wrong period.' }]);
    expect(await sql`SELECT sequence FROM audit_events WHERE aggregate_id=${runId}`).toHaveLength(2);
  });

  it('refuses a terminal Run and an unknown Run without writing anything', async () => {
    const { procedureId } = await seed();
    const runId = await start(procedureId, { from: '2026-06-01', to: '2026-06-30' });
    const first = await cancelRun(cancelDependencies(), { session, request: { runId, reason: null } });
    expect(first).toMatchObject({ ok: true, state: 'CANCELED' });
    const before = await sql`SELECT count(*)::int AS c FROM audit_events WHERE aggregate_id=${runId}`;

    expect(await cancelRun(cancelDependencies(), { session, request: { runId, reason: null } }))
      .toEqual({ ok: false, reason: RUN_CANCEL_REFUSALS.ALREADY_TERMINAL });
    expect(await cancelRun(cancelDependencies(), { session, request: { runId: ids.next(), reason: null } }))
      .toEqual({ ok: false, reason: RUN_CANCEL_REFUSALS.UNKNOWN });
    expect(await sql`SELECT count(*)::int AS c FROM audit_events WHERE aggregate_id=${runId}`).toEqual(before);
    expect(await sql`SELECT count(*)::int AS c FROM run_result WHERE run_id=${runId}`).toMatchObject([{ c: 1 }]);
  });

  it('refuses a role without the action and audits the denial', async () => {
    const { procedureId } = await seed();
    const runId = await start(procedureId, { from: '2026-05-01', to: '2026-05-31' });
    const administrator = `${ids.next()}-admin`;
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${administrator},'Admin',${`${administrator}@test.invalid`})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${administrator},'poc-administrator')`;
    try {
      // The gating table's own sentence, imported rather than retyped: a denial string
      // typed into a test has been wrong in three places at once before.
      expect(await cancelRun(cancelDependencies(), { session: { userId: administrator, sessionId: 'admin-session' }, request: { runId, reason: null } }))
        .toEqual({ ok: false, reason: DENIAL_REASONS.ADMIN_CANNOT_AUTHOR });
      expect(await sql`SELECT state,cancel_requested_at FROM audit_run WHERE run_id=${runId}`).toMatchObject([{ state: 'QUEUED', cancel_requested_at: null }]);
      const denied = await sql`SELECT payload FROM audit_events WHERE event_type='security.denied' AND actor_id=${administrator}`;
      expect(denied).toHaveLength(1);
      expect(denied[0]!.payload).toMatchObject({ action: 'run.cancel', role: 'poc-administrator' });
    } finally {
      // The denial is left in the `platform` chain. Deleting an event out of the middle
      // of a chain is what breaks it, and `audit_events` has no key to this user anyway.
      await sql`DELETE FROM user_role WHERE user_id=${administrator}`;
      await sql`DELETE FROM auth_user WHERE id=${administrator}`;
    }
  });

  it('waits on the claim that holds the Run and sees its committed result', async () => {
    const { procedureId } = await seed();
    const runId = await start(procedureId, { from: '2026-04-01', to: '2026-04-30' });
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    // A worker's claim: the Run row is locked, the state moves to RUNNING, and the
    // transaction is held OPEN before it commits. Starting two promises proves nothing;
    // the competing cancellation has to be observed WAITING on this lock.
    const claim = sql.begin(async transaction => {
      await transaction`SELECT run_id FROM audit_run WHERE run_id=${runId} FOR UPDATE`;
      await transaction`UPDATE audit_run SET state='RUNNING' WHERE run_id=${runId}`;
      entered();
      await held;
    });
    await ready;
    const cancelling = cancelRun(cancelDependencies(), { session, request: { runId, reason: 'Raced.' } });
    try {
      await expect.poll(async () => Number((await sql`
        SELECT count(*) FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%audit_run%for update%'`)[0]!.count)).toBeGreaterThan(0);
    } finally {
      // Both, in the finally: a failed poll must not leave the held transaction
      // dangling, or this file's own cleanup races a commit that is still in flight
      // and leaves rows behind for a later suite to trip over.
      release();
      await claim;
    }
    // The claim won, so the cancellation reads RUNNING and records a request rather than
    // transitioning a Run a worker is now executing.
    expect(await cancelling).toEqual({ ok: true, state: 'RUNNING', pending: true });
    expect(await sql`SELECT state FROM audit_run WHERE run_id=${runId}`).toMatchObject([{ state: 'RUNNING' }]);
    expect(await sql`SELECT id FROM pgboss.job WHERE name='runs' AND data->>'runId'=${runId}`).toHaveLength(1);
  });

  it('reruns a terminal Run into a new linked Run and leaves the predecessor unchanged', async () => {
    const { procedureId, versionId } = await seed();
    const predecessorId = await start(procedureId, { from: '2026-03-01', to: '2026-03-31' });
    await cancelRun(cancelDependencies(), { session, request: { runId: predecessorId, reason: null } });
    const [before] = await sql`SELECT * FROM audit_run WHERE run_id=${predecessorId}`;
    const [beforeResult] = await sql`SELECT * FROM run_result WHERE run_id=${predecessorId}`;
    const [beforeHead] = await sql`SELECT last_sequence,last_event_hash FROM audit_event_heads WHERE aggregate_id=${predecessorId}`;

    const rerun = await rerunRun(runDependencies(), { session, request: { predecessorRunId: predecessorId, requestToken: ids.next(), reason: null } });
    expect(rerun.ok).toBe(true);
    if (!rerun.ok) return;
    const created = (await new DrizzleRunRepository(db).findRun(rerun.runId))!;
    expect(created).toMatchObject({
      procedureId, versionId, state: 'QUEUED', kind: 'STANDARD',
      // The period comes from the predecessor, never from the caller.
      period: { from: '2026-03-01', to: '2026-03-31' },
      predecessorRunId: predecessorId, rerunReason: RUN_RERUN_DEFAULT_REASON,
    });
    expect(await sql`SELECT id FROM pgboss.job WHERE name='runs' AND data->>'runId'=${rerun.runId}`).toHaveLength(1);
    // The link is on the NEW Run's chain and nowhere else, so the predecessor's row, its
    // Result and its chain head are byte-for-byte what they were.
    expect(await sql`SELECT * FROM audit_run WHERE run_id=${predecessorId}`).toEqual([before]);
    expect(await sql`SELECT * FROM run_result WHERE run_id=${predecessorId}`).toEqual([beforeResult]);
    expect(await sql`SELECT last_sequence,last_event_hash FROM audit_event_heads WHERE aggregate_id=${predecessorId}`).toEqual([beforeHead]);
    const events = await sql`SELECT event_type,payload FROM audit_events WHERE aggregate_id=${rerun.runId} ORDER BY sequence`;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: 'lifecycle.run-queued', payload: { predecessorRunId: predecessorId, reason: RUN_RERUN_DEFAULT_REASON } });

    // Rerun of an ACTIVE Run: refused, and the active Run is named.
    expect(await rerunRun(runDependencies(), { session, request: { predecessorRunId: rerun.runId, requestToken: ids.next(), reason: null } }))
      .toEqual({ ok: false, reason: RUN_RERUN_REFUSALS.STILL_ACTIVE, existingRunId: rerun.runId });
    // Rerun while another Run is active for that period: initiation's own rule, and its
    // own sentence, because a rerun resolves everything a first Run does.
    await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${rerun.runId}`;
    expect(await rerunRun(runDependencies(), { session, request: { predecessorRunId: predecessorId, requestToken: ids.next(), reason: null } }))
      .toEqual({ ok: false, reason: RUN_ALREADY_ACTIVE, existingRunId: rerun.runId });
    expect(await sql`SELECT count(*)::int AS c FROM audit_run WHERE procedure_id=${procedureId}`).toMatchObject([{ c: 2 }]);

    // The predecessor can SAY it has been rerun. `RunLifecycleActions` tells somebody whose
    // rerun response was lost to "Reload the Run to see whether a new Run was queued", and
    // the link is deliberately on the successor's row alone — so until this read existed
    // the page they reloaded could not answer the question it had just asked them. They saw
    // no change and clicked Rerun again, and once the first successor had itself concluded
    // the active-period check no longer refused them: two Runs from one intent.
    const successors = await new DrizzleRunRepository(db).findSuccessors(predecessorId);
    expect(successors.map((run) => run.runId)).toEqual([rerun.runId]);
    // And the successor itself has none, so this is a real read and not a constant.
    expect(await new DrizzleRunRepository(db).findSuccessors(rerun.runId)).toEqual([]);
    // A malformed id is absence, never a `22P02` from the `uuid` comparison.
    expect(await new DrizzleRunRepository(db).findSuccessors('not-a-uuid')).toEqual([]);
  });

  it('resolves the period owner afresh and refuses a period no ACTIVE version owns', async () => {
    const { procedureId } = await seed();
    const predecessorId = await start(procedureId, { from: '2026-02-01', to: '2026-02-28' });
    await cancelRun(cancelDependencies(), { session, request: { runId: predecessorId, reason: null } });
    // The version that owned the period is no longer ACTIVE. A rerun must not run a
    // stale owner, so it is refused with initiation's own sentence. It is not put back:
    // generation 14 refuses a reviewed version returning to authoring, and this Procedure
    // exists for this one assertion.
    await sql`UPDATE procedure_version SET state='RETIRED' WHERE procedure_id=${procedureId}`;
    expect(await rerunRun(runDependencies(), { session, request: { predecessorRunId: predecessorId, requestToken: ids.next(), reason: null } }))
      .toEqual({ ok: false, reason: NO_RUN_OWNER });
    expect(await sql`SELECT count(*)::int AS c FROM audit_run WHERE procedure_id=${procedureId}`).toMatchObject([{ c: 1 }]);
  });

  it('refuses a cancellation reason and a rerun reason the database would not store', async () => {
    const { procedureId } = await seed();
    const runId = await start(procedureId, { from: '2026-01-01', to: '2026-01-31' });
    const tooLong = 'x'.repeat(501);
    expect(await cancelRun(cancelDependencies(), { session, request: { runId, reason: tooLong } })).toMatchObject({ ok: false });
    expect(await sql`SELECT cancel_requested_at FROM audit_run WHERE run_id=${runId}`).toMatchObject([{ cancel_requested_at: null }]);
    // The database refuses it as well, so the bound is not only a command rule.
    await expect(sql`UPDATE audit_run SET cancel_requested_at=now(),cancel_requested_by='a',cancel_requested_session='b',cancel_reason=${tooLong} WHERE run_id=${runId}`).rejects.toThrow(/audit_run_cancel_reason/);
    // Three of four columns is a marker that can say nothing, and the CHECK refuses it.
    await expect(sql`UPDATE audit_run SET cancel_requested_at=now(),cancel_requested_by='a' WHERE run_id=${runId}`).rejects.toThrow(/audit_run_cancel_request/);
    // A link with no reason records that a rerun exists and not why.
    await expect(sql`UPDATE audit_run SET predecessor_run_id=${runId} WHERE run_id=${runId}`).rejects.toThrow(/audit_run_rerun/);
  });
});
