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
