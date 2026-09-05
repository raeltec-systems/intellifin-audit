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
 * Session Step id for a Reference Source or an adapter extraction, and the empty string
 * for the Run-level population, which there is exactly one of.
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
}

/** What sealing decided, and why. */
export interface PackageSealDecision {
  readonly state: PackageSealState;
  /** Required artifacts that never reached `REGISTERED`. Named on the Result. */
  readonly missingRequired: readonly PackageArtifact[];
  /** Reservations still open at the terminal transition. They become `ABANDONED`. */
  readonly abandoned: readonly PackageArtifact[];
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
  const required = settled.filter((artifact) => artifact.required);
  const missingRequired = required.filter((artifact) => artifact.state !== 'REGISTERED');
  return {
    state: missingRequired.length === 0 ? 'SEALED' : 'INCOMPLETE',
    missingRequired,
    abandoned,
    registered: settled.filter((artifact) => artifact.state === 'REGISTERED').length,
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
