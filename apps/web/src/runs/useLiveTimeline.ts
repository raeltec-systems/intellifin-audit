'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  LIVE_STALE_MS,
  createLiveClockHandOff,
  liveClockStatus,
  silenceSeconds,
  waitingLiveClock,
  type LiveStatus,
} from './live-status';
import { followLiveStream, type LiveStreamState, type LiveTimelineEvent } from './live-stream';

export type { LiveTimelineEvent } from './live-stream';

export interface LiveTimeline {
  readonly status: LiveStatus;
  /** The last sequence seen on a per-Run stream; the cursor a reconnect resumes from. */
  readonly lastSeq: number;
  /** Whole seconds since the last frame, for the stale sentence. */
  readonly silence: number;
}

/**
 * Where a per-Run subscription leaves its clock for the next one to the same stream
 * (Story 10.8), so a remount — a new component, with new state — cannot reset what the
 * stream last said. Run Detail, Live View and the Auditor Workspace follow the same
 * per-Run stream, so moving between them hands the clock on rather than starting again.
 *
 * It lives for the document: a full page load is a fresh read of the page and starts a
 * fresh clock, as it always has. It is touched only inside effects, never during render,
 * because the SERVER renders this component for every request and a module-level store
 * read there would be one user's stream health leaking into another's page.
 *
 * Per-Run streams only. The list stream has two subscribers on the Runs page — its banner
 * and the shell's bell — and a clock shared between two connections would let one say
 * the other is live; neither of them gates a control, so each keeps its own.
 */
const RUN_STREAM_CLOCKS = createLiveClockHandOff();

/**
 * Subscribe to a live Timeline stream and report its health.
 *
 * The subscription itself is `followLiveStream` (`live-stream.ts`); this hook owns only
 * what needs React: the state a re-render reads, the one-second tick that turns an
 * instant into "stale" and "lost", and the hand-off of the clock across a remount. Status
 * is recomputed from the instant of the last frame the stream itself delivered, so "stale
 * after 15 seconds" and "lost after 60" are the same arithmetic `live-status.ts` is tested
 * with, not a second copy on the component — and nothing but the stream moves that
 * instant: not a server re-read, not a new cursor, not a new connection, not a remount.
 */
export function useLiveTimeline(
  url: string,
  cursor: number | null,
  onEvent: (event: LiveTimelineEvent) => void,
): LiveTimeline {
  const [now, setNow] = useState(() => Date.now());
  // One mutable state per subscription, the same object for the component's whole life:
  // the effects below write to it and a re-render reads it.
  const stream = useRef<LiveStreamState | null>(null);
  if (stream.current === null) stream.current = { clock: waitingLiveClock(Date.now()), lastSeq: cursor ?? 0 };
  const state = stream.current;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const handOffKey = cursor === null ? null : url;

  // A LAYOUT effect, so a remount paints the clock it inherited rather than one frame of a
  // fresh `connecting` with the controls open. It runs before the subscription effect
  // below, so a new connection starts from the inherited clock too.
  useLayoutEffect(() => {
    if (handOffKey === null) return undefined;
    const taken = RUN_STREAM_CLOCKS.take(handOffKey, Date.now());
    state.clock = taken ?? waitingLiveClock(Date.now());
    if (taken !== null) setNow(Date.now());
    return () => { RUN_STREAM_CLOCKS.leave(handOffKey, state.clock, Date.now()); };
  }, [handOffKey, state]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    const stop = followLiveStream({
      url,
      cursor,
      state,
      open: (target) => new EventSource(target),
      now: () => Date.now(),
      onChange: () => setNow(Date.now()),
      onEvent: (event) => onEventRef.current(event),
    });
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(tick);
      stop();
    };
    // `state` is the same object for the component's life, so it never re-runs this; the
    // cursor does, and a new cursor opens a new connection without touching the clock.
  }, [url, cursor, state]);

  return { status: liveClockStatus(state.clock, now), lastSeq: state.lastSeq, silence: silenceSeconds(state.clock.lastFrameAt, now) };
}

/** Exported for the banner's own test: the threshold it must not restate. */
export const STALE_AFTER_MS = LIVE_STALE_MS;
