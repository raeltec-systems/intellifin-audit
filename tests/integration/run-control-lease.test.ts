import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acquireRunControlLease, releaseRunControlLease, renewRunControlLease,
  initiateRun, pauseRun, performPause, resumeRun, cancelRun, type AuditUnitOfWork,
} from '@intellifin/application';
import {
  createDb, createSqlClient, createAuditEventWriter, CryptoUuidV7Generator,
  DrizzleRoleRepository, PostgresProceduresUnitOfWork, PostgresRunControlLeaseRepository,
  PostgresRunsUnitOfWork, PostgresWaitRepository, PostgresRunCancellationRepository, readRunControlLease, SystemClock,
  type Database, type Sql, type Transaction,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * Where the simulated worker boundary holds the Run (Story 10.6, legacy 5.4): before a
 * Run-level Session Step (the fixture plan's `session-3`), with no attempt in flight.
 */
const BOUNDARY_HOLD = { planStepId: 'session-3', workItemId: null, superseded: null } as const;

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('controller leases against PostgreSQL and existing Resume authority', () => {
  let client: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const actor = ids.next();
  const other = ids.next();
  const procedureId = ids.next();
  const versionId = ids.next();
  const runs: string[] = [];
  const session = { userId: actor, sessionId: `${actor}-control` };
  const otherSession = { userId: other, sessionId: `${other}-control` };

  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1)))
      throw new Error('Controller tests require an isolated local or CI database');
    client = createSqlClient(url!, { max: 8 }); db = createDb(client);
    await client`INSERT INTO auth_user(id,name,email) VALUES (${actor},'Controller auditor',${actor+'@test.invalid'}),(${other},'Second controller auditor',${other+'@test.invalid'})`;
    await client`INSERT INTO user_role(user_id,role) VALUES (${actor},'auditor'),(${other},'auditor')`;
    const version = activeRunVersion(procedureId, versionId, actor);
    await new PostgresProceduresUnitOfWork(db).execute(async context => {
      await context.procedures.insertProcedure(version); await context.procedures.insertVersion(version);
    });
  });

  afterAll(async () => {
    if (!client) return;
    try {
      for (const runId of runs) await client.begin(async tx => {
        await tx`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
        await tx`DELETE FROM notification WHERE run_id=${runId}`;
        await tx`DELETE FROM run_wait WHERE run_id=${runId}`;
        await tx`DELETE FROM run_result WHERE run_id=${runId}`;
        await tx`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM run_initiation_request WHERE run_id=${runId} OR refused_run_id=${runId}`;
        // The retained fence can only disappear with its Run, never as lease cleanup.
        await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
      });
      await client`DELETE FROM run_initiation_request WHERE initiator_id IN (${actor},${other})`;
      await client`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await client`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await client`DELETE FROM user_role WHERE user_id IN (${actor},${other})`;
      await client`DELETE FROM auth_user WHERE id IN (${actor},${other})`;
    } finally { await client.end({ timeout: 5 }); }
  });

  function leaseDeps(transaction?: Transaction, allowEnrollment = true) {
    const connection = transaction ?? db;
    const unitOfWork: AuditUnitOfWork = transaction
      ? { execute: work => work({ auditEvents: createAuditEventWriter(transaction, new SystemClock(), ids) }) }
      : new PostgresRunsUnitOfWork(db);
    return { roles: new DrizzleRoleRepository(connection), unitOfWork,
      repository: new PostgresRunControlLeaseRepository(connection), ids, allowEnrollment };
  }
  const waitDeps = () => ({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db),
    repository: new PostgresWaitRepository(db), ids, clock: new SystemClock() });

  async function start(state: 'RUNNING' | 'QUEUED' = 'RUNNING'): Promise<string> {
    const month = String((runs.length % 12) + 1).padStart(2, '0');
    const year = 2026 + Math.floor(runs.length / 12);
    const outcome = await initiateRun(waitDeps(), { session, request: {
      procedureId, requestToken: ids.next(), period: { from: `${year}-${month}-01`, to: `${year}-${month}-28` },
    } });
    if (!outcome.ok) throw new Error(outcome.reason);
    runs.push(outcome.runId);
    await client`UPDATE audit_run SET state=${state} WHERE run_id=${outcome.runId}`;
    return outcome.runId;
  }

  it('serializes two eligible acquirers to one holder and preserves the released fence', async () => {
    const runId = await start();
    const request = { runId, expectedEpoch: 0 };
    const results = await Promise.all([
      acquireRunControlLease(leaseDeps(), { session, request }),
      acquireRunControlLease(leaseDeps(), { session: otherSession, request }),
    ]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toMatchObject([{ code: 'stale-epoch' }]);
    const [stored] = await client`SELECT epoch,holder_id FROM run_control_lease WHERE run_id=${runId}`;
    expect(stored!.epoch).toBe(1);
    const holder = stored!.holder_id === actor ? session : otherSession;
    expect(await renewRunControlLease(leaseDeps(), { session: holder, request: { runId, expectedEpoch: 1, requestKey: ids.next() } })).toMatchObject({ ok: true, lease: { epoch: 1 } });
    expect(await releaseRunControlLease(leaseDeps(), { session: holder, request: { runId, expectedEpoch: 1 } })).toMatchObject({ ok: true, lease: { epoch: 2, holderId: null } });
    await expect(client`DELETE FROM run_control_lease WHERE run_id=${runId}`).rejects.toMatchObject({ code: '23514' });
    const read = await readRunControlLease(db, { runId, actorId: actor, requiredForUnenrolledRun: false });
    expect(read).toMatchObject({ status: 'ready', required: true, epoch: 2, holderName: null });
    expect(await client`SELECT event_type FROM audit_events WHERE aggregate_id=${runId} AND event_type LIKE 'lifecycle.run-control-%' ORDER BY sequence`).toMatchObject([
      { event_type: 'lifecycle.run-control-lease-acquired' },
      { event_type: 'lifecycle.run-control-lease-renewed' },
      { event_type: 'lifecycle.run-control-lease-released' },
    ]);
  });

  it('fences stale same-actor Resume after release/reacquisition, including mode-off fallback', async () => {
    const runId = await start();
    expect(await acquireRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 0 } })).toMatchObject({ ok: true });
    // Safety authority remains independent of who controls discretionary Resume.
    expect(await pauseRun(waitDeps(), { session: otherSession, request: { runId } })).toMatchObject({ ok: true });
    await client`DELETE FROM user_role WHERE user_id=${other}`;
    try {
      await new PostgresWaitRepository(db).transaction(runId, async context => {
        const run = context.run!;
        await context.saveRunState('PAUSED');
        await performPause(context as never, { run, request: run.pauseRequest!, waitId: ids.next(), at: new Date().toISOString(), hold: BOUNDARY_HOLD });
      });
    } finally { await client`INSERT INTO user_role(user_id,role) VALUES (${other},'auditor')`; }
    const [before] = await client`SELECT revision FROM audit_run WHERE run_id=${runId}`;
    expect(await releaseRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 1 } })).toMatchObject({ ok: true });
    expect(await acquireRunControlLease(leaseDeps(undefined, false), { session, request: { runId, expectedEpoch: 2 } })).toMatchObject({ ok: true, lease: { epoch: 3 } });
    const request = { runId, expectedRunRevision: Number(before!.revision) };
    expect(await resumeRun({ ...waitDeps(), requireControllerLease: false }, { session, request: { ...request, expectedControlEpoch: 1 } })).toMatchObject({ ok: false, code: 'stale-control' });
    expect(await resumeRun({ ...waitDeps(), requireControllerLease: false }, { session, request })).toMatchObject({ ok: false, code: 'control-required' });
    expect(await client`SELECT state,revision FROM audit_run WHERE run_id=${runId}`).toMatchObject([{ state: 'PAUSED', revision: before!.revision }]);
    expect(await resumeRun({ ...waitDeps(), requireControllerLease: false }, { session, request: { ...request, expectedControlEpoch: 3 } })).toMatchObject({ ok: true });
    expect(await client`SELECT payload FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-resumed'`).toMatchObject([{ payload: { controlEpoch: 3 } }]);
  });

  it('materializes expiry without reviving ownership and never regresses the stored epoch', async () => {
    const runId = await start();
    // Deliberate expired-state fixture; the command still uses actual PostgreSQL time.
    await client`WITH stamp AS (SELECT clock_timestamp() AS at)
      INSERT INTO run_control_lease(run_id,epoch,holder_id,updated_at,expires_at)
      SELECT ${runId}::uuid,1,${actor},at-interval '121 seconds',at-interval '1 second' FROM stamp`;
    expect(await renewRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 1, requestKey: ids.next() } })).toMatchObject({ ok: false, code: 'expired' });
    expect(await client`SELECT epoch,holder_id FROM run_control_lease WHERE run_id=${runId}`).toMatchObject([{ epoch: 2, holder_id: null }]);
    expect(await acquireRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 1 } })).toMatchObject({ ok: false, code: 'stale-epoch' });
    expect(await acquireRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 2 } })).toMatchObject({ ok: true, lease: { epoch: 3 } });
    await expect(client`UPDATE run_control_lease SET epoch=1 WHERE run_id=${runId}`).rejects.toMatchObject({ code: '23514' });
    await client`DELETE FROM user_role WHERE user_id=${actor}`;
    try {
      expect(await renewRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 3, requestKey: ids.next() } })).toMatchObject({ ok: false, code: 'unauthorized' });
    } finally { await client`INSERT INTO user_role(user_id,role) VALUES (${actor},'auditor')`; }
  });

  it('rolls back the lease, event and notification transaction when the outer operation aborts', async () => {
    const runId = await start();
    await expect(db.transaction(async tx => {
      expect(await acquireRunControlLease(leaseDeps(tx), { session, request: { runId, expectedEpoch: 0 } })).toMatchObject({ ok: true });
      throw new Error('rollback-control-lease');
    })).rejects.toThrow('rollback-control-lease');
    expect(await client`SELECT epoch FROM run_control_lease WHERE run_id=${runId}`).toHaveLength(0);
    expect(await client`SELECT event_id FROM audit_events WHERE aggregate_id=${runId} AND event_type LIKE 'lifecycle.run-control-%'`).toHaveLength(0);
    expect(await acquireRunControlLease(leaseDeps(undefined, false), { session, request: { runId, expectedEpoch: 0 } })).toMatchObject({ ok: false, code: 'disabled' });
  });

  it('samples expiry after waiting for the real Run lock, rather than at transaction start', async () => {
    const runId = await start();
    await client`WITH stamp AS (SELECT clock_timestamp() AS at)
      INSERT INTO run_control_lease(run_id,epoch,holder_id,updated_at,expires_at)
      SELECT ${runId}::uuid,1,${other},at,at+interval '3 seconds' FROM stamp`;
    let announceLock!: (pid: number) => void;
    const locked = new Promise<number>(resolve => { announceLock = resolve; });
    let releaseLock!: () => void;
    const released = new Promise<void>(resolve => { releaseLock = resolve; });
    const holding = client.begin(async tx => {
      const [row] = await tx`SELECT pg_backend_pid() AS pid FROM audit_run WHERE run_id=${runId} FOR UPDATE`;
      announceLock(Number(row!.pid));
      await released;
    });
    const ownerPid = await locked;
    const pending = acquireRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 1 } });
    try {
      // Prove the application transaction actually began while the old lease was live
      // and is blocked behind this exact owner, instead of merely running a delayed call.
      await expect.poll(async () => {
        const [row] = await client`SELECT count(*)::int AS n FROM pg_stat_activity a
          JOIN run_control_lease l ON l.run_id=${runId}
          WHERE ${ownerPid} = ANY(pg_blocking_pids(a.pid)) AND a.xact_start < l.expires_at`;
        return Number(row!.n);
      }, { timeout: 2000 }).toBe(1);
      await client`SELECT pg_sleep(greatest(0, extract(epoch FROM (expires_at-clock_timestamp()))) + 0.05)
        FROM run_control_lease WHERE run_id=${runId}`;
      releaseLock();
      expect(await pending).toMatchObject({ ok: true, lease: { holderId: actor, epoch: 3 } });
    } finally { releaseLock(); await holding; await pending; }
  });
  it('recovers concurrent duplicate renewals without another expiry/event, reauthorizes and refuses changed meaning', async () => {
    const runId = await start();
    await acquireRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 0 } });
    const request = { runId, expectedEpoch: 1, requestKey: ids.next() };
    const [first, duplicate] = await Promise.all([
      renewRunControlLease(leaseDeps(), { session, request }),
      renewRunControlLease(leaseDeps(), { session, request }),
    ]);
    expect(first).toMatchObject({ ok: true, operation: 'renew', receipt: { requestKey: request.requestKey, expectedEpoch: 1 } });
    expect(duplicate).toEqual(first);
    const stored = await client`SELECT * FROM run_control_lease WHERE run_id=${runId}`;
    expect(await renewRunControlLease(leaseDeps(), { session, request })).toEqual(first);
    expect(await client`SELECT * FROM run_control_lease WHERE run_id=${runId}`).toEqual(stored);
    expect(await renewRunControlLease(leaseDeps(), { session, request: { ...request, expectedEpoch: 99 } }))
      .toMatchObject({ code: 'conflict' });
    expect(await releaseRunControlLease(leaseDeps(), { session, request })).toMatchObject({ code: 'malformed' });
    await releaseRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 1 } });
    await acquireRunControlLease(leaseDeps(), { session: otherSession, request: { runId, expectedEpoch: 2 } });
    expect(await renewRunControlLease(leaseDeps(), { session, request })).toEqual(first);
    expect(await readRunControlLease(db, { runId, actorId: actor, requiredForUnenrolledRun: true }))
      .toMatchObject({ heldByYou: false, epoch: 3 });
    await client`DELETE FROM user_role WHERE user_id=${actor}`;
    try {
      expect(await renewRunControlLease(leaseDeps(), { session, request })).toMatchObject({ code: 'unauthorized' });
    } finally { await client`INSERT INTO user_role(user_id,role) VALUES (${actor},'auditor')`; }
    expect(await client`SELECT event_id FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-control-lease-renewed'`).toHaveLength(1);
  });

  it('rolls back a renewal receipt with its extension and permits the exact request after rollback', async () => {
    const runId = await start();
    await acquireRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 0 } });
    const before = await client`SELECT * FROM run_control_lease WHERE run_id=${runId}`;
    const request = { runId, expectedEpoch: 1, requestKey: ids.next() };
    await expect(db.transaction(async tx => {
      expect(await renewRunControlLease(leaseDeps(tx), { session, request })).toMatchObject({ ok: true });
      throw new Error('rollback-renewal');
    })).rejects.toThrow('rollback-renewal');
    expect(await client`SELECT * FROM run_control_lease WHERE run_id=${runId}`).toEqual(before);
    expect(await client`SELECT event_id FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-control-lease-renewed'`).toHaveLength(0);
    expect(await renewRunControlLease(leaseDeps(), { session, request })).toMatchObject({ ok: true });
  });

  it('scopes a repeated request key independently to its actor and Run', async () => {
    const runId = await start();
    const secondRunId = await start();
    const requestKey = ids.next();
    await acquireRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 0 } });
    const first = await renewRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 1, requestKey } });
    await releaseRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 1 } });
    await acquireRunControlLease(leaseDeps(), { session: otherSession, request: { runId, expectedEpoch: 2 } });
    const secondActor = await renewRunControlLease(leaseDeps(), { session: otherSession, request: { runId, expectedEpoch: 3, requestKey } });
    await acquireRunControlLease(leaseDeps(), { session, request: { runId: secondRunId, expectedEpoch: 0 } });
    const secondRun = await renewRunControlLease(leaseDeps(), { session, request: { runId: secondRunId, expectedEpoch: 1, requestKey } });
    expect(first).toMatchObject({ ok: true, lease: { runId, holderId: actor, epoch: 1 } });
    expect(secondActor).toMatchObject({ ok: true, lease: { runId, holderId: other, epoch: 3 } });
    expect(secondRun).toMatchObject({ ok: true, lease: { runId: secondRunId, holderId: actor, epoch: 1 } });
    for (const [owner, selectedRun, epoch, original] of [
      [session, runId, 1, first], [otherSession, runId, 3, secondActor], [session, secondRunId, 1, secondRun],
    ] as const) {
      expect(await renewRunControlLease(leaseDeps(), { session: owner, request: { runId: selectedRun, expectedEpoch: epoch, requestKey } })).toEqual(original);
    }
    const events = await client`SELECT event_id FROM audit_events WHERE aggregate_id IN (${runId},${secondRunId})
      AND event_type='lifecycle.run-control-lease-renewed' AND payload->>'requestKey'=${requestKey}`;
    expect(events).toHaveLength(3);
    expect(new Set(events.map(event => event.event_id)).size).toBe(3);
  });

  it('binds every renewal snapshot when several transitions commit in one outer transaction', async () => {
    const runId = await start();
    await acquireRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 0 } });
    const requests = [1, 1, 3].map(expectedEpoch => ({ runId, expectedEpoch, requestKey: ids.next() }));
    const outcomes = await db.transaction(async tx => {
      const first = await renewRunControlLease(leaseDeps(tx), { session, request: requests[0] });
      const second = await renewRunControlLease(leaseDeps(tx), { session, request: requests[1] });
      expect(await releaseRunControlLease(leaseDeps(tx), { session, request: { runId, expectedEpoch: 1 } })).toMatchObject({ ok: true });
      expect(await acquireRunControlLease(leaseDeps(tx), { session, request: { runId, expectedEpoch: 2 } })).toMatchObject({ ok: true });
      const third = await renewRunControlLease(leaseDeps(tx), { session, request: requests[2] });
      return [first, second, third];
    });
    for (const [index, request] of requests.entries()) {
      expect(outcomes[index]).toMatchObject({ ok: true });
      expect(await renewRunControlLease(leaseDeps(), { session, request })).toEqual(outcomes[index]);
    }
    expect(await client`SELECT epoch,holder_id FROM run_control_lease WHERE run_id=${runId}`).toEqual([{ epoch: 3, holder_id: actor }]);
    expect(await client`SELECT event_id FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-control-lease-renewed'`).toHaveLength(3);
  });

  it('refuses an intermediate renewal without a receipt even when the transaction later releases control', async () => {
    const runId = await start();
    await acquireRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 0 } });
    const before = await client`SELECT * FROM run_control_lease WHERE run_id=${runId}`;
    await expect(client.begin(async tx => {
      await tx`SELECT run_id FROM audit_run WHERE run_id=${runId} FOR UPDATE`;
      await tx`UPDATE run_control_lease SET renewal_request_key=${ids.next()}::uuid WHERE run_id=${runId}`;
      await tx`UPDATE run_control_lease SET epoch=epoch+1,holder_id=NULL,expires_at=NULL,
        renewal_request_key=NULL,updated_at=clock_timestamp() WHERE run_id=${runId}`;
    })).rejects.toMatchObject({ code: '23514' });
    expect(await client`SELECT * FROM run_control_lease WHERE run_id=${runId}`).toEqual(before);
  });

  it('recovers a historical renewal after terminalization without restoring control', async () => {
    const runId = await start('QUEUED');
    await acquireRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 0 } });
    const request = { runId, expectedEpoch: 1, requestKey: ids.next() };
    const original = await renewRunControlLease(leaseDeps(), { session, request });
    expect(original).toMatchObject({ ok: true });
    const before = await client`SELECT * FROM run_control_lease WHERE run_id=${runId}`;
    expect(await cancelRun({ ...waitDeps(), repository: new PostgresRunCancellationRepository(db) },
      { session, request: { runId, reason: null } })).toMatchObject({ ok: true, state: 'CANCELED', pending: false });
    expect(await renewRunControlLease(leaseDeps(), { session, request })).toEqual(original);
    expect(await renewRunControlLease(leaseDeps(), { session, request: { ...request, requestKey: ids.next() } })).toMatchObject({ code: 'terminal' });
    expect(await readRunControlLease(db, { runId, actorId: actor, requiredForUnenrolledRun: true })).toMatchObject({ active: false, heldByYou: false });
    expect(await client`SELECT * FROM run_control_lease WHERE run_id=${runId}`).toEqual(before);
  });

  it('recovers its original receipt after the actual PostgreSQL lease deadline elapses', async () => {
    const runId = await start();
    await acquireRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 0 } });
    const request = { runId, expectedEpoch: 1, requestKey: ids.next() };
    const original = await renewRunControlLease(leaseDeps(), { session, request });
    expect(original).toMatchObject({ ok: true });
    const before = await client`SELECT * FROM run_control_lease WHERE run_id=${runId}`;
    // No shortened duration, fake clock or forged historical event: this also proves
    // recovery before expiry materialization, where today's epoch alone is misleading.
    await client`SELECT pg_sleep(greatest(0, extract(epoch FROM (expires_at-clock_timestamp()))) + 0.05)
      FROM run_control_lease WHERE run_id=${runId}`;
    expect(await readRunControlLease(db, { runId, actorId: actor, requiredForUnenrolledRun: true })).toMatchObject({ heldByYou: false, holderName: null, expiresAt: null });
    expect(await renewRunControlLease(leaseDeps(), { session, request })).toEqual(original);
    expect(await client`SELECT * FROM run_control_lease WHERE run_id=${runId}`).toEqual(before);
    expect(await renewRunControlLease(leaseDeps(), { session, request: { ...request, requestKey: ids.next() } })).toMatchObject({ code: 'expired' });
    expect(await renewRunControlLease(leaseDeps(), { session, request })).toEqual(original);
    expect(await client`SELECT epoch,holder_id FROM run_control_lease WHERE run_id=${runId}`).toEqual([{ epoch: 2, holder_id: null }]);
    expect(await client`SELECT event_id FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-control-lease-renewed'`).toHaveLength(1);
  }, 150_000);

  it('rejects forged, mutable, missing and recycled durable receipt identities in PostgreSQL', async () => {
    const runId = await start();
    await acquireRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 0 } });
    await expect(client`UPDATE run_control_lease SET updated_at=updated_at,expires_at=expires_at WHERE run_id=${runId}`)
      .rejects.toMatchObject({ code: '23514' });
    const request = { runId, expectedEpoch: 1, requestKey: ids.next() };
    const outcome = await renewRunControlLease(leaseDeps(), { session, request });
    if (!outcome.ok || !outcome.receipt) throw new Error('Renewal receipt missing');
    const eventId = outcome.receipt.eventId;
    await expect(client`UPDATE audit_events SET payload=payload||'{}'::jsonb WHERE event_id=${eventId}`)
      .rejects.toMatchObject({ code: '23514' });
    await expect(client`DELETE FROM audit_events WHERE event_id=${eventId}`).rejects.toMatchObject({ code: '23514' });
    const clone = (patch: Record<string, string | number | boolean>, actorType = 'human', source = 'web', outcome = 'success', sessionId = session.sessionId, aggregateId = runId) => client`
      INSERT INTO audit_events(event_id,actor_type,actor_id,event_type,occurred_at,source,outcome,session_id,
        correlation_id,aggregate_id,sequence,payload,previous_hash,event_hash)
      SELECT ${ids.next()}::uuid,${actorType},actor_id,event_type,occurred_at,${source},${outcome},${sessionId},
        correlation_id,${aggregateId},sequence+100,payload||${JSON.stringify(patch)}::jsonb,previous_hash,event_hash
      FROM audit_events WHERE event_id=${eventId}`;
    await expect(clone({ requestKey: ids.next() })).rejects.toMatchObject({ code: '23514' });
    await expect(clone({ expectedEpoch: '1' })).rejects.toMatchObject({ code: '23514' });
    await expect(clone({ expiresAt: '2099-01-01T00:00:00.000Z' })).rejects.toMatchObject({ code: '23514' });
    await expect(clone({ unexpected: true })).rejects.toMatchObject({ code: '23514' });
    await expect(clone({}, 'system')).rejects.toMatchObject({ code: '23514' });
    await expect(clone({}, 'human', 'worker')).rejects.toMatchObject({ code: '23514' });
    await expect(clone({}, 'human', 'web', 'failure')).rejects.toMatchObject({ code: '23514' });
    await expect(clone({}, 'human', 'web', 'success', '')).rejects.toMatchObject({ code: '23514' });
    await expect(clone({}, 'human', 'web', 'success', session.sessionId, 'not-a-run')).rejects.toMatchObject({ code: '23514' });
    await expect(clone({}, 'human', 'web', 'success', session.sessionId, ids.next())).rejects.toMatchObject({ code: '23514' });
    await expect(clone({})).rejects.toMatchObject({ code: '23505' });
    await expect(client`INSERT INTO audit_events(event_id,actor_type,actor_id,event_type,occurred_at,source,outcome,session_id,
      correlation_id,aggregate_id,sequence,payload,previous_hash,event_hash)
      SELECT ${ids.next()}::uuid,actor_type,actor_id,event_type,occurred_at,source,outcome,session_id,
        correlation_id,aggregate_id,sequence+100,payload-'requestKey',previous_hash,event_hash
      FROM audit_events WHERE event_id=${eventId}`).rejects.toMatchObject({ code: '23514' });
    await expect(client`UPDATE run_control_lease SET renewal_request_key=${ids.next()}::uuid WHERE run_id=${runId}`)
      .rejects.toMatchObject({ code: '23514' });
    await expect(client`UPDATE run_control_lease SET renewal_request_key=NULL WHERE run_id=${runId}`)
      .rejects.toMatchObject({ code: '23514' });
    expect(await renewRunControlLease(leaseDeps(), { session, request })).toEqual(outcome);
  });

});
