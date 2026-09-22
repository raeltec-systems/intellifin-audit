'use client';

import { useEffect, useId, useRef, useState } from 'react';

import Link from 'next/link';
import { Icon } from '../design/Icon';
import {
  BELL_EMPTY,
  BELL_HEADING,
  BELL_OPEN_ALL,
  BELL_TIME_REMAINING,
  bellBounded,
  type BellItem,
} from './bell-items';

interface NotificationBellProps {
  /**
   * Unread Awaiting Auditor and flagged Runs. A typed input, not a query: the shell
   * shows a count somebody else counted. Absent or zero shows no count at all, because
   * EXPERIENCE.md forbids showing a count before it is known.
   */
  readonly unread?: number | undefined;
  /**
   * The open items themselves, already worded on the server (UI cleanup 2026-09-22,
   * UX-32). Bounded; `unread` is the exact number and may be larger.
   */
  readonly items?: readonly BellItem[];
}

/**
 * The top-bar bell, with its unread count in `{components.status-badge-info-solid}`.
 *
 * The top bar carries this and nothing else. The prototype's "Signed in as" switcher is
 * disclaimed there as a prototype affordance, and a role switcher would contradict AD-7
 * outright — the role comes from the session on the server, never from a control.
 *
 * The panel links to the signed-in user's delivered Notifications surface.
 * A bell that opens nothing would be a control that lies about being one.
 *
 * It is a disclosure, not a dialog: it does not trap focus, so it must be dismissible
 * the two ways a disclosure is expected to be — Escape, and a click outside — and it
 * must put focus back on the bell when Escape closes it, or the keyboard user is left
 * on a control that has just been removed.
 */
export function NotificationBell({ unread, items = [] }: NotificationBellProps): React.JSX.Element {
  const panelId = useId();
  const headingId = `${panelId}-heading`;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const count = unread !== undefined && unread > 0 ? unread : null;

  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
    function onPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (target instanceof Node && wrapRef.current?.contains(target)) return;
      setOpen(false);
    }
    // Focus leaving the disclosure entirely closes it, which is what a Tab out means.
    function onFocusIn(event: FocusEvent): void {
      const target = event.target;
      if (target instanceof Node && wrapRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, [open]);

  return (
    <div className="ls-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="ls-bell"
        aria-expanded={open}
        aria-controls={panelId}
        ref={buttonRef}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="bell" size={18} />
        <span className="ls-visually-hidden">Notifications</span>
        {count === null ? null : (
          <span className="ls-bell__count">
            {count}
            <span className="ls-visually-hidden"> unread</span>
          </span>
        )}
      </button>
      {/*
        The panel LISTS what is waiting. Its last link is still "Open notifications", by
        that exact name, because two browser suites reach the Notifications surface
        through it — and because a panel that showed five of twelve has to offer the page
        that shows the rest.
      */}
      <div
        className="ls-bell-panel"
        id={panelId}
        hidden={!open}
        role="group"
        aria-labelledby={headingId}
      >
        {open ? (
          <>
            <p className="ls-bell-panel__heading" id={headingId}>
              {BELL_HEADING}
            </p>
            {items.length === 0 ? (
              <p className="ls-caption">{BELL_EMPTY}</p>
            ) : (
              <ul className="ls-bell-panel__items">
                {items.map((item) => (
                  <li key={item.key}>
                    <Link href={item.href} onClick={() => setOpen(false)}>
                      {item.title} · {item.kind}
                    </Link>
                    <p className="ls-caption">{item.detail}</p>
                    {item.remaining === null ? null : (
                      <p className="ls-caption">
                        {BELL_TIME_REMAINING} {item.remaining}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {count !== null && count > items.length ? (
              <p className="ls-caption">{bellBounded(items.length, count)}</p>
            ) : null}
            <Link href="/notifications" onClick={() => setOpen(false)}>{BELL_OPEN_ALL}</Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
