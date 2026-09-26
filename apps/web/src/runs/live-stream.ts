import { acceptsLiveSeq, heardFromStream, streamClosed, streamOpened, type LiveClock } from './live-status';

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
 * **Opening a connection does not touch the clock.** Only what the stream SENDS does: a
 * Timeline frame or a heartbeat. A call to this function is the page's own doing (a first
 * subscription, or a new cursor from a server re-read), and the connection it opens
 * answering (`open`) says only that it is connected (`streamOpened`) — so a stream that
 * was lost is still lost until the stream sends a frame, and the gate over the live
 * controls stays closed until then.
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
  const onOpen = (): void => {
    state.clock = streamOpened(state.clock);
    onChange();
  };
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
  source.addEventListener('open', onOpen);
  source.addEventListener('error', onError);
  return () => {
    source.removeEventListener('timeline', onTimeline);
    source.removeEventListener('heartbeat', onHeartbeat);
    source.removeEventListener('open', onOpen);
    source.removeEventListener('error', onError);
    source.close();
  };
}
