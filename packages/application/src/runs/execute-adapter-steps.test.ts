import { beforeEach, describe, expect, it } from 'vitest';
import {
  registrationDigest,
  registrationDigestEnvelope,
  decodePopulationUtf8,
  sha256HexOfBytes,
  utf8Bytes,
  type ExecutablePlan,
  type ObservationRecord,
  type ProcedureTargetSnapshot,
  type RunRecord,
  type TargetSystemKind,
} from '@intellifin/domain';
import { executeAdapterSteps, type AdapterExecutionDependencies } from './execute-adapter-steps.js';
import {
  PopulationAcquisitionError,
  type AcquiredArtifact,
  type AdapterEvidenceRecord,
  type AdapterExecutionCheckpoint,
  type AdapterExecutionContext,
  type AdapterExecutionRepository,
  type PopulationCheckpoint,
  type PopulationRecord,
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
    inputs: { templateId: 'P-2', targets } as unknown as ExecutablePlan['inputs'],
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

const ACCOUNTS = JSON.stringify({
  accounts: [
    { account_id: 'AG-1001', roles: ['AP_CLERK'], status: 'Active' },
    { account_id: 'AG-1003', roles: ['VENDOR_MAINTAINER', 'VENDOR_APPROVER'], status: 'Active' },
    { account_id: 'AG-1007', roles: ['OPS_CLERK'], status: 'Active' },
    { account_id: 'AG-1007', roles: ['LOAN_ADMIN'], status: 'Active' },
  ],
});
const ROLE_MATRIX = 'entry,role,permission\n1,AP_CLERK,CREATE_PAYMENT\n';

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
    stepId: 'session-1', attemptId: 'attempt',
  };
  checkpoint: AdapterExecutionCheckpoint | null = null;
  steps = new Map<string, SessionStepRecord>();
  items = new Map<string, WorkItemRecord>();
  evidence = new Map<string, AdapterEvidenceRecord>();
  executions: StepExecutionRecord[] = [];
  observations: ObservationRecord[] = [];
  events: { payload: Record<string, unknown>; outcome: string }[] = [];
  timeline: number[] = [];
  records: readonly PopulationRecord[] = RECORDS;
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
          repository.events.push({ payload: draft.payload as Record<string, unknown>, outcome: draft.outcome });
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
      saveObservations: async (observations) => {
        for (const observation of observations) {
          const clash = repository.observations.some(
            (row) =>
              row.workItemId === observation.workItemId &&
              row.populationRecordKey === observation.populationRecordKey,
          );
          if (!clash) repository.observations.push(observation);
        }
      },
      notifyTimeline: async (sequence) => {
        repository.timeline.push(sequence);
      },
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
    const order = test.repository.events.map((entry) => entry.payload['diagnostic']);
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
    expect(test.repository.run.state).toBe('RUNNING');
    expect(test.repository.timeline.length).toBe(test.repository.events.length);
  });

  it('produces one Observation per included record, grounded, with the right found value', async () => {
    const test = harness({ plan: plan([adapter]) });
    await executeAdapterSteps(test.deps, JOB);
    const byKey = new Map(test.repository.observations.map((row) => [row.populationRecordKey, row]));
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
    expect(roles.corroboration).toBeNull();
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
    expect(test.repository.evidence.get(failed.evidenceId!)?.state).toBe('ABANDONED');
    expect(items.find((item) => item.registrationId === 'reg-api-2')?.state).toBe('OBSERVED');
    // A failed Work Item never stops the Run.
    expect(test.repository.run.state).toBe('RUNNING');
    expect(test.repository.checkpoint?.status).toBe('EXTRACTION_COMPLETE');
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

  it('repeats no completed unit on resume and creates no duplicate Evidence or Observation', async () => {
    const test = harness({ plan: plan([reference, adapter]) });
    await executeAdapterSteps(test.deps, JOB);
    const firstPuts = [...test.puts];
    const firstObservations = test.repository.observations.length;
    const evidenceIds = [...test.repository.evidence.keys()];

    // A redelivery: the stage is claimable again, and the completed units must not run.
    test.repository.checkpoint = { ...test.repository.checkpoint!, status: 'RETRY' };
    await executeAdapterSteps(test.deps, JOB);

    expect(test.puts).toEqual(firstPuts);
    expect(test.repository.observations).toHaveLength(firstObservations);
    expect([...test.repository.evidence.keys()]).toEqual(evidenceIds);
    expect(test.repository.checkpoint?.status).toBe('EXTRACTION_COMPLETE');
    expect(test.repository.run.state).toBe('RUNNING');
  });

  it('fails the Run terminally when a frozen Reference Source artifact no longer matches its digest', async () => {
    const test = harness({ plan: plan([reference, adapter]) });
    await executeAdapterSteps(test.deps, JOB);
    const step = test.repository.steps.get('session-2')!;
    const key = test.repository.evidence.get(step.evidenceId!)!.objectKey;
    const tampered = utf8Bytes('entry,role,permission\n1,TAMPERED,VIEW\n');
    test.objects.set(key, tampered);

    test.repository.checkpoint = { ...test.repository.checkpoint!, status: 'RETRY' };
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
    expect(test.repository.run.state).toBe('RUNNING');
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
    expect(test.repository.run.state).toBe('RUNNING');
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
    const observation = test.repository.observations[0]!;
    expect(test.repository.executions.some((row) => row.stepExecutionId === observation.stepExecutionId)).toBe(true);
  });
});
