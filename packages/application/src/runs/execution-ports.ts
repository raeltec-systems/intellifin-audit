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
  RaisedException,
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
 */
export type AcquisitionFailureCode = 'transport' | 'integrity' | 'contract' | 'denied' | 'scope';

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
export interface PopulationExecutionContext extends EvidencePackageContext {
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
  evaluate: () => Promise.resolve([]),
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
export interface RunGateContext extends EvidencePackageContext {
  /** Already-recorded Gate rows. The first Gate wins; a redelivery re-reads and writes nothing. */
  readGateChecks(): Promise<readonly GateCheckRow[]>;
  saveGateChecks(rows: readonly GateCheckRow[]): Promise<void>;
  /** The terminal transition this Gate decided. Sealed in the same transaction. */
  saveRunState(state: RunRecord['state']): Promise<void>;
  readPopulationFacts(): Promise<RunGatePopulationFacts | null>;
  /** Every parsed population row, in source order. Bounded by `POPULATION_LIMITS.rows`. */
  readPopulationRows(): Promise<readonly PopulationGateRow[]>;
  /** Every Observation, as the per-record coverage matrix reads it. */
  readGateObservations(): Promise<readonly CoverageObservation[]>;
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
