import { beforeEach, describe, expect, it } from 'vitest';
import {
  observationBatchDigest,
  observationDigest,
  observationIdFor,
  initialDraftCompliance,
  exceptionFingerprint,
  registrationDigest,
  registrationDigestEnvelope,
  decodePopulationUtf8,
  RULE_DOES_NOT_NAME_VALUE,
  POPULATION_CHECK_NAMES,
  sha256HexOfBytes,
  utf8Bytes,
  type ExecutablePlan,
  type ObservationCheckName,
  type ObservationRecord,
  type PopulationGateRow,
  type ProcedureTargetSnapshot,
  type RaisedException,
  type RunRecord,
  type TargetSystemKind,
} from '@intellifin/domain';
import { executeAdapterSteps, type AdapterExecutionDependencies } from './execute-adapter-steps.js';
import {
  PopulationAcquisitionError,
  type ExceptionFingerprinter,
  type AcquiredArtifact,
  type AdapterEvidenceRecord,
  type AdapterExecutionCheckpoint,
  type AdapterExecutionContext,
  type AdapterExecutionRepository,
  type GateCheckRow,
  type GateFactTally,
  type ObservationCheckRow,
  type ObservationEvaluationRow,
  type RunGatePopulationFacts,
  type PackageSeal,
  type PopulationCheckpoint,
  type PopulationRecord,
  type RegisteredObservation,
  type ResolvedCredential,
  type SessionStepRecord,
  type StepExecutionRecord,
  type WorkItemRecord,
} from './execution-ports.js';

/** The one token in this file. Nothing the stage writes may ever contain it. */
const TOKEN = 'SECRET-TOKEN-9d3f-do-not-store-me';

function target(id: string, kind: TargetSystemKind, origin: string): ProcedureTargetSnapshot {
  const fields = {
    kind,
    allowedOrigins: [origin],
    applicationIdentity: '',
    credentialRef: `cred://synthetic/${id}`,
    permittedActions: ['list-records', 'read-attribute'] as const,
    attributeLabelPatterns: ['account_id', 'roles', 'status'],
    secondaryKey: '',
  };
  return {
    registrationId: id,
    displayName: `System ${id}`,
    digest: registrationDigest(fields),
    contract: registrationDigestEnvelope(fields),
  };
}

const LIMITS = {
  retriesPerStep: 3, stepTimeoutSeconds: 120, runStepExecutions: 10000,
  runTimeoutSeconds: 3600, runTokens: 1000000,
} as const;

function plan(targets: readonly ProcedureTargetSnapshot[]): ExecutablePlan {
  return {
    schemaVersion: 1,
    compilerVersion: '1',
    // The version's REAL compiled conditions, so this harness drives the deterministic
    // evaluator the stage builds rather than a stand-in for it (Story 3.7).
    inputs: { templateId: 'P-2', targets, ...initialDraftCompliance('P-2') } as unknown as ExecutablePlan['inputs'],
    sessionSteps: [
      { id: 'session-1', action: 'acquire-population', targetSystemId: null, text: 'x' },
      ...targets.map((entry, index) => ({
        id: `session-${String(index + 2)}`,
        action: 'extract-adapter' as const,
        targetSystemId: entry.registrationId,
        text: 'x',
      })),
    ],
    targetSystems: [],
    observations: [
      { attributeName: 'found', valueType: 'boolean' as const },
      { attributeName: 'roles', valueType: 'roles' as const },
      { attributeName: 'status', valueType: 'text' as const },
    ],
    credentialReferences: targets.map((entry) => ({
      targetSystemId: entry.registrationId,
      credentialRef: entry.contract.credential_ref,
    })),
    limits: { ...LIMITS },
  } as unknown as ExecutablePlan;
}

const RUN: RunRecord = {
  runId: '01920000-0000-7000-8000-000000000001',
  correlationId: '01920000-0000-7000-8000-000000000002',
  procedureId: '01920000-0000-7000-8000-000000000003',
  versionId: '01920000-0000-7000-8000-000000000004',
  versionNumber: 1,
  procedureName: 'Segregation of duties',
  period: { from: '2026-08-01', to: '2026-08-31' },
  state: 'RUNNING',
  kind: 'STANDARD',
  initiatorId: 'auditor',
  sessionId: 'session',
  initiatedAt: '2026-09-01T00:00:00.000Z',
  authorizationRole: 'auditor',
  requestToken: '01920000-0000-7000-8000-000000000005',
};

const JOB = { schemaVersion: 1 as const, runId: RUN.runId, correlationId: RUN.correlationId };

const ROWS = [
  { account_id: 'AG-1001', roles: ['AP_CLERK'], status: 'Active' },
  { account_id: 'AG-1003', roles: ['VENDOR_MAINTAINER', 'VENDOR_APPROVER'], status: 'Active' },
  { account_id: 'AG-1007', roles: ['OPS_CLERK'], status: 'Active' },
  { account_id: 'AG-1007', roles: ['LOAN_ADMIN'], status: 'Active' },
];

/**
 * The CLOSED envelope a Northstar collection actually serves, `complete` included.
 *
 * A response that does not declare itself complete, or that carries a key outside the
 * closed set (an alternate continuation marker), is not PROVABLY complete, and every
 * `found = false` it produced is `UNINSPECTED` rather than a finding. `INCOMPLETE_ACCOUNTS`
 * below is the same rows without that declaration.
 */
const ACCOUNTS = JSON.stringify({
  // The NFR-13 synthetic marker every Northstar response carries. It is part of the
  // closed envelope, and leaving it out of a fixture is how a closed list written twice
  // stayed green here while the real served bytes were judged incomplete.
  synthetic: { marker: 'SYNTHETIC-NORTHSTAR-FIXTURE' },
  schema_version: 1, representation: 'population-rows-v1', source: 'accessgate',
  title: 'AccessGate accounts', generation: 'g1', generated_at: '2026-09-01T00:00:00.000Z',
  effective_period: { from: '2026-01-01', to: '2026-12-31' },
  schema: ['account_id', 'roles', 'status'], complete: true, returned: ROWS.length,
  declared_count_endpoint: '/accessgate/accounts/count',
  accounts: ROWS,
});
const INCOMPLETE_ACCOUNTS = JSON.stringify({ accounts: ROWS });
/**
 * The versioned Reference Source P-2's compiled rule expands a role through.
 *
 * The leading `entry` ordinal is the boundary that keeps two policy entries for one role
 * apart; the golden RoleMatrix uses it to declare `AMBIGUOUS_DUAL` twice. Here it gives
 * AG-1001 a clean expansion and AG-1003 the prohibited pair CREATE_VENDOR + APPROVE_VENDOR.
 */
const ROLE_MATRIX = [
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
const FINGERPRINT_KEY = 'story-3-7-exception-fingerprint-key-x';
const FINGERPRINTER: ExceptionFingerprinter = {
  keyId: 'k-test',
  fingerprint: (envelope) => exceptionFingerprint(utf8Bytes(FINGERPRINT_KEY), envelope),
};

const RECORDS: readonly PopulationRecord[] = [
  { ordinal: 1, values: { account_id: 'AG-1001', status: 'Active' } },
  { ordinal: 2, values: { account_id: 'AG-1003', status: 'Active' } },
  { ordinal: 3, values: { account_id: 'AG-1007', status: 'Active' } },
  { ordinal: 4, values: { account_id: 'AG-9999', status: 'Active' } },
];

/** An in-memory stand-in for `PostgresAdapterExecutionRepository`, with the same seams. */
class FakeRepository implements AdapterExecutionRepository {
  run: RunRecord = { ...RUN };
  population: PopulationCheckpoint | null = {
    revision: 1, status: 'POPULATION_READY', attempts: 1,
    // Thirty minutes before the fixed clock: inside the frozen 3600-second Run deadline
    // this stage INHERITS from the population claim rather than restarting.
    startedAt: '2026-09-04T23:30:00.000Z', attemptStartedAt: '2026-09-04T23:30:00.000Z',
    leaseUntil: '2026-09-04T23:32:00.000Z', evidenceId: 'pop', objectKey: 'pop', envelopeKey: 'pop-envelope',
    rawDigest: 'a'.repeat(64), envelopeDigest: 'b'.repeat(64), size: 1, diagnostic: null,
    stepId: 'session-1', attemptId: 'attempt', evidenceRequired: true,
  };
  checkpoint: AdapterExecutionCheckpoint | null = null;
  steps = new Map<string, SessionStepRecord>();
  items = new Map<string, WorkItemRecord>();
  evidence = new Map<string, AdapterEvidenceRecord>();
  executions: StepExecutionRecord[] = [];
  observations: RegisteredObservation[] = [];
  checks = new Map<string, ObservationCheckRow>();
  evaluations = new Map<string, ObservationEvaluationRow>();
  exceptions = new Map<string, RaisedException>();
  events: { eventType: string; payload: Record<string, unknown>; outcome: string }[] = [];
  seal: PackageSeal | null = null;
  timeline: number[] = [];
  records: readonly PopulationRecord[] = RECORDS;
  /** Story 3.8. The Gate's own rows, and the facts it reads back. */
  gate: GateCheckRow[] = [];
  populationFacts: RunGatePopulationFacts | null = {
    checks: POPULATION_CHECK_NAMES.map((name) => ({ name, passed: true })),
    included: RECORDS.length, excluded: 0, indeterminate: 0, rowsParsed: RECORDS.length,
    unexplained: [],
    // Generated after the end of the effective period and before Run initiation.
    generatedAt: '2026-09-01T00:00:00.000Z',
  };
  populationRows: readonly PopulationGateRow[] = RECORDS.map((record) => ({
    ordinal: record.ordinal,
    values: record.values,
    disposition: 'included' as const,
  }));
  integrity: { evidenceId: string }[] = [];
  private sequence = 0;

  constructor(private currentPlan: ExecutablePlan | null) {}

  async transaction<T>(runId: string, work: (context: AdapterExecutionContext) => Promise<T>): Promise<T> {
    expect(runId).toBe(RUN.runId);
    const repository = this;
    return work({
      run: repository.run,
      population: repository.population,
      checkpoint: repository.checkpoint,
      sessionSteps: [...repository.steps.values()],
      workItems: [...repository.items.values()],
      evidence: [...repository.evidence.values()],
      auditEvents: {
        append: async (draft) => {
          repository.sequence += 1;
          repository.events.push({
            eventType: draft.eventType,
            payload: draft.payload as Record<string, unknown>,
            outcome: draft.outcome,
          });
          return {
            eventId: `event-${String(repository.sequence)}`, sequence: repository.sequence,
            occurredAt: '2026-09-05T00:00:00.000Z', previousHash: null, eventHash: 'x',
            ...draft, aggregateId: draft.aggregateId ?? 'platform',
          } as never;
        },
      },
      frozenPlan: () => Promise.resolve(repository.currentPlan),
      includedRecords: () => Promise.resolve(repository.records),
      saveCheckpoint: async (checkpoint, state) => {
        repository.checkpoint = { ...checkpoint };
        repository.run = { ...repository.run, state };
      },
      saveSessionStep: async (step) => {
        repository.steps.set(step.stepId, { ...step });
      },
      saveWorkItem: async (item) => {
        repository.items.set(item.workItemId, { ...item });
      },
      saveStepExecution: async (execution) => {
        const index = repository.executions.findIndex((row) => row.stepExecutionId === execution.stepExecutionId);
        if (index >= 0) repository.executions[index] = { ...execution };
        else repository.executions.push({ ...execution });
      },
      saveEvidence: async (record) => {
        repository.evidence.set(record.evidenceId, { ...record });
      },
      // Story 3.5's package seam, with the same shape the repository gives it: the
      // population reservation and every adapter artifact in one list.
      readPackageArtifacts: async () => [
        ...(repository.population
          ? [
              {
                evidenceId: repository.population.evidenceId,
                kind: 'population' as const,
                objectKey: repository.population.objectKey,
                required: repository.population.evidenceRequired,
                state: (repository.population.rawDigest === null
                  ? 'RESERVED'
                  : 'REGISTERED') as 'RESERVED' | 'REGISTERED' | 'ABANDONED',
              },
            ]
          : []),
        ...[...repository.evidence.values()].map((row) => ({
          evidenceId: row.evidenceId,
          kind: row.kind,
          objectKey: row.objectKey,
          required: row.required,
          state: row.state,
        })),
      ],
      abandonArtifacts: async (ids) => {
        for (const id of ids) {
          const row = repository.evidence.get(id);
          if (row && row.state === 'RESERVED') {
            repository.evidence.set(id, { ...row, state: 'ABANDONED', digest: null, size: null });
          }
        }
      },
      readSeal: async () => repository.seal,
      writeSeal: async (seal) => {
        repository.seal ??= seal;
      },
      readObservations: async (workItemId, keys) =>
        repository.observations
          .filter(
            (row) =>
              row.record.workItemId === workItemId &&
              keys.includes(row.record.populationRecordKey),
          )
          .map((row) => ({
            observationId: row.record.observationId,
            populationRecordKey: row.record.populationRecordKey,
            record: row.record,
            digest: row.digest,
            coverage: row.coverage,
            observedAtSource: row.observedAtSource,
          })),
      readEvidenceStates: async (ids) =>
        ids
          .map((id) => repository.evidence.get(id))
          .filter((row): row is AdapterEvidenceRecord => row !== undefined)
          .map((row) => ({ evidenceId: row.evidenceId, state: row.state })),
      saveObservations: async (rows) => {
        for (const row of rows) {
          const clash = repository.observations.some(
            (existing) =>
              existing.record.workItemId === row.record.workItemId &&
              existing.record.populationRecordKey === row.record.populationRecordKey,
          );
          if (!clash) repository.observations.push(row);
        }
      },
      saveObservationChecks: async (rows) => {
        for (const row of rows) {
          const key = `${row.observationId} ${row.check}`;
          if (!repository.checks.has(key)) repository.checks.set(key, row);
        }
      },
      saveObservationEvaluations: async (rows) => {
        for (const row of rows) {
          const key = `${row.observationId} ${row.evaluation.conditionId}`;
          if (!repository.evaluations.has(key)) repository.evaluations.set(key, row);
        }
      },
      saveExceptions: async (rows) => {
        // `DO NOTHING` on the Observation, exactly as the unique index does.
        for (const row of rows) {
          if (!repository.exceptions.has(row.observationId)) {
            repository.exceptions.set(row.observationId, row);
          }
        }
      },
      notifyTimeline: async (sequence) => {
        repository.timeline.push(sequence);
      },
      // ---------------------------------------------------------------- Story 3.8
      readStepExecutionCount: async () => repository.executions.length,
      readGateChecks: async () => repository.gate,
      saveGateChecks: async (rows) => {
        if (repository.gate.length === 0) repository.gate = [...rows];
      },
      saveRunState: async (state) => {
        repository.run = { ...repository.run, state };
      },
      readPopulationFacts: async () => repository.populationFacts,
      readPopulationRows: async () => repository.populationRows,
      readGateObservations: async () =>
        repository.observations.map((row) => ({
          targetSystem: row.record.targetSystem,
          populationRecordKey: row.record.populationRecordKey,
          coverage: row.coverage,
          workItemId: row.record.workItemId,
        })),
      readFailedObservationChecks: async () => {
        const tallies: Partial<Record<ObservationCheckName, GateFactTally>> = {};
        for (const row of repository.checks.values()) {
          if (row.outcome !== 'FAIL') continue;
          const observation = repository.observations.find(
            (entry) => entry.record.observationId === row.observationId,
          );
          const existing = tallies[row.check] ?? { total: 0, sample: [] };
          tallies[row.check] = {
            total: existing.total + 1,
            sample: [
              ...existing.sample,
              {
                targetSystem: observation?.record.targetSystem ?? null,
                workItemId: observation?.record.workItemId ?? null,
                record: observation?.record.populationRecordKey ?? null,
              },
            ],
          };
        }
        return tallies;
      },
      readConditionGaps: async (expected) => {
        const sample = repository.observations
          .filter(
            (row) =>
              [...repository.evaluations.values()].filter(
                (entry) => entry.observationId === row.record.observationId,
              ).length < expected,
          )
          .map((row) => ({
            targetSystem: row.record.targetSystem,
            workItemId: row.record.workItemId,
            record: row.record.populationRecordKey,
          }));
        return { total: sample.length, sample };
      },
      readUnnamedValues: async () => {
        const sample = [...repository.evaluations.values()]
          .filter((row) => row.evaluation.diagnostic?.includes(RULE_DOES_NOT_NAME_VALUE) === true)
          .map((row) => ({ targetSystem: null, workItemId: null, record: row.observationId }));
        return { total: sample.length, sample };
      },
      readIncompleteExtractions: async () =>
        [...repository.items.values()]
          .filter((item) => item.diagnostic?.includes('extraction-incomplete') === true)
          .map((item) => ({
            targetSystem: item.registrationId,
            workItemId: item.workItemId,
            record: null,
          })),
      readAccessFailures: async () => ({
        failedSessionSteps: [...repository.steps.values()]
          .filter((step) => step.state === 'FAILED')
          .map((step) => ({ targetSystem: step.registrationId, workItemId: null, record: null })),
        denied: [...repository.items.values()]
          .filter(
            (item) =>
              item.diagnostic === 'extraction-denied' ||
              item.diagnostic === 'extraction-scope-violation',
          )
          .map((item) => ({
            targetSystem: item.registrationId,
            workItemId: item.workItemId,
            record: null,
          })),
      }),
      readIntegrityFindings: async () =>
        repository.integrity.map((row) => ({
          targetSystem: null,
          workItemId: null,
          record: row.evidenceId,
        })),
    });
  }

  recoverableRunIds(): Promise<string[]> {
    return Promise.resolve([RUN.runId]);
  }
}

interface Harness {
  repository: FakeRepository;
  deps: AdapterExecutionDependencies;
  objects: Map<string, Uint8Array>;
  puts: string[];
  wire: { location: string; authorization: string | null }[];
}

function harness(options: {
  plan: ExecutablePlan | null;
  extract?: (target: ProcedureTargetSnapshot, credential: ResolvedCredential) => Promise<AcquiredArtifact>;
  reference?: (target: ProcedureTargetSnapshot) => Promise<AcquiredArtifact>;
  resolve?: (reference: string) => Promise<ResolvedCredential>;
  exceptions?: ExceptionFingerprinter;
}): Harness {
  const repository = new FakeRepository(options.plan);
  const objects = new Map<string, Uint8Array>();
  const puts: string[] = [];
  const wire: { location: string; authorization: string | null }[] = [];
  let counter = 0;
  const deps: AdapterExecutionDependencies = {
    repository,
    reference: {
      acquireReference:
        options.reference ??
        (async (entry) => {
          wire.push({ location: entry.contract.allowed_origins[0]!, authorization: null });
          return { bytes: utf8Bytes(ROLE_MATRIX), mediaType: 'text/csv', location: entry.contract.allowed_origins[0]! };
        }),
    },
    extraction: {
      extract:
        options.extract ??
        (async (entry, credential) => {
          // Exactly what an HTTP adapter does with a credential: it goes on the wire.
          const headers = new Map<string, string>();
          credential.authorize({ set: (name, value) => headers.set(name, value) });
          wire.push({
            location: entry.contract.allowed_origins[0]!,
            authorization: headers.get('authorization') ?? null,
          });
          return {
            bytes: utf8Bytes(ACCOUNTS),
            mediaType: 'application/json',
            location: entry.contract.allowed_origins[0]!,
          };
        }),
    },
    credentials: {
      resolve:
        options.resolve === undefined
          ? async (reference) => ({
              reference,
              authorize: (headers) => headers.set('authorization', `Bearer ${TOKEN}`),
            })
          : (reference) => options.resolve!(reference),
    },
    store: {
      read: async (key) => objects.get(key) ?? null,
      putIfAbsent: async (key, bytes) => {
        puts.push(key);
        if (!objects.has(key)) objects.set(key, bytes);
      },
    },
    clock: { now: () => new Date('2026-09-05T00:00:00.000Z') },
    ids: {
      next: () => {
        counter += 1;
        return `01920000-0000-7000-8000-${String(counter).padStart(12, '0')}`;
      },
    },
    // Story 3.7. The fingerprint key, as a port. Neither the evaluator nor the
    // corroborator is a dependency: both are built inside the stage from the plan it is
    // executing and the bytes it just froze, so there is no injection point at which
    // either could be switched off.
    exceptions: options.exceptions ?? FINGERPRINTER,
  };
  return { repository, deps, objects, puts, wire };
}

/** Everything the stage wrote anywhere, as one string. Used for containment. */
function everythingWritten(harnessed: Harness): string {
  return JSON.stringify({
    checkpoint: harnessed.repository.checkpoint,
    steps: [...harnessed.repository.steps.values()],
    items: [...harnessed.repository.items.values()],
    evidence: [...harnessed.repository.evidence.values()],
    executions: harnessed.repository.executions,
    observations: harnessed.repository.observations,
    events: harnessed.repository.events,
    objects: [...harnessed.objects.entries()].map(([key, bytes]) => [key, decodePopulationUtf8(bytes)]),
  });
}

let reference: ProcedureTargetSnapshot;
let adapter: ProcedureTargetSnapshot;

beforeEach(() => {
  reference = target('reg-file', 'versioned-file', 'https://synthetic.invalid/role-matrix.csv');
  adapter = target('reg-api', 'api', 'https://synthetic.invalid/accessgate/accounts');
});

describe('executeAdapterSteps', () => {
  it('acquires the Reference Source before any Work Item and freezes both artifacts', async () => {
    const test = harness({ plan: plan([reference, adapter]) });
    await executeAdapterSteps(test.deps, JOB);

    // The order the units ran in, taken from the audit chain rather than from intent.
    // Filtered to the stage's own family: the Run-level Gate appends its own events after
    // the last Work Item, and `at(-1)` over both families would read a Gate row.
    const order = test.repository.events
      .filter((entry) => entry.eventType === 'lifecycle.adapter-execution')
      .map((entry) => entry.payload['diagnostic']);
    expect(order.indexOf('reference-source-acquired')).toBeLessThan(order.indexOf('work-item-attempt-started'));
    expect(order.at(-1)).toBe('adapter-extraction-complete');

    const step = test.repository.steps.get('session-2')!;
    expect(step.state).toBe('ACQUIRED');
    const referenceEvidence = test.repository.evidence.get(step.evidenceId!)!;
    expect(referenceEvidence).toMatchObject({ kind: 'reference-source', state: 'REGISTERED' });
    expect(referenceEvidence.digest).toBe(sha256HexOfBytes(utf8Bytes(ROLE_MATRIX)));
    // The exact served bytes, unchanged: the AMBIGUOUS_DUAL entry boundary survives.
    expect(decodePopulationUtf8(test.objects.get(referenceEvidence.objectKey)!)).toBe(ROLE_MATRIX);

    const item = [...test.repository.items.values()][0]!;
    expect(item.state).toBe('OBSERVED');
    expect(test.repository.evidence.get(item.evidenceId!)).toMatchObject({
      kind: 'adapter-extraction', state: 'REGISTERED', digest: sha256HexOfBytes(utf8Bytes(ACCOUNTS)),
    });
    expect(test.repository.checkpoint?.status).toBe('EXTRACTION_COMPLETE');
    // Story 3.8: the Run-level Gate runs when the last Work Item completes. AG-1007 is in
    // the extraction twice, so its Observation is `ambiguous` and per-record coverage
    // fails — the Run concludes INCONCLUSIVE rather than staying RUNNING.
    expect(test.repository.run.state).toBe('INCONCLUSIVE');
    expect(test.repository.timeline.length).toBe(test.repository.events.length);
  });

  it('produces one Observation per included record, grounded, with the right found value', async () => {
    const test = harness({ plan: plan([adapter]) });
    await executeAdapterSteps(test.deps, JOB);
    const byKey = new Map(test.repository.observations.map((row) => [row.record.populationRecordKey, row.record]));
    expect([...byKey.keys()].sort()).toEqual(['AG-1001', 'AG-1003', 'AG-1007', 'AG-9999']);
    expect(byKey.get('AG-1001')?.found).toBe('true');
    // Two extraction rows carry AG-1007: never pick one.
    expect(byKey.get('AG-1007')?.found).toBe('ambiguous');
    expect(byKey.get('AG-1007')?.identity).toBeNull();
    // In the extraction and not in the population is not an Observation at all.
    expect(byKey.get('AG-9999')?.found).toBe('false');

    const found = byKey.get('AG-1003')!;
    expect(found.identity?.grounding?.locator).toBe('$.accounts[1].account_id');
    expect(found.attributes.map((attribute) => attribute.name)).toEqual(['roles', 'status']);
    const roles = found.attributes.find((attribute) => attribute.name === 'roles')!;
    expect(roles.originalValue).toEqual(['VENDOR_MAINTAINER', 'VENDOR_APPROVER']);
    expect(roles.grounding?.locator).toBe('$.accounts[1].roles');
    // Story 3.6: every grounding is re-read from the extraction this stage froze, so a
    // correct capture is stored `matched` rather than "not yet judged".
    expect(roles.corroboration).toBe('matched');
    expect(found.identity?.corroboration).toBe('matched');
    expect(found.captureMethod).toBe('adapter');
    expect(found.matchOrigin).toBe('platform');
    expect(found.evidenceIds).toEqual([test.repository.evidence.keys().next().value]);
  });

  it('puts the credential on the wire and nowhere else', async () => {
    const test = harness({ plan: plan([reference, adapter]) });
    await executeAdapterSteps(test.deps, JOB);
    expect(test.wire.some((call) => call.authorization === `Bearer ${TOKEN}`)).toBe(true);
    // Every stored row, event, Evidence object and diagnostic, in one string.
    expect(everythingWritten(test)).not.toContain(TOKEN);
    // The audit chain refuses a credentialRef key outright, so the retrieval is recorded
    // by naming the Target System whose frozen reference was used.
    const resolved = test.repository.events.find((entry) => entry.payload['diagnostic'] === 'credential-resolved');
    expect(resolved?.payload['registrationId']).toBe('reg-api');
    expect(Object.keys(resolved!.payload)).not.toContain('credentialRef');
  });

  it('fails one Work Item after two bounded cycles and still runs the next one', async () => {
    const second = target('reg-api-2', 'api', 'https://synthetic.invalid/approvenow/approvals');
    const test = harness({
      plan: plan([adapter, second]),
      extract: async (entry, credential) => {
        credential.authorize({ set: () => undefined });
        if (entry.registrationId === 'reg-api') throw new PopulationAcquisitionError('transport');
        return { bytes: utf8Bytes(ACCOUNTS), mediaType: 'application/json', location: 'x' };
      },
    });
    await executeAdapterSteps(test.deps, JOB);
    const items = [...test.repository.items.values()];
    const failed = items.find((item) => item.registrationId === 'reg-api')!;
    expect(failed.state).toBe('FAILED');
    expect(failed.diagnostic).toBe('extraction-transport-failed');
    // Four attempts per cycle, and the owner's automatic second cycle.
    expect(failed.attempts).toBe(8);
    expect(failed.cycles).toBe(2);
    // The reservation stays OPEN while the Run runs on: `SealPackage` is the one thing
    // that abandons one, at the terminal transition, where it can also be listed on the
    // Result (Story 3.5). What matters here is that it is not a registered artifact.
    // The reservation stays open while the Run runs on, and `SealPackage` is what
    // abandons it — at the terminal transition the Run-level Gate now takes, where it can
    // also be listed on the Result. What matters is that it is never a registered artifact.
    expect(test.repository.evidence.get(failed.evidenceId!)).toMatchObject({
      state: 'ABANDONED',
      digest: null,
    });
    expect(test.repository.seal?.abandoned.map((entry) => entry.evidenceId)).toContain(
      failed.evidenceId,
    );
    // A failed Work Item never stops the Run: the NEXT one still executed, and the stage
    // reached its own completion rather than a terminal checkpoint.
    expect(items.find((item) => item.registrationId === 'reg-api-2')?.state).toBe('OBSERVED');
    expect(test.repository.checkpoint?.status).toBe('EXTRACTION_COMPLETE');
    // The Run then concludes at the Gate, on coverage, not on the Work Item.
    expect(test.repository.run.state).toBe('INCONCLUSIVE');
    const coverage = test.repository.gate.find((row) => row.check === 'per-record-coverage')!;
    expect(coverage.outcome).toBe('FAIL');
    expect(coverage.diagnostics).toContain('record-uncovered');
  });

  it('fails the Run when a Reference Source cannot be acquired, and runs no Work Item', async () => {
    const test = harness({
      plan: plan([reference, adapter]),
      reference: async () => {
        throw new PopulationAcquisitionError('transport');
      },
    });
    await executeAdapterSteps(test.deps, JOB);
    expect(test.repository.steps.get('session-2')?.state).toBe('FAILED');
    expect(test.repository.steps.get('session-2')?.attempts).toBe(4);
    expect(test.repository.run.state).toBe('RUN_FAILED');
    expect(test.repository.checkpoint?.status).toBe('TERMINAL');
    expect([...test.repository.items.values()].every((item) => item.state === 'PENDING')).toBe(true);
    expect(test.repository.observations).toEqual([]);
  });

  it('seals INCOMPLETE when a Reference Source answered something nothing can read', async () => {
    // The HTTP adapter refuses a Reference Source whose media type no reference extractor
    // can read, as a `contract` failure — a proxy error page at the RoleMatrix origin
    // (`adapter-extraction-http.test.ts`). This is the other half of that one fix: the
    // Session Step fails without retrying a refusal that would repeat, §E makes it
    // RUN_FAILED, and the reservation nothing was written to is abandoned, so the package
    // seals INCOMPLETE and NAMES the artifact. Frozen and REGISTERED instead, it would have
    // sealed SEALED over a page the evaluator could read none of.
    const test = harness({
      plan: plan([reference, adapter]),
      reference: async () => {
        throw new PopulationAcquisitionError('contract');
      },
    });
    await executeAdapterSteps(test.deps, JOB);
    const step = test.repository.steps.get('session-2')!;
    expect(step.state).toBe('FAILED');
    expect(step.diagnostic).toBe('reference-contract-failed');
    // The same refusal every time, so it is not retried against a live system.
    expect(step.attempts).toBe(1);
    expect(test.repository.run.state).toBe('RUN_FAILED');
    expect(test.repository.seal?.state).toBe('INCOMPLETE');
    expect(test.repository.seal?.missingRequired.map((entry) => entry.evidenceId)).toEqual([
      step.evidenceId,
    ]);
    expect(test.repository.seal?.abandoned.map((entry) => entry.evidenceId)).toEqual([
      step.evidenceId,
    ]);
    expect(test.repository.evidence.get(step.evidenceId!)).toMatchObject({
      state: 'ABANDONED',
      digest: null,
    });
    // Nothing was frozen: an artifact nobody can read is never in the store.
    expect(test.puts).toEqual([]);
  });

  it('repeats no completed unit on resume and creates no duplicate Evidence or Observation', async () => {
    const test = harness({ plan: plan([reference, adapter]) });
    await executeAdapterSteps(test.deps, JOB);
    const firstPuts = [...test.puts];
    const firstObservations = test.repository.observations.length;
    const evidenceIds = [...test.repository.evidence.keys()];

    // A redelivery of a claim that crashed before it committed: the checkpoint is
    // claimable again and the Run is still RUNNING, because the stage's completion, the
    // Gate, the terminal state and the seal all commit in ONE transaction — a resume can
    // never see one of them without the others.
    test.repository.checkpoint = { ...test.repository.checkpoint!, status: 'RETRY' };
    test.repository.run = { ...test.repository.run, state: 'RUNNING' };
    const firstGate = test.repository.gate.length;
    await executeAdapterSteps(test.deps, JOB);

    expect(test.puts).toEqual(firstPuts);
    expect(test.repository.observations).toHaveLength(firstObservations);
    expect([...test.repository.evidence.keys()]).toEqual(evidenceIds);
    expect(test.repository.checkpoint?.status).toBe('EXTRACTION_COMPLETE');
    // The Gate rows are written once. A Gate failure is never repaired by re-running it.
    expect(test.repository.gate).toHaveLength(firstGate);
  });

  it('fails the Run terminally when a frozen Reference Source artifact no longer matches its digest', async () => {
    const test = harness({ plan: plan([reference, adapter]) });
    await executeAdapterSteps(test.deps, JOB);
    const step = test.repository.steps.get('session-2')!;
    const key = test.repository.evidence.get(step.evidenceId!)!.objectKey;
    const tampered = utf8Bytes('entry,role,permission\n1,TAMPERED,VIEW\n');
    test.objects.set(key, tampered);

    test.repository.checkpoint = { ...test.repository.checkpoint!, status: 'RETRY' };
    test.repository.run = { ...test.repository.run, state: 'RUNNING' };
    await executeAdapterSteps(test.deps, JOB);

    expect(test.repository.run.state).toBe('RUN_FAILED');
    expect(test.repository.checkpoint?.diagnostic).toBe('reference-integrity-failed');
    // The stored bytes are never replaced.
    expect(test.objects.get(key)).toBe(tampered);
  });

  it('refuses an agent-driven plan rather than skipping the Target System', async () => {
    const web = target('reg-web', 'web', 'https://synthetic.invalid/loancore');
    const test = harness({ plan: plan([web]) });
    await executeAdapterSteps(test.deps, JOB);
    expect(test.repository.run.state).toBe('RUN_FAILED');
    expect(test.repository.checkpoint?.diagnostic).toBe('agent-driven-target');
    expect(test.repository.items.size).toBe(0);
  });

  it('fails a Work Item whose credential answers about a different reference', async () => {
    const test = harness({
      plan: plan([adapter]),
      resolve: async () => ({
        reference: 'cred://synthetic/somebody-else',
        authorize: (headers) => headers.set('authorization', `Bearer ${TOKEN}`),
      }),
    });
    await executeAdapterSteps(test.deps, JOB);
    const item = [...test.repository.items.values()][0]!;
    expect(item.state).toBe('FAILED');
    expect(item.diagnostic).toBe('credential-unresolved');
    // An unresolvable credential is not retried eight times against a live system.
    expect(item.attempts).toBe(1);
    expect(everythingWritten(test)).not.toContain(TOKEN);
    // The Work Item failed and the Run went on to its Gate, which concluded it on the
    // coverage this item never produced. An unresolvable credential is not a DENIAL: the
    // resolver answered about a different reference, which is a defect on this side rather
    // than a system saying no, so it takes the Gate's INCONCLUSIVE and not §E.1's
    // RUN_FAILED.
    expect(test.repository.checkpoint?.status).toBe('EXTRACTION_COMPLETE');
    expect(test.repository.run.state).toBe('INCONCLUSIVE');
  });

  it('claims nothing while the population is not ready, or the Run is not running', async () => {
    const notReady = harness({ plan: plan([adapter]) });
    notReady.repository.population = { ...notReady.repository.population!, status: 'ACQUIRING' };
    await executeAdapterSteps(notReady.deps, JOB);
    expect(notReady.repository.checkpoint).toBeNull();

    const finished = harness({ plan: plan([adapter]) });
    finished.repository.run = { ...finished.repository.run, state: 'INCONCLUSIVE' };
    await executeAdapterSteps(finished.deps, JOB);
    expect(finished.repository.checkpoint).toBeNull();

    const wrongCorrelation = harness({ plan: plan([adapter]) });
    await executeAdapterSteps(wrongCorrelation.deps, { ...JOB, correlationId: RUN.runId });
    expect(wrongCorrelation.repository.checkpoint).toBeNull();
  });

  it('stops the Run RUN_FAILED when a Reference Source is DENIED, and says so as a security event', async () => {
    // A Reference Source is a Run-level Session Step, so its failure is RUN_FAILED whatever
    // caused it. §E.1 adds a security event when the cause was a denial or a scope
    // violation, and `stopRun` appends it from `runStopFor(cause).securityEvent` rather than
    // at each call site — so this proves the Session Step half of the mapping, which the
    // integration suite exercises only through the extraction.
    const test = harness({
      plan: plan([reference, adapter]),
      reference: async () => {
        throw new PopulationAcquisitionError('denied');
      },
    });
    await executeAdapterSteps(test.deps, JOB);
    const step = [...test.repository.steps.values()][0]!;
    expect(step).toMatchObject({ state: 'FAILED', diagnostic: 'reference-denied' });
    // Not retried: the same request produces the same refusal.
    expect(step.attempts).toBe(1);
    expect(test.repository.run.state).toBe('RUN_FAILED');
    const security = test.repository.events.filter(
      (entry) => entry.eventType === 'security.action-denied',
    );
    expect(security).toHaveLength(1);
    expect(security[0]).toMatchObject({ outcome: 'denied' });
    expect(security[0]!.payload['cause']).toBe('action-denied');
    // No Work Item ran, and no Gate row was written: the Run never reached its last one.
    expect(test.repository.gate).toEqual([]);
  });

  it('stops the Run RUN_FAILED on a scope violation from a Reference Source', async () => {
    const test = harness({
      plan: plan([reference, adapter]),
      reference: async () => {
        throw new PopulationAcquisitionError('scope');
      },
    });
    await executeAdapterSteps(test.deps, JOB);
    expect([...test.repository.steps.values()][0]?.diagnostic).toBe('reference-scope-violation');
    expect(test.repository.run.state).toBe('RUN_FAILED');
    expect(
      test.repository.events
        .filter((entry) => entry.eventType === 'security.action-denied')
        .map((entry) => entry.payload['cause']),
    ).toEqual(['scope-violation']);
  });

  it('does not claim a live lease held by another worker', async () => {
    const test = harness({ plan: plan([adapter]) });
    test.repository.checkpoint = {
      revision: 4, status: 'EXECUTING', attempts: 1,
      runStartedAt: '2026-09-04T23:30:00.000Z', startedAt: '2026-09-05T00:00:00.000Z',
      attemptStartedAt: '2026-09-05T00:00:00.000Z', leaseUntil: '2026-09-05T00:02:00.000Z',
      attemptId: 'other', diagnostic: null,
    };
    await executeAdapterSteps(test.deps, JOB);
    expect(test.repository.checkpoint.revision).toBe(4);
    expect(test.repository.items.size).toBe(0);
  });

  it('maps the durable Run deadline to Inconclusive, not to a failure', async () => {
    const test = harness({ plan: plan([adapter]) });
    test.repository.population = { ...test.repository.population!, startedAt: '2026-09-04T22:00:00.000Z' };
    await executeAdapterSteps(test.deps, JOB);
    expect(test.repository.run.state).toBe('INCONCLUSIVE');
    expect(test.repository.checkpoint?.diagnostic).toBe('run-time-limit');
  });

  it('fails a Work Item whose extraction is not a declared collection', async () => {
    const test = harness({
      plan: plan([adapter]),
      extract: async () => ({ bytes: utf8Bytes('{"unexpected":[]}'), mediaType: 'application/json', location: 'x' }),
    });
    await executeAdapterSteps(test.deps, JOB);
    const item = [...test.repository.items.values()][0]!;
    expect(item.state).toBe('FAILED');
    expect(item.diagnostic).toBe('extraction-contract-failed');
    expect(test.repository.observations).toEqual([]);
    // The Work Item did not stop the Run — the stage reached its own completion — and the
    // Run-level Gate then concluded it INCONCLUSIVE on the coverage the item never gave.
    expect(test.repository.checkpoint?.status).toBe('EXTRACTION_COMPLETE');
    expect(test.repository.run.state).toBe('INCONCLUSIVE');
  });

  it('lets a later attempt freeze DIFFERENT bytes after a bad response was frozen', async () => {
    // The gateway in front of the Target System answered 200 with a maintenance page.
    // Attempt 1 freezes it — right, it is what the system answered — and the parse then
    // fails, which is not terminal. Attempt 2 runs against a healthy system and gets
    // correct JSON, which it can only freeze if the object key it derives is not the one
    // attempt 1 already filled: `putIfAbsent` reconciles rather than overwrites, so a key
    // with no attempt in it makes every retry die on the STORE with an integrity error
    // against a Target System that is answering perfectly well. The owner's two bounded
    // retry cycles exist for exactly this failure.
    let call = 0;
    const test = harness({
      plan: plan([adapter]),
      extract: async () => {
        call += 1;
        return call === 1
          ? { bytes: utf8Bytes('<html><body>Service unavailable</body></html>'), mediaType: 'text/html', location: 'x' }
          : { bytes: utf8Bytes(ACCOUNTS), mediaType: 'application/json', location: 'x' };
      },
    });
    await executeAdapterSteps(test.deps, JOB);
    const item = [...test.repository.items.values()][0]!;
    expect(item.state).toBe('OBSERVED');
    expect(item.attempts).toBe(2);
    expect(item.diagnostic).toBeNull();
    expect(test.repository.observations).toHaveLength(4);
    // Both artifacts are preserved and both are REGISTERED: each attempt freezes what its
    // own request answered, and an artifact that exists is never un-existed.
    const registered = [...test.repository.evidence.values()].filter(
      (row) => row.kind === 'adapter-extraction',
    );
    expect(registered).toHaveLength(2);
    expect(registered.every((row) => row.state === 'REGISTERED')).toBe(true);
    expect(new Set(registered.map((row) => row.objectKey)).size).toBe(2);
    expect(registered.map((row) => row.mediaType).sort()).toEqual(['application/json', 'text/html']);
    // The Work Item names the artifact it CONCLUDED from, not the one it discarded.
    expect(test.repository.evidence.get(item.evidenceId!)?.mediaType).toBe('application/json');
    // `adapter-extraction` is not required, so several attempts cannot make the package
    // incomplete; nothing was left open here, so nothing is abandoned either.
    expect(test.repository.seal?.state).toBe('SEALED');
    expect(test.repository.seal?.abandoned).toEqual([]);
    // The stage reached its own completion, so the Run concludes at the Gate rather than
    // on the Work Item. INCONCLUSIVE here is P-2's coverage rule over this fixture's
    // ambiguous and absent accounts — the same conclusion the single-attempt happy path
    // reaches — and the point is that the retry cost the Run nothing.
    expect(test.repository.checkpoint?.status).toBe('EXTRACTION_COMPLETE');
    expect(test.repository.run.state).toBe('INCONCLUSIVE');
  });

  it('writes one Observation per DISTINCT population key and says how many repeated', async () => {
    // A duplicate primary key in the population is an Evidence Quality Gate event, and
    // the Observation is keyed by (Work Item, record key): a second row would be dropped
    // by the database and the reported count would disagree with the stored one.
    const test = harness({ plan: plan([adapter]) });
    test.repository.records = [...RECORDS, { ordinal: 5, values: { account_id: 'AG-1001', status: 'Active' } }];
    await executeAdapterSteps(test.deps, JOB);
    const item = [...test.repository.items.values()][0]!;
    expect(test.repository.observations).toHaveLength(4);
    expect(item.observations).toBe(4);
    expect(item.diagnostic).toBe('duplicate-record-keys:1');
  });

  it('registers every Observation through the one transactional contract', async () => {
    // Story 3.4: the rows, their check outcomes and the event carrying every digest are
    // written by `registerObservations`, not by this stage. The digest on each stored row
    // is the domain's digest over the record as stored, and one event carries them all.
    const test = harness({ plan: plan([adapter]) });
    await executeAdapterSteps(test.deps, JOB);
    for (const row of test.repository.observations) {
      expect(row.digest).toBe(observationDigest(row.record));
      expect(row.observedAtSource).toBe(row.record.observedAt);
    }
    const registered = test.repository.events.filter(
      (row) => Array.isArray((row.payload as Record<string, unknown>)['digests']),
    );
    expect(registered).toHaveLength(1);
    const payload = registered[0]!.payload as Record<string, unknown>;
    expect(payload['digests']).toEqual(test.repository.observations.map((row) => row.digest));
    expect(payload['batchDigest']).toBe(observationBatchDigest(payload['digests'] as string[]));
    // Two resolved matches are COVERED, AG-1007 is AMBIGUOUS, and AG-9999 is UNINSPECTED:
    // this plan is P-2, whose §C coverage rule is satisfied only when every population
    // account "appears in the extraction with a grounded role list". The absence proof is
    // honest and `search-completeness` passes; the Template simply does not accept an
    // absence as coverage.
    expect(payload['coverage']).toEqual({ COVERED: 2, UNINSPECTED: 1, AMBIGUOUS: 1 });
    // Every check the registration decided is committed with the rows.
    expect(new Set(test.repository.checks.values()).size).toBeGreaterThan(0);
    expect([...test.repository.checks.values()].filter((row) => row.outcome === 'FAIL')).toEqual([
      {
        observationId: observationIdFor([...test.repository.items.values()][0]!.workItemId, 'AG-1007'),
        check: 'ambiguous-match',
        outcome: 'FAIL',
        diagnostic: 'ambiguous-match',
      },
    ]);
  });

  it('leaves an absence UNINSPECTED when the extraction did not prove itself complete', async () => {
    // An extraction with no completeness declaration might be one page of several, so
    // "this record is not in the system" is really "not on the page I happened to read".
    const test = harness({
      plan: plan([adapter]),
      extract: async () => ({ bytes: utf8Bytes(INCOMPLETE_ACCOUNTS), mediaType: 'application/json', location: 'x' }),
    });
    await executeAdapterSteps(test.deps, JOB);
    const byKey = new Map(test.repository.observations.map((row) => [row.record.populationRecordKey, row]));
    expect(byKey.get('AG-9999')?.coverage).toBe('UNINSPECTED');
    // A resolved match is still covered: completeness only bears on an absence.
    expect(byKey.get('AG-1001')?.coverage).toBe('COVERED');
    expect([...test.repository.items.values()][0]!.diagnostic).toContain('extraction-incomplete');
  });

  it('fails the Work Item, without retrying, when its registration is refused', async () => {
    // The refusal is THROWN from inside the transaction, so a real database takes the
    // Evidence row, the Work Item and the Step Execution back with it; that half is
    // proved against PostgreSQL in `tests/integration/adapter-execution.test.ts`, since
    // this in-memory repository has no rollback to observe. What is proved here is the
    // stage's own response: no Observation, a named diagnostic, and no second attempt.
    //
    // The refusal is driven by a fingerprinter that answers with something that is not a
    // fingerprint. AG-1003 carries a prohibited pair, so an Exception is raised, and a
    // permanent row that can never be updated must not be written with a value nobody
    // can later check.
    const test = harness({
      plan: plan([reference, adapter]),
      exceptions: { keyId: 'k-test', fingerprint: () => 'not-a-fingerprint' },
    });
    await executeAdapterSteps(test.deps, JOB);
    const item = [...test.repository.items.values()][0]!;
    expect(item.state).toBe('FAILED');
    expect(item.diagnostic).toBe('observation-registration-refused');
    // Not retried eight times against a live system: the same bytes make the same batch.
    expect(item.attempts).toBe(1);
    expect(test.repository.observations).toEqual([]);
    expect(test.repository.exceptions.size).toBe(0);
    expect(test.repository.checkpoint?.status).toBe('EXTRACTION_COMPLETE');
    expect(test.repository.run.state).toBe('INCONCLUSIVE');
  });

  it('evaluates every registered Observation and raises one Exception per failing record', async () => {
    // The whole Story 3.7 wiring, end to end inside the stage: the frozen conditions, the
    // frozen population, the RoleMatrix this Run's own Session Step acquired, and the
    // Exception the first EXCEPTION evaluation creates in the same transaction.
    const test = harness({ plan: plan([reference, adapter]) });
    await executeAdapterSteps(test.deps, JOB);
    const value = (key: string): string | undefined =>
      [...test.repository.evaluations.values()].find(
        (row) => row.evaluation.conditionId === 'C1' &&
          test.repository.observations.some(
            (observation) =>
              observation.record.observationId === row.observationId &&
              observation.record.populationRecordKey === key,
          ),
      )?.evaluation.value;

    // AP_CLERK expands to CREATE_PAYMENT and VIEW_PAYMENT: no prohibited pair.
    expect(value('AG-1001')).toBe('COMPLIANT');
    // VENDOR_MAINTAINER + VENDOR_APPROVER expand to CREATE_VENDOR + APPROVE_VENDOR.
    expect(value('AG-1003')).toBe('EXCEPTION');
    // Two extraction rows carry AG-1007, so the match is ambiguous and never resolved.
    expect(value('AG-1007')).toBe('UNEVALUATED');
    // Every evaluation this evaluator writes carries origin RULE and no Agent-Judged field.
    expect([...test.repository.evaluations.values()].every((row) =>
      row.evaluation.origin === 'RULE' &&
      row.evaluation.confirmation === null &&
      row.evaluation.confidence === null &&
      row.evaluation.rationale === null)).toBe(true);

    // Exactly one Exception, for the one record that failed the control, fingerprinted
    // with the deployment's key and carrying the pair the rule reported.
    expect(test.repository.exceptions.size).toBe(1);
    const raised = [...test.repository.exceptions.values()][0]!;
    expect(raised.populationRecordKey).toBe('AG-1003');
    expect(raised.conditionIds).toEqual(['C1']);
    expect(raised.diagnostics.join(' ')).toContain('prohibited permission pair CREATE_VENDOR + APPROVE_VENDOR');
    expect(raised.fingerprintKeyId).toBe('k-test');
    expect(raised.fingerprint).toBe(
      exceptionFingerprint(utf8Bytes(FINGERPRINT_KEY), {
        procedureId: RUN.procedureId,
        templateId: 'P-2',
        targetSystem: 'reg-api',
        populationRecordKey: 'AG-1003',
        conditionIds: ['C1'],
      }),
    );
    const observed = test.repository.events.find((row) => row.payload['exceptions'] !== undefined)!;
    expect(observed.payload['exceptions']).toBe(1);
    expect(observed.payload['exceptionIds']).toEqual([raised.exceptionId]);
  });

  it('cannot expand a role without the Reference Source, and never guesses', async () => {
    // No RoleMatrix Session Step at all. `incomplete role expansion` is Unevaluated for
    // every record the condition applies to; nothing falls through to "no prohibited pair
    // found", and no Exception is raised on an expansion nobody could read.
    const test = harness({ plan: plan([adapter]) });
    await executeAdapterSteps(test.deps, JOB);
    const rows = [...test.repository.evaluations.values()];
    const keyOf = (observationId: string): string =>
      test.repository.observations.find((row) => row.record.observationId === observationId)!
        .record.populationRecordKey;
    // AG-9999 is absent from the extraction. P-2's §C coverage rule requires every
    // population account to APPEAR in the extraction, so the record is `UNINSPECTED`, the
    // evidence facts are not `inspected`, and every condition is Unevaluated. It used to
    // be COMPLIANT here — P-2's frozen `found = true` applicability does not apply to an
    // absent record, and compiler 1 gives a non-applicable condition the value COMPLIANT —
    // which meant an account whose permissions nothing could read passed its own control.
    const absent = rows.find((row) => keyOf(row.observationId) === 'AG-9999')!;
    expect(absent.evaluation.value).toBe('UNEVALUATED');
    // Both halves, in the compiler's order: the evidence facts are what DECIDED the value
    // (an uninspected record is never Compliant), and the non-applicability marker is
    // still recorded so a §H count of APPLICABLE conditions can exclude the row.
    expect(absent.evaluation.diagnostic).toBe(
      'missing, ambiguous, contradictory, uninspected, or unproven Evidence; ' +
        'condition does not apply to this record',
    );
    expect(rows.map((row) => row.evaluation.value)).toEqual([
      'UNEVALUATED', 'UNEVALUATED', 'UNEVALUATED', 'UNEVALUATED',
    ]);
    expect(test.repository.exceptions.size).toBe(0);
  });

  it('counts a record with no usable key instead of inventing one', async () => {
    const test = harness({ plan: plan([adapter]) });
    test.repository.records = [{ ordinal: 1, values: { account_id: '', status: 'Active' } }];
    await executeAdapterSteps(test.deps, JOB);
    const item = [...test.repository.items.values()][0]!;
    expect(test.repository.observations).toEqual([]);
    expect(item.diagnostic).toBe('unkeyed-records:1');
    expect(item.state).toBe('OBSERVED');
  });

  it('records the frozen step id on every Step Execution', async () => {
    const test = harness({ plan: plan([reference, adapter]) });
    await executeAdapterSteps(test.deps, JOB);
    expect(test.repository.executions.map((row) => row.planStepId)).toEqual(['session-2', 'session-3']);
    expect(test.repository.executions.every((row) => row.action === 'extract-adapter')).toBe(true);
    expect(test.repository.executions.every((row) => row.state === 'SUCCEEDED')).toBe(true);
    const observation = test.repository.observations[0]!.record;
    expect(test.repository.executions.some((row) => row.stepExecutionId === observation.stepExecutionId)).toBe(true);
  });
});
