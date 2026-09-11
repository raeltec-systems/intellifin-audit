import type { RunFrameRow, RunReplayObservationDelta, RunReplayWait } from '@intellifin/infrastructure';

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

export interface ReplayJumpTarget {
  readonly kind: ReplayJumpKind;
  readonly id: string;
  readonly label: string;
  /** `null` when nothing was captured there: a pill that opens nothing is worse than none. */
  readonly frameIndex: number | null;
}

export interface ReplayWorkItem {
  readonly workItemId: string;
  readonly displayName: string;
}

export interface ReplayException {
  readonly exceptionId: string;
  readonly workItemId: string;
  readonly populationRecordKey: string;
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
  readonly workItems: readonly ReplayWorkItem[];
  readonly exceptions: readonly ReplayException[];
  readonly waits: readonly RunReplayWait[];
}): readonly ReplayJumpTarget[] {
  const targets: ReplayJumpTarget[] = [];
  for (const item of input.workItems) {
    targets.push({
      kind: 'work-item',
      id: item.workItemId,
      label: item.displayName,
      frameIndex: replayFrameForWorkItem(input.frames, item.workItemId),
    });
  }
  for (const exception of input.exceptions) {
    targets.push({
      kind: 'exception',
      id: exception.exceptionId,
      label: exception.populationRecordKey,
      frameIndex: replayFrameForWorkItem(input.frames, exception.workItemId),
    });
  }
  for (const wait of input.waits) {
    if (wait.kind === 'pause') continue;
    targets.push({
      kind: 'escalation',
      id: wait.waitId,
      label: wait.kind,
      frameIndex: replayFrameAt(input.frames, wait.openedAt),
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
