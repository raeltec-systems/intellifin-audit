/**
 * The Reviews area's own sentences (UI cleanup 2026-09-22, UX-30, UX-35, UX-36).
 *
 * Not `copy.ts`: those strings are quotations from the UX contract, pinned against
 * EXPERIENCE.md on disk. These are the platform's own words for a surface the contract
 * names and does not write out — `review-words.test.ts` pins them, the `run-start-words.ts`
 * rule, so a sentence retyped in a component or a browser spec fails rather than drifting.
 *
 * The findings this module exists for. `/review` was a Story 1.4 placeholder: it rendered
 * one contract empty state UNCONDITIONALLY, saying no Result awaited a decision — while a
 * Procedure Version sat SUBMITTED waiting for the very manager reading it, and while Runs
 * held unsealed Results whose evaluations needed confirming. An empty state is a statement
 * about the environment, and that one was false in two directions at once.
 */

/** The area's name, plural since the UI cleanup: it holds two queues, not one. */
export const REVIEWS_TITLE = 'Reviews';

export const REVIEWS_LEDE =
  'Work that is waiting for a decision: Procedure Versions to approve, and finished tests whose assessments need confirming.';

/** The two tabs, and the routes behind them. The sidebar link lands on Procedures. */
export const REVIEW_TABS = {
  procedures: { href: '/review', label: 'Procedures' },
  results: { href: '/review/results', label: 'Results' },
} as const;

/** What the tab set navigates, for the landmark. */
export const REVIEW_TABS_LABEL = 'Reviews';

/* ------------------------------------------------------ the Procedures tab --- */

export const PROCEDURES_TAB_HEADING = 'Procedure Versions awaiting approval';

/**
 * What a manager is being asked to do, said once above the list.
 *
 * "A different person must approve" is identity-enforced rather than role-enforced
 * (`authorApprovingOwnVersion` checks every human author), so this names the rule without
 * claiming which versions this particular manager may decide — that is decided on the
 * version's own review page, where the decision is taken.
 */
export const PROCEDURES_TAB_SENTENCE =
  'Each version was written by an auditor and sent for approval. Somebody other than its author has to approve it before any Run can use it.';

/**
 * What an AUDITOR sees on the same tab.
 *
 * They may not approve, so listing their own submitted versions under a heading about
 * approving would invite an action the page will refuse. It says what is true: the work
 * left their hands and is waiting on somebody else.
 */
export const PROCEDURES_TAB_AUDITOR_HEADING = 'Your versions waiting for an Audit Manager';
export const PROCEDURES_TAB_AUDITOR_SENTENCE =
  'You submitted these and cannot approve your own work. An Audit Manager decides next; nothing here needs anything from you.';

/** An auditor with nothing submitted. Not the contract's empty state — a different queue. */
export const PROCEDURES_TAB_AUDITOR_EMPTY = {
  headline: 'You have no version waiting for approval.',
  sentence:
    'A version you submitted would be listed here until an Audit Manager approves or rejects it. An empty list does not mean a control passed.',
} as const;

/** The way onward from one row. */
export const OPEN_VERSION_REVIEW = 'Open the version review';

/* --------------------------------------------------------- the Results tab --- */

export const RESULTS_TAB_HEADING = 'Assessments waiting for confirmation';

/**
 * What this release does NOT have, said plainly and not as an empty queue.
 *
 * EXPERIENCE.md's own list of what the cleanup does not deliver names "Result submission,
 * manager approval and finalization", and each surface has to "state its availability
 * truthfully rather than showing an ordinary empty state". A queue rendering "nothing
 * awaits your decision" would say the platform is quiet about a capability it does not
 * have — the inference every empty state in this product is worded to refuse.
 */
export const RESULT_REVIEW_UNAVAILABLE_TITLE = 'Submitting a Result for review is not available yet.';
export const RESULT_REVIEW_UNAVAILABLE_BODY =
  'A finished test cannot yet be submitted, approved or finalized as a reviewed Result. What a person can do today is confirm the agent’s own assessments on a Run, which is what the list below is.';

/** The manager's half of the same fact. Nothing to approve, because nothing can be sent. */
export const RESULT_REVIEW_MANAGER_NOTE =
  'There is nothing for an Audit Manager to approve here: no Result can be sent for approval in this release.';

/** Nothing is waiting — a real empty queue, about a capability that does exist. */
export const RESULTS_TAB_EMPTY = {
  headline: 'No assessment is waiting for you.',
  sentence:
    'A finished test whose agent-judged assessments need your confirmation would be listed here with how many are left. An empty list does not mean a control passed.',
} as const;

/** The way onward from one row: the Run's own Result tab, where the confirming happens. */
export const OPEN_RESULT = 'Open the Result';

/**
 * Where a Run's Result tab lives: `/runs/{id}` itself.
 *
 * `[REPAIRED 2026-09-22]` Both queues linked `/runs/{id}/result`, a route that does not
 * exist — the Result tab is the Run's own page (`RUN_TABS`' empty slug in `detail.tsx`),
 * so every "Open the Result" on the Overview and on Reviews answered a 404. A browser test
 * that read the link's `href` agreed with the component that wrote it; only following
 * the link could see it. One function, so the two surfaces cannot disagree again, and
 * `review-words.test.ts` pins it to the route directory on disk.
 */
export function resultTabHref(runId: string): string {
  return `/runs/${runId}`;
}

/** What a pending Result row says about when the test finished. */
export const TEST_FINISHED = 'Test finished';
export const STARTED_BY = 'Started by';

/** A bounded list that cannot show everything it counted. */
export function reviewsBounded(shown: number, total: number): string {
  return `Showing the first ${shown} of ${total}.`;
}

/** What the reads could not answer. Never rendered as an absence. */
export const PENDING_RESULTS_UNREADABLE =
  'Finished tests waiting for your confirmation could not be read, so this list may be short. Reload the page.';
export const SUBMITTED_VERSIONS_UNREADABLE =
  'Procedure Versions waiting for approval could not be read, so this list may be short. Reload the page.';

/** What the area says to a role that neither authors nor approves. */
export const REVIEWS_NOT_YOUR_QUEUE =
  'Reviews are for the people who write and approve audit procedures. Administration is open to you from the sidebar.';
