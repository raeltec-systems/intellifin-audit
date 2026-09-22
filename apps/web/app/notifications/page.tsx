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
import { EMPTY_STATES, NOTIFICATIONS_BOUNDED } from '../../src/design/copy';
import { EmptyState } from '../../src/design/EmptyState';
import { PageHeader } from '../../src/design/PageHeader';
import { Reference } from '../../src/design/Reference';
import { Timestamp } from '../../src/design/Timestamp';
import { escalationQuestion, TIME_REMAINING } from '../../src/overview/overview-words';
import { ActorName } from '../../src/runs/ActorName';
import { BELL_FLAGGED_BY, BELL_KIND_WORDS } from '../../src/shell/bell-items';
import { currentIdentity } from '../../src/server-session';
import { NotificationRefresh } from './NotificationRefresh';

export const dynamic = 'force-dynamic';

/**
 * Notifications (UI cleanup 2026-09-22, UX-32).
 *
 * `[REPAIRED]` Every instant on this page was a raw ISO 8601 string — `Created
 * 2026-09-21T12:24:45.656Z · Delivered 2026-09-21T12:24:46.001Z` — which is the machine
 * spelling of a fact a person compares by eye, and the revised Formats row makes it a
 * defect on an ordinary screen. Every Run was additionally named by its own UUID under the
 * Procedure that would have identified it. Instants go through `<Timestamp>`, which keeps
 * the exact value in its `datetime` attribute; an identifier is a short `<Reference>`.
 *
 * The Escalation's question is looked up through `escalationQuestion`, which is
 * `Object.hasOwn`-guarded: the kind arrives from the database typed `string`, and a plain
 * index answers `'constructor'` with a function. It was indexed directly here.
 */

/** What this surface is, and what a reader is looking at. */
const NOTIFICATIONS_TITLE = 'Notifications';
const NOTIFICATIONS_LEDE =
  'Runs waiting on you or flagged for an Audit Manager, and every notification this platform has delivered to you.';
const OPEN_HEADING = 'Runs that need you';
const DELIVERED_HEADING = 'Delivered notifications';
const CREATED = 'Created';
const DELIVERED = 'Delivered';
const LATEST_LINK = 'Latest notifications';
const OLDER_LINK = 'Older notifications';
const INVALID_CURSOR =
  'That older-notifications link is invalid. Showing the latest delivered items.';
const NO_DELIVERED_ON_PAGE =
  'No delivered notification on this page. A new one may take a moment to appear. Refresh to check.';
const VERSION_DECISION_LINK = 'Open the version review';

function escalationItem(
  notification: Pick<
    OpenEscalation,
    'runId' | 'procedureName' | 'versionNumber' | 'escalationKind' | 'deadline'
  >,
  readAt: Date,
): React.JSX.Element {
  // The notification is a POINTER to the authorized Run surface. Its body carries only
  // safe Procedure/Run/kind/time metadata; the question text and every Evidence value stay
  // on the Run Detail read path.
  return (
    <>
      <p>
        <Link href={`/runs/${notification.runId}`}>
          {notification.procedureName} · v{notification.versionNumber} ·{' '}
          {BELL_KIND_WORDS.escalation}
        </Link>{' '}
        <Reference kind="Run" value={notification.runId} />
      </p>
      <p>{escalationQuestion(notification.escalationKind)}</p>
      <p className="ls-caption">
        {TIME_REMAINING} {formatNotificationTimeRemaining(notification.deadline, readAt)}
      </p>
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
function flagItem(
  notification: OpenFlag,
  names: ReadonlyMap<string, string>,
): React.JSX.Element {
  return (
    <>
      <p>
        <Link href={`/runs/${notification.runId}/live`}>
          {notification.procedureName} · v{notification.versionNumber} · {BELL_KIND_WORDS.flag}
        </Link>{' '}
        <Reference kind="Run" value={notification.runId} />
      </p>
      <p className="ls-caption">
        {BELL_FLAGGED_BY} <ActorName id={notification.flaggedBy} names={names} /> ·{' '}
        <Timestamp value={notification.flaggedAt} precision="minute" />
      </p>
    </>
  );
}

function openItem(
  notification: OpenNotification,
  names: ReadonlyMap<string, string>,
  readAt: Date,
): React.JSX.Element {
  return notification.kind === 'flag'
    ? flagItem(notification, names)
    : escalationItem(notification, readAt);
}

function deliveredItem(notification: DeliveredNotification, readAt: Date): React.JSX.Element {
  if (notification.kind === 'escalation') return escalationItem(notification, readAt);
  if (notification.kind === 'flag') {
    return (
      <p>
        <Link href={`/runs/${notification.runId}/live`}>
          {notification.procedureName} · v{notification.versionNumber} · {BELL_KIND_WORDS.flag}
        </Link>{' '}
        <Reference kind="Run" value={notification.runId} />
      </p>
    );
  }
  // A version decision: approved, rejected, or sent for review. The stored kind is the
  // word here because it IS the decision's name in this product's own vocabulary.
  return (
    <p>
      <Link href={`/procedures/${notification.procedureId}/versions/${notification.versionId}`}>
        {notification.procedureName} · v{notification.versionNumber} · {notification.kind} ·{' '}
        {VERSION_DECISION_LINK}
      </Link>
    </p>
  );
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}): Promise<React.JSX.Element> {
  const identity = await currentIdentity();
  if (identity.kind !== 'identified') {
    return (
      <div className="ls-stack">
        <PageHeader title={NOTIFICATIONS_TITLE} />
        <p>Sign in to continue.</p>
      </div>
    );
  }
  const query = await searchParams;
  let cursor: NotificationCursor | undefined;
  let invalid = false;
  if (query.cursor !== undefined) {
    try {
      const value: unknown = JSON.parse(
        Buffer.from(query.cursor.length <= 8192 ? query.cursor : '', 'base64url').toString('utf8'),
      );
      if (isNotificationCursor(value)) cursor = value;
      else invalid = true;
    } catch {
      invalid = true;
    }
  }
  const runtime = await getRuntime();
  const repository = new DrizzleNotificationRepository(runtime.db);
  const readAt = new Date();
  const [open, page, openTotal] = await Promise.all([
    repository.openFor(identity.session),
    repository.deliveredFor(identity.session, cursor),
    // The number the BELL shows, which counts waits and flags unbounded. The list is
    // bounded, so without this the two disagree and nothing on the page says why.
    repository.countOpenFor(identity.session),
  ]);
  // One lookup for every actor on the page. A user id printed at a reader is the platform
  // speaking its own language at somebody.
  // Only the OPEN flags name a person: a delivered flag notification deliberately carries
  // no `flaggedBy` — a notification row names the Procedure and the Run, and who raised
  // the flag is read on the Run by somebody already authorized to open it.
  const names = await new DrizzleActorNameReader(runtime.db).namesFor(
    open.flatMap((item) => (item.kind === 'flag' ? [item.flaggedBy] : [])),
  );

  return (
    <div className="ls-stack">
      <PageHeader title={NOTIFICATIONS_TITLE} lede={NOTIFICATIONS_LEDE} />
      <NotificationRefresh />
      {invalid ? <p role="alert">{INVALID_CURSOR}</p> : null}
      {cursor ? <Link href="/notifications">{LATEST_LINK}</Link> : null}

      <section aria-labelledby="open-notifications-heading" className="ls-stack">
        <h2 id="open-notifications-heading">{OPEN_HEADING}</h2>
        {open.length === 0 ? (
          <EmptyState icon="inbox" {...EMPTY_STATES.notificationsEmpty} />
        ) : (
          <ul className="ls-attention">
            {open.map((item) => (
              <li className="ls-attention__item" key={item.kind === 'flag' ? item.flagId : item.waitId}>
                {openItem(item, names, readAt)}
              </li>
            ))}
          </ul>
        )}
        {openTotal > open.length ? (
          <p role="status">
            {NOTIFICATIONS_BOUNDED.replace('{shown}', String(open.length)).replace(
              '{total}',
              String(openTotal),
            )}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="delivered-notifications-heading" className="ls-stack">
        <h2 id="delivered-notifications-heading">{DELIVERED_HEADING}</h2>
        {page.items.length === 0 ? (
          <p>{NO_DELIVERED_ON_PAGE}</p>
        ) : (
          <ul className="ls-attention">
            {page.items.map((item) => (
              <li className="ls-attention__item" key={item.sendKey}>
                {deliveredItem(item, readAt)}
                <p className="ls-caption">
                  {CREATED} <Timestamp value={item.createdAt} precision="minute" /> · {DELIVERED}{' '}
                  <Timestamp value={item.deliveredAt} precision="minute" />
                </p>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor ? (
          <Link
            href={`/notifications?cursor=${Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url')}`}
          >
            {OLDER_LINK}
          </Link>
        ) : null}
      </section>
    </div>
  );
}
