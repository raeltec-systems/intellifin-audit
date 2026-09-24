/**
 * The Result, Exception and Gate surfaces' own sentences (UI cleanup 2026-09-22, UX-19,
 * UX-20, UX-21).
 *
 * PLATFORM words, not contract quotations. EXPERIENCE.md's UI cleanup section fixes the
 * ORDER a completed test reads in ("conclusion first: outcome, affected records, coverage
 * and the next action; then review history and successful checks, collapsed; then
 * technical evidence") and what a finding must carry ("A finding names the person or
 * account with its business reference, states expected against actual, and links in one
 * click to its record's evidence, capture and Replay"); it does not write the words. They
 * live here, free of React, because the components and the browser specs both read them —
 * the `run-start-words.ts` rule: a sentence retyped in a test is pinned against nothing.
 */

export const RESULT_WORDS = {
  /** The sealed Result's decisions, out of the way of the conclusion they produced. */
  reviewHistory: 'Review history',
  runDetails: 'About this test run',
  unreadableDocument:
    'The outcome, the seal and the Result version above are stored columns and are what this Run concluded. The published document beside them was written in a shape this build does not read, so its counts are not shown rather than shown wrongly.',
  /** The Gate, in the three questions' own words rather than as a table name. */
  gateHeading: 'Evidence checks',
  passedChecks: 'Checks that passed',
  /** Said once, above the artifact list, instead of thirty-one rows a reader scrolls past. */
  evidencePackage: 'Evidence this Run froze',
} as const;

export const EXCEPTION_WORDS = {
  /** What an Exception's own section is called above the failed criterion. */
  failedCriterion: 'Why this record is an Exception',
  expected: 'Expected',
  observed: 'Observed',
  /** The two one-click links EXPERIENCE.md asks a finding to carry. */
  openEvidence: 'Open this record’s evidence',
  openReplay: 'Watch this record in Replay',
  /** A record whose captured value this Run did not retain under the failed criterion. */
  noObservedValue: 'This Run recorded no captured value for the field this criterion reads.',
  /** A criterion whose own expectation cannot be stated in a sentence. */
  noExpectedValue: 'The criterion is shown as it was approved; it states no single expected value.',
  /** The immutable set, said as what it is rather than as "Original Exception conditions". */
  originalConditions: 'The criteria this finding was raised under',
  currentConditions: 'The criteria that still make this record an Exception',
  noCurrentConditions:
    'No current assessment is an Exception. This finding is retained as history and does not count toward the current conclusion.',
} as const;

/**
 * A rule sentence with its specification reference taken out of ordinary prose (UX-20).
 *
 * `GATE_ROW_CONTRACTS` is a TRANSCRIPTION of addendum §H and `gate-rows.test.ts` reads the
 * addendum off disk to pin both cells of all twenty rows — so the constant may not be
 * edited. What changes is what a reader meets: the ordinary line drops the trailing
 * `(§C)` / `(§B)` citation, and the exact §H sentence stays under Technical details, where
 * an auditor checking the checklist against the contract can still find it.
 *
 * Only a PARENTHESISED reference is removed, and only a whole one: a rule whose prose
 * genuinely contains a section symbol keeps it rather than being silently truncated.
 */
const SPEC_REFERENCE = /\s*\((?:§[A-Z](?:\.\d+)?|addendum[^()]*|FR-\d+)\)/gu;

export function withoutSpecReference(rule: string): string {
  return rule.replace(SPEC_REFERENCE, '').trim();
}
