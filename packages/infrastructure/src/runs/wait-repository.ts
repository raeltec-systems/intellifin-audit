import { sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { AWAITING_AUDITOR_TIMEOUT_MS } from '@intellifin/application';
import type {
  EscalationOption,
  RunWait,
  WaitContext,
  WaitJob,
  WaitOperation,
  WaitRepository,
  CloseWaitInput,
  TimeoutWaitInput,
  RecoverableWait,
  VersionedRun,
} from '@intellifin/application';
import { DrizzleRoleRepository } from '../identity/role-repository.js';
import type { Database, Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import { queueDatabase } from '../procedures/derivation-queue.js';
import { withRunExecutionContext } from './adapter-execution-repository.js';

/** Queue name for delayed wake jobs. The queue is created by the release migrator. */
export const WAIT_QUEUE = 'waits';
export const RUN_WAITS_QUEUE = WAIT_QUEUE;

const WAKE_RETRY_LIMIT = 3;
const WAKE_RETRY_DELAY_SECONDS = 5;
const WAKE_EXPIRE_SECONDS = 180;
// pg-boss only applies a singleton key when a singleton slot is supplied. The
// application-owned open-wait unique index remains the authoritative guard; this slot is
// defence in depth for a duplicate send during the four-hour wait window.
const WAKE_SINGLETON_SECONDS = AWAITING_AUDITOR_TIMEOUT_MS / 1000;

type RawRow = Record<string, unknown>;

function rows(result: unknown): readonly RawRow[] {
  if (Array.isArray(result)) return result as RawRow[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const value = (result as { rows?: unknown }).rows;
    return Array.isArray(value) ? (value as RawRow[]) : [];
  }
  return [];
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function revisionValue(value: unknown): number | null {
  const revision = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function parseOptions(value: unknown): readonly EscalationOption[] {
  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item): EscalationOption[] => {
    if (typeof item === 'string') return [{ id: item, label: item }];
    if (!item || typeof item !== 'object' || Array.isArray(item) || !('id' in item) || !('label' in item)) return [];
    const id = item.id;
    const label = item.label;
    return typeof id === 'string' && typeof label === 'string' ? [{ id, label }] : [];
  });
}

function parseWait(row: RawRow): RunWait | null {
  const waitId = typeof row.wait_id === 'string' ? row.wait_id.toLowerCase() : null;
  const runId = typeof row.run_id === 'string' ? row.run_id.toLowerCase() : null;
  const kind = row.kind;
  const deadline = dateValue(row.deadline);
  if (!waitId || !runId || !isUuidText(waitId) || !isUuidText(runId) ||
      (kind !== 'choose-candidate' && kind !== 'unnamed-value' && kind !== 'retry-or-skip') ||
      deadline === null) return null;
  const closedAt = dateValue(row.closed_at);
  const closureKind = row.closure_kind === 'answer' || row.closure_kind === 'timeout' ? row.closure_kind : null;
  const answerOptionId = typeof row.answer_option_id === 'string' ? row.answer_option_id : null;
  const actor = typeof row.actor === 'string' ? row.actor : null;
  return {
    waitId,
    runId,
    kind,
    options: parseOptions(row.options),
    deadline,
    closedAt,
    closureKind,
    answerOptionId,
    actor,
  };
}

async function readWait(tx: Transaction, runId: string, waitId?: string): Promise<RunWait | null> {
  const result = await tx.execute(
    waitId === undefined
      ? sql`SELECT wait_id::text AS wait_id, run_id::text AS run_id, kind, options, deadline, closed_at, closure_kind, answer_option_id, actor FROM run_wait WHERE run_id = ${runId} AND closed_at IS NULL ORDER BY deadline, wait_id LIMIT 1`
      : sql`SELECT wait_id::text AS wait_id, run_id::text AS run_id, kind, options, deadline, closed_at, closure_kind, answer_option_id, actor FROM run_wait WHERE run_id = ${runId} AND wait_id = ${waitId} FOR UPDATE`,
  );
  const row = rows(result)[0];
  return row === undefined ? null : parseWait(row);
}

async function readRunRevision(tx: Transaction, runId: string): Promise<number | null> {
  // `revision` is added by the wait migration. Keeping this lookup raw lets the wait
  // repository remain independent from Drizzle's generated schema while the expand step
  // rolls out alongside an older worker.
  const result = await tx.execute(sql`SELECT revision FROM audit_run WHERE run_id = ${runId}`);
  const value = resultRows(result)[0]?.revision;
  return revisionValue(value);
}

function resultRows(result: unknown): readonly RawRow[] {
  return rows(result);
}

function waitJob(wait: RunWait): WaitJob {
  return { schemaVersion: 1, runId: wait.runId, waitId: wait.waitId };
}

async function sendWake(
  queue: PgBoss,
  db: ReturnType<typeof queueDatabase>,
  wait: RunWait,
  startAfter: string,
): Promise<void> {
  const id = await queue.send(WAIT_QUEUE, waitJob(wait), {
    db,
    startAfter: new Date(startAfter),
    singletonKey: `wait:${wait.waitId}`,
    singletonSeconds: WAKE_SINGLETON_SECONDS,
    retryLimit: WAKE_RETRY_LIMIT,
    retryDelay: WAKE_RETRY_DELAY_SECONDS,
    expireInSeconds: WAKE_EXPIRE_SECONDS,
  });
  if (id === null) throw new Error('Escalation wake job was not enqueued');
}

/** Shared persistence for all wait producers and the answer/timeout commands. */
export class PostgresWaitRepository implements WaitRepository {
  constructor(private readonly db: Database) {}

  async transaction<T>(runId: string, work: (context: WaitContext) => Promise<T>): Promise<T> {
    if (!isUuidText(runId)) throw new Error('Invalid Run identity');
    return this.db.transaction((tx) =>
      withRunExecutionContext(tx, runId, async (base) => {
        const revision = await readRunRevision(tx, runId);
        const loadedRun = base.run === null || revision === null ? null : ({ ...base.run, revision } as VersionedRun);
        let currentRun = loadedRun;
        let currentWait = await readWait(tx, runId);
        const db = queueDatabase(tx);
        const queue = new PgBoss({ db, migrate: false, createSchema: false, schedule: false, supervise: false });
        const context: WaitContext = {
          ...base,
          get run() { return currentRun; },
          get wait() { return currentWait; },
          async readWait(waitId: string) {
            if (!isUuidText(waitId)) return null;
            const addressed = await readWait(tx, runId, waitId.toLowerCase());
            if (addressed !== null) currentWait = addressed;
            return addressed;
          },
          authorizationRoles: new DrizzleRoleRepository(tx),
          async saveRunState(state) {
            const current = currentRun;
            if (!current) return;
            const result = await tx.execute(sql`UPDATE audit_run SET state = ${state}, revision = revision + 1 WHERE run_id = ${runId} AND state IS DISTINCT FROM ${state} RETURNING revision`);
            const nextRevision = revisionValue(resultRows(result)[0]?.revision) ?? current.revision;
            currentRun = { ...current, state, revision: nextRevision };
          },
          async requestCancellation(request) {
            await tx.execute(sql`UPDATE audit_run SET cancel_requested_at = ${request.requestedAt}::timestamptz, cancel_requested_by = ${request.requestedBy}, cancel_requested_session = ${request.sessionId}, cancel_reason = ${request.reason} WHERE run_id = ${runId} AND cancel_requested_at IS NULL`);
            const current = currentRun;
            if (current) currentRun = { ...current, cancellation: request };
          },
          async createWait(wait) {
            const current = currentRun;
            if (!current) return { outcome: 'missing', wait: null, run: null };
            if (current.state !== 'RUNNING') return { outcome: 'not-running', wait: currentWait, run: current };
            if (currentWait !== null && currentWait.closedAt === null) return { outcome: 'already-open', wait: currentWait, run: current };
            if (wait.runId !== runId) return { outcome: 'missing', wait: null, run: current };
            const inserted = await tx.execute(sql`
              INSERT INTO run_wait (wait_id, run_id, kind, options, deadline, closed_at, closure_kind, answer_option_id, actor)
              VALUES (${wait.waitId}, ${wait.runId}, ${wait.kind}, ${JSON.stringify(wait.options)}::jsonb, ${wait.deadline}::timestamptz, NULL, NULL, NULL, NULL)
              ON CONFLICT (wait_id) DO NOTHING
              RETURNING wait_id::text AS wait_id
            `);
            if (resultRows(inserted).length === 0) {
              const existing = await readWait(tx, runId, wait.waitId);
              return existing === null
                ? { outcome: 'missing', wait: null, run: current }
                : { outcome: 'already-open', wait: existing, run: current };
            }
            const changed = await tx.execute(sql`UPDATE audit_run SET state = 'AWAITING_AUDITOR', revision = revision + 1 WHERE run_id = ${runId} AND state = 'RUNNING' RETURNING revision`);
            const nextRevision = revisionValue(resultRows(changed)[0]?.revision);
            if (nextRevision === null) throw new Error('Run was not running while opening an Escalation');
            await sendWake(queue, db, wait, wait.deadline);
            currentRun = { ...current, state: 'AWAITING_AUDITOR', revision: nextRevision };
            currentWait = wait;
            return { outcome: 'created', wait, run: currentRun };
          },
          async closeWait(input: CloseWaitInput): Promise<WaitOperation> {
            const current = currentRun;
            if (!current) return { outcome: 'missing', wait: null, run: null };
            // Read the addressed row even after the Run left Awaiting Auditor. This is
            // what makes a replay answer observe the durable closure and return
            // `superseded`, rather than turning an already-answered wait into an opaque
            // `not-awaiting` refusal.
            const lockedWait = await readWait(tx, runId, input.waitId);
            if (!lockedWait) return { outcome: 'missing', wait: null, run: current };
            currentWait = lockedWait;
            if (lockedWait.closedAt !== null) return { outcome: 'superseded', wait: lockedWait, run: current };
            if (current.state !== 'AWAITING_AUDITOR') return { outcome: 'not-awaiting', wait: lockedWait, run: current };
            if (current.revision !== input.expectedRunRevision) return { outcome: 'stale-revision', wait: lockedWait, run: current };
            const now = Date.parse(input.now);
            if (!Number.isFinite(now)) throw new Error('Invalid wait closure time');
            if (now >= Date.parse(lockedWait.deadline)) return { outcome: 'expired', wait: lockedWait, run: current };
            if (!lockedWait.options.some((option) => option.id === input.answerOptionId)) return { outcome: 'expired', wait: lockedWait, run: current };
            const changedRun = await tx.execute(sql`UPDATE audit_run SET state = ${input.stateAfterClose}, revision = revision + 1 WHERE run_id = ${runId} AND state = 'AWAITING_AUDITOR' AND revision = ${input.expectedRunRevision} RETURNING revision`);
            const nextRevision = revisionValue(resultRows(changedRun)[0]?.revision);
            if (nextRevision === null) return { outcome: 'stale-revision', wait: lockedWait, run: current };
            const closed = await tx.execute(sql`UPDATE run_wait SET closed_at = ${input.now}::timestamptz, closure_kind = 'answer', answer_option_id = ${input.answerOptionId}, actor = ${input.actor} WHERE wait_id = ${input.waitId} AND run_id = ${runId} AND closed_at IS NULL RETURNING wait_id::text AS wait_id, run_id::text AS run_id, kind, options, deadline, closed_at, closure_kind, answer_option_id, actor`);
            const closedWait = parseWait(resultRows(closed)[0] ?? {});
            if (closedWait === null) throw new Error('Escalation wait closed concurrently');
            // Keep the original deadline job. It is the one durable wake for this wait;
            // when it eventually runs, `timeoutWait` sees the closed row and returns
            // `superseded`. The answering path's stage recovery owns immediate resume,
            // so creating a second wake here would violate the one-job contract and could
            // make a closed wait look like a timeout continuation.
            currentRun = { ...current, state: input.stateAfterClose, revision: nextRevision };
            currentWait = closedWait;
            return { outcome: 'closed', wait: closedWait, run: currentRun };
          },
          async timeoutWait(input: TimeoutWaitInput): Promise<WaitOperation> {
            const current = currentRun;
            if (!current) return { outcome: 'missing', wait: null, run: null };
            const lockedWait = await readWait(tx, runId, input.waitId);
            if (!lockedWait) return { outcome: 'missing', wait: null, run: current };
            currentWait = lockedWait;
            if (lockedWait.closedAt !== null) return { outcome: 'superseded', wait: lockedWait, run: current };
            if (current.state !== 'AWAITING_AUDITOR') return { outcome: 'not-awaiting', wait: lockedWait, run: current };
            const now = Date.parse(input.now);
            if (!Number.isFinite(now)) throw new Error('Invalid wait timeout time');
            if (now < Date.parse(lockedWait.deadline)) return { outcome: 'early', wait: lockedWait, run: current };
            const changedRun = await tx.execute(sql`UPDATE audit_run SET state = 'INCONCLUSIVE', revision = revision + 1 WHERE run_id = ${runId} AND state = 'AWAITING_AUDITOR' RETURNING revision`);
            const nextRevision = revisionValue(resultRows(changedRun)[0]?.revision);
            if (nextRevision === null) return { outcome: 'not-awaiting', wait: lockedWait, run: current };
            const closed = await tx.execute(sql`UPDATE run_wait SET closed_at = ${input.now}::timestamptz, closure_kind = 'timeout', answer_option_id = NULL, actor = 'wait-wake' WHERE wait_id = ${input.waitId} AND run_id = ${runId} AND closed_at IS NULL RETURNING wait_id::text AS wait_id, run_id::text AS run_id, kind, options, deadline, closed_at, closure_kind, answer_option_id, actor`);
            const closedWait = parseWait(resultRows(closed)[0] ?? {});
            if (closedWait === null) throw new Error('Escalation wait timed out concurrently');
            currentRun = { ...current, state: 'INCONCLUSIVE', revision: nextRevision };
            currentWait = closedWait;
            return { outcome: 'timed-out', wait: closedWait, run: currentRun };
          },
        };
        return work(context);
      }),
    );
  }

  async recoverableWaits(limit: number): Promise<readonly RecoverableWait[]> {
    const bounded = Math.max(1, Math.min(100, limit));
    const result = await this.db.execute(sql`
      SELECT w.wait_id::text AS wait_id, w.run_id::text AS run_id
      FROM run_wait w
      INNER JOIN audit_run r ON r.run_id = w.run_id
      WHERE w.closed_at IS NULL AND w.deadline <= now() AND r.state = 'AWAITING_AUDITOR'
      ORDER BY w.deadline, w.wait_id
      LIMIT ${bounded}
    `);
    return resultRows(result).flatMap((row) => {
      const waitId = typeof row.wait_id === 'string' ? row.wait_id : null;
      const runId = typeof row.run_id === 'string' ? row.run_id : null;
      return waitId && runId && isUuidText(waitId) && isUuidText(runId) ? [{ waitId, runId }] : [];
    });
  }
}

/** Release/CI only; worker and web processes must not migrate queue schemas. */
export async function migrateWaitQueue(db: Database): Promise<void> {
  const queue = new PgBoss({ db: queueDatabase(db), migrate: true, createSchema: true, schedule: false, supervise: false });
  try {
    await queue.start();
    await queue.createQueue(WAIT_QUEUE, { retryLimit: WAKE_RETRY_LIMIT, retryDelay: WAKE_RETRY_DELAY_SECONDS, expireInSeconds: WAKE_EXPIRE_SECONDS });
  } finally {
    await queue.stop();
  }
}
