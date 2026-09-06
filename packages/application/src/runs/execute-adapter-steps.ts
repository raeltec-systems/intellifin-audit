import {
  adapterAttemptBudget,
  adapterExtractionScope,
  adapterLookupColumn,
  adapterSearchKeys,
  classifyPlanTargets,
  decodePopulationUtf8,
  exhaustedRunLimit,
  runStopFor,
  sessionStepAttemptBudget,
  groundedText,
  isCompleteCollectionEnvelope,
  normalizeObservationValue,
  observationIdFor,
  canonicalJson,
  OBSERVATION_LIMITS,
  OBSERVATION_SCHEMA_VERSION,
  snapshotSubstrateForMediaType,
  type ClassifiedTarget,
  type ExecutablePlan,
  type JsonValue,
  type ObservationAttribute,
  type ObservationFound,
  type ObservationQueryKey,
  type ObservationRecord,
  type ProcedureTargetSnapshot,
  type ReferenceArtifact,
  type RunRecord,
  type RunCancellationRequest,
  type RunLimitCause,
  type RunStopCause,
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
  type ExceptionFingerprinter,
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
import { snapshotCorroboration } from './snapshot-corroboration.js';
import { ruleEvaluation } from './rule-evaluation.js';
import {
  adapterEvidenceRecord,
  registerEvidence,
  freezeArtifact,
  readRegisteredArtifact,
  reserveArtifact,
} from './evidence-package.js';
import { guardedCredentials, type CredentialGuard } from './credential-guard.js';
import { completeRun } from './complete-run.js';
import { performCancellation } from './cancel-run.js';
import { runRunLevelGate, SECURITY_DENIED_EVENT } from './run-gate.js';

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
   * Story 3.7. The keyed fingerprint every Exception is written with.
   *
   * The EVALUATOR is deliberately not a dependency: it is built inside the stage from the
   * frozen plan, the frozen population and the Reference Source bytes this stage acquired,
   * none of which a composition root has (the Story 3.6 corroboration lesson, one story
   * along). What a composition root does own is the deployment's fingerprint key, and it
   * hands over a port that can use it rather than the key itself.
   */
  exceptions: ExceptionFingerprinter;
}

/** The closed diagnostic vocabulary. Never an error message, never a URL, never a value. */
export type AdapterExecutionDiagnostic =
  | 'unsupported-frozen-plan'
  | 'agent-driven-target'
  | 'unsupported-plan-version'
  | 'run-time-limit'
  | 'run-step-execution-limit'
  | 'run-token-limit'
  | 'attempt-limit'
  | 'credential-unresolved'
  | 'reference-transport-failed'
  | 'reference-integrity-failed'
  | 'reference-contract-failed'
  | 'reference-denied'
  | 'reference-scope-violation'
  /** The artifact disclosed a credential this Run presented. Refused, never stored. */
  | 'reference-credential-disclosed'
  | 'extraction-transport-failed'
  | 'extraction-integrity-failed'
  | 'extraction-contract-failed'
  | 'extraction-denied'
  | 'extraction-scope-violation'
  /** The artifact disclosed a credential this Run presented. Refused, never stored. */
  | 'extraction-credential-disclosed'
  | 'observation-registration-refused'
  /** A person cancelled the Run. Never produced by a limit, a Gate or a failure. */
  | 'canceled';

/**
 * The §E.1 cause behind a diagnostic, or `null` when it is not one this story stops for.
 *
 * A denied action and a scope violation are TERMINAL for the Run and additionally logged as
 * a security event — the owner's automatic second retry cycle covers an exhausted retry
 * budget, not a system that said no. Retrying a refusal against a live Target System proves
 * nothing and spends the Run's limits doing it, the `credential-unresolved` rule one layer
 * along.
 */
export function stopCauseFor(diagnostic: AdapterExecutionDiagnostic): RunStopCause | null {
  switch (diagnostic) {
    case 'reference-denied':
    case 'extraction-denied':
      return 'action-denied';
    case 'reference-scope-violation':
    case 'extraction-scope-violation':
      return 'scope-violation';
    case 'reference-integrity-failed':
    case 'extraction-integrity-failed':
      return 'integrity-mismatch';
    case 'run-time-limit':
      return 'run-time-limit';
    case 'run-step-execution-limit':
      return 'run-step-execution-limit';
    case 'run-token-limit':
      return 'run-token-limit';
    default:
      return null;
  }
}

/**
 * The diagnostic each Run-level LIMIT is recorded under.
 *
 * `Record<RunLimitCause, …>` and not `Record<RunStopCause, …>`: the other four causes never
 * reach `stopForCause`, because a denial, a scope violation, a Session Step failure and an
 * integrity mismatch each already carry the UNIT's own diagnostic and stop the Run through
 * `stopRun`. Rows for them would be four entries nothing exercises, and a branch nothing
 * exercises is a branch that can be inverted silently.
 */
const LIMIT_DIAGNOSTIC: Readonly<Record<RunLimitCause, AdapterExecutionDiagnostic>> = {
  'run-step-execution-limit': 'run-step-execution-limit',
  'run-time-limit': 'run-time-limit',
  'run-token-limit': 'run-token-limit',
};

/** The collection names an extraction response may carry (population contract v1). */
const COLLECTION_KEYS = ['accounts', 'transactions', 'employees', 'approvals'] as const;

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

/**
 * Perform the `CANCELED` transition inside the caller's transaction (Story 3.10).
 *
 * The checkpoint goes TERMINAL in the same write, so the extraction recovery sweep never
 * selects the Run again, and `performCancellation` — the one place a Run becomes
 * `CANCELED` — writes the state, the Timeline event and the Result. The Evidence this Run
 * has already registered is untouched: nothing here reads or writes an artifact, and the
 * seal `CompleteRun` takes lists a partial reservation as abandoned rather than dropping
 * it.
 */
async function cancelHere(
  context: AdapterExecutionContext,
  checkpoint: AdapterExecutionCheckpoint,
  run: RunRecord,
  request: RunCancellationRequest,
  plan: ExecutablePlan | null,
  at: string,
): Promise<void> {
  const next = { ...checkpoint, status: 'TERMINAL' as const, diagnostic: 'canceled' as const };
  await context.saveCheckpoint(next, 'CANCELED');
  await event(context, 'canceled', 'CANCELED', next, {}, 'failure');
  await performCancellation(context, { run, request, at, plan, source: 'worker' });
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
            extractedText: groundedText(original),
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
  // A denial and a scope violation are named for what they are rather than suffixed
  // `-failed` like a transport hiccup: §E.1 gives them a different terminal state and a
  // security event, and a name that reads like an outage sends an operator to the wrong
  // place.
  if (code === 'denied') return `${unit}-denied` as AdapterExecutionDiagnostic;
  if (code === 'scope') return `${unit}-scope-violation` as AdapterExecutionDiagnostic;
  // Story 4.3. The artifact carried a credential this Run had presented, so it was refused
  // before anything was uploaded. Named for what it is: it is not an integrity failure —
  // nothing is damaged and the bytes are exactly what the system served — and it is not a
  // transport failure, which would send an operator to look at a system that answered
  // perfectly well.
  if (code === 'credential') return `${unit}-credential-disclosed` as AdapterExecutionDiagnostic;
  return `${unit}-${code}-failed` as AdapterExecutionDiagnostic;
}

/** Every I/O is bounded by the lease, the frozen Step timeout and the Run deadline. */
export async function executeAdapterSteps(
  dependencies: AdapterExecutionDependencies,
  job: PopulationJob,
): Promise<{ retry: boolean }> {
  // Every credential this stage resolves is held by `guard`, because the stage resolves
  // through the WRAPPED resolver and never through the one it was handed (Story 4.3).
  // There is no "remember this one" step for a branch to skip, and `freezeArtifact` takes
  // the guard as a required argument, so no artifact reaches the object store without
  // having been scanned for every credential this Run has presented.
  const { credentials, guard } = guardedCredentials(dependencies.credentials);
  const deps: AdapterExecutionDependencies = { ...dependencies, credentials };
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
    // A person asked for this Run to stop (Story 3.10). The claim transaction is the
    // first boundary and it is checked before anything is materialized: no lease of this
    // attempt is live, no Session Step and no Work Item has started, and the transition
    // commits with the checkpoint that records why the stage stopped.
    if (run.cancellation !== null) {
      await cancelHere(context, checkpoint, run, run.cancellation, plan, now.toISOString());
      return null;
    }
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
      await completeRun(context, { run, state, at: now.toISOString(), plan });
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
          action: 'extract-adapter' as const,
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
      // Every attempt this Run has already made counts against the frozen Step Execution
      // limit, including the ones an earlier claim made before a restart.
      stepExecutions: await context.readStepExecutionCount(),
    };
  });
  if (claim === null) return { retry: false };

  const { checkpoint, plan, run, classification, steps, items, records, evidence } = claim;
  const runDeadline = Date.parse(checkpoint.runStartedAt) + plan.limits.runTimeoutSeconds * 1000;
  const stepTimeoutMs = plan.limits.stepTimeoutSeconds * 1000;
  // The FROZEN retry budget, and the owner's 2026-09-05 second cycle for an adapter Work
  // Item. Read from the plan through the domain, never restated here.
  const attemptsPerCycle = plan.limits.retriesPerStep + 1;
  let stepExecutions = claim.stepExecutions;

  const now = (): number => deps.clock.now().getTime();
  const runExpired = (): boolean => now() >= runDeadline;
  /**
   * Which frozen Run-level limit is spent, or `null`.
   *
   * Step Executions, elapsed time and tokens, in §E.1's order, against the limits the
   * VERSION froze. Tokens are zero for every Run of this epic — the adapter path calls no
   * model — and the counter is passed anyway so the agent epic fills it rather than adding
   * a limit that was never mapped.
   */
  const limitReached = (): RunLimitCause | null =>
    exhaustedRunLimit(
      { stepExecutions, elapsedMs: now() - Date.parse(checkpoint.runStartedAt), tokens: 0 },
      plan.limits,
    );
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
      // §E.1: a denied action or a scope violation is ADDITIONALLY logged as a security
      // event. It is appended here rather than remembered at each call site, so a branch
      // that stops the Run cannot drop the only record that the platform was told no.
      const cause = stopCauseFor(diagnostic);
      if (cause !== null && runStopFor(cause).securityEvent) {
        const stored = await context.auditEvents.append({
          actor: { type: 'system', id: 'adapter-worker' },
          eventType: SECURITY_DENIED_EVENT,
          source: 'worker',
          outcome: 'denied',
          aggregateId: run.runId,
          correlationId: run.correlationId,
          sessionId: run.sessionId,
          payload: {
            cause,
            diagnostic,
            state,
            ...Object.fromEntries(
              Object.entries(fields).filter(([, value]) => value !== undefined),
            ),
          },
        });
        await context.notifyTimeline(stored.sequence);
      }
      await completeRun(context, { run, state, at: deps.clock.now().toISOString(), plan });
    });
  };

  /**
   * Honour a cancellation at a unit boundary, or report that there is none (Story 3.10).
   *
   * Called BEFORE each Session Step and each Work Item, never inside one: a unit already
   * started is allowed to finish and commit, because the only thing worse than a Run that
   * stops a moment late is a unit abandoned half-written. The read is inside the same
   * guarded transaction that writes, so a cancellation committing at this instant is
   * either fully visible here or lands before the next boundary.
   */
  const canceledAtBoundary = async (): Promise<boolean> => {
    let canceled = false;
    await guarded(async (context) => {
      const request = context.run?.cancellation ?? null;
      if (request === null) return;
      canceled = true;
      await cancelHere(context, checkpoint, run, request, plan, deps.clock.now().toISOString());
    });
    return canceled;
  };

  /**
   * Stop the Run for one §E.1 cause, taking the state from the domain's mapping.
   *
   * The mapping lives in `limits.ts` and is read, never restated: a limit produces
   * `INCONCLUSIVE` with partial Evidence preserved, a denial or an integrity mismatch
   * produces `RUN_FAILED`, and neither ever produces `CANCELED`.
   */
  const stopForCause = async (cause: RunLimitCause, fields: EventFields): Promise<void> => {
    const decision = runStopFor(cause);
    await stopRun(LIMIT_DIAGNOSTIC[cause], decision.state, fields);
  };

  const startStepExecution = (
    planStepId: string,
    workItemId: string | null,
    action: string,
    attempt: number,
  ): StepExecutionRecord => ({
    // Counted here, where a Step Execution actually starts, so no branch can start one
    // without spending the frozen limit for it.
    stepExecutionId: (stepExecutions += 1, deps.ids.next()),
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
   * Verify one already-registered artifact against the digest it was registered with, and
   * return the bytes it verified.
   *
   * This is the tamper check, and it is a RESUME check: a Run that reaches this stage
   * again re-reads what it froze. The stored bytes are never replaced — a mismatch is a
   * terminal integrity failure, exactly as the population's redelivery check is. The bytes
   * come back because a Reference Source acquired on an EARLIER attempt still has to be
   * readable by the evaluator on this one, and the verified read is the only honest place
   * to get them: what the evaluator consults is what the freeze established.
   */
  const verifyRegistered = (
    evidence: { objectKey: string; digest: string | null; size: number | null },
  ): Promise<Uint8Array | null> => readRegisteredArtifact(deps.store, evidence, budget);

  /**
   * The Reference Source bytes of this Run, in authored order.
   *
   * Frozen, verified and held for the evaluator (Story 3.7): P-2's compiled rule expands a
   * role through the versioned RoleMatrix, and a role it cannot expand is Unevaluated. It
   * is filled by both paths a Session Step can take — acquired on this attempt, or already
   * `ACQUIRED` and re-read here — so a resumed Run evaluates exactly as a first one does.
   */
  const references: ReferenceArtifact[] = [];

  try {
    // ------------------------------------------------- Reference Sources, in order
    for (const entry of classification.references) {
      if (await canceledAtBoundary()) return { retry: false };
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
        const verified = registered === null || registered.state !== 'REGISTERED'
          ? null
          : await verifyRegistered(registered);
        if (registered === null || verified === null) {
          await stopRun('reference-integrity-failed', 'RUN_FAILED', {
            stepId: step.stepId,
            registrationId: step.registrationId,
            ...(step.evidenceId === null ? {} : { evidenceId: step.evidenceId }),
          });
          return { retry: false };
        }
        references.push({ bytes: verified, mediaType: registered.mediaType ?? '' });
        continue;
      }
      const spent = limitReached();
      if (spent !== null) {
        await stopForCause(spent, { stepId: step.stepId });
        return { retry: false };
      }
      const outcome = await runReferenceStep(deps, {
        checkpoint, plan, run, entry, step, guarded, renewLease, budget,
        startStepExecution, attemptsPerCycle, limitReached, evidence, references, guard,
      });
      if (outcome === 'limit') {
        await stopForCause(limitReached() ?? 'run-time-limit', { stepId: step.stepId });
        return { retry: false };
      }
      if (outcome === 'failed') {
        const diagnostic = step.diagnostic as AdapterExecutionDiagnostic;
        // A Reference Source is a Run-level Session Step: §E maps its failure after bounded
        // retries to RUN_FAILED, and `stopRun` adds the security event when the reason it
        // failed was a denial or a scope violation rather than an outage.
        await stopRun(diagnostic, 'RUN_FAILED', {
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
      // Before starting further Target System work, and after every unit that finished.
      if (await canceledAtBoundary()) return { retry: false };
      const spent = limitReached();
      if (spent !== null) {
        await stopForCause(spent, { workItemId: item.workItemId });
        return { retry: false };
      }
      const outcome = await runWorkItem(deps, {
        checkpoint, plan, run, entry, item, records, guarded, renewLease, budget,
        startStepExecution, attemptsPerCycle, limitReached, evidence, references, guard,
      });
      if (outcome === 'limit') {
        await stopForCause(limitReached() ?? 'run-time-limit', { workItemId: item.workItemId });
        return { retry: false };
      }
      // A denied action and a scope violation stop the RUN, whichever unit met them: §E.1
      // puts them above the Gate's rows and the owner's automatic second retry cycle covers
      // an exhausted budget, not a system that refused. Everything else that fails a Work
      // Item leaves the Run RUNNING — the next Work Item still executes and incomplete
      // coverage becomes INCONCLUSIVE at the Run-level Gate.
      if (outcome === 'denied') {
        await stopRun(item.diagnostic as AdapterExecutionDiagnostic, 'RUN_FAILED', {
          workItemId: item.workItemId,
          stepId: item.stepId,
          registrationId: item.registrationId,
        });
        return { retry: false };
      }
      if (outcome === 'lost') return { retry: false };
    }

    const completed = await guarded(async (context) => {
      const next = { ...checkpoint, status: 'EXTRACTION_COMPLETE' as const, diagnostic: null };
      await context.saveCheckpoint(next, 'RUNNING');
      await event(context, 'adapter-extraction-complete', 'RUNNING', next, {
        observations: items.reduce((total, item) => total + item.observations, 0),
      });
      // The last Work Item has completed, so the Run-level Gate runs — HERE, in this
      // transaction, over a context this stage already holds. There is no dependency to
      // inject and none to omit: `AdapterExecutionContext` extends `RunGateContext`, so a
      // Run cannot reach the end of its Work Items and skip §H.
      await runRunLevelGate(context, {
        run,
        plan,
        decidedAt: deps.clock.now().toISOString(),
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
      await completeRun(context, { run, state, at: deps.clock.now().toISOString(), plan });
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
  /** Which frozen Run-level limit is spent, or `null`. Checked before every attempt. */
  limitReached(): RunLimitCause | null;
  /** The Evidence rows as the claim read them, so a resumed attempt keeps its digest. */
  evidence: readonly AdapterEvidenceRecord[];
  /** The Run's frozen Reference Source bytes: filled by the Session Steps, read by the
   * evaluator. Mutable on purpose — every Reference Source is acquired before any Work
   * Item, so by the time a Work Item reads it the list is complete. */
  references: ReferenceArtifact[];
  /**
   * Every credential this stage has presented so far (Story 4.3).
   *
   * Fed by the wrapped resolver rather than by each Work Item remembering to add its own,
   * and handed to `freezeArtifact` so an artifact that discloses one is refused before
   * anything is uploaded. It grows as the stage goes: a Reference Source acquired before
   * any extraction is scanned against an empty guard, which is the truth — no credential
   * had been presented when those bytes were fetched.
   */
  guard: CredentialGuard;
}

/**
 * The Evidence record an attempt starts from.
 *
 * A resumed attempt inherits the digest and size a previous one registered, which is what
 * makes `freezeArtifact` compare the bytes it just fetched against what was already
 * frozen instead of quietly accepting different ones. A REGISTERED row is never
 * downgraded to RESERVED: it was registered, and saying otherwise would be a lie about
 * an artifact that exists.
 *
 * `scope` is the caller's, because the two units name their reservations differently: a
 * Reference Source by its frozen Session Step id, an adapter extraction by that id AND
 * the attempt (`adapterExtractionScope`), because a Work Item freezes a response before it
 * parses it and a later attempt therefore has different bytes to freeze.
 */
function evidenceFor(
  unit: UnitContext,
  priorEvidenceId: string | null,
  kind: AdapterEvidenceRecord['kind'],
  scope: string,
): AdapterEvidenceRecord {
  // NAMED, not minted (Story 3.5): the id and the object key are derived from the Run,
  // the kind and the scope, so an attempt that resumes after a crash reaches the
  // reservation it already has. A row an earlier build wrote wins, because its object
  // really is in the store under the id that row recorded.
  // A frozen step id that is not usable as an object-key segment is a CONTRACT failure,
  // not a transport one: the same bytes produce the same refusal, so retrying it against a
  // live system proves nothing. `reserveArtifact` throws its own error, which
  // `failureDiagnostic` would otherwise fall back to `-transport-failed` and retry.
  let reserved;
  try {
    reserved = reserveArtifact({
      runId: unit.run.runId,
      kind,
      scope,
      templateId: unit.plan.inputs.templateId,
    });
  } catch {
    throw new PopulationAcquisitionError('contract');
  }
  const evidenceId = priorEvidenceId ?? reserved.evidenceId;
  const prior = unit.evidence.find((row) => row.evidenceId === evidenceId);
  return adapterEvidenceRecord({ ...reserved, evidenceId }, unit.entry.target.registrationId, prior);
}

async function runReferenceStep(
  deps: AdapterExecutionDependencies,
  unit: UnitContext & { step: SessionStepRecord },
): Promise<'acquired' | 'failed' | 'lost' | 'limit'> {
  const { step, entry, checkpoint } = unit;
  // ONE bounded cycle. §E maps a Run-level Session Step's failure after bounded retries to
  // RUN_FAILED, so the owner's automatic second cycle — which exists to let a Run CONTINUE
  // past a failed unit — has nothing to buy here.
  const budgetAttempts = sessionStepAttemptBudget(unit.plan.limits);
  while (step.attempts < budgetAttempts) {
    if (unit.limitReached() !== null) return 'limit';
    step.attempts += 1;
    const execution = unit.startStepExecution(entry.stepId, null, 'extract-adapter', step.attempts);
    const evidence = evidenceFor(unit, step.evidenceId, 'reference-source', entry.stepId);
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
      const frozen = await freezeArtifact(
        deps.store,
        { objectKey: evidence.objectKey, registeredDigest: evidence.digest, registeredSize: evidence.size },
        artifact.bytes,
        unit.budget,
        unit.guard,
      );
      step.state = 'ACQUIRED';
      // Held for the evaluator: these are the bytes `freezeArtifact` just read back out of
      // the object store and proved identical to what was uploaded, so what the compiled
      // rules consult is what the freeze established rather than what was fetched.
      unit.references.push({ bytes: artifact.bytes, mediaType: artifact.mediaType });
      // `registerEvidence` is the ONE way a record becomes REGISTERED, so FR-31's capture
      // method and capture time are stamped by becoming registered rather than by a
      // producer remembering to set them.
      const registered = registerEvidence(evidence, frozen, {
        mediaType: artifact.mediaType,
        capturedAt: deps.clock.now().toISOString(),
        method: 'adapter',
      });
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
      const exhausted = step.attempts >= budgetAttempts || diagnostic !== 'reference-transport-failed';
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
): Promise<'observed' | 'failed' | 'lost' | 'limit' | 'denied'> {
  const { item, entry, checkpoint, plan } = unit;
  // The owner's 2026-09-05 decision: one automatic extra bounded retry cycle after the
  // first exhaustion, then FAILED. No human retry-or-skip Escalation on this path. BOTH
  // cycles obey the frozen per-Step retry limit — `adapterAttemptBudget` multiplies the
  // plan's own `retriesPerStep + 1` rather than restating a number — and every attempt
  // starts a Step Execution, so every attempt counts against the Run limits.
  const maxAttempts = adapterAttemptBudget(plan.limits);
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
    if (unit.limitReached() !== null) return 'limit';
    item.attempts += 1;
    // What the row said before this attempt. A failed attempt restores it: the count is
    // set optimistically before the commit that stores the Observations, and a commit
    // that rolls back would otherwise leave the Work Item reporting Observations that
    // are not there.
    const priorObservations = item.observations;
    const execution = unit.startStepExecution(entry.stepId, item.workItemId, 'extract-adapter', item.attempts);
    // THIS attempt's reservation, and never the previous one's.
    //
    // The number is durable before anything is uploaded: `item.attempts` was incremented
    // one line above and the `reserved` commit below persists it BEFORE `extract` is even
    // called, so a claim that resumes reads it back and starts the attempt after it — a
    // number this Run has never uploaded under. A crash between that commit and the
    // registration therefore leaves an object under a RESERVED row, which `SealPackage`
    // abandons at the terminal transition and names on the Result. That is the truthful
    // record: nothing committed ever verified those bytes. The alternative — reusing the
    // previous attempt's key — is the defect: the store would answer with the old object
    // and every retry would die accusing it of an integrity failure.
    //
    // `item.evidenceId` is deliberately NOT carried in as the prior id. It names the
    // previous attempt's row, and adopting it here would give that row this attempt's
    // object key: one Evidence row, silently repointed, and the earlier artifact lost.
    const evidence = evidenceFor(
      unit,
      null,
      'adapter-extraction',
      adapterExtractionScope(entry.stepId, item.attempts),
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
      frozen = await freezeArtifact(
        deps.store,
        { objectKey: evidence.objectKey, registeredDigest: evidence.digest, registeredSize: evidence.size },
        artifact.bytes,
        unit.budget,
        unit.guard,
      );
      evidence.mediaType = artifact.mediaType;
      evidence.digest = frozen.digest;
      evidence.size = frozen.size;
      const parsed = parseExtractionRows(artifact);
      // Story 3.6: corroboration against the STORED Structural Snapshot. The bytes are the
      // ones `freezeArtifact` just read back out of the object store and proved identical,
      // byte for byte, to what was uploaded — so re-reading them IS re-reading what was
      // frozen. There is deliberately no `corroboration` dependency to inject and none to
      // forget: the stage that froze the artifact is the stage that re-reads it, so no
      // composition root can register an adapter Observation as unjudged forever.
      const substrate = snapshotSubstrateForMediaType(artifact.mediaType);
      const corroboration = snapshotCorroboration(
        substrate === null
          ? []
          : [{ evidenceId: evidence.evidenceId, substrate, bytes: artifact.bytes }],
      );
      // Story 3.7: the version's already-compiled conditions, over the frozen plan, the
      // frozen included population and the Reference Source bytes this stage acquired.
      // Built HERE for the same reason the corroboration seam is — a composition root holds
      // none of the three, so a seam it supplied could only be `NO_EVALUATION`.
      const evaluation = ruleEvaluation({
        plan,
        records: unit.records,
        references: unit.references,
      });
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
      const registered = registerEvidence(evidence, frozen, {
        capturedAt: deps.clock.now().toISOString(),
        method: 'adapter',
      });
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
            templateId: plan.inputs.templateId,
            runStartedAt: checkpoint.runStartedAt,
            registeredAt: deps.clock.now().toISOString(),
            items: built.items,
          },
          { corroboration, evaluation, exceptions: deps.exceptions },
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
    // A denial, a scope violation, an unresolvable credential and a refused registration
    // are terminal for the ITEM whatever the budget says: the same request produces the
    // same answer, so spending seven more attempts on it proves nothing and spends the
    // Run's limits doing it. A denial is terminal for the RUN as well, which is the
    // caller's decision and not this loop's.
    const denied = stopCauseFor(diagnostic!) === 'action-denied' || stopCauseFor(diagnostic!) === 'scope-violation';
    const terminal =
      item.attempts >= maxAttempts ||
      denied ||
      diagnostic === 'credential-unresolved' ||
      diagnostic === 'extraction-credential-disclosed' ||
      diagnostic === 'observation-registration-refused';
    item.cycles = Math.min(2, Math.ceil(item.attempts / unit.attemptsPerCycle));
    item.state = terminal ? 'FAILED' : cycleExhausted ? 'AWAITING' : 'IN_PROGRESS';
    item.diagnostic = diagnostic;
    // Verified bytes stay REGISTERED even though the Work Item failed: they are what
    // the Target System actually answered. A reservation nothing was written to stays
    // RESERVED — it is still open, the Run is still running, and `SealPackage` is the
    // one thing that abandons it, at the terminal transition, where it can also be
    // listed on the Result. A unit that abandoned its own reservation would leave the
    // seal with nothing open to find and the Result with nothing to name.
    //
    // Read out here, not inside the callback: a `let` captured by a closure widens back to
    // its declared type, so the narrowing `frozen !== null` gives is lost in there.
    const partial =
      frozen === null
        ? null
        : registerEvidence(evidence, frozen, { capturedAt: deps.clock.now().toISOString(), method: 'adapter' });
    const committed = await unit.guarded(async (context) => {
      await context.saveWorkItem(item);
      await context.saveStepExecution({
        ...execution,
        state: 'FAILED',
        completedAt: deps.clock.now().toISOString(),
        diagnostic,
      });
      if (partial !== null) await context.saveEvidence(partial);
      await event(context, diagnostic!, 'RUNNING', checkpoint, {
        workItemId: item.workItemId,
        stepId: item.stepId,
        registrationId: item.registrationId,
        stepExecutionId: execution.stepExecutionId,
        attempt: item.attempts,
      }, 'failure');
    });
    if (!committed) return 'lost';
    if (denied) return 'denied';
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
