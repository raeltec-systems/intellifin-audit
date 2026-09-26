import { describe, expect, it } from 'vitest';

import { LIVE_LOST_MS, LIVE_STALE_MS, liveClockStatus, liveGateReason, waitingLiveClock } from './live-status';
import {
  LIVE_SOURCE_CLOSED,
  followLiveStream,
  parseLiveEvent,
  type LiveStreamSource,
  type LiveStreamState,
  type LiveTimelineEvent,
} from './live-stream';

/**
 * One live subscription, driven with a fake `EventSource` (Story 10.8).
 *
 * The defect this story removes lived in `useLiveTimeline`'s subscription effect, which
 * restarted the silence clock every time it ran — and a server re-read that moved the
 * cursor re-ran it. No SSR test can run an effect, so the effect's body is
 * `followLiveStream` now, and a new cursor is a second call with the SAME state: exactly
 * what the effect does when it re-runs.
 */

type Listener = (event: { readonly data?: unknown }) => void;

class FakeSource implements LiveStreamSource {
  readyState = 0;
  closed = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(readonly target: string) {}

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.readyState = LIVE_SOURCE_CLOSED;
  }

  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }

  listening(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }
}

const RUN_ID = '019823ab-0000-7000-8000-000000000001';
const URL_BASE = `/api/runs/${RUN_ID}/events`;
const T = 5_000_000;

function frame(seq: number, eventType = 'execution.capture-registered'): string {
  return JSON.stringify({ runId: RUN_ID, seq, eventType, occurredAt: '2026-09-26T09:00:00.000Z', outcome: 'success', source: 'worker' });
}

/** A subscription the way the hook holds one: one state, many connections. */
function subscription(cursor: number | null) {
  let now = T;
  const sources: FakeSource[] = [];
  const events: LiveTimelineEvent[] = [];
  const state: LiveStreamState = { clock: waitingLiveClock(now), lastSeq: cursor ?? 0 };
  const follow = (serverCursor: number | null = cursor): (() => void) => followLiveStream({
    url: URL_BASE,
    cursor: serverCursor,
    state,
    open: (target) => {
      const source = new FakeSource(target);
      sources.push(source);
      return source;
    },
    now: () => now,
    onChange: () => undefined,
    onEvent: (event) => { events.push(event); },
  });
  return {
    state,
    sources,
    events,
    follow,
    latest: (): FakeSource => sources[sources.length - 1]!,
    advance: (ms: number): void => { now += ms; },
    status: () => liveClockStatus(state.clock, now),
    gate: () => liveGateReason(liveClockStatus(state.clock, now), false),
  };
}

describe('following one live stream', () => {
  it('opens a per-Run stream after the last sequence the page saw, and the list stream with no cursor', () => {
    const run = subscription(7);
    run.follow();
    expect(run.latest().target).toBe(`${URL_BASE}?after=7`);
    const list = subscription(null);
    list.follow();
    expect(list.latest().target).toBe(URL_BASE);
  });

  it('is live once the stream answers, stale after 15 seconds of silence and lost after 60', () => {
    const run = subscription(0);
    run.follow();
    expect(run.status()).toBe('connecting');
    run.latest().emit('open');
    expect(run.status()).toBe('live');
    run.advance(LIVE_STALE_MS);
    expect(run.status()).toBe('stale');
    run.latest().emit('heartbeat', '{"at":"2026-09-26T09:00:00.000Z"}');
    expect(run.status()).toBe('live');
    run.advance(LIVE_LOST_MS);
    expect(run.status()).toBe('lost');
    expect(run.gate()).toBe('lost');
  });

  it('renders each Timeline frame once, and a frame the page has already seen is not heard at all', () => {
    const run = subscription(5);
    run.follow();
    run.advance(LIVE_STALE_MS);
    run.latest().emit('timeline', frame(5));
    expect(run.events).toEqual([]);
    expect(run.status()).toBe('stale');
    run.latest().emit('timeline', frame(6));
    expect(run.events.map((event) => event.seq)).toEqual([6]);
    expect(run.state.lastSeq).toBe(6);
    expect(run.status()).toBe('live');
  });

  it('ignores a frame that is not a Timeline envelope', () => {
    const run = subscription(0);
    run.follow();
    for (const data of ['not json', '{"seq":1}', 'null', 42, undefined]) run.latest().emit('timeline', data);
    expect(run.events).toEqual([]);
    expect(run.status()).toBe('connecting');
  });

  it('renders every list event in the order it arrives, with no cursor rule', () => {
    const list = subscription(null);
    list.follow();
    list.latest().emit('timeline', frame(3, 'lifecycle.run-canceled'));
    list.latest().emit('timeline', frame(2, 'lifecycle.run-queued'));
    expect(list.events.map((event) => event.seq)).toEqual([3, 2]);
  });

  it('ends only when the browser will not reconnect, not while it is retrying', () => {
    const run = subscription(0);
    run.follow();
    run.latest().emit('open');
    run.latest().emit('error');
    expect(run.status()).toBe('live');
    run.latest().readyState = LIVE_SOURCE_CLOSED;
    run.latest().emit('error');
    expect(run.status()).toBe('ended');
    expect(run.gate()).toBe('ended');
  });

  it('closes its connection and hears nothing more once stopped', () => {
    const run = subscription(0);
    const stop = run.follow();
    const source = run.latest();
    expect(source.listening()).toBe(4);
    stop();
    expect(source.closed).toBe(true);
    expect(source.listening()).toBe(0);
    source.emit('open');
    expect(run.status()).toBe('connecting');
  });
});

describe('a server re-read is not stream recovery (Story 10.8)', () => {
  /**
   * The page lost its stream; then something ELSE made it re-read the server — the shell's
   * bell, because another Run ended — and the Run's chain had moved on, so the page came
   * back with a new cursor and the subscription opened a new connection. The first version
   * of this rule restarted the silence clock right there.
   */
  function lostThenReRead() {
    const run = subscription(0);
    const stop = run.follow(0);
    run.latest().emit('open');
    run.latest().emit('heartbeat', '{"at":"2026-09-26T09:00:00.000Z"}');
    run.advance(LIVE_LOST_MS + 1_000);
    expect(run.status()).toBe('lost');
    // What the effect does when the re-read hands it cursor 9: close, then follow again.
    stop();
    run.follow(9);
    return run;
  }

  it('keeps a lost stream lost and its controls withdrawn across the new connection', () => {
    const run = lostThenReRead();
    expect(run.sources).toHaveLength(2);
    expect(run.status()).toBe('lost');
    expect(run.gate()).toBe('lost');
    // And for as long as the new connection hears nothing, not for a grace period.
    run.advance(30_000);
    expect(run.status()).toBe('lost');
    expect(run.gate()).toBe('lost');
  });

  it('resumes from the last frame the page SAW, never from the cursor the server handed it', () => {
    // AD-17: the server's cursor may be ahead of what this page rendered during the drop, and
    // resuming from it would skip the frames in between.
    const run = lostThenReRead();
    expect(run.latest().target).toBe(`${URL_BASE}?after=0`);
  });

  it('comes back when, and only when, the new connection hears from the stream', () => {
    for (const heard of [
      (source: FakeSource) => source.emit('heartbeat', '{"at":"2026-09-26T09:01:00.000Z"}'),
      (source: FakeSource) => source.emit('timeline', frame(1)),
      (source: FakeSource) => source.emit('open'),
    ]) {
      const run = lostThenReRead();
      heard(run.latest());
      expect(run.status()).toBe('live');
      expect(run.gate()).toBeNull();
    }
  });

  it('keeps a stale stream stale, and a live one counting, across a new connection', () => {
    const stale = subscription(0);
    const stopStale = stale.follow(0);
    stale.latest().emit('open');
    stale.advance(LIVE_STALE_MS + 1_000);
    stopStale();
    stale.follow(3);
    expect(stale.status()).toBe('stale');

    // A live stream stays live across the reconnect a normal event causes — no flicker —
    // and its silence keeps counting from the last frame, so a new connection that never
    // answers goes stale on time rather than fifteen seconds after it was opened.
    const live = subscription(0);
    const stopLive = live.follow(0);
    live.latest().emit('open');
    live.advance(5_000);
    stopLive();
    live.follow(4);
    expect(live.status()).toBe('live');
    live.advance(LIVE_STALE_MS - 5_000);
    expect(live.status()).toBe('stale');
  });

  it('keeps an ended stream ended until the new connection answers', () => {
    const run = subscription(0);
    const stop = run.follow(0);
    run.latest().readyState = LIVE_SOURCE_CLOSED;
    run.latest().emit('error');
    expect(run.status()).toBe('ended');
    stop();
    run.follow(2);
    expect(run.status()).toBe('ended');
    run.latest().emit('open');
    expect(run.status()).toBe('live');
  });
});

describe('parseLiveEvent', () => {
  it('keeps the envelope and fills absent strings with nothing rather than a guess', () => {
    expect(parseLiveEvent(frame(4))).toEqual({
      runId: RUN_ID, seq: 4, eventType: 'execution.capture-registered',
      occurredAt: '2026-09-26T09:00:00.000Z', outcome: 'success', source: 'worker',
    });
    expect(parseLiveEvent(JSON.stringify({ runId: RUN_ID, seq: 1, eventType: 'lifecycle.run-queued' })))
      .toEqual({ runId: RUN_ID, seq: 1, eventType: 'lifecycle.run-queued', occurredAt: '', outcome: '', source: '' });
    expect(parseLiveEvent(JSON.stringify({ runId: RUN_ID, seq: '1', eventType: 'x' }))).toBeNull();
  });
});
