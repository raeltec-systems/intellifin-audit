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

/**
 * A notification produced by an Auditor flagging a Run (Story 5.5, FR-27, FR-28).
 *
 * FR-28 gives one recipient rule and one delivery path for both triggers, so this is the
 * same projection as an Escalation's minus the two fields a flag does not have: there is
 * no `escalationKind`, because nothing was asked, and no `deadline`, because nothing times
 * out. It carries **no note**, for the reason `EscalationNotification` carries no question:
 * a notification row names the Procedure and the Run, and the text is read on the Run by
 * somebody already authorized to open it.
 */
export interface FlagNotification extends Omit<VersionNotification, 'kind'> {
  readonly kind: 'flag';
  readonly runId: string;
  readonly flagId: string;
}

/** The two notifications a RUN produces. Both deliver through the same worker path. */
export type RunNotification = EscalationNotification | FlagNotification;

export type InAppNotification = VersionNotification | RunNotification;

/** A Run notification, as opposed to one a Procedure Version review produced. */
export function isRunNotification(value: InAppNotification): value is RunNotification {
  return value.kind === 'escalation' || value.kind === 'flag';
}

/**
 * A currently open wait shown by the Notifications surface.
 *
 * This is intentionally separate from {@link InAppNotification}: notification rows are
 * delivery tracking, while the inbox's current state comes from open waits (and, later,
 * open flags). There is no delivery timestamp or send key on this projection.
 */
interface OpenNotificationBase {
  readonly recipientId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly procedureName: string;
  readonly versionNumber: number;
  readonly runId: string;
}

export interface OpenEscalation extends OpenNotificationBase {
  readonly kind: 'escalation';
  readonly waitId: string;
  readonly escalationKind: EscalationKind;
  readonly deadline: string;
}

/**
 * A flagged Run, open while the Run is still active (Story 5.5).
 *
 * `deadline` is ABSENT rather than nullable, because a flag has none: nothing times it out
 * and what stops it needing attention is the Run ending. A nullable field on one shared
 * shape would be a countdown every reader has to remember not to render, and a fabricated
 * one would be a fact nobody measured.
 */
export interface OpenFlag extends OpenNotificationBase {
  readonly kind: 'flag';
  readonly flagId: string;
  readonly flaggedBy: string;
  readonly flaggedAt: string;
}

export type OpenNotification = OpenEscalation | OpenFlag;

/** Read open waits/flags independently of notification delivery tracking. */
export interface OpenNotificationReader {
  openFor(session: SessionSnapshot, limit?: number): Promise<readonly OpenNotification[]>;
}

/** Stable delivery key for one recipient and one wait. */
export function escalationNotificationSendKey(waitId: string, recipientId: string): string {
  return `escalation:${waitId}:${recipientId}`;
}

/** Stable delivery key for one recipient and one flag. */
export function flagNotificationSendKey(flagId: string, recipientId: string): string {
  return `flag:${flagId}:${recipientId}`;
}

/**
 * FR-28's recipient rule, for BOTH of its triggers: the initiating Auditor — or the
 * Procedure's author for a scheduled Run — and every Audit Manager.
 *
 * It was `escalationNotificationRecipients` until Story 5.5. The rename is the whole
 * change: one rule whose name claimed one of its two callers is one a later reader
 * duplicates rather than reuses.
 */
export function runNotificationRecipients(
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

export interface FlagNotificationSeed {
  readonly recipientId: string;
  readonly runId: string;
  readonly flagId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly procedureName: string;
  readonly versionNumber: number;
}

/**
 * Construct the safe flag notification.
 *
 * There is deliberately no note parameter, and no `flaggedBy` or `flaggedAt` either: a
 * notification row names WHICH flag, and who raised it and when are columns on `run_flag`.
 * Copying them here would be two places one fact lives, and a reader of the row would have
 * no way to tell a stale copy from the truth.
 */
export function createFlagNotification(seed: FlagNotificationSeed): FlagNotification {
  return {
    sendKey: flagNotificationSendKey(seed.flagId, seed.recipientId),
    recipientId: seed.recipientId,
    procedureId: seed.procedureId,
    versionId: seed.versionId,
    procedureName: seed.procedureName,
    versionNumber: seed.versionNumber,
    kind: 'flag',
    runId: seed.runId,
    flagId: seed.flagId,
  };
}

/**
 * The body a channel may render for a flag. No "time remaining": a flag has no deadline,
 * and FR-28's "time remaining before timeout" is a property of the Escalation it was
 * written for. Saying "0 minutes" would be a countdown that has already run out.
 */
export function flagNotificationBody(
  notification: Pick<FlagNotification, 'procedureName' | 'runId'>,
): string {
  return `Procedure ${notification.procedureName}; Run ${notification.runId}; flagged for an Audit Manager.`;
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
