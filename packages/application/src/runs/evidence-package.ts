import {
  evidenceIdFor,
  evidenceIdempotencyKey,
  evidenceObjectKey,
  evidenceObjectKeys,
  isRequiredArtifact,
  sha256HexOfBytes,
  type EvidenceArtifactKind,
  type EvidenceCaptureMethod,
  type EvidenceReservation,
  type EvidenceArtifactRole,
} from '@intellifin/domain';
import {
  PopulationAcquisitionError,
  type AdapterEvidenceRecord,
  type EvidenceStore,
} from './execution-ports.js';
import type { CredentialGuard } from './credential-guard.js';

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
  /** What the artifact is FOR: `evidence` for a conclusion, `replay` for the session. */
  readonly role: EvidenceArtifactRole;
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
  /**
   * What the artifact is FOR (Story 5.2). `evidence` when omitted, because every producer
   * that existed before the role did was freezing bytes a Run concluded from.
   *
   * A `replay` reservation is never required, whatever the Template says: a frame the
   * session is watched by is not something a conclusion rests on, and a Run must never be
   * INCOMPLETE for one. The domain's seal filter and a CHECK say the same thing; this is
   * where a producer stops being able to ask for the contradiction in the first place.
   */
  readonly role?: EvidenceArtifactRole;
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
    role: input.role ?? 'evidence',
    required: input.role === 'replay'
      ? false
      : input.templateId === null ? true : isRequiredArtifact(input.templateId, input.kind),
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
    // The role is the RESERVATION's, never the prior row's: a reservation is what decides
    // what an artifact is for, and a resumed attempt reserves the same thing it did.
    role: reserved.role,
    mediaType: prior?.mediaType ?? null,
    digest: prior?.digest ?? null,
    size: prior?.size ?? null,
    required: reserved.required,
    // A REGISTERED row is never downgraded to RESERVED: it was registered, and saying
    // otherwise would be a lie about an artifact that exists.
    state: prior?.state === 'REGISTERED' ? 'REGISTERED' : 'RESERVED',
    // A reservation has captured nothing, so it carries no capture provenance — and a
    // resumed attempt inherits what the attempt that really captured the bytes recorded,
    // never a fresh instant for a re-read.
    capturedAt: prior?.capturedAt ?? null,
    captureMethod: prior?.captureMethod ?? null,
    captureTimeSource: prior?.captureTimeSource ?? null,
  };
}

/**
 * The ONE way an Evidence record becomes `REGISTERED` (owner decision, 2026-09-06).
 *
 * FR-31 requires a capture method and a capture time in UTC on every Evidence item, and
 * neither can be a field a producer remembers to set: three call sites in
 * `execute-adapter-steps.ts` each spread `{...evidence, state: 'REGISTERED'}` by hand, and
 * a fourth written later would have been registered with no provenance at all and nothing
 * to say so. Registration goes through here, so the provenance is a property of becoming
 * registered rather than of remembering to.
 *
 * The capture time is MEASURED — the clock read inside the transaction that writes
 * `REGISTERED` — and its source says exactly that. An artifact a previous attempt already
 * registered keeps the instant IT recorded: re-verifying bytes is not re-capturing them,
 * and moving the time forward on every redelivery would make an artifact look younger than
 * the Run that froze it.
 */
export function registerEvidence(
  evidence: AdapterEvidenceRecord,
  frozen: { readonly digest: string; readonly size: number },
  capture: { readonly mediaType?: string | null; readonly capturedAt: string; readonly method: EvidenceCaptureMethod },
): AdapterEvidenceRecord {
  const first = evidence.capturedAt === null;
  return {
    ...evidence,
    ...(capture.mediaType === undefined ? {} : { mediaType: capture.mediaType }),
    digest: frozen.digest,
    size: frozen.size,
    state: 'REGISTERED',
    capturedAt: first ? capture.capturedAt : evidence.capturedAt,
    captureMethod: first ? capture.method : evidence.captureMethod,
    captureTimeSource: first ? 'registration' : evidence.captureTimeSource,
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
 *
 * **The credential wall (Story 4.3).** Before ANYTHING is uploaded, the bytes are scanned
 * for every credential the stage has presented, and an artifact that discloses one is
 * REFUSED — `PopulationAcquisitionError('credential')`, nothing written to the store, no
 * digest, no registration. It runs before the upload rather than after the read-back so
 * that "nothing is stored" is literally true rather than nearly true: the object store is
 * append-only and immutable by design, so an artifact that reached it could not be taken
 * back out.
 *
 * It is a REFUSAL and never a redaction. Bytes a Target System served are Evidence, and
 * rewriting them to make them acceptable would be falsifying what a system answered. An
 * artifact this PLATFORM produced is redacted by its producer — through the same guard,
 * before it gets here — and if it still discloses a credential afterwards, that is a
 * defect in the redaction and it has to fail loudly rather than be quietly re-redacted.
 *
 * `guard` is a REQUIRED argument, so a producer must decide what it is scanning for.
 * `NO_CREDENTIALS` is the explicit "this stage has presented none", which is the truth for
 * the population stage: the population is acquired before any credential is resolved.
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
  guard: CredentialGuard,
): Promise<{ digest: string; size: number }> {
  if (guard.discloses(bytes)) throw new PopulationAcquisitionError('credential');
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
  return (await readRegisteredArtifact(store, artifact, budget)) !== null;
}

/**
 * The same check, returning the bytes it verified.
 *
 * A resumed Run needs both: that the stored artifact is still the one it froze, and — for a
 * Reference Source the evaluator consults — what it says. Two functions that each read and
 * compared would be two answers to "is this what we froze"; this is the one, and
 * `verifyRegisteredArtifact` is its verdict. `null` means unverifiable, never "empty".
 */
export async function readRegisteredArtifact(
  store: EvidenceStore,
  artifact: { readonly objectKey: string; readonly digest: string | null; readonly size: number | null },
  budget: () => number,
): Promise<Uint8Array | null> {
  if (artifact.digest === null) return null;
  const stored = await store.read(artifact.objectKey, budget());
  if (stored === null || sha256HexOfBytes(stored) !== artifact.digest) return null;
  return artifact.size === null || stored.length === artifact.size ? stored : null;
}
