import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initiateRun, type RunDependencies } from '@intellifin/application';
import {
  HEARTBEAT_MS,
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunsUnitOfWork,
  SystemClock,
  openRunTimelineStream,
  readTimelineHead,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * A new connection hears its stream at once, against a real PostgreSQL 18 (Story 10.8
 * review, P1).
 *
 * A page counts silence from the last frame the stream sent, and a connection answering is
 * not a frame. So every stream, per-Run and list, sends one heartbeat as soon as its LISTEN
 * is armed and its replay has been read — well before the first periodic heartbeat, which
 * is `HEARTBEAT_MS` away and is left at its production default here on purpose. A stream
 * whose LISTEN fails says it is unavailable and sends no heartbeat.
 *
 * A file of its own, beside `run-timeline-channel.test.ts` rather than inside it, so the
 * cases that test the connect heartbeat are not mixed into another story's edits of that
 * file.
 */

/** The frames of one stream as they arrive: the SSE event name (`retry` for the retry frame). */
class Frames {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  readonly names: string[] = [];
  readonly data: (string | null)[] = [];
  done = false;
  constructor(stream: ReadableStream<Uint8Array>) { this.reader = stream.getReader(); }

  /** Read until `predicate` holds, the stream ends, or `timeoutMs` passes. */
  async until(predicate: (names: readonly string[]) => boolean, timeoutMs: number): Promise<readonly string[]> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate(this.names) && !this.done) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const chunk = await Promise.race([
        this.reader.read(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), remaining)),
      ]);
      if (chunk === null) break;
      if (chunk.done) { this.done = true; break; }
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
      let split: number;
      while ((split = this.buffer.indexOf('\n\n')) >= 0) {
        const block = this.buffer.slice(0, split);
        this.buffer = this.buffer.slice(split + 2);
        const lines = block.split('\n');
        const name = lines.some((line) => line.startsWith('retry: '))
          ? 'retry'
          : (lines.find((line) => line.startsWith('event: '))?.slice(7) ?? '?');
        this.names.push(name);
        this.data.push(lines.find((line) => line.startsWith('data: '))?.slice(6) ?? null);
      }
    }
    return this.names;
  }

  async close(): Promise<void> { await this.reader.cancel().catch(() => undefined); }
}

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('a new connection hears its stream at once', () => {
  let sql: Sql, db: Database;
  const ids = new CryptoUuidV7Generator();
  const author = `${ids.next()}-connect-author`;
  const procedures: string[] = [];
  const session = { userId: author, sessionId: `${author}-session` };
  const period = { from: '2026-08-01', to: '2026-08-31' };
  /** Well under the first periodic heartbeat, so a heartbeat read inside it is the connect heartbeat. */
  const PROMPTLY_MS = 3_000;

  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1)))
      throw new Error('Live channel tests require an isolated local or CI test database');
    expect(PROMPTLY_MS).toBeLessThan(HEARTBEAT_MS);
    sql = createSqlClient(url!, { max: 4 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'Connect heartbeat test',${`${author}@test.invalid`})`;
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

  const runDependencies = (): RunDependencies => ({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock: new SystemClock() });

  async function queuedRun(): Promise<string> {
    const row = activeRunVersion(ids.next(), ids.next(), author);
    procedures.push(row.procedureId);
    await new PostgresProceduresUnitOfWork(db).execute(async c => {
      await c.procedures.insertProcedure(row);
      await c.procedures.insertVersion(row);
    });
    const outcome = await initiateRun(runDependencies(), { session, request: { procedureId: row.procedureId, period, requestToken: ids.next() } });
    if (!outcome.ok) throw new Error(outcome.reason);
    return outcome.runId;
  }

  /** The production cadence: no heartbeat option, so the periodic heartbeat is HEARTBEAT_MS away. */
  function open(runId: string | null, after: number, client: Sql = sql): Frames {
    return new Frames(openRunTimelineStream({ sql: client, db }, { runId, after }));
  }

  it('sends a heartbeat right after the replay, long before the first periodic one', async () => {
    const runId = await queuedRun();
    expect(await readTimelineHead(db, runId)).toBe(1);
    const started = Date.now();
    const stream = open(runId, 0);
    try {
      const names = await stream.until((n) => n.includes('heartbeat'), PROMPTLY_MS);
      expect(Date.now() - started).toBeLessThan(HEARTBEAT_MS);
      // The replay first, then the heartbeat: the frame after the last replayed event.
      expect(names).toEqual(['retry', 'timeline', 'heartbeat']);
      expect(JSON.parse(stream.data[2]!)).toMatchObject({ at: expect.stringMatching(/Z$/) });
    } finally {
      await stream.close();
    }
  });

  it('sends it at once from the head, where there is nothing to replay', async () => {
    const runId = await queuedRun();
    const stream = open(runId, await readTimelineHead(db, runId));
    try {
      expect(await stream.until((n) => n.includes('heartbeat'), PROMPTLY_MS)).toEqual(['retry', 'heartbeat']);
    } finally {
      await stream.close();
    }
  });

  it('sends it at once on the list stream, which has no replay', async () => {
    const stream = open(null, 0);
    try {
      const names = await stream.until((n) => n.includes('heartbeat'), PROMPTLY_MS);
      // A Run another file starts may be forwarded after it, never before it.
      expect(names.slice(0, 2)).toEqual(['retry', 'heartbeat']);
    } finally {
      await stream.close();
    }
  });

  it('sends no heartbeat when its LISTEN fails: it says unavailable and ends', async () => {
    const runId = await queuedRun();
    // postgres.js LISTENs on a connection of its own, so an ended client would simply open
    // another one. A client whose server refuses the connection is a LISTEN that fails.
    const refused = new URL(url!);
    refused.port = '1';
    const dead = createSqlClient(refused.toString(), { max: 1, connect_timeout: 2 });
    try {
      const stream = open(runId, 0, dead);
      const names = await stream.until((n) => n.includes('end'), PROMPTLY_MS);
      expect(names).toEqual(['retry', 'end']);
      expect(stream.data[1]).toBe(JSON.stringify({ reason: 'unavailable' }));
      await stream.until(() => false, 300);
      expect(stream.done).toBe(true);
      expect(stream.names).not.toContain('heartbeat');
    } finally {
      await dead.end({ timeout: 1 }).catch(() => undefined);
    }
  });
});
