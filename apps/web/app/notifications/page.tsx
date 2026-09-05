import Link from 'next/link';
import { isNotificationCursor, type NotificationCursor } from '@intellifin/application';
import { DrizzleNotificationRepository } from '@intellifin/infrastructure';
import { getRuntime } from '../../src/bootstrap';
import { currentIdentity } from '../../src/server-session';
import { NotificationRefresh } from './NotificationRefresh';
export const dynamic = 'force-dynamic';
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }): Promise<React.JSX.Element> {
  const identity = await currentIdentity();
  if (identity.kind !== 'identified') return <><h1>Notifications</h1><p>Sign in to continue.</p></>;
  const query = await searchParams;
  let cursor: NotificationCursor | undefined, invalid = false;
  if (query.cursor !== undefined) {
    try { const value: unknown = JSON.parse(Buffer.from(query.cursor.length <= 8192 ? query.cursor : '', 'base64url').toString('utf8')); if (isNotificationCursor(value)) cursor = value; else invalid = true; }
    catch { invalid = true; }
  }
  const page = await new DrizzleNotificationRepository((await getRuntime()).db).deliveredFor(identity.session, cursor);
  return <div className="ls-stack"><h1>Notifications</h1><NotificationRefresh />
    {invalid ? <p role="alert">That older-notifications link is invalid. Showing the latest delivered items.</p> : null}
    {cursor ? <Link href="/notifications">Latest notifications</Link> : null}
    {page.items.length ? <ul className="ls-stack">{page.items.map(n => <li key={n.sendKey}><Link href={`/procedures/${n.procedureId}/versions/${n.versionId}`}>Procedure Version {n.kind} · {n.procedureName} · v{n.versionNumber} · Open version review</Link><p>Created <time dateTime={n.createdAt}>{n.createdAt}</time> · Delivered <time dateTime={n.deliveredAt}>{n.deliveredAt}</time></p></li>)}</ul> : <p>No delivered notifications on this page. New notifications may take a moment to appear. Refresh to check.</p>}
    {page.nextCursor ? <Link href={`/notifications?cursor=${Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url')}`}>Older notifications</Link> : null}
  </div>;
}
