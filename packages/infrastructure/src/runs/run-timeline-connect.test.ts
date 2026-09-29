import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Database, Sql } from '../db/client.js';
import { HEARTBEAT_MS, RETRY_FRAME, openRunTimelineStream } from './run-timeline-channel.js';

/**
 * A new connection hears its stream at once (Story 10.8 review, P1).
 *
 * A client counts silence from the last frame it received, and `open` is not a frame. So
 * the stream itself says something as soon as it is armed and caught up: one heartbeat,
 * right after the replay, before the first periodic tick. Without it every planned renewal
 * and every page move opened about twelve seconds of silence on a healthy, quiet Run, and a
 * page moved again before the first tick never heard a frame at all.
 *
 * The engine is driven here with a fake client and a fake chain, so the ORDER is exact: the
 * frames are read with no timer advanced, which is what "before HEARTBEAT_MS" means. The
 * real PostgreSQL proof is `tests/integration/run-timeline-connect.test.ts`.
 */

const NOW = new Date('2026-09-26T09:00:00.000Z');
const RUN_ID = '019823ab-0000-7000-8000-00000000c0de';

interface Fakes {
  readonly sql: Sql;
  readonly db: Database;
  /** How many times the chain was read. */
  reads(): number;
  /** How many LISTENs were released. */
  released(): number;
}

function fakes({ chain = [] as readonly number[], listenFails = false, readFails = false } = {}): Fakes {
  let reads = 0;
  let released = 0;
  const sql = {
    listen: async () => {
      if (listenFails) throw new Error('LISTEN failed');
      return { unlisten: async () => { released += 1; } };
    },
  } as unknown as Sql;
  const rows = (after: number) => chain
    .filter((sequence) => sequence > after)
    .map((sequence) => ({ sequence, eventType: 'lifecycle.run-queued', occurredAt: NOW, outcome: 'success', source: 'web' }));
  // `readTimelineEnvelopes` asks for `sequence > lastSent`; the fake answers the first read
  // with the chain and every later one with nothing new, which is what a quiet Run does.
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async (limit: number) => {
              reads += 1;
              if (readFails) throw new Error('the chain cannot be read');
              return reads === 1 ? rows(0).slice(0, limit) : [];
            },
          }),
        }),
      }),
    }),
  } as unknown as Database;
  return { sql, db, reads: () => reads, released: () => released };
}

/** The named frames as they arrive: `retry`, `timeline`, `heartbeat` or `end`. */
function collect(stream: ReadableStream<Uint8Array>) {
  const frames: string[] = [];
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = '';
  let done = false;
  void (async () => {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) { done = true; return; }
      buffer += decoder.decode(chunk.value, { stream: true });
      let split: number;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        frames.push(`${block}\n\n` === RETRY_FRAME ? 'retry' : (/^event: (.+)$/m.exec(block)?.[1] ?? '?'));
      }
    }
  })();
  return { frames, done: () => done, cancel: () => reader.cancel().catch(() => undefined) };
}

/** Let every promise the stream is waiting on settle, with no timer advanced. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await new Promise<void>((resolve) => { setImmediate(resolve); });
}

describe('a new connection hears its stream at once', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('sends one heartbeat right after the replay, before the first periodic tick, and reads the chain once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const deps = fakes({ chain: [1, 2] });
    const controller = new AbortController();
    const stream = collect(openRunTimelineStream({ ...deps, now: () => NOW }, { runId: RUN_ID, after: 0, signal: controller.signal }));
    try {
      await settle();
      // No timer has run, so this heartbeat is not the periodic one.
      expect(stream.frames).toEqual(['retry', 'timeline', 'timeline', 'heartbeat']);
      // A frame only: it does not read the chain again.
      expect(deps.reads()).toBe(1);

      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS - 1);
      expect(stream.frames).toEqual(['retry', 'timeline', 'timeline', 'heartbeat']);
      // The periodic tick is the second heartbeat, and it reads the chain as it always did.
      await vi.advanceTimersByTimeAsync(1);
      expect(stream.frames).toEqual(['retry', 'timeline', 'timeline', 'heartbeat', 'heartbeat']);
      expect(deps.reads()).toBe(2);
    } finally {
      controller.abort();
      await stream.cancel();
    }
  });

  it('sends the heartbeat at once on a stream that has nothing to replay', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const deps = fakes();
    const controller = new AbortController();
    const stream = collect(openRunTimelineStream({ ...deps, now: () => NOW }, { runId: RUN_ID, after: 0, signal: controller.signal }));
    try {
      await settle();
      expect(stream.frames).toEqual(['retry', 'heartbeat']);
    } finally {
      controller.abort();
      await stream.cancel();
    }
  });

  it('sends the heartbeat at once on the list stream, which replays nothing and reads no chain', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const deps = fakes({ chain: [1, 2, 3] });
    const controller = new AbortController();
    const stream = collect(openRunTimelineStream({ ...deps, now: () => NOW }, { runId: null, after: 0, signal: controller.signal }));
    try {
      await settle();
      expect(stream.frames).toEqual(['retry', 'heartbeat']);
      expect(deps.reads()).toBe(0);
    } finally {
      controller.abort();
      await stream.cancel();
    }
  });

  it('sends no heartbeat from a stream whose LISTEN failed: it says unavailable and ends', async () => {
    const deps = fakes({ listenFails: true });
    const stream = collect(openRunTimelineStream({ ...deps, now: () => NOW }, { runId: RUN_ID, after: 0 }));
    await settle();
    expect(stream.frames).toEqual(['retry', 'end']);
    expect(stream.done()).toBe(true);
    expect(deps.reads()).toBe(0);
  });

  it('sends no heartbeat from a stream whose first read of the chain failed: it says unavailable and ends', async () => {
    const deps = fakes({ readFails: true });
    const stream = collect(openRunTimelineStream({ ...deps, now: () => NOW }, { runId: RUN_ID, after: 0 }));
    await settle();
    expect(stream.frames).toEqual(['retry', 'end']);
    expect(stream.done()).toBe(true);
    // The LISTEN it had armed is released with it.
    expect(deps.released()).toBe(1);
  });
});
