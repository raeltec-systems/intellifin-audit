import { describe, expect, it } from 'vitest';
import {
  OUTCOME_ROWS,
  OUTCOME_ROW_IDS,
  SYSTEM_OUTCOMES,
  UnmatchedOutcomeError,
  isOutcomeRowId,
  isSystemOutcome,
  systemOutcome,
  type OutcomeFacts,
} from './outcome.js';

/**
 * The addendum §E.1 table, applied in order.
 *
 * `tests/unit/outcome-rules.test.ts` compares the table with the addendum ON DISK; this
 * file exercises the decision it makes, including the two rows Epic 3 cannot reach and the
 * orderings that are the whole contract.
 */

/** A Run that concluded cleanly: nothing pending, nothing unevaluated, no Exception. */
const CLEAN: OutcomeFacts = {
  runState: 'COMPLETED',
  gatePassed: true,
  pending: 0,
  unevaluated: 0,
  exceptions: 0,
};

describe('the §E.1 outcome table', () => {
  it('has one row per id, in order, and every outcome is in the vocabulary', () => {
    expect(OUTCOME_ROWS.map((row) => row.id)).toEqual([...OUTCOME_ROW_IDS]);
    for (const row of OUTCOME_ROWS) {
      expect(SYSTEM_OUTCOMES).toContain(row.outcome);
      expect(row.evidenceState).not.toBe('');
      expect(row.evaluationState).not.toBe('');
      expect(row.humanAction).not.toBe('');
    }
    expect(isOutcomeRowId('pass')).toBe(true);
    expect(isOutcomeRowId('constructor')).toBe(false);
    expect(isSystemOutcome('PASS')).toBe(true);
    expect(isSystemOutcome('toString')).toBe(false);
  });

  it('gives a clean COMPLETED Run a sealed Pass', () => {
    expect(systemOutcome(CLEAN)).toEqual({
      row: 'pass',
      outcome: 'PASS',
      sealed: true,
      runState: 'COMPLETED',
    });
  });

  it('gives Canceled and Run Failed the top two rows, whatever else is true', () => {
    // Rows 1 and 2 are above everything: a canceled Run with a passing Gate and a clean
    // evaluation is still Canceled, and a Run Failed one with an Exception is still Run
    // Failed. Neither may be reported as a conclusion about the control.
    expect(systemOutcome({ ...CLEAN, runState: 'CANCELED' })).toMatchObject({
      row: 'canceled',
      outcome: 'CANCELED',
      runState: 'CANCELED',
    });
    expect(
      systemOutcome({ ...CLEAN, runState: 'RUN_FAILED', exceptions: 3 }),
    ).toMatchObject({ row: 'run-failed', outcome: 'RUN_FAILED' });
  });

  it('puts the Gate row ABOVE Control Failure, so a failed Gate wins', () => {
    // The ordering this story exists to protect. Both rows match — the Gate failed and an
    // Exception counts — and the earlier one wins, because §E.1's Gate row says the
    // evaluation state is "Not authoritative": a control failure raised on Evidence that
    // did not pass its own quality Gate is a finding about nothing.
    const facts: OutcomeFacts = { ...CLEAN, gatePassed: false, exceptions: 2 };
    expect(OUTCOME_ROWS.filter((row) => row.matches(facts)).map((row) => row.id)).toEqual([
      'gate-failed',
      'control-failure',
    ]);
    expect(systemOutcome(facts)).toMatchObject({
      row: 'gate-failed',
      outcome: 'INCONCLUSIVE',
      runState: 'INCONCLUSIVE',
    });
  });

  it('never passes a Run whose Gate did not pass, however clean its evaluations', () => {
    // A passed Gate is NECESSARY and never sufficient, and this is the other direction:
    // no Exception and nothing unevaluated must not become a Pass on its own.
    expect(systemOutcome({ ...CLEAN, gatePassed: false })).toMatchObject({
      row: 'gate-failed',
      outcome: 'INCONCLUSIVE',
    });
  });

  it('treats a Run that never reached the Gate as one that did not pass it', () => {
    // A Run stopped by a limit has no Gate rows at all. An unrun Gate is not a passed
    // Gate: the fail-closed reading, and the same one `snapshot-generation-unknown` takes.
    expect(systemOutcome({ ...CLEAN, runState: 'INCONCLUSIVE', gatePassed: false })).toMatchObject({
      row: 'gate-failed',
      outcome: 'INCONCLUSIVE',
    });
  });

  it('reports Inconclusive for a Run that timed out, even with every Gate row passing', () => {
    // §E.1's Gate row names TWO ways in: "Evidence Quality Gate fails …; or Pause or
    // Escalation timed out". §E maps both of those timeouts to INCONCLUSIVE with no Gate
    // failure at all, so the row cannot be the Gate alone — a Run whose state is already
    // INCONCLUSIVE must never fall through to Pass because its Gate rows happened to pass.
    expect(systemOutcome({ ...CLEAN, runState: 'INCONCLUSIVE', gatePassed: true })).toMatchObject({
      row: 'gate-failed',
      outcome: 'INCONCLUSIVE',
      runState: 'INCONCLUSIVE',
    });
  });

  it('reports Pending Confirmation, unsealed, above every sealing row', () => {
    // Epic 3 cannot reach this row — it produces evaluations of origin RULE only — so the
    // state is constructed. It is above the sealing rows because §E.1 puts it there: a
    // Result cannot seal while a human decision it is waiting for has not been made.
    const facts: OutcomeFacts = { ...CLEAN, pending: 1, exceptions: 4, unevaluated: 2 };
    expect(systemOutcome(facts)).toEqual({
      row: 'pending-confirmation',
      outcome: 'PENDING_CONFIRMATION',
      sealed: false,
      runState: 'COMPLETED',
    });
  });

  it('moves a COMPLETED Run to INCONCLUSIVE when a condition is left Unevaluated', () => {
    // §E's `COMPLETED → INCONCLUSIVE`, "only at Result sealing". The Run state the caller
    // was committing is COMPLETED and the decision changes it.
    expect(systemOutcome({ ...CLEAN, unevaluated: 1 })).toEqual({
      row: 'unevaluated',
      outcome: 'INCONCLUSIVE',
      sealed: true,
      runState: 'INCONCLUSIVE',
    });
  });

  it('reports Control Failure when an Exception counts, and lists Unevaluated beside it', () => {
    // Row 5 requires "no Exception counts", so an Exception outranks an Unevaluated record
    // rather than hiding it: §E.1's own cell is "Control Failure, with any Unevaluated
    // records listed", and the listing is the Result's, not the outcome's.
    expect(systemOutcome({ ...CLEAN, exceptions: 1, unevaluated: 5 })).toMatchObject({
      row: 'control-failure',
      outcome: 'CONTROL_FAILURE',
      sealed: true,
      runState: 'COMPLETED',
    });
  });

  it('seals every outcome except Pending Confirmation', () => {
    for (const row of OUTCOME_ROWS) {
      expect(row.sealed).toBe(row.outcome !== 'PENDING_CONFIRMATION');
    }
  });

  it('matches a row for every combination of the facts it is decided on', () => {
    // The table has to be TOTAL. A combination matching no row would be a Run with an
    // outcome nobody can name — and the tempting repair, a default, is an eighth row
    // nobody wrote down.
    for (const runState of ['COMPLETED', 'INCONCLUSIVE', 'RUN_FAILED', 'CANCELED'] as const) {
      for (const gatePassed of [true, false]) {
        for (const pending of [0, 1]) {
          for (const unevaluated of [0, 1]) {
            for (const exceptions of [0, 1]) {
              const decision = systemOutcome({ runState, gatePassed, pending, unevaluated, exceptions });
              expect(SYSTEM_OUTCOMES).toContain(decision.outcome);
              // Nothing but a clean, Gate-passed, fully Compliant Run is ever a Pass.
              if (decision.outcome === 'PASS') {
                expect({ runState, gatePassed, pending, unevaluated, exceptions }).toEqual({
                  runState: 'COMPLETED', gatePassed: true, pending: 0, unevaluated: 0, exceptions: 0,
                });
              }
            }
          }
        }
      }
    }
  });

  it('refuses rather than inventing a row when nothing matches', () => {
    // Unreachable through `systemOutcome`'s own inputs, which is exactly why it is pinned:
    // a branch nothing exercises is a branch that can be inverted silently. The rows are
    // emptied so the walk finds nothing.
    const rows = OUTCOME_ROWS as unknown as { matches: (facts: OutcomeFacts) => boolean }[];
    const saved = rows.map((row) => row.matches);
    for (const row of rows) row.matches = () => false;
    try {
      expect(() => systemOutcome(CLEAN)).toThrow(UnmatchedOutcomeError);
    } finally {
      for (const [index, row] of rows.entries()) row.matches = saved[index]!;
    }
    expect(systemOutcome(CLEAN).outcome).toBe('PASS');
  });
});
