import { formatNotificationTimeRemaining, type OpenNotification } from '@intellifin/application';

import { escalationQuestion } from '../overview/overview-words';

/**
 * What the bell's panel lists (UI cleanup 2026-09-22, UX-32).
 *
 * The panel's only action used to be "Open notifications", so a bell showing "3" opened a
 * menu that said nothing about the three and sent the reader somewhere else to find out.
 * It lists them now, each linking to the Run it is about.
 *
 * The rows are built HERE, on the server, and handed to the client component as plain
 * strings. Three reasons: `formatNotificationTimeRemaining` measures against an instant,
 * and the server's own read time is the instant the count beside it was taken; the kind
 * vocabulary and its questions already live in `overview-words`, so the panel and the
 * attention list cannot describe one wait two ways; and the bell stays a component that
 * renders a count somebody else counted, with no query and no clock of its own.
 */

/** How many open items the panel names. The bell's count beside it is exact and unbounded. */
export const BELL_PANEL_LIMIT = 5;

export interface BellItem {
  /** Stable across renders: the wait or the flag, never the Run, which can hold both. */
  readonly key: string;
  readonly href: string;
  /** The Procedure, which is what a person recognises. */
  readonly title: string;
  /** What it is, in words — never the stored kind. */
  readonly kind: string;
  /** The question, or who raised the flag. One line. */
  readonly detail: string;
  /** How long is left, for a wait. A flag has no deadline and gets no countdown. */
  readonly remaining: string | null;
}

/** The two kinds, in words. A pause is neither: it never reaches the inbox at all. */
export const BELL_KIND_WORDS = {
  escalation: 'Waiting for your answer',
  flag: 'Flagged for an Audit Manager',
} as const;

export const BELL_HEADING = 'Runs that need you';
export const BELL_EMPTY = 'No Run is waiting on you.';
export const BELL_OPEN_ALL = 'Open notifications';
export const BELL_TIME_REMAINING = 'Time remaining:';
export const BELL_FLAGGED_BY = 'Flagged by';

/** More open items than the panel names, said rather than silently dropped. */
export function bellBounded(shown: number, total: number): string {
  return `Showing ${shown} of ${total}.`;
}

/**
 * One panel row per open item.
 *
 * An Escalation opens the Run, where the panel that answers it is; a flag opens Watch,
 * which is where an Audit Manager was asked to look. Both are the destinations the
 * Notifications page already uses, so the bell cannot send a person somewhere else.
 */
export function bellItems(
  open: readonly OpenNotification[],
  names: ReadonlyMap<string, string>,
  readAt: Date,
): readonly BellItem[] {
  return open.map((item) =>
    item.kind === 'flag'
      ? {
          key: item.flagId,
          href: `/runs/${item.runId}/live`,
          title: item.procedureName,
          kind: BELL_KIND_WORDS.flag,
          detail: `${BELL_FLAGGED_BY} ${names.get(item.flaggedBy) ?? item.flaggedBy}`,
          remaining: null,
        }
      : {
          key: item.waitId,
          href: `/runs/${item.runId}`,
          title: item.procedureName,
          kind: BELL_KIND_WORDS.escalation,
          detail: escalationQuestion(item.escalationKind),
          remaining: formatNotificationTimeRemaining(item.deadline, readAt),
        },
  );
}
