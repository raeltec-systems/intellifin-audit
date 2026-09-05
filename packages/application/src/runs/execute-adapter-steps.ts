import {
  adapterLookupColumn,
  adapterSearchKeys,
  classifyPlanTargets,
  decodePopulationUtf8,
  isCompleteCollectionEnvelope,
  observationIdFor,
  sha256HexOfBytes,
  canonicalJson,
  OBSERVATION_LIMITS,
  OBSERVATION_SCHEMA_VERSION,
  type ClassifiedTarget,
  type ExecutablePlan,
  type JsonValue,
  type ObservationAttribute,
  type ObservationFound,
  type ObservationQueryKey,
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
  type ObservationCorroborationPort,
  type ObservationEvaluationPort,
  type PopulationRecord,
  type ReferenceAcquisitionPort,
  type SessionStepRecord,
  type StepExecutionRecord,
  type WorkItemRecord,
} from './execution-ports.js';
import type { PopulationJob } from './acquire-population.js';
import {
  ObservationRegistrationError,
  registerObservations,
  type ObservationBatchItem,
} from './register-observations.js';

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
  /**
   * Story 3.6's seam. Required, not optional: a composition root that forgets it would
   * silently register every attribute as "not yet judged" forever, and the next story
   * would have nowhere obvious to plug in. `NO_CORROBORATION` is the explicit "not yet".
   */
  corroboration: ObservationCorroborationPort;
  /** Story 3.7's seam. `NO_EVALUATION` is the explicit "not yet", for the same reason. */
  evaluation: ObservationEvaluationPort;
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
  | 'extraction-contract-failed'
  | 'observation-registration-refused';

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

/**
 * The declared collection of an extraction response, or a contract failure.
 *
 * `complete` is the §H extraction-completeness verdict, and it is the third leg of an
 * honest absence: the response DECLARES itself complete, the row count it reports is the
 * row count it carries, and its envelope holds no key outside the closed set. Absent or
 * contradicted, the extraction is not provably complete and every `found = false` it
 * produced is `UNINSPECTED` rather than a finding.
 */
export function parseExtractionRows(artifact: AcquiredArtifact): {
  collection: string;
  rows: readonly Record<string, JsonValue>[];
  complete: boolean;
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
  const collection = keys[0]!;
  const rows: unknown = value[collection];
  if (!Array.isArray(rows) || !rows.every(objectValue)) throw new PopulationAcquisitionError('contract');
  try {
    canonicalJson(rows as JsonValue);
  } catch {
    throw new PopulationAcquisitionError('contract');
  }
  // The CLOSED v1 collection envelope, and the ONE list of its keys — the same one
  // Story 3.2 reconciles an API population against. An open envelope lets an alternate or
  // nested continuation marker (`next`, `cursor`, a name nobody thought of) pass
  // unnoticed, and a partial page then reads as a complete extraction, which turns "this
  // record is not in the system" into "this record is not on the page I happened to
  // read". A key the envelope does not name does not fail the PARSE — the bytes are still
  // what the Target System answered and are still frozen as Evidence — it makes the
  // extraction NOT PROVABLY COMPLETE, so every absence from it becomes `UNINSPECTED`.
  const returned = value['returned'];
  const complete =
    isCompleteCollectionEnvelope(value) && (returned === undefined || returned === rows.length);
  return { collection, rows: rows as Record<string, JsonValue>[], complete };
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
 * Build one registration item per included population record for one adapter Work Item.
 *
 * The join is the Template's frozen lookup column, compared as an exact opaque string.
 * Exactly one match resolves; zero is a proven-absence candidate; more than one is
 * `ambiguous` and never picks.
 *
 * Each `found = false` item carries the absence proof the adapter can actually make: the
 * query key it DERIVED (the first frozen lookup column, which is the one it indexed by),
 * the extraction Evidence that holds the empty result, and whether the extraction proved
 * itself complete. Beside it goes the EXPECTED list — every declared search key with the
 * population record's normalized value — which the registration compares the proof
 * against. A Template declaring two search keys is therefore not proven absent by an
 * adapter that searched one of them.
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
  /** The §H extraction-completeness verdict from `parseExtractionRows`. */
  complete: boolean;
}): { items: readonly ObservationBatchItem[]; unkeyed: number; duplicates: number } {
  const column = adapterLookupColumn(input.plan.inputs.templateId);
  const searchKeys = adapterSearchKeys(input.plan.inputs.templateId);
  if (column === null || searchKeys === null) throw new PopulationAcquisitionError('contract');
  const declared = input.plan.observations.filter((field) => field.attributeName !== 'found');
  const index = new Map<string, number[]>();
  for (const [position, row] of input.rows.entries()) {
    const key = row[column];
    if (typeof key !== 'string' || key === '') continue;
    const existing = index.get(key);
    if (existing) existing.push(position);
    else index.set(key, [position]);
  }

  const items: ObservationBatchItem[] = [];
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
    const observation: ObservationRecord = {
      schemaVersion: OBSERVATION_SCHEMA_VERSION,
      // DERIVED, never minted: a redelivered batch has to produce the same Observation,
      // or the row that survives the unique index and the row the second event describes
      // are two different things (Story 3.4).
      observationId: observationIdFor(input.workItemId, key),
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
    };
    // Every declared search key with the population record's value for it. A key the
    // record does not carry as a non-empty string gets the empty string, which no derived
    // query key can equal — fail-closed, so an absence over a record missing a declared
    // search value is `UNINSPECTED` rather than quietly believed.
    const expectedQueryKeys: ObservationQueryKey[] = searchKeys.map((name) => {
      const value = record.values[name];
      return { key: name, value: typeof value === 'string' ? value : '' };
    });
    items.push({
      record: observation,
      // The platform clock is UTC, so the source text and the normalized instant are the
      // same string here. An agent read whose Target System reports a source offset
      // supplies a different one and registration normalizes it.
      observedAtSource: input.observedAt,
      absence:
        found === 'false'
          ? {
              // What the adapter ACTUALLY searched: the frozen lookup column it indexed
              // the extraction by, with the value it took from the population record.
              queryKeys: [{ key: column, value: key }],
              emptyResultEvidenceId: input.evidenceId,
              extractionComplete: input.complete,
            }
          : null,
      expectedQueryKeys,
    });
  }
  return { items, unkeyed, duplicates };
}

function evidenceKey(kind: 'reference' | 'extraction', runId: string, stepId: string): string {
  if (!STEP_ID_PATTERN.test(stepId)) throw new PopulationAcquisitionError('contract');
  return `${kind}/${runId}/${stepId}`;
}

function failureDiagnostic(
  unit: 'reference' | 'extraction',
  error: unknown,
): AdapterExecutionDiagnostic {
  // A refused registration is not a transport failure, and reporting it as one would send
  // an operator to look at a Target System that answered perfectly well. It is also not
  // retryable: the same bytes produce the same batch, so retrying it eight times against
  // a live system proves nothing (the `credential-unresolved` rule, one layer along).
  if (error instanceof ObservationRegistrationError) return 'observation-registration-refused';
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
    // What the row said before this attempt. A failed attempt restores it: the count is
    // set optimistically before the commit that stores the Observations, and a commit
    // that rolls back would otherwise leave the Work Item reporting Observations that
    // are not there.
    const priorObservations = item.observations;
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
        complete: parsed.complete,
      });
      item.state = 'OBSERVED';
      item.observations = built.items.length;
      const notes = [
        ...(built.unkeyed > 0 ? [`unkeyed-records:${String(built.unkeyed)}`] : []),
        ...(built.duplicates > 0 ? [`duplicate-record-keys:${String(built.duplicates)}`] : []),
        ...(parsed.complete ? [] : ['extraction-incomplete']),
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
        // The one transactional registration (Story 3.4): the rows, their per-Observation
        // check outcomes, their evaluations, the audit event carrying every digest and
        // the Timeline notification, inside THIS transaction with the Evidence, the Work
        // Item and the Step Execution above. A refusal throws and takes all of it back.
        await registerObservations(
          context,
          {
            run: unit.run,
            workItemId: item.workItemId,
            stepExecutionId: execution.stepExecutionId,
            targetSystem: entry.target.registrationId,
            runStartedAt: checkpoint.runStartedAt,
            registeredAt: deps.clock.now().toISOString(),
            items: built.items,
          },
          { corroboration: deps.corroboration, evaluation: deps.evaluation },
        );
        await event(context, 'work-item-observed', 'RUNNING', checkpoint, {
          workItemId: item.workItemId,
          stepId: item.stepId,
          registrationId: item.registrationId,
          evidenceId: registered.evidenceId,
          stepExecutionId: execution.stepExecutionId,
          digest,
          size,
          observations: built.items.length,
          attempt: item.attempts,
        });
      });
      return committed ? 'observed' : 'lost';
    } catch (error) {
      diagnostic =
        error instanceof CredentialUnresolved ? 'credential-unresolved' : failureDiagnostic('extraction', error);
    }

    item.observations = priorObservations;
    const cycleExhausted = item.attempts % unit.attemptsPerCycle === 0;
    const terminal =
      item.attempts >= maxAttempts ||
      diagnostic === 'credential-unresolved' ||
      diagnostic === 'observation-registration-refused';
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
