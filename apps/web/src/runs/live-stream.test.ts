import { describe, expect, it } from 'vitest';

import {
  LIVE_LOST_MS,
  LIVE_STALE_MS,
  createLiveClockHandOff,
  heardFromStream,
  liveClockStatus,
  liveGateReason,
  streamClosed,
  waitingLiveClock,
  type LiveClockHandOff,
} from './live-status';
import {
  LIVE_SOURCE_CLOSED,
  beginLiveSubscription,
  endLiveSubscription,
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
  // Every re-render the subscription asks for. A no-op here would let a deleted
  // `onChange()` pass every test while the page stopped repainting what it heard.
  let changes = 0;
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
    onChange: () => { changes += 1; },
    onEvent: (event) => { events.push(event); },
  });
  return {
    state,
    sources,
    events,
    changes: () => changes,
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

  it('is live once the stream sends its first frame, stale after 15 seconds of silence and lost after 60', () => {
    // The first frame on a healthy stream is the heartbeat every connection hears as soon as
    // its stream is armed and caught up; a connection answering is not a frame.
    const run = subscription(0);
    run.follow();
    expect(run.status()).toBe('connecting');
    run.latest().emit('open');
    expect(run.status()).toBe('connecting');
    run.latest().emit('heartbeat', '{"at":"2026-09-26T09:00:00.000Z"}');
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
    run.latest().emit('heartbeat', '{"at":"2026-09-26T09:00:00.000Z"}');
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
    // A Timeline frame, a heartbeat and an error. Not `open`: a connection answering says
    // nothing about the stream, so nothing listens for it.
    expect(source.listening()).toBe(3);
    stop();
    expect(source.closed).toBe(true);
    expect(source.listening()).toBe(0);
    source.emit('heartbeat', '{"at":"2026-09-26T09:00:00.000Z"}');
    source.emit('timeline', frame(1));
    expect(run.status()).toBe('connecting');
    expect(run.events).toEqual([]);
    expect(run.changes()).toBe(0);
  });

  it('is not changed at all by a connection answering, whatever the stream last said', () => {
    // `open` is the route answering, before it has armed its LISTEN or read the chain. A
    // fresh page stays connecting on it (changed on purpose in the Story 10.8 review: it used
    // to read `live` on it), its silence counts from before it, and a stale, lost or ended
    // stream stays so — only a frame from the stream moves any of them.
    const fresh = subscription(0);
    fresh.follow();
    fresh.latest().emit('open');
    expect(fresh.status()).toBe('connecting');
    expect(fresh.changes()).toBe(0);
    fresh.advance(LIVE_STALE_MS);
    fresh.latest().emit('open');
    expect(fresh.status()).toBe('stale');

    for (const [silence, status] of [[LIVE_STALE_MS + 1_000, 'stale'], [LIVE_LOST_MS + 1_000, 'lost']] as const) {
      const run = subscription(0);
      run.follow();
      run.latest().emit('heartbeat', '{"at":"2026-09-26T09:00:00.000Z"}');
      run.advance(silence);
      run.latest().emit('open');
      expect(run.status()).toBe(status);
    }
    const ended = subscription(0);
    ended.follow();
    ended.latest().readyState = LIVE_SOURCE_CLOSED;
    ended.latest().emit('error');
    ended.latest().emit('open');
    expect(ended.status()).toBe('ended');
  });

  it('asks for a repaint for exactly what changed the clock, and for nothing else', () => {
    const run = subscription(5);
    run.follow();
    run.latest().emit('open');
    expect(run.changes()).toBe(0);
    run.latest().emit('heartbeat', '{"at":"2026-09-26T09:00:00.000Z"}');
    expect(run.changes()).toBe(1);
    run.latest().emit('timeline', frame(6));
    expect(run.changes()).toBe(2);
    // A frame already seen, and one that is not an envelope, change nothing.
    run.latest().emit('timeline', frame(6));
    run.latest().emit('timeline', 'not json');
    expect(run.changes()).toBe(2);
    // Retrying changes nothing; the browser giving up does.
    run.latest().emit('error');
    expect(run.changes()).toBe(2);
    run.latest().readyState = LIVE_SOURCE_CLOSED;
    run.latest().emit('error');
    expect(run.changes()).toBe(3);
    expect(run.status()).toBe('ended');
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

  it('comes back when, and only when, the stream sends a frame or a heartbeat', () => {
    for (const heard of [
      (source: FakeSource) => source.emit('heartbeat', '{"at":"2026-09-26T09:01:00.000Z"}'),
      (source: FakeSource) => source.emit('timeline', frame(1)),
    ]) {
      const run = lostThenReRead();
      heard(run.latest());
      expect(run.status()).toBe('live');
      expect(run.gate()).toBeNull();
    }
  });

  it('is not brought back by the new connection answering', () => {
    // `open` says the route answered, and the route answers before it has armed its LISTEN
    // or read the chain. It is not a frame, so a lost page stays lost on it.
    const run = lostThenReRead();
    run.latest().emit('open');
    expect(run.status()).toBe('lost');
    expect(run.gate()).toBe('lost');
    run.latest().emit('heartbeat', '{"at":"2026-09-26T09:01:00.000Z"}');
    expect(run.status()).toBe('live');
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
    live.latest().emit('heartbeat', '{"at":"2026-09-26T09:00:00.000Z"}');
    live.advance(5_000);
    stopLive();
    live.follow(4);
    expect(live.status()).toBe('live');
    live.advance(LIVE_STALE_MS - 5_000);
    expect(live.status()).toBe('stale');
  });

  it('keeps an ended stream ended until the stream itself sends a frame', () => {
    const run = subscription(0);
    const stop = run.follow(0);
    run.latest().readyState = LIVE_SOURCE_CLOSED;
    run.latest().emit('error');
    expect(run.status()).toBe('ended');
    stop();
    run.follow(2);
    expect(run.status()).toBe('ended');
    run.latest().emit('open');
    expect(run.status()).toBe('ended');
    run.latest().emit('heartbeat', '{"at":"2026-09-26T09:01:00.000Z"}');
    expect(run.status()).toBe('live');
  });

  it('does not call a stream that answers and then sends nothing live for longer than its silence allows', () => {
    // A route whose LISTEN fails answers, sends `end`, and closes; the browser opens the
    // next connection two seconds later and the route answers again. Every answer is an
    // `open` and none is a frame, so the page goes stale and then lost as if the stream
    // were silent — which, as far as the Run goes, it is.
    const run = subscription(0);
    run.follow(0);
    run.latest().emit('open');
    // Not live on the answer alone (changed on purpose in the Story 10.8 review): the
    // stream has said nothing.
    expect(run.status()).toBe('connecting');
    for (let second = 2; second <= 70; second += 2) {
      run.advance(2_000);
      run.latest().emit('error');
      run.latest().emit('open');
    }
    expect(run.status()).toBe('lost');
    expect(run.gate()).toBe('lost');
  });
});

describe('a subscription begins and ends around its stream (Story 10.8 review)', () => {
  const STREAM_A = `/api/runs/${RUN_ID}/events`;
  const STREAM_B = '/api/runs/019823ab-0000-7000-8000-000000000002/events';

  function opened(state: LiveStreamState, url: string, sources: FakeSource[]): () => void {
    return followLiveStream({
      url, cursor: 0, state,
      open: (target) => { const source = new FakeSource(target); sources.push(source); return source; },
      now: () => T, onChange: () => undefined, onEvent: () => undefined,
    });
  }

  it('closes the connection before it leaves the clock, so a late frame cannot land on state nobody reads', () => {
    const handOff = createLiveClockHandOff();
    const sources: FakeSource[] = [];
    const state: LiveStreamState = { clock: waitingLiveClock(T), lastSeq: 0 };
    beginLiveSubscription(state, handOff, STREAM_A, 0, T);
    const stop = opened(state, STREAM_A, sources);
    sources[0]!.emit('heartbeat', '{"at":"2026-09-26T09:00:00.000Z"}');
    let closedWhenLeft: boolean | null = null;
    const watching: LiveClockHandOff = {
      leave: (key, clock, at) => { closedWhenLeft = sources[0]!.closed; handOff.leave(key, clock, at); },
      take: (key, now) => handOff.take(key, now),
    };
    endLiveSubscription(state, watching, STREAM_A, stop, T + 1_000);
    expect(closedWhenLeft).toBe(true);
    // Nothing the old connection says afterwards reaches anything.
    sources[0]!.emit('heartbeat', '{"at":"2026-09-26T09:05:00.000Z"}');
    expect(sources[0]!.listening()).toBe(0);
    // The next page takes the clock as the stream last left it: heard at T.
    const next: LiveStreamState = { clock: waitingLiveClock(T), lastSeq: 0 };
    expect(beginLiveSubscription(next, handOff, STREAM_A, 0, T + 1_000)).toBe(true);
    expect(next.clock).toEqual(heardFromStream(T));
  });

  it('opens a new stream from that page\'s own cursor, never from the last stream\'s sequence', () => {
    // A component that stays mounted while its stream changes keeps its state: without the
    // reset the new stream would open after the OLD stream's last sequence and skip every
    // event of the new Run before it.
    const handOff = createLiveClockHandOff();
    const sources: FakeSource[] = [];
    const state: LiveStreamState = { clock: waitingLiveClock(T), lastSeq: 0 };
    beginLiveSubscription(state, handOff, STREAM_A, 0, T);
    const stop = opened(state, STREAM_A, sources);
    sources[0]!.emit('timeline', frame(40));
    expect(state.lastSeq).toBe(40);
    endLiveSubscription(state, handOff, STREAM_A, stop, T);
    expect(beginLiveSubscription(state, handOff, STREAM_B, 3, T)).toBe(false);
    expect(state.lastSeq).toBe(3);
    // Nothing was left for the new stream, so its clock is a fresh one.
    expect(state.clock).toEqual(waitingLiveClock(T));
    followLiveStream({
      url: STREAM_B, cursor: 3, state,
      open: (target) => { const source = new FakeSource(target); sources.push(source); return source; },
      now: () => T, onChange: () => undefined, onEvent: () => undefined,
    });
    expect(sources[1]!.target).toBe(`${STREAM_B}?after=3`);
  });

  it('takes an ended clock ended, whatever the new page renders at', () => {
    const handOff = createLiveClockHandOff();
    handOff.leave(STREAM_A, streamClosed(heardFromStream(T)), T + 1_000);
    const state: LiveStreamState = { clock: waitingLiveClock(T + 2_000), lastSeq: 9 };
    expect(beginLiveSubscription(state, handOff, STREAM_A, 9, T + 2_000)).toBe(true);
    expect(liveClockStatus(state.clock, T + 2_000)).toBe('ended');
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
