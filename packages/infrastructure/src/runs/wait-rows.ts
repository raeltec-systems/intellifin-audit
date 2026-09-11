import { sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { waitTimeoutMs, type RunWait, type WaitJob } from '@intellifin/application';
import type { Transaction } from '../db/client.js';
import { queueDatabase } from '../procedures/derivation-queue.js';

/**
 * Writing one durable wait row and its wake job — the ONE implementation (Story 5.4).
 *
 * Two producers open a wait: `PostgresWaitRepository.createWait`, which raises an
 * Escalation from the wait command's own transaction, and the execution repositories'
 * `openPauseWait`, which opens a pause from inside the stage's guarded commit. Both go
 * through here, so a wait row and the wake that eventually ends it cannot come apart, and
 * neither can the two spellings of what a wait row IS.
 *
 * It deliberately checks NOTHING about the Run: each caller has already established the
 * state it is transitioning from, under the Run's own row lock, in the transaction it
 * passes in. A second state check here would refuse the pause producer, which writes
 * `PAUSED` in the same commit.
 */

/** Queue name for delayed wake jobs. The queue is created by the release migrator. */
export const WAIT_QUEUE = 'waits';

export const WAKE_RETRY_LIMIT = 3;
export const WAKE_RETRY_DELAY_SECONDS = 5;
export const WAKE_EXPIRE_SECONDS = 180;

function waitJob(wait: RunWait): WaitJob {
  return { schemaVersion: 1, runId: wait.runId, waitId: wait.waitId };
}

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const value = (result as { rows?: unknown }).rows;
    return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  }
  return [];
}

/** Every column of a wait, in one place, so two readers cannot select different sets. */
export const WAIT_COLUMNS = sql`wait_id::text AS wait_id, run_id::text AS run_id, kind, options, opened_at, opened_by, deadline, closed_at, closure_kind, answer_option_id, actor`;

/** Insert one wait row. `false` means a row with that id was already there. */
export async function insertWaitRow(tx: Transaction, wait: RunWait): Promise<boolean> {
  const inserted = await tx.execute(sql`
    INSERT INTO run_wait (wait_id, run_id, kind, options, opened_at, opened_by, deadline, closed_at, closure_kind, answer_option_id, actor)
    VALUES (${wait.waitId}, ${wait.runId}, ${wait.kind}, ${JSON.stringify(wait.options)}::jsonb, ${wait.openedAt}::timestamptz, ${wait.openedBy}, ${wait.deadline}::timestamptz, NULL, NULL, NULL, NULL)
    ON CONFLICT (wait_id) DO NOTHING
    RETURNING wait_id::text AS wait_id
  `);
  return rows(inserted).length === 1;
}

/**
 * Enqueue the one durable wake this wait will ever have, at its own deadline.
 *
 * The singleton window is the wait's OWN timeout rather than a constant, so a thirty-minute
 * pause and a four-hour Escalation each get a dedup window that covers exactly their own
 * life. The application-owned open-wait unique index remains the authoritative guard; this
 * slot is defence in depth against a duplicate send inside that window.
 */
export async function sendWaitWake(tx: Transaction, wait: RunWait): Promise<void> {
  const db = queueDatabase(tx);
  const queue = new PgBoss({ db, migrate: false, createSchema: false, schedule: false, supervise: false });
  const id = await queue.send(WAIT_QUEUE, waitJob(wait), {
    db,
    startAfter: new Date(wait.deadline),
    singletonKey: `wait:${wait.waitId}`,
    singletonSeconds: waitTimeoutMs(wait.kind) / 1000,
    retryLimit: WAKE_RETRY_LIMIT,
    retryDelay: WAKE_RETRY_DELAY_SECONDS,
    expireInSeconds: WAKE_EXPIRE_SECONDS,
  });
  if (id === null) throw new Error('Wait wake job was not enqueued');
}

/**
 * Open a pause wait from inside a stage's guarded commit.
 *
 * A conflicting id or an open wait already on this Run THROWS rather than resolving
 * quietly: both mean the caller's guarded transaction admitted something it should not
 * have, and a pause that silently did not open would leave a `PAUSED` Run with no deadline
 * — a Run nothing could ever end.
 */
export async function openPauseWaitRow(tx: Transaction, wait: RunWait): Promise<void> {
  if (wait.kind !== 'pause') throw new Error('Only a pause wait may be opened by a stage');
  if (!(await insertWaitRow(tx, wait))) throw new Error('Pause wait already exists');
  await sendWaitWake(tx, wait);
}
