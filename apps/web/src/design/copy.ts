/**
 * Copy this application reproduces verbatim from the UX contract.
 *
 * It is collected in one module for one reason: `copy.test.ts` reads DESIGN.md and
 * EXPERIENCE.md off disk and checks every string here appears there character for
 * character. A sentence typed inline in a component is pinned against nothing, and the
 * repository already learned this once — `tests/unit/denial-strings.test.ts` does the
 * same job for the five refusal strings.
 *
 * A string here is a QUOTATION. Rewording one is a change to the contract, not to the code.
 */

/** DESIGN.md → Layout & Spacing. The PoC's standing disclaimer. */
export const ENVIRONMENT_RIBBON_SENTENCE =
  'Synthetic PoC environment — Population Sources and Target Systems are read-only synthetic systems. Results are not assurance conclusions.';

/**
 * EXPERIENCE.md → Per-surface states. Each entry is one EmptyState: the contract writes
 * it as a single string, and the component takes a headline and a sentence, so the split
 * point is recorded here and the test rejoins them before comparing.
 */
export const EMPTY_STATES = {
  overviewNoRuns: {
    headline: 'No Runs yet.',
    sentence:
      'No Procedure has run in this environment. An empty Overview does not mean a control passed.',
  },
  overviewNothingNeedsAttention: {
    headline: 'Nothing needs attention.',
    sentence:
      'No Result awaits confirmation or review, no Run is waiting on you, and none is Inconclusive or Run Failed. This does not imply that any control passed.',
  },
  reviewQueueEmpty: {
    headline: 'No Result awaits your decision.',
    /** Not from the contract: EXPERIENCE.md gives this surface a headline only. */
    sentence:
      'A submitted Result, its outcome, and its Evidence Quality Gate would be listed here. An empty queue does not mean a control passed.',
  },
  notificationsEmpty: {
    headline: 'No Run is waiting on you.',
    /** Not from the contract: EXPERIENCE.md gives this surface a headline only. */
    sentence:
      'A Run waiting for an answer, or one flagged to an Audit Manager, appears here with the time remaining.',
  },
} as const;

/**
 * The empty states whose FULL text is quoted from EXPERIENCE.md — headline and sentence
 * together. The other two quote only the headline, because the contract gives only a
 * headline; their sentences are ours and follow the EmptyState rule instead.
 */
export const FULLY_QUOTED_EMPTY_STATES = [
  'overviewNoRuns',
  'overviewNothingNeedsAttention',
] as const satisfies readonly (keyof typeof EMPTY_STATES)[];

/**
 * The registration-change warning, quoted from EXPERIENCE.md's "Registration change"
 * row (FR-14).
 *
 * It shipped first as a sentence typed inline in `RegistrationForm.tsx` — "This creates
 * … which an Audit Manager must approve" against the contract's "This change creates …
 * and requires approval" — and nothing noticed, because no Procedure exists in this
 * release, so the branch that renders it is unreachable and no test could read it. That
 * is the worst case for inline copy: wrong on arrival and wrong again the day it first
 * appears. `copy.test.ts` reads the row off disk.
 *
 * `{n}` is substituted, not interpolated into a retyped sentence, so the only thing
 * this file can get wrong is the number.
 */
export const REGISTRATION_CHANGE_WARNING_TEMPLATE =
  'This change creates a platform-authored draft for {n} Procedures and requires approval.';

export function registrationChangeWarning(count: number): string {
  return REGISTRATION_CHANGE_WARNING_TEMPLATE.replace('{n}', String(count));
}

/**
 * What a Procedure is told when its Population Source binding declares no expected
 * record count. Quoted from EXPERIENCE.md's Flow 1 failure line (FR-6).
 *
 * The Builder shows it in Epic 2, beside a disabled Submit. This surface shows it at
 * REGISTRATION time, which is where FR-6's "its absence is surfaced at authoring time"
 * can still be acted on: the administrator who chose `none` is the one who can go and
 * find the cover sheet. The sentence is the same one either way, so the person who reads
 * it in the Builder later recognizes it.
 */
export const DECLARED_COUNT_MISSING_SENTENCE =
  'Population Source must declare an expected record count.';

/**
 * What the surface says about a manual-upload binding (FR-6, AD-23).
 *
 * EXPERIENCE.md's "Upload with scheduled frequency" row fixes this sentence as the
 * Builder's blocker. It shipped here as an INVENTED sentence, under a doc comment
 * claiming the contract was silent about the restriction — it is not, and a surface
 * that words a rule one way while the Builder words it another teaches an administrator
 * a sentence they will never see again.
 *
 * It is stated at registration time as well as at submission because the Builder that
 * enforces it does not exist until Epic 2, and somebody registering a manual upload for
 * a weekly Schedule should not first learn the rule from a blocked Submit.
 */
export const MANUAL_UPLOAD_SENTENCE =
  'A manual upload is valid only for a `once` Schedule. Bind a versioned file or an API for weekly Runs.';
