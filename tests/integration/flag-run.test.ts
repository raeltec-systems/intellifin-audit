import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RUN_FLAG_REFUSALS } from '@intellifin/domain';
import {
  deliverNotifications,
  flagRun,
  initiateRun,
  type Clock,
} from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleNotificationRepository,
  DrizzleRoleRepository,
  InAppNotificationSender,
  PostgresProceduresUnitOfWork,
  PostgresRunFlagRepository,
  PostgresRunsUnitOfWork,
  SystemClock,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * Story 5.5's database boundary: flagging a Run against a real PostgreSQL 18.
 *
 * The application tests exercise the refusal matrix with an in-memory context. These cases
 * exercise what those cannot see: generation 46's CHECKs and its immutability trigger, the
 * three-arm notification context CHECK that keeps a flag and an Escalation from being
 * mistaken for one another, the delivery path recording both channels for a kind that has
 * no wait to lock, and the inbox and bell counting an open flag while its Run is active and
 * not one moment longer.
 */
const url = process.env.DATABASE_URL;

class FixedClock implements Clock {
  constructor(private readonly value: Date) {}
  now(): Date { return new Date(this.value); }
}

describe.skipIf(!url)('flagging a Run to the Audit Managers', () => {
  let sql: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const author = ids.next();
  // A SECOND auditor, never an audit-manager: `runNotificationRecipients` reads every
  // audit-manager in the database, so a file that adds one changes what a concurrently
  // running file sees.
  const other = ids.next();
  const procedureId = ids.next();
  const versionId = ids.next();
  const runIds: string[] = [];
  const session = { userId: author, sessionId: `${author}-flag-session` };
  const otherSession = { userId: other, sessionId: `${other}-flag-session` };
  const baseNow = new Date('2026-09-10T09:00:00.000Z');

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))
    ) {
      throw new Error('Flag tests require an isolated local or CI test database');
    }
    sql = createSqlClient(url!, { max: 8 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'Flag test',${author + '@test.invalid'})`;
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${other},'Flag second auditor',${other + '@test.invalid'})`;
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
        await sql`DELETE FROM pgboss.job WHERE name='runs' AND data->>'runId'=${runId}`;
        await sql`DELETE FROM notification WHERE run_id=${runId}`;
        // `run_flag` cascades from `audit_run`, but the notification rows point AT it, so
        // they have to go first whatever the cascade says.
        await sql`DELETE FROM run_flag WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result WHERE run_id=${runId}`;
        await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM run_initiation_request WHERE run_id=${runId} OR refused_run_id=${runId}`;
      }
      await sql`DELETE FROM run_initiation_request WHERE initiator_id IN (${author},${other})`;
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
  async function startRun(state = 'RUNNING'): Promise<string> {
    const month = String((period % 12) + 1).padStart(2, '0');
    const year = 2030 + Math.floor(period / 12);
    period += 1;
    const result = await initiateRun(
      { roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock: new SystemClock() },
      { session, request: { procedureId, period: { from: `${year}-${month}-01`, to: `${year}-${month}-28` }, requestToken: ids.next() } },
    );
    if (!result.ok) throw new Error(result.reason);
    runIds.push(result.runId);
    if (state !== 'QUEUED') await sql`UPDATE audit_run SET state=${state} WHERE run_id=${result.runId}`;
    return result.runId;
  }

  function deps(now = baseNow) {
    return {
      roles: new DrizzleRoleRepository(db),
      unitOfWork: new PostgresRunsUnitOfWork(db),
      repository: new PostgresRunFlagRepository(db),
      ids,
      clock: new FixedClock(now),
    };
  }

  it('stores one flag, its notifications and its event in one transaction', async () => {
    const runId = await startRun();
    const outcome = await flagRun(deps(), { session, request: { runId, note: 'Check the LoanCore step.' } });
    expect(outcome.ok).toBe(true);

    const [flag] = await sql`SELECT * FROM run_flag WHERE run_id=${runId}`;
    expect(flag).toMatchObject({ flagged_by: author, session_id: session.sessionId, note: 'Check the LoanCore step.' });

    const notifications = await sql`SELECT * FROM notification WHERE run_id=${runId} ORDER BY send_key`;
    // The initiator is the only recipient here: this file adds no Audit Manager.
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      kind: 'flag', recipient_id: author, flag_id: flag!.flag_id, wait_id: null, escalation_kind: null, deadline: null,
    });
    // A notification row carries the identity and nothing else. The note stays on the Run.
    expect(JSON.stringify(notifications[0])).not.toContain('LoanCore');

    const events = await sql`SELECT event_type, payload FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-flagged'`;
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ flagId: flag!.flag_id, state: 'RUNNING', noteLength: 'Check the LoanCore step.'.length });
    expect(JSON.stringify(events[0]!.payload)).not.toContain('LoanCore');
  });

  it('changes nothing about the Run', async () => {
    const runId = await startRun();
    const [before] = await sql`SELECT * FROM audit_run WHERE run_id=${runId}`;
    await flagRun(deps(), { session, request: { runId, note: null } });
    const [after] = await sql`SELECT * FROM audit_run WHERE run_id=${runId}`;
    // Not "the state is unchanged" but "the WHOLE ROW is", revision included: a flag that
    // moved the revision would refuse the next resume against a state nobody changed.
    expect(after).toEqual(before);
    expect(await sql`SELECT count(*)::int AS c FROM run_execution WHERE run_id=${runId}`).toEqual([{ c: 0 }]);
  });

  it('records a second flag beside the first rather than replacing it', async () => {
    const runId = await startRun();
    await flagRun(deps(), { session, request: { runId, note: 'First look.' } });
    await flagRun(deps(new Date('2026-09-10T09:05:00.000Z')), { session: otherSession, request: { runId, note: 'Second look.' } });
    const flags = await sql`SELECT flagged_by, note FROM run_flag WHERE run_id=${runId} ORDER BY flagged_at`;
    expect(flags).toEqual([
      { flagged_by: author, note: 'First look.' },
      { flagged_by: other, note: 'Second look.' },
    ]);
  });

  it.each(['RUNNING', 'PAUSED', 'AWAITING_AUDITOR'])('flags a %s Run', async (state) => {
    const runId = await startRun(state);
    expect((await flagRun(deps(), { session, request: { runId, note: null } })).ok).toBe(true);
  });

  it('refuses a QUEUED Run and writes nothing at all', async () => {
    const runId = await startRun('QUEUED');
    const outcome = await flagRun(deps(), { session, request: { runId, note: 'no' } });
    expect(outcome).toEqual({ ok: false, reason: RUN_FLAG_REFUSALS.NOT_FLAGGABLE });
    expect(await sql`SELECT count(*)::int AS c FROM run_flag WHERE run_id=${runId}`).toEqual([{ c: 0 }]);
    expect(await sql`SELECT count(*)::int AS c FROM notification WHERE run_id=${runId}`).toEqual([{ c: 0 }]);
    expect(await sql`SELECT count(*)::int AS c FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-flagged'`).toEqual([{ c: 0 }]);
  });

  it('refuses a Run that does not exist', async () => {
    const outcome = await flagRun(deps(), { session, request: { runId: ids.next(), note: null } });
    expect(outcome).toEqual({ ok: false, reason: RUN_FLAG_REFUSALS.UNKNOWN });
  });

  describe('generation 46 refuses what no command may write', () => {
    it('makes a flag immutable', async () => {
      const runId = await startRun();
      await flagRun(deps(), { session, request: { runId, note: 'original' } });
      const [flag] = await sql`SELECT flag_id FROM run_flag WHERE run_id=${runId}`;
      await expect(sql`UPDATE run_flag SET note='rewritten' WHERE flag_id=${flag!.flag_id}`)
        .rejects.toThrow(/permanent and cannot be changed/);
      expect(await sql`SELECT note FROM run_flag WHERE flag_id=${flag!.flag_id}`).toEqual([{ note: 'original' }]);
    });

    it('refuses a blank note and an over-long one, while allowing an absent one', async () => {
      const runId = await startRun();
      const base = { flagId: ids.next(), runId, flaggedBy: author, sessionId: 'raw', flaggedAt: baseNow.toISOString() };
      await expect(sql`
        INSERT INTO run_flag(flag_id, run_id, flagged_by, session_id, flagged_at, note)
        VALUES (${base.flagId}, ${runId}, ${author}, 'raw', ${base.flaggedAt}::timestamptz, '   ')
      `).rejects.toThrow(/run_flag_note/);
      await expect(sql`
        INSERT INTO run_flag(flag_id, run_id, flagged_by, session_id, flagged_at, note)
        VALUES (${base.flagId}, ${runId}, ${author}, 'raw', ${base.flaggedAt}::timestamptz, ${'x'.repeat(501)})
      `).rejects.toThrow(/run_flag_note/);
      await sql`
        INSERT INTO run_flag(flag_id, run_id, flagged_by, session_id, flagged_at, note)
        VALUES (${base.flagId}, ${runId}, ${author}, 'raw', ${base.flaggedAt}::timestamptz, NULL)
      `;
      expect(await sql`SELECT note FROM run_flag WHERE flag_id=${base.flagId}`).toEqual([{ note: null }]);
    });

    it('refuses a flag notification that carries a wait, a kind or a deadline', async () => {
      const runId = await startRun();
      await flagRun(deps(), { session, request: { runId, note: null } });
      const [flag] = await sql`SELECT flag_id FROM run_flag WHERE run_id=${runId}`;
      const [run] = await sql`SELECT procedure_id, version_id FROM audit_run WHERE run_id=${runId}`;
      const insert = (columns: string, values: string) => sql.unsafe(
        `INSERT INTO notification (send_key, recipient_id, procedure_id, version_id, procedure_name, version_number, kind, run_id, flag_id${columns})
         VALUES ('${ids.next()}', '${author}', '${run!.procedure_id}', '${run!.version_id}', 'x', 1, 'flag', '${runId}', '${flag!.flag_id}'${values})`,
      );
      await expect(insert(', escalation_kind', ", 'choose-candidate'")).rejects.toThrow(/notification_context/);
      await expect(insert(', deadline', ", now()")).rejects.toThrow(/notification_context/);
      // And an ESCALATION may not carry a flag id, which is the same rule seen from the
      // other side: one arm per kind, so neither can be dressed as the other. Generation
      // 35's trigger reaches this row first — it checks the Escalation's wait binding —
      // so the refusal is asserted by ITS message rather than by the CHECK behind it.
      // Either way the row does not exist, which is what the rule promises.
      await expect(sql.unsafe(
        `INSERT INTO notification (send_key, recipient_id, procedure_id, version_id, procedure_name, version_number, kind, run_id, flag_id, escalation_kind, deadline)
         VALUES ('${ids.next()}', '${author}', '${run!.procedure_id}', '${run!.version_id}', 'x', 1, 'escalation', '${runId}', '${flag!.flag_id}', 'choose-candidate', now())`,
      )).rejects.toThrow(/Escalation notification context mismatch/);
      expect(await sql`SELECT count(*)::int AS c FROM notification WHERE run_id=${runId} AND kind='escalation'`).toEqual([{ c: 0 }]);
    });

    it('still refuses a Procedure Version notification that names a Run', async () => {
      const runId = await startRun();
      const [run] = await sql`SELECT procedure_id, version_id FROM audit_run WHERE run_id=${runId}`;
      await expect(sql.unsafe(
        `INSERT INTO notification (send_key, recipient_id, procedure_id, version_id, procedure_name, version_number, kind, run_id)
         VALUES ('${ids.next()}', '${author}', '${run!.procedure_id}', '${run!.version_id}', 'x', 1, 'submitted', '${runId}')`,
      )).rejects.toThrow(/notification_context/);
    });

    it('refuses a kind outside the five', async () => {
      const runId = await startRun();
      const [run] = await sql`SELECT procedure_id, version_id FROM audit_run WHERE run_id=${runId}`;
      await expect(sql.unsafe(
        `INSERT INTO notification (send_key, recipient_id, procedure_id, version_id, procedure_name, version_number, kind)
         VALUES ('${ids.next()}', '${author}', '${run!.procedure_id}', '${run!.version_id}', 'x', 1, 'invented')`,
      )).rejects.toThrow(/notification_kind/);
    });
  });

  it('delivers a flag on both channels and records each on the Audit Trail', async () => {
    const runId = await startRun();
    await flagRun(deps(), { session, request: { runId, note: null } });
    const repository = new DrizzleNotificationRepository(db);
    await deliverNotifications(
      { pending: async () => (await repository.pending(100)).filter((row) => 'runId' in row && row.runId === runId), deliveredFor: repository.deliveredFor.bind(repository) },
      new InAppNotificationSender(db),
    );
    const [row] = await sql`SELECT * FROM notification WHERE run_id=${runId}`;
    expect(row).toMatchObject({ in_app_outcome: 'delivered', email_outcome: 'unconfigured' });
    expect(row!.delivered_at).not.toBeNull();
    expect(row!.email_outcome_at).not.toBeNull();
    const deliveries = await sql`
      SELECT event_type, outcome, payload FROM audit_events
      WHERE aggregate_id=${runId} AND event_type IN ('notification.in-app-delivery','notification.email-delivery')
      ORDER BY sequence
    `;
    expect(deliveries).toHaveLength(2);
    for (const delivery of deliveries) {
      // The subject is named by the id this KIND has, and the other is null rather than
      // absent: "this delivery was not about a wait" is a fact.
      expect(delivery.payload).toMatchObject({ waitId: null, escalationKind: null });
      expect((delivery.payload as { flagId?: unknown }).flagId).toEqual(row!.flag_id);
    }
    // A replay records no second event.
    await deliverNotifications(
      { pending: async () => (await repository.pending(100)).filter((r) => 'runId' in r && r.runId === runId), deliveredFor: repository.deliveredFor.bind(repository) },
      new InAppNotificationSender(db),
    );
    expect(await sql`
      SELECT count(*)::int AS c FROM audit_events
      WHERE aggregate_id=${runId} AND event_type IN ('notification.in-app-delivery','notification.email-delivery')
    `).toEqual([{ c: 2 }]);
  });

  it('shows an open flag in the inbox and the bell while the Run is active, and not after', async () => {
    const runId = await startRun();
    await flagRun(deps(), { session, request: { runId, note: 'look here' } });
    const repository = new DrizzleNotificationRepository(db);

    const open = (await repository.openFor(session)).filter((row) => row.runId === runId);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: 'flag', runId, flaggedBy: author });
    // A flag has no deadline, and the shape says so rather than carrying a null one.
    expect(open[0]).not.toHaveProperty('deadline');
    expect(open[0]).not.toHaveProperty('waitId');

    const before = await repository.countOpenFor(session);
    // The Run ends. The flag stops needing attention, because nothing else ever closes one.
    // Generations 21 and 25 refuse a terminal Run with no sealed package and no Result, so
    // both go in first — two statements, because postgres.js autocommits each one and the
    // deferred trigger fires at the end of the second.
    await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
              VALUES(${runId},'SEALED','INCONCLUSIVE',now(),0,0,'[]'::jsonb,'[]'::jsonb)`;
    await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
              VALUES(${runId},1,'INCONCLUSIVE','gate-failed',true,'INCONCLUSIVE',false,now(),NULL,'{}'::jsonb)`;
    await sql`UPDATE audit_run SET state='INCONCLUSIVE' WHERE run_id=${runId}`;
    expect((await repository.openFor(session)).filter((row) => row.runId === runId)).toEqual([]);
    expect(await repository.countOpenFor(session)).toBe(before - 1);
  });

  it("keeps an open flag out of another auditor's inbox", async () => {
    const runId = await startRun();
    await flagRun(deps(), { session, request: { runId, note: null } });
    const repository = new DrizzleNotificationRepository(db);
    // `other` initiated nothing and is not an Audit Manager, so this Run is not theirs.
    expect((await repository.openFor(otherSession)).filter((row) => row.runId === runId)).toEqual([]);
  });
});
