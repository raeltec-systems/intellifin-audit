import {
  acceptsLiveSeq,
  heardFromStream,
  streamClosed,
  waitingLiveClock,
  type LiveClock,
  type LiveClockHandOff,
} from './live-status';

/**
 * One subscription to a live Timeline stream, with no React and no DOM (Story 10.8).
 *
 * This is the body of `useLiveTimeline`'s subscription effect, moved out of the effect so
 * the unit suite can see it. The defect it removes lived exactly there: the effect
 * restarted the silence clock every time it ran, and a server re-read that moved the
 * cursor re-ran it, so a page whose stream was down said `live` again and reopened its
 * controls because it had re-read the SERVER. A rule a component reaches only through an
 * effect is a rule no SSR unit test can see, so it lives here and is driven with a fake
 * source in `live-stream.test.ts`.
 */

/** One Timeline event as the channel carries it (`docs/contracts/live-timeline-channel-v1.md`). */
export interface LiveTimelineEvent {
  readonly runId: string;
  readonly seq: number;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly outcome: string;
  readonly source: string;
}

export function parseLiveEvent(data: unknown): LiveTimelineEvent | null {
  if (typeof data !== 'string') return null;
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

/** `EventSource.CLOSED`, named here so this module needs no DOM: the browser will not reconnect on its own. */
export const LIVE_SOURCE_CLOSED = 2;

/** The part of an `EventSource` a subscription uses: its SHAPE, so a test can hand it one without a browser. */
export interface LiveStreamSource {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: { readonly data?: unknown }) => void): void;
  removeEventListener(type: string, listener: (event: { readonly data?: unknown }) => void): void;
  close(): void;
}

/**
 * A subscription's state. It outlives every connection the subscription opens: a new
 * cursor closes one connection and opens the next, and neither the clock nor the last
 * sequence seen starts again because of that.
 */
export interface LiveStreamState {
  clock: LiveClock;
  lastSeq: number;
}

export interface FollowLiveStream {
  readonly url: string;
  /** The server's chain head for a per-Run stream, or `null` for the list stream, which has no cursor. */
  readonly cursor: number | null;
  readonly state: LiveStreamState;
  readonly open: (target: string) => LiveStreamSource;
  readonly now: () => number;
  /** The state changed; the caller re-renders. */
  readonly onChange: () => void;
  readonly onEvent: (event: LiveTimelineEvent) => void;
}

/**
 * Open one connection and follow it until the returned function closes it.
 *
 * `EventSource` does the reconnecting: after a drop or a planned `end` it reopens on its
 * own with `Last-Event-ID`, which the route takes as the cursor, so a per-Run subscription
 * never skips and never repeats — and this still refuses a `seq` it has already seen, so a
 * repeat could not reach the page either way.
 *
 * **Opening a connection does not touch the clock, and neither does it answering.** Only
 * what the stream SENDS does: a Timeline frame or a heartbeat. A call to this function is
 * the page's own doing (a first subscription, or a new cursor from a server re-read), and
 * the route answers (`open`) before it has armed its LISTEN or read the chain, so an answer
 * says nothing about the stream: a route whose LISTEN fails answers too, sends `end` and
 * closes, and the browser opens the next connection two seconds later. So `open` is not
 * listened for at all. A stream that was lost stays lost, and a fresh page stays
 * `connecting`, until the stream sends a frame — which a healthy stream does at once,
 * because every connection hears a heartbeat as soon as its stream is armed and caught up.
 */
export function followLiveStream({ url, cursor, state, open, now, onChange, onEvent }: FollowLiveStream): () => void {
  const target = cursor === null ? url : `${url}?after=${state.lastSeq}`;
  const source = open(target);
  const heard = (): void => {
    state.clock = heardFromStream(now());
    onChange();
  };
  const onTimeline = (message: { readonly data?: unknown }): void => {
    const event = parseLiveEvent(message.data);
    if (event === null) return;
    if (cursor !== null) {
      // The one rule that makes a reconnect lossless AND duplicate-free, and it lives in
      // `live-status.ts` so the property is tested without a browser.
      if (!acceptsLiveSeq(state.lastSeq, event.seq)) return;
      state.lastSeq = event.seq;
    }
    heard();
    onEvent(event);
  };
  const onHeartbeat = (): void => { heard(); };
  const onError = (): void => {
    // CLOSED means the browser will not retry (a 401, a 404, a wrong media type);
    // CONNECTING means it is retrying on its own and the silence clock decides.
    if (source.readyState === LIVE_SOURCE_CLOSED) {
      state.clock = streamClosed(state.clock);
      onChange();
    }
  };
  source.addEventListener('timeline', onTimeline);
  source.addEventListener('heartbeat', onHeartbeat);
  source.addEventListener('error', onError);
  return () => {
    source.removeEventListener('timeline', onTimeline);
    source.removeEventListener('heartbeat', onHeartbeat);
    source.removeEventListener('error', onError);
    source.close();
  };
}

/**
 * A subscription to a per-Run stream begins (Story 10.8): it takes the clock the last
 * subscription to the same stream left, or starts a fresh one, and it opens from THIS
 * page's cursor.
 *
 * The cursor is reset because the state outlives the stream it was first opened for: a
 * component that stays mounted while its stream changes would otherwise open the new
 * stream after the old one's last sequence and skip every event before it. It is the
 * page's own cursor and never the larger of it and the last one seen: the page reads its
 * cursor beside its content, not after it, so a cursor ahead of what the page rendered
 * would skip the one frame that says the Run ended.
 *
 * Returns whether a clock was inherited.
 */
export function beginLiveSubscription(
  state: LiveStreamState,
  handOff: LiveClockHandOff,
  key: string,
  cursor: number | null,
  now: number,
): boolean {
  const taken = handOff.take(key, now);
  state.clock = taken ?? waitingLiveClock(now);
  state.lastSeq = cursor ?? 0;
  return taken !== null;
}

/**
 * A subscription to a per-Run stream ends: its connection is closed FIRST, and only then is
 * its clock left for the next subscription (Story 10.8 review).
 *
 * The other order leaves a window in which the connection is still open and the clock has
 * already been handed on, and a frame arriving in it lands on state nobody will read: the
 * next page inherits a silence the stream had already broken. Closing first means the clock
 * left is the last thing the stream said.
 */
export function endLiveSubscription(
  state: LiveStreamState,
  handOff: LiveClockHandOff,
  key: string,
  stop: () => void,
  now: number,
): void {
  stop();
  handOff.leave(key, state.clock, now);
}
