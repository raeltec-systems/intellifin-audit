import { and, asc, desc, eq, isNotNull, isNull, or, gt, sql } from 'drizzle-orm';
import { isNotificationCursor } from '@intellifin/application';
import type { NotificationCursor, NotificationPage, InAppNotification, NotificationRepository, NotificationSender, NotificationWriter, SessionSnapshot } from '@intellifin/application';
import type { Database, Transaction } from '../db/client.js';
import { notification } from '../db/schema.js';

const selection = { sendKey: notification.sendKey, recipientId: notification.recipientId, procedureId: notification.procedureId, versionId: notification.versionId, kind: notification.kind, procedureName: notification.procedureName, versionNumber: notification.versionNumber };
function parse(row: typeof notification.$inferSelect | { sendKey: string; recipientId: string; procedureId: string; versionId: string; procedureName: string; versionNumber: number; kind: string }): InAppNotification[] {
  return row.kind === 'submitted' || row.kind === 'approved' || row.kind === 'rejected' ? [{ ...row, kind: row.kind }] : [];
}
export class DrizzleNotificationWriter implements NotificationWriter {
  constructor(private readonly tx: Transaction) {}
  async enqueue(value: InAppNotification): Promise<void> { await this.tx.insert(notification).values(value).onConflictDoNothing({ target: notification.sendKey }); }
}
export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Database) {}
  async pending(limit: number): Promise<readonly InAppNotification[]> { return (await this.db.select(selection).from(notification).where(isNull(notification.deliveredAt)).orderBy(asc(notification.createdAt), asc(notification.sendKey)).limit(Math.min(100, Math.max(1, limit)))).flatMap(parse); }
  async deliveredFor(session: SessionSnapshot, cursor?: NotificationCursor): Promise<NotificationPage> {
    if (cursor !== undefined && !isNotificationCursor(cursor)) throw new Error('Invalid notification cursor');
    const rows = await this.db.select({ ...selection, createdAt: notification.createdAt,
      deliveredAt: sql<string>`to_char(${notification.deliveredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    }).from(notification).where(and(eq(notification.recipientId, session.userId), isNotNull(notification.deliveredAt),
      cursor === undefined ? undefined : or(sql`${notification.deliveredAt} < ${cursor.deliveredAt}::timestamptz`, and(sql`${notification.deliveredAt} = ${cursor.deliveredAt}::timestamptz`, gt(notification.sendKey, cursor.sendKey))),
    )).orderBy(desc(notification.deliveredAt), asc(notification.sendKey)).limit(101);
    const visible = rows.slice(0,100);
    const items = visible.flatMap(row => parse(row).map(item => ({ ...item, createdAt: row.createdAt.toISOString(), deliveredAt: row.deliveredAt })));
    const last = visible.at(-1);
    return { items, nextCursor: rows.length > 100 && last ? { deliveredAt: last.deliveredAt, sendKey: last.sendKey } : null };
  }
}
/** Delivery is a conditional update: replay never duplicates an in-app item. */
export class InAppNotificationSender implements NotificationSender {
  constructor(private readonly db: Database) {}
  async send(value: InAppNotification): Promise<void> {
    await this.db.update(notification).set({ deliveredAt: new Date() }).where(and(eq(notification.sendKey, value.sendKey), eq(notification.recipientId, value.recipientId), eq(notification.versionId, value.versionId), isNull(notification.deliveredAt)));
  }
}
