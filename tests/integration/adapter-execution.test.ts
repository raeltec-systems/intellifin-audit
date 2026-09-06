import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acquirePopulation,
  executeAdapterSteps,
  NO_EVALUATION,
  sealPackage,
  verifySealedPackage,
  initiateRun,
  NO_CORROBORATION,
  PopulationAcquisitionError,
  registerObservations,
  snapshotCorroboration,
  type ObservationBatch,
  type ObservationBatchItem,
  type AcquiredArtifact,
  type EvidenceStore,
  type ObservationCorroborationPort,
  type ExceptionFingerprinter,
  type ObservationEvaluationPort,
  type ResolvedCredential,
} from '@intellifin/application';
import {
  adapterExtractionScope,
  bindingDigest,
  bindingDigestEnvelope,
  exceptionFingerprint,
  exceptionIdFor,
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
import { resolvedCredential } from '@intellifin/infrastructure/credentials';
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

/**
 * A role expansion that actually covers `ACCOUNT_ROWS` (Story 3.7).
 *
 * Separate from `ROLE_MATRIX` above, whose row positions the Story 3.6 sheet-locator test
 * depends on. AP_CLERK expands cleanly; VENDOR_MAINTAINER + VENDOR_APPROVER carry the
 * prohibited pair CREATE_VENDOR + APPROVE_VENDOR, which is the Exception.
 */
const SOD_ROLE_MATRIX = [
  'entry,role,permission',
  '1,AP_CLERK,CREATE_PAYMENT',
  '1,AP_CLERK,VIEW_PAYMENT',
  '2,VENDOR_MAINTAINER,CREATE_VENDOR',
  '2,VENDOR_MAINTAINER,VIEW_VENDOR',
  '3,VENDOR_APPROVER,APPROVE_VENDOR',
  '4,OPS_CLERK,VIEW_LOAN',
  '5,LOAN_ADMIN,CONFIGURE_LIMITS',
  '',
].join('\n');

/** A fingerprinter with a known key, so a test can recompute what it should have written. */
const FINGERPRINT_KEY = 'story-3-7-integration-fingerprint-key';
const FINGERPRINTER: ExceptionFingerprinter = {
  keyId: 'k-integration',
  fingerprint: (envelope) => exceptionFingerprint(utf8Bytes(FINGERPRINT_KEY), envelope),
};

const POPULATION = 'account_id,status\nAG-1001,Active\nAG-1003,Active\nAG-1007,Active\nAG-9999,Active\n';

/**
 * Story 3.6's extraction: `007` and `7` are two different accounts, and one row carries a
 * capture time with a source offset. Both are things a corroboration has to keep apart.
 */
const CORROBORATION_ROWS = [
  { account_id: 'AG-1001', roles: ['AP_CLERK'], status: 'Active', opened_at: '2026-08-10T10:30:00+02:00' },
  { account_id: '007', roles: ['OPS_CLERK'], status: 'Active', opened_at: '2026-08-11T00:00:00Z' },
  { account_id: '7', roles: ['OPS_CLERK'], status: 'Disabled', opened_at: '2026-08-12T00:00:00Z' },
  { account_id: 'AG-2002', roles: ['RISK_ANALYST'], status: 'Active', opened_at: '2026-08-13T00:00:00Z' },
];
const CORROBORATION_ACCOUNTS = collection('accounts', CORROBORATION_ROWS, [
  'account_id', 'roles', 'status', 'opened_at',
]);
/** Every key IS in the extraction: what the adapter itself corroborates. */
const CORROBORATION_POPULATION = 'account_id,status\nAG-1001,Active\n007,Active\n7,Active\nCORR-9999,Active\n';
/** No key is in the extraction, so every extraction row is free for a hand-built batch. */
const DISJOINT_POPULATION = 'account_id,status\nZZ-1,Active\nZZ-2,Active\n';

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
/** The same approvals with no completeness declaration: an absence from it proves nothing. */
const INCOMPLETE_APPROVALS = JSON.stringify({
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

/** The same population plus one row nothing can place in or out of the Period. */
const UNACCOUNTED_TRANSACTIONS = TRANSACTIONS + 'TX-500007,180000.00,USD,\n';

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
          // Story 3.8: the Run-level Gate's own rows carry a real foreign key to
          // `audit_run`, so they go before it or the whole cleanup fails and every later
          // run of this file inherits the rows this one left.
          await sql`DELETE FROM run_gate_check WHERE run_id=${run.id}`;
          // Story 3.9: the sealed Result names its Run with a real foreign key, so it
          // goes before the Run — a teardown that does not know about a new table
          // takes the whole file's cleanup with it.
          await sql`DELETE FROM run_result WHERE run_id=${run.id}`;
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
  async function seed(
    kinds: readonly ('api' | 'versioned-file' | 'web')[],
    templateId: 'P-2' | 'P-3' = 'P-2',
    population?: string,
  ) {
    const p3 = templateId === 'P-3';
    const body = population ?? (p3 ? TRANSACTIONS : POPULATION);
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
      exceptions?: ExceptionFingerprinter;
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
          // The REAL factory, so `redact` and `discloses` are the real ones: a hand-made
          // stub whose redaction is the identity would let these tests assert a
          // containment this build does not actually provide (Story 4.3).
          resolve: async (reference: string): Promise<ResolvedCredential> =>
            resolvedCredential(reference, TOKEN),
        },
        store: seeded.store,
        clock: new SystemClock(),
        ids,
        // Story 3.7. The fingerprint key, as a port. Neither the evaluator nor the
        // corroborator is a dependency: both are built inside the stage from the plan it
        // is executing and the bytes it just froze.
        exceptions: options.exceptions ?? FINGERPRINTER,
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
    // Story 3.8: the Run-level Gate runs when the last Work Item completes. This
    // population has an ambiguous match and an absent record, so it concludes INCONCLUSIVE
    // rather than staying RUNNING.
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${seeded.run.runId}`)[0]?.state).toBe('INCONCLUSIVE');
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

  it('carries a Run with an unaccounted row to the Run-level Gate rather than ending it', async () => {
    // §H's early-stop row is "Population acquisition", which is about acquisition FAILING;
    // an indeterminate row is not that, and §E decides the Gate rows after the last Work
    // Item. So the Run executes, its other transactions get Observations, evaluations and
    // whatever Exceptions they earn, and `count-reconciliation-inclusion` concludes it
    // INCONCLUSIVE at the end. The outcome is the one an indeterminate row always had;
    // what changed is WHEN it is decided and what exists by then.
    const seeded = await seed(['api'], 'P-3', UNACCOUNTED_TRANSACTIONS);
    const [population] = await sql`SELECT status,checks FROM population_snapshot s JOIN population_execution e USING (run_id) WHERE run_id=${seeded.run.runId}`;
    expect(population!.status).toBe('POPULATION_READY');
    expect(
      (population!.checks as { name: string; passed: boolean }[]).filter((check) => !check.passed),
    ).toEqual([{ name: 'complete-inclusion', passed: false }]);
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${seeded.run.runId}`)[0]?.state).toBe('RUNNING');

    await executeAdapterSteps(
      dependencies(seeded, {
        extract: async (_target, credential) => {
          credential.authorize({ set: () => undefined });
          return { bytes: utf8Bytes(APPROVALS), mediaType: 'application/json', location: 'https://synthetic.invalid/approvals' };
        },
      }).deps,
      seeded.job,
    );

    // The Work Item ran and the included transactions were judged. TX-500007 is not among
    // them: the inclusion rule could not place it, so it never becomes an Observation.
    expect((await sql`SELECT state,observations FROM run_work_item WHERE run_id=${seeded.run.runId}`)[0])
      .toMatchObject({ state: 'OBSERVED', observations: 3 });
    const evaluations = await sql`SELECT o.population_record_key AS key,e.value FROM run_observation_evaluation e JOIN run_observation o ON o.observation_id=e.observation_id WHERE e.run_id=${seeded.run.runId} ORDER BY o.population_record_key`;
    expect(evaluations.map((row) => String(row.key))).toEqual(['TX-500001', 'TX-500003', 'TX-500009']);

    // And the Gate concluded it, on the row that owns an unaccounted population record.
    const gate = await sql`SELECT check_name,outcome,diagnostics,total FROM run_gate_check WHERE run_id=${seeded.run.runId} AND outcome='FAIL' ORDER BY check_name`;
    const inclusion = gate.find((row) => row.check_name === 'count-reconciliation-inclusion');
    expect(inclusion).toBeDefined();
    expect(inclusion!.diagnostics).toEqual(['rows-unaccounted']);
    // ONE unaccounted row, counted once: the recorded check and the Gate's own arithmetic
    // say the same thing, and `total` is exact.
    expect(inclusion!.total).toBe(1);
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${seeded.run.runId}`)[0]?.state).toBe('INCONCLUSIVE');
    expect((await sql`SELECT run_state FROM run_evidence_package WHERE run_id=${seeded.run.runId}`)[0]?.run_state)
      .toBe('INCONCLUSIVE');
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

  it('REFUSES to register an extraction that echoed the credential, and stores nothing', async () => {
    // Story 4.3, against a real PostgreSQL and a real Evidence store. The credential
    // reached the artifact by a path nobody predicted — the Target System answered with it
    // — and the bytes are exactly what it served, so they are REFUSED rather than rewritten.
    const seeded = await seed(['api']);
    const before = new Set(seeded.objects.keys());
    const { deps } = dependencies(seeded, {
      extract: async (_target, credential) => {
        const headers = new Map<string, string>();
        credential.authorize({ set: (name, value) => headers.set(name, value) });
        return {
          bytes: utf8Bytes(`{"you_sent":${JSON.stringify(headers.get('authorization'))},"rows":[]}`),
          mediaType: 'application/json',
          location: 'https://synthetic.invalid/x',
        };
      },
    });
    await executeAdapterSteps(deps, seeded.job);

    const [item] = await sql<{ state: string; diagnostic: string; attempts: number }[]>`
      SELECT state, diagnostic, attempts FROM run_work_item WHERE run_id=${seeded.run.runId}`;
    expect(item).toMatchObject({ state: 'FAILED', diagnostic: 'extraction-credential-disclosed' });
    // Terminal on the FIRST attempt: the same bytes disclose the same credential every
    // time, so seven more attempts against a live system prove nothing.
    expect(item?.attempts).toBe(1);

    // Nothing was stored. The scan runs BEFORE the upload, because the object store is
    // immutable by design and an artifact that reached it could not be taken back out.
    for (const key of seeded.objects.keys()) expect(before.has(key)).toBe(true);
    for (const bytes of seeded.objects.values()) {
      expect(new TextDecoder().decode(bytes)).not.toContain(TOKEN);
    }
    // The Evidence row was reserved and never registered, and the seal then ABANDONED it —
    // `SealPackage` is the one thing that does, and an abandoned reservation with no digest
    // is the truthful record of an artifact this platform refused to keep.
    const evidence = await sql<{ state: string; digest: string | null }[]>`
      SELECT state, digest FROM run_evidence WHERE run_id=${seeded.run.runId} AND kind='adapter-extraction'`;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ state: 'ABANDONED', digest: null });

    // And the token is in nothing the Run stored, including the diagnostic that says why.
    const dumps = await Promise.all([
      sql`SELECT payload::text AS text FROM audit_events WHERE aggregate_id=${seeded.run.runId}`,
      sql`SELECT row_to_json(t)::text AS text FROM run_evidence t WHERE run_id=${seeded.run.runId}`,
      sql`SELECT row_to_json(t)::text AS text FROM run_work_item t WHERE run_id=${seeded.run.runId}`,
      sql`SELECT row_to_json(t)::text AS text FROM run_gate_check t WHERE run_id=${seeded.run.runId}`,
      sql`SELECT row_to_json(t)::text AS text FROM run_result t WHERE run_id=${seeded.run.runId}`,
    ]);
    for (const rows of dumps) for (const row of rows) expect(String(row.text)).not.toContain(TOKEN);

    // A Work Item failure never stops a Run. The Gate concluded it on the coverage this
    // item never produced.
    const [run] = await sql<{ state: string }[]>`SELECT state FROM audit_run WHERE run_id=${seeded.run.runId}`;
    expect(run?.state).toBe('INCONCLUSIVE');
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
    // A failed Work Item never stops the Run: the NEXT one ran, and the stage reached its
    // own completion. The Run then concludes at the Run-level Gate, on coverage.
    expect((await sql`SELECT status FROM run_execution WHERE run_id=${seeded.run.runId}`)[0]?.status).toBe('EXTRACTION_COMPLETE');
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${seeded.run.runId}`)[0]?.state).toBe('INCONCLUSIVE');
    // The failed Work Item's reservation was still OPEN when the Run reached its terminal
    // transition, so `SealPackage` abandoned it there and listed it (Story 3.5). What
    // matters here is that it never became a registered artifact.
    const reservation = await sql`SELECT state,digest FROM run_evidence WHERE run_id=${seeded.run.runId} AND registration_id=${first}`;
    expect(reservation[0]).toMatchObject({ state: 'ABANDONED', digest: null });
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

    // A redelivery of a claim that crashed before it committed. The stage's completion,
    // the Gate, the terminal state and the seal all commit in ONE transaction, so a resume
    // can never see one of them without the others — the Run is RUNNING again with it.
    await unseal(seeded);
    await sql`UPDATE run_execution SET status='RETRY' WHERE run_id=${seeded.run.runId}`;
    await executeAdapterSteps(new PostgresAdapterExecutionRepository(db) === null ? deps : { ...deps, repository: new PostgresAdapterExecutionRepository(db) }, seeded.job);

    expect(extractions).toBe(1);
    expect((await sql`SELECT count(*)::int AS count FROM run_observation WHERE run_id=${seeded.run.runId}`)[0]?.count).toBe(4);
    // A real redelivery: the completed Work Item is skipped, so the registration event
    // and every per-Observation check outcome exist exactly once.
    expect((await sql`SELECT count(*)::int AS count FROM run_observation_check WHERE run_id=${seeded.run.runId}`)[0]?.count).toBe(19);
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

    await unseal(seeded);
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
        `INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,observed_at_source,corroboration) VALUES ($1,$2,$3,1,'X-'||gen_random_uuid()::text,'t',$4,now(),$5,'adapter','platform',${identity},'[]'::jsonb,'["e"]'::jsonb,repeat('a',64),CASE $4 WHEN 'ambiguous' THEN 'AMBIGUOUS' WHEN 'true' THEN 'COVERED' ELSE 'UNINSPECTED' END,'2026-09-05T00:00:00.000Z','UNJUDGED')`,
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

  /**
   * Put a Run back where Story 3.5's tests need it: RUNNING, with an unsealed package.
   *
   * Story 3.8 made the adapter stage run the Run-level Gate when the last Work Item
   * completes, so `executeAdapterSteps` now ends with a terminal Run and a SEALED package
   * — and generation 21 then freezes every Evidence row of that Run. The tests below are
   * about the SEAL MECHANISM and need a package to act on, so they undo the Gate's one
   * first. Both statements are in ONE transaction because `audit_run_requires_seal` is a
   * DEFERRED constraint trigger: it is checked at commit, where the Run is RUNNING again.
   */
  async function unseal(seeded: Awaited<ReturnType<typeof seed>>): Promise<void> {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM run_evidence_package WHERE run_id=${seeded.run.runId}`;
      await tx`DELETE FROM run_gate_check WHERE run_id=${seeded.run.runId}`;
      await tx`UPDATE audit_run SET state='RUNNING' WHERE run_id=${seeded.run.runId}`;
    });
  }

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
        await sql`SELECT step_id,${kind === 'reference-source' ? sql`1 AS attempts` : sql`attempts`} FROM ${sql(kind === 'reference-source' ? 'run_session_step' : 'run_work_item')} WHERE run_id=${seeded.run.runId}`;
      // An adapter extraction is named from the Run, the kind, the frozen step id AND the
      // ATTEMPT; a Reference Source is named without one. The attempt is there because a
      // Work Item freezes its response before it parses it and keeps failed bytes
      // registered, so a second attempt has different bytes to freeze and the store
      // reconciles rather than overwrites — with one key per step, every retry read back
      // attempt 1's object and died accusing the store of an integrity failure. A Session
      // Step is acquired without being parsed, so its retries only ever run when nothing
      // was frozen at all.
      const scope =
        kind === 'adapter-extraction'
          ? adapterExtractionScope(String(step!.step_id), Number(step!.attempts))
          : String(step!.step_id);
      const reservation = { runId: seeded.run.runId, kind, scope };
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
    await unseal(seeded);
    const seal = await sealAt(seeded, 'COMPLETED');
    expect(seal).toMatchObject({ state: 'SEALED', missingRequired: [], abandoned: [] });
    const [row] =
      await sql`SELECT state,run_state,required_total,registered,missing_required,abandoned FROM run_evidence_package WHERE run_id=${seeded.run.runId}`;
    expect(row).toMatchObject({ state: 'SEALED', run_state: 'COMPLETED', required_total: 2, registered: 3 });
    expect(row!.missing_required).toEqual([]);
    expect(row!.abandoned).toEqual([]);
    // The LAST seal event: the Run-level Gate sealed once at its own terminal transition
    // and `unseal` removed only the row, not the chain, so the event this seal appended is
    // the one at the end.
    const events =
      await sql`SELECT payload FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='lifecycle.evidence-package-sealed' ORDER BY sequence`;
    expect(events.at(-1)!.payload).toMatchObject({ seal: 'SEALED', runState: 'COMPLETED' });
  });

  it('refuses to DELETE an Evidence row while its package still claims it, and still lets a whole Run go', async () => {
    // Generation 21 froze a sealed Run's Evidence against INSERT and UPDATE and left DELETE
    // alone so that a whole Run could be removed. Deleting ONE artifact row while the
    // package survives is not that: the package goes on naming an artifact whose metadata
    // is gone, and the post-Run sweep cannot see it — `readRegisteredArtifacts` no longer
    // returns it, so nothing is read, nothing fails and no finding is recorded, while the
    // Run page keeps printing "registered and verified".
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    const runId = seeded.run.runId;
    expect((await sql`SELECT state FROM run_evidence_package WHERE run_id=${runId}`)[0]).toBeDefined();
    // Clear only what NAMES the Evidence with a foreign key, exactly as this file's own
    // teardown does, so what follows is the trigger's answer and not a foreign key's.
    await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
    await sql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
    await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
    await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
    await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
    await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;

    await expect(sql`DELETE FROM run_evidence WHERE run_id=${runId}`)
      .rejects.toThrow(/Evidence for Run .* is frozen: its package is sealed/);
    await expect(sql`DELETE FROM population_evidence WHERE run_id=${runId}`)
      .rejects.toThrow(/Evidence for Run .* is frozen: its package is sealed/);
    // Nothing was removed by either refusal.
    expect(
      Number((await sql`SELECT count(*)::int AS c FROM run_evidence WHERE run_id=${runId}`)[0]!['c']),
    ).toBeGreaterThan(0);
    expect(
      Number((await sql`SELECT count(*)::int AS c FROM population_evidence WHERE run_id=${runId}`)[0]!['c']),
    ).toBe(1);

    // And removing the WHOLE Run still works: the seal goes first, and then everything it
    // sealed. That is what "removing a whole Run" means, and it is what every teardown in
    // this suite performs.
    await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
    await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
    await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
    await sql`DELETE FROM population_evidence WHERE run_id=${runId}`;
    expect(
      Number((await sql`SELECT count(*)::int AS c FROM run_evidence WHERE run_id=${runId}`)[0]!['c']),
    ).toBe(0);
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
    // Attempt 1's artifact: an adapter extraction reserves per ATTEMPT, because a Work Item
    // freezes a response before it parses it and a retry therefore has different bytes.
    const key = `extraction/${seeded.run.runId}/${adapterExtractionScope(String(item!.step_id), 1)}`;
    await unseal(seeded);
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
    await unseal(seeded);
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

  it('gives the sweep its OWN bounded read of the packages to re-verify', async () => {
    // `verifySealedPackage` had no production caller, so nothing ever re-read a sealed
    // artifact. The caller is a bounded worker sweep, and this is the read it runs on: its
    // own, not a surface's — the probe sweep that borrowed `listRegistrations` probed
    // nothing while exiting 0, because that read was capped and included retired rows.
    const first = await seed(['api']);
    await executeAdapterSteps(dependencies(first).deps, first.job);
    await sealAt(first, 'INCONCLUSIVE');
    const second = await seed(['api']);
    await executeAdapterSteps(dependencies(second).deps, second.job);
    await sealAt(second, 'INCONCLUSIVE');
    const repository = new PostgresSealedPackageRepository(db);

    const ordered = [first.run.runId, second.run.runId].sort();
    const page = await repository.verifiableRunIds(null, 100);
    expect(page.filter((id) => ordered.includes(id))).toEqual(ordered);
    // Keyset, in Run-id order, so a cursor carried between ticks reaches every package
    // rather than re-reading the first page forever.
    const after = await repository.verifiableRunIds(ordered[0]!, 100);
    expect(after.filter((id) => ordered.includes(id))).toEqual([ordered[1]]);
    expect(await repository.verifiableRunIds(null, 1)).toHaveLength(1);
    // A cursor that is not a Run id starts the rotation over rather than making PostgreSQL
    // refuse a `uuid` comparison against text with 22P02.
    expect((await repository.verifiableRunIds('not-a-run', 100)).length).toBe(page.length);

    // And what the sweep does with those ids is the command that changes no state.
    const verifyDeps = { repository, store: first.store, clock: new SystemClock(), ids };
    expect(await verifySealedPackage(verifyDeps, first.run.runId)).toMatchObject({ recorded: 0 });
  });

  it('refuses at the database what no seal may store', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    const [step] = await sql`SELECT step_id FROM run_session_step WHERE run_id=${seeded.run.runId}`;
    const key = `reference/${seeded.run.runId}/${String(step!.step_id)}`;
    // A required artifact that is not REGISTERED.
    await unseal(seeded);
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
    // The Run-level Gate already sealed this package at its terminal transition (Story
    // 3.8), and a second seal returns the first unchanged.
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
    // P-2's §C coverage rule is satisfied only when every population account "appears in
    // the extraction with a grounded role list", so AG-9999 — absent, and honestly so —
    // is `UNINSPECTED` rather than covered.
    expect(payload['coverage']).toEqual({ COVERED: 2, UNINSPECTED: 1, AMBIGUOUS: 1 });

    // Per-Observation check outcomes committed with the rows.
    const checks = await sql`SELECT check_name,outcome,diagnostic FROM run_observation_check WHERE run_id=${seeded.run.runId} ORDER BY check_name`;
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.filter((row) => row.outcome === 'FAIL')).toEqual([
      { check_name: 'ambiguous-match', outcome: 'FAIL', diagnostic: 'ambiguous-match' },
    ]);
    expect(new Set(checks.map((row) => row.check_name))).toEqual(
      new Set([
        'identity-corroboration', 'search-completeness', 'ambiguous-match', 'required-evidence',
        'freshness', 'observation-corroboration',
      ]),
    );
  });

  it('covers an honest absence and leaves a dishonest one UNINSPECTED', async () => {
    // P-3, whose §C coverage rule is "a grounded approval lookup result (found or proven
    // absent)". That is the rule under which the three legs of an honest absence decide
    // anything at all; under P-2's `must-appear` every absence is `UNINSPECTED` whatever
    // it proves, so this test written against P-2 would pass against an implementation
    // that had none of the legs. TX-500003 has no approval row.
    const honest = await seed(['api'], 'P-3');
    await executeAdapterSteps(dependencies(honest).deps, honest.job);
    expect(
      (await sql`SELECT coverage FROM run_observation WHERE run_id=${honest.run.runId} AND population_record_key='TX-500003'`)[0]?.coverage,
    ).toBe('COVERED');

    // The same extraction with no completeness declaration. "Not in the system" is then
    // really "not on the page I happened to read", so nobody proved they looked.
    const dishonest = await seed(['api'], 'P-3');
    await executeAdapterSteps(
      dependencies(dishonest, {
        extract: async (_target, credential) => {
          credential.authorize({ set: () => undefined });
          return { bytes: utf8Bytes(INCOMPLETE_APPROVALS), mediaType: 'application/json', location: 'x' };
        },
      }).deps,
      dishonest.job,
    );
    const rows = await sql`SELECT population_record_key AS key,coverage FROM run_observation WHERE run_id=${dishonest.run.runId} ORDER BY population_record_key`;
    expect(rows.map((row) => [row.key, row.coverage])).toEqual([
      ['TX-500001', 'COVERED'],
      ['TX-500003', 'UNINSPECTED'],
      ['TX-500009', 'AMBIGUOUS'],
    ]);
    expect(
      (await sql`SELECT diagnostic FROM run_observation_check WHERE run_id=${dishonest.run.runId} AND check_name='search-completeness' AND outcome='FAIL'`)[0]?.diagnostic,
    ).toBe('extraction-incomplete');
  });

  it('leaves a P-2 account proven absent UNINSPECTED, and never Compliant', async () => {
    // §H computes per-record coverage "per the Template's coverage rule (§C)", and P-2's
    // rule has no "or proven absent": an account whose permissions nothing could read is a
    // gap. It used to be COMPLIANT — the absence made P-2's frozen `found = true`
    // applicability not apply, and compiler 1 gives a non-applicable condition the value
    // COMPLIANT — so an account nobody could inspect passed its own control.
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(
      dependencies(seeded, {
        reference: async () => ({
          bytes: utf8Bytes(SOD_ROLE_MATRIX), mediaType: 'text/csv', location: 'https://synthetic.invalid/rm.csv',
        }),
      }).deps,
      seeded.job,
    );
    const [row] = await sql`SELECT coverage,found FROM run_observation WHERE run_id=${seeded.run.runId} AND population_record_key='AG-9999'`;
    expect(row).toMatchObject({ found: 'false', coverage: 'UNINSPECTED' });
    // The absence proof is still HONEST, and `search-completeness` still says so: whether
    // the adapter looked is a different question from whether this Template accepts an
    // absence as coverage.
    const checks = await sql`SELECT outcome FROM run_observation_check c JOIN run_observation o ON o.observation_id=c.observation_id WHERE c.run_id=${seeded.run.runId} AND c.check_name='search-completeness' AND o.population_record_key='AG-9999'`;
    expect(checks.map((entry) => entry.outcome)).toEqual(['PASS']);
    // Every condition Unevaluated, and no Exception raised on a record nobody inspected.
    const evaluations = await sql`SELECT e.value,e.coverage,e.diagnostic FROM run_observation_evaluation e JOIN run_observation o ON o.observation_id=e.observation_id WHERE e.run_id=${seeded.run.runId} AND o.population_record_key='AG-9999'`;
    expect(evaluations.map((entry) => [entry.coverage, entry.value])).toEqual([['UNINSPECTED', 'UNEVALUATED']]);
    expect(String(evaluations[0]!.diagnostic)).toContain(
      'missing, ambiguous, contradictory, uninspected, or unproven Evidence',
    );
    expect(
      (await sql`SELECT count(*)::int AS c FROM run_exception WHERE run_id=${seeded.run.runId} AND population_record_key='AG-9999'`)[0]?.c,
    ).toBe(0);
    // The database refuses to call it Compliant, whatever an evaluator offered.
    const [observation] = await sql`SELECT observation_id::text AS id FROM run_observation WHERE run_id=${seeded.run.runId} AND population_record_key='AG-9999'`;
    await expect(
      sql.unsafe(
        `INSERT INTO run_observation_evaluation(observation_id,coverage,corroboration,run_id,condition_id,origin,value,confirmation,confidence,rationale,diagnostic,evidence_ids) VALUES ($1,'UNINSPECTED','UNJUDGED',$2,'C-FORCED','RULE','COMPLIANT',NULL,NULL,NULL,NULL,'[]'::jsonb)`,
        [String(observation!.id), seeded.run.runId],
      ),
    ).rejects.toThrow(/run_observation_evaluation_coverage/);
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
      templateId: 'P-2',
      runStartedAt: String(stage!.started),
      registeredAt: new Date().toISOString(),
      items,
    };
  }

  /** Register a batch through a real `PostgresAdapterExecutionRepository` transaction. */
  async function register(
    runId: string,
    batch: ObservationBatch,
    seams: Partial<{
      corroboration: ObservationCorroborationPort;
      evaluation: ObservationEvaluationPort;
      exceptions: ExceptionFingerprinter;
    }> = {},
  ): Promise<unknown> {
    return new PostgresAdapterExecutionRepository(db).transaction(runId, (context) =>
      registerObservations(context, batch, {
        corroboration: seams.corroboration ?? NO_CORROBORATION,
        evaluation: seams.evaluation ?? NO_EVALUATION,
        exceptions: seams.exceptions ?? FINGERPRINTER,
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
    // Four Observations, each with `ambiguous-match`, `required-evidence`, `freshness`
    // and `observation-corroboration`; the two resolved ones add `identity-corroboration`
    // and the absent one adds `search-completeness` - nineteen check rows.
    const before = await counts();
    // Four evaluations: P-2 has one condition and every Observation is judged by it.
    expect(before).toEqual({ observations: 4, checks: 19, evaluations: 4, events: 1 });

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

  it('raises the integrity failure when the retained capture time was rewritten', async () => {
    const seeded = await seed(['api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    const batch = await registeredBatch(seeded);

    // §B's retained provenance sits OUTSIDE the thirteen hashed wire keys, so the digest
    // column still matches after this UPDATE and the check above cannot see it. It is the
    // repository read that has to bring the column back, and registration that has to
    // re-derive it: without both, a redelivered batch reported this row as already
    // registered and the capture provenance was silently rewritten.
    await sql`UPDATE run_observation SET observed_at_source='2026-01-01T00:00:00+05:00' WHERE run_id=${seeded.run.runId} AND population_record_key='AG-1001'`;
    await expect(register(seeded.run.runId, batch)).rejects.toMatchObject({
      name: 'ObservationRegistrationError',
      refusal: 'observation-integrity',
    });
    // Thrown, so nothing was written over the row that was edited.
    expect(
      (await sql`SELECT count(*)::int AS c FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='execution.observations-registered'`)[0]?.c,
    ).toBe(1);
  });

  it('leaves nothing visible when a batch is refused mid-transaction', async () => {
    // The refusal is THROWN from inside the registration, so PostgreSQL takes back the
    // Work Item state, the Step Execution outcome and every row the batch would have
    // written. A refusal RETURNED from inside a unit of work would have committed them.
    //
    // The refusal is driven by a fingerprinter that answers with something that is not a
    // fingerprint. AG-1003 carries a prohibited pair, so an Exception is raised, and a
    // permanent row that can never be updated must not be written with a value nobody can
    // later check.
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(
      dependencies(seeded, {
        reference: async () => ({
          bytes: utf8Bytes(SOD_ROLE_MATRIX), mediaType: 'text/csv', location: 'https://synthetic.invalid/rm.csv',
        }),
        exceptions: { keyId: 'k-integration', fingerprint: () => 'not-a-fingerprint' },
      }).deps,
      seeded.job,
    );
    for (const table of ['run_observation', 'run_observation_check', 'run_observation_evaluation', 'run_exception']) {
      const rows = await sql.unsafe(`SELECT count(*)::int AS count FROM ${table} WHERE run_id=$1`, [seeded.run.runId]);
      expect(rows[0]?.count).toBe(0);
    }
    expect(
      (await sql`SELECT count(*)::int AS count FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='execution.observations-registered'`)[0]?.count,
    ).toBe(0);
    const item = (await sql`SELECT state,diagnostic,observations,attempts FROM run_work_item WHERE run_id=${seeded.run.runId}`)[0];
    // The Work Item never reports Observations that are not there.
    expect(item).toMatchObject({ state: 'FAILED', diagnostic: 'observation-registration-refused', observations: 0, attempts: 1 });
    // The Reference Source Session Step succeeded and stays succeeded; it is the WORK
    // ITEM's Step Execution that the refusal took back with everything else.
    expect(
      (await sql`SELECT count(*)::int AS count FROM run_step_execution WHERE run_id=${seeded.run.runId} AND state='SUCCEEDED' AND work_item_id IS NOT NULL`)[0]?.count,
    ).toBe(0);
  });

  it('commits evaluations in the same transaction as the rows they describe', async () => {
    // The version's OWN compiled conditions, over the RoleMatrix this Run's Session Step
    // acquired. Nothing is stood in for: the plan is the compiler's, the expansion is the
    // frozen artifact's, and the evaluator is the one the stage builds.
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(
      dependencies(seeded, {
        reference: async () => ({
          bytes: utf8Bytes(SOD_ROLE_MATRIX), mediaType: 'text/csv', location: 'https://synthetic.invalid/rm.csv',
        }),
      }).deps,
      seeded.job,
    );
    const rows = await sql`SELECT e.value,e.coverage,e.origin,e.corroboration,e.diagnostic,o.population_record_key AS key FROM run_observation_evaluation e JOIN run_observation o ON o.observation_id=e.observation_id WHERE e.run_id=${seeded.run.runId} ORDER BY o.population_record_key`;
    expect(rows.map((row) => [row.key, row.coverage, row.value])).toEqual([
      // AP_CLERK expands to CREATE_PAYMENT and VIEW_PAYMENT: no prohibited pair.
      ['AG-1001', 'COVERED', 'COMPLIANT'],
      // VENDOR_MAINTAINER + VENDOR_APPROVER expand to CREATE_VENDOR + APPROVE_VENDOR.
      ['AG-1003', 'COVERED', 'EXCEPTION'],
      // Two extraction rows carry AG-1007, so the match never resolves.
      ['AG-1007', 'AMBIGUOUS', 'UNEVALUATED'],
      // Absent from the extraction. P-2's §C coverage rule requires every account to
      // APPEAR, so the record is UNINSPECTED and no condition can be decided about it.
      ['AG-9999', 'UNINSPECTED', 'UNEVALUATED'],
    ]);
    expect(rows.every((row) => row.origin === 'RULE')).toBe(true);
    expect(rows.find((row) => row.key === 'AG-1003')!.diagnostic).toContain(
      'prohibited permission pair CREATE_VENDOR + APPROVE_VENDOR',
    );
    // Both halves, in the compiler's order: the evidence facts DECIDED the value (an
    // uninspected record is never Compliant), and the non-applicability marker is still
    // recorded so the §H count of APPLICABLE conditions can exclude the row.
    expect(rows.find((row) => row.key === 'AG-9999')!.diagnostic).toBe(
      'missing, ambiguous, contradictory, uninspected, or unproven Evidence; ' +
        'condition does not apply to this record',
    );
  });

  it('creates the Exception in the same transaction as the evaluation that raised it', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(
      dependencies(seeded, {
        reference: async () => ({
          bytes: utf8Bytes(SOD_ROLE_MATRIX), mediaType: 'text/csv', location: 'https://synthetic.invalid/rm.csv',
        }),
      }).deps,
      seeded.job,
    );
    const rows = await sql`SELECT x.exception_id::text AS id,x.observation_id::text AS observation,x.population_record_key AS key,x.condition_ids,x.diagnostics,x.fingerprint,x.fingerprint_key_id,x.target_system,x.work_item_id::text AS item FROM run_exception x WHERE x.run_id=${seeded.run.runId}`;
    expect(rows).toHaveLength(1);
    const raised = rows[0]!;
    expect(raised.key).toBe('AG-1003');
    expect(raised.condition_ids).toEqual(['C1']);
    expect(String(raised.diagnostics)).toContain('CREATE_VENDOR');
    expect(raised.fingerprint_key_id).toBe('k-integration');
    // Run-stable and DERIVED: the same Run and Observation always name the same Exception.
    expect(raised.id).toBe(exceptionIdFor(seeded.run.runId, String(raised.observation)));
    expect(raised.fingerprint).toBe(
      exceptionFingerprint(utf8Bytes(FINGERPRINT_KEY), {
        procedureId: seeded.run.procedureId,
        templateId: 'P-2',
        targetSystem: String(raised.target_system),
        populationRecordKey: 'AG-1003',
        conditionIds: ['C1'],
      }),
    );
    // The chain names it too, so a row that later went missing is still accounted for.
    const [event] = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='execution.observations-registered'`;
    const payload = event!.payload as { exceptions: number; exceptionIds: string[] };
    expect(payload.exceptions).toBe(1);
    expect(payload.exceptionIds).toEqual([raised.id]);
  });

  it('keeps the first Exception and never writes a second for one record', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    const deps = dependencies(seeded, {
      reference: async () => ({
        bytes: utf8Bytes(SOD_ROLE_MATRIX), mediaType: 'text/csv', location: 'https://synthetic.invalid/rm.csv',
      }),
    }).deps;
    await executeAdapterSteps(deps, seeded.job);
    const before = await sql`SELECT exception_id::text AS id,raised_at FROM run_exception WHERE run_id=${seeded.run.runId}`;
    expect(before).toHaveLength(1);

    // Re-register the batch exactly as it was stored. Every digest matches, so nothing is
    // written at all — and the Exception that already stands is the one that stays.
    const batch = await registeredBatch(seeded);
    await register(seeded.run.runId, batch);
    const after = await sql`SELECT exception_id::text AS id,raised_at FROM run_exception WHERE run_id=${seeded.run.runId}`;
    expect(after).toEqual(before);
  });

  it('refuses to update an Exception, or to delete one while its Observation stands', async () => {
    // Generation 23's two triggers, asserted with raw SQL. A rule tested only through the
    // command proves nothing about the rule.
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(
      dependencies(seeded, {
        reference: async () => ({
          bytes: utf8Bytes(SOD_ROLE_MATRIX), mediaType: 'text/csv', location: 'https://synthetic.invalid/rm.csv',
        }),
      }).deps,
      seeded.job,
    );
    const [raised] = await sql`SELECT exception_id::text AS id,observation_id::text AS observation FROM run_exception WHERE run_id=${seeded.run.runId}`;
    expect(raised).toBeDefined();

    await expect(
      sql`UPDATE run_exception SET population_record_key='AG-0000' WHERE exception_id=${raised!.id}::uuid`,
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      sql`DELETE FROM run_exception WHERE exception_id=${raised!.id}::uuid`,
    ).rejects.toThrow(/cannot be deleted/);
    expect(
      (await sql`SELECT count(*)::int AS c FROM run_exception WHERE run_id=${seeded.run.runId}`)[0]?.c,
    ).toBe(1);

    // Removing the OBSERVATION is a different act: it takes the record and its digest with
    // it, and the registration event still names both. The cascade is allowed, and it is
    // what makes a Run teardown possible at all.
    await sql`DELETE FROM run_observation_evaluation WHERE observation_id=${raised!.observation}::uuid`;
    await sql`DELETE FROM run_observation_check WHERE observation_id=${raised!.observation}::uuid`;
    await sql`DELETE FROM run_observation WHERE observation_id=${raised!.observation}::uuid`;
    expect(
      (await sql`SELECT count(*)::int AS c FROM run_exception WHERE run_id=${seeded.run.runId}`)[0]?.c,
    ).toBe(0);
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

  /* --------------------------------------------------------------- Story 3.6 --- */

  /** Every id and instant a hand-built batch needs, read back from a real Run. */
  async function corroborationContext(seeded: Awaited<ReturnType<typeof seed>>) {
    const [item] = await sql`SELECT work_item_id::text AS id FROM run_work_item WHERE run_id=${seeded.run.runId}`;
    const evidence = await sql`SELECT evidence_id::text AS id,kind FROM run_evidence WHERE run_id=${seeded.run.runId}`;
    const [stage] = await sql`SELECT to_char(run_started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS started FROM run_execution WHERE run_id=${seeded.run.runId}`;
    return {
      workItemId: String(item!.id),
      extraction: String(evidence.find((row) => row.kind === 'adapter-extraction')!.id),
      reference: String(evidence.find((row) => row.kind === 'reference-source')?.id ?? ''),
      runStartedAt: String(stage!.started),
    };
  }

  /** One §B.1 `found = true` record, grounded wherever the caller says. */
  function grounded(input: {
    workItemId: string;
    stepExecutionId: string;
    evidenceId: string;
    key: string;
    identity: { locator: string; label: string; value: string };
    attributes: readonly { name: string; locator: string; label: string; original: unknown; normalized?: unknown; text?: string }[];
    observedAt: string;
  }): ObservationBatchItem {
    const text = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));
    return {
      record: {
        schemaVersion: 1,
        observationId: observationIdFor(input.workItemId, input.key),
        workItemId: input.workItemId,
        populationRecordKey: input.key,
        targetSystem: 'accessgate',
        found: 'true',
        observedAt: input.observedAt,
        stepExecutionId: input.stepExecutionId,
        captureMethod: 'adapter',
        matchOrigin: 'platform',
        identity: {
          name: 'account_id',
          originalValue: input.identity.value,
          normalizedValue: input.identity.value,
          grounding: { evidenceId: input.evidenceId, locator: input.identity.locator, label: input.identity.label, extractedText: input.identity.value },
          corroboration: null,
        },
        attributes: input.attributes.map((attribute) => ({
          name: attribute.name,
          originalValue: attribute.original as never,
          normalizedValue: (attribute.normalized ?? attribute.original) as never,
          grounding: {
            evidenceId: input.evidenceId,
            locator: attribute.locator,
            label: attribute.label,
            extractedText: attribute.text ?? text(attribute.original),
          },
          corroboration: null,
        })),
        evidenceIds: [input.evidenceId],
      },
      observedAtSource: input.observedAt,
      absence: null,
      expectedQueryKeys: [{ key: 'account_id', value: input.key }],
    };
  }

  it('re-reads every grounding out of the extraction it froze, leading zeros included', async () => {
    const seeded = await seed(['api'], 'P-2', CORROBORATION_POPULATION);
    await executeAdapterSteps(
      dependencies(seeded, {
        extract: async (_target, credential) => {
          credential.authorize({ set: () => undefined });
          return { bytes: utf8Bytes(CORROBORATION_ACCOUNTS), mediaType: 'application/json', location: 'x' };
        },
      }).deps,
      seeded.job,
    );
    const rows = await sql`SELECT population_record_key AS key,found,coverage,corroboration,identity,attributes FROM run_observation WHERE run_id=${seeded.run.runId} ORDER BY population_record_key COLLATE "C"`;
    expect(rows.map((row) => [row.key, row.found, row.corroboration])).toEqual([
      // `007` and `7` are two different accounts and they resolve to two different rows.
      // Nothing coerces one to the other, in either direction.
      ['007', 'true', 'MATCHED'],
      ['7', 'true', 'MATCHED'],
      ['AG-1001', 'true', 'MATCHED'],
      // Nothing was grounded, so nothing was corroborated. UNJUDGED is not a pass.
      ['CORR-9999', 'false', 'UNJUDGED'],
    ]);
    const zeros = rows[0] as unknown as { identity: { grounding: { locator: string } }; attributes: { name: string; originalValue: unknown; corroboration: string }[] };
    const seven = rows[1] as unknown as typeof zeros;
    expect(zeros.identity.grounding.locator).toBe('$.accounts[1].account_id');
    expect(seven.identity.grounding.locator).toBe('$.accounts[2].account_id');
    expect(zeros.attributes.find((a) => a.name === 'status')?.originalValue).toBe('Active');
    expect(seven.attributes.find((a) => a.name === 'status')?.originalValue).toBe('Disabled');
    // Every attribute of every resolved record was re-read and agreed.
    for (const row of [zeros, seven]) {
      expect(row.identity.grounding).toBeDefined();
      expect(row.attributes.every((a) => a.corroboration === 'matched')).toBe(true);
    }

    const checks = await sql`SELECT outcome,diagnostic,count(*)::int AS n FROM run_observation_check WHERE run_id=${seeded.run.runId} AND check_name='observation-corroboration' GROUP BY 1,2`;
    expect(checks).toEqual([{ outcome: 'PASS', diagnostic: null, n: 4 }]);
    const [event] = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='execution.observations-registered'`;
    expect((event!.payload as Record<string, unknown>)['corroboration']).toEqual({
      MATCHED: 3, CONTRADICTORY: 0, UNJUDGED: 1,
    });
  });

  it('marks a P-3 offset capture time matched, normalized to UTC with the original kept', async () => {
    const seeded = await seed(['api'], 'P-3');
    await executeAdapterSteps(
      dependencies(seeded, {
        extract: async (_target, credential) => {
          credential.authorize({ set: () => undefined });
          return { bytes: utf8Bytes(APPROVALS), mediaType: 'application/json', location: 'x' };
        },
      }).deps,
      seeded.job,
    );
    const [row] = await sql`SELECT corroboration,attributes FROM run_observation WHERE run_id=${seeded.run.runId} AND population_record_key='TX-500001'`;
    const decided = (row!.attributes as { name: string; originalValue: string; normalizedValue: string; corroboration: string }[])
      .find((attribute) => attribute.name === 'decided_at')!;
    // The snapshot holds the offset original; the record holds the UTC instant beside it.
    // Both are re-read, and a normalization the snapshot does not support is a
    // contradiction rather than a silent shift.
    expect(decided.originalValue).toBe('2026-08-10T10:30:00+02:00');
    expect(decided.normalizedValue).toBe('2026-08-10T08:30:00.000Z');
    expect(decided.corroboration).toBe('matched');
    expect(row!.corroboration).toBe('MATCHED');
  });

  it('contradicts a value, a label and an identity the stored snapshot does not support', async () => {
    const seeded = await seed(['versioned-file', 'api'], 'P-2', DISJOINT_POPULATION);
    await executeAdapterSteps(
      dependencies(seeded, {
        extract: async (_target, credential) => {
          credential.authorize({ set: () => undefined });
          return { bytes: utf8Bytes(CORROBORATION_ACCOUNTS), mediaType: 'application/json', location: 'x' };
        },
      }).deps,
      seeded.job,
    );
    const context = await corroborationContext(seeded);
    const stepExecutionId = ids.next();
    const observedAt = new Date().toISOString();
    const item = (over: Parameters<typeof grounded>[0] extends infer T ? Partial<T> : never) =>
      grounded({
        workItemId: context.workItemId,
        stepExecutionId,
        evidenceId: context.extraction,
        observedAt,
        key: 'AG-1001',
        identity: { locator: '$.accounts[0].account_id', label: 'account_id', value: 'AG-1001' },
        attributes: [],
        ...over,
      } as Parameters<typeof grounded>[0]);

    const batch: ObservationBatch = {
      run: seeded.run,
      workItemId: context.workItemId,
      stepExecutionId,
      targetSystem: 'accessgate',
      templateId: 'P-2',
      runStartedAt: context.runStartedAt,
      registeredAt: observedAt,
      items: [
        // The snapshot says `Active`; the Observation says `Disabled`.
        item({ attributes: [{ name: 'status', locator: '$.accounts[0].status', label: 'status', original: 'Disabled' }] }),
        // The value agrees and the label does not: the extraction's key is `roles`.
        item({
          key: '007',
          identity: { locator: '$.accounts[1].account_id', label: 'account_id', value: '007' },
          attributes: [{ name: 'roles', locator: '$.accounts[1].roles', label: 'Roles', original: ['OPS_CLERK'], text: '["OPS_CLERK"]' }],
        }),
        // Every part of the grounding re-reads faithfully — and it is bound to the wrong
        // population record: the cell holds `007` and the record key is `7`.
        item({ key: '7', identity: { locator: '$.accounts[1].account_id', label: 'account_id', value: '007' } }),
        // A `sheet` substrate, in the SAME batch: one Observation may name one artifact
        // and its neighbour another, and the corroborator holds both.
        {
          ...item({
            key: 'AMBIGUOUS_DUAL',
            identity: { locator: '$.rows[0].role', label: 'role', value: 'AMBIGUOUS_DUAL' },
            attributes: [
              { name: 'entry', locator: '$.rows[0].entry', label: 'entry', original: '10' },
              { name: 'permission', locator: '$.rows[0].permission', label: 'permission', original: 'CREATE_PAYMENT' },
            ],
          }),
        },
      ].map((entry, index) =>
        index === 3
          ? {
              ...entry,
              record: {
                ...entry.record,
                evidenceIds: [context.reference],
                identity: { ...entry.record.identity!, grounding: { ...entry.record.identity!.grounding!, evidenceId: context.reference } },
                attributes: entry.record.attributes.map((attribute) => ({
                  ...attribute,
                  grounding: { ...attribute.grounding!, evidenceId: context.reference },
                })),
              },
            }
          : entry,
      ),
    };

    await register(seeded.run.runId, batch, {
      corroboration: snapshotCorroboration([
        { evidenceId: context.extraction, substrate: 'json', bytes: utf8Bytes(CORROBORATION_ACCOUNTS) },
        { evidenceId: context.reference, substrate: 'sheet', bytes: utf8Bytes(ROLE_MATRIX) },
      ]),
    });

    const rows = await sql`SELECT population_record_key AS key,corroboration FROM run_observation WHERE run_id=${seeded.run.runId} AND step_execution_id=${stepExecutionId} ORDER BY population_record_key COLLATE "C"`;
    expect(rows.map((row) => [row.key, row.corroboration])).toEqual([
      ['007', 'CONTRADICTORY'],
      ['7', 'CONTRADICTORY'],
      ['AG-1001', 'CONTRADICTORY'],
      // The real RoleMatrix, read through its header row and its `entry` ordinal.
      ['AMBIGUOUS_DUAL', 'MATCHED'],
    ]);
    const diagnostics = await sql`SELECT o.population_record_key AS key,c.outcome,c.diagnostic FROM run_observation_check c JOIN run_observation o USING (observation_id) WHERE c.run_id=${seeded.run.runId} AND o.step_execution_id=${stepExecutionId} AND c.check_name='observation-corroboration' ORDER BY o.population_record_key COLLATE "C"`;
    expect(diagnostics.map((row) => [row.key, row.outcome, row.diagnostic])).toEqual([
      ['007', 'FAIL', 'corroboration-label-drift'],
      ['7', 'FAIL', 'identity-mismatch'],
      ['AG-1001', 'FAIL', 'corroboration-contradictory'],
      ['AMBIGUOUS_DUAL', 'PASS', null],
    ]);
  });

  it('reports an unimplemented substrate by name rather than passing it silently', async () => {
    const seeded = await seed(['api'], 'P-2', DISJOINT_POPULATION);
    await executeAdapterSteps(
      dependencies(seeded, {
        extract: async (_target, credential) => {
          credential.authorize({ set: () => undefined });
          return { bytes: utf8Bytes(CORROBORATION_ACCOUNTS), mediaType: 'application/json', location: 'x' };
        },
      }).deps,
      seeded.job,
    );
    const context = await corroborationContext(seeded);
    const stepExecutionId = ids.next();
    const observedAt = new Date().toISOString();
    const entry = grounded({
      workItemId: context.workItemId,
      stepExecutionId,
      evidenceId: context.extraction,
      observedAt,
      key: 'AG-2002',
      identity: { locator: '$.accounts[3].account_id', label: 'account_id', value: 'AG-2002' },
      attributes: [{ name: 'status', locator: '$.accounts[3].status', label: 'status', original: 'Active' }],
    });
    await register(
      seeded.run.runId,
      {
        run: seeded.run,
        workItemId: context.workItemId,
        stepExecutionId,
        targetSystem: 'accessgate',
        templateId: 'P-2',
        runStartedAt: context.runStartedAt,
        registeredAt: observedAt,
        items: [entry],
      },
      {
        corroboration: snapshotCorroboration([
          // An agent capture this build cannot read. It must never report `matched`.
          { evidenceId: context.extraction, substrate: 'web_tree', bytes: utf8Bytes(CORROBORATION_ACCOUNTS) },
        ]),
      },
    );
    const [row] = await sql`SELECT corroboration,identity,attributes FROM run_observation WHERE run_id=${seeded.run.runId} AND population_record_key='AG-2002'`;
    // Not `contradictory`: nothing read it, so nothing disagreed with it.
    expect(row!.corroboration).toBe('UNJUDGED');
    expect((row!.identity as { corroboration: unknown }).corroboration).toBeNull();
    const [check] = await sql`SELECT outcome,diagnostic FROM run_observation_check WHERE run_id=${seeded.run.runId} AND check_name='observation-corroboration' AND observation_id=${observationIdFor(context.workItemId, 'AG-2002')}`;
    expect(check).toEqual({ outcome: 'FAIL', diagnostic: 'corroboration-unsupported' });
  });

  it('reports an EXACT condition-gap total beside a sample of at most 32', async () => {
    // `run_gate_check` keeps an exact `total` beside a bounded sample of at most 32
    // identities, and this read used to take `rows.length` AFTER a `LIMIT` — one query
    // answering two different questions, of which `LIMIT` answers only the second. The
    // total is now its own `count(*)`; the sample alone is bounded, exactly as
    // `readFailedObservationChecks` and `readUnnamedValues` in the same file already do it.
    const seeded = await seed(['api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    const [item] = await sql`SELECT work_item_id FROM run_work_item WHERE run_id=${seeded.run.runId}`;
    const [step] = await sql`SELECT step_execution_id FROM run_step_execution WHERE run_id=${seeded.run.runId}`;
    // Thirty-three Observations with NO evaluation at all: every one is a condition gap,
    // and thirty-three is one more than the sample may ever name.
    const gaps = 33;
    await sql.unsafe(
      `INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,observed_at_source,corroboration)
       SELECT gen_random_uuid(),$1,$2,1,'GAP-'||lpad(g::text,4,'0'),'t','false',now(),$3,'adapter','platform',NULL,'[]'::jsonb,'["e"]'::jsonb,repeat('a',64),'UNINSPECTED','2026-09-05T00:00:00.000Z','UNJUDGED'
       FROM generate_series(1,${gaps}) AS g`,
      [seeded.run.runId, String(item!.work_item_id), String(step!.step_execution_id)],
    );
    const tally = await new PostgresAdapterExecutionRepository(db).transaction(
      seeded.run.runId,
      (context) => context.readConditionGaps(1),
    );
    // Every real Observation of this Run carries at least one evaluation, so the gaps are
    // exactly the rows just inserted — counted, not measured.
    expect(tally.total).toBe(gaps);
    expect(tally.sample).toHaveLength(32);
    expect(new Set(tally.sample.map((entry) => entry.record)).size).toBe(32);
  });

  it('refuses at the database what no registration may store', async () => {
    const seeded = await seed(['api']);
    await executeAdapterSteps(dependencies(seeded).deps, seeded.job);
    const [item] = await sql`SELECT work_item_id FROM run_work_item WHERE run_id=${seeded.run.runId}`;
    const [step] = await sql`SELECT step_execution_id FROM run_step_execution WHERE run_id=${seeded.run.runId}`;
    const insert = (found: string, coverage: string, digest: string, identity = 'NULL') =>
      sql.unsafe(
        `INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,observed_at_source,corroboration) VALUES (gen_random_uuid(),$1,$2,1,'RAW-'||gen_random_uuid()::text,'t',$3,now(),$4,'adapter','platform',${identity},'[]'::jsonb,'["e"]'::jsonb,$5,$6,'2026-09-05T00:00:00.000Z','UNJUDGED')`,
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
    // The row THIS test just inserted, named by its own `RAW-` key. An unqualified
    // `LIMIT 1` over the Run's UNINSPECTED rows also matches a real Observation — AG-9999
    // is one under P-2's coverage rule — whose check outcomes the raw inserts below then
    // collide with, and which row it picks is not even determined.
    const [uninspected] = await sql`SELECT observation_id::text AS id,coverage FROM run_observation WHERE run_id=${seeded.run.runId} AND coverage='UNINSPECTED' AND population_record_key LIKE 'RAW-%' ORDER BY population_record_key LIMIT 1`;
    const evaluate = (coverage: string, value: string) =>
      sql.unsafe(
        `INSERT INTO run_observation_evaluation(observation_id,coverage,corroboration,run_id,condition_id,origin,value,confirmation,confidence,rationale,diagnostic,evidence_ids) VALUES ($1,$2,'UNJUDGED',$3,'C-'||gen_random_uuid()::text,'RULE',$4,NULL,NULL,NULL,NULL,'[]'::jsonb)`,
        [String(uninspected!.id), coverage, seeded.run.runId, value],
      );
    await expect(evaluate('UNINSPECTED', 'COMPLIANT')).rejects.toThrow(/run_observation_evaluation_coverage/);
    // Claiming the row is covered does not help: the pair must exist in run_observation.
    await expect(evaluate('COVERED', 'COMPLIANT')).rejects.toThrow(/run_observation_evaluation_coverage_fk/);
    await expect(evaluate('UNINSPECTED', 'UNEVALUATED')).resolves.toBeDefined();
    // Confirmation and confidence belong to an Agent-Judged evaluation and to no other.
    await expect(
      sql.unsafe(
        `INSERT INTO run_observation_evaluation(observation_id,coverage,corroboration,run_id,condition_id,origin,value,confirmation,confidence,rationale,diagnostic,evidence_ids) VALUES ($1,'UNINSPECTED','UNJUDGED',$2,'C-CONF','RULE','UNEVALUATED','pending',NULL,NULL,NULL,'[]'::jsonb)`,
        [String(uninspected!.id), seeded.run.runId],
      ),
    ).rejects.toThrow(/run_observation_evaluation_confirmation/);
    await expect(
      sql.unsafe(
        `INSERT INTO run_observation_evaluation(observation_id,coverage,corroboration,run_id,condition_id,origin,value,confirmation,confidence,rationale,diagnostic,evidence_ids) VALUES ($1,'UNINSPECTED','UNJUDGED',$2,'C-CONFID','AGENT_JUDGED','UNEVALUATED',NULL,1.5,NULL,NULL,'[]'::jsonb)`,
        [String(uninspected!.id), seeded.run.runId],
      ),
    ).rejects.toThrow(/run_observation_evaluation_confidence/);

    // Story 3.6, below every command: the per-attribute verdict vocabulary, the rollup
    // that has to agree with the attributes it summarises, and "a record its own stored
    // snapshot contradicts is never Compliant" as a foreign key rather than a rule.
    const observe = (attributes: string, corroboration: string) =>
      sql.unsafe(
        `INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,observed_at_source,corroboration) VALUES (gen_random_uuid(),$1,$2,1,'CORR-'||gen_random_uuid()::text,'t','true',now(),$3,'adapter','platform','{"name":"k","originalValue":"k","normalizedValue":"k","grounding":null,"corroboration":"matched"}'::jsonb,$4::jsonb,'["e"]'::jsonb,$5,'COVERED','2026-09-05T00:00:00.000Z',$6) RETURNING observation_id::text AS id`,
        [seeded.run.runId, String(item!.work_item_id), String(step!.step_execution_id), attributes, digest, corroboration],
      );
    const attribute = (verdict: string) =>
      `[{"name":"x","originalValue":"a","normalizedValue":"a","grounding":null,"corroboration":${verdict}}]`;
    // A verdict outside the wire vocabulary cannot be stored at all.
    await expect(observe(attribute('"probably"'), 'MATCHED')).rejects.toThrow(/run_observation_attribute_corroboration/);
    await expect(observe(attribute('7'), 'MATCHED')).rejects.toThrow(/run_observation_attribute_corroboration/);
    // A rollup that disagrees with the attributes it claims to summarise cannot either.
    await expect(observe(attribute('"contradictory"'), 'MATCHED')).rejects.toThrow(/run_observation_corroboration_state/);
    await expect(observe(attribute('null'), 'UNJUDGED')).rejects.toThrow(/run_observation_corroboration_state/);
    await expect(observe(attribute('"matched"'), 'INVENTED')).rejects.toThrow(/run_observation_corroboration/);
    const [contradicted] = await observe(attribute('"contradictory"'), 'CONTRADICTORY');
    const judge = (corroboration: string, value: string) =>
      sql.unsafe(
        `INSERT INTO run_observation_evaluation(observation_id,coverage,corroboration,run_id,condition_id,origin,value,confirmation,confidence,rationale,diagnostic,evidence_ids) VALUES ($1,'COVERED',$2,$3,'C-'||gen_random_uuid()::text,'RULE',$4,NULL,NULL,NULL,NULL,'[]'::jsonb)`,
        [String(contradicted!.id), corroboration, seeded.run.runId, value],
      );
    await expect(judge('CONTRADICTORY', 'COMPLIANT')).rejects.toThrow(/run_observation_evaluation_corroboration/);
    // Claiming the snapshot agreed does not help: the triple has to exist upstream.
    await expect(judge('MATCHED', 'COMPLIANT')).rejects.toThrow(/run_observation_evaluation_coverage_fk/);
    // An EXCEPTION or an UNEVALUATED verdict on the same record is perfectly storable.
    await expect(judge('CONTRADICTORY', 'UNEVALUATED')).resolves.toBeDefined();
    await expect(judge('CONTRADICTORY', 'EXCEPTION')).resolves.toBeDefined();

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
