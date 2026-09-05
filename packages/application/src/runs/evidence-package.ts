import {
  evidenceIdFor,
  evidenceIdempotencyKey,
  evidenceObjectKey,
  evidenceObjectKeys,
  isRequiredArtifact,
  sha256HexOfBytes,
  type EvidenceArtifactKind,
  type EvidenceReservation,
} from '@intellifin/domain';
import {
  PopulationAcquisitionError,
  type AdapterEvidenceRecord,
  type EvidenceStore,
} from './execution-ports.js';

/**
 * Reservation, upload and verification: the one owned mechanism (Story 3.5).
 *
 * Story 3.2 wrote this sequence by hand inside `acquire-population`, and Story 3.3 wrote
 * it again inside `execute-adapter-steps`. Two copies of a verification agree on every
 * artifact anybody thinks to try and diverge on the first one nobody does — and here the
 * thing that diverges is what "this artifact is what we froze" means. There is one copy
 * now and both producers call it.
 *
 * The sequence, in this order and never another:
 *
 * 1. **Reserve.** An idempotency key names the reservation; the Evidence id and the object
 *    key are DERIVED from it, so a retried production after a crash computes the same
 *    reservation instead of minting a second object. The row is written `RESERVED` in the
 *    same transaction as the unit's state and its audit event.
 * 2. **Upload.** Conditionally: an object already at the key is reconciled, never
 *    overwritten.
 * 3. **Verify.** Read back and compare availability, size and SHA-256 against the bytes
 *    that were sent AND against any digest a previous attempt already registered.
 * 4. **Register.** Only then, in one guarded transaction, `REGISTERED` with its digest,
 *    size and media type.
 *
 * Nothing here replaces, repairs or re-uploads bytes that fail verification: every failure
 * is an integrity failure the caller turns terminal, and the stored object is untouched.
 */

/** What one reservation is for, before anything has been stored against it. */
export interface ReservedArtifact {
  readonly reservation: EvidenceReservation;
  /** The exact string the Evidence id is a name for. Durable, versioned. */
  readonly idempotencyKey: string;
  readonly evidenceId: string;
  /** Every object key this reservation addresses; `[0]` is the primary artifact. */
  readonly objectKeys: readonly string[];
  readonly required: boolean;
}

/**
 * Name a reservation.
 *
 * Pure and total: it derives, it does not allocate. Calling it twice for one artifact —
 * on a first attempt and on a resumed one — yields the same id, the same key and the same
 * `required` verdict, which is what makes "the same reservation and object key are reused"
 * a property of the arithmetic rather than of a lookup somebody might skip.
 */
export function reserveArtifact(input: {
  readonly runId: string;
  readonly kind: EvidenceArtifactKind;
  /** The FROZEN Session Step id, or `''` for the Run-level population. */
  readonly scope: string;
  /** The frozen Template. An unknown one marks the artifact required: fail closed. */
  readonly templateId: string | null;
}): ReservedArtifact {
  const reservation: EvidenceReservation = {
    runId: input.runId,
    kind: input.kind,
    scope: input.scope,
  };
  return {
    reservation,
    idempotencyKey: evidenceIdempotencyKey(reservation),
    evidenceId: evidenceIdFor(reservation),
    objectKeys: evidenceObjectKeys(reservation),
    required: input.templateId === null ? true : isRequiredArtifact(input.templateId, input.kind),
  };
}

/** The reservation as an adapter-stage Evidence row, inheriting anything already frozen. */
export function adapterEvidenceRecord(
  reserved: ReservedArtifact,
  registrationId: string,
  prior: AdapterEvidenceRecord | undefined,
): AdapterEvidenceRecord {
  return {
    evidenceId: reserved.evidenceId,
    kind: reserved.reservation.kind as AdapterEvidenceRecord['kind'],
    registrationId,
    objectKey: evidenceObjectKey(reserved.reservation),
    mediaType: prior?.mediaType ?? null,
    digest: prior?.digest ?? null,
    size: prior?.size ?? null,
    required: reserved.required,
    // A REGISTERED row is never downgraded to RESERVED: it was registered, and saying
    // otherwise would be a lie about an artifact that exists.
    state: prior?.state === 'REGISTERED' ? 'REGISTERED' : 'RESERVED',
  };
}

/**
 * Upload one artifact and verify it before anything may call it registered.
 *
 * `putIfAbsent` reconciles rather than overwrites, so the bytes already in the store win.
 * The read-back then answers three separate questions, and all three have to pass:
 *
 * - **available** — the object is there at all;
 * - **size** — the stored length is the length that was sent;
 * - **digest** — the stored SHA-256 is the SHA-256 of what was sent, AND, when a previous
 *   attempt already registered one, the SHA-256 it registered. A resumed attempt therefore
 *   compares newly fetched bytes against what was already frozen rather than quietly
 *   accepting different ones.
 *
 * A failure throws `PopulationAcquisitionError('integrity')`. It never deletes, repairs or
 * re-uploads: a damaged object is a terminal integrity failure, and the bytes stay exactly
 * as they are so that what is there can be looked at.
 */
export async function freezeArtifact(
  store: EvidenceStore,
  input: {
    readonly objectKey: string;
    /** The digest a previous attempt registered for this key, or `null`. */
    readonly registeredDigest: string | null;
    readonly registeredSize: number | null;
  },
  bytes: Uint8Array,
  budget: () => number,
): Promise<{ digest: string; size: number }> {
  const sent = sha256HexOfBytes(bytes);
  await store.putIfAbsent(input.objectKey, bytes, budget());
  const stored = await store.read(input.objectKey, budget());
  if (stored === null) throw new PopulationAcquisitionError('integrity');
  const digest = sha256HexOfBytes(stored);
  if (stored.length !== bytes.length || digest !== sent) {
    throw new PopulationAcquisitionError('integrity');
  }
  if (input.registeredDigest !== null && input.registeredDigest !== digest) {
    throw new PopulationAcquisitionError('integrity');
  }
  if (input.registeredSize !== null && input.registeredSize !== stored.length) {
    throw new PopulationAcquisitionError('integrity');
  }
  return { digest, size: stored.length };
}

/**
 * Re-verify one already-registered artifact against the digest it was registered with.
 *
 * The resume and redelivery check. A Run that reaches a stage again re-reads what it
 * froze; stored bytes that no longer match are a terminal integrity failure DURING the Run
 * (`RUN_FAILED`), and the bytes are never replaced. The same disagreement found after the
 * Run is `verifySealedPackage`'s job and changes no state at all.
 */
export async function verifyRegisteredArtifact(
  store: EvidenceStore,
  artifact: { readonly objectKey: string; readonly digest: string | null; readonly size: number | null },
  budget: () => number,
): Promise<boolean> {
  if (artifact.digest === null) return false;
  const stored = await store.read(artifact.objectKey, budget());
  return (
    stored !== null &&
    sha256HexOfBytes(stored) === artifact.digest &&
    (artifact.size === null || stored.length === artifact.size)
  );
}
