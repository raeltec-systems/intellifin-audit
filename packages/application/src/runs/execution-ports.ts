import type {
  ExplicitPeriod,
  ProcedureSourceSnapshot,
  ProcedureTargetSnapshot,
  ExecutablePlan,
  JsonValue,
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

export interface AdapterExecutionContext {
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
  /** Insert Observations. Re-inserting an existing one is a no-op, never a duplicate. */
  saveObservations(observations: readonly ObservationRecord[]): Promise<void>;
  notifyTimeline(sequence: number): Promise<void>;
}

export interface AdapterExecutionRepository {
  transaction<T>(
    runId: string,
    work: (context: AdapterExecutionContext) => Promise<T>,
  ): Promise<T>;
  /** Runs whose population is ready and whose extraction is unclaimed or stale. */
  recoverableRunIds(limit: number): Promise<string[]>;
}
