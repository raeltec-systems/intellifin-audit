import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveTimelineEvent } from '../runs/useLiveTimeline';

/**
 * The bell's re-read under a burst (Story 10.7).
 *
 * `BellLive` is rendered for real, so the throttle under test is the one the component
 * actually composes, not a copy of it. Two seams are replaced: the router, whose
 * `refresh()` is recorded with the instant it was asked for, and the subscription, whose
 * event handler is captured so a test can deliver a burst of Timeline events to it. Under
 * `renderToStaticMarkup` no effect runs, so nothing here opens a stream; the handler and
 * the refs it closes over are the real ones from that render.
 */
const seams = vi.hoisted(() => ({
  refreshes: [] as number[],
  handler: null as ((event: LiveTimelineEvent) => void) | null,
  subscription: null as { readonly url: string; readonly cursor: number | null } | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => { seams.refreshes.push(Date.now()); } }),
}));

vi.mock('../runs/useLiveTimeline', () => ({
  useLiveTimeline: (url: string, cursor: number | null, onEvent: (event: LiveTimelineEvent) => void) => {
    seams.subscription = { url, cursor };
    seams.handler = onEvent;
    return { status: 'live', lastSeq: 0, silence: 0 };
  },
}));

import { REFRESH_THROTTLE_MS } from '../runs/LiveBanner';
import { BellLive } from './BellLive';

const START = Date.parse('2026-09-26T10:00:00.000Z');

function mountBell(): (eventType: string) => void {
  expect(renderToStaticMarkup(React.createElement(BellLive))).toBe('');
  const handler = seams.handler;
  if (handler === null) throw new Error('BellLive did not subscribe to the live channel');
  let seq = 0;
  return (eventType) => {
    seq += 1;
    handler({ runId: 'run-1', seq, eventType, occurredAt: new Date(Date.now()).toISOString(), outcome: 'success', source: 'web' });
  };
}

describe('the bell re-reads the shell on a burst of qualifying events', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
    seams.refreshes.length = 0;
    seams.handler = null;
    seams.subscription = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes to the list stream, which has no cursor', () => {
    mountBell();
    expect(seams.subscription).toEqual({ url: '/api/runs/events', cursor: null });
  });

  it('re-reads at once for the first event, and once more after the window for everything the window held', () => {
    const deliver = mountBell();
    deliver('lifecycle.run-flagged');
    expect(seams.refreshes).toEqual([START]);

    // A burst inside the window: a question opens on one Run, another Run is flagged, and
    // an event the bell does not count arrives between them.
    vi.advanceTimersByTime(200);
    deliver('execution.escalation-raised');
    vi.advanceTimersByTime(300);
    deliver('execution.observations-registered');
    deliver('lifecycle.run-flagged');
    const lastQualifying = Date.now();
    expect(seams.refreshes).toEqual([START]);

    // The throttle delays the re-read; it never drops it.
    vi.advanceTimersByTime(REFRESH_THROTTLE_MS - 500 - 1);
    expect(seams.refreshes).toEqual([START]);
    vi.advanceTimersByTime(1);
    expect(seams.refreshes).toEqual([START, START + REFRESH_THROTTLE_MS]);
    // The last re-read was asked for AFTER the last qualifying event arrived, so the state
    // it reads includes the change that event announced.
    expect(seams.refreshes.at(-1)!).toBeGreaterThanOrEqual(lastQualifying);

    // One deferred re-read for the whole window, and nothing more once the burst is over.
    vi.advanceTimersByTime(10 * REFRESH_THROTTLE_MS);
    expect(seams.refreshes).toHaveLength(2);
  });

  it('keeps following a burst that outlasts one window', () => {
    const deliver = mountBell();
    deliver('execution.escalation-raised');
    vi.advanceTimersByTime(900);
    deliver('execution.escalation-answered');
    vi.advanceTimersByTime(100);
    expect(seams.refreshes).toEqual([START, START + REFRESH_THROTTLE_MS]);
    vi.advanceTimersByTime(50);
    // Inside the next window: deferred again, to the end of that window.
    deliver('lifecycle.result-sealed');
    vi.advanceTimersByTime(REFRESH_THROTTLE_MS);
    expect(seams.refreshes).toEqual([START, START + REFRESH_THROTTLE_MS, START + 2 * REFRESH_THROTTLE_MS]);
  });

  it('re-reads at once for an event that arrives after the window has passed', () => {
    const deliver = mountBell();
    deliver('lifecycle.run-canceled');
    vi.advanceTimersByTime(REFRESH_THROTTLE_MS + 250);
    deliver('lifecycle.run-flagged');
    expect(seams.refreshes).toEqual([START, START + REFRESH_THROTTLE_MS + 250]);
    vi.advanceTimersByTime(10 * REFRESH_THROTTLE_MS);
    expect(seams.refreshes).toHaveLength(2);
  });

  it('never re-reads for an event that cannot change what the bell counts', () => {
    const deliver = mountBell();
    for (const type of ['execution.observations-registered', 'lifecycle.run-queued', 'evidence-access.read',
      'notification.in-app-delivery', 'notification.email-delivery', 'security.denied']) {
      deliver(type);
      vi.advanceTimersByTime(300);
    }
    vi.advanceTimersByTime(10 * REFRESH_THROTTLE_MS);
    expect(seams.refreshes).toEqual([]);
  });
});
