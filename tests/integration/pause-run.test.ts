import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RUN_PAUSE_REFUSALS, RUN_RESUME_REFUSALS } from '@intellifin/domain';
import {
  PAUSED_TIMEOUT_MS,
  ESCALATION_OPTION_IDS,
  answerEscalation,
  initiateRun,
  pauseRun,
  pauseWaitFor,
  performPause,
  raiseEscalation,
  resumeRun,
  wakeEscalation,
  type Clock,
} from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleNotificationRepository,
  DrizzleRoleRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunsUnitOfWork,
  SystemClock,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';
import { PostgresWaitRepository, WAIT_QUEUE } from '../../packages/infrastructure/src/runs/wait-repository.js';

/**
 * Story 5.4's database boundary: pause and resume against a real PostgreSQL 18.
 *
 * The application tests exercise the command refusal matrix with an in-memory context.
 * These cases exercise what those cannot see: the CHECKs that make a pause and an
 * Escalation unable to be mistaken for each other, the request marker's first-writer rule,
 * the one delayed wake job at the pause's OWN thirty-minute deadline, the timeout that
 * ends a Paused Run Inconclusive, the recovery read that has to find an overdue pause, and
 * the inbox that must not show one.
 */
const url = process.env.DATABASE_URL;

class FixedClock implements Clock {
  constructor(private readonly value: Date) {}
  now(): Date { return new Date(this.value); }
}

describe.skipIf(!url)('pausing and resuming a Run', () => {
  let sql: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const author = ids.next();
  // A SECOND auditor, never an audit-manager. `escalationNotificationRecipients` reads
  // every audit-manager in the database, so a file that adds one changes what a
  // concurrently-running file sees — which is exactly the failure this avoids.
  const other = ids.next();
  const procedureId = ids.next();
  const versionId = ids.next();
  const runIds: string[] = [];
  const session = { userId: author, sessionId: `${author}-pause-session` };
  const baseNow = new Date('2026-09-10T09:00:00.000Z');

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))
    ) {
      throw new Error('Pause tests require an isolated local or CI test database');
    }
    sql = createSqlClient(url!, { max: 8 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'Pause test',${author + '@test.invalid'})`;
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${other},'Pause second auditor',${other + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${other},'auditor')`;
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
        await sql`DELETE FROM run_wait WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result WHERE run_id=${runId}`;
        await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
        await sql`DELETE FROM run_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM run_initiation_request WHERE run_id=${runId} OR refused_run_id=${runId}`;
      }
      // A refusal record names a Procedure that may not exist and carries a NULL `run_id`,
      // so a teardown keyed on `run_id` alone leaks one row per run — forever.
      await sql`DELETE FROM run_initiation_request WHERE initiator_id=${author}`;
      await sql`DELETE FROM audit_run WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM user_role WHERE user_id IN (${author},${other})`;
      await sql`DELETE FROM auth_user WHERE id IN (${author},${other})`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  // A distinct period per Run, because one Procedure may hold only one ACTIVE Run per
  // period. Twelve months per year, so the year moves rather than the month running to 13.
  let period = 0;
  async function startRun(): Promise<string> {
    const month = String((period % 12) + 1).padStart(2, '0');
    const year = 2026 + Math.floor(period / 12);
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

  function deps(now = baseNow) {
    return {
      roles: new DrizzleRoleRepository(db),
      unitOfWork: new PostgresRunsUnitOfWork(db),
      repository: new PostgresWaitRepository(db),
      ids,
      clock: new FixedClock(now),
    };
  }

  /** Everything the worker's boundary does, in one transaction, as the stage does it. */
  async function honourPause(runId: string, at = baseNow): Promise<string> {
    return new PostgresWaitRepository(db).transaction(runId, async (context) => {
      const run = context.run!;
      const request = context.run!.pauseRequest!;
      await context.saveRunState('PAUSED');
      const wait = await performPause(
        context as never,
        { run, request, waitId: ids.next(), at: at.toISOString() },
      );
      return wait.waitId;
    });
  }

  describe('generation 45 refuses what no command should be able to write', () => {
    it('refuses a pause wait that names nobody, and an Escalation that names somebody', async () => {
      const runId = await startRun();
      const bad = ids.next();
      await expect(sql`
        INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,opened_by,deadline)
        VALUES (${bad},${runId},'pause','[{"id":"resume","label":"Resume"}]'::jsonb, now(), NULL, now() + interval '30 minutes')
      `).rejects.toMatchObject({ code: '23514' });
      await expect(sql`
        INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,opened_by,deadline)
        VALUES (${bad},${runId},'retry-or-skip','[{"id":"retry","label":"Retry"}]'::jsonb, now(), 'auditor', now() + interval '4 hours')
      `).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a pause closed as an ANSWER, and an Escalation closed as a RESUME', async () => {
      const runId = await startRun();
      const pauseId = ids.next();
      await sql`
        INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,opened_by,deadline)
        VALUES (${pauseId},${runId},'pause','[{"id":"resume","label":"Resume"}]'::jsonb, now(), ${author}, now() + interval '30 minutes')
      `;
      await expect(sql`
        UPDATE run_wait SET closed_at=now(), closure_kind='answer', answer_option_id='resume', actor=${author} WHERE wait_id=${pauseId}
      `).rejects.toMatchObject({ code: '23514' });
      // And the same door from the other side.
      await sql`UPDATE run_wait SET closed_at=now(), closure_kind='resume', answer_option_id='resume', actor=${author} WHERE wait_id=${pauseId}`;
      const escalationId = ids.next();
      await sql`
        INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,opened_by,deadline)
        VALUES (${escalationId},${runId},'retry-or-skip','[{"id":"retry","label":"Retry"}]'::jsonb, now(), NULL, now() + interval '4 hours')
      `;
      await expect(sql`
        UPDATE run_wait SET closed_at=now(), closure_kind='resume', answer_option_id='resume', actor=${author} WHERE wait_id=${escalationId}
      `).rejects.toMatchObject({ code: '23514' });
    });

    /**
     * The trap this CHECK fell into once, and the reason every comparison in it is
     * `IS [NOT] DISTINCT FROM`: `closure_kind='answer'` is NULL when the column is NULL, so
     * a half-closed row made all four arms NULL — and a CHECK that evaluates to NULL
     * PASSES. `run-waits.test.ts` caught it; this keeps it caught from the pause's side.
     */
    it('refuses a half-closed pause, where every arm would otherwise evaluate to NULL', async () => {
      const runId = await startRun();
      const waitId = ids.next();
      await sql`
        INSERT INTO run_wait(wait_id,run_id,kind,options,opened_at,opened_by,deadline)
        VALUES (${waitId},${runId},'pause','[{"id":"resume","label":"Resume"}]'::jsonb, now(), ${author}, now() + interval '30 minutes')
      `;
      await expect(sql`
        UPDATE run_wait SET closed_at=now(), closure_kind=NULL, answer_option_id=NULL, actor=NULL WHERE wait_id=${waitId}
      `).rejects.toMatchObject({ code: '23514' });
      await expect(sql`
        UPDATE run_wait SET closed_at=now(), closure_kind='resume', answer_option_id=NULL, actor=${author} WHERE wait_id=${waitId}
      `).rejects.toMatchObject({ code: '23514' });
      await expect(sql`
        UPDATE run_wait SET closed_at=now(), closure_kind='resume', answer_option_id='resume', actor=NULL WHERE wait_id=${waitId}
      `).rejects.toMatchObject({ code: '23514' });
      const [row] = await sql`SELECT closed_at FROM run_wait WHERE wait_id=${waitId}`;
      expect(row?.closed_at).toBeNull();
    });

    it('pairs a SUPERSEDED Step Execution with its reason, in both directions', async () => {
      const runId = await startRun();
      const one = ids.next();
      await expect(sql`
        INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,action,state,attempt,started_at,superseded_by)
        VALUES (${one},${runId},'step-1','inspect-record','SUPERSEDED',1,now(),NULL)
      `).rejects.toMatchObject({ code: '23514' });
      await expect(sql`
        INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,action,state,attempt,started_at,superseded_by)
        VALUES (${one},${runId},'step-1','inspect-record','SUCCEEDED',1,now(),'resume')
      `).rejects.toMatchObject({ code: '23514' });
      await expect(sql`
        INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,action,state,attempt,started_at,superseded_by)
        VALUES (${one},${runId},'step-1','inspect-record','SUPERSEDED',1,now(),'because-i-said-so')
      `).rejects.toMatchObject({ code: '23514' });
      // The one row the vocabulary permits.
      await sql`
        INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,action,state,attempt,started_at,superseded_by)
        VALUES (${one},${runId},'step-1','inspect-record','SUPERSEDED',1,now(),'resume')
      `;
      const [row] = await sql`SELECT state, superseded_by, diagnostic FROM run_step_execution WHERE step_execution_id=${one}`;
      // Nothing went wrong, so the diagnostic column stays empty.
      expect(row).toMatchObject({ state: 'SUPERSEDED', superseded_by: 'resume', diagnostic: null });
    });
  });

  /**
   * The `opened_at` backfill, run against real rows.
   *
   * The statements are READ from `0045_pause_and_resume.sql` rather than retyped, so a
   * changed backfill expression fails here instead of agreeing with a copy of itself. They
   * are applied to a scratch table shaped like generation 44's `run_wait` — the FK chain a
   * synthetic generation-44 Run would need is a Procedure, a Version and a Run whose own
   * CHECKs a placeholder row cannot satisfy, and none of that is what this proves.
   *
   * The claim: every wait the table has ever held is an Escalation created with
   * `deadline = opened_at + 4 hours`, so subtracting four hours is EXACT, not a guess.
   */
  describe("generation 45's opened_at backfill", () => {
    it('recovers the exact instant every existing wait opened, then makes the column NOT NULL', async () => {
      const migration = await import('node:fs/promises').then((fs) =>
        fs.readFile(new URL('../../packages/infrastructure/drizzle/0045_pause_and_resume.sql', import.meta.url), 'utf8'),
      );
      const statements = migration
        .split('--> statement-breakpoint')
        .map((line) => line.trim())
        .filter((line) => /"opened_at"/.test(line) && !line.startsWith('--'));
      // Add nullable, backfill, then SET NOT NULL — in that order, and only those three.
      expect(statements).toHaveLength(3);

      await sql`DROP SCHEMA IF EXISTS pause_backfill_proof CASCADE`;
      await sql`CREATE SCHEMA pause_backfill_proof`;
      try {
        await sql`
          CREATE TABLE pause_backfill_proof.run_wait (
            wait_id uuid PRIMARY KEY, kind text NOT NULL, deadline timestamptz NOT NULL
          )`;
        await sql`
          INSERT INTO pause_backfill_proof.run_wait(wait_id, kind, deadline) VALUES
            (${ids.next()},'retry-or-skip', timestamptz '2026-09-10T13:00:00Z'),
            (${ids.next()},'choose-candidate', timestamptz '2026-09-09T04:30:00Z')`;

        for (const statement of statements) {
          await sql.unsafe(statement.replace(/"run_wait"/g, 'pause_backfill_proof.run_wait'));
        }

        const rows = await sql`
          SELECT opened_at, deadline, opened_at = deadline - interval '4 hours' AS exact
          FROM pause_backfill_proof.run_wait ORDER BY deadline`;
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.exact === true)).toBe(true);
        expect(new Date(rows[0]!.opened_at as string).toISOString()).toBe('2026-09-09T00:30:00.000Z');
        expect(new Date(rows[1]!.opened_at as string).toISOString()).toBe('2026-09-10T09:00:00.000Z');

        // And the column really is NOT NULL afterwards, so the next producer must say when.
        await expect(
          sql`INSERT INTO pause_backfill_proof.run_wait(wait_id, kind, deadline) VALUES (${ids.next()},'pause', now())`,
        ).rejects.toMatchObject({ code: '23502' });
      } finally {
        await sql`DROP SCHEMA IF EXISTS pause_backfill_proof CASCADE`;
      }
    });
  });

  describe('the request marker', () => {
    it('is written whole, and the FIRST request wins', async () => {
      const runId = await startRun();
      await expect(pauseRun(deps(), { session, request: { runId } })).resolves.toEqual({ ok: true, state: 'RUNNING', pending: true });
      const second = await pauseRun(
        deps(new Date('2026-09-10T09:05:00.000Z')),
        { session: { userId: other, sessionId: 'other-session' }, request: { runId } },
      );
      expect(second).toEqual({ ok: true, state: 'RUNNING', pending: true });

      const [row] = await sql`SELECT state, pause_requested_by, pause_requested_session, pause_requested_at FROM audit_run WHERE run_id=${runId}`;
      expect(row).toMatchObject({ state: 'RUNNING', pause_requested_by: author, pause_requested_session: session.sessionId });
      expect(new Date(row!.pause_requested_at as string).toISOString()).toBe(baseNow.toISOString());

      const events = await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${runId} AND event_type LIKE 'lifecycle.run-pause%'`;
      expect(events).toHaveLength(1);
    });

    it('refuses an Awaiting Auditor Run and writes nothing', async () => {
      const runId = await startRun();
      const raised = await raiseEscalation(
        { repository: new PostgresWaitRepository(db), ids, clock: new FixedClock(baseNow) },
        { runId, kind: 'retry-or-skip', stepId: 'step-1' },
      );
      expect(raised.ok).toBe(true);

      await expect(pauseRun(deps(), { session, request: { runId } }))
        .resolves.toEqual({ ok: false, reason: RUN_PAUSE_REFUSALS.AWAITING });
      const [row] = await sql`SELECT pause_requested_at FROM audit_run WHERE run_id=${runId}`;
      expect(row?.pause_requested_at).toBeNull();
    });
  });

  describe('honouring the pause at a boundary', () => {
    it('opens ONE wait at the pause window, clears the marker and enqueues one wake', async () => {
      const runId = await startRun();
      await pauseRun(deps(), { session, request: { runId } });
      const waitId = await honourPause(runId);

      const [run] = await sql`SELECT state, pause_requested_at FROM audit_run WHERE run_id=${runId}`;
      expect(run).toMatchObject({ state: 'PAUSED', pause_requested_at: null });

      const [wait] = await sql`SELECT kind, opened_by, opened_at, deadline, closed_at, options FROM run_wait WHERE wait_id=${waitId}`;
      expect(wait).toMatchObject({ kind: 'pause', opened_by: author, closed_at: null });
      expect(new Date(wait!.opened_at as string).toISOString()).toBe(baseNow.toISOString());
      // Thirty minutes, not the Escalation's four hours.
      expect(new Date(wait!.deadline as string).getTime() - new Date(wait!.opened_at as string).getTime()).toBe(PAUSED_TIMEOUT_MS);

      const jobs = await sql`SELECT start_after FROM pgboss.job WHERE name=${WAIT_QUEUE} AND data->>'waitId'=${waitId}`;
      expect(jobs).toHaveLength(1);
      expect(new Date(jobs[0]!.start_after as string).toISOString()).toBe(new Date(wait!.deadline as string).toISOString());

      // No Audit Manager is told. A pause is the auditor's own action; the Flag is 5.5's.
      const notifications = await sql`SELECT count(*)::int AS n FROM notification WHERE run_id=${runId}`;
      expect(notifications[0]!.n).toBe(0);
    });

    it('cannot open a second wait while one is open', async () => {
      const runId = await startRun();
      await pauseRun(deps(), { session, request: { runId } });
      await honourPause(runId);
      // `run_wait_one_open` is exactly why a paused Run cannot raise an Escalation.
      const raised = await raiseEscalation(
        { repository: new PostgresWaitRepository(db), ids, clock: new FixedClock(baseNow) },
        { runId, kind: 'retry-or-skip', stepId: 'step-1' },
      );
      expect(raised.ok).toBe(false);
    });
  });

  describe('the inbox and the bell', () => {
    it('show an Escalation and never a pause', async () => {
      const inbox = new DrizzleNotificationRepository(db);
      // The Run's own initiator: the inbox predicate admits them or an audit-manager, and
      // an initiator needs no globally-visible role added to this database.
      const reader = session;

      const pausedRun = await startRun();
      await pauseRun(deps(), { session, request: { runId: pausedRun } });
      await honourPause(pausedRun);
      const afterPause = (await inbox.openFor(reader)).filter((row) => row.runId === pausedRun);
      expect(afterPause).toHaveLength(0);

      const escalatedRun = await startRun();
      await raiseEscalation(
        { repository: new PostgresWaitRepository(db), ids, clock: new FixedClock(baseNow) },
        { runId: escalatedRun, kind: 'retry-or-skip', stepId: 'step-1' },
      );
      const afterEscalation = (await inbox.openFor(reader)).filter((row) => row.runId === escalatedRun);
      expect(afterEscalation).toHaveLength(1);
    });
  });

  describe('resuming', () => {
    it('closes the wait by RESUME under the expected revision and returns the Run to RUNNING', async () => {
      const runId = await startRun();
      await pauseRun(deps(), { session, request: { runId } });
      const waitId = await honourPause(runId);
      const [before] = await sql`SELECT revision FROM audit_run WHERE run_id=${runId}`;

      const outcome = await resumeRun(
        deps(new Date('2026-09-10T09:10:00.000Z')),
        { session, request: { runId, expectedRunRevision: Number(before!.revision) } },
      );
      expect(outcome).toEqual({ ok: true, state: 'RUNNING', waitId });

      const [run] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
      expect(run).toMatchObject({ state: 'RUNNING' });
      const [wait] = await sql`SELECT closure_kind, answer_option_id, actor FROM run_wait WHERE wait_id=${waitId}`;
      expect(wait).toMatchObject({ closure_kind: 'resume', answer_option_id: 'resume', actor: author });
      const events = await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${runId} ORDER BY sequence`;
      expect(events.map((row) => row.event_type)).toContain('lifecycle.run-resumed');
    });

    it('refuses a revision the person did not read, leaving the pause open', async () => {
      const runId = await startRun();
      await pauseRun(deps(), { session, request: { runId } });
      const waitId = await honourPause(runId);
      const [before] = await sql`SELECT revision FROM audit_run WHERE run_id=${runId}`;

      const outcome = await resumeRun(
        deps(new Date('2026-09-10T09:10:00.000Z')),
        { session, request: { runId, expectedRunRevision: Number(before!.revision) + 3 } },
      );
      expect(outcome.ok).toBe(false);
      const [wait] = await sql`SELECT closed_at FROM run_wait WHERE wait_id=${waitId}`;
      expect(wait?.closed_at).toBeNull();
      const [run] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
      expect(run).toMatchObject({ state: 'PAUSED' });
    });

    /** Neither command can act on the other's wait, at the command AND at the database. */
    it('refuses an open Escalation, and AnswerEscalation refuses an open pause', async () => {
      const escalated = await startRun();
      const raised = await raiseEscalation(
        { repository: new PostgresWaitRepository(db), ids, clock: new FixedClock(baseNow) },
        { runId: escalated, kind: 'retry-or-skip', stepId: 'step-1' },
      );
      expect(raised.ok).toBe(true);
      const [escalatedRun] = await sql`SELECT revision FROM audit_run WHERE run_id=${escalated}`;
      await expect(resumeRun(deps(), { session, request: { runId: escalated, expectedRunRevision: Number(escalatedRun!.revision) } }))
        .resolves.toMatchObject({ ok: false, reason: RUN_RESUME_REFUSALS.NOT_PAUSED });

      const paused = await startRun();
      await pauseRun(deps(), { session, request: { runId: paused } });
      const waitId = await honourPause(paused);
      const [pausedRun] = await sql`SELECT revision FROM audit_run WHERE run_id=${paused}`;
      const answered = await answerEscalation(deps(), {
        session,
        request: { runId: paused, waitId, expectedRunRevision: Number(pausedRun!.revision), answerOptionId: ESCALATION_OPTION_IDS.resume, note: null },
      });
      expect(answered).toMatchObject({ ok: false, code: 'unknown' });
      const [wait] = await sql`SELECT closed_at FROM run_wait WHERE wait_id=${waitId}`;
      expect(wait?.closed_at).toBeNull();
    });
  });

  describe('the thirty-minute deadline', () => {
    /**
     * A wait's deadline is IMMUTABLE — generation 34 refuses an update to it — so an
     * overdue wait is made by opening one in the past rather than by backdating a row.
     * That is also the honest shape: this is a pause somebody left an hour ago.
     */
    it('is found by the recovery read and ends the Run Inconclusive with a Result', async () => {
      const runId = await startRun();
      const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      await pauseRun(deps(anHourAgo), { session, request: { runId } });
      const waitId = await honourPause(runId, anHourAgo);

      // The sweep's own read: a paused Run past its deadline has to be selectable, or a
      // paused Run is one nothing would ever end.
      const recoverable = await new PostgresWaitRepository(db).recoverableWaits(100);
      expect(recoverable.map((row) => row.waitId)).toContain(waitId);

      const woken = await wakeEscalation(
        { repository: new PostgresWaitRepository(db), clock: new SystemClock() },
        { schemaVersion: 1, runId, waitId },
      );
      expect(woken).toMatchObject({ ok: true, status: 'timed-out' });

      const [run] = await sql`SELECT state FROM audit_run WHERE run_id=${runId}`;
      expect(run).toMatchObject({ state: 'INCONCLUSIVE' });
      const [wait] = await sql`SELECT closure_kind, actor FROM run_wait WHERE wait_id=${waitId}`;
      expect(wait).toMatchObject({ closure_kind: 'timeout', actor: 'wait-wake' });
      // CompleteRun owns the terminal Result and the seal on this path as on every other.
      const [result] = await sql`SELECT outcome, run_state FROM run_result WHERE run_id=${runId}`;
      expect(result).toMatchObject({ run_state: 'INCONCLUSIVE' });
    });

    it('is thirty minutes and not the Escalation window, on the durable row', async () => {
      const paused = await startRun();
      await pauseRun(deps(), { session, request: { runId: paused } });
      const pauseWaitId = await honourPause(paused);
      const escalated = await startRun();
      const raised = await raiseEscalation(
        { repository: new PostgresWaitRepository(db), ids, clock: new FixedClock(baseNow) },
        { runId: escalated, kind: 'retry-or-skip', stepId: 'step-1' },
      );
      expect(raised.ok).toBe(true);

      const [pauseRow] = await sql`SELECT opened_at, deadline FROM run_wait WHERE wait_id=${pauseWaitId}`;
      const [escalationRow] = await sql`SELECT opened_at, deadline FROM run_wait WHERE wait_id=${raised.ok ? raised.wait.waitId : ''}`;
      const window = (row: Record<string, unknown>): number =>
        new Date(row.deadline as string).getTime() - new Date(row.opened_at as string).getTime();
      expect(window(pauseRow!)).toBe(30 * 60 * 1000);
      expect(window(escalationRow!)).toBe(4 * 60 * 60 * 1000);
    });
  });

  describe('a pause no boundary reached', () => {
    it('is recorded as superseded when the Run ends, and the outcome stands', async () => {
      const runId = await startRun();
      await pauseRun(deps(), { session, request: { runId } });
      // The Run reaches a terminal state through the Escalation timeout path without any
      // Tool Action boundary ever honouring the request. The Escalation is raised five
      // hours ago so its own four-hour deadline is already past.
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
      const raised = await raiseEscalation(
        { repository: new PostgresWaitRepository(db), ids, clock: new FixedClock(fiveHoursAgo) },
        { runId, kind: 'retry-or-skip', stepId: 'step-1' },
      );
      expect(raised.ok).toBe(true);
      const waitId = raised.ok ? raised.wait.waitId : '';
      await wakeEscalation(
        { repository: new PostgresWaitRepository(db), clock: new SystemClock() },
        { schemaVersion: 1, runId, waitId },
      );

      const events = await sql`SELECT event_type, payload FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.pause-superseded'`;
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({ requestedBy: author, state: 'INCONCLUSIVE' });
      const [run] = await sql`SELECT state, pause_requested_by FROM audit_run WHERE run_id=${runId}`;
      // The marker stays as the record of who asked; the Run's own outcome stands.
      expect(run).toMatchObject({ state: 'INCONCLUSIVE', pause_requested_by: author });
    });

    it('is NOT recorded when the pause really was honoured', async () => {
      const runId = await startRun();
      const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      await pauseRun(deps(anHourAgo), { session, request: { runId } });
      const waitId = await honourPause(runId, anHourAgo);
      await wakeEscalation(
        { repository: new PostgresWaitRepository(db), clock: new SystemClock() },
        { schemaVersion: 1, runId, waitId },
      );

      const events = await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.pause-superseded'`;
      expect(events).toHaveLength(0);
      const [run] = await sql`SELECT state, pause_requested_at FROM audit_run WHERE run_id=${runId}`;
      expect(run).toMatchObject({ state: 'INCONCLUSIVE', pause_requested_at: null });
    });
  });
});
