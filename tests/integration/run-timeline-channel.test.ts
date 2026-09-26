import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EVIDENCE_READ_GRANT_QUEUE,
  EVIDENCE_READ_GRANT_SCHEMA_VERSION,
  FRAME_LOCATOR,
  cancelRun,
  createFlagNotification,
  flagRun,
  initiateRun,
  issueEvidenceReadGrant,
  requestEvidenceReadGrant,
  reviewEvaluationInContext,
  type CancelRunDependencies,
  type RunDependencies,
} from '@intellifin/application';
import { sha256HexOfBytes, utf8Bytes } from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  InAppNotificationSender,
  migrateRunsQueue,
  parseTimelineNotification,
  PostgresAuditUnitOfWork,
  PostgresEvaluationReviewRepository,
  PostgresEvidenceReadGrantRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunCancellationRepository,
  PostgresRunFlagRepository,
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
    // Evidence read grants are enqueued on their own pg-boss queue. Provisioning it is
    // idempotent, and it goes through a single-connection client because queue creation
    // is a raw transaction block (the evidence-read-grant suite does the same).
    const queueSql = createSqlClient(url!, { max: 1 });
    try { await migrateRunsQueue(createDb(queueSql)); } finally { await queueSql.end({ timeout: 5 }); }
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const id of procedures) {
        const runs = await sql`SELECT run_id::text AS id FROM audit_run WHERE procedure_id=${id}`;
        for (const run of runs) {
          await sql`DELETE FROM pgboss.job WHERE name='runs' AND data->>'runId'=${run.id}`;
          await sql`DELETE FROM pgboss.job WHERE name=${EVIDENCE_READ_GRANT_QUEUE} AND data->>'grantId' IN (SELECT grant_id::text FROM evidence_read_grant WHERE run_id=${run.id})`;
          await sql`DELETE FROM audit_events WHERE aggregate_id=${run.id}`;
          await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${run.id}`;
        }
        // A notification names its flag, its Run, its version and its recipient with no
        // cascade, so it goes before every one of them.
        await sql`DELETE FROM notification WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
        await sql`DELETE FROM run_result WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
        await sql`DELETE FROM run_gate_check WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
        await sql`DELETE FROM run_evidence_integrity WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
        await sql`DELETE FROM run_evidence_package WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
        // After the package (a sealed package freezes its Evidence); its grants cascade.
        await sql`DELETE FROM run_evidence WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
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

  /** A failure inside an `onListening` hook, kept for the test that installed it. */
  const hookFailures: unknown[] = [];

  /**
   * The real client, with the listener hand-over counted so a teardown is observable.
   *
   * `onListening` runs once the LISTEN is armed and BEFORE the stream continues to its
   * replay, so a test can commit into exactly the window between the two — the window the
   * arming order exists for. A failure inside it is kept for the test to rethrow, never
   * thrown into the stream, whose listener would then never be released.
   */
  function countedSql(onListening?: () => Promise<void>): Sql {
    return new Proxy(sql, {
      get(target, property, receiver) {
        if (property !== 'listen') return Reflect.get(target, property, receiver);
        return (channel: string, handler: (payload: string) => void) => {
          listened += 1;
          const request = target.listen(channel, handler);
          return request.then(async (meta) => {
            const counted = { ...meta, unlisten: async () => { released += 1; await meta.unlisten(); } };
            if (onListening !== undefined) {
              try { await onListening(); } catch (error) { hookFailures.push(error); }
            }
            return counted;
          });
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

  function open(runId: string | null, after: number, options: { heartbeatMs?: number; lifetimeMs?: number; pageSize?: number; signal?: AbortSignal; db?: Database; onListening?: () => Promise<void> } = {}): FrameReader {
    return new FrameReader(openRunTimelineStream({ sql: countedSql(options.onListening), db: options.db ?? db }, {
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

  /* ------------------------------------------------------------------------------------
   * Story 10.7: every append to a Run's chain wakes the channel in its own transaction.
   *
   * The register found three families appended to a Run's chain with no NOTIFY:
   * `evidence-access.*` (web reads, worker grant decisions), `notification.*-delivery`
   * (worker) and the evaluation review's `security.denied`. Each is appended here through
   * its REAL writer. The streams that watch them are opened AFTER their replay and with a
   * heartbeat a minute away, so the only thing that can deliver a new event within the
   * deadline is the wake-up the appending transaction issued.
   * ---------------------------------------------------------------------------------- */

  const clock = new SystemClock();
  const WEB_TREE_MEDIA_TYPE = 'application/vnd.intellifin.web-tree+json';
  const SNAPSHOT_LOCATOR = '$.nodes[0].value';
  /** Far below the one-minute heartbeat: a delivery inside it can only be a wake-up. */
  const WAKE_DEADLINE_MS = 5_000;

  /** A raw LISTEN beside the streams, to count the wake-ups themselves. */
  interface Wakeups {
    /** How many wake-ups named exactly this Run and sequence. */
    count(runId: string, sequence: number): number;
    /** Commit a probe and wait for it: wake-ups arrive in commit order, so every earlier commit's has arrived too. */
    flush(): Promise<void>;
    stop(): Promise<void>;
  }

  async function listenForWakeups(): Promise<Wakeups> {
    const payloads: string[] = [];
    const listening = await sql.listen('run_timeline', (payload) => { payloads.push(payload); });
    return {
      count: (runId, sequence) => payloads.filter((payload) => {
        const notification = parseTimelineNotification(payload);
        return notification !== null && notification.runId === runId && notification.sequence === sequence;
      }).length,
      async flush() {
        const probe = ids.next();
        await sql.notify('run_timeline', JSON.stringify({ probe }));
        await expect.poll(() => payloads.some((payload) => payload.includes(probe)), { timeout: WAKE_DEADLINE_MS }).toBe(true);
      },
      stop: () => listening.unlisten(),
    };
  }

  /**
   * A per-Run stream that has finished its replay: it is opened one event behind the head
   * and the test waits for that one replayed frame. The LISTEN is armed before the replay,
   * so from here on nothing but a wake-up reads the chain until the heartbeat, a minute away.
   */
  async function followFromHead(runId: string, heartbeatMs = 60_000): Promise<FrameReader> {
    const head = await readTimelineHead(db, runId);
    if (head < 1) throw new Error('A followed Run needs one event to replay');
    const stream = open(runId, head - 1, { heartbeatMs });
    await stream.until((frames) => frames.some((frame) => frame.event === 'timeline' && frame.id === String(head)), WAKE_DEADLINE_MS);
    expect(stream.timeline().map((frame) => frame.id)).toEqual([String(head)]);
    return stream;
  }

  /** The Run's chain after `after`, as the channel envelopes name it. */
  async function chainAfter(runId: string, after: number): Promise<readonly { readonly seq: number; readonly eventType: string; readonly source: string }[]> {
    const rows = await sql`SELECT sequence, event_type, source FROM audit_events WHERE aggregate_id=${runId} AND sequence > ${after} ORDER BY sequence`;
    return rows.map((row) => ({ seq: Number(row.sequence), eventType: row.event_type as string, source: row.source as string }));
  }

  /** The `id` of each frame: the chain sequence a reconnect would resume from. */
  function sequencesOf(frames: readonly Frame[]): readonly string[] {
    return frames.map((frame) => frame.id ?? '');
  }

  /** A REGISTERED Structural Snapshot of the Run, which a grant can name. */
  async function registerSnapshot(runId: string): Promise<string> {
    const evidenceId = ids.next();
    const bytes = utf8Bytes(JSON.stringify({
      schemaVersion: 1,
      nodes: [{ group: 'record:0', role: 'datum', label: 'Employee ID', value: 'E-1', target: null }],
    }));
    await sql`INSERT INTO run_evidence(
      evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,
      required,captured_at,capture_method,capture_time_source,role) VALUES (
      ${evidenceId},${runId},'structural-snapshot','live-channel-target',${`structural-snapshot/${runId}/${evidenceId}`},
      ${WEB_TREE_MEDIA_TYPE},${sha256HexOfBytes(bytes)},${bytes.byteLength},'REGISTERED',false,
      ${clock.now().toISOString()},'agent','registration','evidence')`;
    return evidenceId;
  }

  const grants = (): PostgresEvidenceReadGrantRepository => new PostgresEvidenceReadGrantRepository(db, { clock, ids });

  /** The web requests a read; the WORKER decides it (`evidence-access.grant-issued` or `.denied`). */
  async function decideGrant(runId: string, evidenceId: string, locator: string, repository = grants()): Promise<{ readonly grantId: string; readonly status: string }> {
    const requested = await requestEvidenceReadGrant(
      { repository, ids, clock },
      { session: { userId: author, sessionId: `${author}-session` }, correlationId: ids.next(), request: { runId, evidenceId, locator } },
    );
    if (!requested.ok) throw new Error(requested.reason);
    const decided = await issueEvidenceReadGrant(
      {
        repository,
        clock,
        signer: { signGet: async ({ expiresAt }) => ({ signedUrl: `https://objects.invalid/${evidenceId}`, signedUrlExpiresAt: expiresAt }) },
      },
      { schemaVersion: EVIDENCE_READ_GRANT_SCHEMA_VERSION, grantId: requested.grantId },
    );
    return { grantId: requested.grantId, status: decided.status };
  }

  /** One complete read of a stored snapshot: the worker issues it, the web records it. Two Run-chain events. */
  async function readStoredSnapshot(runId: string, evidenceId: string): Promise<void> {
    const repository = grants();
    const { grantId, status } = await decideGrant(runId, evidenceId, SNAPSHOT_LOCATOR, repository);
    expect(status).toBe('issued');
    expect(await repository.recordAccess({ grantId, actorId: author, correlationId: ids.next(), at: clock.now().toISOString() })).toBe(true);
  }

  /** A Run the flag command accepts: initiated for real, then moved to RUNNING as a claiming worker would. */
  async function runningRun(): Promise<string> {
    const runId = await start(await seed());
    await sql`UPDATE audit_run SET state='RUNNING' WHERE run_id=${runId}`;
    return runId;
  }

  /** The database, except that every unit of work fails AFTER its work — its appends included — has run. */
  function failingAfterWork(target: Database): Database {
    return new Proxy(target, {
      get(inner, property, receiver) {
        if (property !== 'transaction') return Reflect.get(inner, property, receiver);
        return (work: (transaction: unknown) => Promise<unknown>) => inner.transaction(async (transaction) => {
          await work(transaction);
          throw new Error('the unit of work failed after its append');
        });
      },
    }) as Database;
  }

  it('wakes the Run for Evidence access from the worker and from the web, once each and in order', async () => {
    const runId = await start(await seed());
    const evidenceId = await registerSnapshot(runId);
    const wakeups = await listenForWakeups();
    const stream = await followFromHead(runId);
    try {
      // Worker: a grant issued. Web: the read recorded.
      await readStoredSnapshot(runId, evidenceId);
      // Worker: a grant refused — the frame sentinel names a screenshot, and this is a snapshot.
      expect((await decideGrant(runId, evidenceId, FRAME_LOCATOR)).status).toBe('denied');
      // Web: an issued capability refused because its deadline has passed.
      const repository = grants();
      const { grantId, status } = await decideGrant(runId, evidenceId, SNAPSHOT_LOCATOR, repository);
      expect(status).toBe('issued');
      const lapsed = new Date(Date.now() + 10 * 60_000).toISOString();
      expect(await repository.readForActor({ grantId, actorId: author, now: lapsed })).toBeNull();

      const appended = await chainAfter(runId, 1);
      expect(appended.map((event) => `${event.eventType} ${event.source}`)).toEqual([
        'evidence-access.grant-issued worker',
        'evidence-access.read web',
        'evidence-access.denied worker',
        'evidence-access.grant-issued worker',
        'evidence-access.denied web',
      ]);
      const expected = ['1', ...appended.map((event) => String(event.seq))];
      await stream.until((frames) => frames.filter((frame) => frame.event === 'timeline').length >= expected.length, WAKE_DEADLINE_MS);
      expect(sequencesOf(stream.timeline())).toEqual(expected);
      expect(stream.timeline().slice(1).map((frame) => JSON.parse(frame.data!).eventType)).toEqual(appended.map((event) => event.eventType));
      await wakeups.flush();
      for (const event of appended) expect(wakeups.count(runId, event.seq), event.eventType).toBe(1);
      // Wake-ups only: however many follow, nothing is sent twice and no payload travels.
      await stream.until(() => false, 300);
      expect(sequencesOf(stream.timeline())).toEqual(expected);
      expect(stream.timeline().every((frame) => !('payload' in JSON.parse(frame.data!)))).toBe(true);
    } finally {
      await stream.close();
      await wakeups.stop();
    }
  });

  it('wakes every open stream on the Run for notification deliveries, and the list stream forwards each event once', async () => {
    const runId = await runningRun();
    const wakeups = await listenForWakeups();
    let listArmed!: () => void;
    const armed = new Promise<void>((resolve) => { listArmed = resolve; });
    const list = open(null, 0, { onListening: async () => { listArmed(); } });
    const first = await followFromHead(runId);
    const second = await followFromHead(runId);
    try {
      await armed;
      // A flag: its writer notifies through its own port as well, and the two identical
      // wake-ups of one transaction arrive as one.
      const flagged = await flagRun(
        { roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), repository: new PostgresRunFlagRepository(db), ids, clock },
        { session, request: { runId, note: null } },
      );
      if (!flagged.ok) throw new Error(flagged.reason);
      // The worker delivers the author's notification: in-app and email, one transaction.
      const [row] = await sql`SELECT procedure_id::text AS procedure_id, version_id::text AS version_id, procedure_name, version_number
        FROM notification WHERE run_id=${runId} AND recipient_id=${author} AND kind='flag'`;
      await new InAppNotificationSender(db, { clock, ids }).send(createFlagNotification({
        recipientId: author, runId, flagId: flagged.flagId,
        procedureId: row!.procedure_id as string, versionId: row!.version_id as string,
        procedureName: row!.procedure_name as string, versionNumber: Number(row!.version_number),
      }));

      const appended = await chainAfter(runId, 1);
      expect(appended.map((event) => event.eventType)).toEqual([
        'lifecycle.run-flagged', 'notification.in-app-delivery', 'notification.email-delivery',
      ]);
      const expected = ['1', ...appended.map((event) => String(event.seq))];
      for (const stream of [first, second]) {
        await stream.until((frames) => frames.filter((frame) => frame.event === 'timeline').length >= expected.length, WAKE_DEADLINE_MS);
      }
      const forwarded = (): readonly number[] => list.timeline()
        .map((frame) => JSON.parse(frame.data!) as { runId: string; seq: number })
        .filter((envelope) => envelope.runId === runId)
        .map((envelope) => envelope.seq);
      await list.until(() => appended.every((event) => forwarded().includes(event.seq)), WAKE_DEADLINE_MS);
      await wakeups.flush();
      await Promise.all([first, second, list].map((stream) => stream.until(() => false, 300)));

      for (const stream of [first, second]) expect(sequencesOf(stream.timeline())).toEqual(expected);
      // The list stream has no cursor and forwards one frame per wake-up, so this is also
      // the proof that one append is one wake-up, whichever writers asked for it. It makes no
      // ordering promise (each forward is its own read), so it is compared as a set of once.
      expect([...forwarded()].sort((a, b) => a - b)).toEqual(appended.map((event) => event.seq));
      for (const event of appended) expect(wakeups.count(runId, event.seq), event.eventType).toBe(1);
    } finally {
      await Promise.all([first.close(), second.close(), list.close()]);
      await wakeups.stop();
    }
  });

  it('wakes the Run for the evaluation review\'s refusal of a person without the role', async () => {
    const runId = await start(await seed());
    const wakeups = await listenForWakeups();
    const stream = await followFromHead(runId);
    const roleless = `${ids.next()}-no-role`;
    try {
      const refused = await new PostgresEvaluationReviewRepository(db).transaction(runId, (context) =>
        reviewEvaluationInContext({ ids, clock }, context, {
          session: { userId: roleless, sessionId: `${roleless}-session` },
          request: { runId, observationId: ids.next(), conditionId: 'C1', expectedReviewRevision: 0 },
        }, 'confirm', { correlationId: ids.next(), source: 'worker' }));
      expect(refused).toMatchObject({ ok: false, code: 'unauthorized' });

      const appended = await chainAfter(runId, 1);
      expect(appended.map((event) => `${event.eventType} ${event.source}`)).toEqual(['security.denied worker']);
      await stream.until((frames) => frames.filter((frame) => frame.event === 'timeline').length >= 2, WAKE_DEADLINE_MS);
      expect(sequencesOf(stream.timeline())).toEqual(['1', String(appended[0]!.seq)]);
      await wakeups.flush();
      expect(wakeups.count(runId, appended[0]!.seq)).toBe(1);
    } finally {
      await stream.close();
      await wakeups.stop();
    }
  });

  it('wakes nothing for an append its unit of work rolls back, and the committed retry arrives once', async () => {
    const runId = await runningRun();
    const evidenceId = await registerSnapshot(runId);
    const flagged = await flagRun(
      { roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), repository: new PostgresRunFlagRepository(db), ids, clock },
      { session, request: { runId, note: null } },
    );
    if (!flagged.ok) throw new Error(flagged.reason);
    const [row] = await sql`SELECT procedure_id::text AS procedure_id, version_id::text AS version_id, procedure_name, version_number
      FROM notification WHERE run_id=${runId} AND recipient_id=${author} AND kind='flag'`;
    const notification = createFlagNotification({
      recipientId: author, runId, flagId: flagged.flagId,
      procedureId: row!.procedure_id as string, versionId: row!.version_id as string,
      procedureName: row!.procedure_name as string, versionNumber: Number(row!.version_number),
    });
    const repository = grants();
    const { grantId, status } = await decideGrant(runId, evidenceId, SNAPSHOT_LOCATOR, repository);
    expect(status).toBe('issued');

    // Heartbeats every 50 ms: each one reads the chain again, which is how a stream would
    // find a row that had been committed with no wake-up — and there must be none.
    const stream = await followFromHead(runId, 50);
    const wakeups = await listenForWakeups();
    const head = await readTimelineHead(db, runId);
    try {
      // The worker's delivery appends both outcomes, then its unit of work fails.
      await expect(new InAppNotificationSender(failingAfterWork(db), { clock, ids }).send(notification))
        .rejects.toThrow('the unit of work failed after its append');
      // The web's read is appended, then its unit of work fails.
      await expect(new PostgresEvidenceReadGrantRepository(failingAfterWork(db), { clock, ids })
        .recordAccess({ grantId, actorId: author, correlationId: ids.next(), at: clock.now().toISOString() }))
        .rejects.toThrow('the unit of work failed after its append');

      expect(await readTimelineHead(db, runId)).toBe(head);
      expect(await chainAfter(runId, head)).toEqual([]);
      await wakeups.flush();
      for (const sequence of [head + 1, head + 2]) expect(wakeups.count(runId, sequence)).toBe(0);
      const heartbeats = stream.frames.filter((frame) => frame.event === 'heartbeat').length;
      await stream.until((frames) => frames.filter((frame) => frame.event === 'heartbeat').length >= heartbeats + 3, WAKE_DEADLINE_MS);
      expect(sequencesOf(stream.timeline())).toEqual([String(head)]);

      // Committed this time: the retry takes the sequences the rolled-back attempt did not
      // keep, and each arrives once.
      await new InAppNotificationSender(db, { clock, ids }).send(notification);
      expect(await repository.recordAccess({ grantId, actorId: author, correlationId: ids.next(), at: clock.now().toISOString() })).toBe(true);
      const appended = await chainAfter(runId, head);
      expect(appended.map((event) => `${event.seq} ${event.eventType}`)).toEqual([
        `${head + 1} notification.in-app-delivery`, `${head + 2} notification.email-delivery`, `${head + 3} evidence-access.read`,
      ]);
      await stream.until((frames) => frames.filter((frame) => frame.event === 'timeline').length >= 4, WAKE_DEADLINE_MS);
      await wakeups.flush();
      await stream.until(() => false, 200);
      expect(sequencesOf(stream.timeline())).toEqual([head, head + 1, head + 2, head + 3].map(String));
      for (const event of appended) expect(wakeups.count(runId, event.seq), event.eventType).toBe(1);
    } finally {
      await stream.close();
      await wakeups.stop();
    }
  });

  it('resumes from the last-seen sequence during a burst: every event after it arrives once, in order', async () => {
    const runId = await start(await seed());
    const evidenceId = await registerSnapshot(runId);

    // Watching: two events committed live arrive on a wake-up, and the stream is dropped.
    const before = await followFromHead(runId);
    let lastSeen: number;
    try {
      await readStoredSnapshot(runId, evidenceId);
      await before.until((frames) => frames.filter((frame) => frame.event === 'timeline').length >= 3, WAKE_DEADLINE_MS);
      expect(sequencesOf(before.timeline())).toEqual(['1', '2', '3']);
      lastSeen = Number(before.timeline().at(-1)!.id);
    } finally {
      await before.close();
    }

    // Dropped: the burst goes on with nobody listening.
    await readStoredSnapshot(runId, evidenceId);
    // Reconnecting from the last-seen sequence, paging one event at a time. More of the
    // burst commits in the window between the LISTEN being armed and the replay starting,
    // so those events are BOTH replayed and announced; and more commits after the replay.
    const failuresBefore = hookFailures.length;
    let inWindow: Promise<void> | null = null;
    const resumed = open(runId, lastSeen, {
      pageSize: 1,
      onListening: () => (inWindow = readStoredSnapshot(runId, evidenceId)),
    });
    try {
      await expect.poll(() => inWindow !== null, { timeout: WAKE_DEADLINE_MS }).toBe(true);
      await inWindow;
      expect(hookFailures.slice(failuresBefore)).toEqual([]);
      await resumed.until((frames) => frames.some((frame) => frame.event === 'timeline'), WAKE_DEADLINE_MS);
      // And the rest of the burst commits once the stream is live again.
      await readStoredSnapshot(runId, evidenceId);

      const burst = await chainAfter(runId, lastSeen);
      expect(burst.map((event) => event.eventType)).toEqual([
        'evidence-access.grant-issued', 'evidence-access.read',
        'evidence-access.grant-issued', 'evidence-access.read',
        'evidence-access.grant-issued', 'evidence-access.read',
      ]);
      const expected = burst.map((event) => String(event.seq));
      await resumed.until((frames) => frames.filter((frame) => frame.event === 'timeline').length >= expected.length, WAKE_DEADLINE_MS);
      await resumed.until(() => false, 300);
      expect(sequencesOf(resumed.timeline())).toEqual(expected);
    } finally {
      await resumed.close();
    }
  });

  it('wakes the Run for an append by any writer, and nothing for a chain that is not a Run\'s', async () => {
    const procedureId = await seed();
    const runId = await start(procedureId);
    const stranger = ids.next();
    const wakeups = await listenForWakeups();
    const stream = await followFromHead(runId);
    // A writer that issues no wake-up of its own: the append path is what issues it.
    const append = (aggregateId: string) => new PostgresAuditUnitOfWork(db, { clock, ids }).execute(({ auditEvents }) => auditEvents.append({
      actor: { type: 'system', id: 'worker' }, eventType: 'failure.retry', source: 'worker', outcome: 'failure',
      sessionId: 'live-channel', correlationId: ids.next(), aggregateId, payload: { attempt: 1 },
    }));
    try {
      const onRun = await append(runId);
      // A Procedure's chain, and a Run-shaped id that names no Run: neither is a Timeline,
      // and a wake-up for either would have the list stream forward it as a Run's event.
      const onProcedure = await append(procedureId);
      const onNothing = await append(stranger);
      await stream.until((frames) => frames.filter((frame) => frame.event === 'timeline').length >= 2, WAKE_DEADLINE_MS);
      expect(sequencesOf(stream.timeline())).toEqual(['1', String(onRun.sequence)]);
      await wakeups.flush();
      expect(wakeups.count(runId, onRun.sequence)).toBe(1);
      expect(wakeups.count(procedureId, onProcedure.sequence)).toBe(0);
      expect(wakeups.count(stranger, onNothing.sequence)).toBe(0);
    } finally {
      await stream.close();
      await wakeups.stop();
      await sql`DELETE FROM audit_events WHERE aggregate_id IN (${procedureId}, ${stranger})`;
      await sql`DELETE FROM audit_event_heads WHERE aggregate_id IN (${procedureId}, ${stranger})`;
    }
  });

  it('counts a listener per stream and releases every one', () => {
    expect(listened).toBeGreaterThanOrEqual(6);
    expect(released).toBe(listened);
  });
});
