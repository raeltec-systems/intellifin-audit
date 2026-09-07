import type { SessionSnapshot } from '../identity/ports.js';
import type { EscalationKind } from '../runs/escalation-kind.js';
import { canonicalJson } from '@intellifin/domain';

export const NOTIFICATION_DELIVERY_OUTCOMES = ['delivered', 'unconfigured', 'failed', 'superseded'] as const;
export type NotificationDeliveryOutcome = (typeof NOTIFICATION_DELIVERY_OUTCOMES)[number];
export const NOTIFICATION_CHANNELS = ['in-app', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** A notification produced by the Procedure review flow (Story 2.7). */
export interface VersionNotification {
  readonly sendKey: string;
  readonly recipientId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly procedureName: string;
  readonly versionNumber: number;
  readonly kind: 'submitted' | 'approved' | 'rejected';
}

/**
 * A notification produced by a durable Run wait.
 *
 * The deadline is the only clock input persisted. A sender computes the remaining time at
 * delivery, so a delayed worker never tells a recipient that an old duration is current.
 * There is intentionally no question, evidence value, note or credential field here.
 */
export interface EscalationNotification extends Omit<VersionNotification, 'kind'> {
  readonly kind: 'escalation';
  readonly runId: string;
  readonly waitId: string;
  readonly escalationKind: EscalationKind;
  readonly deadline: string;
}

export type InAppNotification = VersionNotification | EscalationNotification;

/**
 * A currently open wait shown by the Notifications surface.
 *
 * This is intentionally separate from {@link InAppNotification}: notification rows are
 * delivery tracking, while the inbox's current state comes from open waits (and, later,
 * open flags). There is no delivery timestamp or send key on this projection.
 */
export interface OpenNotification {
  readonly recipientId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly procedureName: string;
  readonly versionNumber: number;
  readonly kind: 'escalation';
  readonly runId: string;
  readonly waitId: string;
  readonly escalationKind: EscalationKind;
  readonly deadline: string;
}

/** Read open waits/flags independently of notification delivery tracking. */
export interface OpenNotificationReader {
  openFor(session: SessionSnapshot, limit?: number): Promise<readonly OpenNotification[]>;
}

/** Stable delivery key for one recipient and one wait. */
export function escalationNotificationSendKey(waitId: string, recipientId: string): string {
  return `escalation:${waitId}:${recipientId}`;
}

/** Keep recipient selection deterministic and avoid notifying one person twice. */
export function escalationNotificationRecipients(
  initiatorId: string,
  auditManagerIds: readonly string[],
): readonly string[] {
  return [...new Set([initiatorId, ...auditManagerIds])];
}

export interface EscalationNotificationSeed {
  readonly recipientId: string;
  readonly runId: string;
  readonly waitId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly procedureName: string;
  readonly versionNumber: number;
  readonly escalationKind: EscalationKind;
  readonly deadline: string;
}

/** Construct the safe notification row without accepting agent question/evidence data. */
export function createEscalationNotification(seed: EscalationNotificationSeed): EscalationNotification {
  return {
    sendKey: escalationNotificationSendKey(seed.waitId, seed.recipientId),
    recipientId: seed.recipientId,
    procedureId: seed.procedureId,
    versionId: seed.versionId,
    procedureName: seed.procedureName,
    versionNumber: seed.versionNumber,
    kind: 'escalation',
    runId: seed.runId,
    waitId: seed.waitId,
    escalationKind: seed.escalationKind,
    deadline: seed.deadline,
  };
}

/**
 * The body an outbound channel may render. It is assembled from this narrow projection,
 * never from a Run detail or agent response. `now` is injectable for deterministic tests.
 */
export function escalationNotificationBody(
  notification: Pick<EscalationNotification, 'procedureName' | 'runId' | 'escalationKind' | 'deadline'>,
  now: Date = new Date(),
): string {
  const remaining = formatNotificationTimeRemaining(notification.deadline, now);
  return `Procedure ${notification.procedureName}; Run ${notification.runId}; Escalation ${notification.escalationKind}; Time remaining: ${remaining}.`;
}

export function formatNotificationTimeRemaining(deadline: string, now: Date = new Date()): string {
  const deadlineMs = Date.parse(deadline);
  const nowMs = now.getTime();
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) return '0 minutes';
  const minutes = Math.max(0, Math.ceil((deadlineMs - nowMs) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? `${hours} hour${hours === 1 ? '' : 's'}`
    : `${hours} hour${hours === 1 ? '' : 's'} ${rest} minute${rest === 1 ? '' : 's'}`;
}

/** An optional richer result for callers that want to persist channel outcomes. */
export interface NotificationDeliveryRecord {
  readonly sendKey: string;
  readonly recipientId: string;
  readonly channel: NotificationChannel;
  readonly outcome: NotificationDeliveryOutcome;
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
export type DeliveredNotification = InAppNotification & { readonly createdAt: string; readonly deliveredAt: string };
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
