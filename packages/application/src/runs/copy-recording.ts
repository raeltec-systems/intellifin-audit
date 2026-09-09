import {
  RECORDING_COPIED_EVENT,
  REPLAY_RECORDING_MEDIA_TYPE,
  replayRecordingObjectKey,
  type ExecutablePlan,
  type ReplayRecording,
  type ReplayRecordingDiagnostic,
  type RunRecord,
} from '@intellifin/domain';
import type {
  BrowserExecution,
  CredentialResolver,
  EvidenceStore,
  WorkspaceExecutionContext,
  WorkspaceRef,
} from './execution-ports.js';
import { guardedCredentials, type CredentialGuard } from './credential-guard.js';
import { freezeArtifact } from './evidence-package.js';

/**
 * Copy the Workspace Provider's own recording into platform storage at Run end.
 *
 * The resolved decision of 2026-09-01: after this, **Replay never depends on the
 * provider**. It runs at the terminal release, once the session is closed and the provider
 * has produced the recording, and it is BEST EFFORT by design — a provider that cannot
 * serve one must not stop a Run from giving its workspace back, and the Run has already
 * concluded and sealed by the time this runs.
 *
 * It writes to `run_replay_recording` and NEVER to `run_evidence`. The seal has already
 * happened, generation 21 freezes a sealed Run's Evidence, and a Result that published an
 * artifact list without this artifact in it would be stating something untrue about
 * itself. The recording is not something the Run concluded from; it is what the Run is
 * watched by, and `role = 'replay'` is what that means for an artifact inside the package.
 *
 * Contract: `docs/contracts/replay-asset-set-v1.md`.
 */
export interface RecordingCopy {
  readonly store: EvidenceStore;
  /**
   * Every credential this Run could have presented, resolvable by reference.
   *
   * REQUIRED, and the one dependency this command will not do without. A session recording
   * is a transcript of a browser and a sign-in TYPES a credential into a form field, so
   * this is the artifact most likely of all to carry one. Passing `NO_CREDENTIALS` here
   * would be a scan for nothing dressed as a scan — fail-open in the single guarantee the
   * credential-containment contract exists to give.
   */
  readonly credentials: CredentialResolver;
  /** Milliseconds the provider download and the upload share. */
  readonly timeoutMs: number;
}

/**
 * How long the download and the upload may take together.
 *
 * Generous, because the recording of a long Run is large and this is the last chance to
 * take it — and bounded, because it sits on the path that gives a workspace back and an
 * unbounded call is bounded by nothing. It is not a frozen compiler limit: the Run has
 * already concluded and sealed, so nothing here can change an audit outcome.
 */
export const RECORDING_COPY_TIMEOUT_MS = 120_000;

/** The bytes are refused, and nothing is stored. Thrown, so no branch can fall through. */
class RecordingRefused extends Error {
  constructor(readonly diagnostic: ReplayRecordingDiagnostic) {
    super(diagnostic);
  }
}

/**
 * Build the guard from the credential references the FROZEN PLAN names.
 *
 * A reference this deployment cannot resolve does not make the copy unsafe on its own —
 * a Run may name a system it never signed in to — but a plan whose every reference fails
 * leaves nothing to scan for, and that is refused rather than treated as "clean".
 */
async function guardFor(
  plan: ExecutablePlan | null,
  resolver: CredentialResolver,
  timeoutMs: number,
): Promise<CredentialGuard> {
  const { credentials, guard } = guardedCredentials(resolver);
  const references = plan?.credentialReferences ?? [];
  let resolved = 0;
  for (const entry of references) {
    // A resolver that refuses one reference is not a reason to store an unscanned
    // recording, and it is not a reason to fail either: the guard scans for every
    // credential it DID resolve, which is every credential this Run could have presented
    // through a reference this deployment knows.
    try {
      await credentials.resolve(entry.credentialRef, timeoutMs);
      resolved += 1;
    } catch {
      // Recorded by the caller as `recording-unscannable` when NOTHING resolved.
    }
  }
  if (references.length > 0 && resolved === 0) throw new RecordingRefused('recording-unscannable');
  return guard;
}

/**
 * Fetch, scan, upload, verify and register — in that order, and the order is the rule.
 *
 * The scan runs BEFORE the upload, so "nothing is stored" is literal rather than nearly
 * true: the object store is immutable by design and an artifact that reached it could not
 * be taken back out. And a disclosure is a REFUSAL, never a redaction.
 */
export async function copyRecording(
  browser: BrowserExecution,
  context: WorkspaceExecutionContext,
  input: {
    readonly ref: WorkspaceRef;
    readonly run: RunRecord;
    readonly copy: RecordingCopy;
    readonly now: () => string;
  },
): Promise<ReplayRecording | null> {
  // The FIRST answer wins. A reaper retry, a redelivery or a second release must not
  // fetch the recording again: the provider charges for it, and a second answer about one
  // session is one answer too many.
  const existing = await context.readRecording();
  if (existing !== null) return existing;

  const objectKey = replayRecordingObjectKey(input.run.runId);
  const base = {
    runId: input.run.runId,
    workspaceId: input.ref.workspaceId,
    objectKey,
    mediaType: REPLAY_RECORDING_MEDIA_TYPE,
  } as const;
  const unavailable = (diagnostic: ReplayRecordingDiagnostic): ReplayRecording => ({
    ...base,
    digest: null,
    size: null,
    state: 'UNAVAILABLE',
    copiedAt: null,
    diagnostic,
  });

  let recording: ReplayRecording;
  try {
    const guard = await guardFor(await context.frozenPlan(), input.copy.credentials, input.copy.timeoutMs);
    const bytes = await browser.downloadRecording(input.ref, input.copy.timeoutMs);
    // `null` is the ORDINARY answer — the local mode, or recording off — and is a
    // different fact from a provider that failed. Both leave no recording; only one is
    // something an operator would act on.
    if (bytes === null) recording = unavailable('recording-not-enabled');
    else {
      // ONE implementation of scan-then-upload-then-verify, shared with every Evidence
      // artifact. Writing a second here would be a second answer about what "stored and
      // verified" means, and the credential wall would be the half that drifted: it
      // refuses BEFORE the upload, so "nothing is stored" stays literally true.
      const frozen = await freezeArtifact(
        input.copy.store,
        { objectKey, registeredDigest: null, registeredSize: null },
        bytes,
        () => input.copy.timeoutMs,
        guard,
      ).catch((error: unknown) => {
        throw new RecordingRefused(
          error instanceof Error && 'code' in error && error.code === 'credential'
            ? 'recording-credential-disclosed'
            : 'recording-integrity-failed',
        );
      });
      recording = { ...base, digest: frozen.digest, size: frozen.size, state: 'REGISTERED', copiedAt: input.now(), diagnostic: null };
    }
  } catch (error) {
    recording = unavailable(error instanceof RecordingRefused ? error.diagnostic : 'recording-unavailable');
  }

  await context.saveRecording(recording);
  const stored = await context.auditEvents.append({
    actor: { type: 'system', id: 'agent-worker' },
    eventType: RECORDING_COPIED_EVENT,
    source: 'worker',
    // A recording that could not be copied is a degraded Replay, not a failed Run. The
    // Run has already concluded and sealed; this event says what Replay will have.
    outcome: recording.state === 'REGISTERED' ? 'success' : 'failure',
    aggregateId: input.run.runId,
    correlationId: input.run.correlationId,
    sessionId: input.run.sessionId,
    payload: {
      // Identities, a size and a digest. No endpoint, no signed URL, no provider message:
      // the chain is immutable, so what enters it can never be taken out.
      workspaceId: input.ref.workspaceId,
      state: recording.state,
      size: recording.size,
      digest: recording.digest,
      diagnostic: recording.diagnostic,
    },
  });
  await context.notifyTimeline(stored.sequence);
  return recording;
}
