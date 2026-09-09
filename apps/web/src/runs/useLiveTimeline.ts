'use client';

import { useEffect, useRef, useState } from 'react';

import { LIVE_STALE_MS, liveStatus, silenceSeconds, type LiveStatus } from './live-status';

/** One Timeline event as the channel carries it (`docs/contracts/live-timeline-channel-v1.md`). */
export interface LiveTimelineEvent {
  readonly runId: string;
  readonly seq: number;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly outcome: string;
  readonly source: string;
}

export interface LiveTimeline {
  readonly status: LiveStatus;
  /** The last sequence seen on a per-Run stream; the cursor a reconnect resumes from. */
  readonly lastSeq: number;
  /** Whole seconds since the last frame, for the stale sentence. */
  readonly silence: number;
}

function parseEvent(data: string): LiveTimelineEvent | null {
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value !== 'object' || value === null) return null;
    const event = value as Record<string, unknown>;
    if (typeof event['runId'] !== 'string' || typeof event['seq'] !== 'number' || typeof event['eventType'] !== 'string') return null;
    return {
      runId: event['runId'],
      seq: event['seq'],
      eventType: event['eventType'],
      occurredAt: typeof event['occurredAt'] === 'string' ? event['occurredAt'] : '',
      outcome: typeof event['outcome'] === 'string' ? event['outcome'] : '',
      source: typeof event['source'] === 'string' ? event['source'] : '',
    };
  } catch {
    return null;
  }
}

/**
 * Subscribe to a live Timeline stream and report its health.
 *
 * `EventSource` does the reconnecting: after a drop or a planned `end` it reopens on
 * its own with `Last-Event-ID`, which the route takes as the cursor, so a per-Run
 * subscription never skips and never repeats — and this hook still refuses a `seq` it
 * has already seen, so a repeat could not reach the page either way. A `cursor` of
 * `null` is the list stream, which has no cursor.
 *
 * Status is recomputed once a second from the instant of the last frame (event or
 * heartbeat), so "stale after 15 seconds" and "lost after 60" are the same arithmetic
 * `live-status.ts` is tested with, not a second copy on the component.
 */
export function useLiveTimeline(
  url: string,
  cursor: number | null,
  onEvent: (event: LiveTimelineEvent) => void,
): LiveTimeline {
  const [now, setNow] = useState(() => Date.now());
  const lastSeqRef = useRef(cursor ?? 0);
  const lastMessageAtRef = useRef(Date.now());
  const everConnectedRef = useRef(false);
  const endedRef = useRef(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    lastMessageAtRef.current = Date.now();
    const target = cursor === null ? url : `${url}?after=${lastSeqRef.current}`;
    const source = new EventSource(target);
    const touch = (): void => {
      lastMessageAtRef.current = Date.now();
      everConnectedRef.current = true;
      endedRef.current = false;
      setNow(Date.now());
    };
    const onTimeline = (message: MessageEvent<string>): void => {
      const event = parseEvent(message.data);
      if (event === null) return;
      if (cursor !== null) {
        if (event.seq <= lastSeqRef.current) return;
        lastSeqRef.current = event.seq;
      }
      touch();
      onEventRef.current(event);
    };
    const onHeartbeat = (): void => touch();
    const onOpen = (): void => touch();
    const onError = (): void => {
      // CLOSED means the browser will not retry (a 401, a 404, a wrong media type);
      // CONNECTING means it is retrying on its own and the silence clock decides.
      if (source.readyState === EventSource.CLOSED) { endedRef.current = true; setNow(Date.now()); }
    };
    source.addEventListener('timeline', onTimeline as EventListener);
    source.addEventListener('heartbeat', onHeartbeat);
    source.addEventListener('open', onOpen);
    source.addEventListener('error', onError);
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(clock);
      source.removeEventListener('timeline', onTimeline as EventListener);
      source.removeEventListener('heartbeat', onHeartbeat);
      source.removeEventListener('open', onOpen);
      source.removeEventListener('error', onError);
      source.close();
    };
  }, [url, cursor]);

  const status = liveStatus({
    ended: endedRef.current,
    lastMessageAt: lastMessageAtRef.current,
    everConnected: everConnectedRef.current,
    now,
  });
  return { status, lastSeq: lastSeqRef.current, silence: silenceSeconds(lastMessageAtRef.current, now) };
}

/** Exported for the banner's own test: the threshold it must not restate. */
export const STALE_AFTER_MS = LIVE_STALE_MS;
