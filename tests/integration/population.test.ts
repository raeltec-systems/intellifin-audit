import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import {
  acquirePopulation,
  initiateRun,
  PopulationAcquisitionError,
  type EvidenceStore,
  type PopulationAcquisitionPort,
} from '@intellifin/application';
import {
  bindingDigest,
  bindingDigestEnvelope,
  initialDraftPopulation,
  initialDraftCompliance,
  initialDraftEvidence,
  initialDraftSections,
  registrationDigest,
  snapshotFromRegistration,
  sha256Hex,
  utf8Bytes,
} from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  DrizzleRunRepository,
  PostgresRunsUnitOfWork,
  PostgresProceduresUnitOfWork,
  PostgresPopulationRepository,
  SystemClock,
  PostgresAuditChainReader,
  type Sql,
  type Database,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';
const url = process.env.DATABASE_URL;
describe.skipIf(!url)('durable population execution', () => {
  let sql: Sql, db: Database;
  const ids = new CryptoUuidV7Generator(),
    author = ids.next(),
    procedures: string[] = [],
    bindings: string[] = [];
  const raw = utf8Bytes(
    'account_id,status\n001,Active\n001,Active\n002,Inactive\n',
  );
  const declaration = {
    schema_version: 1,
    representation: 'csv-raw-v1',
    source: 'accounts',
    generation: 'g1',
    generated_at: '2026-09-01T00:00:00.000Z',
    effective_period: { from: '2026-01-01', to: '2026-08-31' },
    schema: ['account_id', 'status'],
    count: 3,
    sha256: sha256Hex(
      'account_id,status\n001,Active\n001,Active\n002,Inactive\n',
    ),
    complete: true,
  };
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(
        target.hostname,
      ) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))
    )
      throw new Error(
        'Population tests require an isolated local or CI test database',
      );
    sql = createSqlClient(url!, { max: 5 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES(${author},'Population test',${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES(${author},'auditor')`;
  });
  afterAll(async () => {
    if (!sql) return;
    try {
      for (const id of procedures) {
        const runs =
          await sql`SELECT run_id::text AS id FROM audit_run WHERE procedure_id=${id}`;
        for (const r of runs) {
          await sql`DELETE FROM pgboss.job WHERE name='runs' AND data->>'runId'=${r.id}`;
          await sql`DELETE FROM population_row WHERE run_id=${r.id}`;
          await sql`DELETE FROM population_snapshot WHERE run_id=${r.id}`;
          await sql`DELETE FROM population_evidence WHERE run_id=${r.id}`;
          await sql`DELETE FROM population_execution WHERE run_id=${r.id}`;
          await sql`DELETE FROM audit_events WHERE aggregate_id=${r.id}`;
          await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${r.id}`;
          await sql`DELETE FROM run_initiation_request WHERE run_id=${r.id}`;
        }
        await sql`DELETE FROM audit_run WHERE procedure_id=${id}`;
        await sql`DELETE FROM procedure_version WHERE procedure_id=${id}`;
        await sql`DELETE FROM procedure WHERE procedure_id=${id}`;
      }
      for (const id of bindings)
        await sql`DELETE FROM population_source_binding WHERE binding_id=${id}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
  async function seed(
    options: {
      period?: { from: string; to: string };
      withDate?: boolean;
      agentDriven?: boolean;
    } = {},
  ) {
    const fields = {
      kind: 'versioned-file' as const,
      location: 'https://synthetic.invalid/accounts.csv',
      declaredSchema: options.withDate
        ? ['account_id', 'status', 'date']
        : ['account_id', 'status'],
      sensitiveFields: [],
      declaredCountMechanism: 'cover-sheet' as const,
    };
    const registration = {
      registrationId: ids.next(),
      displayName: 'AccessGate',
      kind: options.agentDriven ? ('web' as const) : ('api' as const),
      allowedOrigins: ['https://synthetic.invalid'],
      applicationIdentity: '',
      credentialRef: 'vault://synthetic/access',
      permittedActions: options.agentDriven
        ? (['navigate', 'read-attribute'] as const)
        : (['list-records', 'read-attribute'] as const),
      attributeLabelPatterns: ['Account'],
      secondaryKey: '',
    };
    const inputs = {
      ...initialDraftPopulation('P-2'),
      ...initialDraftCompliance('P-2'),
      ...initialDraftEvidence('P-2'),
      templateId: 'P-2' as const,
      controlName: 'Population integration',
      sections: initialDraftSections('P-2'),
      scope: 'All accounts',
      period: { from: '2026-08-01', to: '2026-08-31' },
      sourceSnapshot: {
        bindingId: ids.next(),
        displayName: 'Accounts',
        digest: bindingDigest(fields),
        contract: bindingDigestEnvelope(fields),
      },
      schedule: {
        frequency: 'once' as const,
        startTime: '00:00',
        periodDerivationRule: 'explicit-period' as const,
      },
      targets: [
        snapshotFromRegistration({
          ...registration,
          digest: registrationDigest(registration),
        }),
      ],
      instructions: options.agentDriven
        ? [
            {
              registrationId: registration.registrationId,
              text: 'Read account status.',
            },
          ]
        : [],
      ...(options.withDate
        ? {
            inclusionRule: {
              schemaVersion: 1 as const,
              all: [{ column: 'date', kind: 'within-period' as const }],
            },
          }
        : {}),
    };
    bindings.push(inputs.sourceSnapshot.bindingId);
    await sql`INSERT INTO population_source_binding(binding_id,display_name,kind,location,declared_schema,declared_count_mechanism,digest) VALUES (${inputs.sourceSnapshot.bindingId},'Accounts',${fields.kind},${fields.location},${fields.declaredSchema},${fields.declaredCountMechanism},${inputs.sourceSnapshot.digest})`;
    const row = activeRunVersion(ids.next(), ids.next(), author, inputs);
    procedures.push(row.procedureId);
    await new PostgresProceduresUnitOfWork(db).execute(async (c) => {
      await c.procedures.insertProcedure(row);
      await c.procedures.insertVersion(row);
    });
    const started = await initiateRun(
      {
        roles: new DrizzleRoleRepository(db),
        unitOfWork: new PostgresRunsUnitOfWork(db),
        ids,
        clock: new SystemClock(),
      },
      {
        session: { userId: author, sessionId: author },
        request: {
          procedureId: row.procedureId,
          period: options.period ?? inputs.period,
          requestToken: ids.next(),
        },
      },
    );
    if (!started.ok) throw new Error(started.reason);
    const run = (await new DrizzleRunRepository(db).findRun(started.runId))!;
    return {
      schemaVersion: 1 as const,
      runId: run.runId,
      correlationId: run.correlationId,
    };
  }
  function dependencies(
    acquisition: PopulationAcquisitionPort = {
      acquire: async () => ({ bytes: raw, mediaType: 'text/csv', declaration }),
    },
  ) {
    const objects = new Map<string, Uint8Array>();
    const store: EvidenceStore = {
      read: async (key) => objects.get(key) ?? null,
      putIfAbsent: async (key, bytes) => {
        if (objects.has(key) && String(objects.get(key)) !== String(bytes))
          throw new PopulationAcquisitionError('integrity');
        objects.set(key, bytes);
      },
    };
    return {
      repository: new PostgresPopulationRepository(db),
      acquisition,
      store,
      clock: new SystemClock(),
      ids,
      objects,
    };
  }

  it('uses the approved binding and Run period without changing frozen plan bytes', async () => {
    const period = { from: '2026-07-01', to: '2026-07-31' };
    const job = await seed({ period, withDate: true });
    const run = (await new DrizzleRunRepository(db).findRun(job.runId))!;
    const before =
      await sql`SELECT compiled_plan::text, frozen_review::text FROM procedure_version WHERE version_id=${run.versionId}`;
    const bindingId = bindings[bindings.length - 1]!;
    const changed = {
      kind: 'versioned-file' as const,
      location: 'https://synthetic.invalid/replacement.csv',
      declaredSchema: ['account_id', 'status', 'date'],
      sensitiveFields: [],
      declaredCountMechanism: 'cover-sheet' as const,
    };
    await sql`UPDATE population_source_binding SET location=${changed.location},digest=${bindingDigest(changed)} WHERE binding_id=${bindingId}`;
    const text =
      'account_id,status,date\n001,Active,2026-07-15\n002,Active,2026-08-15\n';
    let calls = 0;
    const deps = dependencies({
      acquire: async (source, actualPeriod) => {
        calls++;
        expect(source.bindingId).toBe(bindingId);
        expect(source.contract.location).toBe(
          'https://synthetic.invalid/accounts.csv',
        );
        expect(source.digest).not.toBe(bindingDigest(changed));
        expect(actualPeriod).toEqual(period);
        return {
          bytes: utf8Bytes(text),
          mediaType: 'text/csv',
          declaration: {
            ...declaration,
            schema: ['account_id', 'status', 'date'],
            count: 2,
            sha256: sha256Hex(text),
          },
        };
      },
    });
    await acquirePopulation(deps, job);
    expect(calls).toBe(1);
    expect(
      (await deps.repository.readPopulation(job.runId))?.summary,
    ).toMatchObject({ included: 1, excluded: 1, indeterminate: 0 });
    expect(
      await sql`SELECT ordinal,disposition FROM population_row WHERE run_id=${job.runId} ORDER BY ordinal`,
    ).toEqual([
      { ordinal: 1, disposition: 'included' },
      { ordinal: 2, disposition: 'excluded' },
    ]);
    expect(
      await sql`SELECT compiled_plan::text, frozen_review::text FROM procedure_version WHERE version_id=${run.versionId}`,
    ).toEqual(before);
  });
  it('enforces the durable Run timeout after restart without making another acquisition', async () => {
    const job = await seed(),
      deps = dependencies();
    let calls = 0;
    deps.acquisition = {
      acquire: async () => {
        calls++;
        throw new PopulationAcquisitionError('transport');
      },
    };
    await acquirePopulation(deps, job);
    expect(calls).toBe(1);
    await sql`UPDATE population_execution SET started_at=now()-interval '3601 seconds' WHERE run_id=${job.runId}`;
    expect(
      await acquirePopulation(
        { ...deps, repository: new PostgresPopulationRepository(db) },
        job,
      ),
    ).toEqual({ retry: false });
    expect(calls).toBe(1);
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe(
      'INCONCLUSIVE',
    );
    expect(await deps.repository.readPopulation(job.runId)).toMatchObject({
      status: 'TERMINAL',
      diagnostic: 'run-time-limit',
    });
  });
  it('refuses a valid frozen plan whose first action requires an unsupported workspace', async () => {
    const job = await seed({ agentDriven: true }),
      deps = dependencies();
    let calls = 0;
    await deps.repository.transaction(job.runId, async (context) => {
      expect((await context.frozenPlan())?.sessionSteps[0]?.action).toBe(
        'create-workspace',
      );
    });
    deps.acquisition = {
      acquire: async () => {
        calls++;
        return { bytes: raw, mediaType: 'text/csv', declaration };
      },
    };
    expect(await acquirePopulation(deps, job)).toEqual({ retry: false });
    expect(calls).toBe(0);
    expect(deps.objects.size).toBe(0);
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe(
      'RUN_FAILED',
    );
    expect(await deps.repository.readPopulation(job.runId)).toMatchObject({
      status: 'TERMINAL',
      diagnostic: 'unsupported-frozen-plan',
    });
  });
  it('registers exact bytes, duplicate rows, counts and each check in one durable checkpoint', async () => {
    const job = await seed(),
      deps = dependencies();
    expect(await acquirePopulation(deps, job)).toEqual({ retry: false });
    const view = await deps.repository.readPopulation(job.runId);
    expect(view?.status).toBe('POPULATION_READY');
    expect(view?.summary).toMatchObject({
      included: 2,
      excluded: 1,
      indeterminate: 0,
    });
    expect(deps.objects.get(`population/${job.runId}/raw`)).toEqual(raw);
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe(
      'RUNNING',
    );
    expect(
      await new PostgresAuditChainReader(db).verify(job.runId),
    ).toMatchObject({ valid: true });
    const events =
      await sql`SELECT * FROM audit_events WHERE aggregate_id=${job.runId}`;
    await acquirePopulation(deps, job);
    expect(
      await sql`SELECT * FROM audit_events WHERE aggregate_id=${job.runId}`,
    ).toHaveLength(events.length);
  });
  it('retains raw evidence and explicit failed checks after declaration mismatch', async () => {
    const job = await seed(),
      deps = dependencies({
        acquire: async () => ({
          bytes: raw,
          mediaType: 'text/csv',
          declaration: { ...declaration, count: 4 },
        }),
      });
    await acquirePopulation(deps, job);
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe(
      'INCONCLUSIVE',
    );
    expect(
      (await deps.repository.readPopulation(job.runId))?.evidence?.rawDigest,
    ).toBe(declaration.sha256);
  });
  it('persists four attempts across fresh handlers and refuses a mismatched queued identity', async () => {
    const job = await seed();
    let calls = 0;
    const deps = dependencies({
      acquire: async () => {
        calls++;
        throw new PopulationAcquisitionError('transport');
      },
    });
    await acquirePopulation(deps, { ...job, correlationId: ids.next() });
    expect(calls).toBe(0);
    for (let n = 0; n < 4; n++)
      await acquirePopulation(
        { ...deps, repository: new PostgresPopulationRepository(db) },
        job,
      );
    expect(calls).toBe(4);
    expect((await deps.repository.readPopulation(job.runId))?.attempts).toBe(4);
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe(
      'RUN_FAILED',
    );
  });
  it('recovers uploaded envelope without refetching and detects envelope tamper', async () => {
    const job = await seed(),
      deps = dependencies();
    const original = deps.store.putIfAbsent;
    let fail = true;
    deps.store.putIfAbsent = async (key, bytes, ms) => {
      await original(key, bytes, ms);
      if (key.endsWith('acquisition-v1') && fail) {
        fail = false;
        throw new PopulationAcquisitionError('transport');
      }
    };
    await acquirePopulation(deps, job);
    deps.acquisition = {
      acquire: async () => {
        throw new Error('Must not refetch');
      },
    };
    await acquirePopulation(deps, job);
    expect((await deps.repository.readPopulation(job.runId))?.status).toBe(
      'POPULATION_READY',
    );
    const other = await seed(),
      bad = dependencies();
    bad.store.putIfAbsent = async (key, bytes, ms) => {
      await original(key, bytes, ms);
      bad.objects.set(key, bytes);
      if (key.endsWith('acquisition-v1'))
        throw new PopulationAcquisitionError('transport');
    };
    await acquirePopulation(bad, other);
    bad.objects.set(
      `population/${other.runId}/acquisition-v1`,
      utf8Bytes('{}'),
    );
    await acquirePopulation(bad, other);
    expect(
      (await new DrizzleRunRepository(db).findRun(other.runId))?.state,
    ).toBe('RUN_FAILED');
  });
  it('rejects a live duplicate claim and resumes an abandoned lease', async () => {
    const job = await seed();
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      held = new Promise<void>((r) => (release = r));
    let calls = 0;
    const deps = dependencies({
      acquire: async () => {
        calls++;
        enter();
        await held;
        return { bytes: raw, mediaType: 'text/csv', declaration };
      },
    });
    const first = acquirePopulation(deps, job);
    await entered;
    try {
      expect(await acquirePopulation(deps, job)).toEqual({ retry: false });
      expect(calls).toBe(1);
    } finally {
      release();
    }
    await first;
    const other = await seed(),
      resume = dependencies();
    await resume.repository.transaction(other.runId, async (c) => {
      const now = new Date(Date.now() - 130000).toISOString();
      await c.save(
        {
          revision: 1,
          status: 'ACQUIRING',
          attempts: 1,
          startedAt: now,
          attemptStartedAt: now,
          leaseUntil: now,
          evidenceId: ids.next(),
          objectKey: `population/${other.runId}/raw`,
          envelopeKey: `population/${other.runId}/acquisition-v1`,
          rawDigest: null,
          envelopeDigest: null,
          size: null,
          diagnostic: null,
          stepId: 'session-1',
          attemptId: ids.next(),
        },
        'RUNNING',
      );
    });
    expect(await resume.repository.recoverableRunIds(100)).toContain(
      other.runId,
    );
    await acquirePopulation(resume, other);
    expect(
      (await resume.repository.readPopulation(other.runId))?.attempts,
    ).toBe(2);
  });
  it('rolls back rows, Evidence registration and checkpoint when Timeline fails, then recovers original bytes', async () => {
    const job = await seed(),
      deps = dependencies(),
      repository = deps.repository;
    let fail = true;
    const wrapped = {
      recoverableRunIds: (limit: number) => repository.recoverableRunIds(limit),
      transaction: <T>(
        id: string,
        work: (
          context: import('@intellifin/application').PopulationExecutionContext,
        ) => Promise<T>,
      ) =>
        repository.transaction(id, (c) =>
          work({
            ...c,
            auditEvents: {
              append: async (e) => {
                if (fail && e.payload['diagnostic'] === 'population-ready') {
                  fail = false;
                  throw new Error('Injected rollback');
                }
                return c.auditEvents.append(e);
              },
            },
          }),
        ),
    };
    await acquirePopulation({ ...deps, repository: wrapped }, job);
    expect(
      await sql`SELECT * FROM population_snapshot WHERE run_id=${job.runId}`,
    ).toHaveLength(0);
    expect(
      (await repository.readPopulation(job.runId))?.evidence?.rawDigest,
    ).toBeNull();
    await acquirePopulation(deps, job);
    expect((await repository.readPopulation(job.runId))?.status).toBe(
      'POPULATION_READY',
    );
  });

  it.each(['success', 'failure'] as const)('ignores stale %s after another handler takes over the lease', async outcome => {
    const job = await seed(), deps = dependencies();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const old = acquirePopulation({ ...deps, acquisition: { acquire: async () => {
      entered(); await held;
      if (outcome === 'failure') throw new PopulationAcquisitionError('transport');
      return { bytes: raw, mediaType: 'text/csv', declaration };
    } } }, job);
    await started;
    try {
      await sql`UPDATE population_execution SET lease_until=now()-interval '1 second' WHERE run_id=${job.runId}`;
      await acquirePopulation(deps, job);
      const before = await sql`SELECT * FROM population_execution WHERE run_id=${job.runId}`;
      const events = await sql`SELECT * FROM audit_events WHERE aggregate_id=${job.runId} ORDER BY sequence`;
      expect(before[0]).toMatchObject({ revision: 2, attempts: 2, status: 'POPULATION_READY' });
      release();
      expect(await old).toEqual({ retry: false });
      expect(await sql`SELECT * FROM population_execution WHERE run_id=${job.runId}`).toEqual(before);
      expect(await sql`SELECT * FROM audit_events WHERE aggregate_id=${job.runId} ORDER BY sequence`).toEqual(events);
      expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe('RUNNING');
      expect(await sql`SELECT ordinal FROM population_row WHERE run_id=${job.runId} ORDER BY ordinal`).toEqual([{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }]);
    } finally { release(); await old; }
  });

  it('pages all reasons once in source order with included rows interspersed', async () => {
    const job = await seed();
    const records = Array.from({ length: 123 }, (_, index) => ({ ordinal: index + 1, status: index % 3 === 0 ? 'Active' : index % 3 === 1 ? 'Inactive' : '' }));
    const text = 'account_id,status\n' + records.map(row => `${row.ordinal},${row.status}\n`).join('');
    const deps = dependencies({ acquire: async () => ({ bytes: utf8Bytes(text), mediaType: 'text/csv', declaration: { ...declaration, count: records.length, sha256: sha256Hex(text) } }) });
    await acquirePopulation(deps, job);
    const expected = records.filter(row => row.status !== 'Active').map(row => row.ordinal);
    const first = await deps.repository.readPopulation(job.runId);
    expect(first?.summary).toMatchObject({ included: 41, excluded: 41, indeterminate: 41 });
    expect(first?.rows.map(row => row.ordinal)).toEqual(expected.slice(0, 50));
    expect(first?.next).toBe(expected[49]);
    const second = await deps.repository.readPopulation(job.runId, first!.next!);
    expect(second?.rows.map(row => row.ordinal)).toEqual(expected.slice(50));
    expect(second?.next).toBeNull();
    expect([...first!.rows, ...second!.rows].map(row => row.disposition)).toEqual(expected.map(ordinal => ordinal % 3 === 2 ? 'excluded' : 'indeterminate'));
    expect([...first!.rows, ...second!.rows].every(row => row.reasons.length > 0)).toBe(true);
  });

  it.each(['raw', 'acquisition-v1'] as const)('detects registered %s tamper on ready redelivery without overwriting evidence', async suffix => {
    const job = await seed(), deps = dependencies();
    await acquirePopulation(deps, job);
    const evidence = await sql`SELECT * FROM population_evidence WHERE run_id=${job.runId}`;
    const rows = await sql`SELECT * FROM population_row WHERE run_id=${job.runId} ORDER BY ordinal`;
    const key = `population/${job.runId}/${suffix}`, damaged = utf8Bytes('damaged');
    deps.objects.set(key, damaged);
    let acquisitions = 0;
    deps.acquisition = { acquire: async () => { acquisitions++; throw new Error('Must not reacquire'); } };
    expect(await acquirePopulation(deps, job)).toEqual({ retry: false });
    expect(acquisitions).toBe(0);
    expect(deps.objects.get(key)).toEqual(damaged);
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe('RUN_FAILED');
    expect(await deps.repository.readPopulation(job.runId)).toMatchObject({ status: 'TERMINAL', attempts: 2, diagnostic: 'population-integrity-failed' });
    expect(await sql`SELECT * FROM population_evidence WHERE run_id=${job.runId}`).toEqual(evidence);
    expect(await sql`SELECT * FROM population_row WHERE run_id=${job.runId} ORDER BY ordinal`).toEqual(rows);
  });

  it('rolls back a completion that reaches the overall deadline while recording its events', async () => {
    const job = await seed(), deps = dependencies();
    const base = Date.now(); let now = base;
    const clock = { now: () => new Date(now) };
    await acquirePopulation({ ...deps, clock, acquisition: { acquire: async () => { throw new PopulationAcquisitionError('transport'); } } }, job);
    now = base + 3_599_000;
    const repository = {
      recoverableRunIds: (limit: number) => deps.repository.recoverableRunIds(limit),
      transaction: <T>(id: string, work: (context: import('@intellifin/application').PopulationExecutionContext) => Promise<T>) => deps.repository.transaction(id, context => work({
        ...context, auditEvents: { append: async event => {
          const result = await context.auditEvents.append(event);
          if (event.payload['diagnostic'] === 'population-ready') now = base + 3_600_000;
          return result;
        } },
      })),
    };
    expect(await acquirePopulation({ ...deps, clock, repository }, job)).toEqual({ retry: false });
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe('INCONCLUSIVE');
    expect(await deps.repository.readPopulation(job.runId)).toMatchObject({ status: 'TERMINAL', attempts: 2, evidence: { rawDigest: null } });
    expect(await sql`SELECT * FROM population_snapshot WHERE run_id=${job.runId}`).toHaveLength(0);
    expect(await sql`SELECT * FROM population_row WHERE run_id=${job.runId}`).toHaveLength(0);
    expect(await sql`SELECT * FROM audit_events WHERE aggregate_id=${job.runId} AND payload->>'diagnostic'='population-ready'`).toHaveLength(0);
    expect(deps.objects.get(`population/${job.runId}/raw`)).toEqual(raw);
  });

  it.each(['\u0000', '\ud800'])('preserves an invalid declaration string %j while failing reconciliation', async invalid => {
    const job = await seed();
    const rejected = { ...declaration, generation: invalid };
    const deps = dependencies({ acquire: async () => ({ bytes: raw, mediaType: 'text/csv', declaration: rejected }) });
    expect(await acquirePopulation(deps, job)).toEqual({ retry: false });
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe('INCONCLUSIVE');
    const view = await deps.repository.readPopulation(job.runId);
    expect(view?.evidence?.rawDigest).toBe(declaration.sha256);
    expect(view?.summary?.checks).toContainEqual({ name: 'declaration', passed: false });
    expect(deps.objects.get(`population/${job.runId}/raw`)).toEqual(raw);
    const envelope = JSON.parse(new TextDecoder().decode(deps.objects.get(`population/${job.runId}/acquisition-v1`)!));
    expect(envelope.declaration).toBeNull();
    expect(JSON.parse(envelope.rejectedDeclarationJson)).toEqual(rejected);
    expect(await sql`SELECT ordinal FROM population_row WHERE run_id=${job.runId} ORDER BY ordinal`).toEqual([{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }]);
  });

  it('records each audit check outcome independently of the final Inconclusive state', async () => {
    const job = await seed();
    const deps = dependencies({ acquire: async () => ({ bytes: raw, mediaType: 'text/csv', declaration: { ...declaration, count: 4 } }) });
    await acquirePopulation(deps, job);
    const view = await deps.repository.readPopulation(job.runId);
    const events = await sql`SELECT outcome,payload FROM audit_events WHERE aggregate_id=${job.runId} ORDER BY sequence`;
    expect(view?.summary?.checks.some(check => check.passed)).toBe(true);
    expect(view?.summary?.checks.some(check => !check.passed)).toBe(true);
    for (const check of view!.summary!.checks) {
      const matching = events.filter(event => event.payload.diagnostic === `${check.name}:${check.passed ? 'passed' : 'failed'}`);
      expect(matching).toHaveLength(1);
      expect(matching[0]).toMatchObject({ outcome: check.passed ? 'success' : 'failure', payload: { state: 'INCONCLUSIVE', evidenceId: view!.evidence!.evidenceId, rawDigest: declaration.sha256 } });
    }
  });

  it('durably recovers a temporary ready-verification failure without reacquiring or inserting rows again', async () => {
    const job = await seed(), deps = dependencies();
    await acquirePopulation(deps, job);
    const rows = await sql`SELECT * FROM population_row WHERE run_id=${job.runId} ORDER BY ordinal`;
    const evidence = await sql`SELECT * FROM population_evidence WHERE run_id=${job.runId}`;
    const snapshots = await sql`SELECT * FROM population_snapshot WHERE run_id=${job.runId}`;
    const read = deps.store.read;
    deps.store.read = async () => { throw new PopulationAcquisitionError('transport'); };
    expect(await acquirePopulation(deps, job)).toEqual({ retry: true });
    expect(await deps.repository.readPopulation(job.runId)).toMatchObject({ status: 'RETRY', attempts: 2, diagnostic: 'population-verification-retry' });
    const restarted = new PostgresPopulationRepository(db);
    expect(await restarted.recoverableRunIds(100)).toContain(job.runId);
    deps.store.read = read;
    let acquisitions = 0, writes = 0;
    deps.acquisition = { acquire: async () => { acquisitions++; throw new Error('No new acquisition'); } };
    deps.store.putIfAbsent = async () => { writes++; throw new Error('No new objects'); };
    expect(await acquirePopulation({ ...deps, repository: restarted }, job)).toEqual({ retry: false });
    expect(await restarted.readPopulation(job.runId)).toMatchObject({ status: 'POPULATION_READY', attempts: 3, diagnostic: null });
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe('RUNNING');
    expect(acquisitions).toBe(0); expect(writes).toBe(0);
    expect(await sql`SELECT * FROM population_row WHERE run_id=${job.runId} ORDER BY ordinal`).toEqual(rows);
    expect(await sql`SELECT * FROM population_evidence WHERE run_id=${job.runId}`).toEqual(evidence);
    expect(await sql`SELECT * FROM population_snapshot WHERE run_id=${job.runId}`).toEqual(snapshots);
    expect(await sql`SELECT outcome FROM audit_events WHERE aggregate_id=${job.runId} AND payload->>'diagnostic'='population-evidence-reverified'`).toEqual([{ outcome: 'success' }]);
    expect(await restarted.recoverableRunIds(100)).not.toContain(job.runId);
  });

  it('exhausts four durable attempts when registered-evidence verification keeps failing', async () => {
    const job = await seed(), deps = dependencies();
    await acquirePopulation(deps, job);
    const rows = await sql`SELECT * FROM population_row WHERE run_id=${job.runId} ORDER BY ordinal`;
    let reads = 0;
    deps.store.read = async () => { reads++; throw new PopulationAcquisitionError('transport'); };
    for (const attempts of [2, 3, 4]) {
      const repository = new PostgresPopulationRepository(db);
      expect(await acquirePopulation({ ...deps, repository }, job)).toEqual({ retry: attempts < 4 });
      expect(await repository.readPopulation(job.runId)).toMatchObject({ attempts, status: attempts < 4 ? 'RETRY' : 'TERMINAL' });
    }
    expect(reads).toBe(3);
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe('RUN_FAILED');
    expect(await deps.repository.readPopulation(job.runId)).toMatchObject({ diagnostic: 'population-transport-failed' });
    expect(await deps.repository.recoverableRunIds(100)).not.toContain(job.runId);
    expect(await acquirePopulation(deps, job)).toEqual({ retry: false });
    expect(reads).toBe(3);
    expect(await sql`SELECT * FROM population_row WHERE run_id=${job.runId} ORDER BY ordinal`).toEqual(rows);
  });

  it('rejects ready verification when the overall deadline expires after hashing', async () => {
    const job = await seed(), deps = dependencies();
    const base = Date.now();
    await acquirePopulation({ ...deps, clock: { now: () => new Date(base) } }, job);
    const read = deps.store.read;
    let rawReturned = false, afterReadChecks = 0;
    deps.store.read = async (key, timeout) => {
      const bytes = await read(key, timeout);
      if (key.endsWith('/raw')) rawReturned = true;
      return bytes;
    };
    // The first time check after both reads is before hashing; the second is after.
    const clock = { now: () => new Date(rawReturned && ++afterReadChecks >= 2 ? base + 3_600_000 : base + 3_599_000) };
    expect(await acquirePopulation({ ...deps, clock }, job)).toEqual({ retry: false });
    expect(afterReadChecks).toBeGreaterThanOrEqual(2);
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe('INCONCLUSIVE');
    expect(await deps.repository.readPopulation(job.runId)).toMatchObject({ status: 'TERMINAL', diagnostic: 'run-time-limit' });
    expect(await sql`SELECT outcome FROM audit_events WHERE aggregate_id=${job.runId} AND payload->>'diagnostic'='run-time-limit'`).toEqual([{ outcome: 'failure' }]);
  });

  it.each(['recover', 'exhaust'] as const)('rolls back reverify Timeline failure and can %s without changing registered rows', async disposition => {
    const job = await seed(), deps = dependencies();
    await acquirePopulation(deps, job);
    const rows = await sql`SELECT * FROM population_row WHERE run_id=${job.runId} ORDER BY ordinal`;
    const evidence = await sql`SELECT * FROM population_evidence WHERE run_id=${job.runId}`;
    const read = deps.store.read;
    deps.store.read = async () => { throw new PopulationAcquisitionError('transport'); };
    expect(await acquirePopulation(deps, job)).toEqual({ retry: true });
    deps.store.read = read;
    const repository = {
      recoverableRunIds: (limit: number) => deps.repository.recoverableRunIds(limit),
      transaction: <T>(id: string, work: (context: import('@intellifin/application').PopulationExecutionContext) => Promise<T>) => deps.repository.transaction(id, context => work({
        ...context, auditEvents: { append: async event => {
          if (event.payload['diagnostic'] === 'population-evidence-reverified') throw new Error('Injected Timeline transaction failure');
          return context.auditEvents.append(event);
        } },
      })),
    };
    expect(await acquirePopulation({ ...deps, repository }, job)).toEqual({ retry: true });
    expect(await deps.repository.readPopulation(job.runId)).toMatchObject({ status: 'RETRY', attempts: 3, diagnostic: 'population-verification-retry' });
    expect(await deps.repository.recoverableRunIds(100)).toContain(job.runId);
    expect(await sql`SELECT * FROM audit_events WHERE aggregate_id=${job.runId} AND payload->>'diagnostic'='population-evidence-reverified'`).toHaveLength(0);
    expect(await acquirePopulation({ ...deps, repository: disposition === 'recover' ? new PostgresPopulationRepository(db) : repository }, job)).toEqual({ retry: false });
    expect(await deps.repository.readPopulation(job.runId)).toMatchObject({ status: disposition === 'recover' ? 'POPULATION_READY' : 'TERMINAL', attempts: 4 });
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe(disposition === 'recover' ? 'RUNNING' : 'RUN_FAILED');
    expect(await sql`SELECT * FROM population_row WHERE run_id=${job.runId} ORDER BY ordinal`).toEqual(rows);
    expect(await sql`SELECT * FROM population_evidence WHERE run_id=${job.runId}`).toEqual(evidence);
    expect(await sql`SELECT * FROM audit_events WHERE aggregate_id=${job.runId} AND payload->>'diagnostic'='population-evidence-reverified'`).toHaveLength(disposition === 'recover' ? 1 : 0);
  });
});
