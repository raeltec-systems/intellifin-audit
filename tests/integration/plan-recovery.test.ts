import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  derivePlan, initialPlanDerivation, ModelGatewayError, planAuthoringDigest, queuePlanDerivation, reconcilePlanDerivation,
  type AuditUnitOfWork, type DerivePlanDependencies, type ModelGateway, type PlanDerivationJob,
  type ProcedureVersionRecord, type ProceduresUnitOfWorkContext,
} from '@intellifin/application';
import {
  createDb, createSqlClient, createProceduresQueue, startProceduresWorker, PROCEDURES_QUEUE,
  CryptoUuidV7Generator, DrizzleProcedureRepository, PostgresProceduresUnitOfWork, SystemClock,
  type Database, type Sql,
} from '@intellifin/infrastructure';
import { reconcileProceduresQueue, startProceduresRecovery } from '../../packages/infrastructure/src/procedures/derivation-queue.js';
import { createSectionMachine } from '../../apps/web/src/procedures/use-section.js';
import { executablePlanInputs } from '../fixtures/executable-plan.js';

const databaseUrl = process.env['DATABASE_URL'];
async function until(check: () => Promise<boolean>, reason: string) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
  throw new Error(reason);
}

describe.skipIf(!databaseUrl)('durable plan delivery recovery against PostgreSQL', () => {
  let sql: Sql; let db: Database; let repository: DrizzleProcedureRepository; let unitOfWork: PostgresProceduresUnitOfWork;
  const ids = new CryptoUuidV7Generator(); const created: string[] = [];
  beforeAll(() => { sql = createSqlClient(databaseUrl!, { max: 5 }); db = createDb(sql); repository = new DrizzleProcedureRepository(db); unitOfWork = new PostgresProceduresUnitOfWork(db); });
  afterAll(async () => {
    for (const procedureId of created) {
      await sql`DELETE FROM pgboss.job WHERE name = ${PROCEDURES_QUEUE} AND data->>'versionId' IN (SELECT version_id::text FROM procedure_version WHERE procedure_id = ${procedureId})`;
      await sql`DELETE FROM procedure_version WHERE procedure_id = ${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id = ${procedureId}`;
    }
    await sql.end({ timeout: 5 });
  });
  const dependencies = (model: ModelGateway | null = null): DerivePlanDependencies => ({ repository, unitOfWork, ids, clock: new SystemClock(), model });
  const jobFor = (row: ProcedureVersionRecord): PlanDerivationJob => ({ schemaVersion: 1, versionId: row.versionId, inputDigest: planAuthoringDigest(row) });
  async function seed(model: ModelGateway | null = null) {
    let row: ProcedureVersionRecord = { ...executablePlanInputs(), ...initialPlanDerivation(model?.identity ?? null), procedureId: ids.next(), versionId: ids.next(), state: 'DRAFT', versionNumber: 1 };
    created.push(row.procedureId);
    await unitOfWork.execute(async ({ procedures, derivationJobs }) => {
      await procedures.insertProcedure({ procedureId: row.procedureId, controlName: row.controlName, templateId: row.templateId });
      row = await queuePlanDerivation(row, derivationJobs);
      await procedures.insertVersion(row);
    });
    await sql`UPDATE pgboss.job SET priority = 100, retry_delay = 0 WHERE name = ${PROCEDURES_QUEUE} AND data->>'versionId' = ${row.versionId}`;
    return row;
  }
  async function delivery(versionId: string) {
    const rows = await sql<{ id: string; state: string; retry_count: number; output: unknown }[]>`SELECT id, state, retry_count, output FROM pgboss.job WHERE name = ${PROCEDURES_QUEUE} AND data->>'versionId' = ${versionId} ORDER BY created_on, id`;
    return rows[0]!;
  }
  async function events(procedureId: string) { return sql`SELECT event_type, payload FROM audit_events WHERE aggregate_id = ${procedureId} ORDER BY sequence`; }
  function failFinalAudit(): AuditUnitOfWork<ProceduresUnitOfWorkContext> {
    let calls = 0;
    const failing = new PostgresProceduresUnitOfWork(db, { ids: { next: () => 'invalid-audit-id' } });
    return { execute: (work) => (++calls === 2 ? failing : unitOfWork).execute(work) };
  }

  it('uses real delivery retry metadata to exhaust retries and preserves the final failure on restart', async () => {
    const model: ModelGateway = { identity: { provider: 'synthetic', modelId: 'temporary-failure', promptVersion: '1' }, derive: async () => { throw new ModelGatewayError('The synthetic model is unavailable. Restore the model and retry derivation.', true); } };
    const row = await seed(model); const queue = createProceduresQueue(db); const errors: unknown[] = []; queue.on('error', (error) => errors.push(error));
    await sql`UPDATE pgboss.job SET retry_limit = 1 WHERE name = ${PROCEDURES_QUEUE} AND data->>'versionId' = ${row.versionId}`;
    const observed: number[] = [];
    try {
      await startProceduresWorker(queue, (job, metadata) => {
        if (job.versionId === row.versionId) observed.push(metadata.retriesRemaining!);
        return derivePlan(dependencies(job.versionId === row.versionId ? model : null), job, metadata);
      });
      await until(async () => (await delivery(row.versionId)).state === 'completed', 'exhausted derivation did not finish queue delivery');
    } finally { await queue.stop({ graceful: true, timeout: 5000 }); }
    expect(observed).toEqual([1, 0]); expect(errors).toEqual([]);
    const failed = (await repository.findVersion(row.versionId))!;
    expect(failed.planStatus).toBe('failed'); expect(failed.planDerivable).toBe(false);
    expect(failed.planAttempts).toHaveLength(2);
    expect(failed.planAttempts.every((attempt) => attempt.outcome === 'failure' && attempt.completedAt !== undefined)).toBe(true);
    expect(await events(row.procedureId)).toHaveLength(4);
    const stopRecovery = await startProceduresRecovery(db, (job) => reconcilePlanDerivation(dependencies(), job), () => { throw new Error('unexpected recovery failure'); });
    stopRecovery();
    expect((await repository.findVersion(row.versionId))?.planAttempts).toEqual(failed.planAttempts);
    expect(await events(row.procedureId)).toHaveLength(4);
  });

  it('recovers the durable start after final audit persistence fails and the process restarts', async () => {
    const row = await seed(); const queue = createProceduresQueue(db); queue.on('error', () => {});
    await sql`UPDATE pgboss.job SET retry_limit = 0 WHERE name = ${PROCEDURES_QUEUE} AND data->>'versionId' = ${row.versionId}`;
    const interrupted = { ...dependencies(), unitOfWork: failFinalAudit() };
    try {
      await startProceduresWorker(queue, (job, metadata) => derivePlan(job.versionId === row.versionId ? interrupted : dependencies(), job, metadata));
      await until(async () => (await delivery(row.versionId)).state === 'failed', 'failed final audit did not fail queue delivery');
    } finally { await queue.stop({ graceful: true, timeout: 5000 }); }
    const started = (await repository.findVersion(row.versionId))!;
    expect(started.planStatus).toBe('pending'); expect(started.planAttempts[0]?.outcome).toBe('started');
    expect(await events(row.procedureId)).toHaveLength(1);
    const stopRecovery = await startProceduresRecovery(db, (job) => reconcilePlanDerivation(dependencies(), job), () => {});
    stopRecovery();
    const recovered = (await repository.findVersion(row.versionId))!;
    expect(recovered.planStatus).toBe('failed'); expect(recovered.planFailureReason).toContain('Retry derivation');
    expect(recovered.planAttempts).toHaveLength(1);
    expect(recovered.planAttempts[0]).toMatchObject({ outcome: 'failure', completedAt: expect.any(String) });
    expect((await events(row.procedureId)).map((event) => event.event_type)).toEqual(['lifecycle.procedure-plan-started', 'lifecycle.procedure-plan-derived', 'lifecycle.procedure-plan-reconciled']);
    await reconcileProceduresQueue(db, (job) => reconcilePlanDerivation(dependencies(), job));
    expect(await events(row.procedureId)).toHaveLength(3);
  });

  it('does not let a terminal old delivery override a live retry of the same digest', async () => {
    const row = await seed(); const first = await delivery(row.versionId);
    await expect(derivePlan({ ...dependencies(), unitOfWork: failFinalAudit() }, jobFor(row), { jobId: first.id, retriesRemaining: 0 })).rejects.toThrow();
    const queue = createProceduresQueue(db);
    await queue.cancel(PROCEDURES_QUEUE, first.id);
    await unitOfWork.execute(({ derivationJobs }) => derivationJobs.enqueue(jobFor(row)));
    await reconcileProceduresQueue(db, (job) => reconcilePlanDerivation(dependencies(), job));
    // The second check occurs inside the row lock, not just in the recovery scan.
    await reconcilePlanDerivation(dependencies(), jobFor(row));
    const active = (await repository.findVersion(row.versionId))!;
    expect(active.planStatus).toBe('pending'); expect(active.planAttempts[0]?.outcome).toBe('started');
    expect(await events(row.procedureId)).toHaveLength(1);
  });

  it('does not let more than 100 obsolete terminal digests starve current failed work', async () => {
    const row = await seed();
    await sql`UPDATE pgboss.job SET state = 'failed', completed_on = now() WHERE name = ${PROCEDURES_QUEUE} AND data->>'versionId' = ${row.versionId}`;
    await sql`INSERT INTO pgboss.job (id, name, data, state, completed_on)
      SELECT gen_random_uuid(), ${PROCEDURES_QUEUE}, jsonb_build_object('schemaVersion', 1, 'versionId', ${row.versionId}::text, 'inputDigest', lpad(to_hex(n), 64, '0')), 'failed', now() FROM generate_series(1,120) n`;
    const observed: string[] = [];
    await reconcileProceduresQueue(db, async (job) => {
      if (job.versionId === row.versionId) observed.push(job.inputDigest);
      await reconcilePlanDerivation(dependencies(), job);
    });
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((digest) => digest === row.planInputDigest)).toBe(true);
    expect((await repository.findVersion(row.versionId))?.planStatus).toBe('failed');
  });

  it('detects legacy authoring drift after a successful completed job and queues its successor once', async () => {
    const row = await seed();
    await derivePlan(dependencies(), jobFor(row));
    await sql`UPDATE pgboss.job SET state = 'completed', completed_on = now() WHERE name = ${PROCEDURES_QUEUE} AND data->>'versionId' = ${row.versionId}`;
    await sql`UPDATE procedure_version SET scope = 'Changed by old producer after success' WHERE version_id = ${row.versionId}`;
    await reconcileProceduresQueue(db, (job) => reconcilePlanDerivation(dependencies(), job));
    const recovered = (await repository.findVersion(row.versionId))!;
    expect(recovered.planStatus).toBe('pending'); expect(recovered.compiledPlan).toBeNull();
    expect(recovered.planInputDigest).toBe(planAuthoringDigest(recovered));
    await reconcileProceduresQueue(db, (job) => reconcilePlanDerivation(dependencies(), job));
    const queued = await sql<{ n: number }[]>`SELECT count(*)::int n FROM pgboss.job WHERE name = ${PROCEDURES_QUEUE} AND data->>'versionId' = ${row.versionId} AND state = 'created'`;
    expect(queued[0]!.n).toBe(1);
    expect((await events(row.procedureId)).filter((event) => event.event_type === 'lifecycle.procedure-plan-recovered')).toHaveLength(1);
    await derivePlan(dependencies(), jobFor(recovered));
    expect((await repository.findVersion(row.versionId))?.planStatus).toBe('succeeded');
  });
  it('treats real JSONB key reordering as the same source section during dirty editing and save acknowledgement', async () => {
    const row = await seed();
    const raw = await sql<{ source_snapshot: NonNullable<ProcedureVersionRecord['sourceSnapshot']> }[]>`SELECT source_snapshot FROM procedure_version WHERE version_id = ${row.versionId}`;
    const original = row.sourceSnapshot!; const persisted = raw[0]!.source_snapshot;
    expect(JSON.stringify(persisted)).not.toBe(JSON.stringify(original));
    expect(persisted).toEqual(original);
    const machine = createSectionMachine(original, 'before-worker');
    const edited = { ...original, displayName: 'Still editing source name' };
    machine.edit(edited); machine.observe(persisted, 'after-worker');
    expect(machine.state).toMatchObject({ value: edited, token: 'after-worker', conflict: false });
    machine.begin(edited); machine.finish('save-token');
    const acknowledged = await sql<{ value: typeof edited }[]>`SELECT ${JSON.stringify(edited)}::jsonb AS value`;
    machine.observe(acknowledged[0]!.value, 'refreshed-save-token');
    expect(machine.state).toMatchObject({ value: edited, token: 'refreshed-save-token', conflict: false });
  });
});
