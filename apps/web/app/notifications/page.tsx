import Link from 'next/link';
import {
  formatNotificationTimeRemaining,
  isNotificationCursor,
  type DeliveredNotification,
  type NotificationCursor,
  type OpenEscalation,
  type OpenFlag,
  type OpenNotification,
} from '@intellifin/application';
import { DrizzleActorNameReader, DrizzleNotificationRepository } from '@intellifin/infrastructure';
import { getRuntime } from '../../src/bootstrap';
import { EMPTY_STATES, ESCALATION_PANEL_COPY } from '../../src/design/copy';
import { currentIdentity } from '../../src/server-session';
import { NotificationRefresh } from './NotificationRefresh';
export const dynamic = 'force-dynamic';

function escalationLink(notification: Pick<OpenEscalation, 'runId' | 'procedureName' | 'versionNumber' | 'escalationKind' | 'deadline'>): React.JSX.Element {
  // The notification is a pointer to the authorized Run surface. Its body carries only
  // safe procedure/Run/kind/time metadata; question text and Evidence values stay on the
  // Run Detail read path.
  return (
    <>
      <Link href={`/runs/${notification.runId}`}>
        {notification.procedureName} · waiting for your answer
      </Link>
      <p>
        {ESCALATION_PANEL_COPY.questions[notification.escalationKind]} · v{notification.versionNumber} · Time remaining:{' '}
        {formatNotificationTimeRemaining(notification.deadline)}
      </p>
      <p className="ls-caption">Run {notification.runId}</p>
    </>
  );
}

/**
 * A flagged Run (Story 5.5).
 *
 * No countdown, because a flag has no deadline — it needs attention while its Run is still
 * running, and that is what the read already filters on. A "0 minutes" here would be a
 * countdown that has already run out, which is worse than no countdown at all.
 */
function flagLink(notification: OpenFlag, names: ReadonlyMap<string, string>): React.JSX.Element {
  return (
    <>
      <Link href={`/runs/${notification.runId}/live`}>
        {notification.procedureName} · flagged for an Audit Manager
      </Link>
      <p>
        Flagged by {names.get(notification.flaggedBy) ?? notification.flaggedBy} at{' '}
        <time dateTime={notification.flaggedAt}>{notification.flaggedAt}</time> · v{notification.versionNumber}
      </p>
      <p className="ls-caption">Run {notification.runId}</p>
    </>
  );
}

function openItem(notification: OpenNotification, names: ReadonlyMap<string, string>): React.JSX.Element {
  return notification.kind === 'flag' ? flagLink(notification, names) : escalationLink(notification);
}

function notificationLink(notification: DeliveredNotification): React.JSX.Element {
  if (notification.kind === 'escalation') {
    return escalationLink(notification);
  }
  if (notification.kind === 'flag') {
    return (
      <Link href={`/runs/${notification.runId}/live`}>
        {notification.procedureName} · flagged for an Audit Manager · v{notification.versionNumber}
      </Link>
    );
  }
  return (
    <Link href={`/procedures/${notification.procedureId}/versions/${notification.versionId}`}>
      Procedure Version {notification.kind} · {notification.procedureName} · v{notification.versionNumber} · Open version review
    </Link>
  );
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }): Promise<React.JSX.Element> {
  const identity = await currentIdentity();
  if (identity.kind !== 'identified') return <><h1>Notifications</h1><p>Sign in to continue.</p></>;
  const query = await searchParams;
  let cursor: NotificationCursor | undefined, invalid = false;
  if (query.cursor !== undefined) {
    try { const value: unknown = JSON.parse(Buffer.from(query.cursor.length <= 8192 ? query.cursor : '', 'base64url').toString('utf8')); if (isNotificationCursor(value)) cursor = value; else invalid = true; }
    catch { invalid = true; }
  }
  const runtime = await getRuntime();
  const repository = new DrizzleNotificationRepository(runtime.db);
  const [open, page] = await Promise.all([
    repository.openFor(identity.session),
    repository.deliveredFor(identity.session, cursor),
  ]);
  // One lookup for every actor on the page. A user id printed at a reader is the platform
  // speaking its own language at somebody.
  const names = await new DrizzleActorNameReader(runtime.db)
    .namesFor(open.flatMap((item) => item.kind === 'flag' ? [item.flaggedBy] : []));
  return <div className="ls-stack"><h1>Notifications</h1><NotificationRefresh />
    {invalid ? <p role="alert">That older-notifications link is invalid. Showing the latest delivered items.</p> : null}
    {cursor ? <Link href="/notifications">Latest notifications</Link> : null}
    <section aria-labelledby="open-notifications-heading" className="ls-stack">
      <h2 id="open-notifications-heading">Runs that need you</h2>
      {open.length
        ? <ul className="ls-stack">{open.map(n => <li key={n.kind === 'flag' ? n.flagId : n.waitId}>{openItem(n, names)}</li>)}</ul>
        : <><p>{EMPTY_STATES.notificationsEmpty.headline}</p><p>{EMPTY_STATES.notificationsEmpty.sentence}</p></>}
    </section>
    <section aria-labelledby="delivered-notifications-heading" className="ls-stack">
      <h2 id="delivered-notifications-heading">Delivered notifications</h2>
    {page.items.length ? <ul className="ls-stack">{page.items.map(n => <li key={n.sendKey}>{notificationLink(n)}<p>Created <time dateTime={n.createdAt}>{n.createdAt}</time> · Delivered <time dateTime={n.deliveredAt}>{n.deliveredAt}</time></p></li>)}</ul> : <p>No delivered notifications on this page. New notifications may take a moment to appear. Refresh to check.</p>}
    {page.nextCursor ? <Link href={`/notifications?cursor=${Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url')}`}>Older notifications</Link> : null}
    </section>
  </div>;
}
