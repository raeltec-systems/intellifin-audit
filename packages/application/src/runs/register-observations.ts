import {
  CONDITION_NOT_APPLICABLE,
  MISSING_OBSERVATION_FIELD,
  OBSERVATION_LIMITS,
  canBeCompliant,
  canonicalJson,
  sha256Hex,
  isObservationAbsenceProof,
  isObservationQueryKey,
  corroborationAllowsCompliant,
  exceptionIdFor,
  isObservationEvaluation,
  isRaisedException,
  isObservationRecord,
  hasIdentityGroundingSplit,
  normalizeObservedAt,
  observationBatchDigest,
  observationChecks,
  observationCorroborationState,
  observationCoverage,
  observationDigest,
  observationIdFor,
  templateCoverageRule,
  type EvidenceRequirement,
  type ObservationAbsenceProof,
  type ObservationAttribute,
  type ObservationCheckResult,
  type ObservationCorroboration,
  type ObservationCorroborationState,
  type ObservationCoverage,
  type ObservationQueryKey,
  type ObservationRecord,
  type RaisedException,
  type RunRecord,
} from '@intellifin/domain';
import {
  agentProposalKey,
  isAgentJudgedProposal,
  type AgentJudgedEvaluationRow,
  type AgentJudgedProposal,
  type AgentProposalEvaluationPort,
} from './agent-evaluation.js';
import type {
  ExceptionFingerprinter,
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
  | 'corroboration-conflict'
  | 'exception-shape'
  | 'digest-mismatch'
  | 'observation-integrity'
  | 'identity-grounding-split';

export class ObservationRegistrationError extends Error {
  override readonly name = 'ObservationRegistrationError';
  readonly refusal: ObservationRegistrationRefusal;

  constructor(refusal: ObservationRegistrationRefusal) {
    super(`Observation registration refused: ${refusal}`);
    this.refusal = refusal;
  }
}

/** Hash adjacent absence provenance without changing the frozen Observation wire schema. */
export function observationAbsenceDigest(
  observationId: string,
  proof: ObservationAbsenceProof | null,
  expectedQueryKeys: readonly ObservationQueryKey[],
): string {
  return sha256Hex(canonicalJson({
    schemaVersion: 1, observationId,
    proof: proof === null ? null : {
      queryKeys: proof.queryKeys.map(({ key, value }) => ({ key, value })),
      emptyResultEvidenceId: proof.emptyResultEvidenceId,
      extractionComplete: proof.extractionComplete,
    },
    expectedQueryKeys: expectedQueryKeys.map(({ key, value }) => ({ key, value })),
  }));
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
  /** Exact frozen requirements, mandatory for every agent capture producer. */
  readonly evidenceRequirements?: readonly EvidenceRequirement[];
  readonly run: RunRecord;
  readonly workItemId: string;
  readonly stepExecutionId: string;
  /** The Target System registration id every Observation in the batch names. */
  readonly targetSystem: string;
  /**
   * The FROZEN Template of the Procedure Version this Run executes.
   *
   * Part of an Exception's fingerprint, so a finding is identified by the control it
   * failed and not only by the record it is about. Taken from the frozen plan, never from
   * a current Procedure.
   */
  readonly templateId: string;
  /** The Run's own start, from the durable checkpoint. Freshness is judged against it. */
  readonly runStartedAt: string;
  /** The instant this registration is happening. */
  readonly registeredAt: string;
  readonly items: readonly ObservationBatchItem[];
  /**
   * Optional, already-selected Agent proposals for this batch. Legacy adapter callers omit
   * this field and continue through the ordinary deterministic evaluation port.
   */
  readonly agentProposals?: readonly AgentJudgedProposal[];
  /**
   * Optional frozen condition-id set. When present, every evaluation result must cover it
   * exactly once per fresh Observation; this catches missing/extra applicable conditions
   * before any registration write.
   */
  readonly expectedConditionIds?: readonly string[];
  /** Optional frozen subset whose conditions are Agent-Judged rather than Rule-Classified. */
  readonly expectedAgentConditionIds?: readonly string[];
}

export interface ObservationRegistrationSeams {
  readonly corroboration: ObservationCorroborationPort;
  readonly evaluation: ObservationEvaluationPort;
  /** Agent-aware evaluator used only when `batch.agentProposals` is supplied. */
  readonly agentEvaluation?: AgentProposalEvaluationPort;
  /**
   * Story 3.7. Required, not optional: an Exception with no fingerprint is a permanent row
   * nothing can later be checked against, and a seam a composition root could omit would
   * produce one silently.
   */
  readonly exceptions: ExceptionFingerprinter;
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
  /** Exceptions raised by this call. One per Observation with an `EXCEPTION` evaluation. */
  readonly exceptions: number;
  /** The digests carried by the event, in registration order. Empty when nothing moved. */
  readonly digests: readonly string[];
  /** One digest over that ordered list, or `null` when nothing was registered. */
  readonly batchDigest: string | null;
  readonly coverage: Readonly<Record<ObservationCoverage, number>>;
  /** The Story 3.6 corroboration rollup, tallied the way coverage is. */
  readonly corroboration: Readonly<Record<ObservationCorroborationState, number>>;
  /** Failing per-Observation checks, by check name. What Story 3.8's Gate reads. */
  readonly failedChecks: Readonly<Record<string, number>>;
}

function refuse(refusal: ObservationRegistrationRefusal): never {
  throw new ObservationRegistrationError(refusal);
}

function validConditionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= OBSERVATION_LIMITS.text;
}

/** Set one attribute's corroboration without touching anything else it carries. */
function withCorroboration(
  attribute: ObservationAttribute,
  verdict: ObservationCorroboration | null | undefined,
): ObservationAttribute {
  if (verdict === undefined) return attribute;
  return {
    name: attribute.name,
    originalValue: attribute.originalValue,
    normalizedValue: attribute.normalizedValue,
    grounding: attribute.grounding,
    corroboration: verdict,
  };
}

const NO_COVERAGE: Readonly<Record<ObservationCoverage, number>> = {
  COVERED: 0,
  UNINSPECTED: 0,
  AMBIGUOUS: 0,
};

const NO_CORROBORATION_TALLY: Readonly<Record<ObservationCorroborationState, number>> = {
  MATCHED: 0,
  CONTRADICTORY: 0,
  UNJUDGED: 0,
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
    exceptions: 0,
    digests: [],
    batchDigest: null,
    coverage: NO_COVERAGE,
    corroboration: NO_CORROBORATION_TALLY,
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
    // The identity is the dedicated B.1 slot (selected from the frozen plan's lookup
    // column), while every entry in `attributes` is a declared value. They all must come
    // from one Structural Snapshot. Refuse before reading Evidence or calling a seam so
    // this is an atomic batch refusal with no observable registration side effect.
    if (hasIdentityGroundingSplit(record)) refuse('identity-grounding-split');
  }

  // Agent proposals are optional so the existing adapter registration contract remains
  // source-compatible. Once a batch supplies them, however, they are a strict wire shape:
  // every tuple names one offered Observation and one frozen condition, and a tuple can
  // occur only once. Validate the complete set before reading Evidence or calling either
  // evaluation seam; a malformed model response therefore cannot leave partial work in a
  // caller transaction.
  const agentProposals = batch.agentProposals;
  const expectedConditionIds = batch.expectedConditionIds;
  const expectedAgentConditionIds = batch.expectedAgentConditionIds;
  const expectedConditionSet = expectedConditionIds === undefined
    ? null
    : new Set<string>();
  const expectedAgentConditionSet = expectedAgentConditionIds === undefined
    ? null
    : new Set<string>();
  if (expectedConditionIds !== undefined) {
    if (!Array.isArray(expectedConditionIds)) refuse('evaluation-shape');
    for (const conditionId of expectedConditionIds) {
      if (!validConditionId(conditionId) || expectedConditionSet!.has(conditionId)) {
        refuse('evaluation-shape');
      }
      expectedConditionSet!.add(conditionId);
    }
  }
  if (expectedAgentConditionIds !== undefined) {
    if (!Array.isArray(expectedAgentConditionIds)) refuse('evaluation-shape');
    for (const conditionId of expectedAgentConditionIds) {
      if (
        !validConditionId(conditionId) ||
        expectedAgentConditionSet!.has(conditionId) ||
        expectedConditionSet !== null && !expectedConditionSet.has(conditionId)
      ) {
        refuse('evaluation-shape');
      }
      expectedAgentConditionSet!.add(conditionId);
    }
  }
  if (
    agentProposals !== undefined &&
    (expectedConditionSet === null || expectedAgentConditionSet === null)
  ) {
    // A proposal-bearing batch must identify the complete frozen condition set and its
    // Agent-Judged subset; otherwise registration could not distinguish a missing applicable
    // answer or a model attempt to reclassify a Rule.
    refuse('evaluation-shape');
  }
  if (agentProposals !== undefined) {
    if (!Array.isArray(agentProposals)) refuse('evaluation-shape');
    const observationIds = new Set(batch.items.map((item) => item.record.observationId));
    const seenProposals = new Set<string>();
    for (const proposal of agentProposals) {
      if (!isAgentJudgedProposal(proposal)) refuse('evaluation-shape');
      if (!observationIds.has(proposal.observationId)) refuse('evaluation-shape');
      if (expectedConditionSet !== null && !expectedConditionSet.has(proposal.conditionId)) {
        refuse('evaluation-shape');
      }
      if (expectedAgentConditionSet !== null && !expectedAgentConditionSet.has(proposal.conditionId)) {
        refuse('evaluation-shape');
      }
      const key = agentProposalKey(proposal.observationId, proposal.conditionId);
      if (seenProposals.has(key)) refuse('evaluation-shape');
      seenProposals.add(key);
    }
  }

  // ----------------------------------------------------- Evidence, then corroboration
  if (batch.items.some(item => item.record.captureMethod === 'agent') && batch.evidenceRequirements === undefined) refuse('batch-mismatch');
  const linked = [...new Set(batch.items.flatMap((item) => [...item.record.evidenceIds]))];
  const states = await context.readEvidenceStates(linked);
  const registeredEvidenceIds = states
    .filter((row) => row.state === 'REGISTERED')
    .map((row) => row.evidenceId);

  // §H reads per-record coverage "per the Template's coverage rule (§C)", and the four
  // rules differ: P-2 requires every population account to APPEAR in the extraction, so a
  // proven absence there is a gap rather than the Compliant finding it is under P-3. Taken
  // from the batch's FROZEN Template id, never from a current Procedure.
  const coverageRule = templateCoverageRule(batch.templateId);

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
    readonly corroboration: ObservationCorroborationState;
    readonly checks: readonly ObservationCheckResult[];
  }
  const judged: Judged[] = batch.items.map((item) => {
    const verdict = byObservation.get(item.record.observationId);
    // Keyed by name for the declared attributes, whose names are unique by schema, and
    // taken from its OWN slot for the identity: §B.1 lets a declared attribute share the
    // identity's name, and one map for both would give one of them the other's verdict.
    const applied = new Map(
      (verdict?.attributes ?? []).map((entry) => [entry.name, entry.corroboration] as const),
    );
    const record: ObservationRecord =
      verdict === undefined
        ? item.record
        : {
            ...item.record,
            identity:
              item.record.identity === null
                ? null
                : withCorroboration(item.record.identity, verdict.identity),
            attributes: item.record.attributes.map((attribute) =>
              withCorroboration(
                attribute,
                applied.has(attribute.name) ? applied.get(attribute.name) : undefined,
              ),
            ),
          };
    // A corroborator that produced a record outside the schema must not be stored.
    if (!isObservationRecord(record)) refuse('corroboration-shape');
    const coverage = observationCoverage({
      record,
      absence: item.absence,
      expectedQueryKeys: item.expectedQueryKeys,
      registeredEvidenceIds,
      coverageRule,
    });
    const primaryCaptureId = record.identity?.grounding?.evidenceId ?? item.absence?.emptyResultEvidenceId ?? record.evidenceIds.find(id => states.some(row => row.evidenceId === id && row.kind === 'structural-snapshot'));
    const primaryCapture = states.find(row => row.evidenceId === primaryCaptureId && row.kind === 'structural-snapshot' && row.state === 'REGISTERED' && row.registrationId === batch.targetSystem);
    const registeredCaptureKinds = primaryCapture?.toolActionId && primaryCapture.stepExecutionId
      ? states.filter(row => row.state === 'REGISTERED' && record.evidenceIds.includes(row.evidenceId) && row.registrationId === batch.targetSystem && row.stepExecutionId === primaryCapture.stepExecutionId && row.toolActionId === primaryCapture.toolActionId && (row.kind === 'structural-snapshot' || row.kind === 'screenshot')).map(row => row.kind as 'structural-snapshot' | 'screenshot') : [];
    const checks: ObservationCheckResult[] = [
      ...observationChecks({
        record,
        absence: item.absence,
        expectedQueryKeys: item.expectedQueryKeys,
        registeredEvidenceIds,
        // Agent fields are always platform-captured; authored requirements can add to,
        // but cannot remove, their structural snapshot and screenshot baseline.
        requiredCaptureKinds: record.captureMethod === 'agent' ? ['structural-snapshot', 'screenshot'] : [],
        registeredCaptureKinds,
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
        diagnostic: verdict.outcome === 'PASS' ? null : (verdict.diagnostic ?? 'corroboration-contradictory'),
      });
    }
    return {
      record,
      item,
      digest: observationDigest(record),
      coverage,
      // Derived from the record AS IT IS BEING STORED, after corroboration has been
      // applied and from the same object the digest is taken over. Generation 22 pins the
      // same derivation as a CHECK, so the column can never disagree with the attributes.
      corroboration: observationCorroborationState(record),
      checks,
    };
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
    // Three different questions, and all three need asking.
    //
    // First: does the STORED row still agree with the digest stored beside it? An edit to
    // a row does not touch its digest column, so comparing a fresh batch against that
    // column alone would find them in agreement and see nothing. Recomputing the digest
    // from the row as it is now is the detection.
    if (!isObservationRecord(existing.record) || observationDigest(existing.record) !== existing.digest) {
      refuse('observation-integrity');
    }
    // Second: does §B's retained capture time still agree with the instant the digest DOES
    // cover? `observed_at_source` is deliberately outside the hashed envelope — that
    // envelope is addendum §B.1's thirteen keys, pinned by an independently produced
    // vector, and moving it is a contract change rather than a repair — so nothing above
    // can see an edit to it. Re-deriving is what makes it tamper-evident: the source has
    // to normalize to the row's own `observedAt`. `normalizeObservedAt`, never
    // `Date.parse`, which ROLLS OVER an impossible calendar date instead of refusing it.
    if (normalizeObservedAt(existing.observedAtSource)?.observedAt !== existing.record.observedAt) {
      refuse('observation-integrity');
    }
    // Third: is the row this batch describes the SAME Observation? `run_observation` is
    // unique on (work item, record key), so a genuinely different capture for that pair
    // cannot be stored at all; saying so is better than dropping it silently.
    if (existing.digest !== entry.digest) refuse('digest-mismatch');
    if (existing.absence !== undefined) {
      const metadata = existing.absence;
      if (existing.record.found !== 'false' || !Array.isArray(metadata.expectedQueryKeys) || !metadata.expectedQueryKeys.every(isObservationQueryKey) ||
          (metadata.proof !== null && !isObservationAbsenceProof(metadata.proof)) ||
          observationAbsenceDigest(existing.observationId, metadata.proof, metadata.expectedQueryKeys) !== metadata.digest) {
        refuse('observation-integrity');
      }
      const offeredProof = isObservationAbsenceProof(entry.item.absence) ? entry.item.absence : null;
      if (observationAbsenceDigest(entry.record.observationId, offeredProof, entry.item.expectedQueryKeys) !== metadata.digest) {
        refuse('digest-mismatch');
      }
    }
    // A historical row without adjacent metadata remains historical. Redelivery must not
    // claim today's offered proof was preserved when the original Observation was captured.
    alreadyRegistered += 1;
  }
  if (fresh.length === 0) return { ...empty, alreadyRegistered };

  // ------------------------------------------------------------------- evaluation
  const subjects = fresh.map((entry) => ({
    record: entry.record,
    coverage: entry.coverage,
    corroboration: entry.corroboration,
    checks: entry.checks,
  }));
  const results = agentProposals === undefined
    ? await seams.evaluation.evaluate(subjects)
    : seams.agentEvaluation === undefined
      ? refuse('evaluation-shape')
      : await seams.agentEvaluation.evaluateWithAgentProposals(subjects, agentProposals);
  // ONE result per Observation offered, and the port says so by answering about all of
  // them. A port that answers about fewer leaves the rest with no evaluation row at all,
  // which is indistinguishable downstream from a frozen plan whose Compliance Rule this
  // build cannot recompile — the Run-level Gate's condition-completeness row would report
  // both as `condition-evaluation-missing` and nothing would say which happened. "Nothing
  // judged this" is said by returning a result with NO evaluations, not by omitting it.
  if (!Array.isArray(results)) refuse('evaluation-shape');
  if (
    !results.every(
      (result) =>
        typeof result === 'object' &&
        result !== null &&
        !Array.isArray(result) &&
        typeof result.observationId === 'string' &&
        Array.isArray(result.evaluations),
    )
  ) {
    refuse('evaluation-shape');
  }
  const answered = new Set(results.map((result) => result.observationId));
  if (results.length !== fresh.length || answered.size !== results.length) refuse('evaluation-shape');
  const judgedOf = new Map(
    fresh.map((entry) => [entry.record.observationId, entry] as const),
  );
  const proposalsByKey = new Map<string, AgentJudgedProposal>();
  for (const proposal of agentProposals ?? []) {
    proposalsByKey.set(agentProposalKey(proposal.observationId, proposal.conditionId), proposal);
  }
  const evaluationRows: (ObservationEvaluationRow | AgentJudgedEvaluationRow)[] = [];
  const seenEvaluations = new Set<string>();
  const exceptions: RaisedException[] = [];
  const seenExceptions = new Set<string>();
  for (const result of results) {
    const entry = judgedOf.get(result.observationId);
    if (entry === undefined) refuse('evaluation-shape');
    if (expectedConditionSet !== null) {
      const resultConditionIds = new Set<string>();
      for (const evaluation of result.evaluations) {
        if (!isObservationEvaluation(evaluation)) refuse('evaluation-shape');
        resultConditionIds.add(evaluation.conditionId);
      }
      if (
        resultConditionIds.size !== expectedConditionSet.size ||
        [...expectedConditionSet].some((conditionId) => !resultConditionIds.has(conditionId))
      ) {
        refuse('evaluation-shape');
      }
    }
    // §B's reduction puts Exception first, so the FIRST `EXCEPTION` recorded for a record
    // is what raises its Exception; the conditions that produced it are all of them, in
    // the version's frozen order, with every reason the rules gave.
    const raising: string[] = [];
    const diagnostics: string[] = [];
    for (const evaluation of result.evaluations) {
      if (!isObservationEvaluation(evaluation)) refuse('evaluation-shape');
      const key = `${result.observationId} ${evaluation.conditionId}`;
      if (seenEvaluations.has(key)) refuse('evaluation-shape');
      seenEvaluations.add(key);
      const proposal = proposalsByKey.get(agentProposalKey(result.observationId, evaluation.conditionId));
      const notApplicable = evaluation.diagnostic
        ?.split('; ')
        .includes(CONDITION_NOT_APPLICABLE) ?? false;
      const applicabilityUnknown = evaluation.diagnostic
        ?.split('; ')
        .some((diagnostic) => diagnostic.startsWith(MISSING_OBSERVATION_FIELD)) ?? false;
      if (
        expectedAgentConditionSet !== null &&
        (expectedAgentConditionSet.has(evaluation.conditionId)
          ? evaluation.origin !== 'AGENT_JUDGED'
          : evaluation.origin !== 'RULE')
      ) {
        refuse('evaluation-shape');
      }
      if (evaluation.origin === 'AGENT_JUDGED') {
        // An Agent may only submit a fresh pending judgment (or a below-threshold
        // UNEVALUATED one). Confirmed/rejected states are human review history and cannot be
        // smuggled through the registration path.
        if (evaluation.confirmation !== null && evaluation.confirmation !== 'pending') {
          refuse('evaluation-shape');
        }
        if (notApplicable) {
          // Applicability is deterministic. A proposal for a condition that does not apply
          // is an extra model answer, even if its value happens to be well-formed.
          if (proposal !== undefined) refuse('evaluation-shape');
        } else if (applicabilityUnknown) {
          // A null applicability is not a false predicate. The compiler reports it with its
          // missing-field diagnostic and the only honest stored result is UNEVALUATED. No
          // model proposal may fill in a predicate the frozen compiler could not decide,
          // and a faulty port may not turn that unknown into COMPLIANT or EXCEPTION.
          if (
            proposal !== undefined ||
            evaluation.value !== 'UNEVALUATED' ||
            evaluation.confirmation !== null ||
            evaluation.confidence !== null ||
            evaluation.rationale !== null
          ) {
            refuse('evaluation-shape');
          }
        } else {
          // Every applicable Agent-Judged condition needs one corresponding proposal. This
          // catches a missing C2 answer before any Observation/evaluation/Exception write.
          if (proposal === undefined) refuse('evaluation-shape');
          if (
            evaluation.confidence === null ||
            evaluation.rationale === null ||
            evaluation.confidence !== proposal.confidence ||
            evaluation.rationale !== proposal.rationale ||
            (evaluation.value !== proposal.value && evaluation.value !== 'UNEVALUATED')
          ) {
            refuse('evaluation-shape');
          }
        }
      } else if (proposal !== undefined) {
        // A proposal may never reclassify a frozen Rule or a later HUMAN row.
        refuse('evaluation-shape');
      }
      // H: an uninspected or ambiguous record is never Compliant, and neither is one the
      // stored Structural Snapshot contradicts (Story 3.6). The database says both too,
      // through the composite foreign key and its CHECK; refusing here names the defect
      // instead of answering the caller with a constraint violation.
      if (evaluation.value === 'COMPLIANT' && !canBeCompliant(entry.coverage)) {
        refuse('coverage-conflict');
      }
      if (evaluation.value === 'COMPLIANT' && !corroborationAllowsCompliant(entry.corroboration)) {
        refuse('corroboration-conflict');
      }
      if (evaluation.value === 'EXCEPTION') {
        raising.push(evaluation.conditionId);
        if (evaluation.diagnostic !== null) diagnostics.push(evaluation.diagnostic);
      }
      const row = {
        observationId: result.observationId,
        coverage: entry.coverage,
        corroboration: entry.corroboration,
        evaluation,
        ...(proposal === undefined
          ? {}
          : { agentProposal: Object.freeze({ ...proposal }) }),
      } as ObservationEvaluationRow | AgentJudgedEvaluationRow;
      evaluationRows.push(row);
    }
    if (raising.length === 0) continue;
    // The Exception is created HERE, in the transaction that stores the evaluation that
    // raised it. There is no later step and no second call site: a control failure and
    // the durable record of it commit together or neither happens.
    if (seenExceptions.has(result.observationId)) refuse('exception-shape');
    seenExceptions.add(result.observationId);
    const raised: RaisedException = {
      exceptionId: exceptionIdFor(batch.run.runId, result.observationId),
      runId: batch.run.runId,
      observationId: result.observationId,
      workItemId: entry.record.workItemId,
      targetSystem: entry.record.targetSystem,
      populationRecordKey: entry.record.populationRecordKey,
      conditionIds: raising,
      diagnostics,
      fingerprint: seams.exceptions.fingerprint({
        procedureId: batch.run.procedureId,
        templateId: batch.templateId,
        targetSystem: entry.record.targetSystem,
        populationRecordKey: entry.record.populationRecordKey,
        conditionIds: raising,
      }),
      fingerprintKeyId: seams.exceptions.keyId,
      raisedAt: batch.registeredAt,
    };
    // A fingerprinter that answered with something that is not one must not put a
    // permanent row in the database: an Exception is never updated and never deleted.
    if (!isRaisedException(raised)) refuse('exception-shape');
    exceptions.push(raised);
  }

  // A supplied proposal must have been consumed by an applicable AGENT_JUDGED evaluation.
  // Checking this after the full result set catches proposals for omitted conditions as well
  // as proposals a faulty evaluator silently ignored.
  if (agentProposals !== undefined) {
    const consumed = new Set<string>();
    for (const row of evaluationRows) {
      if ('agentProposal' in row) {
        consumed.add(agentProposalKey(row.agentProposal.observationId, row.agentProposal.conditionId));
      }
    }
    if (
      consumed.size !== proposalsByKey.size ||
      [...proposalsByKey.keys()].some((key) => !consumed.has(key))
    ) {
      refuse('evaluation-shape');
    }
  }

  // ------------------------------------------------------------------------ write
  const rows: RegisteredObservation[] = fresh.map((entry) => ({
    record: entry.record,
    digest: entry.digest,
    coverage: entry.coverage,
    corroboration: entry.corroboration,
    observedAtSource: entry.item.observedAtSource,
    ...(entry.record.found === 'false' ? {
      absence: {
        proof: isObservationAbsenceProof(entry.item.absence) ? entry.item.absence : null,
        expectedQueryKeys: entry.item.expectedQueryKeys,
        digest: observationAbsenceDigest(entry.record.observationId,
          isObservationAbsenceProof(entry.item.absence) ? entry.item.absence : null, entry.item.expectedQueryKeys),
      },
    } : {}),
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
  // After the evaluations, because the Exception is what an `EXCEPTION` evaluation raised
  // and the row it names has to exist first.
  await context.saveExceptions(exceptions);

  const digests = fresh.map((entry) => entry.digest);
  const coverage: Record<ObservationCoverage, number> = { COVERED: 0, UNINSPECTED: 0, AMBIGUOUS: 0 };
  const corroboration: Record<ObservationCorroborationState, number> = {
    MATCHED: 0,
    CONTRADICTORY: 0,
    UNJUDGED: 0,
  };
  for (const entry of fresh) {
    coverage[entry.coverage] += 1;
    corroboration[entry.corroboration] += 1;
  }
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
      // Bind adjacent provenance into the same immutable audit chain, without including
      // source query values or changing any Observation wire digest.
      ...(rows.some(row => row.absence !== undefined) ? { absenceDigests: rows.flatMap(row => row.absence === undefined ? [] : [{ observationId: row.record.observationId, digest: row.absence.digest }]) } : {}),
      coverage,
      corroboration,
      failedChecks,
      evaluations: evaluationRows.length,
      // The Exceptions this batch raised, by their derived ids. A count alone could not
      // say WHICH record failed the control, and the chain is where that is durable
      // whatever later happens to a row.
      exceptions: exceptions.length,
      exceptionIds: exceptions.map((raised) => raised.exceptionId),
    },
  });
  await context.notifyTimeline(event.sequence);

  return {
    registered: rows.length,
    alreadyRegistered,
    checks: checkRows.length,
    evaluations: evaluationRows.length,
    exceptions: exceptions.length,
    digests,
    batchDigest,
    coverage,
    corroboration,
    failedChecks,
  };
}
