/**
 * How a Run is started, said once.
 *
 * Nothing in this build runs a Procedure by itself: scheduled execution is Epic 8 and
 * does not exist. A Run starts when an auditor presses Initiate Run on the Procedure
 * page and confirms, and it is queued at once. The owner could not find that (2026-09-15):
 * the Schedule step demanded a "Start time (UTC)" even for a one-time Procedure, which
 * reads as "this is when it will run", and nothing in the Builder pointed at the box
 * that actually starts one.
 *
 * Three surfaces now say the same two things — the Schedule step, the Review step and
 * the Active version card — and the Initiate Run box says the third. They read the
 * sentences from here so a rewording lands on all of them at once, and
 * `run-start-words.test.ts` refuses a retyped copy. These are the platform's own words,
 * not quotations from the UX contract, which is why they are not in `copy.ts`.
 */

/** What the Initiate Run box promises, and what the links to it repeat. */
export const RUN_STARTS_ON_CONFIRM_SENTENCE = 'The Run starts as soon as you confirm it.';

/** True until the scheduler exists; change it in the story that builds one. */
export const NO_AUTOMATIC_RUNS_SENTENCE = 'Nothing runs by itself yet.';

/** What the Schedule step says under the start time, so the time is not read as a start. */
export const SCHEDULE_TIME_STARTS_NOTHING_SENTENCE =
  'The saved time does not start a Run. Runs are started by hand from the Procedure page.';

/** The link on an Active version card. */
export const START_RUN_LINK_LABEL = 'Start a Run now';

/** The `id` of the Initiate Run box; every link to it is built by `initiateRunHref`. */
export const INITIATE_RUN_ANCHOR = 'initiate-run';

/**
 * A link to the Initiate Run box, optionally carrying the dates to fill in.
 *
 * A one-time version carries its saved Period: the Builder promised "A Run you start by
 * hand tests these dates", so the box opens with them and the auditor only confirms.
 * The page treats the dates as a suggestion — they fill the fields and nothing else.
 */
export function initiateRunHref(procedureId: string, period?: { readonly from: string; readonly to: string }): string {
  const query = period === undefined ? '' : `?${new URLSearchParams({ from: period.from, to: period.to }).toString()}`;
  return `/procedures/${procedureId}${query}#${INITIATE_RUN_ANCHOR}`;
}
