import type { ProcedureVersionState } from '@intellifin/domain';

import { countNoun } from '../../design/words';

/**
 * The Procedures list's own sentences (UI cleanup 2026-09-22, UX-03 and UX-04).
 *
 * Not `copy.ts`: those strings are quotations from the UX contract. These are the
 * platform's own words for a surface the contract describes and does not write out, and
 * `procedures-list-words.test.ts` pins them — the `run-start-words.ts` rule, so a sentence
 * retyped in a component or a browser spec fails rather than drifting.
 *
 * The findings this module exists for. The owner met a Procedures page 6,497 pixels tall
 * with no search, no filter and no paging — every Procedure the deployment holds, as a
 * card, in one scroll — and every card repeating the same two sentences about a scheduler
 * that does not exist. A list a person cannot narrow is a list they stop reading, and a
 * sentence said once per card is a sentence nobody reads by the third one.
 */

/** The page's title and its one-line explanation. */
export const PROCEDURES_TITLE = 'Procedures';
export const PROCEDURES_LEDE =
  'The controls this environment tests, with the version a Run would use and how the last Run of each ended.';

/**
 * The availability note, said ONCE for the whole list (UX-04).
 *
 * It used to be two cells on every card — "Not scheduled" and "Runs start by hand in this
 * release; no Run is scheduled." — so a page of twenty Procedures said the same thing
 * forty times. Both sentences are still `copy.ts`'s and `last-run-words.ts`'s and are
 * still rendered; they are rendered once, above the list, where a reader meets them
 * before the cards rather than inside each one.
 */
export const SCHEDULE_NOTE_HEADING = 'Nothing here runs on its own';

/**
 * The second half of the note, which names what a card's Schedule cell will say.
 *
 * It takes the contract's absent sentence rather than restating it: `PROCEDURE_CARD_ABSENT`
 * lives in `copy.ts` and is pinned against EXPERIENCE.md on disk, so a copy here would be
 * the retyped-sentence defect in the module whose whole job is to prevent it.
 */
export function scheduleNoteHint(absentSchedule: string): string {
  return `A card names the frequency its Active version froze; one that froze none says “${absentSchedule}”.`;
}

/** What a card says about the frequency the Active version froze. */
export const PLANNED_PREFIX = 'Planned:';
export const PLANNED_NOT_SCHEDULED_SUFFIX = 'not scheduled by the platform';

/**
 * A card's frequency line.
 *
 * A frozen frequency is a PLAN, never a promise: EXPERIENCE.md's own decision is that
 * "frequency is a planned frequency until a scheduler exists", so the words that follow it
 * say what the platform will not do. A Procedure with no Active version, or one whose
 * Active version froze no Schedule, gets the contract's `Not scheduled` instead — which is
 * `PROCEDURE_CARD_ABSENT.schedule` and stays in `copy.ts`.
 */
export function plannedFrequencySentence(frequency: string): string {
  return `${PLANNED_PREFIX} ${frequency} · ${PLANNED_NOT_SCHEDULED_SUFFIX}`;
}

/* -------------------------------------------------------------- the filters --- */

/** The filter form's landmark, its controls and its two actions. */
export const FILTERS_LABEL = 'Find a Procedure';
export const SEARCH_LABEL = 'Search by name or Template';
export const SEARCH_HINT = 'Part of the control name, or a Template such as P-1.';
export const STATE_LABEL = 'Newest version';
export const STATE_ANY = 'Any state';
export const OWNER_LABEL = 'Accountable for the newest version';
export const OWNER_ANY = 'Anyone';
export const APPLY_FILTERS = 'Apply';
export const CLEAR_FILTERS = 'Clear';

/**
 * The query-string keys, named once.
 *
 * The form is a `<form method="get">` — the ONE exception to this product's POST rule,
 * because a filter mutates nothing, works with no JavaScript, is bookmarkable and is what
 * the browser's own back button restores. Its field names and the page's `searchParams`
 * keys are therefore the same strings, and naming them twice is how they come apart.
 */
export const FILTER_KEYS = {
  search: 'q',
  state: 'state',
  owner: 'owner',
  page: 'page',
} as const;

/** How each version state reads in the filter. The badge beside a card carries the word. */
export const STATE_FILTER_WORDS: Readonly<Record<ProcedureVersionState, string>> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ACTIVE: 'Active',
  RETIRED: 'Retired',
};

/* ---------------------------------------------------------- what is counted --- */

/**
 * How many the filter matched, and how many there are altogether.
 *
 * Both numbers are EXACT and come from their own `count(*)`, never from the length of a
 * bounded page — a list that said "20 Procedures" because twenty is what fits would be
 * this product's own empty-state defect wearing a number.
 */
export function matchedSentence(matched: number, everything: number): string {
  if (matched === everything) return `${countNoun(everything, 'Procedure')}.`;
  return `${countNoun(matched, 'Procedure')} of ${everything.toLocaleString('en-US')}.`;
}

/** Which page of the results this is, said in words rather than as a bare number. */
export function pageSentence(from: number, to: number, total: number): string {
  return `Showing ${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}.`;
}

export const OLDER_PAGE = 'Previous page';
export const NEWER_PAGE = 'Next page';
export const PAGINATION_LABEL = 'Procedure pages';

/* -------------------------------------------------------------- empty states --- */

/** Nothing at all in the deployment. The one way onward is authoring, and it is a link. */
export const PROCEDURES_EMPTY = {
  headline: 'No Procedures yet.',
  sentence:
    'A Procedure and its versions would be listed here, each created from a Template. An empty list does not mean a control passed; it means nothing can be approved, scheduled, or run.',
} as const;

/**
 * Procedures exist and the filter matched none.
 *
 * A different statement from an empty deployment, and it must not read as one: the reader
 * narrowed the list themselves and the remedy is theirs.
 */
export const PROCEDURES_NO_MATCH = {
  headline: 'No Procedure matches this search.',
  sentence:
    'Change the search text, the version state or the person accountable, or clear the filters to see every Procedure. A filtered list saying nothing does not mean a control passed.',
} as const;

/** The card's own labels. */
export const CARD_ACTIVE_VERSION = 'Active version';
export const CARD_NEWEST_VERSION = 'Newest version';
export const CARD_LAST_OUTCOME = 'Last outcome';
export const CARD_SCHEDULE = 'Schedule';
export const CARD_OWNER = 'Accountable';
export const NEW_PROCEDURE = 'New procedure';
