import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelRun, performCancellation, initiateRun } from '@intellifin/application';
import { createDb, createSqlClient, CryptoUuidV7Generator, DrizzleRoleRepository, PostgresProceduresUnitOfWork, PostgresRunsUnitOfWork,
  PostgresRunCancellationRepository, PostgresWorkspacePreviewStore, SystemClock, type Database, type Sql } from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';
const url = process.env.DATABASE_URL;
describe.skipIf(!url)('preview durable owner, privacy and viewer fences', () => {
  let client: Sql, db: Database;
  const ids = new CryptoUuidV7Generator(); const actor = ids.next(), procedureId = ids.next(), versionId = ids.next();
  const session = { userId: actor, sessionId: `${actor}-preview` }; const viewer = { actorId: actor, sessionId: session.sessionId }; const runs: string[] = [];
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) || !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))) throw new Error('Preview tests require an isolated local or CI database');
    client = createSqlClient(url!, { max: 5 }); db = createDb(client);
    await client`INSERT INTO auth_user(id,name,email) VALUES (${actor},'Preview auditor',${actor+'@test.invalid'})`;
    await client`INSERT INTO user_role(user_id,role) VALUES (${actor},'auditor')`;
    await client`INSERT INTO auth_session(id,user_id,token,expires_at) VALUES (${session.sessionId},${actor},${ids.next()},clock_timestamp()+interval '1 hour')`;
    const version = activeRunVersion(procedureId, versionId, actor);
    await new PostgresProceduresUnitOfWork(db).execute(async ctx => { await ctx.procedures.insertProcedure(version); await ctx.procedures.insertVersion(version); });
  });
  afterAll(async () => {
    if (!client) return;
    try {
      for (const runId of runs) await client.begin(async tx => {
        await tx`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
        await tx`DELETE FROM run_result WHERE run_id=${runId}`;
        await tx`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM run_initiation_request WHERE run_id=${runId} OR refused_run_id=${runId}`;
        await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
      });
      await client`DELETE FROM run_initiation_request WHERE initiator_id=${actor}`;
      await client`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await client`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await client`DELETE FROM user_role WHERE user_id=${actor}`;
      await client`DELETE FROM auth_user WHERE id=${actor}`;
    } finally { await client.end({ timeout: 5 }); }
  });
  async function fixture() {
    const outcome = await initiateRun({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), clock: new SystemClock(), ids },
      { session, request: { procedureId, requestToken: ids.next(), period: { from: `2026-0${runs.length+1}-01`, to: `2026-0${runs.length+1}-28` } } });
    if (!outcome.ok) throw new Error(outcome.reason); runs.push(outcome.runId);
    await client`UPDATE audit_run SET state='RUNNING' WHERE run_id=${outcome.runId}`;
    const ref = { runId: outcome.runId, workspaceId: ids.next(), mode: 'local' as const };
    await client`INSERT INTO run_workspace(run_id,revision,status,attempts,step_id,workspace_id,mode,started_at,attempt_started_at,lease_until)
      VALUES (${ref.runId},1,'OPEN',1,'session-1',${ref.workspaceId},'local',clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour')`;
    const store = new PostgresWorkspacePreviewStore(db), runtimeId = randomUUID();
    expect(await store.claim(ref, runtimeId)).toBe(1);
    const metadata = { runId: ref.runId, workspaceRevision: 1, runtimeId, privacyEpoch: 1, mode: 'public' as const, sequence: 1, capturedAt: Date.now(), captureCompletedAt: Date.now(), expiresAt: Date.now()+4000 };
    expect(await store.publish(metadata)).toBe(true);
    return { store, ref, metadata };
  }
  it('rejects foreign runtime/Run, old privacy epoch, and same-generation takeover at the DB boundary', async () => {
    const f = await fixture(); expect(await f.store.authorized(f.ref.runId, viewer)).toMatchObject({ runtimeId: f.metadata.runtimeId, privacyEpoch: 1, mode: 'public', sequence: 1 });
    expect(await f.store.current({ ...f.metadata, runtimeId: randomUUID() })).toBe(false);
    expect(await f.store.current({ ...f.metadata, runId: randomUUID() })).toBe(false);
    expect(await f.store.claim(f.ref, randomUUID())).toBeNull();
    await expect(client`UPDATE run_workspace_preview SET runtime_id=${randomUUID()} WHERE run_id=${f.ref.runId}`).rejects.toMatchObject({ code: '23514' });
    expect(await f.store.publish({ ...f.metadata, privacyEpoch: 2, mode: 'private', sequence: 0, capturedAt: null, captureCompletedAt: null })).toBe(true);
    expect(await f.store.current(f.metadata)).toBe(false); expect(await f.store.publish(f.metadata)).toBe(false);
    await expect(client`UPDATE run_workspace_preview SET privacy_epoch=1 WHERE run_id=${f.ref.runId}`).rejects.toMatchObject({ code: '23514' });
  });
  it('refuses revoked roles, expired sessions and terminal Runs on every subsequent read', async () => {
    const f = await fixture(); await client`DELETE FROM user_role WHERE user_id=${actor}`;
    expect(await f.store.authorized(f.ref.runId, viewer)).toBeNull(); await client`INSERT INTO user_role(user_id,role) VALUES (${actor},'auditor')`;
    await client`UPDATE auth_session SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${session.sessionId}`;
    expect(await f.store.authorized(f.ref.runId, viewer)).toBeNull(); await client`UPDATE auth_session SET expires_at=clock_timestamp()+interval '1 hour' WHERE id=${session.sessionId}`;
    const repository = new PostgresRunCancellationRepository(db), clock = new SystemClock();
    expect(await cancelRun({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), repository, clock, ids },
      { session, request: { runId: f.ref.runId, reason: 'Complete the synthetic preview fence proof.' } })).toMatchObject({ ok: true, pending: true });
    await repository.transaction(f.ref.runId, async context => {
      if (!context.run?.cancellation) throw new Error('Cancellation marker is missing');
      await performCancellation(context, { run: context.run, request: context.run.cancellation,
        at: clock.now().toISOString(), plan: await context.frozenPlan(), source: 'worker' });
    });
    expect(await client`SELECT outcome,sealed FROM run_result WHERE run_id=${f.ref.runId}`).toEqual([{ outcome: 'CANCELED', sealed: true }]);
    expect(await f.store.authorized(f.ref.runId, viewer)).toBeNull(); expect(await f.store.current(f.metadata)).toBe(false);
  });
  it('expired ownership cannot be revived; a replacement workspace revision has a new runtime', async () => {
    const f = await fixture(); await client`UPDATE run_workspace_preview SET expires_at=clock_timestamp()-interval '1 second' WHERE run_id=${f.ref.runId}`;
    expect(await f.store.current(f.metadata)).toBe(false); expect(await f.store.publish(f.metadata)).toBe(false); expect(await f.store.claim(f.ref, randomUUID())).toBeNull();
    await client`UPDATE run_workspace SET revision=2,workspace_id=${ids.next()} WHERE run_id=${f.ref.runId}`;
    const [workspace] = await client<{ workspace_id: string }[]>`SELECT workspace_id FROM run_workspace WHERE run_id=${f.ref.runId}`;
    expect(await f.store.claim({ ...f.ref, workspaceId: workspace!.workspace_id }, randomUUID())).toBe(2);
    expect(await f.store.current(f.metadata)).toBe(false);
  });
});
