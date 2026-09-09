'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

import { Banner } from '../design/Banner';
import { STALE_DATA_ACTION, updatedAtTitle } from '../design/copy';
import { utcStamp } from './labels';
import { liveSentence, type LiveStatus } from './live-status';
import { useLiveTimeline, type LiveTimelineEvent } from './useLiveTimeline';

/** At most one server re-read per second, however many events arrive. */
export const REFRESH_THROTTLE_MS = 1_000;

const LIVE_WORDS: Record<LiveStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  stale: 'No update',
  lost: 'Connection lost',
  ended: 'Live update ended',
};

/**
 * The `Updated {time}. Refresh.` banner, made live (Story 5.1).
 *
 * It keeps everything the contract's banner had — the instant of the read the page is
 * showing and the `Refresh.` link that works with no JavaScript — and adds what the
 * channel knows: whether the page is being updated on its own, and when it stopped
 * being. On every Timeline event it asks the server to re-read the page
 * (`router.refresh()`, throttled), so the surface shows what PostgreSQL holds at that
 * sequence rather than anything carried over the wire. Only the status WORD is
 * announced, so a screen reader hears a change of state and not a counting clock.
 */
export function LiveBanner({
  url,
  cursor,
  readAt,
  href,
  refreshOn,
}: {
  readonly url: string;
  /** The chain head the page was rendered at, or `null` for the list stream. */
  readonly cursor: number | null;
  /** ISO 8601 UTC instant of the read the page is showing. */
  readonly readAt: string;
  readonly href: string;
  /** Which events re-read the page; every event when omitted. */
  readonly refreshOn?: ((event: LiveTimelineEvent) => boolean) | undefined;
}): React.JSX.Element {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAt = useRef(0);
  const refresh = useCallback(() => {
    const due = lastRefreshAt.current + REFRESH_THROTTLE_MS - Date.now();
    if (due <= 0) { lastRefreshAt.current = Date.now(); router.refresh(); return; }
    if (pending.current !== null) return;
    pending.current = setTimeout(() => { pending.current = null; lastRefreshAt.current = Date.now(); router.refresh(); }, due);
  }, [router]);
  useEffect(() => () => { if (pending.current !== null) clearTimeout(pending.current); }, []);
  const live = useLiveTimeline(url, cursor, (event) => { if (refreshOn === undefined || refreshOn(event)) refresh(); });
  const attention = live.status === 'stale' || live.status === 'lost' || live.status === 'ended';
  return (
    <Banner tone={attention ? 'warning' : 'info'} title={updatedAtTitle(utcStamp(new Date(readAt)))}>
      <p data-live-status={live.status} data-live-seq={live.lastSeq}>
        <span className="ls-visually-hidden" aria-live="polite">{LIVE_WORDS[live.status]}</span>
        <span aria-hidden="true">{liveSentence(live.status, live.silence)}</span>{' '}
        <Link href={href}>{STALE_DATA_ACTION}</Link>
      </p>
    </Banner>
  );
}
