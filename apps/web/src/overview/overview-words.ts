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
  pending: 'Your assessment review is needed',
  version: 'Submitted for review',
  stopped: 'Stopped before a conclusion',
} as const;

/** The order the groups are rendered in, which is the contract's. */
export const ATTENTION_GROUP_ORDER = ['escalation', 'flag', 'pending', 'version', 'stopped'] as const;
export type AttentionGroup = (typeof ATTENTION_GROUP_ORDER)[number];

/**
 * What this release still cannot put on the attention list, said out loud.
 *
 * `[REVISED 2026-09-22, UI cleanup UX-01]` It used to say a Result awaiting CONFIRMATION
 * was "not listed here in this release", and that had stopped being true: Story 4.9 holds
 * an Agent-Judged Result open at `PENDING_CONFIRMATION` until a person decides each
 * machine proposal, and the Run's own Result tab has carried that review since. So a
 * finished test whose conclusion was waiting on the reader — the single most actionable
 * thing this platform can show them — was excluded by a footnote claiming it could not
 * exist. It is a group of its own now, and this names only what is genuinely absent:
 * submitting a Result for review, approving one, finalizing one, and a scheduler.
 */
export const ATTENTION_NOT_YET_LISTED =
  'A Result submitted for review, approved or finalized is not listed here: this release cannot submit one. Nothing is scheduled, so no start can be missed. A short list does not mean a control passed.';

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

/* -------------------------------------------------- role landing (UX-37) --- */

/**
 * The Overview's lede, from the cleanup plan's own information hierarchy.
 *
 * `[REVISED 2026-09-22]` It read "What ran, what needs attention, and whether Evidence is
 * trustworthy" — three nouns about the platform. EXPERIENCE.md's role-landing decision is
 * that the Overview leads with the signed-in role's NEXT ACTIONS, so the sentence is about
 * the reader's own work.
 */
export const OVERVIEW_LEDE = 'Your audit work and the items that need your attention.';

/** The Auditor's own sections, in the order the plan gives them. */
export const MY_DRAFTS_HEADING = 'Your drafts';
export const MY_DRAFTS_SENTENCE =
  'Procedures whose newest version is a Draft you are accountable for. Carry on where you left off, then submit for approval.';
export const MY_DRAFTS_EMPTY = {
  headline: 'You have no Draft in progress.',
  sentence:
    'A Procedure you started and have not yet submitted would be listed here. An empty list does not mean a control passed.',
} as const;
export const ALL_PROCEDURES_LINK = 'All Procedures';

/** How many drafts and how many stopped Runs the Overview names at once. */
export const OVERVIEW_DRAFT_LIMIT = 5;

/**
 * The PoC Administrator's landing (UX-37).
 *
 * `[REPAIRED 2026-09-22]` They used to meet a Banner saying the summary was for other
 * people — a refusal-shaped welcome for somebody whose only fault was signing in, and one
 * that named nothing they could actually do. EXPERIENCE.md's role-landing decision is that
 * "a PoC Administrator lands on an administration summary, not on a refusal", so the page
 * leads with the three things they set up and the standing facts about this deployment.
 *
 * These are plain LINKS and not counts. An exact count of users, sources or systems has no
 * reader: every administration repository answers a bounded page, and `rows.length` of a
 * bounded page is the bound rather than a count — which is the one thing this product's
 * empty-state rule forbids a surface to report as a total.
 */
export const ADMIN_OVERVIEW_HEADING = 'Set up this environment';
export const ADMIN_OVERVIEW_SENTENCE =
  'What an auditor can build a Procedure from: the people who may sign in, the sources a population is read from, and the systems a Run may reach.';
/**
 * `/administration` is the Users surface in this build, not a hub above one: the route
 * `/administration/users` that `breadcrumb-rules.ts` already names does not exist yet, and
 * a landing page that linked to it would send an administrator to a 404. Package 6 owns
 * those routes; this points at what is there.
 */
export const ADMIN_LINKS = [
  { href: '/administration', label: 'Users', detail: 'Who may sign in, and what each of them may do.' },
  { href: '/administration/sources', label: 'Population sources', detail: 'Where the records a Run tests are read from.' },
  { href: '/administration/registrations', label: 'Systems', detail: 'The Target Systems a Run may reach, and what it may do there.' },
] as const;

export const ADMIN_ENVIRONMENT_HEADING = 'About this environment';

/**
 * The standing facts, for the reader who sets the environment up.
 *
 * Each is true of this build and each is something an administrator is asked about. They
 * are stated here rather than inferred from a reading of the code, and none of them is a
 * claim about whether anything passed.
 */
export const ADMIN_ENVIRONMENT_FACTS = [
  'Every Population Source and Target System in this environment is synthetic and read-only. No result is an assurance conclusion.',
  'Nothing is scheduled. A person starts every Run by hand from the Procedure it belongs to.',
  'An account is created here with its first password. There is no invitation email and no password recovery.',
  'A Procedure Version is approved by somebody other than its author, so a deployment needs at least one Audit Manager besides the auditor who writes.',
] as const;

/** Where an administrator is told the audit work itself lives. */
export const ADMIN_OVERVIEW_SCOPE =
  'Runs and Reviews are the work of the auditors and Audit Managers, so nothing about them is read for this role.';

/**
 * The order an Audit Manager's attention list leads with (UI cleanup 2026-09-22).
 *
 * EXPERIENCE.md's role-landing decision names the manager's first section "Procedure
 * Versions awaiting approval"; the attention list's own contract order (line 131) leads
 * with Awaiting Auditor. Both are the contract, and they disagree only about which group
 * comes first for one role, so the group MOVES and nothing else changes: no group is
 * added, hidden or rendered twice, and `stopped` stays last, because historic stopped Runs
 * must never displace current work.
 */
export const MANAGER_ATTENTION_ORDER = [
  'version',
  'escalation',
  'flag',
  'pending',
  'stopped',
] as const satisfies readonly AttentionGroup[];

/** The heading over the attention list, and the section that holds the Runs register. */
export const ATTENTION_HEADING = 'Needs attention';
export const RECENT_RUNS_HEADING = 'Recent Runs';

/**
 * How many stopped Runs the Overview names at once.
 *
 * `listStoppedRuns` bounds its own read and answers an exact total beside it, so the
 * bounded note is honest; this is the number that keeps the group short enough that it
 * cannot push current work off the first viewport.
 */
export const OVERVIEW_STOPPED_LIMIT = 5;

/**
 * How many open Escalations and flags the Overview's attention list holds.
 *
 * The count beside the list is exact; this bounds only the rows named. It lives here rather
 * than in the page because `bell-burst.spec.ts` must read the same bound: a flag past it is
 * correctly not shown, and a test that computed its own number would drift from the page.
 */
export const OVERVIEW_OPEN_ITEM_LIMIT = 10;

/**
 * What an Audit Manager is told about the half of their work this release does not have.
 *
 * Their landing leads with approvals and escalated Runs; the third item the plan names —
 * Results to review — cannot exist yet, and a manager who is not told that reads an
 * approvals queue as the whole of their responsibility.
 */
export const MANAGER_RESULT_REVIEW_NOTE =
  'A finished test cannot yet be sent to you for approval or finalization. What a person can do today is confirm the agent’s own assessments on the Run itself, which is what Reviews lists.';

/** Where a manager goes for the whole queue. */
export const REVIEWS_LINK = 'Open Reviews';
