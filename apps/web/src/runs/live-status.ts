import { LIVE_VIEW_DESKTOP_ONLY_SENTENCE } from '../design/copy';

/**
 * The live channel as a page experiences it (Story 5.1, UX-DR25, NFR7).
 *
 * A closed status vocabulary and the two thresholds the contract fixes: a page that has
 * seen no frame — Timeline event or heartbeat — for 15 seconds is STALE, and after 60
 * seconds it has LOST the stream. Pure functions over instants, so the thresholds are
 * tested without a browser and the component cannot drift from them. The sentences live
 * here rather than on the component for the reason every other closed vocabulary in this
 * repository keeps its words beside its states.
 */

export const LIVE_STALE_MS = 15_000;
export const LIVE_LOST_MS = 60_000;

export const LIVE_STATUSES = ['connecting', 'live', 'stale', 'lost', 'ended'] as const;
export type LiveStatus = (typeof LIVE_STATUSES)[number];

export interface LiveStatusInputs {
  /** The stream reported `end` and will not reconnect on its own. */
  readonly ended: boolean;
  /** The instant of the last frame seen (event or heartbeat), or the instant the page started waiting. */
  readonly lastMessageAt: number;
  /** Whether any frame has been seen at all since this subscription began. */
  readonly everConnected: boolean;
  readonly now: number;
}

export function liveStatus({ ended, lastMessageAt, everConnected, now }: LiveStatusInputs): LiveStatus {
  if (ended) return 'ended';
  const silence = Math.max(0, now - lastMessageAt);
  if (silence >= LIVE_LOST_MS) return 'lost';
  if (silence >= LIVE_STALE_MS) return 'stale';
  return everConnected ? 'live' : 'connecting';
}

/** Whole seconds of silence, for the stale sentence. */
export function silenceSeconds(lastMessageAt: number, now: number): number {
  return Math.max(0, Math.floor((now - lastMessageAt) / 1000));
}

/**
 * What a page has heard from one live stream, and the only thing that changes it
 * (Story 10.8).
 *
 * `lastFrameAt` is the instant of the last frame the STREAM ITSELF delivered — a Timeline
 * event, a heartbeat, or the stream answering when it opens — or, before any, the instant
 * the page began waiting for one. Nothing the page does to itself moves it: a server
 * re-read, a new cursor, a new subscription and a remount are all the page's own doing.
 *
 * That was the defect this shape removes. The subscription effect restarted the clock
 * every time it ran, and a server re-read that moved the cursor re-ran it — so a re-read
 * that landed during a drop (the shell's bell refreshing because ANOTHER Run ended) made
 * the page say `live` for up to 15 seconds and reopened the controls for up to 60, while
 * the stream it depends on was still down. A server read gives the page a snapshot; only
 * the stream tells it what the Run is doing, and only the stream can say it is back.
 */
export interface LiveClock {
  readonly lastFrameAt: number;
  /** Whether the stream has answered this subscription at all. */
  readonly everConnected: boolean;
  /** The browser reported the stream CLOSED: it will not reconnect on its own. */
  readonly ended: boolean;
}

/** The clock of a page that has just begun waiting for its stream. */
export function waitingLiveClock(now: number): LiveClock {
  return { lastFrameAt: now, everConnected: false, ended: false };
}

/**
 * The stream itself said something. The ONE way back to `live`, and so the one way a
 * gate closed for `lost` or `ended` opens again.
 */
export function heardFromStream(now: number): LiveClock {
  return { lastFrameAt: now, everConnected: true, ended: false };
}

/** The browser closed the stream for good (a 401, a 404, a wrong media type). */
export function streamClosed(clock: LiveClock): LiveClock {
  return { ...clock, ended: true };
}

export function liveClockStatus(clock: LiveClock, now: number): LiveStatus {
  return liveStatus({ ended: clock.ended, lastMessageAt: clock.lastFrameAt, everConnected: clock.everConnected, now });
}

/**
 * A clock taken over by a NEW subscription to the same stream — a remount.
 *
 * The silence it had carries on, so a stream that was lost stays lost and one that had
 * ended stays ended until the stream itself says something. Two things are adjusted, and
 * neither is a recovery: the time in which nothing on the page was subscribed is not
 * counted as silence, because nothing was listening for a frame then; and the new
 * subscription has heard nothing yet, so a healthy clock reads `connecting` rather than
 * claiming a connection it has not made.
 */
export function resumedLiveClock(clock: LiveClock, leftAt: number, now: number): LiveClock {
  return {
    lastFrameAt: clock.lastFrameAt + Math.max(0, now - leftAt),
    everConnected: false,
    ended: clock.ended,
  };
}

/**
 * Where a subscription leaves its clock for the next subscription to the same stream
 * (Story 10.8).
 *
 * A remount is a new component with new state, so without this the clock it inherited
 * would be the one thing a remount could reset — and resetting it is exactly what a
 * re-read must never do. `leave` is called when a subscription ends; `take` hands what it
 * left to the next one, resumed, and forgets it, so one clock is never resumed twice.
 * Nothing left means there is nothing to inherit, which is a fresh page's own state.
 *
 * A `Map`, never a plain object: the key is a URL and an inherited property name must not
 * read as a clock somebody left.
 */
export interface LiveClockHandOff {
  leave(key: string, clock: LiveClock, at: number): void;
  take(key: string, now: number): LiveClock | null;
}

export function createLiveClockHandOff(): LiveClockHandOff {
  const left = new Map<string, { readonly clock: LiveClock; readonly at: number }>();
  return {
    leave(key, clock, at) {
      left.set(key, { clock, at });
    },
    take(key, now) {
      const entry = left.get(key);
      if (entry === undefined) return null;
      left.delete(key);
      return resumedLiveClock(entry.clock, entry.at, now);
    },
  };
}

/**
 * The status as ONE word, which is what the banner's polite live region announces (the
 * counting sentence beside it is not announced). Beside the states for the reason the
 * sentences below are, and so a browser spec can pin the word without importing React.
 */
export const LIVE_WORDS = {
  connecting: 'Connecting',
  live: 'Live',
  stale: 'No update',
  lost: 'Connection lost',
  ended: 'Live update ended',
} as const satisfies Record<LiveStatus, string>;

export const LIVE_SENTENCES = {
  connecting: 'Connecting to the Run. The page updates on its own once connected.',
  live: 'Live. The page updates on its own as the Run progresses.',
  stale: 'No update for {seconds} seconds. The page may be behind the Run.',
  // UX-DR25's own sentence for the lost stream; Story 5.7 disables the controls under it.
  lost: 'Connection to the Run lost. Reconnecting.',
  ended: 'The live update ended. Refresh to continue.',
} as const satisfies Record<LiveStatus, string>;

export function liveSentence(status: LiveStatus, seconds: number): string {
  return LIVE_SENTENCES[status].replace('{seconds}', String(seconds));
}

/**
 * The Timeline events that mean this Run has ENDED (Story 5.7).
 *
 * `completeRun` is the one place a Run reaches a terminal state and it appends
 * `lifecycle.result-sealed` on every path, so that one event covers Completed,
 * Inconclusive and Run Failed together; `lifecycle.run-canceled` is appended beside it on
 * the cancellation path. One home, because the bell composes the same list and two copies
 * would diverge on the first terminal path a later story adds.
 */
export const RUN_ENDING_EVENTS = ['lifecycle.result-sealed', 'lifecycle.run-canceled'] as const;

export function isRunEndingEvent(eventType: string): boolean {
  return (RUN_ENDING_EVENTS as readonly string[]).includes(eventType);
}

/**
 * Whether the live controls may be used, and why not when they may not (Story 5.7,
 * UX-DR25).
 *
 * THREE reasons, and `stale` is deliberately not one of them. UX-DR25 disables the
 * controls after sixty seconds of silence, not fifteen: a quiet Run goes stale routinely,
 * and a surface that locked itself every fifteen seconds would be unusable exactly when
 * somebody most wants to pause it.
 *
 * `ended` is included although the contract names only `lost`, because `ended` is the
 * stronger case: a lost stream is reconnecting on its own and an ended one is not, so a
 * page that gated the recoverable state and not the permanent one would have it backwards.
 *
 * `runEnded` outranks both. It is set the moment the terminal event ARRIVES, which is what
 * closes the window between that event and the server re-read that removes the controls —
 * about a second, in which every control was live on a Run that had already finished.
 */
export const LIVE_GATE_REASONS = {
  /**
   * The narrow-viewport reason (PR 29 review). EXPERIENCE.md's responsive rules make Live
   * View READ-ONLY below 1024px, and the stylesheet only revealed the desktop-only
   * sentence while leaving Pause, Cancel, Flag and the Escalation answer fully usable —
   * so a Run could be mutated from a viewport the contract defines as read-only.
   *
   * It is a gate reason rather than a `display: none`, so the Escalation's question, its
   * candidates and the Paused banner all stay readable on a phone and only the ACTING
   * stops — and each withdrawn control says why, which a hidden control cannot.
   */
  viewport: LIVE_VIEW_DESKTOP_ONLY_SENTENCE,
  runEnded: 'This Run has ended, so its live controls are no longer available.',
  lost: 'Controls are unavailable while the connection to this Run is lost.',
  ended: 'Controls are unavailable because this page is no longer updating on its own. Refresh to continue.',
} as const;

export type LiveGateReason = keyof typeof LIVE_GATE_REASONS;

/**
 * `desktop` is what the page has OBSERVED about its own viewport, and it OUTRANKS the
 * stream reasons: "open this on a desktop" is the sentence a reader on a phone can act
 * on, where "the connection is lost" is not.
 *
 * It defaults to true for callers that cannot observe one, which is the server. See
 * `useDesktopViewport` for why the withdrawn default would have broken Flag's
 * no-JavaScript path.
 */
export function liveGateReason(status: LiveStatus, runEnded: boolean, desktop = true): LiveGateReason | null {
  if (!desktop) return 'viewport';
  if (runEnded) return 'runEnded';
  if (status === 'lost') return 'lost';
  if (status === 'ended') return 'ended';
  return null;
}

/**
 * Whether a per-Run subscription renders the frame it just received (Stories 5.1, 5.7).
 *
 * A reconnect resumes at the last sequence the page SAW, so the server replays from there
 * and the first frames after a drop are ones the page may already hold — that is what
 * makes the replay lossless, and it is also what would make it duplicate. Strictly
 * greater is both halves of the rule: no gap, because the cursor is the last seen and the
 * server replays everything after it; no duplicate, because anything at or below it is
 * already rendered.
 *
 * The cursor therefore only ever grows, which is why a frame that arrives out of order
 * after a slow reconnect cannot walk it backwards.
 */
export function acceptsLiveSeq(lastSeq: number, seq: number): boolean {
  return Number.isSafeInteger(seq) && seq > lastSeq;
}

/**
 * The cursor a per-Run stream request names: the `Last-Event-ID` header `EventSource`
 * sends on reconnect, else `after` in the query, else 0. The header wins because a
 * reconnect carries BOTH — the query the page first opened with and the header naming
 * the last frame it saw — and only the header is current. `null` is a cursor that is
 * not a non-negative safe integer, which the route answers 400.
 */
export function parseLiveCursor(url: URL, lastEventId: string | null): number | null {
  const header = lastEventId === null || lastEventId === '' ? null : lastEventId;
  const raw = header ?? url.searchParams.get('after');
  if (raw === null || raw === '') return 0;
  if (!/^(?:0|[1-9][0-9]{0,15})$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * What a MediaQueryList looks like to the viewport gate: the SHAPE, not the DOM type, so a
 * test can hand it the three shapes real browsers have without a DOM. Safari 13 and earlier
 * expose only the legacy `addListener` / `removeListener` pair.
 */
export interface ViewportQueryList {
  readonly matches: boolean;
  addEventListener?(type: 'change', listener: () => void): void;
  removeEventListener?(type: 'change', listener: () => void): void;
  addListener?(listener: () => void): void;
  removeListener?(listener: () => void): void;
}

/**
 * Subscribe `read` to viewport changes and return the unsubscribe.
 *
 * `addEventListener` where the list has it; the legacy pair where it has only that; and a
 * list with neither is read once at mount and never again, which is the gate's own stated
 * default (open) rather than a throw that would take the whole surface down to close a gate.
 * The fallback exists because the guard that replaced the throw first RETURNED before
 * subscribing, so a Safari 13 tablet rotated across the 1024px floor kept whatever verdict
 * it had at mount — the Codex finding on PR 36. Pure, so the branch a browser test cannot
 * reach is proven here.
 */
export function subscribeViewport(query: ViewportQueryList, read: () => void): () => void {
  if (typeof query.addEventListener === 'function' && typeof query.removeEventListener === 'function') {
    query.addEventListener('change', read);
    return () => { query.removeEventListener?.('change', read); };
  }
  if (typeof query.addListener === 'function' && typeof query.removeListener === 'function') {
    query.addListener(read);
    return () => { query.removeListener?.(read); };
  }
  return () => undefined;
}
