import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acquirePopulation,
  executeAdapterSteps,
  initiateRun,
  PopulationAcquisitionError,
  type AcquiredArtifact,
  type EvidenceStore,
  type ExceptionFingerprinter,
  type ResolvedCredential,
} from '@intellifin/application';
import {
  bindingDigest,
  bindingDigestEnvelope,
  exceptionFingerprint,
  GATE_AFFECTED_LIMIT,
  GATE_CHECKS,
  GATE_DIAGNOSTICS,
  initialDraftCompliance,
  initialDraftEvidence,
  initialDraftPopulation,
  initialDraftSections,
  registrationDigest,
  sha256Hex,
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
import { resolvedCredential } from '@intellifin/infrastructure/credentials';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * Story 3.8 against a real PostgreSQL 18 at generation 24.
 *
 * The plan is a REAL one, derived by the compiler through `activeRunVersion`, and every
 * Gate row is read back out of `run_gate_check` rather than out of the command's return
 * value: what an auditor reads is the row, and a command that decided correctly and stored
 * something else is exactly the defect this file exists to catch.
 */
const url = process.env.DATABASE_URL;

const CREDENTIAL = 'cred://synthetic/run-gate';
const TOKEN = 'SECRET-TOKEN-run-gate-do-not-store-me';

/** The CLOSED collection envelope a Northstar API actually serves, `complete` included. */
function collection(itemsKey: string, items: readonly unknown[], schema: readonly string[]): string {
  return JSON.stringify({
    synthetic: { marker: 'SYNTHETIC-NORTHSTAR-FIXTURE' },
    schema_version: 1, representation: 'population-rows-v1', source: itemsKey,
    title: itemsKey, generation: 'g1', generated_at: '2026-09-01T00:00:00.000Z',
    effective_period: { from: '2026-01-01', to: '2026-12-31' },
    schema, complete: true, returned: items.length,
    declared_count_endpoint: `/${itemsKey}/count`,
    [itemsKey]: items,
  });
}

/**
 * A population and an extraction that agree exactly: two accounts, each resolved once.
 *
 * Every §H row has to be able to PASS, or the Gate is a machine nobody can get through and
 * the rows that fail prove nothing about the rows that do not.
 */
const CLEAN_POPULATION = 'account_id,status\nAG-1001,Active\nAG-1003,Active\n';
const CLEAN_ACCOUNTS = collection(
  'accounts',
  [
    { account_id: 'AG-1001', roles: ['AP_CLERK'], status: 'Active' },
    { account_id: 'AG-1003', roles: ['OPS_CLERK'], status: 'Active' },
  ],
  ['account_id', 'roles', 'status'],
);
/** The same population against an extraction that resolves AG-1003 twice: ambiguous. */
const AMBIGUOUS_ACCOUNTS = collection(
  'accounts',
  [
    { account_id: 'AG-1001', roles: ['AP_CLERK'], status: 'Active' },
    { account_id: 'AG-1003', roles: ['OPS_CLERK'], status: 'Active' },
    { account_id: 'AG-1003', roles: ['LOAN_ADMIN'], status: 'Active' },
  ],
  ['account_id', 'roles', 'status'],
);
/**
 * The same population against an extraction whose second account carries a role the
 * RoleMatrix does not declare: §B's unnamed value.
 */
const UNKNOWN_ROLE_ACCOUNTS = collection(
  'accounts',
  [
    { account_id: 'AG-1001', roles: ['AP_CLERK'], status: 'Active' },
    { account_id: 'AG-1003', roles: ['UNKNOWN_ROLE_X'], status: 'Active' },
  ],
  ['account_id', 'roles', 'status'],
);
/** A population carrying one account twice: §H's duplicate Source primary key. */
const DUPLICATED_POPULATION = 'account_id,status\nAG-1001,Active\nAG-1003,Active\nAG-1003,Active\n';

const ROLE_MATRIX = [
  'entry,role,permission',
  '1,AP_CLERK,CREATE_PAYMENT',
  '1,AP_CLERK,VIEW_PAYMENT',
  '2,OPS_CLERK,VIEW_LOAN',
  '3,LOAN_ADMIN,CONFIGURE_LIMITS',
  '',
].join('\n');

const FINGERPRINTER: ExceptionFingerprinter = {
  keyId: 'k-gate',
  fingerprint: (envelope) => exceptionFingerprint(utf8Bytes('story-3-8-gate-key'), envelope),
};

describe.skipIf(!url)('the Run-level Evidence Quality Gate against PostgreSQL', () => {
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
      throw new Error('Run-level Gate tests require an isolated local or CI test database');
    }
    sql = createSqlClient(url!, { max: 5 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES(${author},'Gate test',${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES(${author},'auditor')`;
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const id of procedures) {
        const runs = await sql`SELECT run_id::text AS id FROM audit_run WHERE procedure_id=${id}`;
        for (const run of runs) {
          await sql`DELETE FROM pgboss.job WHERE name='runs' AND data->>'runId'=${run.id}`;
          await sql`DELETE FROM run_exception WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_observation_evaluation WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_observation_check WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_observation WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_step_execution WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_session_step WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_work_item WHERE run_id=${run.id}`;
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

  /** Seed an ACTIVE P-2 version with the given Targets and drive its population ready. */
  async function seed(
    kinds: readonly ('api' | 'versioned-file')[],
    population: string = CLEAN_POPULATION,
    declaration: Partial<Record<string, unknown>> = {},
  ) {
    const declaredSchema = ['account_id', 'status'];
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
      ...initialDraftPopulation('P-2'),
      ...initialDraftCompliance('P-2'),
      ...initialDraftEvidence('P-2'),
      templateId: 'P-2' as const,
      controlName: `Run-level Gate ${ids.next()}`,
      sections: initialDraftSections('P-2'),
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
              ...declaration,
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
    return {
      repository: new PostgresAdapterExecutionRepository(db),
      reference: {
        acquireReference:
          options.reference ??
          (async () => ({ bytes: utf8Bytes(ROLE_MATRIX), mediaType: 'text/csv', location: 'https://synthetic.invalid/rm.csv' })),
      },
      extraction: {
        extract:
          options.extract ??
          (async (_target: ProcedureTargetSnapshot, credential: ResolvedCredential) => {
            credential.authorize({ set: () => undefined });
            return { bytes: utf8Bytes(CLEAN_ACCOUNTS), mediaType: 'application/json', location: 'https://synthetic.invalid/x' };
          }),
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

  const gateRows = (runId: string) =>
    sql`SELECT check_name,outcome,diagnostics,target_systems,work_items,records,total FROM run_gate_check WHERE run_id=${runId} ORDER BY check_name`;
  const runState = async (runId: string) =>
    (await sql`SELECT state FROM audit_run WHERE run_id=${runId}`)[0]?.state as string | undefined;

  it('runs every §H row when the last Work Item completes, and passes a clean Run', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(dependencies(seeded), seeded.job);

    const rows = await gateRows(seeded.run.runId);
    // Twenty rows, always. A row that found nothing is a PASS that was actually evaluated;
    // an absent row is indistinguishable from a row nobody wrote.
    expect(rows).toHaveLength(GATE_CHECKS.length);
    expect(rows.map((row) => row.check_name).sort()).toEqual([...GATE_CHECKS].sort());
    const failing = rows.filter((row) => row.outcome !== 'PASS');
    expect(failing.map((row) => [row.check_name, row.diagnostics])).toEqual([]);
    expect(await runState(seeded.run.runId)).toBe('COMPLETED');

    // Every check outcome is a Timeline event, and the Run's package is sealed with it.
    const events = await sql`SELECT payload->>'check' AS check, payload->>'outcome' AS outcome FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='execution.gate-checked' ORDER BY sequence`;
    expect(events.map((row) => row.check)).toEqual([...GATE_CHECKS, 'run-level-gate']);
    expect(events.every((row) => row.outcome === 'PASS')).toBe(true);
    const seal = await sql`SELECT state,run_state FROM run_evidence_package WHERE run_id=${seeded.run.runId}`;
    expect(seal[0]).toMatchObject({ state: 'SEALED', run_state: 'COMPLETED' });
  });

  it('fails the count-reconciliation row on a declared count that does not match, and stops INCONCLUSIVE', async () => {
    // The population stage already refuses this Run, so the Gate is not what stops it — but
    // the Run must never reach a conclusion with an unreconciled population, and this is
    // the row that says so if it ever does.
    const seeded = await seed(['api'], CLEAN_POPULATION, { count: 99 });
    expect(await runState(seeded.run.runId)).toBe('INCONCLUSIVE');
    const checks = (await sql`SELECT checks FROM population_snapshot WHERE run_id=${seeded.run.runId}`)[0]
      ?.checks as { name: string; passed: boolean }[];
    expect(checks.find((check) => check.name === 'declared-count')?.passed).toBe(false);
    // The stage refuses to claim a Run that is no longer RUNNING, so no Gate row is written
    // for it: the Run concluded before the last Work Item, which is the honest record.
    await executeAdapterSteps(dependencies(seeded), seeded.job);
    expect(await gateRows(seeded.run.runId)).toHaveLength(0);
  });

  it('names a stale snapshot rather than only failing it', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    // The reconciliation stored the generation time the declaration stated. Move it back
    // inside the effective period: a snapshot that cannot cover the period it is scoped by.
    await sql`UPDATE population_snapshot SET generated_at = '2026-08-15T00:00:00.000Z' WHERE run_id=${seeded.run.runId}`;
    await executeAdapterSteps(dependencies(seeded), seeded.job);

    const rows = await gateRows(seeded.run.runId);
    const freshness = rows.find((row) => row.check_name === 'snapshot-freshness')!;
    expect(freshness.outcome).toBe('FAIL');
    expect(freshness.diagnostics).toEqual(['snapshot-stale']);
    expect(await runState(seeded.run.runId)).toBe('INCONCLUSIVE');
  });

  it('makes an unknown generation time INCONCLUSIVE rather than letting it pass', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    // A row an earlier build wrote has no generation time at all. "The check was
    // unavailable" must never be a path on which an unproven snapshot passes.
    await sql`UPDATE population_snapshot SET generated_at = NULL WHERE run_id=${seeded.run.runId}`;
    await executeAdapterSteps(dependencies(seeded), seeded.job);
    const rows = await gateRows(seeded.run.runId);
    expect(rows.find((row) => row.check_name === 'snapshot-freshness')?.diagnostics).toEqual([
      'snapshot-generation-unknown',
    ]);
    expect(await runState(seeded.run.runId)).toBe('INCONCLUSIVE');
  });

  it('lets a failed Work Item run the Run to its end, and yields INCONCLUSIVE on coverage', async () => {
    const seeded = await seed(['api']);
    const deps = dependencies(seeded, {
      extract: async (_target, credential) => {
        credential.authorize({ set: () => undefined });
        throw new PopulationAcquisitionError('transport');
      },
    });
    await executeAdapterSteps(deps, seeded.job);

    const items = await sql`SELECT state,attempts,cycles,diagnostic FROM run_work_item WHERE run_id=${seeded.run.runId}`;
    // The owner's 2026-09-05 decision: the first bounded cycle, then automatically ONE
    // more, then FAILED. Four attempts per cycle from the plan's frozen retry limit.
    expect(items[0]).toMatchObject({ state: 'FAILED', attempts: 8, cycles: 2 });
    // The Run went on to its own end rather than stopping on the Work Item.
    const execution = await sql`SELECT status FROM run_execution WHERE run_id=${seeded.run.runId}`;
    expect(execution[0]?.status).toBe('EXTRACTION_COMPLETE');
    const rows = await gateRows(seeded.run.runId);
    const coverage = rows.find((row) => row.check_name === 'per-record-coverage')!;
    expect(coverage.outcome).toBe('FAIL');
    expect(coverage.diagnostics).toEqual(['record-uncovered']);
    expect(coverage.records).toEqual(['AG-1001', 'AG-1003']);
    expect(coverage.total).toBe(2);
    expect(await runState(seeded.run.runId)).toBe('INCONCLUSIVE');
    // Partial Evidence is preserved: every reservation is abandoned and NAMED, never
    // removed. There are EIGHT of them, one per attempt, because an adapter extraction is
    // named from the attempt as well as the step — without that, attempt 2 would upload
    // different bytes to attempt 1's key, the store would reconcile them and refuse, and
    // every retry after the first would die accusing the store of an integrity failure
    // against a Target System that had merely been unreachable once. Each attempt here
    // fails in transport, BEFORE anything is frozen, so all eight stay open and all eight
    // are abandoned. They must be distinct: eight entries naming one artifact would mean
    // the key never varied.
    const seal = await sql`SELECT state,abandoned FROM run_evidence_package WHERE run_id=${seeded.run.runId}`;
    expect(seal[0]?.state).toBe('SEALED');
    const abandoned = seal[0]?.abandoned as { evidenceId: string }[];
    expect(abandoned.length).toBe(8);
    expect(new Set(abandoned.map((entry) => entry.evidenceId)).size).toBe(8);
  });

  it('fails the ambiguous-match and coverage rows on a Target System that resolves two candidates', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(
      dependencies(seeded, {
        extract: async (_target, credential) => {
          credential.authorize({ set: () => undefined });
          return { bytes: utf8Bytes(AMBIGUOUS_ACCOUNTS), mediaType: 'application/json', location: 'x' };
        },
      }),
      seeded.job,
    );
    const rows = await gateRows(seeded.run.runId);
    expect(rows.find((row) => row.check_name === 'ambiguous-match')?.diagnostics).toEqual([
      'ambiguous-match',
    ]);
    const coverage = rows.find((row) => row.check_name === 'per-record-coverage')!;
    expect(coverage.diagnostics).toEqual(['record-ambiguous']);
    expect(coverage.records).toEqual(['AG-1003']);
    expect(await runState(seeded.run.runId)).toBe('INCONCLUSIVE');
  });

  it('fails the unnamed-value row on a value the compiled condition does not name', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(
      dependencies(seeded, {
        extract: async (_target, credential) => {
          credential.authorize({ set: () => undefined });
          return { bytes: utf8Bytes(UNKNOWN_ROLE_ACCOUNTS), mediaType: 'application/json', location: 'x' };
        },
      }),
      seeded.job,
    );
    const rows = await gateRows(seeded.run.runId);
    const unnamed = rows.find((row) => row.check_name === 'unnamed-value')!;
    expect(unnamed.outcome).toBe('FAIL');
    expect(unnamed.diagnostics).toEqual(['unnamed-value']);
    expect(unnamed.records).toEqual(['AG-1003']);
    // §B's own sentence is the observable, and it is a DIFFERENT defect from a value the
    // condition names and could not read — which lands on the coverage and mandatory-value
    // rows instead. Every record here IS covered, so those rows pass.
    const evaluation = await sql`SELECT diagnostic FROM run_observation_evaluation e JOIN run_observation o ON o.observation_id=e.observation_id WHERE e.run_id=${seeded.run.runId} AND o.population_record_key='AG-1003'`;
    expect(String(evaluation[0]?.diagnostic)).toContain('rule does not name value UNKNOWN_ROLE_X');
    expect(rows.find((row) => row.check_name === 'per-record-coverage')?.outcome).toBe('PASS');
    expect(rows.find((row) => row.check_name === 'mandatory-values')?.outcome).toBe('PASS');
    expect(await runState(seeded.run.runId)).toBe('INCONCLUSIVE');
  });

  it('names a duplicate Source primary key on its own row', async () => {
    const seeded = await seed(['versioned-file', 'api'], DUPLICATED_POPULATION);
    await executeAdapterSteps(dependencies(seeded), seeded.job);
    const rows = await gateRows(seeded.run.runId);
    const duplicates = rows.find((row) => row.check_name === 'duplicate-primary-keys')!;
    expect(duplicates.outcome).toBe('FAIL');
    expect(duplicates.diagnostics).toEqual(['duplicate-primary-key']);
    expect(duplicates.records).toEqual(['AG-1003']);
    expect(await runState(seeded.run.runId)).toBe('INCONCLUSIVE');
    // Each finding raises its own Gate event, so an auditor reading the Timeline sees the
    // duplicate key rather than "the population is bad".
    const events = await sql`SELECT payload->>'diagnostic' AS diagnostic FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='execution.gate-checked' AND payload->>'check'='duplicate-primary-keys'`;
    expect(events.map((row) => row.diagnostic)).toEqual(['duplicate-primary-key']);
  });

  it('ends the Run RUN_FAILED on a denied action, and logs it as a security event', async () => {
    const seeded = await seed(['api']);
    const deps = dependencies(seeded, {
      extract: async (_target, credential) => {
        credential.authorize({ set: () => undefined });
        // What the HTTP adapter raises for a 401 or a 403.
        throw new PopulationAcquisitionError('denied');
      },
    });
    await executeAdapterSteps(deps, seeded.job);

    const items = await sql`SELECT state,attempts,diagnostic FROM run_work_item WHERE run_id=${seeded.run.runId}`;
    // A denial is not retried: the same request produces the same answer, and spending
    // seven more attempts on it proves nothing while spending the Run's frozen limits.
    expect(items[0]).toMatchObject({ state: 'FAILED', attempts: 1, diagnostic: 'extraction-denied' });
    expect(await runState(seeded.run.runId)).toBe('RUN_FAILED');
    const security = await sql`SELECT outcome,payload FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='security.action-denied'`;
    expect(security).toHaveLength(1);
    expect(security[0]?.outcome).toBe('denied');
    expect((security[0]?.payload as Record<string, unknown>)['cause']).toBe('action-denied');
    // Never CANCELED, and the package is still sealed at the terminal transition.
    expect(await runState(seeded.run.runId)).not.toBe('CANCELED');
    const seal = await sql`SELECT run_state FROM run_evidence_package WHERE run_id=${seeded.run.runId}`;
    expect(seal[0]?.run_state).toBe('RUN_FAILED');
  });

  it('ends the Run RUN_FAILED on a scope violation, and logs that as a security event too', async () => {
    const seeded = await seed(['api']);
    await executeAdapterSteps(
      dependencies(seeded, {
        extract: async (_target, credential) => {
          credential.authorize({ set: () => undefined });
          throw new PopulationAcquisitionError('scope');
        },
      }),
      seeded.job,
    );
    expect(await runState(seeded.run.runId)).toBe('RUN_FAILED');
    const security = await sql`SELECT payload->>'cause' AS cause FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='security.action-denied'`;
    expect(security.map((row) => row.cause)).toEqual(['scope-violation']);
  });

  it('ends the Run RUN_FAILED when a Session Step fails after bounded retries, before any Work Item', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(
      dependencies(seeded, {
        reference: async () => {
          throw new PopulationAcquisitionError('transport');
        },
      }),
      seeded.job,
    );
    const steps = await sql`SELECT state,attempts FROM run_session_step WHERE run_id=${seeded.run.runId}`;
    // ONE bounded cycle for a Run-level Session Step: §E maps its failure to RUN_FAILED,
    // so the owner's automatic second cycle — which exists to let a Run CONTINUE past a
    // failed unit — has nothing to buy here.
    expect(steps[0]).toMatchObject({ state: 'FAILED', attempts: 4 });
    expect(await runState(seeded.run.runId)).toBe('RUN_FAILED');
    // No Work Item ran, so no Gate row was written: the Run never reached its last one.
    expect(await gateRows(seeded.run.runId)).toHaveLength(0);
    const items = await sql`SELECT state FROM run_work_item WHERE run_id=${seeded.run.runId}`;
    expect(items.map((row) => row.state)).toEqual(['PENDING']);
  });

  it('stops the Run INCONCLUSIVE with partial Evidence when the Step Execution limit is spent, never CANCELED', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    // Ten thousand Step Executions is the plan's frozen limit; a Run cannot really reach it
    // inside a test, so the COUNT is what is made real. These rows are this Run's own, and
    // the sweep's read is `count(*)` over them.
    const rows = Array.from({ length: 10_000 }, () => ({}));
    await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,action,state,attempt,started_at,completed_at,diagnostic)
      SELECT gen_random_uuid(),${seeded.run.runId},'session-1',NULL,'extract-adapter','SUCCEEDED',1,now(),now(),NULL FROM generate_series(1,${rows.length})`;
    await executeAdapterSteps(dependencies(seeded), seeded.job);

    expect(await runState(seeded.run.runId)).toBe('INCONCLUSIVE');
    expect(await runState(seeded.run.runId)).not.toBe('CANCELED');
    const execution = await sql`SELECT status,diagnostic FROM run_execution WHERE run_id=${seeded.run.runId}`;
    expect(execution[0]).toMatchObject({ status: 'TERMINAL', diagnostic: 'run-step-execution-limit' });
    // Partial Evidence is preserved: the population artifact stays REGISTERED and the
    // package is sealed rather than discarded.
    const population = await sql`SELECT state FROM population_evidence WHERE run_id=${seeded.run.runId}`;
    expect(population[0]?.state).toBe('REGISTERED');
    const seal = await sql`SELECT run_state FROM run_evidence_package WHERE run_id=${seeded.run.runId}`;
    expect(seal[0]?.run_state).toBe('INCONCLUSIVE');
  });

  it('takes RUN_FAILED from a Gate row whose diagnostic says so, over an INCONCLUSIVE one', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    // An integrity finding recorded against this Run's Evidence. §H makes the integrity row
    // RUN_FAILED during the Run, and §E.1 puts execution failure above Evidence falling
    // short — so it must outrank the coverage gap the ambiguous extraction also produces.
    await executeAdapterSteps(
      dependencies(seeded, {
        extract: async (_target, credential) => {
          credential.authorize({ set: () => undefined });
          return { bytes: utf8Bytes(AMBIGUOUS_ACCOUNTS), mediaType: 'application/json', location: 'x' };
        },
      }),
      seeded.job,
    );
    const evidence = (await sql`SELECT evidence_id::text AS id,object_key,digest FROM run_evidence WHERE run_id=${seeded.run.runId} AND kind='reference-source'`)[0]!;
    await sql.begin(async (tx) => {
      await tx`DELETE FROM run_evidence_package WHERE run_id=${seeded.run.runId}`;
      await tx`DELETE FROM run_gate_check WHERE run_id=${seeded.run.runId}`;
      await tx`UPDATE audit_run SET state='RUNNING' WHERE run_id=${seeded.run.runId}`;
      await tx`UPDATE run_execution SET status='RETRY' WHERE run_id=${seeded.run.runId}`;
      await tx`INSERT INTO run_evidence_integrity(finding_id,run_id,evidence_id,object_key,finding,expected_digest,observed_digest,expected_size,observed_size,detected_at)
        VALUES(gen_random_uuid(),${seeded.run.runId},${String(evidence.id)},${String(evidence.object_key)},'digest-mismatch',${String(evidence.digest)},${'f'.repeat(64)},1,1,now())`;
    });
    await executeAdapterSteps(
      dependencies(seeded, {
        extract: async (_target, credential) => {
          credential.authorize({ set: () => undefined });
          return { bytes: utf8Bytes(AMBIGUOUS_ACCOUNTS), mediaType: 'application/json', location: 'x' };
        },
      }),
      seeded.job,
    );

    const rows = await gateRows(seeded.run.runId);
    expect(rows.find((row) => row.check_name === 'integrity')?.diagnostics).toEqual([
      'integrity-mismatch',
    ]);
    // The coverage row still fails; the Run state is the stronger of the two.
    expect(rows.find((row) => row.check_name === 'per-record-coverage')?.outcome).toBe('FAIL');
    expect(await runState(seeded.run.runId)).toBe('RUN_FAILED');
  });

  it('ends the Run RUN_FAILED on an in-Run integrity mismatch and leaves the bytes alone', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(dependencies(seeded), seeded.job);
    const step = (await sql`SELECT evidence_id::text AS id FROM run_session_step WHERE run_id=${seeded.run.runId}`)[0]!;
    const key = (await sql`SELECT object_key FROM run_evidence WHERE evidence_id=${String(step.id)}`)[0]!
      .object_key as string;
    const tampered = utf8Bytes('entry,role,permission\n1,TAMPERED,VIEW\n');
    seeded.objects.set(key, tampered);
    // Re-claim the stage on a Run that is RUNNING again: the resume re-reads what it froze.
    await sql`UPDATE run_execution SET status='RETRY' WHERE run_id=${seeded.run.runId}`;
    await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${seeded.run.runId}`;
    await executeAdapterSteps(dependencies(seeded), seeded.job);

    expect(await runState(seeded.run.runId)).toBe('RUN_FAILED');
    expect(seeded.objects.get(key)).toBe(tampered);
  });

  it('writes the Gate rows once, and refuses at the database what no command may store', async () => {
    const seeded = await seed(['versioned-file', 'api']);
    await executeAdapterSteps(dependencies(seeded), seeded.job);
    const before = await gateRows(seeded.run.runId);
    expect(before).toHaveLength(GATE_CHECKS.length);

    const events = () =>
      sql`SELECT count(*)::int AS count FROM audit_events WHERE aggregate_id=${seeded.run.runId} AND event_type='execution.gate-checked'`;
    const appended = (await events())[0]?.count as number;

    // A Gate failure is never repaired by re-running a check. The command re-reads and
    // writes nothing — not a row and not a second Timeline event, which an insert guarded
    // only by ON CONFLICT DO NOTHING would still have appended — and the database refuses
    // an UPDATE at all.
    await sql`UPDATE run_execution SET status='RETRY' WHERE run_id=${seeded.run.runId}`;
    await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${seeded.run.runId}`;
    await executeAdapterSteps(dependencies(seeded), seeded.job);
    expect(await gateRows(seeded.run.runId)).toEqual(before);
    expect((await events())[0]?.count).toBe(appended);
    await expect(
      sql`UPDATE run_gate_check SET outcome='PASS', diagnostics='[]'::jsonb WHERE run_id=${seeded.run.runId}`,
    ).rejects.toThrow(/decided once and cannot be changed/);

    const insert = (name: string, outcome: string, diagnostics: string, affected = `'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,0`) =>
      sql.unsafe(
        `INSERT INTO run_gate_check(run_id,check_name,outcome,diagnostics,target_systems,work_items,records,total,decided_at) VALUES ($1,$2,$3,${diagnostics},${affected},now())`,
        [seeded.run.runId, name, outcome],
      );
    // The §H row vocabulary, the closed diagnostic vocabulary and the PASS/FAIL agreement,
    // asserted with raw SQL: a constraint tested through the command proves nothing about
    // the constraint.
    await expect(insert('invented-check', 'FAIL', `'["record-uncovered"]'::jsonb`)).rejects.toThrow(
      /run_gate_check_name/,
    );
    await expect(insert('integrity', 'PASS', `'["integrity-mismatch"]'::jsonb`)).rejects.toThrow(
      /run_gate_check_outcome/,
    );
    await expect(insert('integrity', 'FAIL', `'[]'::jsonb`)).rejects.toThrow(/run_gate_check_outcome/);
    await expect(insert('integrity', 'FAIL', `'["invented-diagnostic"]'::jsonb`)).rejects.toThrow(
      /run_gate_check_diagnostics/,
    );
    await expect(insert('integrity', 'FAIL', `'[7]'::jsonb`)).rejects.toThrow(
      /run_gate_check_diagnostics/,
    );
    // A row that found nothing names nothing.
    await expect(
      insert('integrity', 'PASS', `'[]'::jsonb`, `'["reg"]'::jsonb,'[]'::jsonb,'[]'::jsonb,0`),
    ).rejects.toThrow(/run_gate_check_pass_names_nothing/);
    // A named identity list is bounded; the exact total beside it is not.
    const oversized = JSON.stringify(Array.from({ length: 33 }, (_, index) => `R-${String(index)}`));
    await expect(
      insert('integrity', 'FAIL', `'["integrity-mismatch"]'::jsonb`, `'[]'::jsonb,'[]'::jsonb,'${oversized}'::jsonb,33`),
    ).rejects.toThrow(/run_gate_check_affected/);
    // A sample of EXACTLY the bound is accepted; the refusal above is the bound plus one.
    // Without this the CHECK could be `<= 0` and the test above would still pass.
    const atLimit = JSON.stringify(
      Array.from({ length: GATE_AFFECTED_LIMIT }, (_, index) => `R-${String(index)}`),
    );
    await sql`DELETE FROM run_gate_check WHERE run_id=${seeded.run.runId} AND check_name='integrity'`;
    await expect(
      insert('integrity', 'FAIL', `'["integrity-mismatch"]'::jsonb`, `'[]'::jsonb,'[]'::jsonb,'${atLimit}'::jsonb,${String(GATE_AFFECTED_LIMIT)}`),
    ).resolves.toBeDefined();

    // Both directions, for both vocabularies: every §H row name and every diagnostic the
    // DOMAIN has is storable, or the CHECK is a transcription that quietly refuses a
    // finding the Gate can actually produce — which nothing else would find, because the
    // command would fail its whole terminal transaction on a Run nobody had reproduced.
    for (const diagnostic of GATE_DIAGNOSTICS) {
      await sql`DELETE FROM run_gate_check WHERE run_id=${seeded.run.runId} AND check_name='workspace-access'`;
      await expect(
        insert('workspace-access', 'FAIL', `'["${diagnostic}"]'::jsonb`, `'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,1`),
      ).resolves.toBeDefined();
    }
    await sql`DELETE FROM run_gate_check WHERE run_id=${seeded.run.runId}`;
    for (const name of GATE_CHECKS) {
      await expect(insert(name, 'PASS', `'[]'::jsonb`), name).resolves.toBeDefined();
    }
  });
});
