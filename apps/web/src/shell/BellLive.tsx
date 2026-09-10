'use client';

import { useRouter } from 'next/navigation';
import { useRef } from 'react';

import { isRunEndingEvent } from '../runs/live-status';
import { useLiveTimeline } from '../runs/useLiveTimeline';

/**
 * The Timeline events that change what the bell counts.
 *
 * A wait opening, closing or timing out, a Run being flagged (Story 5.5), and a Run
 * ending. The bell counts open waits AND open flags, and a flag stops needing attention
 * when its Run ends, so both halves of that have to be here: a filter that knew only about
 * waits would leave a flagged Run's badge stale until the next unrelated event.
 *
 * The run-ending half is COMPOSED from `RUN_ENDING_EVENTS` rather than restated, because
 * Live View's gate asks the same question about the same events (Story 5.7) and two lists
 * would diverge on the first terminal path a later story adds.
 */
export function changesOpenWaits(eventType: string): boolean {
  return eventType.startsWith('execution.escalation-')
    || eventType === 'lifecycle.run-flagged'
    || isRunEndingEvent(eventType);
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
