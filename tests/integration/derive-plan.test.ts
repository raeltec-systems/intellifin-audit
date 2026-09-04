import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson, deriveExecutablePlan, type JsonValue } from '@intellifin/domain';
import {
  derivePlan, queuePlanDerivation, initialPlanDerivation, planAuthoringDigest, procedureVersionRowVersion, renameProcedureDraft,
  type ModelGateway, type ProcedureVersionRecord, type PlanDerivationJob, type DerivePlanDependencies,
} from '@intellifin/application';
import {
  createDb, createSqlClient, createProceduresQueue, startProceduresWorker, PROCEDURES_QUEUE,
  CryptoUuidV7Generator, DrizzleProcedureRepository, PostgresProceduresUnitOfWork, SystemClock,
  type Database, type Sql,
} from '@intellifin/infrastructure';
import { executablePlanInputs } from '../fixtures/executable-plan.js';
import { enqueueExistingDraftPlans } from '../../packages/infrastructure/src/procedures/derivation-queue.js';

const databaseUrl = process.env['DATABASE_URL'];
const pause = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
async function until(check: () => Promise<boolean>, message: string): Promise<void> {
  const end = Date.now() + 10_000;
  while (Date.now() < end) { if (await check()) return; await new Promise((done) => setTimeout(done, 25)); }
  throw new Error(message);
}

describe.skipIf(!databaseUrl)('queued executable plan derivation on PostgreSQL 18', () => {
  let sql: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const created: string[] = [];
  let repository: DrizzleProcedureRepository;
  let unitOfWork: PostgresProceduresUnitOfWork;
  beforeAll(() => {
    sql = createSqlClient(databaseUrl!, { max: 5 }); db = createDb(sql);
    repository = new DrizzleProcedureRepository(db); unitOfWork = new PostgresProceduresUnitOfWork(db);
  });
  afterAll(async () => {
    for (const id of created) {
      await sql`DELETE FROM pgboss.job WHERE name = ${PROCEDURES_QUEUE} AND data->>'versionId' IN (SELECT version_id::text FROM procedure_version WHERE procedure_id = ${id})`;
      await sql`DELETE FROM procedure_version WHERE procedure_id = ${id}`;
      await sql`DELETE FROM procedure WHERE procedure_id = ${id}`;
    }
    await sql.end({ timeout: 5 });
  });
  async function seed(model: ModelGateway | null = null, overrides: Partial<ProcedureVersionRecord> = {}) {
    const row: ProcedureVersionRecord = { ...executablePlanInputs(), ...initialPlanDerivation(model?.identity ?? null),
      procedureId: ids.next(), versionId: ids.next(), versionNumber: 1, state: 'DRAFT', ...overrides };
    created.push(row.procedureId);
    await unitOfWork.execute(async ({ procedures }) => {
      await procedures.insertProcedure({ procedureId: row.procedureId, templateId: row.templateId, controlName: row.controlName });
      await procedures.insertVersion(row);
    });
    return row;
  }
  function job(row: ProcedureVersionRecord): PlanDerivationJob { return { schemaVersion: 1, versionId: row.versionId, inputDigest: planAuthoringDigest(row) }; }
  function dependencies(model: ModelGateway | null = null): DerivePlanDependencies { return { repository, unitOfWork, ids, clock: new SystemClock(), model }; }
  async function queueCount(versionId: string) {
    const rows = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM pgboss.job WHERE name = ${PROCEDURES_QUEUE} AND data->>'versionId' = ${versionId}`;
    return rows[0]!.count;
  }
  async function events(procedureId: string) { return sql`SELECT event_type, payload FROM audit_events WHERE aggregate_id = ${procedureId} ORDER BY sequence`; }
  function rename(row: ProcedureVersionRecord, name: string, uow = unitOfWork) {
    return renameProcedureDraft({ unitOfWork: uow, roles: { findRole: async () => 'auditor' }, ids }, {
      session: { userId: 'synthetic-auditor', sessionId: 'synthetic-session' }, procedureId: row.procedureId,
      versionId: row.versionId, controlName: name, expectedRowVersion: procedureVersionRowVersion(row), correlationId: ids.next(),
    });
  }

  it('rolls saved data, audit and queued job back together, and enqueues nothing for a no-op', async () => {
    const row = await seed();
    const failAudit = new PostgresProceduresUnitOfWork(db, { ids: { next: () => 'invalid-event-id' } });
    await expect(rename(row, 'Changed name', failAudit)).rejects.toThrow();
    expect((await repository.findVersion(row.versionId))?.controlName).toBe(row.controlName);
    expect(await queueCount(row.versionId)).toBe(0);
    expect(await events(row.procedureId)).toHaveLength(0);
    expect(await rename(row, row.controlName)).toMatchObject({ ok: true, changed: false });
    expect(await queueCount(row.versionId)).toBe(0);
    expect(await rename(row, 'Changed name')).toMatchObject({ ok: true, changed: true });
    expect(await queueCount(row.versionId)).toBe(1);
    expect(await events(row.procedureId)).toHaveLength(1);
    expect((await repository.findVersion(row.versionId))?.planStatus).toBe('pending');
  });

  it('consumes a real pg-boss job in the worker and persists a validated result', async () => {
    const row = await seed();
    const queue = createProceduresQueue(db);
    const errors: unknown[] = []; queue.on('error', (error) => errors.push(error));
    await unitOfWork.execute(async ({ derivationJobs }) => derivationJobs.enqueue(job(row)));
    // Other integration suites leave legitimate queued work. Give this synthetic job
    // priority so the consumer proof is independent of that backlog's size.
    await sql`UPDATE pgboss.job SET priority = 100 WHERE name = ${PROCEDURES_QUEUE} AND data->>'versionId' = ${row.versionId}`;
    try {
      await startProceduresWorker(queue, async (payload) => derivePlan(dependencies(), payload));
      await until(async () => (await repository.findVersion(row.versionId))?.planStatus === 'succeeded', 'worker did not derive queued plan');
      const result = await repository.findVersion(row.versionId);
      expect(result?.planDerivable).toBe(true);
      expect(result?.planAttempts).toHaveLength(1);
      expect(errors).toEqual([]);
      expect((await events(row.procedureId)).map((event) => event.event_type)).toEqual(['lifecycle.procedure-plan-started', 'lifecycle.procedure-plan-derived']);
    } finally { await queue.stop({ graceful: true, timeout: 5000 }); }
  });

  it('records both repeat attempts and emits identical durable bytes', async () => {
    const row = await seed();
    expect(await derivePlan(dependencies(), job(row))).toEqual({ ok: true, outcome: 'success' });
    const first = canonicalJson((await repository.findVersion(row.versionId))!.compiledPlan as unknown as JsonValue);
    expect(await derivePlan(dependencies(), job(row))).toEqual({ ok: true, outcome: 'success' });
    const after = (await repository.findVersion(row.versionId))!;
    expect(canonicalJson(after.compiledPlan as unknown as JsonValue)).toBe(first);
    const canonical = deriveExecutablePlan(executablePlanInputs());
    expect(canonical.ok).toBe(true);
    if (canonical.ok) expect(JSON.stringify(after.compiledPlan)).toBe(JSON.stringify(canonical.plan));
    expect(after.planAttempts).toHaveLength(2);
    expect(await events(row.procedureId)).toHaveLength(4);
  });

  it('backfills upgraded Draft jobs once with their frozen digest', async () => {
    const row = await seed();
    await enqueueExistingDraftPlans(db);
    const after = (await repository.findVersion(row.versionId))!;
    expect(after.planStatus).toBe('pending');
    expect(after.planInputDigest).toBe(planAuthoringDigest(row));
    expect(await queueCount(row.versionId)).toBe(1);
    await enqueueExistingDraftPlans(db);
    expect(await queueCount(row.versionId)).toBe(1);
  });

  it('persists only a fixed safe failure when the handler throws a driver-like error', async () => {
    const row = await seed();
    const queue = createProceduresQueue(db); const queueErrors: unknown[] = []; queue.on('error', (error) => queueErrors.push(error));
    await unitOfWork.execute(async ({ derivationJobs }) => derivationJobs.enqueue(job(row)));
    await sql`UPDATE pgboss.job SET priority = 100 WHERE name = ${PROCEDURES_QUEUE} AND data->>'versionId' = ${row.versionId}`;
    let firstAttempt = true;
    try {
      await startProceduresWorker(queue, async (payload) => {
        if (payload.versionId !== row.versionId) return derivePlan(dependencies(), payload);
        if (firstAttempt) {
          firstAttempt = false;
          throw Object.assign(new Error('raw SQL private-value'), { query: 'private-query', parameters: ['private-parameters'] });
        }
        return derivePlan(dependencies(), payload);
      });
      let output: unknown;
      await until(async () => {
        const rows = await sql`SELECT output FROM pgboss.job WHERE name = ${PROCEDURES_QUEUE} AND data->>'versionId' = ${row.versionId}`;
        output = rows[0]?.output; return output !== null && output !== undefined;
      }, 'failed queue output did not persist');
      expect(queueErrors).toEqual([]);
      expect(JSON.stringify(output)).toContain('Plan derivation worker failed');
      expect(JSON.stringify(output)).not.toContain('private');
      await sql`UPDATE pgboss.job SET start_after = now() WHERE name = ${PROCEDURES_QUEUE} AND data->>'versionId' = ${row.versionId}`;
      await until(async () => (await repository.findVersion(row.versionId))?.planStatus === 'succeeded', 'retry did not recover and record derivation');
      expect((await repository.findVersion(row.versionId))?.planAttempts).toHaveLength(1);
    } finally { await queue.stop({ graceful: true, timeout: 5000 }); }
  });

  it('records provider failure without raw provider error text and atomically rolls attempts back on audit failure', async () => {
    const model: ModelGateway = { identity: { provider: 'synthetic', modelId: 'failing', promptVersion: '1' }, derive: async () => { throw new Error('private raw provider payload'); } };
    const row = await seed(model);
    expect(await derivePlan(dependencies(model), job(row))).toEqual({ ok: true, outcome: 'failure' });
    const after = (await repository.findVersion(row.versionId))!;
    expect(after.planDerivable).toBe(false); expect(after.compiledPlan).toBeNull();
    expect(after.planAttempts).toHaveLength(1);
    expect(after.planFailureReason).toContain('could not complete');
    expect(JSON.stringify(await events(row.procedureId))).not.toContain('private raw');
    const failAudit = new PostgresProceduresUnitOfWork(db, { ids: { next: () => 'invalid-event-id' } });
    await expect(derivePlan({ ...dependencies(model), unitOfWork: failAudit }, job(row))).rejects.toThrow();
    expect((await repository.findVersion(row.versionId))?.planAttempts).toHaveLength(1);
    expect(await events(row.procedureId)).toHaveLength(2);
  });

  it('reads a stored invalid durable plan as absent and not derivable', async () => {
    const row = await seed();
    await derivePlan(dependencies(), job(row));
    await sql`UPDATE procedure_version SET compiled_plan = '{"schemaVersion":1,"unexpected":"shape"}'::jsonb WHERE version_id = ${row.versionId}`;
    const after = (await repository.findVersion(row.versionId))!;
    expect(after.compiledPlan).toBeNull(); expect(after.planDerivable).toBe(false);
    expect(after.planFailureReason).toContain('durable contract');
  });

  it('fails closed when a valid stored plan belongs to different frozen inputs or an old digest', async () => {
    const row = await seed();
    await derivePlan(dependencies(), job(row));
    await sql`UPDATE procedure_version SET scope = 'A changed frozen scope' WHERE version_id = ${row.versionId}`;
    const after = (await repository.findVersion(row.versionId))!;
    expect(after.compiledPlan).toBeNull(); expect(after.planDerivable).toBe(false);
    const row2 = await seed();
    await derivePlan(dependencies(), job(row2));
    await sql`UPDATE procedure_version SET plan_input_digest = ${'0'.repeat(64)} WHERE version_id = ${row2.versionId}`;
    expect((await repository.findVersion(row2.versionId))?.planDerivable).toBe(false);
  });

  it('persists a stated failure for missing authored inputs and invalid model output', async () => {
    const missing = await seed(null, { period: null });
    expect(await derivePlan(dependencies(), job(missing))).toEqual({ ok: true, outcome: 'failure' });
    const absent = (await repository.findVersion(missing.versionId))!;
    expect(absent.planFailureReason?.toLowerCase()).toContain('period');
    expect(absent.planAttempts[0]?.outcome).toBe('failure');
    const invalid: ModelGateway = { identity: { provider: 'synthetic', modelId: 'malformed', promptVersion: '1' }, derive: async () => ({ secretRawOutput: 'never-store-this' }) };
    const row = await seed(invalid);
    expect(await derivePlan(dependencies(invalid), job(row))).toEqual({ ok: true, outcome: 'failure' });
    const after = (await repository.findVersion(row.versionId))!;
    expect(after.planFailureReason).toContain('does not satisfy');
    expect(after.compiledPlan).toBeNull(); expect(after.planDerivable).toBe(false);
    expect(JSON.stringify(after)).not.toContain('never-store-this');
    expect(await events(row.procedureId)).toHaveLength(2);
  });

  it('refuses missing and JSON-null contract keys through database CHECKs', async () => {
    const row = await seed();
    for (const value of [{}, { schemaVersion: null }, null]) {
      await expect(sql`UPDATE procedure_version SET compiled_plan = ${JSON.stringify(value)}::jsonb WHERE version_id = ${row.versionId}`).rejects.toMatchObject({ code: '23514' });
    }
    for (const value of [{ provider: 'x', modelId: 'y' }, { provider: null, modelId: 'y', promptVersion: '1' }, { provider: 1, modelId: 'y', promptVersion: '1' }, { provider: 'x', modelId: true, promptVersion: '1' }, { provider: 'x', modelId: 'y', promptVersion: 1 }, null]) {
      await expect(sql`UPDATE procedure_version SET derivation_model = ${JSON.stringify(value)}::jsonb WHERE version_id = ${row.versionId}`).rejects.toMatchObject({ code: '23514' });
    }
    await expect(sql`UPDATE procedure_version SET plan_attempts = 'null'::jsonb WHERE version_id = ${row.versionId}`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`UPDATE procedure_version SET plan_derivable = true WHERE version_id = ${row.versionId}`).rejects.toMatchObject({ code: '23514' });
  });

  it('waits on a held writer lock and records stale work without overwriting its newer inputs', async () => {
    const modelEntered = pause(); const finishModel = pause(); const writerLocked = pause(); const finishWriter = pause();
    const model: ModelGateway = { identity: { provider: 'synthetic', modelId: 'paused', promptVersion: '1' },
      derive: async (input, compiler) => { modelEntered.resolve(); await finishModel.promise; const result = deriveExecutablePlan(input, compiler); if (!result.ok) throw new Error(result.reason); return result.plan; } };
    const row = await seed(model);
    const workerSql = createSqlClient(databaseUrl!, { max: 1, connection: { application_name: `plan-lock-${row.versionId}` } });
    const workerDb = createDb(workerSql);
    const running = derivePlan({ ...dependencies(model), unitOfWork: new PostgresProceduresUnitOfWork(workerDb) }, job(row));
    await modelEntered.promise;
    const writing = unitOfWork.execute(async ({ procedures, derivationJobs }) => {
      const before = (await procedures.findVersionForUpdate(row.versionId))!;
      await procedures.updateVersion(await queuePlanDerivation({ ...before, controlName: 'New authoring while model runs' }, derivationJobs));
      writerLocked.resolve(); await finishWriter.promise;
    });
    try {
      await writerLocked.promise; finishModel.resolve();
      await until(async () => {
        const waiting = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = ${`plan-lock-${row.versionId}`} AND wait_event_type = 'Lock' AND query ILIKE '%for update%'`;
        return waiting[0]!.count === 1;
      }, 'derivation did not block on the held version lock');
      finishWriter.resolve(); await writing;
      expect(await running).toEqual({ ok: true, outcome: 'stale' });
      const after = (await repository.findVersion(row.versionId))!;
      expect(after.controlName).toBe('New authoring while model runs');
      expect(after.planStatus).toBe('pending'); expect(after.compiledPlan).toBeNull();
      expect(after.planAttempts[0]?.outcome).toBe('stale');
      expect(await queueCount(row.versionId)).toBe(1);
    } finally { finishModel.resolve(); finishWriter.resolve(); await Promise.allSettled([writing, running]); await workerSql.end({ timeout: 5 }); }
  });

  it('recovers an old-producer authoring save after backfill exactly once', async () => {
    const row = await seed();
    await enqueueExistingDraftPlans(db);
    const old = (await repository.findVersion(row.versionId))!;
    const count = await queueCount(row.versionId);
    // Simulates a still-deploying old web producer: changes authored data only.
    await sql`UPDATE procedure_version SET scope = 'Legacy producer changed scope' WHERE version_id = ${row.versionId}`;
    expect(await derivePlan(dependencies(), { ...job(old), inputDigest: old.planInputDigest! })).toMatchObject({ outcome: 'stale' });
    const repaired = (await repository.findVersion(row.versionId))!;
    expect(repaired.planInputDigest).toBe(planAuthoringDigest(repaired));
    expect(repaired.planStatus).toBe('pending');
    expect(await queueCount(row.versionId)).toBe(count + 1);
    await derivePlan(dependencies(), { ...job(old), inputDigest: old.planInputDigest! });
    expect(await queueCount(row.versionId)).toBe(count + 1);
    await derivePlan(dependencies(), job(repaired));
    expect((await repository.findVersion(row.versionId))?.planStatus).toBe('succeeded');
  });
  it('records work that finishes after submission without changing the frozen submitted plan', async () => {
    const entered = pause(); const release = pause(); let pauseModel = false;
    const model: ModelGateway = { identity: { provider: 'synthetic', modelId: 'submission-race', promptVersion: '1' },
      derive: async (input, compiler) => {
        if (pauseModel) { entered.resolve(); await release.promise; }
        const result = deriveExecutablePlan(input, compiler);
        if (!result.ok) throw new Error(result.reason);
        return result.plan;
      } };
    const row = await seed(model);
    expect(await derivePlan(dependencies(model), job(row))).toEqual({ ok: true, outcome: 'success' });
    const before = (await repository.findVersion(row.versionId))!;
    pauseModel = true;
    const running = derivePlan(dependencies(model), job(row));
    try {
      await entered.promise;
      await unitOfWork.execute(async ({ procedures }) => {
        const current = (await procedures.findVersionForUpdate(row.versionId))!;
        await procedures.updateVersion({ ...current, state: 'SUBMITTED' });
      });
      release.resolve();
      expect(await running).toEqual({ ok: true, outcome: 'stale' });
      const after = (await repository.findVersion(row.versionId))!;
      expect(after.state).toBe('SUBMITTED');
      expect(JSON.stringify(after.compiledPlan)).toBe(JSON.stringify(before.compiledPlan));
      expect(after.derivationModel).toEqual(before.derivationModel);
      expect(after.planCompilerVersion).toBe(before.planCompilerVersion);
      expect(after.planInputDigest).toBe(before.planInputDigest);
      expect(planAuthoringDigest(after)).toBe(planAuthoringDigest(before));
      expect(after.planStatus).toBe(before.planStatus);
      expect(after.planDerivable).toBe(before.planDerivable);
      expect(after.planFailureReason).toBe(before.planFailureReason);
      expect(after.planAttempts).toHaveLength(2);
      expect(after.planAttempts[1]).toMatchObject({ outcome: 'stale', reason: 'The version left Draft before this derivation completed.', model: model.identity });
      const recorded = await events(row.procedureId);
      expect(recorded).toHaveLength(4);
      expect(recorded[3]?.payload).toMatchObject({ derivationOutcome: 'stale' });
    } finally { release.resolve(); await Promise.allSettled([running]); }
  });
});
