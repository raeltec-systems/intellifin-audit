import type { ProcedureLastRun } from '@intellifin/infrastructure';

import { runIsActive } from '../runs/labels';

/**
 * What a Procedure card says about running (owner finding RUN-05, 2026-09-16).
 *
 * The card's four UX-DR7 cells were four ABSENT sentences with nothing behind them, which
 * was true when no Run could exist and became false the day one could: a Procedure with a
 * Run on the register showed "No Runs yet" under Next Run and "No outcome" under Last
 * outcome. Two different defects in one card — a claim about HISTORY used to describe the
 * FUTURE, and a Run that issued no conclusion reported as no Run at all.
 *
 * `PROCEDURE_CARD_ABSENT` in `copy.ts` still supplies the two cells that really are absent
 * (no Active version, no Schedule), and it stays pinned to EXPERIENCE.md. These are the
 * platform's own sentences for the two cells that now have facts behind them.
 */

/**
 * The Next Run cell.
 *
 * "No Runs yet" there was a sentence about history answering a question about the future.
 * There is no scheduler — Epic 8 — and Initiate Run has been on the Procedure page since
 * Story 3.1, so what is true is that a person starts a Run and nothing else does.
 */
export const NEXT_RUN_MANUAL = 'Runs start by hand in this release; no Run is scheduled.';

/**
 * The Last outcome cell when this Procedure has never run.
 *
 * Distinct from "No conclusion issued", which is what a Run that RAN and concluded nothing
 * says: nothing has been executed is a different fact from nothing has been concluded, and
 * an auditor does a different thing about each.
 */
export const NO_RUN_YET = 'No Run has been started.';

/**
 * The Last outcome cell for a role that may not see Runs.
 *
 * The Runs register is gated on `run.initiate` and this list is not, so a PoC
 * Administrator reads this page and `/runs` refuses them. A card that simply showed the
 * absent sentence would tell that reader a Procedure has never run, which may be false;
 * one that showed the outcome would hand them what the register withholds. It says which
 * of the two is happening.
 */
export const LAST_RUN_NOT_VISIBLE = 'Your role does not see Runs, so this Run is not shown.';

/** The card's way onward to the Run the cell is describing. */
export const OPEN_LAST_RUN = 'Open this Run';

/** When the last Run started, or when it ended — never one word for both. */
export const LAST_RUN_STARTED = 'Started';
export const LAST_RUN_ENDED = 'Ended';

export interface LastRunTiming {
  /** `Started` while the Run is in flight, `Ended` once it has concluded. */
  readonly word: typeof LAST_RUN_STARTED | typeof LAST_RUN_ENDED;
  /** The instant that word refers to, ISO 8601 UTC. */
  readonly at: string;
}

/**
 * Which instant the card shows, and what to call it.
 *
 * A Run still in flight has no end, so the only instant it has is when somebody started
 * it. A terminal Run is described by when it finished — that is the fact an auditor
 * compares against the period — and it falls back to the start when the Result recorded no
 * sealing time, because a missing instant must not silently become the wrong one.
 *
 * `runIsActive` is the domain's own list through `labels.ts`, so a state added there
 * reaches this decision instead of being read as terminal by default.
 */
export function lastRunTiming(run: ProcedureLastRun): LastRunTiming {
  if (runIsActive(run.state) || run.endedAt === null) {
    return { word: LAST_RUN_STARTED, at: run.initiatedAt };
  }
  return { word: LAST_RUN_ENDED, at: run.endedAt };
}
