'use client';

import { useRouter } from 'next/navigation';
import { useRef } from 'react';

import { useLiveTimeline } from '../runs/useLiveTimeline';

/** The Timeline events that change what the bell counts: a wait opening, closing or timing out. */
export function changesOpenWaits(eventType: string): boolean {
  return eventType.startsWith('execution.escalation-');
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
