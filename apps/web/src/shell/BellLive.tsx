'use client';

import { useThrottledRefresh } from '../runs/LiveBanner';
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
 *
 * The re-read also re-renders whatever page is open. The Overview opens no stream of its
 * own (owner decision 2026-09-25), so this is its only live re-read, and it fires only on
 * this filter's events: an Escalation raised, answered or timed out, a Run flagged, a Run
 * ending. After one of those the whole Overview is read again. What changes without one —
 * a Run queued or started, a version submitted for approval, a Draft saved — stays as it
 * was read until the reader navigates or one of those events arrives.
 *
 * `[REPAIRED 2026-09-26, Story 10.7]` The throttle is TRAILING. It used to drop a second
 * qualifying event inside one second of the last re-read and schedule nothing later, so a
 * short burst — two Runs flagged together, a question answered as another opened — left
 * the bell and the Overview one change short until some unrelated event arrived. A
 * throttle may delay the final re-read; it may never lose it. `useThrottledRefresh` is
 * the throttle Run Detail, the Runs list and Live View already use, so they all follow one
 * rule. It is one rule and not one budget: the bell and a page's own banner are two
 * instances of it, each with its own one-second window, so a Run page can be re-read by
 * both inside the same second.
 */
export function BellLive(): null {
  const refresh = useThrottledRefresh();
  useLiveTimeline('/api/runs/events', null, (event) => {
    if (changesOpenWaits(event.eventType)) refresh();
  });
  return null;
}
