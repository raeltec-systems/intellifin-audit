'use client';

import { useEffect, useState } from 'react';

/**
 * The clock a held Run shows, shared by the Escalation panel and the Paused banner.
 *
 * EXPERIENCE.md asks for a countdown on BOTH: line 115 ("Paused (30 min) and Awaiting
 * Auditor (4 h) show a countdown and what happens at timeout"), line 149 ("Banner with
 * countdown"), and line 292 ("chrome shows PAUSED with a 30-minute countdown"). Story 5.6
 * built one for the Escalation and Story 5.4's banner printed two absolute timestamps, so
 * the two surfaces disagreed about how long a reader has to act.
 *
 * ONE implementation, because the arithmetic is what would diverge: `countdownText` is
 * tested at 3,599,001 ms precisely so "59 minutes 59 seconds" cannot round to an hour, and
 * a second copy would be a second answer to how long is left.
 */

/** Format a remaining duration without claiming that a completed wake has run. */
export function countdownText(remainingMilliseconds: number): string {
  if (!Number.isFinite(remainingMilliseconds)) return 'Unknown';
  const totalSeconds = Math.max(0, Math.ceil(remainingMilliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

/**
 * Milliseconds left, or `NaN` when either instant is unreadable.
 *
 * `NaN` rather than zero: zero would say the deadline has passed, which is a claim about
 * the Run. `countdownText` renders it `Unknown`, which is what is actually known.
 */
export function remainingMilliseconds(deadline: string, at: string): number {
  const end = Date.parse(deadline);
  const start = Date.parse(at);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return Number.NaN;
  return end - start;
}

export interface WaitCountdownProps {
  /** The wait's immutable deadline (generation 34). */
  readonly deadline: string;
  /**
   * The instant the server read, so the first client render matches the server's.
   *
   * Without it the two disagree by however long hydration took and React reports a
   * mismatch on a value that is simply a clock.
   */
  readonly readAt: string;
  /** What the reader is told has happened once it runs out. */
  readonly expiredSentence: string;
}

/**
 * `role="timer"` and NO live region, which is the Story 5.6 decision applied here too.
 *
 * Its implicit `aria-live` is `off`. A clock inside a live region announces itself once a
 * second for the whole wait — the Story 4.8 defect — which is the opposite of a milestone.
 */
export function WaitCountdown({ deadline, readAt, expiredSentence }: WaitCountdownProps): React.JSX.Element {
  const [remaining, setRemaining] = useState(() => remainingMilliseconds(deadline, readAt));
  useEffect(() => {
    const update = (): void => setRemaining(remainingMilliseconds(deadline, new Date().toISOString()));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return (
    <p role="timer">
      <time dateTime={deadline}>{countdownText(remaining)}</time>
      {Number.isFinite(remaining) && remaining <= 0 ? ` — ${expiredSentence}` : null}
    </p>
  );
}
