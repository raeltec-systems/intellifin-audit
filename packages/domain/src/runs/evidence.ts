import { canonicalJson, type JsonValue } from '../canonical-json.js';
import { sha256Hex } from '../sha256.js';
import { PLAN_LOOKUP_COLUMNS } from '../procedures/executable-plan.js';

/**
 * The Evidence package: what a Run may be sealed with, and what it may not (Story 3.5).
 *
 * Pure. No I/O, no clock, no host types. Everything here decides MEANING; the one
 * transactional mechanism that reserves, verifies, registers and seals is
 * `packages/application/src/runs/evidence-package.ts` and `seal-package.ts`, which every
 * producer goes through — the containment `registerObservations` already gives the §B.1
 * wire schema, one layer along.
 *
 * Three things live here because putting them anywhere else means writing them twice:
 *
 * 1. **The reservation name.** An Evidence id is DERIVED from `(runId, kind, scope)`, not
 *    minted, exactly as an Observation id is derived from `(workItemId, recordKey)`. A
 *    retried production after a crash therefore computes the SAME id and the SAME object
 *    key, so it reuses its reservation instead of minting a second object beside the
 *    first — which is the whole of the "retried production" acceptance criterion, made
 *    structural rather than remembered.
 * 2. **The object keys.** One place knows how an artifact is addressed in the store. Two
 *    places would agree on every artifact anybody thought to try.
 * 3. **The sealable decision.** Whether a package seals, which artifacts are missing and
 *    which reservations are abandoned, as a function of the artifacts alone.
 */

/**
 * What kinds of artifact a Run freezes.
 *
 * `population` is ONE reservation covering TWO objects — the raw source bytes and the
 * acquisition envelope that preserves the declaration beside them. They are fetched,
 * verified and registered together and neither means anything without the other, so
 * splitting them into two reservations would invent a state ("the envelope registered,
 * the bytes did not") that no producer can reach and no reader could act on.
 */
export const EVIDENCE_ARTIFACT_KINDS = [
  'population',
  'reference-source',
  'adapter-extraction',
  'structural-snapshot',
  'screenshot',
] as const;
export type EvidenceArtifactKind = (typeof EVIDENCE_ARTIFACT_KINDS)[number];

/**
 * The lifecycle of one reservation.
 *
 * `RESERVED` is a name and an object key with nothing verified behind them yet.
 * `REGISTERED` is bytes whose availability, size and SHA-256 were verified against the
 * recorded values before the transaction that wrote this state. `ABANDONED` is a
 * reservation whose upload never completed — never a registered artifact demoted, because
 * an artifact that exists cannot be un-existed by a later sentence about it.
 */
export const EVIDENCE_ARTIFACT_STATES = ['RESERVED', 'REGISTERED', 'ABANDONED'] as const;
export type EvidenceArtifactState = (typeof EVIDENCE_ARTIFACT_STATES)[number];

/**
 * WHAT an artifact is for (Story 5.2, FR-30, AD-5).
 *
 * `evidence` is what a Run concluded FROM: the bytes an auditor's finding rests on, and
 * the only role a Run can be incomplete for. `replay` is what a Run is WATCHED BY: the
 * frames, the sanitized actions and the Escalation and Session Step records that let a
 * terminal Run be replayed without the platform ever calling the Workspace Provider again.
 *
 * The distinction is a ROLE and not a kind, because the same kind sits on both sides: the
 * screenshot an Observation is grounded in is `evidence`, and the screenshot captured after
 * every Tool Action so the session can be replayed is `replay`. A kind cannot say which,
 * and a naming convention would be one anybody could satisfy by typing.
 *
 * A missing `replay` artifact degrades a replay and is recorded as such; it can never make
 * a package INCOMPLETE, which `sealPackageDecision` enforces by construction rather than by
 * trusting every producer to leave `required` false.
 */
export const EVIDENCE_ARTIFACT_ROLES = ['evidence', 'replay'] as const;
export type EvidenceArtifactRole = (typeof EVIDENCE_ARTIFACT_ROLES)[number];

/**
 * HOW an artifact was captured — FR-31's "capture method", as a STORED value.
 *
 * It used to be derived on the way to the screen from the artifact's KIND, which was true
 * of every kind Epic 3 writes and stops being true the moment one process can produce a
 * kind another also produces: a Structural Snapshot is captured by the agent, and the
 * adapter path may freeze the same substrate. A field FR-31 requires on every Evidence
 * item has to be recorded by the process that captured it, not inferred later by the
 * process that displays it.
 *
 * It is the SAME two words `OBSERVATION_CAPTURE_METHODS` uses, deliberately re-exported
 * rather than retyped: an Observation's capture method and its Evidence's answer the one
 * question — which process took this — and two lists would agree on `adapter` and diverge
 * on the first value only one of them learned.
 */
export const EVIDENCE_CAPTURE_METHODS = ['agent', 'adapter'] as const;
export type EvidenceCaptureMethod = (typeof EVIDENCE_CAPTURE_METHODS)[number];

export function isEvidenceCaptureMethod(value: unknown): value is EvidenceCaptureMethod {
  return typeof value === 'string' && (EVIDENCE_CAPTURE_METHODS as readonly string[]).includes(value);
}

/**
 * Where an artifact's recorded capture time CAME FROM.
 *
 * FR-31 asks for a capture time in UTC, and there are two honest ways to have one:
 *
 * - `registration` — the instant the producer registered the artifact, read from the
 *   clock inside the transaction that wrote `REGISTERED`. It is the measured value and it
 *   is what every artifact frozen from generation 32 onwards carries.
 * - `step-execution` — the completion of the Step Execution that uploaded, verified and
 *   registered the bytes. It is RECOVERED rather than measured, and rows written before
 *   generation 32 carry it because that is the only real instant those rows can be
 *   attributed to.
 *
 * There is deliberately no third value for "we made one up". An artifact with no
 * recoverable instant keeps a null capture time and the surface says so in words — the
 * same refusal generation 20 made when it would not backfill a digest, and generation 24
 * when it would not default a snapshot's generation time to `now()`.
 */
export const EVIDENCE_CAPTURE_TIME_SOURCES = ['registration', 'step-execution'] as const;
export type EvidenceCaptureTimeSource = (typeof EVIDENCE_CAPTURE_TIME_SOURCES)[number];

export function isEvidenceCaptureTimeSource(value: unknown): value is EvidenceCaptureTimeSource {
  return (
    typeof value === 'string' &&
    (EVIDENCE_CAPTURE_TIME_SOURCES as readonly string[]).includes(value)
  );
}

/**
 * The capture provenance of one artifact: when it was captured, how, and how we know when.
 *
 * Written whole or not at all. A time with no source is a number a reader would take for
 * measured, and a source with no time names a provenance for nothing.
 */
export interface EvidenceCapture {
  readonly capturedAt: string | null;
  readonly captureMethod: EvidenceCaptureMethod | null;
  readonly captureTimeSource: EvidenceCaptureTimeSource | null;
}

/**
 * The seal outcome.
 *
 * `SEALED` means every artifact the Run marked `required` is Registered and verified.
 * `INCOMPLETE` is the honest alternative and is NOT a failure of the seal: the seal runs
 * on every terminal transition whatever the outcome, and an incomplete package names its
 * gap on the Result rather than being quietly absent.
 */
export const PACKAGE_SEAL_STATES = ['SEALED', 'INCOMPLETE'] as const;
export type PackageSealState = (typeof PACKAGE_SEAL_STATES)[number];

/**
 * What a post-Run verification can find. A closed vocabulary of constants: never an
 * error message, never a URL, never a byte of the artifact itself.
 */
export const EVIDENCE_INTEGRITY_FINDINGS = [
  'object-missing',
  'size-mismatch',
  'digest-mismatch',
] as const;
export type EvidenceIntegrityFindingKind = (typeof EVIDENCE_INTEGRITY_FINDINGS)[number];

/**
 * The artifact kinds a Run of each Template may not conclude without.
 *
 * All four Templates agree today, and the table exists anyway because `required` is a
 * per-Template question the moment one Template freezes an artifact another does not.
 *
 * `adapter-extraction` is deliberately NOT required, and that is the only interesting row.
 * The owner's 2026-09-05 decision says a Work Item that exhausts both retry cycles is
 * marked FAILED, the Run CONTINUES, and incomplete coverage becomes `INCONCLUSIVE` at the
 * Run-level Gate. That is the Gate's judgement, stated once, in coverage. Making the same
 * fact also make the package incomplete would say it twice in two vocabularies, and would
 * mean no `INCONCLUSIVE` Run could ever hold a complete package — which drains the word of
 * meaning. Traceability does not depend on it either: the `required-evidence` check
 * refuses an Observation whose linked Evidence is not `REGISTERED`, so an Exception can
 * never trace to an extraction that is not there.
 *
 * What IS required is what the Run concluded FROM: the population it scoped itself by, and
 * the Reference Sources its evaluator consults.
 */
const REQUIRED_EVIDENCE_KINDS: Readonly<Record<string, readonly EvidenceArtifactKind[]>> = {
  'P-1': ['population', 'reference-source'],
  'P-2': ['population', 'reference-source'],
  'P-3': ['population', 'reference-source'],
  'P-4': ['population', 'reference-source'],
};

export function isEvidenceArtifactKind(value: unknown): value is EvidenceArtifactKind {
  return typeof value === 'string' && (EVIDENCE_ARTIFACT_KINDS as readonly string[]).includes(value);
}

export function isEvidenceArtifactState(value: unknown): value is EvidenceArtifactState {
  return (
    typeof value === 'string' && (EVIDENCE_ARTIFACT_STATES as readonly string[]).includes(value)
  );
}

/**
 * The artifact kinds this Template's Runs may not conclude without, or `null` for a
 * Template this build does not know.
 *
 * `Object.hasOwn`, because a template id read out of a frozen plan is request-shaped input
 * like any other and `REQUIRED_EVIDENCE_KINDS['constructor']` is a function.
 */
export function requiredEvidenceKinds(templateId: string): readonly EvidenceArtifactKind[] | null {
  if (!Object.hasOwn(REQUIRED_EVIDENCE_KINDS, templateId)) return null;
  return REQUIRED_EVIDENCE_KINDS[templateId]!;
}

/**
 * Is an artifact of this kind required for a Run of this Template?
 *
 * `required` is a flag on a RESERVATION, not a checklist of kinds a Template could have.
 * A Run that failed before it ever reserved a Reference Source is not incomplete for an
 * artifact nobody asked for; a Run that reserved one and never registered it is.
 */
export function isRequiredArtifact(templateId: string, kind: EvidenceArtifactKind): boolean {
  return requiredEvidenceKinds(templateId)?.includes(kind) ?? false;
}

/** Every template id the required rule is written for, so a test can walk them all. */
export const REQUIRED_EVIDENCE_TEMPLATE_IDS: readonly string[] = Object.keys(PLAN_LOOKUP_COLUMNS);

/**
 * The stable identity of one reservation.
 *
 * `scope` is what distinguishes two reservations of one kind inside one Run: the FROZEN
 * Session Step id for a Reference Source, the frozen Session Step id AND the attempt
 * number for an adapter extraction (`adapterExtractionScope`), and the empty string for
 * the Run-level population, which there is exactly one of.
 */
export interface EvidenceReservation {
  readonly runId: string;
  readonly kind: EvidenceArtifactKind;
  readonly scope: string;
}

/** A scope has to be usable as an object-key segment, and is a frozen id or empty. */
const SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class EvidenceReservationError extends Error {
  override readonly name = 'EvidenceReservationError';
}

/**
 * The scope of ONE adapter extraction ATTEMPT.
 *
 * An adapter extraction is frozen BEFORE it is parsed, and a failed attempt keeps its
 * bytes registered — both deliberate, because a response that is not a declared collection
 * is still what the Target System answered. What follows from those two rules is that a
 * SECOND attempt has different bytes to freeze, and `putIfAbsent` reconciles rather than
 * overwrites: with a key derived from the step id alone, every retry read back attempt 1's
 * object, found a digest that did not match, and died with an integrity failure against a
 * Target System that was answering perfectly well. A gateway answering one maintenance
 * page therefore spent all eight attempts and cost the Run that system's coverage, and the
 * owner's two bounded retry cycles were decorative for exactly the transient failure they
 * exist for.
 *
 * So the attempt is part of the name. Each attempt freezes its own artifact, every one is
 * preserved, and the Work Item names the one it concluded from. There is no scope here
 * for a Reference Source: a Session Step is acquired without being parsed, so its retries
 * only ever run when nothing was frozen at all.
 */
export function adapterExtractionScope(stepId: string, attempt: number): string {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new EvidenceReservationError('attempt');
  return `${stepId}.a${String(attempt)}`;
}

function assertReservation(reservation: EvidenceReservation): void {
  if (!isEvidenceArtifactKind(reservation.kind)) throw new EvidenceReservationError('kind');
  if (typeof reservation.runId !== 'string' || !SCOPE_PATTERN.test(reservation.runId)) {
    throw new EvidenceReservationError('run');
  }
  if (reservation.kind === 'population') {
    if (reservation.scope !== '') throw new EvidenceReservationError('scope');
    return;
  }
  if (typeof reservation.scope !== 'string' || !SCOPE_PATTERN.test(reservation.scope)) {
    throw new EvidenceReservationError('scope');
  }
}

/**
 * The idempotency key of one reservation: the exact string an Evidence id is a name for.
 *
 * Versioned, because it is a durable identity: changing how a key is spelled would rename
 * every artifact of every Run in flight, and a Run that resumed across the change would
 * reserve a second object beside the one it already had.
 */
export function evidenceIdempotencyKey(reservation: EvidenceReservation): string {
  assertReservation(reservation);
  return `evidence-v1:${reservation.runId}:${reservation.kind}:${reservation.scope}`;
}

/**
 * The Evidence id of one reservation — DERIVED, never minted.
 *
 * RFC 9562 §5.8 UUIDv8 over a SHA-256 of the canonical JSON of the idempotency key, the
 * same shape `observationIdFor` uses. A retried production after a crash therefore names
 * the artifact it already reserved instead of minting a second one, and the unique object
 * key means the store would refuse a second object anyway. Nothing here is a secret and
 * nothing here is random; it is a name.
 */
export function evidenceIdFor(reservation: EvidenceReservation): string {
  const hash = sha256Hex(canonicalJson(evidenceIdempotencyKey(reservation) as unknown as JsonValue));
  const variant = ((Number.parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
  return (
    `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-` +
    `${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`
  );
}

/**
 * Every object key one reservation addresses, in a fixed order.
 *
 * One key for a Reference Source or an adapter extraction. TWO for the population, and
 * the order is load-bearing: `[0]` is the raw source bytes and `[1]` is the acquisition
 * envelope that preserves the declaration beside them.
 *
 * These are exactly the keys Stories 3.2 and 3.3 already wrote, so this is where they are
 * spelled and not a new naming scheme: an artifact frozen by an earlier build resolves to
 * the same object.
 */
export function evidenceObjectKeys(reservation: EvidenceReservation): readonly string[] {
  assertReservation(reservation);
  switch (reservation.kind) {
    case 'population':
      return [
        `population/${reservation.runId}/raw`,
        `population/${reservation.runId}/acquisition-v1`,
      ];
    case 'reference-source':
      return [`reference/${reservation.runId}/${reservation.scope}`];
    case 'adapter-extraction':
      return [`extraction/${reservation.runId}/${reservation.scope}`];
    case 'structural-snapshot':
      return [`snapshot/${reservation.runId}/${reservation.scope}`];
    case 'screenshot':
      return [`screenshot/${reservation.runId}/${reservation.scope}`];
  }
}

/** The primary object key of a reservation: the artifact a reader means when they say it. */
export function evidenceObjectKey(reservation: EvidenceReservation): string {
  return evidenceObjectKeys(reservation)[0]!;
}

/**
 * One artifact of a package, as the seal reads it.
 *
 * This is deliberately the whole of what sealing needs: an identity, what the artifact is,
 * whether the Run may conclude without it, and what state it reached. There is nowhere
 * here for bytes, a location, a credential reference or a media type, so nothing the seal
 * records can carry one.
 */
export interface PackageArtifact {
  readonly evidenceId: string;
  readonly kind: EvidenceArtifactKind;
  readonly objectKey: string;
  readonly required: boolean;
  readonly state: EvidenceArtifactState;
  /** `evidence` for anything a Run concluded from; `replay` for what it is watched by. */
  readonly role: EvidenceArtifactRole;
}

/** What sealing decided, and why. */
export interface PackageSealDecision {
  readonly state: PackageSealState;
  /** Required artifacts that never reached `REGISTERED`. Named on the Result. */
  readonly missingRequired: readonly PackageArtifact[];
  /** Reservations still open at the terminal transition. They become `ABANDONED`. */
  readonly abandoned: readonly PackageArtifact[];
  /**
   * The artifacts this Run really froze, BY IDENTITY.
   *
   * `registered` is their count and stays exact; this is the list the Result names, so
   * that "Inconclusive with Evidence" and "Inconclusive with nothing" are two different
   * documents rather than two readings of one count. A Run stopped by its own time limit
   * after acquiring, storing and verifying a population is the case the distinction was
   * added for: the population is registered, and a Result that only counted it left an
   * auditor unable to tell that from a Run that acquired nothing at all.
   */
  readonly registeredArtifacts: readonly PackageArtifact[];
  readonly registered: number;
  readonly requiredTotal: number;
}

/**
 * Can this package be sealed, and what has to be abandoned first?
 *
 * The order matters and is the whole of the rule: every still-open reservation is
 * abandoned FIRST, and completeness is then judged over the artifacts as they will be —
 * so a required artifact whose upload never completed is missing, not pending. A package
 * judged before abandonment would seal on a reservation that was about to be abandoned in
 * the same transaction.
 *
 * Nothing here deletes or rewrites an artifact, and there is no path through this function
 * that could: it returns a decision over the input and never a mutation.
 */
export function sealPackageDecision(
  artifacts: readonly PackageArtifact[],
): PackageSealDecision {
  const abandoned = artifacts.filter((artifact) => artifact.state === 'RESERVED');
  const settled = artifacts.map((artifact) =>
    artifact.state === 'RESERVED' ? { ...artifact, state: 'ABANDONED' as const } : artifact,
  );
  // A `replay` artifact can never gate the seal, whatever its `required` flag says. The
  // filter is the enforcement: a producer that set the flag wrongly, or a row an older
  // build wrote, cannot make a Run INCOMPLETE for a frame nobody concluded anything from.
  const required = settled.filter((artifact) => artifact.required && artifact.role === 'evidence');
  const missingRequired = required.filter((artifact) => artifact.state !== 'REGISTERED');
  // ONE walk decides both the list and the count, so the two can never disagree about what
  // this Run froze. A count derived separately from the list is the "two answers to one
  // question" this module exists to prevent.
  const registeredArtifacts = settled.filter((artifact) => artifact.state === 'REGISTERED');
  return {
    state: missingRequired.length === 0 ? 'SEALED' : 'INCOMPLETE',
    missingRequired,
    abandoned,
    registeredArtifacts,
    registered: registeredArtifacts.length,
    requiredTotal: required.length,
  };
}

/**
 * The Run states a package is sealed at.
 *
 * Every terminal transition, whatever the outcome — a sealed package is not a reward for
 * a Run that succeeded, it is the record of what the Run froze.
 */
export const TERMINAL_RUN_STATES = [
  'COMPLETED',
  'INCONCLUSIVE',
  'RUN_FAILED',
  'CANCELED',
] as const;

export function isTerminalRunState(state: unknown): boolean {
  return typeof state === 'string' && (TERMINAL_RUN_STATES as readonly string[]).includes(state);
}

/**
 * What a verification of one already-registered artifact concluded.
 *
 * `expectedDigest` and `observedDigest` are digests, not bytes: a SHA-256 of an artifact
 * is what an auditor compares, it is already in the audit chain from registration, and it
 * is not a credential. The artifact's CONTENT never appears here.
 */
export interface EvidenceVerification {
  readonly evidenceId: string;
  readonly objectKey: string;
  readonly finding: EvidenceIntegrityFindingKind | null;
  readonly expectedDigest: string;
  readonly observedDigest: string | null;
  /**
   * The size registration recorded, or `null` where none was.
   *
   * The population's acquisition envelope is the one artifact whose length was never
   * stored separately, so it is verified by digest alone. Inventing an `expectedSize` for
   * it would put a number nobody measured into an immutable chain, and the digest already
   * makes every size check the size comparison would have made.
   */
  readonly expectedSize: number | null;
  readonly observedSize: number | null;
}

/**
 * Compare a registered artifact with what the store holds now.
 *
 * Availability, then size, then digest — in that order, so a missing object is reported as
 * missing rather than as a digest that failed to match nothing. Pure: the caller does the
 * read and hands the bytes here, because the domain has no host types to read with.
 */
export function verifyStoredArtifact(input: {
  readonly evidenceId: string;
  readonly objectKey: string;
  readonly expectedDigest: string;
  readonly expectedSize: number | null;
  /** The stored bytes' length and SHA-256, or `null` when the object is not there. */
  readonly stored: { readonly size: number; readonly digest: string } | null;
}): EvidenceVerification {
  const common = {
    evidenceId: input.evidenceId,
    objectKey: input.objectKey,
    expectedDigest: input.expectedDigest,
    expectedSize: input.expectedSize,
  };
  if (input.stored === null) {
    return { ...common, finding: 'object-missing', observedDigest: null, observedSize: null };
  }
  const observed = { observedDigest: input.stored.digest, observedSize: input.stored.size };
  if (input.expectedSize !== null && input.stored.size !== input.expectedSize) {
    return { ...common, ...observed, finding: 'size-mismatch' };
  }
  if (input.stored.digest !== input.expectedDigest) {
    return { ...common, ...observed, finding: 'digest-mismatch' };
  }
  return { ...common, ...observed, finding: null };
}
