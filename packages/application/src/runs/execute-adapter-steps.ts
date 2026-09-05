import {
  adapterLookupColumn,
  classifyPlanTargets,
  decodePopulationUtf8,
  sha256HexOfBytes,
  canonicalJson,
  OBSERVATION_LIMITS,
  OBSERVATION_SCHEMA_VERSION,
  type ClassifiedTarget,
  type ExecutablePlan,
  type JsonValue,
  type ObservationAttribute,
  type ObservationFound,
  type ObservationRecord,
  type ProcedureTargetSnapshot,
  type RunRecord,
} from '@intellifin/domain';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import {
  PopulationAcquisitionError,
  type AcquiredArtifact,
  type AdapterEvidenceRecord,
  type AdapterExecutionCheckpoint,
  type AdapterExecutionContext,
  type AdapterExecutionRepository,
  type AdapterExtractionPort,
  type CredentialResolver,
  type EvidenceStore,
  type PopulationRecord,
  type ReferenceAcquisitionPort,
  type SessionStepRecord,
  type StepExecutionRecord,
  type WorkItemRecord,
} from './execution-ports.js';
import type { PopulationJob } from './acquire-population.js';

/**
 * The execution stage after population acquisition (Story 3.3).
 *
 * It interprets the ALREADY FROZEN plan. Every Reference Source is acquired as a Session
 * Step before any Work Item; then one adapter Work Item runs per adapter-acquired Target
 * System, sequentially, each with its own state, Step Executions, Evidence and Timeline
 * segment. Nothing here re-derives a step, consults a current registration or adds an
 * action kind: the classification reads `inputs.targets[].contract.kind`, which is frozen
 * beside the `extract-adapter` steps the compiler already emitted.
 *
 * The claim / lease / revision-recheck / save + event + notifyTimeline discipline is
 * `acquirePopulation`'s, deliberately copied in shape: every state change, Evidence row,
 * Observation, audit event and Timeline notification for ONE unit commits in one
 * transaction guarded by the checkpoint revision.
 *
 * A failed Work Item never stops the Run (addendum §E, and the owner's 2026-09-05
 * decision granting one automatic extra retry cycle). A failed Session Step does: a
 * Reference Source is a Run-level Session Step and its failure after bounded retries is
 * `RUN_FAILED`.
 *
 * The credential never touches this file's data. `ResolvedCredential` has no field
 * holding it, so no checkpoint, event, log line, Evidence artifact or error message here
 * can carry it — and the audit chain refuses a `credentialRef` payload key outright, so
 * the retrieval is recorded by naming the Target System whose frozen
 * `credentialReferences` entry was used, never by value.
 */

export interface AdapterExecutionDependencies {
  repository: AdapterExecutionRepository;
  reference: ReferenceAcquisitionPort;
  extraction: AdapterExtractionPort;
  credentials: CredentialResolver;
  store: EvidenceStore;
  clock: Clock;
  ids: UuidV7Generator;
}

/** The closed diagnostic vocabulary. Never an error message, never a URL, never a value. */
export type AdapterExecutionDiagnostic =
  | 'unsupported-frozen-plan'
  | 'agent-driven-target'
  | 'unsupported-plan-version'
  | 'run-time-limit'
  | 'attempt-limit'
  | 'credential-unresolved'
  | 'reference-transport-failed'
  | 'reference-integrity-failed'
  | 'reference-contract-failed'
  | 'extraction-transport-failed'
  | 'extraction-integrity-failed'
  | 'extraction-contract-failed';

/** The collection names an extraction response may carry (population contract v1). */
const COLLECTION_KEYS = ['accounts', 'transactions', 'employees', 'approvals'] as const;

/** A frozen step id has to be usable as an object-key segment. */
const STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

interface EventFields {
  readonly stepId?: string;
  readonly workItemId?: string;
  readonly stepExecutionId?: string;
  readonly registrationId?: string;
  readonly evidenceId?: string;
  readonly digest?: string;
  readonly size?: number;
  readonly observations?: number;
  readonly attempt?: number;
}

async function event(
  context: AdapterExecutionContext,
  diagnostic: string,
  state: RunRecord['state'],
  checkpoint: AdapterExecutionCheckpoint,
  fields: EventFields = {},
  outcome: 'success' | 'failure' = 'success',
): Promise<void> {
  const run = context.run!;
  const stored = await context.auditEvents.append({
    actor: { type: 'system', id: 'adapter-worker' },
    eventType: 'lifecycle.adapter-execution',
    source: 'worker',
    outcome,
    aggregateId: run.runId,
    correlationId: run.correlationId,
    sessionId: run.sessionId,
    payload: {
      state,
      diagnostic,
      attempts: checkpoint.attempts,
      attemptId: checkpoint.attemptId,
      ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
    },
  });
  await context.notifyTimeline(stored.sequence);
}

function objectValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The declared collection of an extraction response, or a contract failure. */
export function parseExtractionRows(artifact: AcquiredArtifact): {
  collection: string;
  rows: readonly Record<string, JsonValue>[];
} {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(artifact.mediaType)) {
    throw new PopulationAcquisitionError('contract');
  }
  let value: unknown;
  try {
    value = JSON.parse(decodePopulationUtf8(artifact.bytes));
  } catch {
    throw new PopulationAcquisitionError('contract');
  }
  if (!objectValue(value)) throw new PopulationAcquisitionError('contract');
  const keys = COLLECTION_KEYS.filter((key) => Object.hasOwn(value, key));
  if (keys.length !== 1) throw new PopulationAcquisitionError('contract');
  const rows: unknown = value[keys[0]!];
  if (!Array.isArray(rows) || !rows.every(objectValue)) throw new PopulationAcquisitionError('contract');
  try {
    canonicalJson(rows as JsonValue);
  } catch {
    throw new PopulationAcquisitionError('contract');
  }
  return { collection: keys[0]!, rows: rows as Record<string, JsonValue>[] };
}

/**
 * §B normalization for one captured value.
 *
 * Only a `time` value is normalized, and only to UTC with the original retained beside
 * it. Everything else is returned unchanged: compiler 1 authorizes no lossy or
 * equivalence-expanding transformation, so the normalized identifier IS the validated
 * original string — leading zeros, case, whitespace and Unicode composition included.
 */
export function normalizeObservationValue(valueType: string, value: JsonValue): JsonValue {
  if (valueType !== 'time' || typeof value !== 'string' || value === '') return value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

function extractedText(value: JsonValue): string {
  const text = typeof value === 'string' ? value : canonicalJson(value);
  return text.length > OBSERVATION_LIMITS.value ? text.slice(0, OBSERVATION_LIMITS.value) : text;
}

/**
 * Build one Observation per included population record for one adapter Work Item.
 *
 * The join is the Template's frozen lookup column, compared as an exact opaque string.
 * Exactly one match resolves; zero is a proven-absence candidate (`found = false`, whose
 * completeness rules are Story 3.4's); more than one is `ambiguous` and never picks.
 */
export function buildAdapterObservations(input: {
  plan: ExecutablePlan;
  target: ProcedureTargetSnapshot;
  workItemId: string;
  stepExecutionId: string;
  evidenceId: string;
  collection: string;
  rows: readonly Record<string, JsonValue>[];
  records: readonly PopulationRecord[];
  observedAt: string;
  nextId: () => string;
}): { observations: readonly ObservationRecord[]; unkeyed: number; duplicates: number } {
  const column = adapterLookupColumn(input.plan.inputs.templateId);
  if (column === null) throw new PopulationAcquisitionError('contract');
  const declared = input.plan.observations.filter((field) => field.attributeName !== 'found');
  const index = new Map<string, number[]>();
  for (const [position, row] of input.rows.entries()) {
    const key = row[column];
    if (typeof key !== 'string' || key === '') continue;
    const existing = index.get(key);
    if (existing) existing.push(position);
    else index.set(key, [position]);
  }

  const observations: ObservationRecord[] = [];
  const seen = new Set<string>();
  let unkeyed = 0;
  let duplicates = 0;
  for (const record of input.records) {
    const key = record.values[column];
    // A record with no usable key cannot be keyed to an Observation, and inventing a key
    // would fabricate coverage. It is counted instead: the coverage check then sees
    // fewer Observations than included records, which is the safe direction.
    if (typeof key !== 'string' || key === '' || key.length > OBSERVATION_LIMITS.text) {
      unkeyed += 1;
      continue;
    }
    // A duplicate primary key in the population is one Observation, not two: the
    // Observation is keyed by (Work Item, record key) in the database, so a second row
    // would be silently dropped and the stored count would disagree with the reported
    // one. It is counted instead, and stays an Evidence Quality Gate event.
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    const matches = index.get(key) ?? [];
    const found: ObservationFound = matches.length === 1 ? 'true' : matches.length === 0 ? 'false' : 'ambiguous';
    const attributes: ObservationAttribute[] = [];
    let identity: ObservationAttribute | null = null;
    if (found === 'true') {
      const position = matches[0]!;
      const row = input.rows[position]!;
      const ground = (name: string, valueType: string): ObservationAttribute | null => {
        if (!Object.hasOwn(row, name)) return null;
        const original = row[name] as JsonValue;
        return {
          name,
          originalValue: original,
          normalizedValue: normalizeObservationValue(valueType, original),
          grounding: {
            evidenceId: input.evidenceId,
            locator: `$.${input.collection}[${String(position)}].${name}`,
            label: name,
            extractedText: extractedText(original),
          },
          corroboration: null,
        };
      };
      identity = ground(column, 'text');
      for (const field of declared) {
        if (field.attributeName === column) continue;
        const attribute = ground(field.attributeName, field.valueType);
        if (attribute !== null) attributes.push(attribute);
      }
      // §B.1: a found record requires a grounded identity attribute. An extraction row
      // indexed by this column always has it; the guard is here because "always" is a
      // claim about code somewhere else.
      if (identity === null) {
        unkeyed += 1;
        continue;
      }
    }
    observations.push({
      schemaVersion: OBSERVATION_SCHEMA_VERSION,
      observationId: input.nextId(),
      workItemId: input.workItemId,
      populationRecordKey: key,
      targetSystem: input.target.registrationId,
      found,
      observedAt: input.observedAt,
      stepExecutionId: input.stepExecutionId,
      captureMethod: 'adapter',
      matchOrigin: 'platform',
      identity,
      attributes,
      evidenceIds: [input.evidenceId],
    });
  }
  return { observations, unkeyed, duplicates };
}

function evidenceKey(kind: 'reference' | 'extraction', runId: string, stepId: string): string {
  if (!STEP_ID_PATTERN.test(stepId)) throw new PopulationAcquisitionError('contract');
  return `${kind}/${runId}/${stepId}`;
}

function failureDiagnostic(
  unit: 'reference' | 'extraction',
  error: unknown,
): AdapterExecutionDiagnostic {
  const code = error instanceof PopulationAcquisitionError ? error.code : 'transport';
  return `${unit}-${code}-failed` as AdapterExecutionDiagnostic;
}

/** Every I/O is bounded by the lease, the frozen Step timeout and the Run deadline. */
export async function executeAdapterSteps(
  deps: AdapterExecutionDependencies,
  job: PopulationJob,
): Promise<{ retry: boolean }> {
  const claim = await deps.repository.transaction(job.runId, async (context) => {
    const run = context.run;
    if (!run || run.correlationId !== job.correlationId || job.schemaVersion !== 1) return null;
    if (run.state !== 'RUNNING') return null;
    const population = context.population;
    if (population === null || population.status !== 'POPULATION_READY') return null;
    const prior = context.checkpoint;
    if (prior?.status === 'TERMINAL' || prior?.status === 'EXTRACTION_COMPLETE') return null;
    const now = deps.clock.now();
    if (prior?.status === 'EXECUTING' && Date.parse(prior.leaseUntil) > now.getTime()) return null;

    const plan = await context.frozenPlan();
    const classification = plan === null ? null : classifyPlanTargets(plan);
    const checkpoint: AdapterExecutionCheckpoint = {
      revision: (prior?.revision ?? 0) + 1,
      status: 'EXECUTING',
      attempts: Math.min(4, (prior?.attempts ?? 0) + 1),
      runStartedAt: prior?.runStartedAt ?? population.startedAt,
      startedAt: prior?.startedAt ?? now.toISOString(),
      attemptStartedAt: now.toISOString(),
      leaseUntil: new Date(now.getTime() + (plan?.limits.stepTimeoutSeconds ?? 120) * 1000).toISOString(),
      attemptId: deps.ids.next(),
      diagnostic: null,
    };
    const failed: AdapterExecutionDiagnostic | null =
      plan === null || classification === null
        ? 'unsupported-frozen-plan'
        : classification.unsupported !== null
          ? (classification.unsupported as AdapterExecutionDiagnostic)
          : now.getTime() - Date.parse(checkpoint.runStartedAt) >= plan.limits.runTimeoutSeconds * 1000
            ? 'run-time-limit'
            : (prior?.attempts ?? 0) >= plan.limits.retriesPerStep + 1
              ? 'attempt-limit'
              : null;
    if (failed !== null) {
      checkpoint.status = 'TERMINAL';
      checkpoint.diagnostic = failed;
      const state = failed === 'run-time-limit' ? 'INCONCLUSIVE' : 'RUN_FAILED';
      await context.saveCheckpoint(checkpoint, state);
      await event(context, failed, state, checkpoint, {}, 'failure');
      return null;
    }

    // Materialize the units on the first claim, and reuse the persisted ones after.
    // A frozen step id is the identity, so a resumed Run finds its own rows.
    const steps: SessionStepRecord[] = classification!.references.map((entry) => {
      const existing = context.sessionSteps.find((row) => row.stepId === entry.stepId);
      return (
        existing ?? {
          stepId: entry.stepId,
          ordinal: entry.ordinal,
          registrationId: entry.target.registrationId,
          displayName: entry.target.displayName,
          state: 'PENDING' as const,
          attempts: 0,
          diagnostic: null,
          evidenceId: null,
        }
      );
    });
    const items: WorkItemRecord[] = classification!.adapters.map((entry) => {
      const existing = context.workItems.find((row) => row.stepId === entry.stepId);
      return (
        existing ?? {
          workItemId: deps.ids.next(),
          stepId: entry.stepId,
          ordinal: entry.ordinal,
          registrationId: entry.target.registrationId,
          displayName: entry.target.displayName,
          state: 'PENDING' as const,
          attempts: 0,
          cycles: 0,
          diagnostic: null,
          evidenceId: null,
          observations: 0,
        }
      );
    });
    await context.saveCheckpoint(checkpoint, 'RUNNING');
    for (const step of steps) await context.saveSessionStep(step);
    for (const item of items) await context.saveWorkItem(item);
    await event(context, 'adapter-execution-started', 'RUNNING', checkpoint, {});
    const records = items.length > 0 ? await context.includedRecords() : [];
    return {
      checkpoint, plan: plan!, run, classification: classification!, steps, items, records,
      evidence: context.evidence,
    };
  });
  if (claim === null) return { retry: false };

  const { checkpoint, plan, run, classification, steps, items, records, evidence } = claim;
  const runDeadline = Date.parse(checkpoint.runStartedAt) + plan.limits.runTimeoutSeconds * 1000;
  const stepTimeoutMs = plan.limits.stepTimeoutSeconds * 1000;
  const attemptsPerCycle = plan.limits.retriesPerStep + 1;

  const now = (): number => deps.clock.now().getTime();
  const runExpired = (): boolean => now() >= runDeadline;
  /** Bounded by the shorter of the lease, the frozen Step timeout and the Run deadline. */
  const budget = (): number => {
    const ms = Math.min(Date.parse(checkpoint.leaseUntil), runDeadline, now() + stepTimeoutMs) - now();
    if (ms <= 0) throw new PopulationAcquisitionError('transport');
    return ms;
  };

  /** Guarded commit. A lost claim writes nothing; the returned flag says which happened. */
  const guarded = async (
    work: (context: AdapterExecutionContext) => Promise<void>,
  ): Promise<boolean> =>
    deps.repository.transaction(run.runId, async (context) => {
      if (
        context.checkpoint?.revision !== checkpoint.revision ||
        context.checkpoint.status !== 'EXECUTING' ||
        context.run?.state !== 'RUNNING'
      )
        return false;
      await work(context);
      return true;
    });

  /** Renew the lease inside a unit's own transaction; the revision never moves. */
  const renewLease = (): void => {
    checkpoint.leaseUntil = new Date(now() + stepTimeoutMs).toISOString();
  };

  const stopRun = async (
    diagnostic: AdapterExecutionDiagnostic,
    state: RunRecord['state'],
    fields: EventFields,
  ): Promise<void> => {
    await guarded(async (context) => {
      const next = { ...checkpoint, status: 'TERMINAL' as const, diagnostic };
      await context.saveCheckpoint(next, state);
      await event(context, diagnostic, state, next, fields, 'failure');
    });
  };

  const startStepExecution = (
    planStepId: string,
    workItemId: string | null,
    action: string,
    attempt: number,
  ): StepExecutionRecord => ({
    stepExecutionId: deps.ids.next(),
    planStepId,
    workItemId,
    action,
    state: 'RUNNING',
    attempt,
    startedAt: deps.clock.now().toISOString(),
    completedAt: null,
    diagnostic: null,
  });

  /**
   * Verify one already-registered artifact against the digest it was registered with.
   *
   * This is the tamper check, and it is a RESUME check: a Run that reaches this stage
   * again re-reads what it froze. The stored bytes are never replaced — a mismatch is a
   * terminal integrity failure, exactly as the population's redelivery check is.
   */
  const verifyRegistered = async (
    evidence: { objectKey: string; digest: string | null; size: number | null },
  ): Promise<boolean> => {
    if (evidence.digest === null) return false;
    const stored = await deps.store.read(evidence.objectKey, budget());
    return (
      stored !== null &&
      sha256HexOfBytes(stored) === evidence.digest &&
      (evidence.size === null || stored.length === evidence.size)
    );
  };

  try {
    // ------------------------------------------------- Reference Sources, in order
    for (const entry of classification.references) {
      const step = steps.find((row) => row.stepId === entry.stepId)!;
      if (step.state === 'FAILED') {
        // A Reference Source is a Run-level Session Step. Returning here would leave the
        // claim EXECUTING with a live lease and nothing to move it.
        await stopRun((step.diagnostic ?? 'reference-transport-failed') as AdapterExecutionDiagnostic, 'RUN_FAILED', {
          stepId: step.stepId,
          registrationId: step.registrationId,
        });
        return { retry: false };
      }
      if (step.state === 'ACQUIRED') {
        const registered = evidence.find((row) => row.evidenceId === step.evidenceId) ?? null;
        if (registered === null || registered.state !== 'REGISTERED' || !(await verifyRegistered(registered))) {
          await stopRun('reference-integrity-failed', 'RUN_FAILED', {
            stepId: step.stepId,
            registrationId: step.registrationId,
            ...(step.evidenceId === null ? {} : { evidenceId: step.evidenceId }),
          });
          return { retry: false };
        }
        continue;
      }
      if (runExpired()) {
        await stopRun('run-time-limit', 'INCONCLUSIVE', { stepId: step.stepId });
        return { retry: false };
      }
      const outcome = await runReferenceStep(deps, {
        checkpoint, plan, run, entry, step, guarded, renewLease, budget,
        startStepExecution, attemptsPerCycle, evidence,
      });
      if (outcome === 'failed') {
        await stopRun(step.diagnostic as AdapterExecutionDiagnostic, 'RUN_FAILED', {
          stepId: step.stepId,
          registrationId: step.registrationId,
        });
        return { retry: false };
      }
      if (outcome === 'lost') return { retry: false };
    }

    // -------------------------------------------- Adapter Work Items, sequentially
    for (const entry of classification.adapters) {
      const item = items.find((row) => row.stepId === entry.stepId)!;
      if (item.state === 'OBSERVED' || item.state === 'FAILED' || item.state === 'UNINSPECTED') continue;
      if (runExpired()) {
        await stopRun('run-time-limit', 'INCONCLUSIVE', { workItemId: item.workItemId });
        return { retry: false };
      }
      const outcome = await runWorkItem(deps, {
        checkpoint, plan, run, entry, item, records, guarded, renewLease, budget,
        startStepExecution, attemptsPerCycle, evidence,
      });
      // A failed Work Item never stops the Run: the next one still executes and the Run
      // stays RUNNING. Incomplete coverage becomes INCONCLUSIVE at the Run-level Gate.
      if (outcome === 'lost') return { retry: false };
    }

    const completed = await guarded(async (context) => {
      const next = { ...checkpoint, status: 'EXTRACTION_COMPLETE' as const, diagnostic: null };
      await context.saveCheckpoint(next, 'RUNNING');
      await event(context, 'adapter-extraction-complete', 'RUNNING', next, {
        observations: items.reduce((total, item) => total + item.observations, 0),
      });
    });
    return { retry: !completed };
  } catch (error) {
    const expired = runExpired();
    const diagnostic: AdapterExecutionDiagnostic = expired ? 'run-time-limit' : failureDiagnostic('extraction', error);
    const terminal = expired || checkpoint.attempts >= plan.limits.retriesPerStep + 1;
    const state: RunRecord['state'] = expired ? 'INCONCLUSIVE' : terminal ? 'RUN_FAILED' : 'RUNNING';
    await guarded(async (context) => {
      const next = { ...checkpoint, status: terminal ? ('TERMINAL' as const) : ('RETRY' as const), diagnostic };
      await context.saveCheckpoint(next, state);
      await event(context, diagnostic, state, next, {}, 'failure');
    });
    return { retry: !terminal };
  }
}

interface UnitContext {
  checkpoint: AdapterExecutionCheckpoint;
  plan: ExecutablePlan;
  run: RunRecord;
  entry: ClassifiedTarget;
  guarded(work: (context: AdapterExecutionContext) => Promise<void>): Promise<boolean>;
  renewLease(): void;
  budget(): number;
  startStepExecution(
    planStepId: string,
    workItemId: string | null,
    action: string,
    attempt: number,
  ): StepExecutionRecord;
  attemptsPerCycle: number;
  /** The Evidence rows as the claim read them, so a resumed attempt keeps its digest. */
  evidence: readonly AdapterEvidenceRecord[];
}

/**
 * The Evidence record an attempt starts from.
 *
 * A resumed attempt inherits the digest and size a previous one registered, which is what
 * makes `freezeArtifact` compare the bytes it just fetched against what was already
 * frozen instead of quietly accepting different ones. A REGISTERED row is never
 * downgraded to RESERVED: it was registered, and saying otherwise would be a lie about
 * an artifact that exists.
 */
function evidenceFor(
  unit: UnitContext,
  evidenceId: string,
  kind: AdapterEvidenceRecord['kind'],
  objectKey: string,
): AdapterEvidenceRecord {
  const prior = unit.evidence.find((row) => row.evidenceId === evidenceId);
  return {
    evidenceId,
    kind,
    registrationId: unit.entry.target.registrationId,
    objectKey,
    mediaType: prior?.mediaType ?? null,
    digest: prior?.digest ?? null,
    size: prior?.size ?? null,
    state: prior?.state === 'REGISTERED' ? 'REGISTERED' : 'RESERVED',
  };
}

/** Reserve, upload, verify, register — the sequence Story 3.2 established, once. */
async function freezeArtifact(
  deps: AdapterExecutionDependencies,
  evidence: AdapterEvidenceRecord,
  artifact: AcquiredArtifact,
  budget: () => number,
): Promise<{ digest: string; size: number }> {
  await deps.store.putIfAbsent(evidence.objectKey, artifact.bytes, budget());
  const stored = await deps.store.read(evidence.objectKey, budget());
  if (stored === null) throw new PopulationAcquisitionError('integrity');
  const digest = sha256HexOfBytes(stored);
  // The bytes already in the store win. A reserved key that holds something else is a
  // damaged object, not something to overwrite.
  if (stored.length !== artifact.bytes.length || digest !== sha256HexOfBytes(artifact.bytes)) {
    throw new PopulationAcquisitionError('integrity');
  }
  if (evidence.digest !== null && evidence.digest !== digest) throw new PopulationAcquisitionError('integrity');
  return { digest, size: stored.length };
}

async function runReferenceStep(
  deps: AdapterExecutionDependencies,
  unit: UnitContext & { step: SessionStepRecord },
): Promise<'acquired' | 'failed' | 'lost'> {
  const { step, entry, checkpoint } = unit;
  while (step.attempts < unit.attemptsPerCycle) {
    step.attempts += 1;
    const execution = unit.startStepExecution(entry.stepId, null, 'extract-adapter', step.attempts);
    const evidence = evidenceFor(
      unit,
      step.evidenceId ?? deps.ids.next(),
      'reference-source',
      evidenceKey('reference', unit.run.runId, entry.stepId),
    );
    step.evidenceId = evidence.evidenceId;
    step.state = 'IN_PROGRESS';
    step.diagnostic = null;
    unit.renewLease();
    const reserved = await unit.guarded(async (context) => {
      // Evidence first: `run_session_step.evidence_id` is a real foreign key, so the
      // row it names has to exist before the step that names it.
      await context.saveCheckpoint(checkpoint, 'RUNNING');
      await context.saveEvidence(evidence);
      await context.saveSessionStep(step);
      await context.saveStepExecution(execution);
      await event(context, 'reference-attempt-started', 'RUNNING', checkpoint, {
        stepId: step.stepId,
        registrationId: step.registrationId,
        evidenceId: evidence.evidenceId,
        stepExecutionId: execution.stepExecutionId,
        attempt: step.attempts,
      });
    });
    if (!reserved) return 'lost';

    try {
      const artifact = await deps.reference.acquireReference(entry.target, unit.budget());
      const frozen = await freezeArtifact(deps, evidence, artifact, unit.budget);
      step.state = 'ACQUIRED';
      const registered: AdapterEvidenceRecord = {
        ...evidence,
        mediaType: artifact.mediaType,
        digest: frozen.digest,
        size: frozen.size,
        state: 'REGISTERED',
      };
      const committed = await unit.guarded(async (context) => {
        await context.saveEvidence(registered);
        await context.saveSessionStep(step);
        await context.saveStepExecution({
          ...execution,
          state: 'SUCCEEDED',
          completedAt: deps.clock.now().toISOString(),
        });
        await event(context, 'reference-source-acquired', 'RUNNING', checkpoint, {
          stepId: step.stepId,
          registrationId: step.registrationId,
          evidenceId: registered.evidenceId,
          stepExecutionId: execution.stepExecutionId,
          digest: frozen.digest,
          size: frozen.size,
          attempt: step.attempts,
        });
      });
      return committed ? 'acquired' : 'lost';
    } catch (error) {
      const diagnostic = failureDiagnostic('reference', error);
      const exhausted = step.attempts >= unit.attemptsPerCycle || diagnostic !== 'reference-transport-failed';
      step.state = exhausted ? 'FAILED' : 'PENDING';
      step.diagnostic = diagnostic;
      const committed = await unit.guarded(async (context) => {
        await context.saveSessionStep(step);
        await context.saveStepExecution({
          ...execution,
          state: 'FAILED',
          completedAt: deps.clock.now().toISOString(),
          diagnostic,
        });
        if (exhausted) {
          await context.saveEvidence({ ...evidence, state: 'ABANDONED' });
        }
        await event(context, diagnostic, 'RUNNING', checkpoint, {
          stepId: step.stepId,
          registrationId: step.registrationId,
          stepExecutionId: execution.stepExecutionId,
          attempt: step.attempts,
        }, 'failure');
      });
      if (!committed) return 'lost';
      if (exhausted) return 'failed';
    }
  }
  step.state = 'FAILED';
  step.diagnostic = step.diagnostic ?? 'reference-transport-failed';
  // Reached only when a resumed step already holds a spent budget in a non-terminal
  // state. Persist what is being claimed rather than reporting it and writing nothing.
  await unit.guarded(async (context) => {
    await context.saveSessionStep(step);
  });
  return 'failed';
}

async function runWorkItem(
  deps: AdapterExecutionDependencies,
  unit: UnitContext & { item: WorkItemRecord; records: readonly PopulationRecord[] },
): Promise<'observed' | 'failed' | 'lost'> {
  const { item, entry, checkpoint, plan } = unit;
  // The owner's 2026-09-05 decision: one automatic extra bounded retry cycle after the
  // first exhaustion, then FAILED. No human retry-or-skip Escalation on this path.
  const maxAttempts = unit.attemptsPerCycle * 2;
  const reference = plan.credentialReferences.find(
    (candidate) => candidate.targetSystemId === entry.target.registrationId,
  );
  if (reference === undefined) {
    item.state = 'FAILED';
    item.diagnostic = 'unsupported-frozen-plan';
    const committed = await unit.guarded(async (context) => {
      await context.saveWorkItem(item);
      await event(context, 'unsupported-frozen-plan', 'RUNNING', checkpoint, {
        workItemId: item.workItemId,
        registrationId: item.registrationId,
      }, 'failure');
    });
    return committed ? 'failed' : 'lost';
  }

  while (item.attempts < maxAttempts) {
    item.attempts += 1;
    const execution = unit.startStepExecution(entry.stepId, item.workItemId, 'extract-adapter', item.attempts);
    const evidence = evidenceFor(
      unit,
      item.evidenceId ?? deps.ids.next(),
      'adapter-extraction',
      evidenceKey('extraction', unit.run.runId, entry.stepId),
    );
    item.evidenceId = evidence.evidenceId;
    item.state = 'IN_PROGRESS';
    item.diagnostic = null;
    unit.renewLease();
    const reserved = await unit.guarded(async (context) => {
      await context.saveCheckpoint(checkpoint, 'RUNNING');
      await context.saveEvidence(evidence);
      await context.saveWorkItem(item);
      await context.saveStepExecution(execution);
      await event(context, 'work-item-attempt-started', 'RUNNING', checkpoint, {
        workItemId: item.workItemId,
        stepId: item.stepId,
        registrationId: item.registrationId,
        evidenceId: evidence.evidenceId,
        stepExecutionId: execution.stepExecutionId,
        attempt: item.attempts,
      });
    });
    if (!reserved) return 'lost';

    let diagnostic: AdapterExecutionDiagnostic | null = null;
    let frozen: { digest: string; size: number } | null = null;
    try {
      // Just in time, for this request only. The value has no field to live in.
      const credential = await deps.credentials.resolve(reference.credentialRef, unit.budget()).catch(() => {
        throw new CredentialUnresolved();
      });
      if (credential.reference !== reference.credentialRef) throw new CredentialUnresolved();
      const resolvedEvent = await unit.guarded(async (context) => {
        await event(context, 'credential-resolved', 'RUNNING', checkpoint, {
          workItemId: item.workItemId,
          registrationId: item.registrationId,
          stepExecutionId: execution.stepExecutionId,
        });
      });
      if (!resolvedEvent) return 'lost';

      const artifact = await deps.extraction.extract(entry.target, credential, unit.budget());
      // Freeze first, parse second. A response that is not a declared collection is still
      // what the Target System said, and an INCONCLUSIVE Run keeps its partial Evidence.
      frozen = await freezeArtifact(deps, evidence, artifact, unit.budget);
      evidence.mediaType = artifact.mediaType;
      evidence.digest = frozen.digest;
      evidence.size = frozen.size;
      const parsed = parseExtractionRows(artifact);
      const built = buildAdapterObservations({
        plan,
        target: entry.target,
        workItemId: item.workItemId,
        stepExecutionId: execution.stepExecutionId,
        evidenceId: evidence.evidenceId,
        collection: parsed.collection,
        rows: parsed.rows,
        records: unit.records,
        observedAt: deps.clock.now().toISOString(),
        nextId: () => deps.ids.next(),
      });
      item.state = 'OBSERVED';
      item.observations = built.observations.length;
      const notes = [
        ...(built.unkeyed > 0 ? [`unkeyed-records:${String(built.unkeyed)}`] : []),
        ...(built.duplicates > 0 ? [`duplicate-record-keys:${String(built.duplicates)}`] : []),
      ];
      item.diagnostic = notes.length > 0 ? notes.join(', ') : null;
      // A `let` captured by a closure widens back to its declared type, so the digest and
      // size the event reports are read out here rather than inside the callback.
      const registered: AdapterEvidenceRecord = { ...evidence, state: 'REGISTERED' };
      const { digest, size } = frozen;
      // Evidence, then the Work Item, then its Step Execution, then the Observations that
      // name both: every row is written after the row it refers to.
      const committed = await unit.guarded(async (context) => {
        await context.saveEvidence(registered);
        await context.saveWorkItem(item);
        await context.saveStepExecution({
          ...execution,
          state: 'SUCCEEDED',
          completedAt: deps.clock.now().toISOString(),
          diagnostic: item.diagnostic,
        });
        await context.saveObservations(built.observations);
        await event(context, 'work-item-observed', 'RUNNING', checkpoint, {
          workItemId: item.workItemId,
          stepId: item.stepId,
          registrationId: item.registrationId,
          evidenceId: registered.evidenceId,
          stepExecutionId: execution.stepExecutionId,
          digest,
          size,
          observations: built.observations.length,
          attempt: item.attempts,
        });
      });
      return committed ? 'observed' : 'lost';
    } catch (error) {
      diagnostic =
        error instanceof CredentialUnresolved ? 'credential-unresolved' : failureDiagnostic('extraction', error);
    }

    const cycleExhausted = item.attempts % unit.attemptsPerCycle === 0;
    const terminal = item.attempts >= maxAttempts || diagnostic === 'credential-unresolved';
    item.cycles = Math.min(2, Math.ceil(item.attempts / unit.attemptsPerCycle));
    item.state = terminal ? 'FAILED' : cycleExhausted ? 'AWAITING' : 'IN_PROGRESS';
    item.diagnostic = diagnostic;
    const committed = await unit.guarded(async (context) => {
      await context.saveWorkItem(item);
      await context.saveStepExecution({
        ...execution,
        state: 'FAILED',
        completedAt: deps.clock.now().toISOString(),
        diagnostic,
      });
      // Verified bytes stay REGISTERED even though the Work Item failed: they are what
      // the Target System actually answered. Only a reservation nothing was written to
      // is abandoned.
      if (frozen !== null) await context.saveEvidence({ ...evidence, state: 'REGISTERED' });
      else if (terminal) await context.saveEvidence({ ...evidence, state: 'ABANDONED' });
      await event(context, diagnostic!, 'RUNNING', checkpoint, {
        workItemId: item.workItemId,
        stepId: item.stepId,
        registrationId: item.registrationId,
        stepExecutionId: execution.stepExecutionId,
        attempt: item.attempts,
      }, 'failure');
    });
    if (!committed) return 'lost';
    if (terminal) return 'failed';
  }
  item.state = 'FAILED';
  item.diagnostic = item.diagnostic ?? 'extraction-transport-failed';
  await unit.guarded(async (context) => {
    await context.saveWorkItem(item);
  });
  return 'failed';
}

/** Thrown where a resolver failed. It carries no reference and no value, ever. */
class CredentialUnresolved extends Error {
  override readonly name = 'CredentialUnresolved';
}
