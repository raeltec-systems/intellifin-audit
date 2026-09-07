import { and, asc, desc, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  isNotificationCursor,
  type EscalationNotification,
  type InAppNotification,
  type OpenNotification,
  type OpenNotificationReader,
  type NotificationCursor,
  type NotificationPage,
  type NotificationRepository,
  type NotificationSender,
  type NotificationWriter,
  type SessionSnapshot,
  type VersionNotification,
} from '@intellifin/application';
import type { Database, Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import { notification } from '../db/schema.js';
import {
  lockEscalationWait,
  recordNotificationDelivery,
  recordEmailOutcome,
} from './notification-delivery.js';
import type { PostgresAuditDependencies } from '../db/audit-events.js';

/**
 * These four projections are expanded with raw SQL because the migration is an expand step:
 * old workers can still compile while the release migrator adds the wait columns. Once the
 * schema has landed, they are ordinary nullable columns on `notification`.
 */
const selection = {
  sendKey: notification.sendKey,
  recipientId: notification.recipientId,
  procedureId: notification.procedureId,
  versionId: notification.versionId,
  kind: notification.kind,
  procedureName: notification.procedureName,
  versionNumber: notification.versionNumber,
  runId: sql<string | null>`run_id::text`,
  waitId: sql<string | null>`wait_id::text`,
  escalationKind: sql<string | null>`escalation_kind`,
  deadline: sql<string | null>`to_char(deadline AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  inAppOutcome: sql<string | null>`in_app_outcome`,
};

type RawNotificationRow = {
  readonly sendKey?: unknown;
  readonly recipientId?: unknown;
  readonly procedureId?: unknown;
  readonly versionId?: unknown;
  readonly kind?: unknown;
  readonly procedureName?: unknown;
  readonly versionNumber?: unknown;
  readonly runId?: unknown;
  readonly waitId?: unknown;
  readonly escalationKind?: unknown;
  readonly deadline?: unknown;
};

function parse(row: RawNotificationRow): InAppNotification[] {
  if (typeof row.sendKey !== 'string' || typeof row.recipientId !== 'string' ||
      typeof row.procedureId !== 'string' || typeof row.versionId !== 'string' ||
      typeof row.procedureName !== 'string' || typeof row.versionNumber !== 'number') return [];
  const base = {
    sendKey: row.sendKey,
    recipientId: row.recipientId,
    procedureId: row.procedureId,
    versionId: row.versionId,
    procedureName: row.procedureName,
    versionNumber: row.versionNumber,
  };
  if (row.kind === 'submitted' || row.kind === 'approved' || row.kind === 'rejected') {
    return [{ ...base, kind: row.kind } satisfies VersionNotification];
  }
  if (row.kind !== 'escalation' || typeof row.runId !== 'string' || !isUuidText(row.runId) ||
      typeof row.waitId !== 'string' || !isUuidText(row.waitId) ||
      (row.escalationKind !== 'choose-candidate' && row.escalationKind !== 'unnamed-value' && row.escalationKind !== 'retry-or-skip') ||
      typeof row.deadline !== 'string' || !Number.isFinite(Date.parse(row.deadline))) return [];
  return [{
    ...base,
    kind: 'escalation',
    runId: row.runId,
    waitId: row.waitId,
    escalationKind: row.escalationKind,
    deadline: new Date(row.deadline).toISOString(),
  } satisfies EscalationNotification];
}

export class DrizzleNotificationWriter implements NotificationWriter {
  constructor(private readonly tx: Transaction) {}

  async enqueue(value: InAppNotification): Promise<void> {
    if (value.kind !== 'escalation') {
      await this.tx.insert(notification).values(value).onConflictDoNothing({ target: notification.sendKey });
      return;
    }
    // Keep this insert on the caller's transaction. It is deliberately not a second pool
    // write: opening the wait, changing the Run state, and notifying recipients must commit
    // or roll back together.
    await this.tx.execute(sql`
      INSERT INTO notification (
        send_key, recipient_id, procedure_id, version_id, procedure_name, version_number,
        kind, run_id, wait_id, escalation_kind, deadline, email_outcome, email_outcome_at
      ) VALUES (
        ${value.sendKey}, ${value.recipientId}, ${value.procedureId}, ${value.versionId},
        ${value.procedureName}, ${value.versionNumber}, 'escalation', ${value.runId},
        ${value.waitId}, ${value.escalationKind}, ${value.deadline}::timestamptz,
        NULL, NULL
      ) ON CONFLICT (send_key) DO NOTHING
    `);
  }
}

export class DrizzleNotificationRepository implements NotificationRepository, OpenNotificationReader {
  constructor(private readonly db: Database) {}

  /**
   * Current inbox state comes from the open wait, not from whether its delivery row has been
   * consumed. A worker can be down for a while and the Run must still appear in the inbox;
   * conversely a closed wait must leave the inbox even if its historical delivery is pending.
   */
  async openFor(session: SessionSnapshot, limit = 100): Promise<readonly OpenNotification[]> {
    const bounded = Math.max(1, Math.min(100, limit));
    const result = await this.db.execute(sql`
      SELECT
        r.procedure_id::text AS procedure_id,
        r.version_id::text AS version_id,
        r.procedure_name,
        r.version_number,
        r.run_id::text AS run_id,
        w.wait_id::text AS wait_id,
        w.kind AS escalation_kind,
        to_char(w.deadline AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS deadline
      FROM run_wait w
      INNER JOIN audit_run r ON r.run_id = w.run_id
      WHERE w.closed_at IS NULL
        AND EXISTS (SELECT 1 FROM user_role access_role WHERE access_role.user_id = ${session.userId} AND access_role.role IN ('auditor','audit-manager'))
        AND r.state = 'AWAITING_AUDITOR'
        AND (
          r.initiator_id = ${session.userId}
          OR EXISTS (
            SELECT 1
            FROM user_role ur
            WHERE ur.user_id = ${session.userId} AND ur.role = 'audit-manager'
          )
        )
      ORDER BY w.deadline, w.wait_id
      LIMIT ${bounded}
    `);
    const resultRows = Array.isArray(result)
      ? result as readonly Record<string, unknown>[]
      : result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows?: unknown }).rows)
        ? (result as { rows: readonly Record<string, unknown>[] }).rows
        : [];
    return resultRows.flatMap((row): OpenNotification[] => {
      const runId = typeof row.run_id === 'string' ? row.run_id.toLowerCase() : null;
      const waitId = typeof row.wait_id === 'string' ? row.wait_id.toLowerCase() : null;
      const procedureId = typeof row.procedure_id === 'string' ? row.procedure_id.toLowerCase() : null;
      const versionId = typeof row.version_id === 'string' ? row.version_id.toLowerCase() : null;
      const escalationKind = row.escalation_kind;
      const deadline = typeof row.deadline === 'string' && Number.isFinite(Date.parse(row.deadline))
        ? new Date(row.deadline).toISOString()
        : null;
      if (!runId || !waitId || !procedureId || !versionId || !isUuidText(runId) || !isUuidText(waitId) ||
          !isUuidText(procedureId) || !isUuidText(versionId) || typeof row.procedure_name !== 'string' ||
          typeof row.version_number !== 'number' || row.version_number < 1 ||
          (escalationKind !== 'choose-candidate' && escalationKind !== 'unnamed-value' && escalationKind !== 'retry-or-skip') ||
          deadline === null) return [];
      return [{
        recipientId: session.userId,
        procedureId,
        versionId,
        procedureName: row.procedure_name,
        versionNumber: row.version_number,
        kind: 'escalation',
        runId,
        waitId,
        escalationKind,
        deadline,
      }];
    });
  }

  async pending(limit: number): Promise<readonly InAppNotification[]> {
    return (await this.db
      .select(selection)
      .from(notification)
      // An escalation has two independently recorded channel outcomes. A crash or a
      // deployment boundary after an older in-app-only worker can leave delivered_at set
      // while the email leg is still absent; keep that row claimable so the next worker
      // replay records the missing email outcome. Legacy version notifications retain the
      // original delivered_at-only predicate.
      .where(or(
        isNull(notification.deliveredAt),
        and(eq(notification.kind, 'escalation'), isNull(notification.emailOutcome)),
      ))
      .orderBy(asc(notification.createdAt), asc(notification.sendKey))
      .limit(Math.min(100, Math.max(1, limit))))
      .flatMap(parse);
  }

  async deliveredFor(session: SessionSnapshot, cursor?: NotificationCursor): Promise<NotificationPage> {
    if (cursor !== undefined && !isNotificationCursor(cursor)) throw new Error('Invalid notification cursor');
    const rows = await this.db.select({
      ...selection,
      createdAt: notification.createdAt,
      deliveredAt: sql<string>`to_char(${notification.deliveredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    }).from(notification).where(and(
      eq(notification.recipientId, session.userId),
      isNotNull(notification.deliveredAt),
      // `delivered_at` is the historical completion timestamp. The new outcome column
      // keeps a superseded escalation out of the delivered in-app history while leaving
      // legacy version rows (whose outcome is NULL) visible.
      sql`(in_app_outcome IS NULL OR in_app_outcome = 'delivered')`,
      cursor === undefined ? undefined : or(
        sql`${notification.deliveredAt} < ${cursor.deliveredAt}::timestamptz`,
        and(sql`${notification.deliveredAt} = ${cursor.deliveredAt}::timestamptz`, gt(notification.sendKey, cursor.sendKey)),
      ),
    )).orderBy(desc(notification.deliveredAt), asc(notification.sendKey)).limit(101);
    const visible = rows.slice(0, 100);
    const items = visible.flatMap(row => parse(row).map(item => ({
      ...item,
      createdAt: row.createdAt.toISOString(),
      deliveredAt: row.deliveredAt,
    })));
    const last = visible.at(-1);
    return { items, nextCursor: rows.length > 100 && last ? { deliveredAt: last.deliveredAt, sendKey: last.sendKey } : null };
  }
}

/**
 * Delivery is a conditional update. Escalation rows also record their email result in this
 * same transaction, so a replay cannot duplicate either channel's Audit Trail event.
 */
export class InAppNotificationSender implements NotificationSender {
  constructor(
    private readonly db: Database,
    private readonly dependencies: PostgresAuditDependencies = {},
  ) {}

  async send(value: InAppNotification): Promise<void> {
    await this.db.transaction(async transaction => {
      if (value.kind === 'escalation') {
        const closed = await lockEscalationWait(transaction, value);
        const outcome = closed ? 'superseded' : 'delivered';
        await recordNotificationDelivery(transaction, value, 'in-app', outcome, this.dependencies);
        // The no-transport email leg is independent of in-app delivery. If a caller retries a
        // row after an older worker recorded only the in-app timestamp, its own conditional
        // outcome repairs the missing email result without duplicating the audit append.
        await recordEmailOutcome(transaction, value, closed ? 'superseded' : 'unconfigured', this.dependencies);
        return;
      }
      await transaction.update(notification).set({ deliveredAt: new Date() }).where(and(
        eq(notification.sendKey, value.sendKey),
        eq(notification.recipientId, value.recipientId),
        eq(notification.versionId, value.versionId),
        isNull(notification.deliveredAt),
      ));
    });
  }
}
