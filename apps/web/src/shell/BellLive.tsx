'use client';

import { useRouter } from 'next/navigation';
import { useRef } from 'react';

import { useLiveTimeline } from '../runs/useLiveTimeline';

/**
 * The Timeline events that change what the bell counts.
 *
 * A wait opening, closing or timing out, and — since Story 5.5 — a Run being flagged or
 * ending. The bell counts open waits AND open flags, and a flag stops needing attention
 * when its Run ends, so both halves of that have to be here: a filter that knew only about
 * waits would leave a flagged Run's badge stale until the next unrelated event.
 *
 * `lifecycle.result-sealed` is what EVERY terminal transition appends — `completeRun` is
 * the one place a Run ends — so it covers Completed, Inconclusive and Run Failed together;
 * `lifecycle.run-canceled` is appended beside it on the cancellation path.
 */
const BELL_EVENTS = ['lifecycle.run-flagged', 'lifecycle.run-canceled', 'lifecycle.result-sealed'] as const;

export function changesOpenWaits(eventType: string): boolean {
  return eventType.startsWith('execution.escalation-') || (BELL_EVENTS as readonly string[]).includes(eventType);
}

/**
 * The notification badge's subscription (Story 5.1, AD-17): the list channel, filtered
 * to the events that can change an open-wait count, each re-reading the shell so the
 * bell shows a count somebody counted rather than one this component guessed. Renders
 * nothing; the bell itself stays the typed, server-counted component it was.
 */
export function BellLive(): null {
  const router = useRouter();
  const lastRefreshAt = useRef(0);
  useLiveTimeline('/api/runs/events', null, (event) => {
    if (!changesOpenWaits(event.eventType)) return;
    if (Date.now() - lastRefreshAt.current < 1_000) return;
    lastRefreshAt.current = Date.now();
    router.refresh();
  });
  return null;
}
