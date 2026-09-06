import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acquirePopulation,
  executeAdapterSteps,
  initiateRun,
  type AcquiredArtifact,
  type EvidenceStore,
  type ExceptionFingerprinter,
  type ResolvedCredential,
} from '@intellifin/application';
import {
  bindingDigest,
  bindingDigestEnvelope,
  exceptionFingerprint,
  initialDraftCompliance,
  initialDraftEvidence,
  initialDraftPopulation,
  initialDraftSections,
  registrationDigest,
  sha256Hex,
  snapshotFromRegistration,
  utf8Bytes,
  type ProcedureTargetSnapshot,
  type RunResultPublication,
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
import { resolvedCredential } from '@intellifin/infrastructure/credentials';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * Story 3.9 against a real PostgreSQL 18 at generation 25.
 *
 * Every row of the story's own I/O matrix, driven through the REAL stages — a real plan
 * from the compiler, a real population reconciliation, a real adapter extraction, a real
 * Run-level Gate — and read back out of `run_result` rather than out of the command's
 * return value. What an auditor reads is the row, and a command that decided correctly and
 * stored something else is exactly the defect this file exists to catch.
 *
 * The four rules the DATABASE holds are asserted with raw SQL, because a constraint tested
 * through the command proves nothing about the constraint: a sealed Result cannot be
 * updated, a terminal Run cannot exist without one, a `PASS` cannot exist without a passed
 * Gate, and the §E.1 row and the outcome cannot disagree.
 */
const url = process.env.DATABASE_URL;

const CREDENTIAL = 'cred://synthetic/run-result';
const TOKEN = 'SECRET-TOKEN-run-result-do-not-store-me';
const SCOPE = '  Every active AccessGate account in the period — and nothing else.  ';

function collection(items: readonly unknown[]): string {
  return JSON.stringify({
    synthetic: { marker: 'SYNTHETIC-NORTHSTAR-FIXTURE' },
    schema_version: 1, representation: 'population-rows-v1', source: 'accounts',
    title: 'accounts', generation: 'g1', generated_at: '2026-09-01T00:00:00.000Z',
    effective_period: { from: '2026-01-01', to: '2026-12-31' },
    schema: ['account_id', 'roles', 'status'], complete: true, returned: items.length,
    declared_count_endpoint: '/accounts/count',
    accounts: items,
  });
}

/** Two active accounts, each resolved once, neither holding a prohibited pair. */
const CLEAN_POPULATION = 'account_id,status\nAG-1001,Active\nAG-1003,Active\n';
const CLEAN_ACCOUNTS = collection([
  { account_id: 'AG-1001', roles: ['AP_CLERK'], status: 'Active' },
  { account_id: 'AG-1003', roles: ['OPS_CLERK'], status: 'Active' },
]);
/** The same two accounts, the second holding both halves of a prohibited pair. */
const CONFLICTED_ACCOUNTS = collection([
  { account_id: 'AG-1001', roles: ['AP_CLERK'], status: 'Active' },
  { account_id: 'AG-1003', roles: ['VENDOR_MAINTAINER', 'VENDOR_APPROVER'], status: 'Active' },
  { account_id: 'AG-2002', roles: ['OPS_CLERK'], status: 'Active' },
]);
/**
 * A population carrying a THIRD account twice: §H's duplicate Source primary key.
 *
 * The duplicate is deliberately not the account that holds the prohibited pair. A record
 * whose key the included population carries twice resolves to no population row at all —
 * first-wins, last-wins and a union each answer a question the data cannot answer — so it
 * is Unevaluated, and duplicating the conflicted account would have removed the very
 * Exception the ordering test needs to see survive.
 */
const DUPLICATED_POPULATION =
  'account_id,status\nAG-1001,Active\nAG-1003,Active\nAG-2002,Active\nAG-2002,Active\n';
/** One included account and one excluded by the frozen inclusion rule. */
const MIXED_POPULATION = 'account_id,status\nAG-1001,Active\nAG-2002,Closed\n';
/** A header and no rows at all: the population of record is empty. */
const EMPTY_POPULATION = 'account_id,status\n';

const ROLE_MATRIX = [
  'entry,role,permission',
  '1,AP_CLERK,CREATE_PAYMENT',
  '1,AP_CLERK,VIEW_PAYMENT',
  '2,OPS_CLERK,VIEW_LOAN',
  '3,VENDOR_MAINTAINER,CREATE_VENDOR',
  '4,VENDOR_APPROVER,APPROVE_VENDOR',
  '',
].join('\n');

const FINGERPRINTER: ExceptionFingerprinter = {
  keyId: 'k-result',
  fingerprint: (envelope) => exceptionFingerprint(utf8Bytes('story-3-9-result-key'), envelope),
};

describe.skipIf(!url)('the sealed Result against PostgreSQL', () => {
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
      throw new Error('Result tests require an isolated local or CI test database');
    }
    sql = createSqlClient(url!, { max: 5 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES(${author},'Result test',${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES(${author},'auditor')`;
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const id of procedures) {
        const runs = await sql`SELECT run_id::text AS id FROM audit_run WHERE procedure_id=${id}`;
        for (const run of runs) {
          await sql`DELETE FROM pgboss.job WHERE name='runs' AND data->>'runId'=${run.id}`;
          // No `DELETE FROM run_exception` here, deliberately: generation 23 refuses to
          // delete an Exception while its Observation exists, and `run_exception`
          // cascades from `run_observation` — so removing the Observation is what carries
          // the Exception away. A file that raises real Exceptions cannot delete them
          // first, and one that raises none never notices.
          await sql`DELETE FROM run_observation_evaluation WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_observation_check WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_observation WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_step_execution WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_session_step WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_work_item WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_gate_check WHERE run_id=${run.id}`;
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

  function registration(kind: 'api' | 'versioned-file', origin: string) {
    return {
      registrationId: ids.next(),
      displayName: kind === 'versioned-file' ? 'RoleMatrix' : 'AccessGate',
      kind,
      allowedOrigins: [origin],
      applicationIdentity: '',
      credentialRef: CREDENTIAL,
      permittedActions: ['list-records', 'read-attribute'] as const,
      attributeLabelPatterns: ['account_id', 'roles', 'status'],
      secondaryKey: '',
    };
  }

  /** Seed an ACTIVE P-2 version with a Reference Source and one adapter Target. */
  async function seed(
    population: string = CLEAN_POPULATION,
    options: { zeroRecordPass?: boolean } = {},
  ) {
    const declaredSchema = ['account_id', 'status'];
    const source = {
      kind: 'versioned-file' as const,
      location: 'https://synthetic.invalid/accounts.csv',
      declaredSchema,
      sensitiveFields: [],
      declaredCountMechanism: 'cover-sheet' as const,
    };
    const targets: ProcedureTargetSnapshot[] = (['versioned-file', 'api'] as const).map(
      (kind, index) => {
        const value = registration(kind, `https://synthetic.invalid/system-${String(index)}`);
        return snapshotFromRegistration({ ...value, digest: registrationDigest(value) });
      },
    );
    const inputs = {
      ...initialDraftPopulation('P-2'),
      ...initialDraftCompliance('P-2'),
      ...initialDraftEvidence('P-2'),
      templateId: 'P-2' as const,
      controlName: `Sealed Result ${ids.next()}`,
      sections: initialDraftSections('P-2'),
      // Retained with its leading and trailing spaces: the Result shows it VERBATIM.
      scope: SCOPE,
      period: { from: '2026-08-01', to: '2026-08-31' },
      zeroRecordPass: options.zeroRecordPass ?? false,
      sourceSnapshot: {
        bindingId: ids.next(),
        displayName: 'Accounts',
        digest: bindingDigest(source),
        contract: bindingDigestEnvelope(source),
      },
      schedule: { frequency: 'once' as const, startTime: '00:00', periodDerivationRule: 'explicit-period' as const },
      targets,
      instructions: [],
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
    await acquirePopulation(
      {
        repository: new PostgresPopulationRepository(db),
        acquisition: {
          acquire: async () => ({
            bytes: utf8Bytes(population),
            mediaType: 'text/csv',
            declaration: {
              schema_version: 1,
              representation: 'csv-raw-v1',
              source: 'accounts',
              generation: 'g1',
              generated_at: '2026-09-01T00:00:00.000Z',
              effective_period: { from: '2026-01-01', to: '2026-12-31' },
              schema: declaredSchema,
              count: population.trimEnd().split('\n').length - 1,
              sha256: sha256Hex(population),
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
    accounts: string = CLEAN_ACCOUNTS,
  ) {
    return {
      repository: new PostgresAdapterExecutionRepository(db),
      reference: {
        acquireReference: async (): Promise<AcquiredArtifact> => ({
          bytes: utf8Bytes(ROLE_MATRIX),
          mediaType: 'text/csv',
          location: 'https://synthetic.invalid/rm.csv',
        }),
      },
      extraction: {
        extract: async (
          _target: ProcedureTargetSnapshot,
          credential: ResolvedCredential,
        ): Promise<AcquiredArtifact> => {
          credential.authorize({ set: () => undefined });
          return {
            bytes: utf8Bytes(accounts),
            mediaType: 'application/json',
            location: 'https://synthetic.invalid/x',
          };
        },
      },
      credentials: {
        resolve: async (reference: string): Promise<ResolvedCredential> =>
          resolvedCredential(reference, TOKEN),
      },
      store: seeded.store,
      clock: new SystemClock(),
      ids,
      exceptions: FINGERPRINTER,
    };
  }

  interface ResultRow {
    version: number;
    outcome: string;
    outcome_row: string;
    sealed: boolean;
    run_state: string;
    gate_passed: boolean;
    scope: string | null;
    publication: RunResultPublication;
  }

  const result = async (runId: string): Promise<ResultRow | undefined> =>
    (
      await sql<ResultRow[]>`SELECT version,outcome,outcome_row,sealed,run_state,gate_passed,scope,publication FROM run_result WHERE run_id=${runId}`
    )[0];
  const runState = async (runId: string) =>
    (await sql`SELECT state FROM audit_run WHERE run_id=${runId}`)[0]?.state as string | undefined;

  it('seals a Pass for a clean Run and publishes what the Template promises', async () => {
    const seeded = await seed();
    await executeAdapterSteps(dependencies(seeded), seeded.job);

    const row = await result(seeded.run.runId);
    expect(row).toMatchObject({
      version: 1,
      outcome: 'PASS',
      outcome_row: 'pass',
      sealed: true,
      run_state: 'COMPLETED',
      gate_passed: true,
      // The auditor's own sentence, with its leading and trailing spaces intact.
      scope: SCOPE,
    });
    expect(await runState(seeded.run.runId)).toBe('COMPLETED');
    const published = row!.publication;
    expect(published.scope).toBe(SCOPE);
    expect(published.templateId).toBe('P-2');
    expect(published.period).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(published.population).toEqual({ rowsParsed: 2, included: 2, excluded: 0, indeterminate: 0 });
    expect(published.coverage).toEqual([
      { targetSystem: seeded.targets[1]!.registrationId, inspected: 2, uninspected: 0, records: [] },
    ]);
    expect(published.conditions).toEqual([
      { conditionId: 'C1', origin: 'RULE', confirmation: null, value: 'COMPLIANT', total: 2 },
    ]);
    expect(published.exceptions).toEqual({ total: 0, records: [] });
    expect(published.unevaluated).toEqual({ total: 0, records: [] });
    expect(published.controlFields).toEqual(['roles']);
    expect(published.gate).toMatchObject({ passed: true, checks: 20, failed: [] });
    expect(published.evidence).toMatchObject({ state: 'SEALED', missingRequired: 0 });
    expect(published.statement).toBe('Every condition on every inspected record is Compliant.');

    // One Result event, and it is a success: a Run that concluded is not a failure.
    const events = await sql`SELECT outcome,payload FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='lifecycle.result-sealed'`;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'success' });
    expect(events[0]!.payload).toMatchObject({ outcome: 'PASS', rule: 'pass', sealed: true, version: 1 });
    // The scope statement stays on the Result. The chain is immutable, and nothing that
    // does not need to be in it goes in.
    expect(JSON.stringify(events[0]!.payload)).not.toContain('nothing else');
  });

  it('reports Control Failure with the prohibited pair the Template promises to report', async () => {
    const seeded = await seed();
    await executeAdapterSteps(dependencies(seeded, CONFLICTED_ACCOUNTS), seeded.job);

    const row = await result(seeded.run.runId);
    expect(row).toMatchObject({
      outcome: 'CONTROL_FAILURE',
      outcome_row: 'control-failure',
      sealed: true,
      run_state: 'COMPLETED',
      gate_passed: true,
    });
    const published = row!.publication;
    expect(published.exceptions.total).toBe(1);
    const finding = published.exceptions.records[0]!;
    expect(finding.populationRecordKey).toBe('AG-1003');
    expect(finding.conditionIds).toEqual(['C1']);
    // §C P-2: "At least one prohibited pair exists; report every pair."
    expect(finding.diagnostics.join(' ')).toContain(
      'prohibited permission pair CREATE_VENDOR + APPROVE_VENDOR',
    );
    // The §C control-specific field, and only it.
    expect(Object.keys(finding.fields)).toEqual(['roles']);
    expect(finding.fields['roles']).toEqual(['VENDOR_MAINTAINER', 'VENDOR_APPROVER']);
    expect(published.statement).toBe('At least one record failed a condition of this control.');
    // A Control Failure is a conclusion, not a failed seal.
    expect(
      (await sql`SELECT outcome FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='lifecycle.result-sealed'`)[0],
    ).toMatchObject({ outcome: 'success' });
  });

  it('lets a failed Gate row win over Control Failure, in §E.1 order', async () => {
    // The same conflicted extraction, over a population that duplicates a DIFFERENT
    // account: §H's duplicate-primary-keys row fails, and AG-1003's Exception is still
    // there. The Gate row is ABOVE the Control Failure row, so the Run is Inconclusive —
    // the ordering this story exists to protect, over a Run that really produced both.
    const seeded = await seed(DUPLICATED_POPULATION);
    await executeAdapterSteps(dependencies(seeded, CONFLICTED_ACCOUNTS), seeded.job);

    const row = await result(seeded.run.runId);
    expect(row).toMatchObject({
      outcome: 'INCONCLUSIVE',
      outcome_row: 'gate-failed',
      sealed: true,
      run_state: 'INCONCLUSIVE',
      gate_passed: false,
    });
    expect(row!.publication.gate.failed).toContain('duplicate-primary-keys');
    // The Exception is still PUBLISHED: the Run found it, and the outcome says only that
    // the Evidence does not support concluding from it.
    expect(row!.publication.exceptions.total).toBe(1);
    expect(row!.publication.statement).toBe('The Evidence does not support a conclusion.');
    expect(await runState(seeded.run.runId)).toBe('INCONCLUSIVE');
  });

  it('publishes every exclusion with the reason the inclusion rule gave', async () => {
    const seeded = await seed(MIXED_POPULATION);
    await executeAdapterSteps(dependencies(seeded), seeded.job);
    const published = (await result(seeded.run.runId))!.publication;
    expect(published.population).toEqual({ rowsParsed: 2, included: 1, excluded: 1, indeterminate: 0 });
    expect(published.exclusions).toEqual([
      { reason: 'Outside inclusion rule: status (text)', total: 1, records: ['#2'] },
    ]);
  });

  it('seals a zero-record Pass with every count 0 and says no record was inspected', async () => {
    const seeded = await seed(EMPTY_POPULATION, { zeroRecordPass: true });
    await executeAdapterSteps(dependencies(seeded), seeded.job);

    const row = await result(seeded.run.runId);
    expect(row).toMatchObject({ outcome: 'PASS', outcome_row: 'pass', sealed: true, gate_passed: true });
    const published = row!.publication;
    expect(published.population).toEqual({ rowsParsed: 0, included: 0, excluded: 0, indeterminate: 0 });
    expect(published.coverage).toEqual([
      { targetSystem: seeded.targets[1]!.registrationId, inspected: 0, uninspected: 0, records: [] },
    ]);
    expect(published.conditions).toEqual([]);
    expect(published.exceptions.total).toBe(0);
    expect(published.statement).toBe(
      'Every condition on every inspected record is Compliant. No record was inspected.',
    );
  });

  it('never passes an empty population the version did not opt in for', async () => {
    // The opt-in is the VERSION's, and it is consumed by the population reconciliation:
    // without it `nonempty-population` fails, so the Run never reaches the adapter stage
    // and its Result is the Inconclusive its Gate-failed state names.
    const seeded = await seed(EMPTY_POPULATION);
    await executeAdapterSteps(dependencies(seeded), seeded.job);
    const row = await result(seeded.run.runId);
    expect(row).toMatchObject({
      outcome: 'INCONCLUSIVE',
      outcome_row: 'gate-failed',
      gate_passed: false,
      run_state: 'INCONCLUSIVE',
    });
    expect(row!.publication.statement).toContain('No record was inspected.');
  });

  it('completes a Run that failed before its first Work Item, with zeros it did not invent', async () => {
    // The population stage takes terminal transitions too, so it completes the Run there.
    // A Run that never reconciled has no population facts at all, and the Result publishes
    // zeros rather than nothing: an absent count is indistinguishable from a count of zero
    // to everything downstream.
    const seeded = await seed();
    await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${seeded.run.runId}`;
    await sql.begin(async (tx) => {
      await tx`DELETE FROM population_row WHERE run_id=${seeded.run.runId}`;
      await tx`DELETE FROM population_snapshot WHERE run_id=${seeded.run.runId}`;
      await tx`UPDATE population_execution SET status='RETRY', attempts=4, lease_until=now()-interval '1 hour' WHERE run_id=${seeded.run.runId}`;
    });
    await acquirePopulation(
      {
        repository: new PostgresPopulationRepository(db),
        acquisition: {
          acquire: () => Promise.reject(new Error('the Target System is unreachable')),
        },
        store: seeded.store,
        clock: new SystemClock(),
        ids,
      },
      seeded.job,
    );
    const row = await result(seeded.run.runId);
    expect(row).toMatchObject({
      outcome: 'RUN_FAILED',
      outcome_row: 'run-failed',
      sealed: true,
      run_state: 'RUN_FAILED',
      gate_passed: false,
    });
    expect(row!.publication.population).toEqual({
      rowsParsed: 0, included: 0, excluded: 0, indeterminate: 0,
    });
    expect(row!.publication.statement).toBe(
      'The Run could not complete, so it concluded nothing. No record was inspected.',
    );
  });

  /* ------------------------------------------- the rules the database holds --- */

  it('refuses to change a sealed outcome, from anywhere', async () => {
    const seeded = await seed();
    await executeAdapterSteps(dependencies(seeded), seeded.job);
    const before = await result(seeded.run.runId);
    expect(before?.outcome).toBe('PASS');

    await expect(
      sql`UPDATE run_result SET outcome='CONTROL_FAILURE', outcome_row='control-failure' WHERE run_id=${seeded.run.runId}`,
    ).rejects.toThrow(/A sealed Result is immutable/);
    // Not even a re-statement of what is already there: an UPDATE to a sealed Result is
    // refused whatever it says.
    await expect(
      sql`UPDATE run_result SET sealed_at=now() WHERE run_id=${seeded.run.runId}`,
    ).rejects.toThrow(/A sealed Result is immutable/);
    expect(await result(seeded.run.runId)).toEqual(before);
  });

  it('refuses a terminal Run that has no Result', async () => {
    const seeded = await seed();
    await executeAdapterSteps(dependencies(seeded), seeded.job);
    // The forcing function behind "compute the outcome in the transaction that completes
    // the Run": remove the Result and the Run cannot be terminal any more.
    await expect(
      sql.begin(async (tx) => {
        await tx`DELETE FROM run_result WHERE run_id=${seeded.run.runId}`;
        await tx`UPDATE audit_run SET state='INCONCLUSIVE' WHERE run_id=${seeded.run.runId}`;
      }),
    ).rejects.toThrow(/without a sealed Result/);
    expect((await result(seeded.run.runId))?.outcome).toBe('PASS');
  });

  it('refuses a PASS whose Gate did not pass, and a row that disagrees with its outcome', async () => {
    const seeded = await seed(DUPLICATED_POPULATION);
    await executeAdapterSteps(dependencies(seeded), seeded.job);
    const other = seeded.run.runId;
    // A passed Gate is NECESSARY for a Pass, and this is the half a CHECK can hold. Written
    // as raw SQL, because a constraint tested through the command proves nothing about it.
    await sql`DELETE FROM run_result WHERE run_id=${other}`;
    const insert = (outcome: string, row: string, gate: boolean, state: string) =>
      sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
          VALUES(${other},1,${outcome},${row},true,${state},${gate},now(),NULL,'{}'::jsonb)`;
    await expect(insert('PASS', 'pass', false, 'COMPLETED')).rejects.toThrow(
      /run_result_pass_requires_gate/,
    );
    // The §E.1 row and the outcome it produces cannot disagree.
    await expect(insert('PASS', 'control-failure', true, 'COMPLETED')).rejects.toThrow(
      /run_result_row/,
    );
    // Nor can the outcome and the Run state, where the outcome IS a state.
    await expect(insert('RUN_FAILED', 'run-failed', false, 'COMPLETED')).rejects.toThrow(
      /run_result_state_agrees/,
    );
    // And only Pending Confirmation is unsealed.
    await expect(
      sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
          VALUES(${other},1,'PASS','pass',false,'COMPLETED',true,now(),NULL,'{}'::jsonb)`,
    ).rejects.toThrow(/run_result_sealed/);
    // Put the Run back where the trigger needs it, so the file's teardown can run.
    await insert('INCONCLUSIVE', 'gate-failed', false, 'INCONCLUSIVE');
  });

  it('seals a pending Result exactly once, raising its version', async () => {
    // Epic 3 produces evaluations of origin RULE only, so no Result of this epic is ever
    // pending. The row and its one legal transition are still written and still tested:
    // §E.1 marks Pending Confirmation "(unsealed)", and the trigger has to permit exactly
    // that one update and nothing else.
    const seeded = await seed();
    await executeAdapterSteps(dependencies(seeded), seeded.job);
    const runId = seeded.run.runId;
    await sql`DELETE FROM run_result WHERE run_id=${runId}`;
    await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
              VALUES(${runId},1,'PENDING_CONFIRMATION','pending-confirmation',false,'COMPLETED',true,now(),NULL,'{}'::jsonb)`;
    // A "sealing" that does not seal, and one that moves the version by anything but one,
    // are both an outcome changing under another name.
    await expect(
      sql`UPDATE run_result SET outcome='PASS', outcome_row='pass', sealed=true WHERE run_id=${runId}`,
    ).rejects.toThrow(/may only be sealed, once/);
    await expect(
      sql`UPDATE run_result SET version=2 WHERE run_id=${runId}`,
    ).rejects.toThrow(/run_result_sealed|may only be sealed, once/);
    await sql`UPDATE run_result SET outcome='PASS', outcome_row='pass', sealed=true, version=2 WHERE run_id=${runId}`;
    expect(await result(runId)).toMatchObject({ outcome: 'PASS', sealed: true, version: 2 });
    // And now it is sealed, so nothing may change it again.
    await expect(
      sql`UPDATE run_result SET outcome='CONTROL_FAILURE', outcome_row='control-failure', version=3 WHERE run_id=${runId}`,
    ).rejects.toThrow(/A sealed Result is immutable/);
  });

  it('computes the outcome exactly once, whatever a redelivery does', async () => {
    const seeded = await seed();
    await executeAdapterSteps(dependencies(seeded), seeded.job);
    const before = await result(seeded.run.runId);
    // A redelivered job re-reads the claim, finds the Run terminal and writes nothing.
    await executeAdapterSteps(dependencies(seeded, CONFLICTED_ACCOUNTS), seeded.job);
    expect(await result(seeded.run.runId)).toEqual(before);
    expect(
      await sql`SELECT count(*)::int AS total FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='lifecycle.result-sealed'`,
    ).toEqual([{ total: 1 }]);
  });
});
