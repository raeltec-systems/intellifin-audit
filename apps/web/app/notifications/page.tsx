import Link from 'next/link';
import {
  formatNotificationTimeRemaining,
  isNotificationCursor,
  type DeliveredNotification,
  type NotificationCursor,
  type OpenNotification,
} from '@intellifin/application';
import { DrizzleNotificationRepository } from '@intellifin/infrastructure';
import { getRuntime } from '../../src/bootstrap';
import { EMPTY_STATES } from '../../src/design/copy';
import { currentIdentity } from '../../src/server-session';
import { NotificationRefresh } from './NotificationRefresh';
export const dynamic = 'force-dynamic';

function escalationLink(notification: Pick<OpenNotification, 'runId' | 'procedureName' | 'versionNumber' | 'escalationKind' | 'deadline'>): React.JSX.Element {
  // The notification is a pointer to the authorized Run surface. Its body carries only
  // safe procedure/Run/kind/time metadata; question text and Evidence values stay on the
  // Run Detail read path.
  return (
    <>
      <Link href={`/runs/${notification.runId}`}>
        Run {notification.runId} · Escalation {notification.escalationKind}
      </Link>
      <p>
        Procedure {notification.procedureName} · v{notification.versionNumber} · Time remaining:{' '}
        {formatNotificationTimeRemaining(notification.deadline)}
      </p>
    </>
  );
}

function notificationLink(notification: DeliveredNotification): React.JSX.Element {
  if (notification.kind === 'escalation') {
    return escalationLink(notification);
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
  const repository = new DrizzleNotificationRepository((await getRuntime()).db);
  const [open, page] = await Promise.all([
    repository.openFor(identity.session),
    repository.deliveredFor(identity.session, cursor),
  ]);
  return <div className="ls-stack"><h1>Notifications</h1><NotificationRefresh />
    {invalid ? <p role="alert">That older-notifications link is invalid. Showing the latest delivered items.</p> : null}
    {cursor ? <Link href="/notifications">Latest notifications</Link> : null}
    <section aria-labelledby="open-notifications-heading" className="ls-stack">
      <h2 id="open-notifications-heading">Runs waiting for your answer</h2>
      {open.length ? <ul className="ls-stack">{open.map(n => <li key={n.waitId}>{escalationLink(n)}</li>)}</ul> : <><p>{EMPTY_STATES.notificationsEmpty.headline}</p><p>{EMPTY_STATES.notificationsEmpty.sentence}</p></>}
    </section>
    <section aria-labelledby="delivered-notifications-heading" className="ls-stack">
      <h2 id="delivered-notifications-heading">Delivered notifications</h2>
    {page.items.length ? <ul className="ls-stack">{page.items.map(n => <li key={n.sendKey}>{notificationLink(n)}<p>Created <time dateTime={n.createdAt}>{n.createdAt}</time> · Delivered <time dateTime={n.deliveredAt}>{n.deliveredAt}</time></p></li>)}</ul> : <p>No delivered notifications on this page. New notifications may take a moment to appear. Refresh to check.</p>}
    {page.nextCursor ? <Link href={`/notifications?cursor=${Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url')}`}>Older notifications</Link> : null}
    </section>
  </div>;
}
