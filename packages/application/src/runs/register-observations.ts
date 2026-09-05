import {
  OBSERVATION_LIMITS,
  canBeCompliant,
  isObservationEvaluation,
  isObservationRecord,
  normalizeObservedAt,
  observationBatchDigest,
  observationChecks,
  observationCoverage,
  observationDigest,
  observationIdFor,
  type ObservationAbsenceProof,
  type ObservationAttribute,
  type ObservationCheckResult,
  type ObservationCoverage,
  type ObservationQueryKey,
  type ObservationRecord,
  type RunRecord,
} from '@intellifin/domain';
import type {
  ObservationCheckRow,
  ObservationCorroborationPort,
  ObservationEvaluationPort,
  ObservationEvaluationRow,
  ObservationRegistrationContext,
  RegisteredObservation,
} from './execution-ports.js';

/**
 * Observation registration (Story 3.4): the ONE transactional contract every producer
 * goes through.
 *
 * Story 3.3 produced Observations and wrote them on each Work Item's own terms. This is
 * what that write became. A batch commits in exactly one transaction — the rows, their
 * per-Observation check outcomes, their evaluations, the audit event and the Timeline
 * notification together or not at all — and the event carries every Observation's digest
 * over the RFC 8785 canonical JSON of the wire record, so a row edited before
 * finalization no longer agrees with what the chain recorded.
 *
 * Three properties are load-bearing and each is enforced here rather than assumed:
 *
 * **Atomicity.** Every write goes through the caller's `ObservationRegistrationContext`,
 * which is bound to one transaction. A refusal is THROWN, never returned: a refusal
 * returned from inside a unit of work commits everything written before it (Stories
 * 1.5-1.7), and "this batch did not happen" has to be said to PostgreSQL as well as to
 * the caller.
 *
 * **Idempotency.** `observationId` is DERIVED from `(workItemId, populationRecordKey)`,
 * not minted, so a redelivered batch produces byte-identical records. Registration reads
 * what is already stored, finds every digest equal and writes nothing at all — no row, no
 * check, no evaluation, no event, no notification. A minted id would make a redelivery
 * indistinguishable from tampering.
 *
 * **Honest absence.** `found = false` is a finding only with an Adapter-Action-derived
 * query key for EVERY declared search key, an empty response actually stored as
 * REGISTERED Evidence, and an extraction that actually completed. Any one missing and
 * the record's coverage is `UNINSPECTED`, which the `run_observation_evaluation` foreign
 * key makes it impossible to call Compliant.
 *
 * Corroboration (Story 3.6) and evaluation (Story 3.7) are called through their ports and
 * are not inlined here. Corroboration runs BEFORE the digest, because B.1 sets
 * corroboration at registration and a value written afterwards would leave every row
 * disagreeing with its own digest.
 */

/** Why a batch was refused. A closed vocabulary; never a value and never a message. */
export type ObservationRegistrationRefusal =
  | 'batch-limit'
  | 'wire-schema'
  | 'batch-mismatch'
  | 'duplicate-record-key'
  | 'observation-identity'
  | 'capture-time'
  | 'absence-proof-shape'
  | 'corroboration-shape'
  | 'evaluation-shape'
  | 'coverage-conflict'
  | 'digest-mismatch'
  | 'observation-integrity';

export class ObservationRegistrationError extends Error {
  override readonly name = 'ObservationRegistrationError';
  readonly refusal: ObservationRegistrationRefusal;

  constructor(refusal: ObservationRegistrationRefusal) {
    super(`Observation registration refused: ${refusal}`);
    this.refusal = refusal;
  }
}

/** One Observation offered for registration, with everything needed to judge it. */
export interface ObservationBatchItem {
  readonly record: ObservationRecord;
  /** The capture time exactly as the source presented it: UTC, or offset-bearing. */
  readonly observedAtSource: string;
  /** Present only for `found = false`; a proof on any other record is refused. */
  readonly absence: ObservationAbsenceProof | null;
  /** The declared search keys with THIS population record's normalized value for each. */
  readonly expectedQueryKeys: readonly ObservationQueryKey[];
}

export interface ObservationBatch {
  readonly run: RunRecord;
  readonly workItemId: string;
  readonly stepExecutionId: string;
  /** The Target System registration id every Observation in the batch names. */
  readonly targetSystem: string;
  /** The Run's own start, from the durable checkpoint. Freshness is judged against it. */
  readonly runStartedAt: string;
  /** The instant this registration is happening. */
  readonly registeredAt: string;
  readonly items: readonly ObservationBatchItem[];
}

export interface ObservationRegistrationSeams {
  readonly corroboration: ObservationCorroborationPort;
  readonly evaluation: ObservationEvaluationPort;
}

export interface ObservationRegistrationOutcome {
  /** Observations written by THIS call. */
  readonly registered: number;
  /** Observations already present with a matching digest. A redelivery reports these. */
  readonly alreadyRegistered: number;
  /** Per-Observation check outcomes written by this call. */
  readonly checks: number;
  /** Per-condition evaluations written by this call. */
  readonly evaluations: number;
  /** The digests carried by the event, in registration order. Empty when nothing moved. */
  readonly digests: readonly string[];
  /** One digest over that ordered list, or `null` when nothing was registered. */
  readonly batchDigest: string | null;
  readonly coverage: Readonly<Record<ObservationCoverage, number>>;
  /** Failing per-Observation checks, by check name. What Story 3.8's Gate reads. */
  readonly failedChecks: Readonly<Record<string, number>>;
}

function refuse(refusal: ObservationRegistrationRefusal): never {
  throw new ObservationRegistrationError(refusal);
}

/** Re-key one attribute's corroboration without touching anything else it carries. */
function withCorroboration(
  attribute: ObservationAttribute,
  verdicts: ReadonlyMap<string, ObservationAttribute['corroboration']>,
): ObservationAttribute {
  if (!verdicts.has(attribute.name)) return attribute;
  return {
    name: attribute.name,
    originalValue: attribute.originalValue,
    normalizedValue: attribute.normalizedValue,
    grounding: attribute.grounding,
    corroboration: verdicts.get(attribute.name) ?? null,
  };
}

const NO_COVERAGE: Readonly<Record<ObservationCoverage, number>> = {
  COVERED: 0,
  UNINSPECTED: 0,
  AMBIGUOUS: 0,
};

/**
 * Register one batch of Observations inside the caller's transaction.
 *
 * Returns what it wrote. Throws `ObservationRegistrationError` — which rolls the caller's
 * transaction back — for anything a batch may not contain.
 */
export async function registerObservations(
  context: ObservationRegistrationContext,
  batch: ObservationBatch,
  seams: ObservationRegistrationSeams,
): Promise<ObservationRegistrationOutcome> {
  const empty: ObservationRegistrationOutcome = {
    registered: 0,
    alreadyRegistered: 0,
    checks: 0,
    evaluations: 0,
    digests: [],
    batchDigest: null,
    coverage: NO_COVERAGE,
    failedChecks: {},
  };
  if (batch.items.length === 0) return empty;
  if (batch.items.length > OBSERVATION_LIMITS.batch) refuse('batch-limit');

  // ------------------------------------------------------------------ validation
  // The whole B.1 wire schema on every Observation whatever produced it, under its
  // explicit `schemaVersion`, before the transaction writes anything.
  const keys = new Set<string>();
  for (const item of batch.items) {
    const record = item.record;
    if (!isObservationRecord(record)) refuse('wire-schema');
    if (
      record.workItemId !== batch.workItemId ||
      record.stepExecutionId !== batch.stepExecutionId ||
      record.targetSystem !== batch.targetSystem
    ) {
      refuse('batch-mismatch');
    }
    if (keys.has(record.populationRecordKey)) refuse('duplicate-record-key');
    keys.add(record.populationRecordKey);
    // The identity is a NAME, not a mint: a redelivery must produce the same one or the
    // row that survives and the batch that describes it are two different things.
    if (record.observationId !== observationIdFor(record.workItemId, record.populationRecordKey)) {
      refuse('observation-identity');
    }
    // B: normalized to UTC with the original retained. The instant is provably the same
    // one, so a capture time carrying a source offset is never silently shifted.
    const normalized = normalizeObservedAt(item.observedAtSource);
    if (normalized === null || normalized.observedAt !== record.observedAt) refuse('capture-time');
    if (item.absence !== null && record.found !== 'false') refuse('absence-proof-shape');
  }

  // ----------------------------------------------------- Evidence, then corroboration
  const linked = [...new Set(batch.items.flatMap((item) => [...item.record.evidenceIds]))];
  const states = await context.readEvidenceStates(linked);
  const registeredEvidenceIds = states
    .filter((row) => row.state === 'REGISTERED')
    .map((row) => row.evidenceId);

  const verdicts = await seams.corroboration.corroborate(batch.items.map((item) => item.record));
  const byObservation = new Map(verdicts.map((verdict) => [verdict.observationId, verdict]));
  if (byObservation.size !== verdicts.length) refuse('corroboration-shape');
  for (const verdict of verdicts) {
    if (!batch.items.some((item) => item.record.observationId === verdict.observationId)) {
      refuse('corroboration-shape');
    }
  }

  interface Judged {
    readonly record: ObservationRecord;
    readonly item: ObservationBatchItem;
    readonly digest: string;
    readonly coverage: ObservationCoverage;
    readonly checks: readonly ObservationCheckResult[];
  }
  const judged: Judged[] = batch.items.map((item) => {
    const verdict = byObservation.get(item.record.observationId);
    const applied = new Map(
      (verdict?.attributes ?? []).map((entry) => [entry.name, entry.corroboration] as const),
    );
    const record: ObservationRecord =
      applied.size === 0
        ? item.record
        : {
            ...item.record,
            identity:
              item.record.identity === null ? null : withCorroboration(item.record.identity, applied),
            attributes: item.record.attributes.map((attribute) =>
              withCorroboration(attribute, applied),
            ),
          };
    // A corroborator that produced a record outside the schema must not be stored.
    if (!isObservationRecord(record)) refuse('corroboration-shape');
    const coverage = observationCoverage({
      record,
      absence: item.absence,
      expectedQueryKeys: item.expectedQueryKeys,
      registeredEvidenceIds,
    });
    const checks: ObservationCheckResult[] = [
      ...observationChecks({
        record,
        absence: item.absence,
        expectedQueryKeys: item.expectedQueryKeys,
        registeredEvidenceIds,
        runStartedAt: batch.runStartedAt,
        registeredAt: batch.registeredAt,
      }),
    ];
    if (verdict !== undefined) {
      // A PASS never carries a diagnostic and a FAIL always does, in the domain and in
      // the `run_observation_check` CHECK alike: a passing check with a reason attached
      // reads as a finding to everything downstream, and a failing one with none is a
      // finding nobody can act on.
      checks.push({
        check: 'observation-corroboration',
        outcome: verdict.outcome,
        diagnostic:
          verdict.outcome === 'PASS'
            ? null
            : ((verdict.diagnostic ?? 'corroboration-contradictory') as ObservationCheckResult['diagnostic']),
      });
    }
    return { record, item, digest: observationDigest(record), coverage, checks };
  });

  // -------------------------------------------------------- idempotency and integrity
  const stored = await context.readObservations(batch.workItemId, [...keys]);
  const storedByKey = new Map(stored.map((row) => [row.populationRecordKey, row]));
  const fresh: Judged[] = [];
  let alreadyRegistered = 0;
  for (const entry of judged) {
    const existing = storedByKey.get(entry.record.populationRecordKey);
    if (existing === undefined) {
      fresh.push(entry);
      continue;
    }
    // Two different questions, and both need asking.
    //
    // First: does the STORED row still agree with the digest stored beside it? An edit to
    // a row does not touch its digest column, so comparing a fresh batch against that
    // column alone would find them in agreement and see nothing. Recomputing the digest
    // from the row as it is now is the detection.
    if (!isObservationRecord(existing.record) || observationDigest(existing.record) !== existing.digest) {
      refuse('observation-integrity');
    }
    // Second: is the row this batch describes the SAME Observation? `run_observation` is
    // unique on (work item, record key), so a genuinely different capture for that pair
    // cannot be stored at all; saying so is better than dropping it silently.
    if (existing.digest !== entry.digest) refuse('digest-mismatch');
    alreadyRegistered += 1;
  }
  if (fresh.length === 0) return { ...empty, alreadyRegistered };

  // ------------------------------------------------------------------- evaluation
  const results = await seams.evaluation.evaluate(
    fresh.map((entry) => ({ record: entry.record, coverage: entry.coverage, checks: entry.checks })),
  );
  const coverageOf = new Map(fresh.map((entry) => [entry.record.observationId, entry.coverage]));
  const evaluationRows: ObservationEvaluationRow[] = [];
  const seenEvaluations = new Set<string>();
  for (const result of results) {
    const coverage = coverageOf.get(result.observationId);
    if (coverage === undefined) refuse('evaluation-shape');
    for (const evaluation of result.evaluations) {
      if (!isObservationEvaluation(evaluation)) refuse('evaluation-shape');
      const key = `${result.observationId} ${evaluation.conditionId}`;
      if (seenEvaluations.has(key)) refuse('evaluation-shape');
      seenEvaluations.add(key);
      // H: an uninspected or ambiguous record is never Compliant. The database says so
      // too, through the composite foreign key; refusing here names the defect instead of
      // answering the caller with a constraint violation.
      if (evaluation.value === 'COMPLIANT' && !canBeCompliant(coverage)) refuse('coverage-conflict');
      evaluationRows.push({ observationId: result.observationId, coverage, evaluation });
    }
  }

  // ------------------------------------------------------------------------ write
  const rows: RegisteredObservation[] = fresh.map((entry) => ({
    record: entry.record,
    digest: entry.digest,
    coverage: entry.coverage,
    observedAtSource: entry.item.observedAtSource,
  }));
  const checkRows: ObservationCheckRow[] = fresh.flatMap((entry) =>
    entry.checks.map((check) => ({
      observationId: entry.record.observationId,
      check: check.check,
      outcome: check.outcome,
      diagnostic: check.diagnostic,
    })),
  );
  await context.saveObservations(rows);
  await context.saveObservationChecks(checkRows);
  await context.saveObservationEvaluations(evaluationRows);

  const digests = fresh.map((entry) => entry.digest);
  const coverage: Record<ObservationCoverage, number> = { COVERED: 0, UNINSPECTED: 0, AMBIGUOUS: 0 };
  for (const entry of fresh) coverage[entry.coverage] += 1;
  const failedChecks: Record<string, number> = {};
  for (const row of checkRows) {
    if (row.outcome === 'FAIL') failedChecks[row.check] = (failedChecks[row.check] ?? 0) + 1;
  }
  const batchDigest = observationBatchDigest(digests);

  const event = await context.auditEvents.append({
    actor: { type: 'system', id: 'observation-registrar' },
    eventType: 'execution.observations-registered',
    source: 'worker',
    outcome: 'success',
    aggregateId: batch.run.runId,
    correlationId: batch.run.correlationId,
    sessionId: batch.run.sessionId,
    payload: {
      workItemId: batch.workItemId,
      stepExecutionId: batch.stepExecutionId,
      registrationId: batch.targetSystem,
      schemaVersion: rows[0]!.record.schemaVersion,
      registered: rows.length,
      alreadyRegistered,
      // Every Observation's digest, in registration order, and one digest over that
      // ordered list. The per-row digest detects an edit to a row; the batch digest
      // detects an edit to a stored digest, a removed row or a reordered batch, none of
      // which a per-row digest can see because each row would still agree with itself.
      digests,
      batchDigest,
      coverage,
      failedChecks,
      evaluations: evaluationRows.length,
    },
  });
  await context.notifyTimeline(event.sequence);

  return {
    registered: rows.length,
    alreadyRegistered,
    checks: checkRows.length,
    evaluations: evaluationRows.length,
    digests,
    batchDigest,
    coverage,
    failedChecks,
  };
}
