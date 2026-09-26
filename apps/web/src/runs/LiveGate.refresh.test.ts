import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveTimelineEvent } from './useLiveTimeline';

/**
 * What re-reads Live View and the Auditor Workspace (Story 10.7 review).
 *
 * `LiveGate` is rendered for real, with two seams replaced as in `BellLive.test.ts`: the
 * router, whose `refresh()` is counted, and the subscription, whose handler is captured
 * so a test can deliver Timeline events to it. Under `renderToStaticMarkup` no effect
 * runs, so nothing opens a stream; the handler is the real one from that render.
 */
const seams = vi.hoisted(() => ({
  refreshes: 0,
  handler: null as ((event: LiveTimelineEvent) => void) | null,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => { seams.refreshes += 1; } }) }));
vi.mock('./useLiveTimeline', () => ({
  useLiveTimeline: (_url: string, _cursor: number | null, onEvent: (event: LiveTimelineEvent) => void) => {
    seams.handler = onEvent;
    return { status: 'live', lastSeq: 0, silence: 0 };
  },
}));

import { REFRESH_THROTTLE_MS } from './LiveBanner';
import { LiveGate } from './LiveGate';

const RUN_ID = '019823ab-0000-7000-8000-000000000001';

function mountGate(): (eventType: string) => void {
  renderToStaticMarkup(React.createElement(LiveGate, {
    runId: RUN_ID, state: 'RUNNING', url: `/api/runs/${RUN_ID}/events`, cursor: 7,
    readAt: '2026-09-26T10:00:00.000Z', href: `/runs/${RUN_ID}/live`,
    children: React.createElement('p', null, 'surface'),
  }));
  const handler = seams.handler;
  if (handler === null) throw new Error('LiveGate did not subscribe to the live channel');
  let seq = 7;
  return (eventType) => {
    seq += 1;
    handler({ runId: RUN_ID, seq, eventType, occurredAt: new Date(Date.now()).toISOString(), outcome: 'success', source: 'web' });
  };
}

describe('the live gate re-reads its surface', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse('2026-09-26T10:00:00.000Z') });
    seams.refreshes = 0;
    seams.handler = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never for the reads of its own frames, a delivery or a refusal', () => {
    const deliver = mountGate();
    for (const type of ['evidence-access.grant-issued', 'evidence-access.read', 'evidence-access.denied',
      'notification.in-app-delivery', 'notification.email-delivery', 'security.denied']) {
      deliver(type);
      vi.advanceTimersByTime(REFRESH_THROTTLE_MS);
    }
    vi.advanceTimersByTime(10 * REFRESH_THROTTLE_MS);
    expect(seams.refreshes).toBe(0);
  });

  it('for everything a surface renders, a Run ending included', () => {
    const deliver = mountGate();
    deliver('execution.capture-registered');
    expect(seams.refreshes).toBe(1);
    vi.advanceTimersByTime(REFRESH_THROTTLE_MS);
    deliver('security.action-denied');
    expect(seams.refreshes).toBe(2);
    vi.advanceTimersByTime(REFRESH_THROTTLE_MS);
    deliver('lifecycle.result-sealed');
    expect(seams.refreshes).toBe(3);
  });
});
