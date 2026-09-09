import { sql } from 'drizzle-orm';

import type {
  EscalationNotification,
  NotificationChannel,
  NotificationDeliveryOutcome,
} from '@intellifin/application';
import type { Transaction } from '../db/client.js';
import {
  CryptoUuidV7Generator,
  SystemClock,
  createAuditEventWriter,
  type PostgresAuditDependencies,
} from '../db/audit-events.js';

type RawRow = Record<string, unknown>;

function rows(result: unknown): readonly RawRow[] {
  if (Array.isArray(result)) return result as RawRow[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const value = (result as { rows?: unknown }).rows;
    return Array.isArray(value) ? value as RawRow[] : [];
  }
  return [];
}

interface RunAuditContext {
  readonly correlationId: string;
  readonly sessionId: string;
}

/** Lock the Run and its wait before choosing whether a queued notification is still deliverable. */
export async function lockEscalationWait(
  transaction: Transaction,
  notification: EscalationNotification,
): Promise<boolean> {
  // Run producers and answers acquire the Run row before the wait row. Delivery follows
  // the same order, so a notification racing an answer can queue behind that transaction
  // without creating a wait -> Run inversion. The wait lock then protects the closed/open
  // decision for both delivery channels.
  const run = await transaction.execute(sql`
    SELECT run_id
    FROM audit_run
    WHERE run_id = ${notification.runId}
    FOR UPDATE
  `);
  if (rows(run).length === 0) throw new Error('Notification Run context could not be locked');
  const result = await transaction.execute(sql`
    SELECT closed_at
    FROM run_wait
    WHERE wait_id = ${notification.waitId} AND run_id = ${notification.runId}
    FOR UPDATE
  `);
  const row = rows(result)[0];
  if (!row || (row.closed_at !== null && row.closed_at !== undefined && !(row.closed_at instanceof Date) && typeof row.closed_at !== 'string')) {
    throw new Error('Notification wait context could not be locked');
  }
  return row.closed_at !== null && row.closed_at !== undefined;
}

async function runAuditContext(transaction: Transaction, runId: string): Promise<RunAuditContext> {
  const result = await transaction.execute(sql`
    SELECT correlation_id::text AS correlation_id, session_id
    FROM audit_run
    WHERE run_id = ${runId}
  `);
  const row = rows(result)[0];
  if (typeof row?.correlation_id !== 'string' || typeof row.session_id !== 'string') {
    throw new Error('Notification Run context could not be read');
  }
  return { correlationId: row.correlation_id, sessionId: row.session_id };
}

/**
 * Append the delivery result for a Run notification. The conditional update is the
 * idempotency boundary: a replay that already has an outcome appends no second audit row.
 */
export async function recordNotificationDelivery(
  transaction: Transaction,
  notification: EscalationNotification,
  channel: NotificationChannel,
  outcome: NotificationDeliveryOutcome,
  dependencies: PostgresAuditDependencies = {},
): Promise<boolean> {
  const updated = channel === 'email'
    ? await transaction.execute(sql`
        UPDATE notification
        SET email_outcome = ${outcome}, email_outcome_at = now()
        WHERE send_key = ${notification.sendKey}
          AND recipient_id = ${notification.recipientId}
          AND kind = 'escalation'
          AND email_outcome IS NULL
        RETURNING run_id::text AS run_id, wait_id::text AS wait_id
      `)
    : await transaction.execute(sql`
        UPDATE notification
        SET delivered_at = now(), in_app_outcome = ${outcome}
        WHERE send_key = ${notification.sendKey}
          AND recipient_id = ${notification.recipientId}
          AND version_id = ${notification.versionId}
          AND kind = 'escalation'
          AND delivered_at IS NULL
          AND in_app_outcome IS NULL
        RETURNING run_id::text AS run_id, wait_id::text AS wait_id
      `);
  const row = rows(updated)[0];
  if (!row) return false;
  if (row.run_id !== notification.runId || row.wait_id !== notification.waitId) {
    throw new Error('Notification delivery identity changed');
  }

  const run = await runAuditContext(transaction, notification.runId);
  const clock = dependencies.clock ?? new SystemClock();
  const ids = dependencies.ids ?? new CryptoUuidV7Generator();
  await createAuditEventWriter(transaction, clock, ids).append({
    actor: { type: 'system', id: 'notification-worker' },
    eventType: channel === 'email' ? 'notification.email-delivery' : 'notification.in-app-delivery',
    source: 'worker',
    // `unconfigured` is a delivery result. At the audit-envelope level it is a failed
    // delivery, while the exact closed result remains in `payload.deliveryOutcome`.
    outcome: outcome === 'delivered' ? 'success' : 'failure',
    aggregateId: notification.runId,
    correlationId: run.correlationId,
    sessionId: run.sessionId,
    payload: {
      sendKey: notification.sendKey,
      recipientId: notification.recipientId,
      waitId: notification.waitId,
      channel,
      deliveryOutcome: outcome,
      escalationKind: notification.escalationKind,
    },
  });
  return true;
}

/** The configured transport is intentionally absent in this deployment. */
export async function recordUnconfiguredEmail(
  transaction: Transaction,
  notification: EscalationNotification,
  dependencies: PostgresAuditDependencies = {},
): Promise<boolean> {
  return recordEmailOutcome(transaction, notification, 'unconfigured', dependencies);
}

export async function recordEmailOutcome(
  transaction: Transaction,
  notification: EscalationNotification,
  outcome: NotificationDeliveryOutcome,
  dependencies: PostgresAuditDependencies = {},
): Promise<boolean> {
  return recordNotificationDelivery(transaction, notification, 'email', outcome, dependencies);
}
