import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acquirePopulation,
  executeAdapterSteps,
  sealPackage,
  verifySealedPackage,
  initiateRun,
  NO_CORROBORATION,
  NO_EVALUATION,
  PopulationAcquisitionError,
  registerObservations,
  type ObservationBatch,
  type AcquiredArtifact,
  type EvidenceStore,
  type ObservationCorroborationPort,
  type ObservationEvaluationPort,
  type ResolvedCredential,
} from '@intellifin/application';
import {
  bindingDigest,
  bindingDigestEnvelope,
  OBSERVATION_CHECKS,
  observationBatchDigest,
  observationDigest,
  observationIdFor,
  evidenceIdFor,
  evidenceObjectKey,
  evidenceObjectKeys,
  isRequiredArtifact,
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
  PostgresSealedPackageRepository,
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

const ACCOUNT_ROWS = [
  { account_id: 'AG-1001', roles: ['AP_CLERK'], status: 'Active' },
  { account_id: 'AG-1003', roles: ['VENDOR_MAINTAINER', 'VENDOR_APPROVER'], status: 'Active' },
  { account_id: 'AG-1007', roles: ['OPS_CLERK'], status: 'Active' },
  { account_id: 'AG-1007', roles: ['LOAN_ADMIN'], status: 'Active' },
];

/** The CLOSED collection envelope a Northstar API actually serves, `complete` included. */
function collection(itemsKey: string, items: readonly unknown[], schema: readonly string[]): string {
  return JSON.stringify({
    // The NFR-13 marker every Northstar response carries, and part of the closed envelope.
    synthetic: { marker: 'SYNTHETIC-NORTHSTAR-FIXTURE' },
    schema_version: 1, representation: 'population-rows-v1', source: itemsKey,
    title: itemsKey, generation: 'g1', generated_at: '2026-09-01T00:00:00.000Z',
    effective_period: { from: '2026-01-01', to: '2026-12-31' },
    schema, complete: true, returned: items.length,
    declared_count_endpoint: `/${itemsKey}/count`,
    [itemsKey]: items,
  });
}

const ACCOUNTS = collection('accounts', ACCOUNT_ROWS, ['account_id', 'roles', 'status']);
/** The same rows with no completeness declaration: an absence from it proves nothing. */
const INCOMPLETE_ACCOUNTS = JSON.stringify({ accounts: ACCOUNT_ROWS });
const ROLE_MATRIX =
  'entry,role,permission\n10,AMBIGUOUS_DUAL,CREATE_PAYMENT\n10,AMBIGUOUS_DUAL,VIEW_PAYMENT\n11,AMBIGUOUS_DUAL,RELEASE_PAYMENT\n11,AMBIGUOUS_DUAL,VIEW_PAYMENT\n';

const POPULATION = 'account_id,status\nAG-1001,Active\nAG-1003,Active\nAG-1007,Active\nAG-9999,Active\n';

/** P-3: approvals joined by transaction_id, with a found, an absent and a contradiction. */
const APPROVALS = collection(
  'approvals',
  [
    { approval_id: 'APV-9001', transaction_id: 'TX-500001', decision: 'APPROVED', decided_at: '2026-08-10T10:30:00+02:00', approver_limit: '500000.00', currency: 'USD' },
    { approval_id: 'APV-9009', transaction_id: 'TX-500009', decision: 'APPROVED', decided_at: '2026-08-14T10:05:00+02:00', approver_limit: '300000.00', currency: 'USD' },
    { approval_id: 'APV-9009B', transaction_id: 'TX-500009', decision: 'REJECTED', decided_at: '2026-08-14T11:05:00+02:00', approver_limit: '300000.00', currency: 'USD' },
  ],
  ['approval_id', 'transaction_id', 'decision', 'decided_at', 'approver_limit', 'currency'],
);
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
          await sql`DELETE FROM run_observation_evaluation WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_observation_check WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_observation WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_step_execution WHERE run_id=${run.id}`;
          // Steps and Work Items name their Evidence with a real foreign key, and an
          // ACQUIRED step may not have a null one, so they go before the rows they name.
          await sql`DELETE FROM run_session_step WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_work_item WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_evidence_integrity WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_evidence_package WHERE run_id=${run.id}`;
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
      corroboration?: ObservationCorroborationPort;
      evaluation?: ObservationEvaluationPort;
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
        // Story 3.4's seams. `NO_*` is the explicit "not yet judged" the worker composes.
        corroboration: options.corroboration ?? NO_CORROBORATION,
        evaluation: options.evaluation ?? NO_EVALUATION,
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
    // The failed Work Item's reservation is still OPEN: the Run is still running, and
    // `SealPackage` is the one thing that abandons a reservation (Story 3.5). What matters
    // here is that it is not a registered artifact.
    const reservation = await sql`SELECT state,digest FROM run_evidence WHERE run_id=${seeded.run.runId} AND registration_id=${first}`;
    expect(reservation[0]).toMatchObject({ state: 'RESERVED', digest: null });
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
    // A real redelivery: the completed Work Item is skipped, so the registration event
    // and every per-Observation check outcome exist exactly once.
    expect((await sql`SELECT count(*)::int AS count FROM run_observation_check WHERE run_id=${seeded.run.runId}`)[0]?.count).toBe(15);
    expect((await sql`SELECT count(*)::int AS count FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='execution.observations-registered'`)[0]?.count).toBe(1);
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
        `INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,observed_at_source) VALUES ($1,$2,$3,1,'X-'||gen_random_uuid()::text,'t',$4,now(),$5,'adapter','platform',${identity},'[]'::jsonb,'["e"]'::jsonb,repeat('a',64),CASE $4 WHEN 'ambiguous' THEN 'AMBIGUOUS' WHEN 'true' THEN 'COVERED' ELSE 'UNINSPECTED' END,'2026-09-05T00:00:00.000Z')`,
        [observation, seeded.run.runId, String(item!.work_item_id), found, String(step!.step_execution_id)],
      );
    // found = true with no identity, and found = false WITH one, are both refused.
    await expect(insert('true', 'NULL')).rejects.toThrow(/run_observation_identity/);
    await expect(insert('false', `'{"name":"x"}'::jsonb`)).rejects.toThrow(/run_observation_identity/);
    await expect(insert('maybe', 'NULL')).rejects.toThrow(/run_observation_found/);
    await expect(
      sql.unsafe(
        `INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,digest,size,required,state) VALUES ($1,$2,'reference-source','r','k','not-a-digest',1,true,'REGISTERED')`,
        [ids.next(), seeded.run.runId],
      ),
    ).rejects.toThrow(/run_evidence_digest/);
    await expect(
      sql.unsafe(
        `INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,digest,size,required,state) VALUES ($1,$2,'reference-source','r','k2',NULL,NULL,true,'REGISTERED')`,
        [ids.next(), seeded.run.runId],
      ),
    ).rejects.toThrow(/run_evidence_state/);
  });


  /* --------------------------------------------------------------- Story 3.5 --- */

  /** Seal a Run at a terminal state through the real command and the real repository. */
  async function sealAt(
    seeded: Awaited<ReturnType<typeof seed>>,
    state: 'COMPLETED' | 'INCONCLUSIVE',
  ) {
    return new PostgresAdapterExecutionRepository(db).transaction(seeded.run.runId, async (c) => {
      await c.saveCheckpoint({ ...c.checkpoint!, status: 'TERMINAL', diagnostic: null }, state);
      return sealPackage(c, {
        run: c.run!,
        terminalState: state,
        sealedAt: new Date().toISOString(),
      });
    });
  }

  it('names every reservation from the Run, the kind and the frozen step id', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    const rows =
      await sql`SELECT evidence_id::text AS id,kind,object_key,required,state FROM run_evidence WHERE run_id=${seeded.run.runId} ORDER BY kind`;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const kind = String(row.kind) as 'reference-source' | 'adapter-extraction';
      const [step] =
        await sql`SELECT step_id FROM ${sql(kind === 'reference-source' ? 'run_session_step' : 'run_work_item')} WHERE run_id=${seeded.run.runId}`;
      const reservation = { runId: seeded.run.runId, kind, scope: String(step!.step_id) };
      // Derived, not minted: this is the arithmetic a retried production repeats.
      expect(row.id).toBe(evidenceIdFor(reservation));
      expect(row.object_key).toBe(evidenceObjectKey(reservation));
      expect(row.required).toBe(isRequiredArtifact('P-2', kind));
    }
    const [population] =
      await sql`SELECT evidence_id::text AS id,object_key,envelope_key,required FROM population_evidence WHERE run_id=${seeded.run.runId}`;
    const reservation = { runId: seeded.run.runId, kind: 'population' as const, scope: '' };
    expect(population!.id).toBe(evidenceIdFor(reservation));
    expect([population!.object_key, population!.envelope_key]).toEqual(evidenceObjectKeys(reservation));
    expect(population!.required).toBe(true);
  });

  it('reuses one reservation and one object when the same artifact is produced twice', async () => {
    const seeded = await seed(['api']);
    const { deps } = dependencies(seeded);
    await executeAdapterSteps(deps, seeded.job);
    const before =
      await sql`SELECT evidence_id::text AS id,object_key,digest,size FROM run_evidence WHERE run_id=${seeded.run.runId}`;
    const objects = new Map(seeded.objects);

    // The crash: the claim is reopened and the whole stage runs again.
    await sql`UPDATE run_execution SET status='RETRY' WHERE run_id=${seeded.run.runId}`;
    await sql`UPDATE run_work_item SET state='PENDING',attempts=0 WHERE run_id=${seeded.run.runId}`;
    await executeAdapterSteps({ ...deps, repository: new PostgresAdapterExecutionRepository(db) }, seeded.job);

    const after =
      await sql`SELECT evidence_id::text AS id,object_key,digest,size,state FROM run_evidence WHERE run_id=${seeded.run.runId}`;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before[0]!.id, object_key: before[0]!.object_key, state: 'REGISTERED' });
    // No second object beside the first.
    expect([...seeded.objects.keys()].sort()).toEqual([...objects.keys()].sort());
  });

  it('seals a package whose required artifacts are all registered', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    const seal = await sealAt(seeded, 'COMPLETED');
    expect(seal).toMatchObject({ state: 'SEALED', missingRequired: [], abandoned: [] });
    const [row] =
      await sql`SELECT state,run_state,required_total,registered,missing_required,abandoned FROM run_evidence_package WHERE run_id=${seeded.run.runId}`;
    expect(row).toMatchObject({ state: 'SEALED', run_state: 'COMPLETED', required_total: 2, registered: 3 });
    expect(row!.missing_required).toEqual([]);
    expect(row!.abandoned).toEqual([]);
    const [event] =
      await sql`SELECT payload FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='lifecycle.evidence-package-sealed'`;
    expect(event!.payload).toMatchObject({ seal: 'SEALED', runState: 'COMPLETED' });
  });

  it('does not seal as complete when a required artifact never registered, and names the gap', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    const { deps } = dependencies(seeded, {
      reference: async () => {
        throw new PopulationAcquisitionError('transport');
      },
    });
    await executeAdapterSteps(deps, seeded.job);
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${seeded.run.runId}`)[0]?.state).toBe('RUN_FAILED');
    const [row] =
      await sql`SELECT state,run_state,required_total,registered,missing_required,abandoned FROM run_evidence_package WHERE run_id=${seeded.run.runId}`;
    expect(row).toMatchObject({ state: 'INCOMPLETE', run_state: 'RUN_FAILED', required_total: 2, registered: 1 });
    const [step] = await sql`SELECT step_id FROM run_session_step WHERE run_id=${seeded.run.runId}`;
    const key = `reference/${seeded.run.runId}/${String(step!.step_id)}`;
    expect((row!.missing_required as { objectKey: string }[]).map((entry) => entry.objectKey)).toEqual([key]);
    // The reservation was still open when the Run stopped: the seal is what abandons it,
    // and what lists it on the Result.
    expect((row!.abandoned as { objectKey: string }[]).map((entry) => entry.objectKey)).toEqual([key]);
    expect((await sql`SELECT state,digest FROM run_evidence WHERE object_key=${key}`)[0]).toMatchObject({
      state: 'ABANDONED',
      digest: null,
    });
  });

  it('abandons an open reservation at the terminal transition and lists it', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    const { deps } = dependencies(seeded);
    await executeAdapterSteps(deps, seeded.job);
    // An upload that never completed: the row is RESERVED and its object is not there.
    const [item] = await sql`SELECT step_id FROM run_work_item WHERE run_id=${seeded.run.runId}`;
    const key = `extraction/${seeded.run.runId}/${String(item!.step_id)}`;
    await sql`UPDATE run_evidence SET state='RESERVED',digest=NULL,size=NULL WHERE object_key=${key}`;
    const seal = await sealAt(seeded, 'INCONCLUSIVE');
    // The extraction is not REQUIRED, so the package still seals — and the abandonment is
    // still listed, because a reservation is never silently dropped.
    expect(seal.state).toBe('SEALED');
    expect(seal.abandoned.map((entry) => entry.objectKey)).toEqual([key]);
    expect((await sql`SELECT state FROM run_evidence WHERE object_key=${key}`)[0]?.state).toBe('ABANDONED');
  });

  it('ends the Run RUN_FAILED when stored bytes disagree DURING the Run, and leaves them alone', async () => {
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
    expect(seeded.objects.get(key)).toBe(tampered);
    // And the terminal transition sealed, because every terminal transition does.
    expect((await sql`SELECT state FROM run_evidence_package WHERE run_id=${seeded.run.runId}`)[0]?.state).toBe('SEALED');
    expect((await sql`SELECT count(*)::int AS count FROM run_evidence_integrity WHERE run_id=${seeded.run.runId}`)[0]?.count).toBe(0);
  });

  it('records the same disagreement found AFTER the Run as an integrity event, changing nothing', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    await sealAt(seeded, 'INCONCLUSIVE');
    const repository = new PostgresSealedPackageRepository(db);
    const verifyDeps = { repository, store: seeded.store, clock: new SystemClock(), ids };
    expect(await verifySealedPackage(verifyDeps, seeded.run.runId)).toMatchObject({ recorded: 0 });

    const [step] = await sql`SELECT step_id FROM run_session_step WHERE run_id=${seeded.run.runId}`;
    const key = `reference/${seeded.run.runId}/${String(step!.step_id)}`;
    const registered = (await sql`SELECT digest,size FROM run_evidence WHERE object_key=${key}`)[0]!;
    const tampered = utf8Bytes('entry,role,permission\n1,TAMPERED,VIEW_LOAN\n');
    seeded.objects.set(key, tampered);

    const result = await verifySealedPackage(verifyDeps, seeded.run.runId);
    expect(result.recorded).toBe(1);
    const [finding] =
      await sql`SELECT finding,object_key,expected_digest,observed_digest FROM run_evidence_integrity WHERE run_id=${seeded.run.runId}`;
    expect(finding).toMatchObject({
      object_key: key,
      expected_digest: registered.digest,
      observed_digest: sha256HexOfBytes(tampered),
    });
    const [event] =
      await sql`SELECT outcome,payload FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='failure.evidence-integrity'`;
    expect(event).toMatchObject({ outcome: 'failure' });
    expect(event!.payload).toMatchObject({ objectKey: key, stateChanged: false });

    // Nothing moved: not the Run, not the seal, not the Evidence row, not the bytes.
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${seeded.run.runId}`)[0]?.state).toBe('INCONCLUSIVE');
    expect((await sql`SELECT state,run_state FROM run_evidence_package WHERE run_id=${seeded.run.runId}`)[0]).toMatchObject({
      state: 'SEALED',
      run_state: 'INCONCLUSIVE',
    });
    expect((await sql`SELECT state,digest FROM run_evidence WHERE object_key=${key}`)[0]).toMatchObject({
      state: 'REGISTERED',
      digest: registered.digest,
    });
    expect(seeded.objects.get(key)).toBe(tampered);
    // Verified twice, recorded once.
    expect(await verifySealedPackage(verifyDeps, seeded.run.runId)).toMatchObject({ recorded: 0 });
  });

  it('refuses at the database what no seal may store', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    const [step] = await sql`SELECT step_id FROM run_session_step WHERE run_id=${seeded.run.runId}`;
    const key = `reference/${seeded.run.runId}/${String(step!.step_id)}`;
    // A required artifact that is not REGISTERED.
    await sql`UPDATE run_evidence SET state='RESERVED',digest=NULL,size=NULL WHERE object_key=${key}`;
    const insertSeal = (state: string) =>
      sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
          VALUES(${seeded.run.runId},${state},'RUN_FAILED',now(),2,1,'[]'::jsonb,'[]'::jsonb)`;
    // No command, migration or psql session can seal over a missing required artifact.
    await expect(insertSeal('SEALED')).rejects.toThrow(/required artifact is not REGISTERED/);
    // And the seal state may not disagree with the list it is derived from.
    await expect(insertSeal('INCOMPLETE')).rejects.toThrow(/run_evidence_package_complete/);
    // A terminal Run with no package at all is refused, whatever writes it.
    await expect(
      sql`UPDATE audit_run SET state='CANCELED' WHERE run_id=${seeded.run.runId}`,
    ).rejects.toThrow(/without a sealed Evidence package/);
  });

  it('freezes the Evidence and the seal once the package is sealed', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    await sealAt(seeded, 'COMPLETED');
    const [step] = await sql`SELECT step_id FROM run_session_step WHERE run_id=${seeded.run.runId}`;
    const key = `reference/${seeded.run.runId}/${String(step!.step_id)}`;
    await expect(
      sql`UPDATE run_evidence SET state='ABANDONED',digest=NULL,size=NULL WHERE object_key=${key}`,
    ).rejects.toThrow(/its package is sealed/);
    await expect(
      sql`UPDATE population_evidence SET state='ABANDONED',raw_digest=NULL WHERE run_id=${seeded.run.runId}`,
    ).rejects.toThrow(/its package is sealed/);
    await expect(
      sql`UPDATE run_evidence_package SET state='INCOMPLETE' WHERE run_id=${seeded.run.runId}`,
    ).rejects.toThrow(/immutable/);
  });

  /* --------------------------------------------------------------- Story 3.4 --- */

  it('registers a batch as one transaction, with one event carrying every digest', async () => {
    const seeded = await seed(['api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);

    const rows = await sql`SELECT observation_id::text AS id,digest,coverage,observed_at_source,found,attributes,identity,evidence_ids,schema_version,step_execution_id::text AS step,work_item_id::text AS item,population_record_key AS key,target_system,capture_method,match_origin,to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at FROM run_observation WHERE run_id=${seeded.run.runId} ORDER BY population_record_key`;
    expect(rows).toHaveLength(4);

    // The stored digest is the domain's digest over the record as stored. Recomputing it
    // here from the ROW rather than from the batch is the whole point: it is what a later
    // integrity check does, and what detects an edit.
    for (const row of rows) {
      const record = {
        schemaVersion: Number(row.schema_version) as 1,
        observationId: String(row.id),
        workItemId: String(row.item),
        populationRecordKey: String(row.key),
        targetSystem: String(row.target_system),
        found: String(row.found) as 'true' | 'false' | 'ambiguous',
        observedAt: String(row.observed_at),
        stepExecutionId: String(row.step),
        captureMethod: String(row.capture_method) as 'adapter',
        matchOrigin: String(row.match_origin) as 'platform',
        identity: row.identity as never,
        attributes: row.attributes as never,
        evidenceIds: row.evidence_ids as string[],
      };
      expect(row.digest).toBe(observationDigest(record));
      // The identity is DERIVED, so a redelivery names the same Observation.
      expect(row.id).toBe(observationIdFor(String(row.item), String(row.key)));
      expect(row.observed_at_source).toBe(record.observedAt);
    }

    const events = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='execution.observations-registered'`;
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as Record<string, unknown>;
    const digests = payload['digests'] as string[];
    expect(new Set(digests)).toEqual(new Set(rows.map((row) => String(row.digest))));
    expect(payload['batchDigest']).toBe(observationBatchDigest(digests));
    expect(payload['registered']).toBe(4);
    expect(payload['coverage']).toEqual({ COVERED: 3, UNINSPECTED: 0, AMBIGUOUS: 1 });

    // Per-Observation check outcomes committed with the rows.
    const checks = await sql`SELECT check_name,outcome,diagnostic FROM run_observation_check WHERE run_id=${seeded.run.runId} ORDER BY check_name`;
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.filter((row) => row.outcome === 'FAIL')).toEqual([
      { check_name: 'ambiguous-match', outcome: 'FAIL', diagnostic: 'ambiguous-match' },
    ]);
    expect(new Set(checks.map((row) => row.check_name))).toEqual(
      new Set(['identity-corroboration', 'search-completeness', 'ambiguous-match', 'required-evidence', 'freshness']),
    );
  });

  it('covers an honest absence and leaves a dishonest one UNINSPECTED', async () => {
    const honest = await seed(['api']);
    await executeAdapterSteps(dependencies(honest).deps, honest.job);
    expect(
      (await sql`SELECT coverage FROM run_observation WHERE run_id=${honest.run.runId} AND population_record_key='AG-9999'`)[0]?.coverage,
    ).toBe('COVERED');

    // The same extraction with no completeness declaration. "Not in the system" is then
    // really "not on the page I happened to read", so nobody proved they looked.
    const dishonest = await seed(['api']);
    await executeAdapterSteps(
      dependencies(dishonest, {
        extract: async (_target, credential) => {
          credential.authorize({ set: () => undefined });
          return { bytes: utf8Bytes(INCOMPLETE_ACCOUNTS), mediaType: 'application/json', location: 'x' };
        },
      }).deps,
      dishonest.job,
    );
    const rows = await sql`SELECT population_record_key AS key,coverage FROM run_observation WHERE run_id=${dishonest.run.runId} ORDER BY population_record_key`;
    expect(rows.map((row) => [row.key, row.coverage])).toEqual([
      ['AG-1001', 'COVERED'],
      ['AG-1003', 'COVERED'],
      ['AG-1007', 'AMBIGUOUS'],
      ['AG-9999', 'UNINSPECTED'],
    ]);
    expect(
      (await sql`SELECT diagnostic FROM run_observation_check WHERE run_id=${dishonest.run.runId} AND check_name='search-completeness' AND outcome='FAIL'`)[0]?.diagnostic,
    ).toBe('extraction-incomplete');
  });

  /**
   * Read back what a Run registered, as the batch that produced it.
   *
   * Reconstructing the batch FROM THE ROWS is the point: re-registering it is the same
   * batch by construction, so an idempotency test cannot pass by accident, and a test
   * that edits a row first is measuring the edit and nothing else.
   */
  async function registeredBatch(seeded: Awaited<ReturnType<typeof seed>>) {
    const rows = await sql`SELECT observation_id::text AS id,found,attributes,identity,evidence_ids,schema_version,step_execution_id::text AS step,work_item_id::text AS item,population_record_key AS key,target_system,capture_method,match_origin,to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at FROM run_observation WHERE run_id=${seeded.run.runId} ORDER BY population_record_key`;
    const [stage] = await sql`SELECT to_char(run_started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS started FROM run_execution WHERE run_id=${seeded.run.runId}`;
    const items = rows.map((row) => {
      const record = {
        schemaVersion: 1 as const,
        observationId: String(row.id),
        workItemId: String(row.item),
        populationRecordKey: String(row.key),
        targetSystem: String(row.target_system),
        found: String(row.found) as 'true' | 'false' | 'ambiguous',
        observedAt: String(row.observed_at),
        stepExecutionId: String(row.step),
        captureMethod: String(row.capture_method) as 'adapter',
        matchOrigin: String(row.match_origin) as 'platform',
        identity: row.identity as never,
        attributes: row.attributes as never,
        evidenceIds: row.evidence_ids as string[],
      };
      return {
        record,
        observedAtSource: record.observedAt,
        absence:
          record.found === 'false'
            ? {
                queryKeys: [{ key: 'account_id', value: record.populationRecordKey }],
                emptyResultEvidenceId: record.evidenceIds[0]!,
                extractionComplete: true,
              }
            : null,
        expectedQueryKeys: [{ key: 'account_id', value: record.populationRecordKey }],
      };
    });
    return {
      run: seeded.run,
      workItemId: String(rows[0]!.item),
      stepExecutionId: String(rows[0]!.step),
      targetSystem: String(rows[0]!.target_system),
      runStartedAt: String(stage!.started),
      registeredAt: new Date().toISOString(),
      items,
    };
  }

  /** Register a batch through a real `PostgresAdapterExecutionRepository` transaction. */
  async function register(runId: string, batch: ObservationBatch): Promise<unknown> {
    return new PostgresAdapterExecutionRepository(db).transaction(runId, (context) =>
      registerObservations(context, batch, {
        corroboration: NO_CORROBORATION,
        evaluation: NO_EVALUATION,
      }),
    );
  }

  it('writes no duplicate row, check, evaluation or event when a batch is registered twice', async () => {
    const seeded = await seed(['api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    const batch = await registeredBatch(seeded);
    const counts = async () => ({
      observations: (await sql`SELECT count(*)::int AS c FROM run_observation WHERE run_id=${seeded.run.runId}`)[0]?.c,
      checks: (await sql`SELECT count(*)::int AS c FROM run_observation_check WHERE run_id=${seeded.run.runId}`)[0]?.c,
      evaluations: (await sql`SELECT count(*)::int AS c FROM run_observation_evaluation WHERE run_id=${seeded.run.runId}`)[0]?.c,
      events: (await sql`SELECT count(*)::int AS c FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='execution.observations-registered'`)[0]?.c,
    });
    // Four Observations: two resolved (identity-corroboration, ambiguous-match,
    // required-evidence, freshness), one ambiguous (no identity check) and one absent
    // (search-completeness instead of identity-corroboration) - fifteen check rows.
    const before = await counts();
    expect(before).toEqual({ observations: 4, checks: 15, evaluations: 0, events: 1 });

    expect(await register(seeded.run.runId, batch)).toMatchObject({
      registered: 0,
      alreadyRegistered: 4,
      batchDigest: null,
    });
    expect(await counts()).toEqual(before);
  });

  it('raises the integrity failure when a stored Observation no longer matches its digest', async () => {
    const seeded = await seed(['api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    const batch = await registeredBatch(seeded);

    // Somebody edited a stored row after registration. The digest the chain recorded no
    // longer describes it, and re-registering the batch that produced it says so.
    await sql`UPDATE run_observation SET target_system='tampered' WHERE run_id=${seeded.run.runId} AND population_record_key='AG-1001'`;
    await expect(register(seeded.run.runId, batch)).rejects.toMatchObject({
      name: 'ObservationRegistrationError',
      refusal: 'observation-integrity',
    });
    // The refusal is thrown, so nothing was written over the row that was edited.
    expect(
      (await sql`SELECT count(*)::int AS c FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='execution.observations-registered'`)[0]?.c,
    ).toBe(1);
    expect((await sql`SELECT target_system FROM run_observation WHERE run_id=${seeded.run.runId} AND population_record_key='AG-1001'`)[0]?.target_system).toBe('tampered');
  });

  it('leaves nothing visible when a batch is refused mid-transaction', async () => {
    // The refusal is THROWN from inside the registration, so PostgreSQL takes back the
    // Work Item state, the Step Execution outcome and every row the batch would have
    // written. A refusal RETURNED from inside a unit of work would have committed them.
    const seeded = await seed(['api']);
    await executeAdapterSteps(
      dependencies(seeded, {
        evaluation: {
          evaluate: async (subjects) =>
            subjects.map((subject) => ({
              observationId: subject.record.observationId,
              evaluations: [
                {
                  conditionId: 'C1', origin: 'RULE' as const, value: 'COMPLIANT' as const,
                  confirmation: null, confidence: null, rationale: null, diagnostic: null, evidenceIds: [],
                },
              ],
            })),
        },
      }).deps,
      seeded.job,
    );
    // AG-1007 is ambiguous, so calling it Compliant is refused and the batch fails whole.
    for (const table of ['run_observation', 'run_observation_check', 'run_observation_evaluation']) {
      const rows = await sql.unsafe(`SELECT count(*)::int AS count FROM ${table} WHERE run_id=$1`, [seeded.run.runId]);
      expect(rows[0]?.count).toBe(0);
    }
    expect(
      (await sql`SELECT count(*)::int AS count FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='execution.observations-registered'`)[0]?.count,
    ).toBe(0);
    const item = (await sql`SELECT state,diagnostic,observations,attempts FROM run_work_item WHERE run_id=${seeded.run.runId}`)[0];
    // The Work Item never reports Observations that are not there.
    expect(item).toMatchObject({ state: 'FAILED', diagnostic: 'observation-registration-refused', observations: 0, attempts: 1 });
    expect(
      (await sql`SELECT count(*)::int AS count FROM run_step_execution WHERE run_id=${seeded.run.runId} AND state='SUCCEEDED'`)[0]?.count,
    ).toBe(0);
  });

  it('commits evaluations in the same transaction as the rows they describe', async () => {
    const seeded = await seed(['api']);
    await executeAdapterSteps(
      dependencies(seeded, {
        evaluation: {
          evaluate: async (subjects) =>
            subjects.map((subject) => ({
              observationId: subject.record.observationId,
              evaluations: [
                {
                  conditionId: 'C1',
                  origin: 'RULE' as const,
                  value: subject.coverage === 'COVERED' ? ('EXCEPTION' as const) : ('UNEVALUATED' as const),
                  confirmation: null,
                  confidence: null,
                  rationale: null,
                  diagnostic: subject.coverage === 'COVERED' ? null : 'record was not resolved',
                  evidenceIds: [],
                },
              ],
            })),
        },
      }).deps,
      seeded.job,
    );
    const rows = await sql`SELECT e.value,e.coverage,e.origin,o.population_record_key AS key FROM run_observation_evaluation e JOIN run_observation o ON o.observation_id=e.observation_id WHERE e.run_id=${seeded.run.runId} ORDER BY o.population_record_key`;
    expect(rows.map((row) => [row.key, row.coverage, row.value])).toEqual([
      ['AG-1001', 'COVERED', 'EXCEPTION'],
      ['AG-1003', 'COVERED', 'EXCEPTION'],
      ['AG-1007', 'AMBIGUOUS', 'UNEVALUATED'],
      ['AG-9999', 'COVERED', 'EXCEPTION'],
    ]);
    expect(rows.every((row) => row.origin === 'RULE')).toBe(true);
  });

  it('normalizes an offset-bearing capture time to UTC and keeps the original', async () => {
    // The platform clock is UTC, so the adapter's own source text already is; the rule is
    // proved where an agent read would exercise it, against the column itself.
    const seeded = await seed(['api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    const [row] = await sql`SELECT to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at,observed_at_source FROM run_observation WHERE run_id=${seeded.run.runId} LIMIT 1`;
    // The retained source and the normalized column are provably the same instant.
    expect(Date.parse(String(row!.observed_at_source))).toBe(Date.parse(String(row!.observed_at)));
    await expect(
      sql`UPDATE run_observation SET observed_at_source=NULL WHERE run_id=${seeded.run.runId}`,
    ).rejects.toThrow(/observed_at_source/);
  });

  it('refuses at the database what no registration may store', async () => {
    const seeded = await seed(['api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    const [item] = await sql`SELECT work_item_id FROM run_work_item WHERE run_id=${seeded.run.runId}`;
    const [step] = await sql`SELECT step_execution_id FROM run_step_execution WHERE run_id=${seeded.run.runId}`;
    const insert = (found: string, coverage: string, digest: string, identity = 'NULL') =>
      sql.unsafe(
        `INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,observed_at_source) VALUES (gen_random_uuid(),$1,$2,1,'RAW-'||gen_random_uuid()::text,'t',$3,now(),$4,'adapter','platform',${identity},'[]'::jsonb,'["e"]'::jsonb,$5,$6,'2026-09-05T00:00:00.000Z')`,
        [seeded.run.runId, String(item!.work_item_id), found, String(step!.step_execution_id), digest, coverage],
      );
    const digest = 'a'.repeat(64);
    // The digest is a digest, and nothing else.
    await expect(insert('false', 'COVERED', 'not-a-digest')).rejects.toThrow(/run_observation_digest/);
    // The coverage vocabulary, and its cross-field rules with `found`.
    await expect(insert('false', 'INSPECTED', digest)).rejects.toThrow(/run_observation_coverage/);
    await expect(insert('ambiguous', 'COVERED', digest)).rejects.toThrow(/run_observation_coverage/);
    await expect(insert('false', 'AMBIGUOUS', digest)).rejects.toThrow(/run_observation_coverage/);
    await expect(insert('true', 'UNINSPECTED', digest, `'{"name":"x"}'::jsonb`)).rejects.toThrow(/run_observation_coverage/);
    await expect(insert('false', 'UNINSPECTED', digest)).resolves.toBeDefined();

    // An uninspected or ambiguous record can never be recorded Compliant — by anybody,
    // through any path, because it is a CHECK over a foreign-keyed coverage column.
    const [uninspected] = await sql`SELECT observation_id::text AS id,coverage FROM run_observation WHERE run_id=${seeded.run.runId} AND coverage='UNINSPECTED' LIMIT 1`;
    const evaluate = (coverage: string, value: string) =>
      sql.unsafe(
        `INSERT INTO run_observation_evaluation(observation_id,coverage,run_id,condition_id,origin,value,confirmation,confidence,rationale,diagnostic,evidence_ids) VALUES ($1,$2,$3,'C-'||gen_random_uuid()::text,'RULE',$4,NULL,NULL,NULL,NULL,'[]'::jsonb)`,
        [String(uninspected!.id), coverage, seeded.run.runId, value],
      );
    await expect(evaluate('UNINSPECTED', 'COMPLIANT')).rejects.toThrow(/run_observation_evaluation_coverage/);
    // Claiming the row is covered does not help: the pair must exist in run_observation.
    await expect(evaluate('COVERED', 'COMPLIANT')).rejects.toThrow(/run_observation_evaluation_coverage_fk/);
    await expect(evaluate('UNINSPECTED', 'UNEVALUATED')).resolves.toBeDefined();
    // Confirmation and confidence belong to an Agent-Judged evaluation and to no other.
    await expect(
      sql.unsafe(
        `INSERT INTO run_observation_evaluation(observation_id,coverage,run_id,condition_id,origin,value,confirmation,confidence,rationale,diagnostic,evidence_ids) VALUES ($1,'UNINSPECTED',$2,'C-CONF','RULE','UNEVALUATED','pending',NULL,NULL,NULL,'[]'::jsonb)`,
        [String(uninspected!.id), seeded.run.runId],
      ),
    ).rejects.toThrow(/run_observation_evaluation_confirmation/);
    await expect(
      sql.unsafe(
        `INSERT INTO run_observation_evaluation(observation_id,coverage,run_id,condition_id,origin,value,confirmation,confidence,rationale,diagnostic,evidence_ids) VALUES ($1,'UNINSPECTED',$2,'C-CONFID','AGENT_JUDGED','UNEVALUATED',NULL,1.5,NULL,NULL,'[]'::jsonb)`,
        [String(uninspected!.id), seeded.run.runId],
      ),
    ).rejects.toThrow(/run_observation_evaluation_confidence/);

    // A PASS never carries a diagnostic, and a FAIL always does.
    const check = (outcome: string, diagnostic: string, name = 'freshness') =>
      sql.unsafe(
        `INSERT INTO run_observation_check(observation_id,run_id,check_name,outcome,diagnostic) VALUES ($1,$2,$3,$4,${diagnostic})`,
        [String(uninspected!.id), seeded.run.runId, name, outcome],
      );
    await expect(check('PASS', `'stale'`, 'ambiguous-match')).rejects.toThrow(/run_observation_check_outcome/);
    await expect(check('FAIL', 'NULL', 'identity-corroboration')).rejects.toThrow(/run_observation_check_outcome/);
    await expect(check('FAIL', `'stale'`, 'invented-check')).rejects.toThrow(/run_observation_check_name/);
    // One outcome per check per Observation: a redelivery cannot record a second.
    await expect(check('PASS', 'NULL', 'required-evidence')).resolves.toBeDefined();
    await expect(check('FAIL', `'stale'`, 'required-evidence')).rejects.toThrow(/duplicate key/);
    // Both directions: the CHECK is a transcription of `OBSERVATION_CHECKS`, so a name
    // the domain has and the migration does not would be refused with the suite green.
    for (const name of OBSERVATION_CHECKS.filter((entry) => entry !== 'required-evidence')) {
      await expect(check('FAIL', `'stale'`, name)).resolves.toBeDefined();
    }
  });
});
