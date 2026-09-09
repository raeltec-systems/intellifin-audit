import { and, asc, eq, gt } from 'drizzle-orm';

import type { Database, Sql } from '../db/client.js';
import { auditEventHeads, auditEvents } from '../db/schema.js';

/**
 * The live Timeline channel (Story 5.1, AD-17): LISTEN on what every writer already
 * NOTIFYs, replay the chain from a cursor, forward what commits, keep the response alive,
 * end it on a schedule, and tear the subscription down when the request goes away.
 *
 * The contract is `docs/contracts/live-timeline-channel-v1.md`. Two rules carry it:
 *
 * - A notification is a WAKE-UP, never the data. Every frame sent is a row read from
 *   `audit_events` with `sequence > lastSent`, in order, so a lost or coalesced
 *   notification cannot lose an event and `lastSent` only ever grows, so nothing is sent
 *   twice. The subscription is armed BEFORE the replay from the cursor, so an event that
 *   commits during the replay is read by the wake-up that follows it.
 * - The stream carries the chain's ENVELOPE — sequence, type, instant, outcome, source —
 *   and never its payload. A payload can hold every digest of an Observation batch and
 *   every diagnostic quoting a Target System; a consumer re-reads what it renders from
 *   PostgreSQL at the sequence it was told about.
 */

/** The NOTIFY channel every Timeline writer uses. Pinned by the module's own test against the writers' source. */
export const RUN_TIMELINE_CHANNEL = 'run_timeline';

export interface TimelineNotification {
  readonly runId: string;
  readonly sequence: number;
}

/** `{"runId":"…","sequence":n}` as the writers spell it; anything else is not a wake-up. */
export function parseTimelineNotification(payload: string): TimelineNotification | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const { runId, sequence } = parsed as { runId?: unknown; sequence?: unknown };
  if (typeof runId !== 'string' || runId === '' || runId.length > 200) return null;
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1) return null;
  return { runId, sequence };
}

/** One Timeline event as the stream carries it. No payload, by contract. */
export interface TimelineEnvelope {
  readonly runId: string;
  readonly seq: number;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly outcome: string;
  readonly source: string;
}

export const TIMELINE_REPLAY_PAGE = 200;

/** Every event of the Run with `sequence > after`, in sequence order, at most `limit` of them. */
export async function readTimelineEnvelopes(
  db: Database,
  runId: string,
  after: number,
  limit: number = TIMELINE_REPLAY_PAGE,
): Promise<readonly TimelineEnvelope[]> {
  const rows = await db
    .select({
      sequence: auditEvents.sequence,
      eventType: auditEvents.eventType,
      occurredAt: auditEvents.occurredAt,
      outcome: auditEvents.outcome,
      source: auditEvents.source,
    })
    .from(auditEvents)
    .where(and(eq(auditEvents.aggregateId, runId), gt(auditEvents.sequence, after)))
    .orderBy(asc(auditEvents.sequence))
    .limit(limit);
  return rows.map((row) => ({
    runId,
    seq: row.sequence,
    eventType: row.eventType,
    occurredAt: row.occurredAt.toISOString(),
    outcome: row.outcome,
    source: row.source,
  }));
}

/** The Run chain's current head sequence: the cursor a page rendered now should resume from. 0 when nothing is chained yet. */
export async function readTimelineHead(db: Database, runId: string): Promise<number> {
  const [row] = await db
    .select({ lastSequence: auditEventHeads.lastSequence })
    .from(auditEventHeads)
    .where(eq(auditEventHeads.aggregateId, runId))
    .limit(1);
  return row?.lastSequence ?? 0;
}

/* ------------------------------------------------------------- SSE framing --- */

/** `retry:` tells `EventSource` how long to wait before reconnecting with `Last-Event-ID`. */
export const RETRY_FRAME = 'retry: 2000\n\n';
/** At most every 30 seconds by AD-17; every 10 so a 15-second stale rule cannot flap on a healthy stream. */
export const HEARTBEAT_MS = 10_000;
/** Under Railway's 15-minute response cap, so the reconnect is planned rather than proxy-forced. */
export const STREAM_LIFETIME_MS = 14 * 60_000;

export type StreamEndReason = 'lifetime' | 'unavailable';

export function formatTimelineFrame(envelope: TimelineEnvelope): string {
  // `id` is the cursor `EventSource` sends back as `Last-Event-ID`; only the per-Run
  // stream sets it, because only the per-Run stream makes a replay guarantee.
  return `id: ${envelope.seq}\nevent: timeline\ndata: ${JSON.stringify(envelope)}\n\n`;
}

export function formatListFrame(envelope: TimelineEnvelope): string {
  return `event: timeline\ndata: ${JSON.stringify(envelope)}\n\n`;
}

export function formatHeartbeatFrame(at: Date): string {
  return `event: heartbeat\ndata: ${JSON.stringify({ at: at.toISOString() })}\n\n`;
}

export function formatEndFrame(reason: StreamEndReason): string {
  return `event: end\ndata: ${JSON.stringify({ reason })}\n\n`;
}

/* ---------------------------------------------------------------- the engine --- */

export interface TimelineStreamDependencies {
  readonly sql: Sql;
  readonly db: Database;
  /** Injectable for tests; defaults to the wall clock. */
  readonly now?: () => Date;
}

export interface TimelineStreamOptions {
  /** The Run whose chain is replayed and followed, or `null` for the list stream that forwards every Run's events. */
  readonly runId: string | null;
  /** Replay starts strictly after this sequence. Ignored for the list stream. */
  readonly after: number;
  /** The request's signal: abort ends the stream and tears the LISTEN down. */
  readonly signal?: AbortSignal | undefined;
  readonly heartbeatMs?: number;
  readonly lifetimeMs?: number;
  readonly pageSize?: number;
}

const encoder = new TextEncoder();

/**
 * A `ReadableStream` of SSE bytes for one Run, or for every Run.
 *
 * Per-Run: LISTEN, then replay `sequence > after` in pages, then on every wake-up and
 * every heartbeat read `sequence > lastSent` again. Reads are serialized: a wake-up that
 * lands during a read queues one more pass rather than a concurrent one, which is what
 * keeps the order and the once-only property without a lock.
 *
 * List: every notification is looked up in the table (the row it names, by Run and
 * sequence) and forwarded without an `id`, because no replay guarantee is made there.
 */
export function openRunTimelineStream(
  deps: TimelineStreamDependencies,
  options: TimelineStreamOptions,
): ReadableStream<Uint8Array> {
  const now = deps.now ?? (() => new Date());
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const lifetimeMs = options.lifetimeMs ?? STREAM_LIFETIME_MS;
  const pageSize = options.pageSize ?? TIMELINE_REPLAY_PAGE;

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let lastSent = options.after;
  let closed = false;
  let reading = false;
  let queued = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lifetime: ReturnType<typeof setTimeout> | null = null;
  let unlisten: (() => Promise<void>) | null = null;
  const onAbort = (): void => { void end(null); };

  function send(frame: string): void {
    if (closed || controller === null) return;
    controller.enqueue(encoder.encode(frame));
  }

  async function end(reason: StreamEndReason | null): Promise<void> {
    if (closed) return;
    closed = true;
    if (heartbeat !== null) clearInterval(heartbeat);
    if (lifetime !== null) clearTimeout(lifetime);
    options.signal?.removeEventListener('abort', onAbort);
    const release = unlisten;
    unlisten = null;
    try {
      // A frame after `closed` is dropped by `send`, so write the end frame directly.
      if (reason !== null && controller !== null) controller.enqueue(encoder.encode(formatEndFrame(reason)));
      controller?.close();
    } catch {
      // The consumer is already gone; nothing to tell it.
    }
    if (release !== null) {
      try { await release(); } catch { /* the connection may already be gone */ }
    }
  }

  /** Read everything past `lastSent`, in order, one pass at a time. */
  async function catchUp(): Promise<void> {
    if (options.runId === null) return;
    if (reading) { queued = true; return; }
    reading = true;
    try {
      do {
        queued = false;
        let page: readonly TimelineEnvelope[];
        do {
          if (closed) return;
          page = await readTimelineEnvelopes(deps.db, options.runId, lastSent, pageSize);
          for (const envelope of page) {
            if (envelope.seq <= lastSent) continue;
            send(formatTimelineFrame(envelope));
            lastSent = envelope.seq;
          }
        } while (page.length === pageSize);
      } while (queued);
    } catch {
      await end('unavailable');
    } finally {
      reading = false;
    }
  }

  async function forward(notification: TimelineNotification): Promise<void> {
    try {
      const rows = await readTimelineEnvelopes(deps.db, notification.runId, notification.sequence - 1, 1);
      const row = rows[0];
      if (row !== undefined && row.seq === notification.sequence) send(formatListFrame(row));
    } catch {
      await end('unavailable');
    }
  }

  return new ReadableStream<Uint8Array>({
    async start(streamController) {
      controller = streamController;
      if (options.signal?.aborted) { await end(null); return; }
      options.signal?.addEventListener('abort', onAbort, { once: true });
      send(RETRY_FRAME);
      try {
        const listening = await deps.sql.listen(RUN_TIMELINE_CHANNEL, (payload) => {
          if (closed) return;
          const notification = parseTimelineNotification(payload);
          if (notification === null) return;
          if (options.runId === null) { void forward(notification); return; }
          if (notification.runId === options.runId && notification.sequence > lastSent) void catchUp();
        });
        unlisten = () => listening.unlisten();
      } catch {
        await end('unavailable');
        return;
      }
      if (closed) { const release = unlisten; unlisten = null; await release?.(); return; }
      await catchUp();
      if (closed) return;
      heartbeat = setInterval(() => { send(formatHeartbeatFrame(now())); void catchUp(); }, heartbeatMs);
      lifetime = setTimeout(() => { void end('lifetime'); }, lifetimeMs);
    },
    cancel() {
      return end(null);
    },
  });
}
