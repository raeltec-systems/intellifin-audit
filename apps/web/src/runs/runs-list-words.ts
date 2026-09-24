import { STATUS_COLUMN_WORDS } from '../design/status-words';

/**
 * The Runs register's own sentences (UI cleanup 2026-09-22, UX-17).
 *
 * Not `copy.ts`: those strings are quotations from the UX contract, pinned against
 * EXPERIENCE.md on disk. These are the platform's own words for the register, and
 * `runs-list-words.test.ts` pins them — the `run-start-words.ts` rule, so a sentence
 * retyped in a component or a browser spec fails rather than drifting.
 *
 * The finding: ten columns, a raw UUID as the row's own name, and a table wide enough to
 * scroll the WHOLE PAGE sideways at a laptop's width. EXPERIENCE.md's revised Data tables
 * row now fixes six — "Run (the Procedure name, with the short reference and the effective
 * period beneath it) · Execution · Assessment · Evidence checks · Started (by whom, when,
 * and elapsed) · Change" — and adds the Review column back when Result review exists.
 */

/** The page's title and its one-line explanation. */
export const RUNS_TITLE = 'Runs';
export const RUNS_LEDE =
  'Every Run, newest first: what it tested, how it ended, and whether its evidence can be relied on.';

/** The six column headers, in the contract's order. Three of them are the status questions. */
export const RUNS_COLUMNS = {
  run: 'Run',
  execution: STATUS_COLUMN_WORDS.execution,
  assessment: STATUS_COLUMN_WORDS.assessment,
  evidenceChecks: STATUS_COLUMN_WORDS.evidenceChecks,
  started: 'Started',
  change: 'Change',
} as const;

/** The order the table renders them in, which is the contract's. */
export const RUNS_COLUMN_ORDER = [
  'run',
  'execution',
  'assessment',
  'evidenceChecks',
  'started',
  'change',
] as const;

/**
 * The caption, which says what the table holds AND what it deliberately no longer holds.
 *
 * The Review column is gone until a Result can be submitted for review — this release
 * cannot submit one, so every cell of it said the same absent sentence and spent a whole
 * column of a table that already scrolled the page sideways. A column silently removed is
 * a reader wondering where it went, so the caption says it, once, where assistive
 * technology reads it before the rows.
 */
export const RUNS_CAPTION =
  'Runs, newest first: the Procedure each one tested, how it ended, what it concluded, whether its evidence checks passed, who started it and what changed since the previous Run. A Review column joins this table when a Result can be sent for review; this release cannot send one.';

/** Who started a Run, and how long it took. */
export const STARTED_BY = 'by';
export const ELAPSED = 'took';

/** What the Started cell says when a Run is still going. */
export const STILL_RUNNING = 'so far';
