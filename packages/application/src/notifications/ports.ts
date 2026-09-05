import type { SessionSnapshot } from '../identity/ports.js';
import { canonicalJson } from '@intellifin/domain';

export interface InAppNotification {
  readonly sendKey: string;
  readonly recipientId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly procedureName: string;
  readonly versionNumber: number;
  readonly kind: 'submitted' | 'approved' | 'rejected';
}
/** Enqueue only; this writer is bound to the state-changing transaction. */
export interface NotificationWriter { enqueue(notification: InAppNotification): Promise<void> }
/** Worker-side idempotent in-app delivery. No external transport in the PoC. */
export interface NotificationSender { send(notification: InAppNotification): Promise<void> }
export interface NotificationRepository {
  pending(limit: number): Promise<readonly InAppNotification[]>;
  deliveredFor(session: SessionSnapshot, cursor?: NotificationCursor): Promise<NotificationPage>;
}
export interface NotificationCursor { readonly deliveredAt: string; readonly sendKey: string }
export interface DeliveredNotification extends InAppNotification { readonly createdAt: string; readonly deliveredAt: string }
export interface NotificationPage { readonly items: readonly DeliveredNotification[]; readonly nextCursor: NotificationCursor | null }
export function isNotificationCursor(value: unknown): value is NotificationCursor {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  if (!(Object.keys(row).length === 2 && typeof row['sendKey'] === 'string' && row['sendKey'].length > 0 && row['sendKey'].length <= 4000 &&
    typeof row['deliveredAt'] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(row['deliveredAt']) && Number.isFinite(Date.parse(row['deliveredAt'])))) return false;
  try { canonicalJson(row['sendKey']); } catch { return false; }
  return Number(row['deliveredAt'].slice(0,4)) >= 1 && new Date(row['deliveredAt']).toISOString().slice(0,23) === row['deliveredAt'].slice(0,23);
}
export async function deliverNotifications(repository: NotificationRepository, sender: NotificationSender): Promise<void> {
  for (const notification of await repository.pending(100)) await sender.send(notification);
}
