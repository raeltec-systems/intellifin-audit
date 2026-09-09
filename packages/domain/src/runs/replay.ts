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
