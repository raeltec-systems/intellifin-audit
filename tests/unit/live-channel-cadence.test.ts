import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Database, Sql } from '../../packages/infrastructure/src/db/client.js';
import {
  HEARTBEAT_MS,
  RETRY_FRAME,
  STREAM_LIFETIME_MS,
  openRunTimelineStream,
} from '../../packages/infrastructure/src/runs/run-timeline-channel.js';
import {
  LIVE_SOURCE_CLOSED,
  beginLiveSubscription,
  endLiveSubscription,
  followLiveStream,
  type LiveStreamSource,
  type LiveStreamState,
} from '../../apps/web/src/runs/live-stream';
import {
  createLiveClockHandOff,
  liveClockStatus,
  waitingLiveClock,
  type LiveClockHandOff,
  type LiveStatus,
} from '../../apps/web/src/runs/live-status';

/**
 * A healthy, quiet stream reads `live` the whole time a page follows it (Story 10.8
 * review, P1).
 *
 * The page's silence clock moves only on a frame the stream sends, and a connection
 * answering is not one. That is right, and it made one thing visible: a NEW connection sent
 * nothing until its first periodic heartbeat, `HEARTBEAT_MS` later. So every planned
 * renewal, every page move and every hand-off opened a silence on a stream that was fine.
 * The stream now sends one heartbeat as soon as it is armed and caught up.
 *
 * These cases drive the REAL channel engine and the REAL page-side subscription together,
 * through a browser `EventSource` emulated closely enough to matter: it dispatches the
 * stream's named events, takes its reconnection delay from the stream's own `retry:` frame,
 * reconnects by itself when the server ends a response, and resumes from the last `id:` it
 * saw. The constants are the channel's own — `HEARTBEAT_MS`, `STREAM_LIFETIME_MS` and the
 * retry in `RETRY_FRAME` — imported, not restated. The status is sampled every second of
 * fake time and must be `live` at every sample.
 */

const RUN_ID = '019823ab-0000-7000-8000-00000000cade';
const STREAM = `/api/runs/${RUN_ID}/events`;
const RETRY_MS = Number(/^retry: (\d+)\n\n$/.exec(RETRY_FRAME)?.[1]);

/** A Run whose chain never moves: every read answers nothing new. */
const quiet = {
  sql: { listen: async () => ({ unlisten: async () => undefined }) } as unknown as Sql,
  db: {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }),
  } as unknown as Database,
};

interface Received { readonly name: string; readonly at: number }
interface Connection { readonly openedAt: number; readonly received: Received[]; endedByServer: boolean }

type Listener = (event: { readonly data?: unknown }) => void;
const CONNECTING = 0;
const OPEN = 1;

/** The part of a browser `EventSource` this page relies on, over the real engine. */
class BrowserEventSource implements LiveStreamSource {
  readyState = CONNECTING;
  private readonly listeners = new Map<string, Set<Listener>>();
  private retryMs = 3_000;
  private lastEventId: string | null = null;
  private abort: AbortController | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;

  constructor(target: string, private readonly engine: (after: number, signal: AbortSignal) => ReadableStream<Uint8Array>, private readonly log: Connection[]) {
    this.connect(Number(new URL(target, 'http://page').searchParams.get('after') ?? '0'));
  }

  private connect(after: number): void {
    const abort = new AbortController();
    this.abort = abort;
    const connection: Connection = { openedAt: Date.now(), received: [], endedByServer: false };
    this.log.push(connection);
    const reader = this.engine(after, abort.signal).getReader();
    void (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      this.readyState = OPEN;
      this.dispatch('open', undefined);
      for (;;) {
        const chunk = await reader.read().catch(() => ({ done: true as const, value: undefined }));
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let split: number;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          this.frame(block, connection);
        }
      }
      if (this.readyState === LIVE_SOURCE_CLOSED || this.abort !== abort) return;
      // The server ended the response: the browser says so and reconnects on its own, after
      // the delay the stream told it, from the last id it saw.
      connection.endedByServer = true;
      this.readyState = CONNECTING;
      this.dispatch('error', undefined);
      this.reconnect = setTimeout(() => {
        this.reconnect = null;
        if (this.readyState !== LIVE_SOURCE_CLOSED) this.connect(this.lastEventId === null ? after : Number(this.lastEventId));
      }, this.retryMs);
    })();
  }

  private frame(block: string, connection: Connection): void {
    let name = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('retry: ')) this.retryMs = Number(line.slice(7));
      else if (line.startsWith('id: ')) this.lastEventId = line.slice(4);
      else if (line.startsWith('event: ')) name = line.slice(7);
      else if (line.startsWith('data: ')) data.push(line.slice(6));
    }
    if (data.length === 0) return;
    connection.received.push({ name, at: Date.now() });
    this.dispatch(name, data.join('\n'));
  }

  private dispatch(type: string, data: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ data });
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = LIVE_SOURCE_CLOSED;
    if (this.reconnect !== null) clearTimeout(this.reconnect);
    this.abort?.abort();
  }
}

/** Let the engine and the emulated browser finish whatever is already due, with no fake time passing. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await new Promise<void>((resolve) => { setImmediate(resolve); });
}

/**
 * One page following the Run's stream, the way `useLiveTimeline` does: it begins by taking
 * whatever clock the last page left, follows the stream, and on leaving closes its
 * connection and leaves its clock.
 */
function page(handOff: LiveClockHandOff, connections: Connection[], lifetimeMs: number) {
  const state: LiveStreamState = { clock: waitingLiveClock(Date.now()), lastSeq: 0 };
  beginLiveSubscription(state, handOff, STREAM, 0, Date.now());
  const engine = (after: number, signal: AbortSignal) =>
    openRunTimelineStream(quiet, { runId: RUN_ID, after, signal, lifetimeMs });
  const stop = followLiveStream({
    url: STREAM,
    cursor: 0,
    state,
    open: (target) => new BrowserEventSource(target, engine, connections),
    now: () => Date.now(),
    onChange: () => undefined,
    onEvent: () => undefined,
  });
  return {
    status: (): LiveStatus => liveClockStatus(state.clock, Date.now()),
    leave: (): void => { endLiveSubscription(state, handOff, STREAM, stop, Date.now()); },
  };
}

/** Every second of fake time until `until`, the status then. */
async function secondBySecond(status: () => LiveStatus, until: number, seen: { at: number; status: LiveStatus }[]): Promise<void> {
  while (Date.now() < until) {
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    seen.push({ at: Date.now(), status: status() });
  }
}

const notLive = (seen: readonly { at: number; status: LiveStatus }[]) => seen.filter((sample) => sample.status !== 'live');

describe('a healthy, quiet stream reads live the whole time a page follows it', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('stays live through a planned renewal whose last heartbeat was almost an interval old', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    // The worst case of a renewal: the stream's lifetime ends just before its next heartbeat
    // would have gone out, so its last frame is nearly a full interval old when it ends.
    const lifetimeMs = STREAM_LIFETIME_MS - 100;
    const connections: Connection[] = [];
    const start = Date.now();
    const followed = page(createLiveClockHandOff(), connections, lifetimeMs);
    try {
      await settle();
      const seen = [{ at: Date.now(), status: followed.status() }];
      await secondBySecond(followed.status, start + STREAM_LIFETIME_MS + 30_000, seen);

      // The renewal really happened, the way the channel plans it.
      expect(connections).toHaveLength(2);
      const [first, second] = connections;
      expect(first!.endedByServer).toBe(true);
      const end = first!.received.at(-1)!;
      expect(end).toEqual({ name: 'end', at: start + lifetimeMs });
      const lastHeartbeat = first!.received.filter((frame) => frame.name === 'heartbeat').at(-1)!;
      expect(end.at - lastHeartbeat.at).toBe(HEARTBEAT_MS - 100);
      // The browser came back after the stream's own retry, and heard it at once.
      expect(second!.openedAt - end.at).toBe(RETRY_MS);
      expect(second!.received[0]).toEqual({ name: 'heartbeat', at: second!.openedAt });

      expect(seen.length).toBeGreaterThan(STREAM_LIFETIME_MS / 1_000);
      expect(notLive(seen)).toEqual([]);
    } finally {
      followed.leave();
    }
  });

  it('stays live through a page move made nine seconds after the last heartbeat', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const handOff = createLiveClockHandOff();
    const connections: Connection[] = [];
    const start = Date.now();
    const before = page(handOff, connections, STREAM_LIFETIME_MS);
    await settle();
    const seen = [{ at: Date.now(), status: before.status() }];
    await secondBySecond(before.status, start + 2 * HEARTBEAT_MS + 9_000, seen);
    const lastHeartbeat = connections[0]!.received.filter((frame) => frame.name === 'heartbeat').at(-1)!;
    expect(Date.now() - lastHeartbeat.at).toBe(9_000);

    // The move: the old page closes its connection and leaves its clock, the new page takes
    // it — in one commit, before either paints.
    before.leave();
    const after = page(handOff, connections, STREAM_LIFETIME_MS);
    try {
      // What the new page paints first is what the stream last said, not `connecting`.
      seen.push({ at: Date.now(), status: after.status() });
      await settle();
      expect(connections).toHaveLength(2);
      expect(connections[1]!.received[0]).toEqual({ name: 'heartbeat', at: Date.now() });
      seen.push({ at: Date.now(), status: after.status() });
      await secondBySecond(after.status, start + 60_000, seen);
      expect(notLive(seen)).toEqual([]);
    } finally {
      after.leave();
    }
  });

  it('never goes stale or lost while the page moves every five seconds for a minute', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    // Every connection is closed before its first periodic heartbeat, so only the heartbeat
    // each one hears at once can keep the page's clock moving.
    expect(5_000).toBeLessThan(HEARTBEAT_MS);
    const handOff = createLiveClockHandOff();
    const connections: Connection[] = [];
    const start = Date.now();
    let current = page(handOff, connections, STREAM_LIFETIME_MS);
    await settle();
    const seen = [{ at: Date.now(), status: current.status() }];
    try {
      for (let move = 1; move <= 12; move += 1) {
        await secondBySecond(current.status, start + move * 5_000, seen);
        current.leave();
        current = page(handOff, connections, STREAM_LIFETIME_MS);
        seen.push({ at: Date.now(), status: current.status() });
        await settle();
        seen.push({ at: Date.now(), status: current.status() });
      }
    } finally {
      current.leave();
    }
    expect(connections).toHaveLength(13);
    expect(connections.every((connection) => connection.received.every((frame) => frame.name === 'heartbeat'))).toBe(true);
    expect(seen.filter((sample) => sample.status === 'stale' || sample.status === 'lost')).toEqual([]);
    expect(notLive(seen)).toEqual([]);
  });
});
