import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelRun, initiateRun, type CancelRunDependencies, type RunDependencies } from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunCancellationRepository,
  PostgresRunsUnitOfWork,
  SystemClock,
  openRunTimelineStream,
  readTimelineHead,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * The live Timeline channel against a real PostgreSQL 18 (Story 5.1, AD-17).
 *
 * Every event here is appended by the REAL commands — `initiateRun`, `cancelRun` — whose
 * transactions issue the NOTIFY, so what is asserted is the channel end to end: the
 * replay from a cursor, the live delivery in sequence order with nothing skipped and
 * nothing repeated, the resume from a later cursor, the heartbeat, the planned end, the
 * listener released on abort, the list stream, and the honest `unavailable` end.
 */

interface Frame { readonly id: string | null; readonly event: string | null; readonly data: string | null }

/** Parses the SSE bytes of one stream into frames as they arrive, with a deadline per read. */
class FrameReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  readonly frames: Frame[] = [];
  done = false;
  constructor(stream: ReadableStream<Uint8Array>) { this.reader = stream.getReader(); }

  /** Read until `predicate` holds over the frames so far, the stream ends, or `timeoutMs` passes. */
  async until(predicate: (frames: readonly Frame[]) => boolean, timeoutMs: number): Promise<readonly Frame[]> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate(this.frames) && !this.done) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const chunk = await Promise.race([
        this.reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) => setTimeout(() => resolve({ done: true, value: undefined }), remaining)),
      ]);
      if (chunk.done) { if (chunk.value === undefined && Date.now() >= deadline) break; if (chunk.value === undefined) { this.done = this.done || (await this.closedNow()); } continue; }
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
      let split: number;
      while ((split = this.buffer.indexOf('\n\n')) >= 0) {
        const block = this.buffer.slice(0, split);
        this.buffer = this.buffer.slice(split + 2);
        let id: string | null = null, event: string | null = null, data: string | null = null;
        for (const line of block.split('\n')) {
          if (line.startsWith('id: ')) id = line.slice(4);
          else if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data = line.slice(6);
          else if (line.startsWith('retry: ')) event = 'retry';
        }
        this.frames.push({ id, event, data });
      }
    }
    return this.frames;
  }

  private async closedNow(): Promise<boolean> {
    const probe = await Promise.race([this.reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 20))]);
    if (probe === null) return false;
    if (probe.done) return true;
    this.buffer += this.decoder.decode(probe.value, { stream: true });
    return false;
  }

  timeline(): readonly Frame[] { return this.frames.filter((frame) => frame.event === 'timeline'); }
  async close(): Promise<void> { await this.reader.cancel().catch(() => undefined); }
}

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('the live Timeline channel', () => {
  let sql: Sql, db: Database;
  const ids = new CryptoUuidV7Generator();
  const author = `${ids.next()}-live-author`;
  const procedures: string[] = [];
  const session = { userId: author, sessionId: `${author}-session` };
  const period = { from: '2026-08-01', to: '2026-08-31' };
  let released = 0;
  let listened = 0;

  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1)))
      throw new Error('Live channel tests require an isolated local or CI test database');
    sql = createSqlClient(url!, { max: 6 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'Live channel test',${`${author}@test.invalid`})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const id of procedures) {
        const runs = await sql`SELECT run_id::text AS id FROM audit_run WHERE procedure_id=${id}`;
        for (const run of runs) {
          await sql`DELETE FROM pgboss.job WHERE name='runs' AND data->>'runId'=${run.id}`;
          await sql`DELETE FROM audit_events WHERE aggregate_id=${run.id}`;
          await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${run.id}`;
        }
        await sql`DELETE FROM run_result WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
        await sql`DELETE FROM run_gate_check WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
        await sql`DELETE FROM run_evidence_integrity WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
        await sql`DELETE FROM run_evidence_package WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
        await sql`DELETE FROM run_initiation_request WHERE procedure_id=${id}`;
        await sql`DELETE FROM audit_run WHERE procedure_id=${id}`;
        await sql`DELETE FROM procedure_succession WHERE procedure_id=${id}`;
        await sql`DELETE FROM procedure_version WHERE procedure_id=${id}`;
        await sql`DELETE FROM procedure WHERE procedure_id=${id}`;
      }
      await sql`DELETE FROM run_initiation_request WHERE initiator_id=${author}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  /** The real client, with the listener hand-over counted so a teardown is observable. */
  function countedSql(): Sql {
    return new Proxy(sql, {
      get(target, property, receiver) {
        if (property !== 'listen') return Reflect.get(target, property, receiver);
        return (channel: string, handler: (payload: string) => void) => {
          listened += 1;
          const request = target.listen(channel, handler);
          return request.then((meta) => ({ ...meta, unlisten: async () => { released += 1; await meta.unlisten(); } }));
        };
      },
    });
  }

  const runDependencies = (): RunDependencies => ({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock: new SystemClock() });
  const cancelDependencies = (): CancelRunDependencies =>
    ({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), repository: new PostgresRunCancellationRepository(db), ids, clock: new SystemClock() });

  async function seed(): Promise<string> {
    const row = activeRunVersion(ids.next(), ids.next(), author);
    procedures.push(row.procedureId);
    await new PostgresProceduresUnitOfWork(db).execute(async c => {
      await c.procedures.insertProcedure(row);
      await c.procedures.insertVersion(row);
    });
    return row.procedureId;
  }

  async function start(procedureId: string): Promise<string> {
    const outcome = await initiateRun(runDependencies(), { session, request: { procedureId, period, requestToken: ids.next() } });
    if (!outcome.ok) throw new Error(outcome.reason);
    return outcome.runId;
  }

  function open(runId: string | null, after: number, options: { heartbeatMs?: number; lifetimeMs?: number; pageSize?: number; signal?: AbortSignal; db?: Database } = {}): FrameReader {
    return new FrameReader(openRunTimelineStream({ sql: countedSql(), db: options.db ?? db }, {
      runId, after, signal: options.signal, heartbeatMs: options.heartbeatMs ?? 60_000, lifetimeMs: options.lifetimeMs ?? 60_000, pageSize: options.pageSize ?? 200,
    }));
  }

  it('replays the chain from the cursor, then delivers what the real commands append, in order and once', async () => {
    const runId = await start(await seed());
    expect(await readTimelineHead(db, runId)).toBe(1);

    const stream = open(runId, 0, { heartbeatMs: 100 });
    try {
      let frames = await stream.until((f) => f.filter((x) => x.event === 'timeline').length >= 1 && f.some((x) => x.event === 'heartbeat'), 5_000);
      expect(frames[0]).toEqual({ id: null, event: 'retry', data: null });
      const queued = stream.timeline();
      expect(queued).toHaveLength(1);
      expect(queued[0]!.id).toBe('1');
      expect(JSON.parse(queued[0]!.data!)).toMatchObject({ runId, seq: 1, eventType: 'lifecycle.run-queued', source: 'web' });
      expect(JSON.parse(stream.frames.find((x) => x.event === 'heartbeat')!.data!)).toMatchObject({ at: expect.stringMatching(/Z$/) });

      // Live: a real cancellation appends three chained events in one transaction.
      expect(await cancelRun(cancelDependencies(), { session, request: { runId, reason: null } })).toEqual({ ok: true, state: 'CANCELED', pending: false });
      frames = await stream.until((f) => f.filter((x) => x.event === 'timeline').length >= 4, 5_000);
      const live = stream.timeline();
      expect(live.map((x) => x.id)).toEqual(['1', '2', '3', '4']);
      expect(live.map((x) => JSON.parse(x.data!).eventType)).toEqual([
        'lifecycle.run-queued', 'lifecycle.run-canceled', 'lifecycle.evidence-package-sealed', 'lifecycle.result-sealed',
      ]);
      // Nothing arrives twice, however many heartbeats and wake-ups follow.
      await stream.until(() => false, 300);
      expect(stream.timeline().map((x) => x.id)).toEqual(['1', '2', '3', '4']);
      expect(stream.frames.every((x) => x.event === 'timeline' ? x.data !== null && !('payload' in JSON.parse(x.data)) : true)).toBe(true);
    } finally {
      await stream.close();
    }

    // Resume from a later cursor: exactly the events after it, and none twice.
    const resumed = open(runId, 2, { pageSize: 1 });
    try {
      await resumed.until((f) => f.filter((x) => x.event === 'timeline').length >= 2, 5_000);
      expect(resumed.timeline().map((x) => x.id)).toEqual(['3', '4']);
      await resumed.until(() => false, 200);
      expect(resumed.timeline().map((x) => x.id)).toEqual(['3', '4']);
    } finally {
      await resumed.close();
    }

    // From the head: nothing but the keepalive.
    const atHead = open(runId, 4, { heartbeatMs: 50 });
    try {
      await atHead.until((f) => f.some((x) => x.event === 'heartbeat'), 2_000);
      expect(atHead.timeline()).toHaveLength(0);
      expect(atHead.frames.some((x) => x.event === 'heartbeat')).toBe(true);
    } finally {
      await atHead.close();
    }
  });

  it('ends itself at the lifetime with a planned end frame, and releases its listener', async () => {
    const runId = await start(await seed());
    const before = released;
    const stream = open(runId, 0, { lifetimeMs: 150 });
    const frames = await stream.until((f) => f.some((x) => x.event === 'end'), 5_000);
    expect(frames.at(-1)).toEqual({ id: null, event: 'end', data: JSON.stringify({ reason: 'lifetime' }) });
    await stream.until(() => false, 500);
    expect(stream.done).toBe(true);
    expect(released).toBe(before + 1);
  });

  it('tears the listener down when the request is aborted, with no end frame', async () => {
    const runId = await start(await seed());
    const before = released;
    const controller = new AbortController();
    const stream = open(runId, 0, { signal: controller.signal });
    await stream.until((f) => f.filter((x) => x.event === 'timeline').length >= 1, 5_000);
    controller.abort();
    await stream.until(() => false, 1_000);
    expect(stream.done).toBe(true);
    expect(stream.frames.some((x) => x.event === 'end')).toBe(false);
    expect(released).toBe(before + 1);
  });

  it('forwards every Run on the list stream, read from the chain, without a cursor', async () => {
    const stream = open(null, 0);
    try {
      const procedureId = await seed();
      const runId = await start(procedureId);
      const frames = await stream.until((f) => f.some((x) => x.event === 'timeline' && x.data !== null && JSON.parse(x.data).runId === runId), 5_000);
      const frame = frames.find((x) => x.event === 'timeline' && x.data !== null && JSON.parse(x.data).runId === runId)!;
      expect(frame.id).toBeNull();
      expect(JSON.parse(frame.data!)).toMatchObject({ runId, seq: 1, eventType: 'lifecycle.run-queued' });
    } finally {
      await stream.close();
    }
  });

  it('says unavailable, and ends, when the chain cannot be read', async () => {
    const runId = await start(await seed());
    const dead = createSqlClient(url!, { max: 1 });
    await dead.end({ timeout: 1 });
    const stream = open(runId, 0, { db: createDb(dead) });
    const frames = await stream.until((f) => f.some((x) => x.event === 'end'), 5_000);
    expect(frames.at(-1)).toEqual({ id: null, event: 'end', data: JSON.stringify({ reason: 'unavailable' }) });
    expect(stream.timeline()).toHaveLength(0);
    await stream.until(() => false, 300);
    expect(stream.done).toBe(true);
  });

  it('counts a listener per stream and releases every one', () => {
    expect(listened).toBeGreaterThanOrEqual(6);
    expect(released).toBe(listened);
  });
});
