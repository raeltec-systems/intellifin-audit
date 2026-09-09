import { GATE_AFFECTED_LIMIT } from './gate.js';

/**
 * The Replay asset set: what a terminal Run is REPLAYED FROM (Story 5.2, FR-30, AD-9).
 *
 * Replay must work with the Workspace Provider unreachable, so everything it renders is
 * platform-owned and was written during execution: the frames (a `screenshot` artifact
 * bound through `run_evidence_capture` to the `run_tool_action` that captured it), the
 * sanitized actions (`run_tool_action`), the Observation deltas (the capture-registered
 * and registration events on the Run's own chain), the Escalations (`run_wait`: the
 * question, the closed option set, the answer, the actor and the time) and the Session
 * Steps (`run_session_step`: start, end and outcome).
 *
 * NONE of that is new storage, and that is the point. AD-17's rule is that a live frame is
 * a Replay asset the moment it is registered, so Replay reads what Live View reads; a
 * second capture path would give the two surfaces two answers about one session. What this
 * module owns is the VOCABULARY the assembled set is described in, so `packages/domain`
 * states the shape and the reader in infrastructure fills it.
 */

/**
 * A Tool Action that completed with capture PERMITTED and left no registered frame.
 *
 * Derived at seal from rows that already exist, never stored: a Tool Action whose
 * `capture` is `PERMITTED`, whose `outcome` is `performed`, and for which no `screenshot`
 * artifact is `REGISTERED` against its `run_evidence_capture` binding.
 *
 * A credential-entry action is EXCLUDED by that predicate rather than by remembering to
 * exclude it: its `capture` is `SUPPRESSED` (generation 29), which is a stored fact the
 * platform derived from its own request. Suppression and absence are different statements
 * — one says the platform refused to capture while a credential was on the wire, the other
 * says a capture that was meant to happen did not — and reporting the first as the second
 * would raise a finding against the guarantee that produced it.
 */
export interface MissingFrame {
  readonly toolActionId: string;
  readonly stepExecutionId: string;
  readonly targetSystem: string;
  /** When the action completed, so a reader can place the gap in the session. */
  readonly completedAt: string;
}

/**
 * Every Tool Action of a Run that should have left a frame and did not.
 *
 * An EXACT total beside a bounded sample — the `run_gate_check` shape, for the same
 * reason: the finding goes into an immutable event and onto the Result, and a Run with
 * thousands of Tool Actions still has to be able to commit its own conclusion. The total
 * is counted, never taken as the sample's length, because a `LIMIT` answers the sample's
 * question and not the count's.
 */
export interface MissingFrames {
  readonly total: number;
  readonly sample: readonly MissingFrame[];
}

/** The sample bound, shared with the Gate's so one number governs both. */
export const MISSING_FRAME_SAMPLE_LIMIT = GATE_AFFECTED_LIMIT;

/** Nothing missing. A named value, so a producer with no reader cannot pass `undefined`. */
export const NO_MISSING_FRAMES: MissingFrames = { total: 0, sample: [] };

/**
 * The Timeline event a sealed Run appends when a frame it should have is not there.
 *
 * `failure` is one of the nine closed families; a tenth invented for this would be a
 * schema change smuggled in as a string. It is a FAILURE and not a lifecycle event because
 * something that was meant to happen did not — but it never blocks the seal, and cannot:
 * it is appended after `sealPackage` has already returned, and a `replay`-role artifact is
 * outside the required set by construction (AD-5).
 *
 * ONE event per Run, carrying the exact total and the bounded sample. One per missing
 * frame would put an unbounded number of rows into an immutable chain for a Run whose
 * capture was misconfigured, which is the failure mode this most has to survive.
 */
export const FRAME_MISSING_EVENT = 'failure.frame-missing' as const;

/**
 * The lifecycle of the provider's session recording, copied at Run end.
 *
 * `RESERVED` is an object key with nothing verified behind it. `REGISTERED` is bytes whose
 * size and SHA-256 were verified against the recorded values before the transaction that
 * wrote this state — the `run_evidence` discipline, one table along. `UNAVAILABLE` is the
 * honest third answer this table needs and the Evidence package does not: the provider
 * recorded nothing, or could not serve what it recorded, and a Replay that says so is
 * better than one that shows an empty player.
 */
export const REPLAY_RECORDING_STATES = ['RESERVED', 'REGISTERED', 'UNAVAILABLE'] as const;
export type ReplayRecordingState = (typeof REPLAY_RECORDING_STATES)[number];

/**
 * Why there is no recording. A CLOSED vocabulary, never a provider error message: a
 * message is where an endpoint, a session id or a signed URL rides into durable storage.
 */
export const REPLAY_RECORDING_DIAGNOSTICS = [
  /** This deployment records nothing: the local mode, or `SOLARI_RECORDING` off. */
  'recording-not-enabled',
  /** The provider has no recording for this session, or would not serve it. */
  'recording-unavailable',
  /** Bytes came back and did not verify against what was uploaded. */
  'recording-integrity-failed',
  /**
   * The recording discloses a credential this Run presented.
   *
   * A session recording is the artifact MOST likely to carry one — it is a transcript of a
   * browser, and a sign-in types a credential into a form field. So the copy is refused
   * rather than redacted: bytes a provider produced are what they are, and rewriting them
   * to make them acceptable would falsify the record. Nothing is stored.
   */
  'recording-credential-disclosed',
  /** No credential guard could be built, so nothing could be scanned for. Fail closed. */
  'recording-unscannable',
] as const;
export type ReplayRecordingDiagnostic = (typeof REPLAY_RECORDING_DIAGNOSTICS)[number];

/** What a Run's recording copy is, as the row holds it. */
export interface ReplayRecording {
  readonly runId: string;
  readonly workspaceId: string;
  readonly objectKey: string;
  readonly mediaType: string;
  readonly digest: string | null;
  readonly size: number | null;
  readonly state: ReplayRecordingState;
  readonly copiedAt: string | null;
  readonly diagnostic: ReplayRecordingDiagnostic | null;
}

/**
 * The provider serves the replay as NDJSON (`@solarisdk/browser@0.1.3`: "Download the
 * replay as NDJSON bytes"). Recorded on the row rather than assumed by a reader, so a
 * later provider that serves something else is a stored fact and not a surprise.
 */
export const REPLAY_RECORDING_MEDIA_TYPE = 'application/x-ndjson';

/**
 * Where a Run's recording lives in the object store.
 *
 * Derived from the Run id and nothing else — like `evidenceObjectKeys`, and for the same
 * reason: a retried copy after a crash re-derives the same key and reconciles with its own
 * bytes instead of minting a second object beside the first. There is exactly one
 * recording per Run, so the key needs no scope.
 */
export function replayRecordingObjectKey(runId: string): string {
  return `replay-recording/${runId}/session.ndjson`;
}

/** The Timeline event a copied recording appends. Replay stops needing the provider here. */
export const RECORDING_COPIED_EVENT = 'lifecycle.replay-recording-copied' as const;
