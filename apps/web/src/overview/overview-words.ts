import { ESCALATION_PANEL_COPY } from '../design/copy';
import { escalationKindWord } from '../design/plain-words';

/**
 * The Overview's own sentences (owner finding RUN-04, 2026-09-16).
 *
 * Not `copy.ts`: those strings are quotations from the UX contract, pinned against
 * EXPERIENCE.md on disk. These are the platform's own words for a surface the contract
 * describes but does not write out — it fixes WHICH rows the attention list holds and in
 * what order, and the five columns of Recent Runs, and leaves the wording to us. The two
 * contract empty states stay in `copy.ts` and are still rendered, for the one case they
 * were written for: a deployment where nothing has run and nothing is waiting.
 *
 * The finding this module exists for: the Overview rendered both empty states
 * UNCONDITIONALLY, so it said "Nothing needs attention" and "none is Inconclusive or Run
 * Failed" beside a Runs register holding one Run Failed and two Inconclusive Runs. An
 * empty state is a statement about the environment; a page that makes it without reading
 * anything is not reporting, it is asserting.
 */

/**
 * The attention groups, in EXPERIENCE.md's own order.
 *
 * "Ordered: Awaiting Auditor (countdown) · Pending Confirmation · Submitted for review ·
 * Approved awaiting finalization · Inconclusive · Run Failed · missed scheduled start."
 * Three of those seven are not reachable in this release and the footnote below says so
 * rather than leaving a short list to read as a complete one.
 *
 * A flagged Run is not one of the seven and is listed anyway: Story 5.5 added the flag
 * after this contract row was written, the bell counts it, and an item the bell counts
 * that the attention list omits is two surfaces disagreeing. It sits after the
 * Escalations for the reason the inbox orders them that way — only a wait can EXPIRE.
 */
export const ATTENTION_GROUPS = {
  escalation: 'Waiting for your answer',
  flag: 'Flagged for an Audit Manager',
  version: 'Submitted for review',
  stopped: 'Stopped before a conclusion',
} as const;

/** The order the groups are rendered in, which is the contract's. */
export const ATTENTION_GROUP_ORDER = ['escalation', 'flag', 'version', 'stopped'] as const;
export type AttentionGroup = (typeof ATTENTION_GROUP_ORDER)[number];

/**
 * What this release cannot put on the attention list, said out loud.
 *
 * A Result awaiting confirmation or finalization is Epic 6's review queue, and a missed
 * scheduled start needs a scheduler, which is Epic 8. A list missing three of its seven
 * kinds with nothing saying so is the "empty list reads as a passed control" defect one
 * step along — the reader cannot tell a quiet platform from an unbuilt one.
 */
export const ATTENTION_NOT_YET_LISTED =
  'A Result awaiting confirmation, review or finalization is not listed here in this release. Nothing is scheduled, so no start can be missed. A short list does not mean a control passed.';

/**
 * What the attention section says when the open items could not be read.
 *
 * NOT an absence. `AWAITING_AUDITOR` means a Run is holding on a question, and a surface
 * that renders nothing there tells the reader the platform is simply quiet — the rule
 * Story 5.6 landed on `OpenEscalationSection`, met again one surface along. It names what
 * could not be read and what to do, and it never claims the Runs are fine.
 */
export const OPEN_ITEMS_UNREADABLE =
  'Runs waiting for an answer could not be read, so this list may be short. Reload the page, or open Notifications.';

/** What a bounded list says when it cannot show everything it counted. */
export const OVERVIEW_BOUNDED_TEMPLATE = 'Showing the first {shown} of {total}.';

export function overviewBounded(shown: number, total: number): string {
  return OVERVIEW_BOUNDED_TEMPLATE.replace('{shown}', String(shown)).replace('{total}', String(total));
}

/** The Recent Runs table's caption, and its way onward to the full register. */
export const RECENT_RUNS_CAPTION =
  'The most recent Runs, newest first, with their lifecycle, Result outcome, and Evidence Quality Gate.';
export const ALL_RUNS_LINK = 'All Runs';

/** Who started a Run, said beside the Procedure it ran. */
export const STARTED_BY = 'Started by';

/** Who submitted a version for review, and who is accountable for what it says. */
export const SUBMITTED_BY = 'Submitted by';
export const SUBMITTED_AT_UNKNOWN = 'The submission time was not recorded.';
export const AUTHORED_BY = 'Written by';
export const AUTHOR_UNKNOWN = 'No author is recorded on this version.';

/** What an open Escalation's countdown is measured against. */
export const TIME_REMAINING = 'Time remaining:';

/** When a flag was raised, and by whom. */
export const FLAGGED_BY = 'Flagged by';

/**
 * What an open Escalation is ASKING, in words.
 *
 * `ESCALATION_PANEL_COPY.questions` is keyed by the domain's closed vocabulary and the
 * value here arrives from the database typed `string`, so the lookup is
 * `Object.hasOwn`-guarded (the eighth occurrence of that trap in this codebase). A kind
 * this build does not recognise falls back to `escalationKindWord`, which NAMES it rather
 * than printing the stored identifier at a reader.
 */
export function escalationQuestion(kind: string): string {
  return Object.hasOwn(ESCALATION_PANEL_COPY.questions, kind)
    ? ESCALATION_PANEL_COPY.questions[kind as keyof typeof ESCALATION_PANEL_COPY.questions]
    : escalationKindWord(kind);
}

/**
 * What the Overview says to somebody it holds no summary for.
 *
 * A PoC Administrator may not start or supervise Runs, so this page reads nothing for them
 * — and the home page is exactly where a red refusal would be wrong. The domain's own
 * denial sentence names the boundary; this one says where their work is instead.
 */
export const OVERVIEW_NOT_YOUR_SUMMARY =
  'This summary is for the people who run and supervise audits. Procedures and Administration are open to you from the sidebar.';

/** A signed-in person with no role row at all: honest about what is known. */
export const OVERVIEW_NO_ROLE = 'Your account has no role, so there is nothing to summarize.';
