import type { RunState } from './run.js';

/**
 * The System Outcome (addendum §E.1), as an ordered table and one pure decision
 * (Story 3.9).
 *
 * Pure. No I/O, no clock, no host types. Everything here decides MEANING; the one
 * transactional command that computes it exactly once and seals the Result is
 * `packages/application/src/runs/complete-run.ts`.
 *
 * **The rows apply IN ORDER and the first matching row wins.** That sentence is the
 * contract, and it is the reason this is an array of predicates rather than a chain of
 * conditionals somebody can reorder without noticing: a Gate failure on a Run that also
 * raised an Exception is `INCONCLUSIVE`, not `CONTROL_FAILURE`, and the only thing that
 * makes it so is that the Gate row sits above the Control Failure row.
 *
 * **All seven rows are here even though this epic can reach only five.** Epic 3 produces
 * evaluations of origin `RULE` only, so no evaluation is ever `pending` and the Pending
 * Confirmation row cannot fire; the `COMPLETED → INCONCLUSIVE` row fires "by human
 * rejection", which is Epic 6. Both are written, ordered and tested with a constructed
 * state anyway — the whole §E vocabulary landed at once for `procedure_version.state` and
 * for `GATE_CHECKS` for the same reason. A table that grows one row per epic ends up not
 * being a table.
 *
 * **A passed Gate is necessary and never sufficient for Pass.** The Gate asks whether the
 * Evidence supports a conclusion; the outcome asks what that conclusion is. Deriving
 * either from the other — reading "the Gate passed" out of the absence of an Exception, or
 * reading "no Exception" out of a passing Gate — is the mistake this module exists to
 * prevent, so `gatePassed` is a fact READ from the Gate rows Story 3.8 wrote and the
 * evaluation counts are facts read from the evaluation rows Story 3.7 wrote.
 */

/**
 * Every outcome §E.1 can produce, as a closed vocabulary.
 *
 * Three of them (`CANCELED`, `RUN_FAILED`, `INCONCLUSIVE`) are also Run states, because
 * the addendum's own cells say "(Run state)": for those rows the outcome IS what happened
 * to the Run. `PASS`, `CONTROL_FAILURE` and `PENDING_CONFIRMATION` are outcomes of a
 * `COMPLETED` Run and exist nowhere else.
 */
export const SYSTEM_OUTCOMES = [
  'CANCELED',
  'RUN_FAILED',
  'INCONCLUSIVE',
  'PENDING_CONFIRMATION',
  'CONTROL_FAILURE',
  'PASS',
] as const;
export type SystemOutcome = (typeof SYSTEM_OUTCOMES)[number];

export function isSystemOutcome(value: unknown): value is SystemOutcome {
  return typeof value === 'string' && (SYSTEM_OUTCOMES as readonly string[]).includes(value);
}

/** The §E.1 rows, named. The id is stored on the Result, so the row that decided is known. */
export const OUTCOME_ROW_IDS = [
  'canceled',
  'run-failed',
  'gate-failed',
  'pending-confirmation',
  'unevaluated',
  'control-failure',
  'pass',
] as const;
export type OutcomeRowId = (typeof OUTCOME_ROW_IDS)[number];

export function isOutcomeRowId(value: unknown): value is OutcomeRowId {
  return typeof value === 'string' && (OUTCOME_ROW_IDS as readonly string[]).includes(value);
}

/**
 * The facts one §E.1 row is decided on.
 *
 * Counts rather than booleans, because the Result reports them and a Result that said
 * "there were Exceptions" without saying how many is a Result nobody can act on. Every one
 * of them is READ from what an earlier story recorded; none is inferred from another.
 */
export interface OutcomeFacts {
  /** The terminal state this transition is committing. */
  readonly runState: RunState;
  /**
   * Did every addendum §H row pass?
   *
   * Read from the Gate rows Story 3.8 wrote, never inferred. A Run that never REACHED the
   * Gate — one stopped by a limit, a denial or a Session Step failure — has no rows, and
   * an unrun Gate is not a passed Gate: that is the same fail-closed reading
   * `snapshot-generation-unknown` takes, and the alternative is a Pass for want of a fact.
   */
  readonly gatePassed: boolean;
  /** Agent-Judged evaluations still awaiting a human decision (`confirmation = pending`). */
  readonly pending: number;
  /** Condition evaluations whose value is `UNEVALUATED`, whatever their origin. */
  readonly unevaluated: number;
  /** Exceptions counting toward the outcome. Every Exception counts until Epic 6. */
  readonly exceptions: number;
}

export interface OutcomeRow {
  readonly id: OutcomeRowId;
  /** §E.1's first cell, transcribed. */
  readonly evidenceState: string;
  /** §E.1's second cell, transcribed. */
  readonly evaluationState: string;
  readonly outcome: SystemOutcome;
  /**
   * Is a Result carrying this outcome final?
   *
   * True everywhere except `PENDING_CONFIRMATION`, which §E.1 itself marks "(unsealed)"
   * and which is the ONE outcome that is waiting for something. §E's sentence — "a Result
   * seals when the Evidence Quality Gate has passed and no condition evaluation is
   * pending" — describes the `COMPLETED` path, the only path on which sealing is a
   * decision rather than a consequence; a Canceled, Run Failed or Gate-failed Run has
   * nothing left to decide and its outcome can never change either. Calling those
   * unsealed would say the opposite, and the immutability trigger keys on this flag.
   */
  readonly sealed: boolean;
  /** §E.1's fourth cell, transcribed: what a human may do next. */
  readonly humanAction: string;
  readonly matches: (facts: OutcomeFacts) => boolean;
}

/**
 * The addendum §E.1 table, in the addendum's own order.
 *
 * `tests/unit/outcome-rules.test.ts` reads §E.1 OFF DISK and compares the outcomes and the
 * permitted human actions row by row. A table asserted against a copy of itself proves
 * only that it equals itself, and this one decides what an audit Run concluded.
 */
export const OUTCOME_ROWS: readonly OutcomeRow[] = [
  {
    id: 'canceled',
    evidenceState: 'Run canceled',
    evaluationState: 'Not completed',
    outcome: 'CANCELED',
    sealed: true,
    humanAction: 'Request a new Run; cannot submit',
    matches: (facts) => facts.runState === 'CANCELED',
  },
  {
    id: 'run-failed',
    evidenceState: 'Run-level failure after bounded retries, or denied action',
    evaluationState: 'Not completed',
    outcome: 'RUN_FAILED',
    sealed: true,
    humanAction: 'Diagnose and request a new Run; cannot submit',
    matches: (facts) => facts.runState === 'RUN_FAILED',
  },
  {
    // Two ways in, and §E.1 names both in the one cell: a §H row failed, or a Pause or an
    // Escalation timed out — which §E maps to `INCONCLUSIVE` with no Gate failure at all.
    // So the predicate is the Run state OR the Gate, not the Gate alone.
    id: 'gate-failed',
    evidenceState:
      'Evidence Quality Gate fails (coverage, count, corroboration, absence, schema, freshness, ambiguity, unnamed value, missing evaluation for an applicable condition); or Pause or Escalation timed out',
    evaluationState: 'Not authoritative',
    outcome: 'INCONCLUSIVE',
    sealed: true,
    humanAction: 'Diagnose and request a new Run; cannot submit',
    matches: (facts) => facts.runState === 'INCONCLUSIVE' || !facts.gatePassed,
  },
  {
    id: 'pending-confirmation',
    evidenceState: 'Gate passes',
    evaluationState: 'Any Agent-Judged evaluation `pending`',
    outcome: 'PENDING_CONFIRMATION',
    sealed: false,
    humanAction: 'Confirm or reject each; cannot submit',
    matches: (facts) => facts.pending > 0,
  },
  {
    // §E.1's parenthetical "(by human rejection)" names the PROVENANCE this row was
    // written for — every other way a condition ends up `UNEVALUATED` is caught by a §H
    // row above — and it is deliberately NOT part of the predicate. Made one, an
    // `UNEVALUATED` of any other origin would match no row at all and fall through to
    // Pass, whose own cell requires "every condition on every record Compliant". A table
    // with a hole in it is worse than a table with a wide row: "Excluded, uninspected and
    // Unevaluated records are never counted Compliant" is the rule, and this keeps it.
    id: 'unevaluated',
    evidenceState: 'Gate passes, sealed',
    evaluationState: 'Any condition on any record `UNEVALUATED` (by human rejection) and no Exception counts',
    outcome: 'INCONCLUSIVE',
    sealed: true,
    humanAction: 'Diagnose and request a new Run; cannot submit',
    matches: (facts) => facts.unevaluated > 0 && facts.exceptions === 0,
  },
  {
    id: 'control-failure',
    evidenceState: 'Gate passes, sealed',
    evaluationState: 'Any Exception counts toward the outcome',
    outcome: 'CONTROL_FAILURE',
    sealed: true,
    humanAction: 'Disposition Exceptions, approve, reject, or record disagreement',
    matches: (facts) => facts.exceptions > 0,
  },
  {
    id: 'pass',
    evidenceState: 'Gate passes, sealed',
    evaluationState: 'Every condition on every record Compliant',
    outcome: 'PASS',
    sealed: true,
    humanAction: 'Approve, reject with rationale, or record disagreement',
    matches: (facts) => facts.exceptions === 0 && facts.unevaluated === 0 && facts.pending === 0,
  },
];

export interface OutcomeDecision {
  readonly row: OutcomeRowId;
  readonly outcome: SystemOutcome;
  readonly sealed: boolean;
  /** The Run state this outcome implies, which is the state row 5 moves a Run to. */
  readonly runState: RunState;
}

/**
 * Apply §E.1 in order and take the FIRST matching row.
 *
 * `Array.prototype.find`, never an object index: the rows are ordered data and the order
 * is the whole contract. It is also why there is no lookup keyed by anything a caller
 * supplies — `TABLE['constructor']` returning an inherited function has bitten this
 * repository six times, and a table walked in order cannot be reached that way at all.
 *
 * The returned `runState` is the Run state the outcome implies. It differs from the state
 * handed in for exactly one row: §E's `COMPLETED → INCONCLUSIVE`, "only at Result sealing,
 * when a human rejection leaves a condition Unevaluated". Everywhere else it is the state
 * the caller was already committing.
 */
export function systemOutcome(facts: OutcomeFacts): OutcomeDecision {
  const row = OUTCOME_ROWS.find((candidate) => candidate.matches(facts));
  // Unreachable: rows 5, 6 and 7 partition (any Exception) × (any Unevaluated) once rows
  // 1 to 4 have not matched, and rows 1 to 3 cover every terminal state but `COMPLETED`.
  // It is written as a refusal rather than a fallback because a Result with no row is a
  // Result nobody can explain, and a default here would quietly become the eighth row.
  if (row === undefined) throw new UnmatchedOutcomeError(facts);
  return {
    row: row.id,
    outcome: row.outcome,
    sealed: row.sealed,
    // The outcomes that are also Run states name the state; the three that are not leave
    // the Run where the Gate put it.
    runState:
      row.outcome === 'CANCELED' || row.outcome === 'RUN_FAILED' || row.outcome === 'INCONCLUSIVE'
        ? row.outcome
        : facts.runState,
  };
}

export class UnmatchedOutcomeError extends Error {
  override readonly name = 'UnmatchedOutcomeError';
  readonly facts: OutcomeFacts;

  constructor(facts: OutcomeFacts) {
    super('No addendum E.1 row matches the Run facts');
    this.facts = facts;
  }
}
