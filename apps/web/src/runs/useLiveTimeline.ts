'use client';

import { useEffect, useRef, useState } from 'react';

import { LIVE_STALE_MS, acceptsLiveSeq, isRunEndingEvent, liveStatus, silenceSeconds, type LiveStatus } from './live-status';

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
  /** A terminal event observed on this per-Run stream; survives component remounts. */
  readonly runEnded: boolean;
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
    const nonblank = (field: unknown): field is string => typeof field === 'string' && field.trim().length > 0;
    if (!nonblank(event['runId']) || typeof event['seq'] !== 'number'
      || !Number.isSafeInteger(event['seq']) || event['seq'] < 1 || !nonblank(event['eventType'])
      || !nonblank(event['occurredAt']) || !Number.isFinite(Date.parse(event['occurredAt']))
      || !nonblank(event['outcome']) || !nonblank(event['source'])) return null;
    return {
      runId: event['runId'], seq: event['seq'], eventType: event['eventType'],
      occurredAt: event['occurredAt'], outcome: event['outcome'], source: event['source'],
    };
  } catch {
    return null;
  }
}

interface StreamHealth {
  lastMessageAt: number;
  everConnected: boolean;
  ended: boolean;
  runEnded: boolean;
}

// Browser-document lifetime: React remounts and RSC refreshes are not stream signals.
// Never write server-rendered subscriptions here: server modules are shared by users.
// Only timestamps/health and the terminal latch are retained, not event payloads. Each mounted
// consumer keeps its own replay cursor so another consumer cannot make it skip events.
const browserHealth = new Map<string, StreamHealth>();

function healthFor(url: string): StreamHealth {
  const fresh = (): StreamHealth => ({ lastMessageAt: Date.now(), everConnected: false, ended: false, runEnded: false });
  if (typeof window === 'undefined') return fresh();
  let health = browserHealth.get(url);
  if (!health) { health = fresh(); browserHealth.set(url, health); }
  return { ...health };
}

function rememberHealth(url: string, health: StreamHealth): void {
  if (typeof window !== 'undefined') {
    health.runEnded ||= browserHealth.get(url)?.runEnded ?? false;
    browserHealth.set(url, { ...health });
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
  const [, setRevision] = useState(0);
  const revision = useRef(0);
  const now = Date.now();
  const lastSeqRef = useRef(cursor ?? 0);
  const subscription = useRef({ url, health: healthFor(url) });
  if (subscription.current.url !== url) {
    subscription.current = { url, health: healthFor(url) };
    lastSeqRef.current = cursor ?? 0;
  }
  const health = subscription.current.health;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    const target = cursor === null ? url : `${url}?after=${lastSeqRef.current}`;
    const source = new EventSource(target);
    const touch = (): void => {
      health.lastMessageAt = Date.now();
      health.everConnected = true;
      health.ended = false;
      rememberHealth(url, health);
      setRevision(++revision.current);
    };
    const onTimeline = (message: MessageEvent<string>): void => {
      const event = parseEvent(message.data);
      if (event === null) return;
      // The terminal latch belongs to the per-Run stream, never the global bell stream.
      if (cursor !== null && isRunEndingEvent(event.eventType)) health.runEnded = true;
      touch();
      if (cursor !== null) {
        // The one rule that makes a reconnect lossless AND duplicate-free, and it lives in
        // `live-status.ts` so the property is tested without a browser.
        if (!acceptsLiveSeq(lastSeqRef.current, event.seq)) return;
        lastSeqRef.current = event.seq;
      }
      onEventRef.current(event);
    };
    const onHeartbeat = (): void => touch();
    const onError = (): void => {
      // CLOSED means the browser will not retry (a 401, a 404, a wrong media type);
      // CONNECTING means it is retrying on its own and the silence clock decides.
      if (source.readyState === EventSource.CLOSED) { health.ended = true; rememberHealth(url, health); setRevision(++revision.current); }
    };
    source.addEventListener('timeline', onTimeline as EventListener);
    source.addEventListener('heartbeat', onHeartbeat);
    source.addEventListener('error', onError);
    const clock = setInterval(() => setRevision(++revision.current), 1_000);
    return () => {
      clearInterval(clock);
      source.removeEventListener('timeline', onTimeline as EventListener);
      source.removeEventListener('heartbeat', onHeartbeat);
      source.removeEventListener('error', onError);
      source.close();
    };
  }, [url, cursor, health]);

  const status = liveStatus({
    ended: health.ended,
    lastMessageAt: health.lastMessageAt,
    everConnected: health.everConnected,
    now,
  });
  return { status, runEnded: cursor !== null && health.runEnded, lastSeq: lastSeqRef.current, silence: silenceSeconds(health.lastMessageAt, now) };
}

/** Exported for the banner's own test: the threshold it must not restate. */
export const STALE_AFTER_MS = LIVE_STALE_MS;
