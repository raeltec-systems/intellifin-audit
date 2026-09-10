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
  runEnded: 'This Run has ended, so its live controls are no longer available.',
  lost: 'Controls are unavailable while the connection to this Run is lost.',
  ended: 'Controls are unavailable because this page is no longer updating on its own. Refresh to continue.',
} as const;

export type LiveGateReason = keyof typeof LIVE_GATE_REASONS;

export function liveGateReason(status: LiveStatus, runEnded: boolean): LiveGateReason | null {
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
