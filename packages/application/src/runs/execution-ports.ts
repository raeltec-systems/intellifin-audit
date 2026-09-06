import type {
  CoverageObservation,
  EvidenceArtifactKind,
  EvidenceArtifactState,
  EvidenceIntegrityFindingKind,
  GateCheckResult,
  ObservationCheckName,
  PopulationCheck,
  PopulationGateRow,
  ExplicitPeriod,
  PackageArtifact,
  PackageSealState,
  ProcedureSourceSnapshot,
  ProcedureTargetSnapshot,
  ExecutablePlan,
  JsonValue,
  ObservationCheckResult,
  ObservationCorroboration,
  ObservationCorroborationState,
  ObservationCoverage,
  ObservationEvaluation,
  ObservationRecord,
  ExceptionFingerprintEnvelope,
  OutcomeRowId,
  RaisedException,
  RunCancellationRequest,
  RunRecord,
  RunResultConditionCount,
  RunResultExclusion,
  RunResultFindings,
  RunResultPublication,
  SanitizedToolAction,
  SystemOutcome,
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
/**
 * Why an outbound read failed, as a closed vocabulary.
 *
 * `denied` and `scope` are separate from `contract` on purpose (Story 3.8). §E.1 maps a
 * denied action and a scope violation to `RUN_FAILED` **and a security event**, which is a
 * different consequence from a Target System that is merely unreachable or answers
 * something this build cannot parse. Folded into `transport` — where a 403 used to land,
 * through `!response.ok` — a denial was retried three times against a system that would go
 * on refusing, and the only record that the platform had been told no was a transport
 * count. Folded into `contract` it would be terminal but still silent.
 *
 * `credential` is Story 4.3's: the artifact discloses the credential this Run presented, so
 * it is REFUSED rather than stored. It is not `integrity` — the bytes are exactly what the
 * Target System served and nothing is damaged — and it is not `contract`, because the
 * system honoured the contract; what happened is that the platform may not keep what it
 * answered with. Terminal for its unit, like every other refusal whose input does not
 * change between attempts.
 */
export type AcquisitionFailureCode =
  | 'transport'
  | 'integrity'
  | 'contract'
  | 'denied'
  | 'scope'
  | 'credential';

export class PopulationAcquisitionError extends Error {
  constructor(readonly code: AcquisitionFailureCode) {
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
  /**
   * Whether this Run may conclude without its population Evidence (Story 3.5).
   *
   * Read from the frozen Template through `isRequiredArtifact`, and defaulted to `true`
   * for a plan this build cannot classify: a population nobody can classify is required,
   * which is the fail-closed direction.
   */
  evidenceRequired: boolean;
}
export interface PopulationExecutionContext extends RunResultContext {
  run: RunRecord | null;
  checkpoint: PopulationCheckpoint | null;
  frozenPlan(): Promise<ExecutablePlan | null>;
  save(
    checkpoint: PopulationCheckpoint,
    state: RunRecord['state'],
    result?: PopulationResult,
  ): Promise<void>;
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
  /**
   * Every whole-value spelling of the credential in `text`, replaced (Story 4.3).
   *
   * The redaction half of the same containment. It ANSWERS A QUESTION about the value and
   * returns text with it removed, so it adds no way to read the credential that
   * `authorize` did not already have — and, exactly like `authorize`, it is a method and
   * never a field, so `JSON.stringify` of a resolved credential still yields its reference
   * alone.
   *
   * For an artifact this PLATFORM produced, before it is registered. Never for bytes a
   * Target System served: rewriting those would falsify Evidence, and an artifact that
   * really does carry a credential must FAIL registration rather than be edited into
   * something acceptable.
   */
  redact(text: string): string;
  /**
   * Whether these bytes disclose the credential, in any form this build recognises.
   *
   * Over bytes rather than over a decoded document, because a screenshot is not text and a
   * Structural Snapshot is not always valid UTF-8. This is the question `freezeArtifact`
   * asks of every artifact before anything is uploaded; a `true` is a refusal, never a
   * repair.
   */
  discloses(bytes: Uint8Array): boolean;
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
  /**
   * The step's FROZEN action (Story 4.2).
   *
   * A Reference Source acquisition freezes bytes and a sign-in establishes a session, and
   * `run_session_step_acquired` has to be able to tell them apart — otherwise the
   * constraint that requires ACQUIRED Evidence refuses exactly the row a successful
   * sign-in writes.
   */
  action: 'sign-in' | 'extract-adapter';
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

/**
 * An Evidence artifact this stage reserves, uploads, verifies and registers.
 *
 * `evidenceId` and `objectKey` are DERIVED from the reservation, never minted, so a
 * retried production after a crash reuses the reservation it already has (Story 3.5).
 * `required` says whether the Run may conclude without it; it is stamped at reservation
 * time from the frozen Template and is what `SealPackage` reads.
 */
export interface AdapterEvidenceRecord {
  evidenceId: string;
  kind: 'reference-source' | 'adapter-extraction';
  registrationId: string;
  objectKey: string;
  mediaType: string | null;
  digest: string | null;
  size: number | null;
  required: boolean;
  state: EvidenceArtifactState;
}

/** One included population record, in source order. */
export interface PopulationRecord {
  readonly ordinal: number;
  readonly values: Record<string, JsonValue>;
}

export interface AdapterExecutionContext
  extends ObservationRegistrationContext,
    RunGateContext {
  run: RunRecord | null;
  population: PopulationCheckpoint | null;
  checkpoint: AdapterExecutionCheckpoint | null;
  sessionSteps: readonly SessionStepRecord[];
  workItems: readonly WorkItemRecord[];
  evidence: readonly AdapterEvidenceRecord[];
  frozenPlan(): Promise<ExecutablePlan | null>;
  includedRecords(): Promise<readonly PopulationRecord[]>;
  saveCheckpoint(checkpoint: AdapterExecutionCheckpoint, state: RunRecord['state']): Promise<void>;
  saveSessionStep(step: SessionStepRecord): Promise<void>;
  saveWorkItem(item: WorkItemRecord): Promise<void>;
  saveStepExecution(execution: StepExecutionRecord): Promise<void>;
  saveEvidence(evidence: AdapterEvidenceRecord): Promise<void>;
  /**
   * Step Executions this Run has already started, whatever their outcome (Story 3.8).
   *
   * The frozen `runStepExecutions` limit counts ATTEMPTS, not successes, so a Run that
   * retried its way to ten thousand attempts has spent the limit exactly as one that
   * succeeded ten thousand times would have.
   */
  readStepExecutionCount(): Promise<number>;
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
  /**
   * §B's retained capture time, exactly as the column holds it now.
   *
   * It sits OUTSIDE the thirteen hashed wire keys — the envelope is addendum §B.1's and is
   * pinned by an independently produced golden vector, so moving it is a contract change
   * and not a repair. An edit to it therefore leaves the digest matching, and a reader that
   * never selected it could not see one: the row reported as already registered, with its
   * capture provenance silently rewritten. It is read back so registration can re-derive
   * it against the `observedAt` the digest DOES cover.
   */
  readonly observedAtSource: string;
}

/** One Observation as it is written: the wire record, plus what registration derived. */
export interface RegisteredObservation {
  readonly record: ObservationRecord;
  /** `observationDigest(record)`. Recomputed on read; never taken from a caller. */
  readonly digest: string;
  readonly coverage: ObservationCoverage;
  /**
   * The Story 3.6 rollup of the record's per-attribute corroboration.
   *
   * Derived by `observationCorroborationState`, stored beside the row exactly as
   * `coverage` is, and pinned to the attributes it was derived from by a generation-22
   * CHECK. `run_observation_evaluation` carries it too, so "a record its own snapshot
   * contradicts is never Compliant" is a foreign key rather than a rule in a command.
   */
  readonly corroboration: ObservationCorroborationState;
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
  /** Denormalized so the composite FK can carry the two "never Compliant" rules. */
  readonly coverage: ObservationCoverage;
  readonly corroboration: ObservationCorroborationState;
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
  /**
   * Insert the Exceptions this batch raised (Story 3.7).
   *
   * `DO NOTHING` on the Observation: the first Exception recorded for a record stands and
   * a redelivery adds nothing. An Exception is never updated and never deleted on its own
   * — generation 23 puts both below the command, as triggers.
   */
  saveExceptions(rows: readonly RaisedException[]): Promise<void>;
  notifyTimeline(sequence: number): Promise<void>;
}

/**
 * Story 3.6's seam, filled by `snapshot-corroboration.ts`.
 *
 * Corroboration is set by the Evidence Quality Gate AT REGISTRATION (§B.1), so it runs
 * BEFORE the digest is taken — the digest covers the record as it is stored, and a value
 * written afterwards would leave every row disagreeing with its own digest. For the same
 * reason an implementation has to be DETERMINISTIC over stored bytes: a verdict that could
 * differ between two reads would make a redelivered batch produce a different digest and
 * read as an integrity failure.
 *
 * `NO_CORROBORATION` remains the explicit "nothing judged this" for a producer that has no
 * snapshot to re-read. The adapter stage cannot reach it: `executeAdapterSteps` builds a
 * `snapshotCorroboration` over the bytes it just froze, so there is no composition root
 * that can register an adapter Observation as unjudged forever.
 */
export interface ObservationCorroborationPort {
  corroborate(
    subjects: readonly ObservationRecord[],
  ): Promise<readonly ObservationCorroborationVerdict[]>;
}

export interface ObservationCorroborationVerdict {
  readonly observationId: string;
  readonly outcome: ObservationCheckResult['outcome'];
  /**
   * Closed at compile time, not cast at the call site.
   *
   * `run_observation_check` does not constrain its diagnostic text, so a corroborator
   * returning an invented string would put it in the chain. The union is the guard, the
   * way `TELEMETRY_MESSAGES` is for a log line.
   */
  readonly diagnostic: ObservationCheckResult['diagnostic'];
  /**
   * The identity attribute's verdict, carried APART from the declared attributes.
   *
   * §B.1 lets a declared attribute share the identity's name, and the two are grounded at
   * different locators, so one verdict list keyed by name would silently give one of them
   * the other's answer. `null` means the identity was not judged, or there is none.
   */
  readonly identity: ObservationCorroboration | null;
  /** Per declared attribute, by name. Names are unique within `attributes` by schema. */
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
 * Story 3.7's seam, filled by `rule-evaluation.ts`.
 *
 * The deterministic evaluator runs INSIDE the registration transaction, over the records
 * exactly as they are being stored, so an evaluation can never describe an Observation
 * that was not committed. Like the corroboration seam it must be deterministic and do no
 * I/O: it holds the frozen conditions, the frozen population and the frozen Reference
 * Source bytes and reaches nothing else.
 *
 * `NO_EVALUATION` remains the explicit "nothing judged this" for a producer with no
 * compiled conditions to evaluate. The adapter stage cannot reach it: `executeAdapterSteps`
 * builds a `ruleEvaluation` from the plan it is executing, so no composition root can
 * register an adapter Observation as unevaluated forever.
 *
 * An implementation answers about EVERY subject it was given, exactly once. "Nothing
 * judged this" is a result carrying no evaluations, never an omitted result: an omission
 * leaves that Observation with no evaluation row, which downstream is indistinguishable
 * from a frozen plan this build cannot recompile. `registerObservations` refuses a partial
 * answer as `evaluation-shape`.
 */
export interface ObservationEvaluationPort {
  evaluate(
    subjects: readonly ObservationEvaluationSubject[],
  ): Promise<readonly ObservationEvaluationResult[]>;
}

export interface ObservationEvaluationSubject {
  readonly record: ObservationRecord;
  readonly coverage: ObservationCoverage;
  /** The Story 3.6 rollup. A record its own snapshot contradicts is never Compliant. */
  readonly corroboration: ObservationCorroborationState;
  readonly checks: readonly ObservationCheckResult[];
}

export interface ObservationEvaluationResult {
  readonly observationId: string;
  readonly evaluations: readonly ObservationEvaluation[];
}

export const NO_EVALUATION: ObservationEvaluationPort = {
  evaluate: (subjects) =>
    Promise.resolve(
      subjects.map((subject) => ({ observationId: subject.record.observationId, evaluations: [] })),
    ),
};

/**
 * The keyed fingerprint an Exception is written with (Story 3.7).
 *
 * A PORT rather than a key, and there is deliberately NO field holding the key: `keyId`
 * names it and `fingerprint` is the only way it is used, so the value lives in the
 * implementation's closure and nowhere else. `JSON.stringify` of this object yields the
 * key id alone, so no checkpoint, audit payload, Timeline event, log field or error
 * message has anywhere to pick a secret up from — the `ResolvedCredential` containment,
 * one story along.
 */
export interface ExceptionFingerprinter {
  /** Retained on every Exception, so a rotated key still says which key signed which row. */
  readonly keyId: string;
  fingerprint(envelope: ExceptionFingerprintEnvelope): string;
}

/* ------------------------------------------------------------------ Story 3.5 --- */

/**
 * The Evidence package: the transaction a reservation, a registration and a seal are
 * written inside.
 *
 * Both execution contexts EXTEND this, exactly as `AdapterExecutionContext` extends
 * `ObservationRegistrationContext` (Story 3.4): a producer holds one object and there is
 * no second, unowned way to reach the seal — no `writeSeal` that skips the decision, no
 * abandon that skips the audit event.
 *
 * Every method is bound to ONE PostgreSQL transaction. The abandoned reservations, the
 * seal row, the audit event and the Timeline notification commit with the terminal state
 * transition that produced them, or none of them do.
 */
export interface EvidencePackageContext {
  auditEvents: AuditEventWriter;
  /** Every artifact of this Run, whichever producer reserved it. */
  readPackageArtifacts(): Promise<readonly PackageArtifact[]>;
  /** Flip exactly these reservations to `ABANDONED`. A registered artifact is untouched. */
  abandonArtifacts(evidenceIds: readonly string[]): Promise<void>;
  readSeal(): Promise<PackageSeal | null>;
  /** Write the seal. The first seal wins; a sealed package is immutable. */
  writeSeal(seal: PackageSeal): Promise<void>;
  notifyTimeline(sequence: number): Promise<void>;
}

/** One artifact as the seal names it on the Result. An identity, never bytes. */
export interface PackageArtifactRef {
  readonly evidenceId: string;
  readonly kind: EvidenceArtifactKind;
  readonly objectKey: string;
}

/**
 * The sealed Evidence package of one Run.
 *
 * `missingRequired` and `abandoned` are on the seal because the Result and the export read
 * them there: an abandonment that is only in the audit chain is not "listed on the Result".
 */
export interface PackageSeal {
  readonly runId: string;
  readonly state: PackageSealState;
  /** The terminal Run state this package was sealed at. */
  readonly runState: RunRecord['state'];
  readonly sealedAt: string;
  readonly requiredTotal: number;
  readonly registered: number;
  readonly missingRequired: readonly PackageArtifactRef[];
  readonly abandoned: readonly PackageArtifactRef[];
}

/** One registered artifact, as the post-Run verification reads it. */
export interface RegisteredArtifact {
  readonly evidenceId: string;
  readonly kind: EvidenceArtifactKind;
  readonly objectKey: string;
  readonly digest: string;
  /** `null` for an artifact whose length registration never recorded. */
  readonly size: number | null;
}

/**
 * One Audit Trail integrity finding, discovered AFTER the Run.
 *
 * It names an artifact and states two digests. There is no field for bytes and no field
 * for a credential reference, and `FORBIDDEN_PAYLOAD_KEYS` would refuse one in the audit
 * payload anyway — the chain is immutable, so anything credential-shaped that enters it
 * can never be taken out.
 */
export interface EvidenceIntegrityRecord {
  readonly findingId: string;
  readonly evidenceId: string;
  readonly objectKey: string;
  readonly finding: EvidenceIntegrityFindingKind;
  readonly expectedDigest: string;
  readonly observedDigest: string | null;
  readonly expectedSize: number | null;
  readonly observedSize: number | null;
  readonly detectedAt: string;
}

/**
 * The transaction a post-Run verification is written inside.
 *
 * It can add findings and it can read the seal. It has no way to change a Run state, a
 * seal or an artifact, because a mismatch found after the Run "changes no state" and the
 * cheapest way to guarantee that is to hand the command nothing that could.
 */
export interface SealedPackageContext {
  run: RunRecord | null;
  auditEvents: AuditEventWriter;
  readSeal(): Promise<PackageSeal | null>;
  readRegisteredArtifacts(): Promise<readonly RegisteredArtifact[]>;
  readIntegrityFindings(): Promise<readonly EvidenceIntegrityRecord[]>;
  /** Insert findings. Re-verifying an unchanged mismatch adds nothing. */
  recordIntegrityFindings(findings: readonly EvidenceIntegrityRecord[]): Promise<void>;
  notifyTimeline(sequence: number): Promise<void>;
}

export interface SealedPackageRepository {
  transaction<T>(runId: string, work: (context: SealedPackageContext) => Promise<T>): Promise<T>;
}

/* ------------------------------------------------------------------ Story 3.8 --- */

/**
 * One §H fact that can be about many records, as a count plus a bounded sample.
 *
 * The count is EXACT and the sample is bounded, because a Run over a hundred thousand
 * records must be able to commit its own conclusion: the Gate's rows go onto the Result
 * and into an immutable audit event, and a payload that grew with the population would be
 * a Run that concluded and could not say so.
 */
export interface GateFactSample {
  readonly targetSystem: string | null;
  readonly workItemId: string | null;
  readonly record: string | null;
}

export interface GateFactTally {
  readonly total: number;
  readonly sample: readonly GateFactSample[];
}

/** The population reconciliation the Run-level Gate reads back (Story 3.2's own record). */
export interface RunGatePopulationFacts {
  readonly checks: readonly PopulationCheck[];
  readonly included: number;
  readonly excluded: number;
  readonly indeterminate: number;
  /** Rows actually stored, counted rather than derived from the three counts above. */
  readonly rowsParsed: number;
  /** Excluded or indeterminate rows carrying no reason at all. Ordinals, bounded. */
  readonly unexplained: readonly number[];
  /** The snapshot's declared generation time, or `null` when none was recorded. */
  readonly generatedAt: string | null;
}

/** One §H Gate row as it is stored and read back. */
export interface GateCheckRow {
  readonly check: GateCheckResult['check'];
  readonly outcome: GateCheckResult['outcome'];
  readonly diagnostics: readonly GateCheckResult['diagnostics'][number][];
  readonly targetSystems: readonly string[];
  readonly workItems: readonly string[];
  readonly records: readonly string[];
  readonly total: number;
}

/* ------------------------------------------------------------------ Story 3.9 --- */

/**
 * One Run's Result, as it is stored and read back.
 *
 * `version` starts at 1 with the row and is incremented by a later sealing — the only
 * one there can be, because the only unsealed outcome is `PENDING_CONFIRMATION`. Nothing
 * else about a Result ever changes: generation 25 refuses every other UPDATE below the
 * command, in a trigger.
 */
export interface StoredRunResult {
  readonly runId: string;
  readonly version: number;
  readonly outcome: SystemOutcome;
  /** Which addendum §E.1 row decided, so a Result can say why it says what it says. */
  readonly row: OutcomeRowId;
  readonly sealed: boolean;
  /** The Run state this outcome implies. Row 5 moves a COMPLETED Run to INCONCLUSIVE. */
  readonly runState: RunRecord['state'];
  /** Read from the Gate rows Story 3.8 wrote. Never inferred from the evaluations. */
  readonly gatePassed: boolean;
  readonly sealedAt: string;
  /** The version's stored scope statement, verbatim; `null` for an unreadable plan. */
  readonly scope: string | null;
  readonly publication: RunResultPublication;
}

/**
 * The transaction one Run's Result is computed and sealed inside (Story 3.9).
 *
 * Both execution contexts EXTEND it — `RunGateContext` through its own extension, and
 * `PopulationExecutionContext` directly — so the producer taking a terminal transition
 * already holds everything `CompleteRun` needs and there is no dependency a composition
 * root could omit. Stories 3.6, 3.7 and 3.8 each removed or refused such a seam; a Result
 * that could be left out is a Run that concludes without saying what it concluded.
 *
 * Every method is bound to ONE PostgreSQL transaction. The Evidence package seal, the
 * Result row, the terminal Run state and the audit event commit together or not at all.
 */
export interface RunResultContext extends EvidencePackageContext {
  /** Already-recorded Gate rows. The first Gate wins; a redelivery re-reads and writes nothing. */
  readGateChecks(): Promise<readonly GateCheckRow[]>;
  /**
   * The Run's cancellation marker AS IT IS NOW, read on this transaction's connection.
   *
   * Not `input.run.cancellation`: the `RunRecord` a worker stage carries was read at its
   * CLAIM, and the whole case this exists for is a person cancelling DURING the last unit —
   * after that claim and before this terminal transaction. A claim-time copy would find
   * nothing precisely when there is something to find. The same rule the role rechecks of
   * Stories 1.5 and 2.7 follow: read inside the transaction that writes.
   */
  readCancellation(): Promise<RunCancellationRequest | null>;
  /** The terminal transition being committed. Sealed in the same transaction. */
  saveRunState(state: RunRecord['state']): Promise<void>;
  readPopulationFacts(): Promise<RunGatePopulationFacts | null>;
  /** Every parsed population row, in source order. Bounded by `POPULATION_LIMITS.rows`. */
  readPopulationRows(): Promise<readonly PopulationGateRow[]>;
  /** Every Observation, as the per-record coverage matrix reads it. */
  readGateObservations(): Promise<readonly CoverageObservation[]>;
  /** The Result already computed for this Run, or `null`. The FIRST one wins. */
  readResult(): Promise<StoredRunResult | null>;
  /** Write the Result. A sealed outcome is immutable; the database says so as well. */
  writeResult(result: StoredRunResult): Promise<void>;
  /** Every exclusion reason, with an exact total and a bounded sample of its rows. */
  readResultExclusions(): Promise<readonly RunResultExclusion[]>;
  /**
   * Per-condition evaluation counts by origin, confirmation state and value (§B.1).
   *
   * The §E.1 decision reads its three evaluation facts from HERE — `pending`,
   * `unevaluated` and the Exceptions — rather than from the Gate or from each other,
   * because a passed Gate is necessary and never sufficient for a Pass.
   */
  readConditionCounts(): Promise<readonly RunResultConditionCount[]>;
  /**
   * The records the Result names: every Exception and every record left Unevaluated.
   *
   * Exact totals beside bounded samples, and the samples carry the Template's declared
   * attribute values so the §C control-specific fields can be published from them.
   */
  readResultFindings(): Promise<{
    readonly exceptions: RunResultFindings;
    readonly unevaluated: RunResultFindings;
  }>;
}

/**
 * The transaction the Run-level Gate is decided and recorded inside (Story 3.8).
 *
 * `AdapterExecutionContext` EXTENDS it, exactly as it extends `ObservationRegistrationContext`
 * and `EvidencePackageContext`: the stage that finishes the last Work Item holds one
 * object, and there is no second, unowned way to reach the Gate — no `saveGateChecks` that
 * skips the decision, no terminal transition that skips the seal. Stories 3.6 and 3.7 both
 * REMOVED their seam's injection point for the same reason; a Gate a composition root could
 * omit is a Run that concludes without one.
 *
 * Every method is bound to ONE PostgreSQL transaction. The Gate rows, the Timeline events,
 * the terminal Run state and the Evidence package seal commit together or not at all.
 */
export interface RunGateContext extends RunResultContext {
  saveGateChecks(rows: readonly GateCheckRow[]): Promise<void>;
  /** Failing per-Observation check outcomes, tallied by check name (Stories 3.4 and 3.6). */
  readFailedObservationChecks(): Promise<
    Readonly<Partial<Record<ObservationCheckName, GateFactTally>>>
  >;
  /**
   * Observations missing an evaluation for one of the version's frozen conditions.
   *
   * `expected` is the number of compiled conditions the version froze. An Observation with
   * fewer evaluations than that has a condition nobody decided, which §H's condition
   * completeness row refuses — "no uncompiled condition is silently skipped".
   */
  readConditionGaps(expected: number): Promise<GateFactTally>;
  /**
   * Evaluations that met a value the compiled condition names and could not read.
   *
   * §H's unnamed-value row, and §B's own wording: "when a compiled condition meets an
   * attribute value outside the set it names, the condition evaluates Unevaluated with
   * diagnostic `rule does not name value <v>`". That prefix is the observable, and it is a
   * shared constant rather than a retyped string. A value the condition NAMES and could not
   * read is a different defect on a different row.
   */
  readUnnamedValues(): Promise<GateFactTally>;
  /** Work Items whose extraction did not prove itself complete (§H pagination row). */
  readIncompleteExtractions(): Promise<readonly GateFactSample[]>;
  /** Session Steps that ended `FAILED`, and units that were denied or went out of scope. */
  readAccessFailures(): Promise<{
    readonly failedSessionSteps: readonly GateFactSample[];
    readonly denied: readonly GateFactSample[];
  }>;
  /** Integrity findings recorded against this Run. */
  readIntegrityFindings(): Promise<readonly GateFactSample[]>;
}

/* ------------------------------------------------------------------ Story 4.1 --- */

/**
 * Where an Agent Workspace actually runs, and therefore what its isolation is worth.
 *
 * This is recorded on the checkpoint rather than assumed, because the two modes do NOT
 * deliver the same guarantee and the weaker one must be written down wherever the
 * guarantee is claimed (`epic-4-browser-provider-decision.md`):
 *
 * - `solari` — a managed remote browser per Run, isolated by the provider, with its own
 *   provider-side egress. Browser state AND the sandbox.
 * - `local` — the same code path against a locally launched Chromium. Browser state is
 *   isolated per Run; **the worker process is NOT isolated at all**, and egress is
 *   policed inside the browser by request interception rather than at the network.
 *
 * There is ONE implementation of `BrowserExecution`, written against the Playwright client
 * API. A Solari session hands back a wire-protocol endpoint and the client connects to it,
 * so the driving code is identical either way; which browser a deployment gets is a
 * composition-root choice and never a second implementation of this port.
 */
export const WORKSPACE_MODES = ['solari', 'local'] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

/**
 * The durable identity of one provisioned workspace.
 *
 * `workspaceId` is the PROVIDER session identifier — `browser.id` under Solari — which is
 * what lets a later claim, or the reaper, act on a workspace this process did not create,
 * and what makes a provider-side session correlatable with a Run. It is an opaque
 * identifier and NOT a capability: releasing a Solari session still needs the deployment's
 * API key. It is therefore recorded on the checkpoint and in the Timeline event, and the
 * things that must never be: the API key, any session token, and the wire-protocol
 * endpoint — which under Solari is loopback-wrapped by the client and means nothing
 * outside the process that created it anyway.
 */
export interface WorkspaceRef {
  readonly runId: string;
  readonly workspaceId: string;
  readonly mode: WorkspaceMode;
}

/**
 * The egress allowlist, as an INPUT rather than a setting the implementation chooses.
 *
 * It is the Procedure Version's frozen `web` Target System origins and nothing else.
 * Nothing widens it: not an authored instruction, not a redirect a site chose, not a
 * provider feature. An empty list denies every destination, which is the correct reading
 * of a workspace whose plan names no web system.
 */
export interface WorkspaceEgressPolicy {
  readonly allowedOrigins: readonly string[];
}

/**
 * One destination the workspace was refused, reported by the implementation.
 *
 * `destination` is the scheme, authority and path only — never a query string, never
 * credentials in a URL, never a request body — because this is written into the immutable
 * audit chain as a security event and anything that enters it can never be taken out.
 */
export interface WorkspaceDenial {
  readonly destination: string;
  readonly method: string;
  readonly resourceType: string;
}

/** A live workspace, as application code sees it. No `Page`, no `Browser`, no SDK type. */
export interface WorkspaceHandle {
  readonly ref: WorkspaceRef;
  /**
   * The provider's own hard deadline for this session, or `null` when it has none.
   *
   * Solari's `Session.expiresAt` is a plan-tier deadline at which the session
   * AUTO-RELEASES. It is not an idle window and nothing a Run does resets it, so a Run must
   * not assume its workspace outlives it: a resumed claim checks the stored value and
   * treats an expired identity as GONE rather than as an outage. The frozen Run limits stay
   * the authority for ending the RUN; this is a fact about the workspace that the Run has to
   * respect and record.
   */
  readonly expiresAt: string | null;
  /**
   * Every destination denied since the last call, in order, and clear the log.
   *
   * Draining rather than reading: a denial recorded twice would be two security events
   * for one refusal. Interception happens inside the browser at a moment no caller is
   * waiting on, so the stage collects denials at its own transaction boundaries — which
   * is also the only place an audit event can be appended.
   */
  takeDenials(): readonly WorkspaceDenial[];
  /**
   * How many destinations this workspace has been refused in total, ever.
   *
   * Exact, and never reset, beside the bounded sample `takeDenials` returns — the same
   * shape `run_gate_check` uses, and for the same reason: a Run that was refused ten
   * thousand times must still be able to commit its own record of it, and a count that
   * silently stopped at the sample size would understate exactly the case that matters.
   */
  denied(): number;
}

/**
 * Why a workspace could not be provisioned, as a closed vocabulary.
 *
 * The I/O matrix asks for one distinction in particular — "distinguish a plan refusal from
 * an outage" — and the vocabulary is wider than two because each row is a different thing
 * for an operator to do about it. A provider refusal folded into `unavailable` would be
 * indistinguishable from a network fault in the only durable record of it.
 *
 * - `unavailable` — an outage. RETRIED under the Session Step budget.
 * - `capacity` — the provider has no slot free right now (`ConcurrencyLimitExceeded`).
 *   RETRIED. Its own word because "buy more concurrency" and "the network broke" are
 *   different sentences to the person reading the row.
 * - `entitlement` — the deployment's plan does not permit it (`FeatureRequiresPlan`,
 *   `PlanLimitExceeded`). TERMINAL: it will refuse identically on every attempt, and
 *   retrying it four times spends the budget to learn nothing (the `credential-unresolved`
 *   rule, one stage along).
 * - `refused` — the provider said no for a reason this build does not recognise.
 *   TERMINAL, which is the fail-closed direction: `SolariErrorCode` is widened with
 *   `| string`, so a code added by a later provider release must not be assumed transient.
 * - `policy` — the Version's frozen allowlist cannot be parsed by this build. TERMINAL:
 *   the same frozen bytes make the same policy every time.
 */
export type WorkspaceFailureCode =
  | 'unavailable'
  | 'capacity'
  | 'entitlement'
  | 'refused'
  | 'policy';

export class WorkspaceProvisionError extends Error {
  override readonly name = 'WorkspaceProvisionError';
  constructor(readonly code: WorkspaceFailureCode) {
    super(`Agent Workspace ${code} failure`);
  }
}

/**
 * AD-4: the port behind which an isolated Agent Workspace is provisioned.
 *
 * `attach` and `release` are conformance requirements (AD-16), not conveniences: a Run
 * that resumes after a wait must reattach to the workspace it left rather than sign in
 * again, and a workspace nothing releases outlives the Run that justified it.
 *
 * Structural types only. `packages/application` compiles with `lib: ["ES2024"]` and no
 * host types at all — that absence is the compiler-enforced half of AD-11 — so no `Page`,
 * `Browser`, `URL` or provider type may cross this boundary.
 */
export interface BrowserExecution {
  /** Which mode this composition root actually provides. Recorded on the checkpoint. */
  readonly mode: WorkspaceMode;
  /** Provision one workspace for one Run, confined to `policy`. */
  create(input: {
    readonly runId: string;
    readonly policy: WorkspaceEgressPolicy;
    readonly timeoutMs: number;
  }): Promise<WorkspaceHandle>;
  /**
   * Reattach to a workspace this deployment already provisioned, or `null`.
   *
   * `null` is a real and expected answer, not an error: a browser does not survive the
   * process that connected to it, so a worker that died holding a workspace cannot
   * reattach to it and must release the stale identity before provisioning another.
   */
  attach(ref: WorkspaceRef): Promise<WorkspaceHandle | null>;
  /** Release a workspace and revoke its credentials. Idempotent, by identity. */
  release(ref: WorkspaceRef, timeoutMs: number): Promise<void>;
  /**
   * Perform ONE Tool Action the gate has already authorized (Story 4.2).
   *
   * The gate is NOT here and must not be: `authorizeToolAction` runs at this port's call
   * site in `packages/application`, so an implementation cannot skip it and a second
   * provider inherits the guarantee rather than reimplementing it. What the implementation
   * owns is the mechanism — the egress interception that aborts a destination the frozen
   * allowlist does not cover, refusing to follow a redirect out of it, declining a
   * download, and presenting the credential on this one request and no other.
   *
   * A refusal by the Target System throws `BrowserActionError('denied')`, never
   * `'unavailable'`: they are different consequences under §E.1 and the difference is the
   * one Epic 3 paid for losing.
   */
  perform(
    ref: WorkspaceRef,
    action: BrowserToolAction,
    timeoutMs: number,
  ): Promise<BrowserActionResult>;
}

/**
 * The Agent Workspace's durable claim, one row per Run.
 *
 * It is its own row rather than a field on another stage's checkpoint because the
 * workspace outlives every one of them: it is created at the frozen `create-workspace`
 * Session Step, which the compiler emits FIRST, and released at the Run's terminal
 * transition. There is nowhere here for a credential or a provider endpoint, by
 * construction.
 */
export interface WorkspaceCheckpoint {
  revision: number;
  /** `PROVISIONING` is leased; `RETRY` is a failed attempt waiting to be resumed. */
  status: 'PROVISIONING' | 'OPEN' | 'RETRY' | 'RELEASED' | 'FAILED';
  attempts: number;
  /** The FROZEN `create-workspace` Session Step id, verbatim. */
  stepId: string;
  /** The provider session identifier, or `null` before one exists. */
  workspaceId: string | null;
  mode: WorkspaceMode;
  /** The provider's hard deadline for this session, or `null` when it has none. */
  expiresAt: string | null;
  startedAt: string;
  attemptStartedAt: string;
  leaseUntil: string;
  releasedAt: string | null;
  diagnostic: string | null;
}

export interface WorkspaceExecutionContext extends RunResultContext {
  run: RunRecord | null;
  checkpoint: WorkspaceCheckpoint | null;
  frozenPlan(): Promise<ExecutablePlan | null>;
  save(checkpoint: WorkspaceCheckpoint, state: RunRecord['state']): Promise<void>;
  /** One attempt at the frozen `create-workspace` step, as Step Execution provenance. */
  saveStepExecution(execution: StepExecutionRecord): Promise<void>;
}

export interface WorkspaceExecutionRepository {
  transaction<T>(
    runId: string,
    work: (context: WorkspaceExecutionContext) => Promise<T>,
  ): Promise<T>;
  /**
   * The reaper's OWN read: workspaces still held whose Run has already ended.
   *
   * A keyset page ordered by Run id, `after` being the last id of the previous page. A
   * background job must not borrow a surface's read or another stage's — the probe sweep
   * that borrowed `listRegistrations` probed nothing while exiting 0.
   */
  reapableRunIds(after: string | null, limit: number): Promise<string[]>;
}

/* ------------------------------------------------------------------ Story 4.2 --- */

/**
 * One authorized Tool Action, as the port receives it.
 *
 * Structural, like everything else that crosses this boundary: no `URL`, no `Page`, no
 * provider type. `credential` is a `ResolvedCredential` — a reference and a method that
 * writes a header — so this object has no field holding a secret and `JSON.stringify` of
 * it yields the reference alone.
 *
 * **The gate has already run by the time this exists.** `authorizeToolAction` is applied
 * at the CALL SITE in `packages/application`, never inside a provider adapter: an adapter
 * that enforced its own allowlist would make the guarantee a property of that adapter, and
 * the whole point of the port is that the provider can be replaced.
 */
interface BrowserToolActionBase {
  /** The action the frozen registration permits. `navigate` is the only one Story 4.2 takes. */
  readonly action: string;
  /** An absolute destination the gate has already proved is inside the frozen origins. */
  readonly destination: string;
}

/**
 * One Tool Action, as the port receives it.
 *
 * A UNION, and the two arms are the whole of Story 4.3's capture suppression: an action
 * that PRESENTS a credential has no `capture` field at all, so asking for a Structural
 * Snapshot, a screenshot or a frame while a credential is on the wire does not compile.
 * That is the containment shape this codebase uses everywhere — the wrong thing is
 * unrepresentable rather than forbidden by a rule every call site has to remember — and it
 * is why suppression is not a flag the caller sets and the implementation is trusted to
 * honour.
 *
 * "Entry" here is credential USE and not typing: LoanCore authenticates a GET with an
 * `Authorization` header and has no form, so what must have nowhere to land is the request
 * header and every artifact that could carry it. That is the stronger guarantee, not the
 * weaker one (`epic-4-loancore-authentication-decision.md`).
 */
export type BrowserToolAction =
  | (BrowserToolActionBase & {
      /**
       * The credential to present on THIS request and no other.
       *
       * Presented just in time and withdrawn immediately after: an implementation that left
       * it on the workspace would put it on every later request of the Run.
       */
      readonly credential: ResolvedCredential;
      /** Not a field of this arm. Capture is SUPPRESSED for a credential-entry action. */
      readonly capture?: never;
    })
  | (BrowserToolActionBase & {
      readonly credential: null;
      /**
       * What the platform captures from this action.
       *
       * `[]` is "capture nothing", written out rather than defaulted, so a caller that
       * wants no capture says so and a caller that wants some has to name it. **Nothing in
       * this build captures yet** — Story 4.4 is what implements the `web_tree` Structural
       * Snapshot and the screenshot — and the vocabulary is here so that the suppression is
       * already structural when it arrives rather than being retrofitted around it.
       */
      readonly capture: readonly BrowserCaptureKind[];
    });

/**
 * What the platform can capture from a Tool Action.
 *
 * The three the spec names, and no more. `[NAMED, NOT BUILT]` in this story: `perform`
 * produces none of them and Story 4.4 owns the mechanism. What is built here is that a
 * credential-entry action can never ask for one.
 */
export const BROWSER_CAPTURE_KINDS = ['structural-snapshot', 'screenshot', 'frame'] as const;
export type BrowserCaptureKind = (typeof BROWSER_CAPTURE_KINDS)[number];

/** What one Tool Action produced, with nothing in it that came out of the page. */
export interface BrowserActionResult {
  /** The main document's response status, or `null` when nothing answered. */
  readonly status: number | null;
  /**
   * The location the workspace actually ended on, scheme+authority+path only.
   *
   * Sanitized by the implementation before it crosses this boundary, because it is
   * recorded in the immutable action log and a query string is where a session token or a
   * signed URL lives.
   */
  readonly location: string;
  /** Whether the Target System redirected the action somewhere else. */
  readonly redirected: boolean;
  /** How many downloads the destination offered. Offered, and never executed. */
  readonly downloads: number;
  /** Whether the workspace now holds a session cookie for this destination's origin. */
  readonly session: boolean;
}

/**
 * Why a Tool Action could not be performed, as a closed vocabulary.
 *
 * A refusal by the Target System is NEVER `unavailable`: §E.1 gives a denial and a scope
 * violation a different terminal state and a security event, and Epic 3 already paid for
 * folding them into a transport count — a Work Item retried three times against a system
 * that would go on refusing, with nothing durable saying the platform had been told no.
 *
 * - `unavailable` — the workspace or the system did not answer. RETRIED.
 * - `denied` — the Target System refused the action (401, 403). TERMINAL.
 * - `scope` — the action left, or was sent, outside the frozen origins. TERMINAL.
 * - `contract` — the system answered something this build cannot act on. TERMINAL.
 */
export type BrowserActionFailureCode = 'unavailable' | 'denied' | 'scope' | 'contract';

export class BrowserActionError extends Error {
  override readonly name = 'BrowserActionError';
  constructor(readonly code: BrowserActionFailureCode) {
    super(`Tool Action ${code} failure`);
  }
}

/**
 * The agent stage's durable claim, one row per Run (`run_agent_execution`).
 *
 * Its own row rather than a field on the adapter stage's checkpoint: the two are different
 * phases with different vocabularies, and a stage that borrowed another's checkpoint would
 * have to answer for a status it does not produce. `SIGNED_IN` is the phase's completion —
 * every agent-driven Target System of the frozen plan has an established session.
 */
export interface AgentExecutionCheckpoint {
  revision: number;
  status: 'EXECUTING' | 'SIGNED_IN' | 'RETRY' | 'TERMINAL';
  attempts: number;
  /** Copied from the population checkpoint's start: the Run deadline never restarts. */
  runStartedAt: string;
  startedAt: string;
  attemptStartedAt: string;
  leaseUntil: string;
  attemptId: string;
  diagnostic: string | null;
}

export interface AgentExecutionContext extends RunResultContext {
  run: RunRecord | null;
  checkpoint: AgentExecutionCheckpoint | null;
  /** The population stage's claim, so the agent stage inherits the Run's own deadline. */
  populationStartedAt: string | null;
  /** Whether the population stage has finished. The agent phase follows it (FR-20). */
  populationReady: boolean;
  /** The Agent Workspace this Run holds, or `null` when it has none. */
  workspace: { workspaceId: string; mode: string } | null;
  frozenPlan(): Promise<ExecutablePlan | null>;
  sessionSteps: readonly SessionStepRecord[];
  saveCheckpoint(checkpoint: AgentExecutionCheckpoint, state: RunRecord['state']): Promise<void>;
  saveSessionStep(step: SessionStepRecord): Promise<void>;
  saveStepExecution(execution: StepExecutionRecord): Promise<void>;
  /** Append one sanitized action to the shared log. The ONLY write path to it. */
  saveToolAction(action: SanitizedToolAction): Promise<void>;
  /** Every attempt this Run has already made, so the frozen limit counts them all. */
  readStepExecutionCount(): Promise<number>;
}

export interface AgentExecutionRepository {
  transaction<T>(
    runId: string,
    work: (context: AgentExecutionContext) => Promise<T>,
  ): Promise<T>;
  /** The agent phase's OWN read of the Runs it may resume. Never a surface's. */
  recoverableRunIds(limit: number): Promise<string[]>;
}
