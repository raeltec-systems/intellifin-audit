import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acquireRunControlLease, releaseRunControlLease, renewRunControlLease,
  initiateRun, pauseRun, performPause, resumeRun, type AuditUnitOfWork,
} from '@intellifin/application';
import {
  createDb, createSqlClient, createAuditEventWriter, CryptoUuidV7Generator,
  DrizzleRoleRepository, PostgresProceduresUnitOfWork, PostgresRunControlLeaseRepository,
  PostgresRunsUnitOfWork, PostgresWaitRepository, readRunControlLease, SystemClock,
  type Database, type Sql, type Transaction,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';

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
      for (const runId of runs) {
        await client`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
        await client`DELETE FROM notification WHERE run_id=${runId}`;
        await client`DELETE FROM run_wait WHERE run_id=${runId}`;
        await client`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await client`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await client`DELETE FROM run_initiation_request WHERE run_id=${runId} OR refused_run_id=${runId}`;
        // The retained fence can only disappear with its Run, never as lease cleanup.
        await client`DELETE FROM audit_run WHERE run_id=${runId}`;
      }
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

  async function start(): Promise<string> {
    const month = String((runs.length % 12) + 1).padStart(2, '0');
    const year = 2026 + Math.floor(runs.length / 12);
    const outcome = await initiateRun(waitDeps(), { session, request: {
      procedureId, requestToken: ids.next(), period: { from: `${year}-${month}-01`, to: `${year}-${month}-28` },
    } });
    if (!outcome.ok) throw new Error(outcome.reason);
    runs.push(outcome.runId);
    await client`UPDATE audit_run SET state='RUNNING' WHERE run_id=${outcome.runId}`;
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
    expect(await renewRunControlLease(leaseDeps(), { session: holder, request: { runId, expectedEpoch: 1 } })).toMatchObject({ ok: true, lease: { epoch: 1 } });
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
        await performPause(context as never, { run, request: run.pauseRequest!, waitId: ids.next(), at: new Date().toISOString() });
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
    expect(await renewRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 1 } })).toMatchObject({ ok: false, code: 'expired' });
    expect(await client`SELECT epoch,holder_id FROM run_control_lease WHERE run_id=${runId}`).toMatchObject([{ epoch: 2, holder_id: null }]);
    expect(await acquireRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 1 } })).toMatchObject({ ok: false, code: 'stale-epoch' });
    expect(await acquireRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 2 } })).toMatchObject({ ok: true, lease: { epoch: 3 } });
    await expect(client`UPDATE run_control_lease SET epoch=1 WHERE run_id=${runId}`).rejects.toMatchObject({ code: '23514' });
    await client`DELETE FROM user_role WHERE user_id=${actor}`;
    try {
      expect(await renewRunControlLease(leaseDeps(), { session, request: { runId, expectedEpoch: 3 } })).toMatchObject({ ok: false, code: 'unauthorized' });
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
});
