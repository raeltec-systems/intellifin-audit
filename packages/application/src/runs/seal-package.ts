import {
  isTerminalRunState,
  sealPackageDecision,
  sha256HexOfBytes,
  verifyStoredArtifact,
  type EvidenceVerification,
  type PackageArtifact,
  type RunRecord,
} from '@intellifin/domain';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import {
  type EvidenceIntegrityRecord,
  type EvidencePackageContext,
  type EvidenceStore,
  type PackageArtifactRef,
  type PackageSeal,
  type SealedPackageContext,
  type SealedPackageRepository,
} from './execution-ports.js';

/**
 * `SealPackage`: what happens to the Evidence package at every terminal transition, and
 * what happens to an integrity mismatch found afterwards (Story 3.5).
 *
 * Two commands live here because they are the two halves of one rule, and separating them
 * across files would let the second forget what the first promised:
 *
 * - **`sealPackage`** runs on EVERY terminal transition, whatever the outcome. It marks
 *   every still-open reservation `abandoned`, seals only when every artifact marked
 *   `required` is Registered and verified, and records both the gap and the abandonments
 *   on the seal the Result reads. It never deletes or rewrites an artifact to succeed —
 *   there is no path through it that could, because the only mutation it can reach is
 *   `abandonArtifacts`, and abandoning a registered artifact is not one of its outcomes.
 * - **`verifySealedPackage`** is the AFTER-the-Run check. The same disagreement that ends
 *   a running Run `RUN_FAILED` is, once the Run is terminal, an Audit Trail integrity
 *   event flagged on the Result and the exports, changing no state. The context it is
 *   handed has no way to write a Run state, a seal or an artifact, so "changes no state"
 *   is a property of what it can reach and not of what it remembers not to do.
 */

/** The audit event a seal appends. Its payload names artifacts, never their bytes. */
const SEAL_EVENT = 'lifecycle.evidence-package-sealed';
/**
 * The audit event a post-Run mismatch appends. Also artifacts, also never bytes.
 *
 * The family is `failure`, because `integrity` is not one of the nine documented families
 * and inventing a tenth in a story that does not own the vocabulary would be a schema
 * change smuggled in as a string.
 */
const INTEGRITY_EVENT = 'failure.evidence-integrity';

function ref(artifact: PackageArtifact): PackageArtifactRef {
  return {
    evidenceId: artifact.evidenceId,
    kind: artifact.kind,
    objectKey: artifact.objectKey,
  };
}

/**
 * Seal the Evidence package of one Run, inside the caller's terminal transaction.
 *
 * Idempotent: the FIRST seal wins and a second call returns it unchanged. A sealed outcome
 * is immutable — the epic's "no later mutation can change a sealed outcome" — and the
 * database refuses an update to the row as well, so a second seal cannot rewrite the first
 * even from psql.
 *
 * Ordering is load-bearing. Reservations are abandoned BEFORE the seal row is written,
 * because completeness is judged over the artifacts as they will be: a package judged
 * first would seal on a reservation the same transaction was about to abandon. The
 * database's own guard reads the artifacts at insert time and would refuse it anyway.
 */
export async function sealPackage(
  context: EvidencePackageContext,
  input: {
    readonly run: RunRecord;
    /** The terminal state this transition is committing. */
    readonly terminalState: RunRecord['state'];
    readonly sealedAt: string;
  },
): Promise<PackageSeal> {
  const existing = await context.readSeal();
  if (existing !== null) return existing;
  if (!isTerminalRunState(input.terminalState)) {
    // A seal at a non-terminal state would freeze a package the Run is still writing to.
    throw new PackageSealError('not-terminal');
  }

  const artifacts = await context.readPackageArtifacts();
  const decision = sealPackageDecision(artifacts);
  if (decision.abandoned.length > 0) {
    await context.abandonArtifacts(decision.abandoned.map((artifact) => artifact.evidenceId));
  }
  const seal: PackageSeal = {
    runId: input.run.runId,
    state: decision.state,
    runState: input.terminalState,
    sealedAt: input.sealedAt,
    requiredTotal: decision.requiredTotal,
    registered: decision.registered,
    missingRequired: decision.missingRequired.map(ref),
    abandoned: decision.abandoned.map(ref),
  };
  await context.writeSeal(seal);

  const stored = await context.auditEvents.append({
    actor: { type: 'system', id: 'evidence-sealer' },
    eventType: SEAL_EVENT,
    source: 'worker',
    // An incomplete package is a truthful record of an incomplete Run, not a failed seal.
    // The Run's own outcome carries the failure; saying it twice would double-count it.
    outcome: 'success',
    aggregateId: input.run.runId,
    correlationId: input.run.correlationId,
    sessionId: input.run.sessionId,
    payload: {
      seal: seal.state,
      runState: seal.runState,
      artifacts: artifacts.length,
      registered: seal.registered,
      requiredTotal: seal.requiredTotal,
      // Identities and object keys only. There is no field here for bytes, a media type,
      // a location or a credential reference, and `FORBIDDEN_PAYLOAD_KEYS` refuses a
      // credential-shaped key outright: the chain is immutable, so anything that enters
      // it can never be taken out.
      missingRequired: seal.missingRequired.map((artifact) => artifact.objectKey),
      abandoned: seal.abandoned.map((artifact) => artifact.objectKey),
    },
  });
  await context.notifyTimeline(stored.sequence);
  return seal;
}

/** Why a seal was refused. A closed vocabulary; never a value and never a message. */
export type PackageSealRefusal = 'not-terminal' | 'not-sealed' | 'run-not-terminal';

export class PackageSealError extends Error {
  override readonly name = 'PackageSealError';
  readonly refusal: PackageSealRefusal;

  constructor(refusal: PackageSealRefusal) {
    super(`Evidence package seal refused: ${refusal}`);
    this.refusal = refusal;
  }
}

export interface SealedPackageVerificationDependencies {
  repository: SealedPackageRepository;
  store: EvidenceStore;
  clock: Clock;
  ids: UuidV7Generator;
  /** Per-object read budget, in milliseconds. Bounded like every other store read. */
  readTimeoutMs?: number;
}

export interface SealedPackageVerification {
  readonly verified: number;
  readonly findings: readonly EvidenceIntegrityRecord[];
  /** Findings this call added. A re-verification of a known mismatch adds none. */
  readonly recorded: number;
}

const DEFAULT_READ_TIMEOUT_MS = 30_000;

/**
 * Verify a SEALED package's registered artifacts against what the store holds now.
 *
 * This is the "mismatch after the Run" half of the rule. It refuses a Run that is not
 * terminal, because during a Run the same disagreement is an in-Run integrity failure that
 * ends it `RUN_FAILED` — one fact, two timings, two different consequences, and letting
 * this command run early would produce the wrong one.
 *
 * The store reads happen OUTSIDE the transaction, as every other external I/O in this
 * module does. The transaction that follows adds finding rows and appends events; it
 * changes no Run state, no seal and no artifact, and it never rewrites the bytes. A
 * mismatch is corrected only by a new Run.
 */
export async function verifySealedPackage(
  deps: SealedPackageVerificationDependencies,
  runId: string,
): Promise<SealedPackageVerification> {
  const claim = await deps.repository.transaction(runId, async (context) => {
    const run = context.run;
    if (run === null) return null;
    const seal = await context.readSeal();
    if (seal === null) throw new PackageSealError('not-sealed');
    if (!isTerminalRunState(run.state)) throw new PackageSealError('run-not-terminal');
    return { run, artifacts: await context.readRegisteredArtifacts() };
  });
  if (claim === null) return { verified: 0, findings: [], recorded: 0 };

  const timeout = deps.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const verifications: EvidenceVerification[] = [];
  for (const artifact of claim.artifacts) {
    // A store that cannot be READ is not proof of tampering, and a read failure is
    // deliberately not caught here: recording it as `object-missing` would put an outage
    // into an immutable chain as an integrity event about an artifact that is probably
    // fine. `read` answers `null` for an object that is genuinely absent; anything else
    // throws, and the caller sees the failure instead of a fabricated finding.
    const bytes = await deps.store.read(artifact.objectKey, timeout);
    const stored =
      bytes === null ? null : { size: bytes.length, digest: sha256HexOfBytes(bytes) };
    verifications.push(
      verifyStoredArtifact({
        evidenceId: artifact.evidenceId,
        objectKey: artifact.objectKey,
        expectedDigest: artifact.digest,
        expectedSize: artifact.size,
        stored,
      }),
    );
  }

  const failed = verifications.filter((entry) => entry.finding !== null);
  return deps.repository.transaction(runId, async (context) => {
    const run = context.run;
    if (run === null) return { verified: verifications.length, findings: [], recorded: 0 };
    const known = await context.readIntegrityFindings();
    // Keyed by (Evidence, OBJECT, finding), exactly as the unique index is. The population
    // reservation addresses TWO objects under ONE Evidence id, so a key without the object
    // would silently drop the second one's finding while the database would have taken it.
    const key = (entry: { evidenceId: string; objectKey: string; finding: unknown }): string =>
      `${entry.evidenceId} ${entry.objectKey} ${String(entry.finding)}`;
    const seen = new Set(known.map(key));
    const fresh: EvidenceIntegrityRecord[] = [];
    for (const entry of failed) {
      if (seen.has(key(entry))) continue;
      seen.add(key(entry));
      fresh.push({
        findingId: deps.ids.next(),
        evidenceId: entry.evidenceId,
        objectKey: entry.objectKey,
        finding: entry.finding!,
        expectedDigest: entry.expectedDigest,
        observedDigest: entry.observedDigest,
        expectedSize: entry.expectedSize,
        observedSize: entry.observedSize,
        detectedAt: deps.clock.now().toISOString(),
      });
    }
    if (fresh.length > 0) {
      await context.recordIntegrityFindings(fresh);
      for (const finding of fresh) {
        const stored = await context.auditEvents.append({
          actor: { type: 'system', id: 'evidence-verifier' },
          eventType: INTEGRITY_EVENT,
          source: 'worker',
          outcome: 'failure',
          aggregateId: run.runId,
          correlationId: run.correlationId,
          sessionId: run.sessionId,
          payload: {
            // The artifact, and the two digests an auditor compares. A digest is what
            // registration already put in the chain; the artifact's CONTENT is not here
            // and there is nowhere for it to go.
            evidenceId: finding.evidenceId,
            objectKey: finding.objectKey,
            finding: finding.finding,
            registeredDigest: finding.expectedDigest,
            observedDigest: finding.observedDigest,
            registeredSize: finding.expectedSize,
            observedSize: finding.observedSize,
            // Said explicitly, because it is the whole point: nothing moved.
            stateChanged: false,
          },
        });
        await context.notifyTimeline(stored.sequence);
      }
    }
    return {
      verified: verifications.length,
      findings: [...known, ...fresh],
      recorded: fresh.length,
    };
  });
}

/**
 * Seal the package when — and only when — this state transition is a terminal one.
 *
 * Every producer calls this immediately after the save and the event that commit a state
 * change, inside the same transaction. It is a one-line call rather than a rule each
 * branch remembers, and the database is the forcing function behind it: a Run cannot reach
 * a terminal state without a package row, so a branch that forgets does not ship an
 * unsealed Run, it fails to commit.
 *
 * It is called on non-terminal transitions too, deliberately: a caller that had to decide
 * whether a state is terminal before calling would be a second copy of `TERMINAL_RUN_STATES`
 * in every branch of both producers.
 */
export async function sealIfTerminal(
  context: EvidencePackageContext,
  run: RunRecord,
  state: RunRecord['state'],
  sealedAt: string,
): Promise<void> {
  if (!isTerminalRunState(state)) return;
  await sealPackage(context, { run, terminalState: state, sealedAt });
}
