import type {
  ExplicitPeriod,
  ProcedureSourceSnapshot,
  ProcedureTargetSnapshot,
  ExecutablePlan,
  JsonValue,
  ObservationCheckResult,
  ObservationCorroboration,
  ObservationCoverage,
  ObservationEvaluation,
  ObservationRecord,
  RunRecord,
  PopulationResult,
  SessionStepState,
  WorkItemState,
} from '@intellifin/domain';
import type { AuditEventWriter } from '../audit/ports.js';

export interface PopulationAcquisitionPort {
  acquire(
    source: ProcedureSourceSnapshot,
    period: ExplicitPeriod,
    timeoutMs: number,
  ): Promise<{
    bytes: Uint8Array;
    mediaType: string;
    declaration: unknown;
  }>;
}
export interface EvidenceStore {
  read(key: string, timeoutMs: number): Promise<Uint8Array | null>;
  putIfAbsent(key: string, bytes: Uint8Array, timeoutMs: number): Promise<void>;
}
export class PopulationAcquisitionError extends Error {
  constructor(readonly code: 'transport' | 'integrity' | 'contract') {
    super(`Population acquisition ${code} failure`);
  }
}
export interface PopulationCheckpoint {
  revision: number;
  status: 'ACQUIRING' | 'RETRY' | 'POPULATION_READY' | 'TERMINAL';
  attempts: number;
  startedAt: string;
  attemptStartedAt: string;
  leaseUntil: string;
  evidenceId: string;
  objectKey: string;
  envelopeKey: string;
  rawDigest: string | null;
  size: number | null;
  diagnostic: string | null;
  envelopeDigest: string | null;
  stepId: string;
  attemptId: string;
}
export interface PopulationExecutionContext {
  run: RunRecord | null;
  checkpoint: PopulationCheckpoint | null;
  auditEvents: AuditEventWriter;
  frozenPlan(): Promise<ExecutablePlan | null>;
  save(
    checkpoint: PopulationCheckpoint,
    state: RunRecord['state'],
    result?: PopulationResult,
  ): Promise<void>;
  notifyTimeline(sequence: number): Promise<void>;
}
export interface PopulationExecutionRepository {
  transaction<T>(
    runId: string,
    work: (context: PopulationExecutionContext) => Promise<T>,
  ): Promise<T>;
  recoverableRunIds(limit: number): Promise<string[]>;
}

/* ------------------------------------------------------------------ Story 3.3 --- */

/**
 * A credential resolved just in time, for one outbound request.
 *
 * There is deliberately NO field holding the token. `authorize` is the only way the
 * value leaves the resolver, and it writes it straight into request headers; the token
 * lives in the adapter's closure and nowhere else. `JSON.stringify` of this object
 * yields the reference alone, so it cannot be put into a checkpoint, an audit payload, a
 * Timeline event, a queue job or a log field even by accident — and a value that cannot
 * be put into a durable shape cannot leak out of one.
 *
 * `reference` is echoed back by the resolver and compared by the caller. A real service
 * that batches, caches by a normalized key or resolves an alias could otherwise answer
 * about a different reference entirely, which proves nothing about the one asked for
 * (the same lesson `CredentialProvider.describe` learned in Story 1.6).
 */
export interface ResolvedCredential {
  readonly reference: string;
  /** Write the credential onto an outbound request. Called once, on the wire, only. */
  authorize(headers: CredentialHeaderSink): void;
}

/**
 * Just enough of a header collection to set one field.
 *
 * Structural on purpose: `packages/application` compiles with `lib: ["ES2024"]` and no
 * host types at all, which is the compiler-enforced half of AD-11. A `Headers` here
 * would not typecheck, and adding the types to get it would trade an invariant for a
 * convenience.
 */
export interface CredentialHeaderSink {
  set(name: string, value: string): void;
}

/**
 * Resolve an opaque credential reference to a usable credential.
 *
 * A DIFFERENT port from `CredentialProvider`, which proves a reference read-only at
 * registration time and has exactly two fields for that reason. Widening that one to
 * return a token would put a secret inside a report the web process reads.
 */
export interface CredentialResolver {
  resolve(reference: string, timeoutMs: number): Promise<ResolvedCredential>;
}

/** A bounded, read-only acquisition of one artifact from a frozen Target System. */
export interface AcquiredArtifact {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  /** The location actually read, for provenance. Never a credential-bearing URL. */
  readonly location: string;
}

/** Acquire a Reference Source artifact (a `versioned-file` Target System). */
export interface ReferenceAcquisitionPort {
  acquireReference(
    target: ProcedureTargetSnapshot,
    timeoutMs: number,
  ): Promise<AcquiredArtifact>;
}

/** Acquire the complete extraction from an adapter-acquired (`api`) Target System. */
export interface AdapterExtractionPort {
  extract(
    target: ProcedureTargetSnapshot,
    credential: ResolvedCredential,
    timeoutMs: number,
  ): Promise<AcquiredArtifact>;
}

/**
 * The adapter stage's durable claim.
 *
 * `runStartedAt` is the POPULATION claim's start: the overall execution deadline starts
 * with the first population claim and persists through restart (population contract v1),
 * so this stage inherits it rather than starting a second clock.
 *
 * There is nowhere here for a credential, by construction.
 */
export interface AdapterExecutionCheckpoint {
  revision: number;
  status: 'EXECUTING' | 'RETRY' | 'EXTRACTION_COMPLETE' | 'TERMINAL';
  attempts: number;
  runStartedAt: string;
  startedAt: string;
  attemptStartedAt: string;
  leaseUntil: string;
  attemptId: string;
  diagnostic: string | null;
}

/** One Reference Source acquisition, keyed by its FROZEN Session Step id. */
export interface SessionStepRecord {
  stepId: string;
  ordinal: number;
  registrationId: string;
  displayName: string;
  state: SessionStepState;
  attempts: number;
  diagnostic: string | null;
  evidenceId: string | null;
}

/** One adapter Work Item, one per adapter-acquired Target System. */
export interface WorkItemRecord {
  workItemId: string;
  stepId: string;
  ordinal: number;
  registrationId: string;
  displayName: string;
  state: WorkItemState;
  attempts: number;
  /** Bounded retry cycles already spent. The owner grants one extra after the first. */
  cycles: number;
  diagnostic: string | null;
  evidenceId: string | null;
  observations: number;
}

/** One attempt at one frozen plan step. `planStepId` is the frozen id, verbatim. */
export interface StepExecutionRecord {
  stepExecutionId: string;
  planStepId: string;
  workItemId: string | null;
  action: string;
  state: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  attempt: number;
  startedAt: string;
  completedAt: string | null;
  diagnostic: string | null;
}

/** An Evidence artifact this stage reserves, uploads, verifies and registers. */
export interface AdapterEvidenceRecord {
  evidenceId: string;
  kind: 'reference-source' | 'adapter-extraction';
  registrationId: string;
  objectKey: string;
  mediaType: string | null;
  digest: string | null;
  size: number | null;
  state: 'RESERVED' | 'REGISTERED' | 'ABANDONED';
}

/** One included population record, in source order. */
export interface PopulationRecord {
  readonly ordinal: number;
  readonly values: Record<string, JsonValue>;
}

export interface AdapterExecutionContext extends ObservationRegistrationContext {
  run: RunRecord | null;
  population: PopulationCheckpoint | null;
  checkpoint: AdapterExecutionCheckpoint | null;
  sessionSteps: readonly SessionStepRecord[];
  workItems: readonly WorkItemRecord[];
  evidence: readonly AdapterEvidenceRecord[];
  auditEvents: AuditEventWriter;
  frozenPlan(): Promise<ExecutablePlan | null>;
  includedRecords(): Promise<readonly PopulationRecord[]>;
  saveCheckpoint(checkpoint: AdapterExecutionCheckpoint, state: RunRecord['state']): Promise<void>;
  saveSessionStep(step: SessionStepRecord): Promise<void>;
  saveWorkItem(item: WorkItemRecord): Promise<void>;
  saveStepExecution(execution: StepExecutionRecord): Promise<void>;
  saveEvidence(evidence: AdapterEvidenceRecord): Promise<void>;
}

export interface AdapterExecutionRepository {
  transaction<T>(
    runId: string,
    work: (context: AdapterExecutionContext) => Promise<T>,
  ): Promise<T>;
  /** Runs whose population is ready and whose extraction is unclaimed or stale. */
  recoverableRunIds(limit: number): Promise<string[]>;
}

/* ------------------------------------------------------------------ Story 3.4 --- */

/**
 * Observation registration: the one transactional contract every producer goes through.
 *
 * An adapter extraction writes through it today and an agent read will write through it
 * later. `AdapterExecutionContext` EXTENDS it rather than owning a `saveObservations` of
 * its own, so there is no reachable write path that skips the digest, the coverage rule,
 * the per-Observation checks or the event that records them — the same containment
 * `PostgresIdentityUnitOfWork` gives the identity commands.
 */

/**
 * One Observation as it is already stored: the wire record read back out of its columns,
 * and the digest column beside it.
 *
 * The record is here because a digest nobody recomputes proves nothing. Reading both is
 * what turns "a row was edited after registration" from a claim into a detection: the
 * digest column is not touched by an edit to the row, so comparing a NEW batch against
 * it would find them in agreement and see nothing.
 */
export interface StoredObservation {
  readonly observationId: string;
  readonly populationRecordKey: string;
  /** The stored row, rebuilt from its columns. Unvalidated: the caller judges it. */
  readonly record: unknown;
  readonly digest: string;
  readonly coverage: ObservationCoverage;
}

/** One Observation as it is written: the wire record, plus what registration derived. */
export interface RegisteredObservation {
  readonly record: ObservationRecord;
  /** `observationDigest(record)`. Recomputed on read; never taken from a caller. */
  readonly digest: string;
  readonly coverage: ObservationCoverage;
  /** §B: the capture time exactly as the source presented it, offset retained. */
  readonly observedAtSource: string;
}

export interface ObservationCheckRow {
  readonly observationId: string;
  readonly check: ObservationCheckResult['check'];
  readonly outcome: ObservationCheckResult['outcome'];
  readonly diagnostic: string | null;
}

export interface ObservationEvaluationRow {
  readonly observationId: string;
  /** Denormalized so `(observation_id, coverage)` can carry the "never Compliant" FK. */
  readonly coverage: ObservationCoverage;
  readonly evaluation: ObservationEvaluation;
}

/** The Evidence state registration needs: an artifact is proof only once REGISTERED. */
export interface EvidenceState {
  readonly evidenceId: string;
  readonly state: AdapterEvidenceRecord['state'];
}

/**
 * The transaction an Observation batch is registered inside.
 *
 * Every method here is bound to ONE PostgreSQL transaction. The rows, their check
 * outcomes, their evaluations, the audit event and the Timeline notification commit
 * together or not at all.
 */
export interface ObservationRegistrationContext {
  auditEvents: AuditEventWriter;
  /** What is already stored for these record keys under this Work Item. */
  readObservations(
    workItemId: string,
    populationRecordKeys: readonly string[],
  ): Promise<readonly StoredObservation[]>;
  /** The state of the Evidence items this batch's Observations link. */
  readEvidenceStates(evidenceIds: readonly string[]): Promise<readonly EvidenceState[]>;
  /** Insert, in order. Re-inserting an existing record key is a no-op, never a duplicate. */
  saveObservations(rows: readonly RegisteredObservation[]): Promise<void>;
  saveObservationChecks(rows: readonly ObservationCheckRow[]): Promise<void>;
  saveObservationEvaluations(rows: readonly ObservationEvaluationRow[]): Promise<void>;
  notifyTimeline(sequence: number): Promise<void>;
}

/**
 * Story 3.6's seam.
 *
 * Corroboration is set by the Evidence Quality Gate AT REGISTRATION (§B.1), so it runs
 * BEFORE the digest is taken — the digest covers the record as it is stored, and a value
 * written afterwards would leave every row disagreeing with its own digest.
 *
 * Until Story 3.6 fills it, `NO_CORROBORATION` judges nothing: every attribute keeps
 * `corroboration: null`, which means "not yet judged" and never "matched".
 */
export interface ObservationCorroborationPort {
  corroborate(
    subjects: readonly ObservationRecord[],
  ): Promise<readonly ObservationCorroborationVerdict[]>;
}

export interface ObservationCorroborationVerdict {
  readonly observationId: string;
  readonly outcome: ObservationCheckResult['outcome'];
  readonly diagnostic: string | null;
  /** Per attribute, by name. The identity attribute is named by its own attribute name. */
  readonly attributes: readonly {
    readonly name: string;
    readonly corroboration: ObservationCorroboration;
  }[];
}

/** The seam's identity implementation: it judges nothing and says so by returning none. */
export const NO_CORROBORATION: ObservationCorroborationPort = {
  corroborate: () => Promise.resolve([]),
};

/**
 * Story 3.7's seam.
 *
 * The deterministic evaluator runs INSIDE the registration transaction, over the records
 * exactly as they are being stored, so an evaluation can never describe an Observation
 * that was not committed. Until Story 3.7 fills it, `NO_EVALUATION` produces none: this
 * story must not implement the compiled condition rules.
 */
export interface ObservationEvaluationPort {
  evaluate(
    subjects: readonly ObservationEvaluationSubject[],
  ): Promise<readonly ObservationEvaluationResult[]>;
}

export interface ObservationEvaluationSubject {
  readonly record: ObservationRecord;
  readonly coverage: ObservationCoverage;
  readonly checks: readonly ObservationCheckResult[];
}

export interface ObservationEvaluationResult {
  readonly observationId: string;
  readonly evaluations: readonly ObservationEvaluation[];
}

export const NO_EVALUATION: ObservationEvaluationPort = {
  evaluate: () => Promise.resolve([]),
};
