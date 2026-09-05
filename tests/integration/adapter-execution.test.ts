import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acquirePopulation,
  executeAdapterSteps,
  initiateRun,
  PopulationAcquisitionError,
  type AcquiredArtifact,
  type EvidenceStore,
  type ResolvedCredential,
} from '@intellifin/application';
import {
  bindingDigest,
  bindingDigestEnvelope,
  initialDraftPopulation,
  initialDraftCompliance,
  initialDraftEvidence,
  initialDraftSections,
  registrationDigest,
  sha256Hex,
  sha256HexOfBytes,
  snapshotFromRegistration,
  utf8Bytes,
  type ProcedureTargetSnapshot,
} from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  DrizzleRunRepository,
  PostgresAdapterExecutionRepository,
  PostgresPopulationRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunsUnitOfWork,
  SystemClock,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * Story 3.3 against a real PostgreSQL 18 at generation 19.
 *
 * The plan is a REAL one, derived by the compiler through `activeRunVersion`, so the
 * classification reads bytes the compiler actually emitted rather than a hand-built shape.
 */
const url = process.env.DATABASE_URL;

/** The one credential value in this file. Nothing stored may ever contain it. */
const TOKEN = 'SECRET-TOKEN-integration-do-not-store-me';
const CREDENTIAL = 'cred://synthetic/adapter-execution';

const ACCOUNTS = JSON.stringify({
  accounts: [
    { account_id: 'AG-1001', roles: ['AP_CLERK'], status: 'Active' },
    { account_id: 'AG-1003', roles: ['VENDOR_MAINTAINER', 'VENDOR_APPROVER'], status: 'Active' },
    { account_id: 'AG-1007', roles: ['OPS_CLERK'], status: 'Active' },
    { account_id: 'AG-1007', roles: ['LOAN_ADMIN'], status: 'Active' },
  ],
});
const ROLE_MATRIX =
  'entry,role,permission\n10,AMBIGUOUS_DUAL,CREATE_PAYMENT\n10,AMBIGUOUS_DUAL,VIEW_PAYMENT\n11,AMBIGUOUS_DUAL,RELEASE_PAYMENT\n11,AMBIGUOUS_DUAL,VIEW_PAYMENT\n';

const POPULATION = 'account_id,status\nAG-1001,Active\nAG-1003,Active\nAG-1007,Active\nAG-9999,Active\n';

/** P-3: approvals joined by transaction_id, with a found, an absent and a contradiction. */
const APPROVALS = JSON.stringify({
  approvals: [
    { approval_id: 'APV-9001', transaction_id: 'TX-500001', decision: 'APPROVED', decided_at: '2026-08-10T10:30:00+02:00', approver_limit: '500000.00', currency: 'USD' },
    { approval_id: 'APV-9009', transaction_id: 'TX-500009', decision: 'APPROVED', decided_at: '2026-08-14T10:05:00+02:00', approver_limit: '300000.00', currency: 'USD' },
    { approval_id: 'APV-9009B', transaction_id: 'TX-500009', decision: 'REJECTED', decided_at: '2026-08-14T11:05:00+02:00', approver_limit: '300000.00', currency: 'USD' },
  ],
});
/** The columns P-3's frozen inclusion rule names, so every row is included. */
const TRANSACTIONS =
  'transaction_id,amount,currency,processed_time\n' +
  'TX-500001,100000.00,USD,2026-08-10T11:02:00Z\n' +
  'TX-500003,250000.00,USD,2026-08-11T09:00:00Z\n' +
  'TX-500009,300000.00,USD,2026-08-14T12:00:00Z\n';

describe.skipIf(!url)('adapter execution against PostgreSQL', () => {
  let sql: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const author = ids.next();
  const procedures: string[] = [];
  const bindings: string[] = [];

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))
    ) {
      throw new Error('Adapter execution tests require an isolated local or CI test database');
    }
    sql = createSqlClient(url!, { max: 5 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES(${author},'Adapter test',${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES(${author},'auditor')`;
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const id of procedures) {
        const runs = await sql`SELECT run_id::text AS id FROM audit_run WHERE procedure_id=${id}`;
        for (const run of runs) {
          await sql`DELETE FROM pgboss.job WHERE name='runs' AND data->>'runId'=${run.id}`;
          await sql`DELETE FROM run_observation WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_step_execution WHERE run_id=${run.id}`;
          // Steps and Work Items name their Evidence with a real foreign key, and an
          // ACQUIRED step may not have a null one, so they go before the rows they name.
          await sql`DELETE FROM run_session_step WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_work_item WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_evidence WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_execution WHERE run_id=${run.id}`;
          await sql`DELETE FROM population_row WHERE run_id=${run.id}`;
          await sql`DELETE FROM population_snapshot WHERE run_id=${run.id}`;
          await sql`DELETE FROM population_evidence WHERE run_id=${run.id}`;
          await sql`DELETE FROM population_execution WHERE run_id=${run.id}`;
          await sql`DELETE FROM audit_events WHERE aggregate_id=${run.id}`;
          await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${run.id}`;
          await sql`DELETE FROM run_initiation_request WHERE run_id=${run.id}`;
        }
        await sql`DELETE FROM audit_run WHERE procedure_id=${id}`;
        await sql`DELETE FROM procedure_version WHERE procedure_id=${id}`;
        await sql`DELETE FROM procedure WHERE procedure_id=${id}`;
      }
      for (const id of bindings) await sql`DELETE FROM population_source_binding WHERE binding_id=${id}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  function registration(kind: 'api' | 'versioned-file' | 'web', origin: string) {
    return {
      registrationId: ids.next(),
      displayName: kind === 'versioned-file' ? 'RoleMatrix' : kind === 'api' ? 'AccessGate' : 'LoanCore',
      kind,
      allowedOrigins: [origin],
      applicationIdentity: '',
      credentialRef: CREDENTIAL,
      permittedActions:
        kind === 'web' ? (['navigate', 'read-attribute'] as const) : (['list-records', 'read-attribute'] as const),
      attributeLabelPatterns: ['account_id', 'roles', 'status'],
      secondaryKey: '',
    };
  }

  /** Seed an ACTIVE version with the given Targets and drive its population ready. */
  async function seed(kinds: readonly ('api' | 'versioned-file' | 'web')[], templateId: 'P-2' | 'P-3' = 'P-2') {
    const p3 = templateId === 'P-3';
    const body = p3 ? TRANSACTIONS : POPULATION;
    const declaredSchema = p3
      ? ['transaction_id', 'amount', 'currency', 'processed_time']
      : ['account_id', 'status'];
    const source = {
      kind: 'versioned-file' as const,
      location: 'https://synthetic.invalid/accounts.csv',
      declaredSchema,
      sensitiveFields: [],
      declaredCountMechanism: 'cover-sheet' as const,
    };
    const targets: ProcedureTargetSnapshot[] = kinds.map((kind, index) => {
      const value = registration(kind, `https://synthetic.invalid/system-${String(index)}`);
      return snapshotFromRegistration({ ...value, digest: registrationDigest(value) });
    });
    const inputs = {
      ...initialDraftPopulation(templateId),
      ...initialDraftCompliance(templateId),
      ...initialDraftEvidence(templateId),
      templateId,
      controlName: `Adapter execution ${ids.next()}`,
      sections: initialDraftSections(templateId),
      scope: 'All active accounts',
      period: { from: '2026-08-01', to: '2026-08-31' },
      sourceSnapshot: {
        bindingId: ids.next(),
        displayName: 'Accounts',
        digest: bindingDigest(source),
        contract: bindingDigestEnvelope(source),
      },
      schedule: { frequency: 'once' as const, startTime: '00:00', periodDerivationRule: 'explicit-period' as const },
      targets,
      instructions: kinds.includes('web')
        ? targets
            .filter((entry) => entry.contract.kind === 'web')
            .map((entry) => ({ registrationId: entry.registrationId, text: 'Read the account.' }))
        : [],
    };
    bindings.push(inputs.sourceSnapshot.bindingId);
    await sql`INSERT INTO population_source_binding(binding_id,display_name,kind,location,declared_schema,declared_count_mechanism,digest) VALUES (${inputs.sourceSnapshot.bindingId},'Accounts',${source.kind},${source.location},${source.declaredSchema as string[]},${source.declaredCountMechanism},${inputs.sourceSnapshot.digest})`;
    const row = activeRunVersion(ids.next(), ids.next(), author, inputs);
    procedures.push(row.procedureId);
    await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
      await context.procedures.insertProcedure(row);
      await context.procedures.insertVersion(row);
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
        request: { procedureId: row.procedureId, period: inputs.period, requestToken: ids.next() },
      },
    );
    if (!started.ok) throw new Error(started.reason);
    const run = (await new DrizzleRunRepository(db).findRun(started.runId))!;
    const job = { schemaVersion: 1 as const, runId: run.runId, correlationId: run.correlationId };
    const objects = new Map<string, Uint8Array>();
    const store: EvidenceStore = {
      read: async (key) => objects.get(key) ?? null,
      putIfAbsent: async (key, bytes) => {
        if (!objects.has(key)) objects.set(key, bytes);
      },
    };
    // Drive the population stage first: this stage only claims a POPULATION_READY Run.
    await acquirePopulation(
      {
        repository: new PostgresPopulationRepository(db),
        acquisition: {
          acquire: async () => ({
            bytes: utf8Bytes(body),
            mediaType: 'text/csv',
            declaration: {
              schema_version: 1,
              representation: 'csv-raw-v1',
              source: 'accounts',
              generation: 'g1',
              generated_at: '2026-09-01T00:00:00.000Z',
              effective_period: { from: '2026-01-01', to: '2026-12-31' },
              schema: declaredSchema,
              count: body.trimEnd().split('\n').length - 1,
              sha256: sha256Hex(body),
              complete: true,
            },
          }),
        },
        store,
        clock: new SystemClock(),
        ids,
      },
      job,
    );
    return { run, job, objects, store, targets };
  }

  function dependencies(
    seeded: Awaited<ReturnType<typeof seed>>,
    options: {
      extract?: (target: ProcedureTargetSnapshot, credential: ResolvedCredential) => Promise<AcquiredArtifact>;
      reference?: (target: ProcedureTargetSnapshot) => Promise<AcquiredArtifact>;
    } = {},
  ) {
    const wire: (string | null)[] = [];
    return {
      wire,
      deps: {
        repository: new PostgresAdapterExecutionRepository(db),
        reference: {
          acquireReference:
            options.reference ??
            (async () => ({ bytes: utf8Bytes(ROLE_MATRIX), mediaType: 'text/csv', location: 'https://synthetic.invalid/rm.csv' })),
        },
        extraction: {
          extract:
            options.extract ??
            (async (_target, credential) => {
              const headers = new Map<string, string>();
              credential.authorize({ set: (name, value) => headers.set(name, value) });
              wire.push(headers.get('authorization') ?? null);
              return { bytes: utf8Bytes(ACCOUNTS), mediaType: 'application/json', location: 'https://synthetic.invalid/x' };
            }),
        },
        credentials: {
          resolve: async (reference: string): Promise<ResolvedCredential> => ({
            reference,
            authorize: (headers) => headers.set('authorization', `Bearer ${TOKEN}`),
          }),
        },
        store: seeded.store,
        clock: new SystemClock(),
        ids,
      },
    };
  }

  it('acquires the Reference Source as a Session Step before the only Work Item', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    const { deps } = dependencies(seeded);
    await executeAdapterSteps(deps, seeded.job);

    const steps = await sql`SELECT step_id,state,ordinal,evidence_id FROM run_session_step WHERE run_id=${seeded.run.runId}`;
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ state: 'ACQUIRED', ordinal: 1 });

    const items = await sql`SELECT work_item_id,state,observations FROM run_work_item WHERE run_id=${seeded.run.runId}`;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ state: 'OBSERVED', observations: 4 });

    const evidence = await sql`SELECT kind,state,digest,size FROM run_evidence WHERE run_id=${seeded.run.runId} ORDER BY kind`;
    expect(evidence.map((row) => row.kind)).toEqual(['adapter-extraction', 'reference-source']);
    expect(evidence.every((row) => row.state === 'REGISTERED')).toBe(true);
    const referenceRow = evidence.find((row) => row.kind === 'reference-source')!;
    expect(referenceRow.digest).toBe(sha256HexOfBytes(utf8Bytes(ROLE_MATRIX)));
    // The exact served bytes: the entry ordinals that keep AMBIGUOUS_DUAL ambiguous.
    const stored = seeded.objects.get(`reference/${seeded.run.runId}/${String(steps[0]!.step_id)}`)!;
    expect(new TextDecoder().decode(stored)).toBe(ROLE_MATRIX);

    // The Reference Source's Step Execution comes first in the chain.
    const events = await sql`SELECT payload->>'diagnostic' AS diagnostic FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='lifecycle.adapter-execution' ORDER BY sequence`;
    const order = events.map((row) => row.diagnostic);
    expect(order.indexOf('reference-source-acquired')).toBeLessThan(order.indexOf('work-item-attempt-started'));
    expect(order.at(-1)).toBe('adapter-extraction-complete');
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${seeded.run.runId}`)[0]?.state).toBe('RUNNING');
  });

  it('writes one B.1 Observation per included record with a grounded role list', async () => {
    const seeded = await seed(['api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    const rows = await sql`SELECT population_record_key,found,identity,attributes,evidence_ids,capture_method,match_origin,schema_version FROM run_observation WHERE run_id=${seeded.run.runId} ORDER BY population_record_key`;
    expect(rows.map((row) => row.population_record_key)).toEqual(['AG-1001', 'AG-1003', 'AG-1007', 'AG-9999']);
    expect(rows.map((row) => row.found)).toEqual(['true', 'true', 'ambiguous', 'false']);
    expect(rows.every((row) => row.capture_method === 'adapter' && row.match_origin === 'platform' && row.schema_version === 1)).toBe(true);
    const found = rows[1] as unknown as { identity: { grounding: { locator: string } }; attributes: { name: string; originalValue: unknown }[] };
    expect(found.identity.grounding.locator).toBe('$.accounts[1].account_id');
    const roles = found.attributes.find((attribute) => attribute.name === 'roles')!;
    expect(roles.originalValue).toEqual(['VENDOR_MAINTAINER', 'VENDOR_APPROVER']);
    // The identity CHECK constraint is real: an ambiguous row may not carry an identity.
    expect(rows[2]!.identity).toBeNull();
  });

  it('gives every included P-3 transaction a grounded approval Observation', async () => {
    const seeded = await seed(['api'], 'P-3');
    const { deps } = dependencies(seeded, {
      extract: async (_target, credential) => {
        credential.authorize({ set: () => undefined });
        return { bytes: utf8Bytes(APPROVALS), mediaType: 'application/json', location: 'https://synthetic.invalid/approvals' };
      },
    });
    await executeAdapterSteps(deps, seeded.job);
    const items = await sql`SELECT state,observations FROM run_work_item WHERE run_id=${seeded.run.runId}`;
    // One Work Item per extraction, and it covers every included transaction.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ state: 'OBSERVED', observations: 3 });
    const rows = await sql`SELECT population_record_key,found,identity,attributes FROM run_observation WHERE run_id=${seeded.run.runId} ORDER BY population_record_key`;
    expect(rows.map((row) => [row.population_record_key, row.found])).toEqual([
      ['TX-500001', 'true'],
      // Proven-absence candidate: no approval row names it.
      ['TX-500003', 'false'],
      // Two contradictory decisions: never pick one.
      ['TX-500009', 'ambiguous'],
    ]);
    const found = rows[0] as unknown as {
      identity: { grounding: { locator: string; label: string } };
      attributes: { name: string; originalValue: unknown; normalizedValue: unknown }[];
    };
    expect(found.identity.grounding.locator).toBe('$.approvals[0].transaction_id');
    const names = found.attributes.map((attribute) => attribute.name).sort();
    expect(names).toContain('decision');
    expect(names).toContain('approver_limit');
    expect(names).not.toContain('transaction_id');
    // A `time` value is normalized to UTC with the original kept beside it; nothing else
    // is transformed at all.
    const decidedAt = found.attributes.find((attribute) => attribute.name === 'decided_at')!;
    expect(decidedAt.originalValue).toBe('2026-08-10T10:30:00+02:00');
    expect(decidedAt.normalizedValue).toBe('2026-08-10T08:30:00.000Z');
    const limit = found.attributes.find((attribute) => attribute.name === 'approver_limit')!;
    expect(limit.originalValue).toBe('500000.00');
    expect(limit.normalizedValue).toBe('500000.00');
  });

  it('keeps the credential out of every stored row, event and Evidence object', async () => {
    const seeded = await seed(['api']);
    const { deps, wire } = dependencies(seeded);
    await executeAdapterSteps(deps, seeded.job);
    expect(wire).toContain(`Bearer ${TOKEN}`);

    const dumps = await Promise.all([
      sql`SELECT payload::text AS text FROM audit_events WHERE aggregate_id=${seeded.run.runId}`,
      sql`SELECT row_to_json(t)::text AS text FROM run_execution t WHERE run_id=${seeded.run.runId}`,
      sql`SELECT row_to_json(t)::text AS text FROM run_evidence t WHERE run_id=${seeded.run.runId}`,
      sql`SELECT row_to_json(t)::text AS text FROM run_work_item t WHERE run_id=${seeded.run.runId}`,
      sql`SELECT row_to_json(t)::text AS text FROM run_step_execution t WHERE run_id=${seeded.run.runId}`,
      sql`SELECT row_to_json(t)::text AS text FROM run_observation t WHERE run_id=${seeded.run.runId}`,
    ]);
    for (const rows of dumps) {
      for (const row of rows) expect(String(row.text)).not.toContain(TOKEN);
    }
    for (const bytes of seeded.objects.values()) expect(new TextDecoder().decode(bytes)).not.toContain(TOKEN);
    // Recorded by reference: the Target System is named, the reference value is not, and
    // the chain refuses a `credentialRef` payload key outright.
    const resolved = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND payload->>'diagnostic'='credential-resolved'`;
    expect(resolved).toHaveLength(1);
    expect(Object.keys(resolved[0]!.payload as object)).not.toContain('credentialRef');
    expect(String((resolved[0]!.payload as Record<string, unknown>)['registrationId'])).not.toBe('');
  });

  it('fails one Work Item after both bounded cycles and still runs the next', async () => {
    const seeded = await seed(['api', 'api']);
    const first = seeded.targets[0]!.registrationId;
    const { deps } = dependencies(seeded, {
      extract: async (target, credential) => {
        credential.authorize({ set: () => undefined });
        if (target.registrationId === first) throw new PopulationAcquisitionError('transport');
        return { bytes: utf8Bytes(ACCOUNTS), mediaType: 'application/json', location: 'x' };
      },
    });
    await executeAdapterSteps(deps, seeded.job);
    const items = await sql`SELECT registration_id,state,attempts,cycles,diagnostic FROM run_work_item WHERE run_id=${seeded.run.runId} ORDER BY ordinal`;
    expect(items[0]).toMatchObject({ state: 'FAILED', attempts: 8, cycles: 2, diagnostic: 'extraction-transport-failed' });
    expect(items[1]).toMatchObject({ state: 'OBSERVED' });
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${seeded.run.runId}`)[0]?.state).toBe('RUNNING');
    expect((await sql`SELECT status FROM run_execution WHERE run_id=${seeded.run.runId}`)[0]?.status).toBe('EXTRACTION_COMPLETE');
    // The abandoned reservation is not a registered artifact.
    const abandoned = await sql`SELECT state FROM run_evidence WHERE run_id=${seeded.run.runId} AND registration_id=${first}`;
    expect(abandoned[0]?.state).toBe('ABANDONED');
  });

  it('repeats no completed unit on resume and writes no duplicate Observation', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    let extractions = 0;
    const { deps } = dependencies(seeded, {
      extract: async (_target, credential) => {
        extractions += 1;
        credential.authorize({ set: () => undefined });
        return { bytes: utf8Bytes(ACCOUNTS), mediaType: 'application/json', location: 'x' };
      },
    });
    await executeAdapterSteps(deps, seeded.job);
    const before = await sql`SELECT evidence_id,digest FROM run_evidence WHERE run_id=${seeded.run.runId} ORDER BY evidence_id`;

    // A redelivery: the claim is retaken and the completed units must not run again.
    await sql`UPDATE run_execution SET status='RETRY' WHERE run_id=${seeded.run.runId}`;
    await executeAdapterSteps(new PostgresAdapterExecutionRepository(db) === null ? deps : { ...deps, repository: new PostgresAdapterExecutionRepository(db) }, seeded.job);

    expect(extractions).toBe(1);
    expect((await sql`SELECT count(*)::int AS count FROM run_observation WHERE run_id=${seeded.run.runId}`)[0]?.count).toBe(4);
    expect(await sql`SELECT evidence_id,digest FROM run_evidence WHERE run_id=${seeded.run.runId} ORDER BY evidence_id`).toEqual(before);
    expect((await sql`SELECT status,attempts FROM run_execution WHERE run_id=${seeded.run.runId}`)[0]).toMatchObject({ status: 'EXTRACTION_COMPLETE', attempts: 2 });
  });

  it('fails the Run terminally when a frozen Reference Source no longer matches its digest', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    const { deps } = dependencies(seeded);
    await executeAdapterSteps(deps, seeded.job);
    const [step] = await sql`SELECT step_id FROM run_session_step WHERE run_id=${seeded.run.runId}`;
    const key = `reference/${seeded.run.runId}/${String(step!.step_id)}`;
    const tampered = utf8Bytes('entry,role,permission\n1,TAMPERED,VIEW_LOAN\n');
    seeded.objects.set(key, tampered);

    await sql`UPDATE run_execution SET status='RETRY' WHERE run_id=${seeded.run.runId}`;
    await executeAdapterSteps({ ...deps, repository: new PostgresAdapterExecutionRepository(db) }, seeded.job);

    expect((await sql`SELECT state FROM audit_run WHERE run_id=${seeded.run.runId}`)[0]?.state).toBe('RUN_FAILED');
    expect((await sql`SELECT status,diagnostic FROM run_execution WHERE run_id=${seeded.run.runId}`)[0]).toMatchObject({
      status: 'TERMINAL',
      diagnostic: 'reference-integrity-failed',
    });
    // The stored bytes are never replaced.
    expect(seeded.objects.get(key)).toBe(tampered);
  });

  it('fails the Run when a Reference Source cannot be acquired, and runs no Work Item', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    const { deps } = dependencies(seeded, {
      reference: async () => {
        throw new PopulationAcquisitionError('transport');
      },
    });
    await executeAdapterSteps(deps, seeded.job);
    expect((await sql`SELECT state,attempts FROM run_session_step WHERE run_id=${seeded.run.runId}`)[0]).toMatchObject({ state: 'FAILED', attempts: 4 });
    expect((await sql`SELECT state FROM run_work_item WHERE run_id=${seeded.run.runId}`)[0]?.state).toBe('PENDING');
    expect((await sql`SELECT count(*)::int AS count FROM run_observation WHERE run_id=${seeded.run.runId}`)[0]?.count).toBe(0);
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${seeded.run.runId}`)[0]?.state).toBe('RUN_FAILED');
  });

  it('refuses an agent-driven plan rather than executing part of it', async () => {
    const seeded = await seed(['web']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    // The population stage refuses such a plan first, so the Run never reaches RUNNING;
    // the stage's own refusal is asserted on its claim guard rather than on a checkpoint.
    const state = (await sql`SELECT state FROM audit_run WHERE run_id=${seeded.run.runId}`)[0]?.state;
    expect(state).toBe('RUN_FAILED');
    expect((await sql`SELECT count(*)::int AS count FROM run_work_item WHERE run_id=${seeded.run.runId}`)[0]?.count).toBe(0);
  });

  it('refuses at the database what no command may store', async () => {
    const seeded = await seed(['api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    const [item] = await sql`SELECT work_item_id FROM run_work_item WHERE run_id=${seeded.run.runId}`;
    const [step] = await sql`SELECT step_execution_id FROM run_step_execution WHERE run_id=${seeded.run.runId}`;
    const observation = ids.next();
    const insert = (found: string, identity: string) =>
      sql.unsafe(
        `INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids) VALUES ($1,$2,$3,1,'X','t',$4,now(),$5,'adapter','platform',${identity},'[]'::jsonb,'["e"]'::jsonb)`,
        [observation, seeded.run.runId, String(item!.work_item_id), found, String(step!.step_execution_id)],
      );
    // found = true with no identity, and found = false WITH one, are both refused.
    await expect(insert('true', 'NULL')).rejects.toThrow(/run_observation_identity/);
    await expect(insert('false', `'{"name":"x"}'::jsonb`)).rejects.toThrow(/run_observation_identity/);
    await expect(insert('maybe', 'NULL')).rejects.toThrow(/run_observation_found/);
    await expect(
      sql.unsafe(
        `INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,digest,size,state) VALUES ($1,$2,'reference-source','r','k','not-a-digest',1,'REGISTERED')`,
        [ids.next(), seeded.run.runId],
      ),
    ).rejects.toThrow(/run_evidence_digest/);
    await expect(
      sql.unsafe(
        `INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,digest,size,state) VALUES ($1,$2,'reference-source','r','k2',NULL,NULL,'REGISTERED')`,
        [ids.next(), seeded.run.runId],
      ),
    ).rejects.toThrow(/run_evidence_state/);
  });
});
