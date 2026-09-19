import type { RunFrameRow, RunReplayObservationDelta, RunReplayWait } from '@intellifin/infrastructure';

import { escalationKindWord } from '../design/plain-words';
import { workItemLabel } from './labels';

/**
 * Replay's presentation logic (Story 5.8, FR-30, UX-DR26, addendum §F).
 *
 * Every function here is PURE and every input is a row the platform already stored. That
 * is the shape of FR-30's rule rather than a style choice: Replay renders from the
 * platform-owned asset set and re-executes nothing, so nothing on this path may reach a
 * Target System, a Workspace Provider or an object store. A module that takes rows and
 * returns indices cannot.
 */

/** The three things EXPERIENCE.md's Replay row says a reader may jump to. */
export const REPLAY_JUMP_KINDS = ['work-item', 'exception', 'escalation'] as const;
export type ReplayJumpKind = (typeof REPLAY_JUMP_KINDS)[number];

/**
 * Why a jump target has no frame to open, said only as far as the read can KNOW it.
 *
 * - `none-captured`: the page read every frame the Run has, and none belongs to this target.
 * - `none-before`: no frame was captured at or before the instant an Escalation was raised.
 *   Decidable under ANY bound, because the read holds the EARLIEST frames: if none of them
 *   precedes the instant, none at all does.
 * - `not-read`: the read bound at `REPLAY_FRAME_LIMIT` and none of the frames read belongs
 *   to this target. Whether one exists past the bound is NOT known, so the sentence for it
 *   claims neither that a frame exists nor that none was captured. The first version of this
 *   inferred "beyond the frames shown" from the global count alone, which was a false claim
 *   about a Work Item that captured nothing in a long Run (the Codex finding on PR 36).
 */
export const REPLAY_FRAME_ABSENCES = ['none-captured', 'none-before', 'not-read'] as const;
export type ReplayFrameAbsence = (typeof REPLAY_FRAME_ABSENCES)[number];

/**
 * A jump target either lands on a frame or says why it cannot -- never a null index with no
 * reason, and never a reason beside a frame. A pill that opens nothing is worse than none.
 */
export type ReplayJumpTarget = {
  readonly kind: ReplayJumpKind;
  readonly id: string;
  readonly label: string;
} & (
  | { readonly frameIndex: number; readonly absence: null }
  | { readonly frameIndex: null; readonly absence: ReplayFrameAbsence }
);

export type ReplayInitialSelection =
  | { readonly kind: 'start'; readonly frameIndex: number }
  | { readonly kind: 'inspection'; readonly target: ReplayJumpTarget; readonly frameIndex: number | null }
  | { readonly kind: 'unavailable'; readonly frameIndex: null };

/** Resolve only against this authorized Run's stored targets. A bad or bounded-out
 * deep link must never silently show a different record's first capture. */
export function replayInitialSelection(
  workItem: string | readonly string[] | undefined,
  targets: readonly ReplayJumpTarget[],
  frameCount: number,
): ReplayInitialSelection {
  if (workItem === undefined) return { kind: 'start', frameIndex: clampReplayIndex(0, frameCount) };
  if (typeof workItem !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workItem))
    return { kind: 'unavailable', frameIndex: null };
  const target = targets.find(item => item.kind === 'work-item' && item.id === workItem.toLowerCase());
  return target === undefined ? { kind: 'unavailable', frameIndex: null }
    : { kind: 'inspection', target, frameIndex: target.frameIndex };
}

function landing(frameIndex: number | null, whenMissing: ReplayFrameAbsence):
  | { readonly frameIndex: number; readonly absence: null }
  | { readonly frameIndex: null; readonly absence: ReplayFrameAbsence } {
  return frameIndex === null ? { frameIndex: null, absence: whenMissing } : { frameIndex, absence: null };
}

export interface ReplayWorkItem {
  readonly workItemId: string;
  readonly displayName: string;
  /** The record this Work Item inspected, or null when it inspected no population. */
  readonly subjectKey: string | null;
}


export interface ReplayException {
  readonly exceptionId: string;
  readonly workItemId: string;
  readonly populationRecordKey: string;
}

/**
 * Frames with their Work Item resolved through the Step Execution that captured them.
 *
 * `run_tool_action.work_item_id` is NULLABLE, and a jump matched on it alone reports "no
 * frame was captured here" for a Work Item whose frames all carry the id on their Step
 * Execution instead. The page already resolves the system NAME that way
 * (`step?.workItemId ?? frame.workItemId`); the jump list used the raw column, so the two
 * disagreed on the same row. This is the one rule, applied before either read.
 */
export function resolveFrameWorkItems(
  frames: readonly RunFrameRow[],
  stepExecutions: readonly { readonly stepExecutionId: string; readonly workItemId: string | null }[],
): readonly RunFrameRow[] {
  const byStep = new Map(stepExecutions.map((step) => [step.stepExecutionId, step.workItemId]));
  return frames.map((frame) => {
    const viaStep = byStep.get(frame.stepExecutionId);
    return viaStep === undefined || viaStep === null ? frame : { ...frame, workItemId: viaStep };
  });
}

/**
 * The first frame captured while a Work Item was being worked, or `null`.
 *
 * FIRST, not last: jumping to a Work Item means starting at it, and a reader who wants its
 * end steps forward from there. Frames arrive oldest first, so this is the first match.
 */
export function replayFrameForWorkItem(
  frames: readonly RunFrameRow[],
  workItemId: string,
): number | null {
  const index = frames.findIndex((frame) => frame.workItemId === workItemId);
  return index === -1 ? null : index;
}

/**
 * The last frame captured at or before an instant, or `null`.
 *
 * An Escalation asks about a page, and the page it asks about is the last one captured
 * before it was raised. A frame captured AFTER it belongs to whatever happened next, so
 * jumping there would show a reader a screen the question was not about. An unreadable
 * instant is `null` rather than the first frame: guessing where a wait belongs is worse
 * than saying nothing was found for it.
 */
export function replayFrameAt(frames: readonly RunFrameRow[], instant: string): number | null {
  const at = Date.parse(instant);
  if (!Number.isFinite(at)) return null;
  let found: number | null = null;
  for (let index = 0; index < frames.length; index += 1) {
    const startedAt = Date.parse(frames[index]!.actionStartedAt);
    if (!Number.isFinite(startedAt) || startedAt > at) break;
    found = index;
  }
  return found;
}

/**
 * The jump list, in SESSION order.
 *
 * Ordered by the frame each target lands on, so the list reads the way the session ran; a
 * target with no frame sorts last, because it is somewhere a reader cannot go. Ties break
 * on kind then id, so the order is deterministic rather than whatever the reads returned.
 *
 * A PAUSE is not in it. EXPERIENCE.md's Replay row names Work Items, Exceptions and
 * Escalations, and a pause is a wait that asks nothing — the distinction generation 45
 * enforces in the database and `run-pause-v1.md` states.
 */
export function replayJumpTargets(input: {
  readonly frames: readonly RunFrameRow[];
  /** How many frames the Run holds, so a bounded read is known to be one. */
  readonly framesTotal: number;
  readonly workItems: readonly ReplayWorkItem[];
  readonly exceptions: readonly ReplayException[];
  readonly waits: readonly RunReplayWait[];
}): readonly ReplayJumpTarget[] {
  // A Work Item's frames are matched by id, so a bounded read cannot tell "captured nothing"
  // from "captured past the bound"; a complete read can.
  const whenNoFrame: ReplayFrameAbsence = input.framesTotal > input.frames.length ? 'not-read' : 'none-captured';
  const targets: ReplayJumpTarget[] = [];
  for (const item of input.workItems) {
    targets.push({
      kind: 'work-item',
      id: item.workItemId,
      label: workItemLabel(item),
      ...landing(replayFrameForWorkItem(input.frames, item.workItemId), whenNoFrame),
    });
  }
  for (const exception of input.exceptions) {
    targets.push({
      kind: 'exception',
      id: exception.exceptionId,
      label: exception.populationRecordKey,
      ...landing(replayFrameForWorkItem(input.frames, exception.workItemId), whenNoFrame),
    });
  }
  for (const wait of input.waits) {
    if (wait.kind === 'pause') continue;
    targets.push({
      kind: 'escalation',
      id: wait.waitId,
      // The stored kind is a KEY, and this row renders its label in a monospace span --
      // which presents whatever it is given as an identifier. `choose-candidate` is not a
      // question an auditor asked, and the plain-words pass removed exactly this from the
      // authoring screens; Replay reintroduced it in a new place.
      label: escalationKindWord(wait.kind),
      // Decided whatever the bound: the frames read are the earliest, so none preceding the
      // instant among them means none preceding it at all.
      ...landing(replayFrameAt(input.frames, wait.openedAt), 'none-before'),
    });
  }
  const rank = (target: ReplayJumpTarget): number => REPLAY_JUMP_KINDS.indexOf(target.kind);
  return targets.sort((left, right) => {
    if (left.frameIndex !== right.frameIndex) {
      if (left.frameIndex === null) return 1;
      if (right.frameIndex === null) return -1;
      return left.frameIndex - right.frameIndex;
    }
    return rank(left) - rank(right) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  });
}

/**
 * How many Observations the Run had registered by the time a frame was captured.
 *
 * A running total over the chain's own registration events, compared against the frame's
 * ACTION start — the same instant the frames are ordered by, so the number a reader sees
 * beside a frame is true of the moment that frame was taken. An unreadable instant on
 * either side contributes nothing rather than being treated as zero or as everything.
 */
export function replayObservationsThrough(
  deltas: readonly RunReplayObservationDelta[],
  frame: RunFrameRow | null,
): number {
  if (frame === null) return 0;
  const at = Date.parse(frame.actionStartedAt);
  if (!Number.isFinite(at)) return 0;
  let total = 0;
  for (const delta of deltas) {
    const occurredAt = Date.parse(delta.occurredAt);
    if (Number.isFinite(occurredAt) && occurredAt <= at) total += delta.registered;
  }
  return total;
}

/** Keep a requested position inside the frames that exist; `-1` when there are none. */
export function clampReplayIndex(index: number, frames: number): number {
  if (frames <= 0) return -1;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(frames - 1, Math.trunc(index)));
}
