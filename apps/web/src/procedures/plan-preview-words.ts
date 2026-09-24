import { draftGapWords } from './readiness-words';

/**
 * What the executable plan preview says about the plan's state (UI cleanup 2026-09-22,
 * UX-16 and UX-02).
 *
 * It said "Re-deriving", "Cannot derive:" and "Re-derived at 2026-09-11T07:00:13Z": the
 * worker's mechanics and a machine instant, on the one fold an auditor opens to check what
 * will run. The plan is the platform's own sentence, so the surface says it is PREPARING
 * the test plan, names a gap in the draft in the Builder's own words (`draftGapWords`, the
 * readiness lines' one translation), and shows the instant through `<Timestamp>`.
 *
 * A failure reason the translation does not know is shown as it came: the platform's own
 * sentence is true, only less readable, and a blank or a guess would be worse than either.
 */
export const PLAN_PREVIEW_WORDS = {
  preparing: 'Preparing the test plan from your saved sections…',
  stillPreparing:
    'The test plan is still being prepared. Automatic checks have paused after two minutes; this does not mean preparing it failed. Reload the page to check again.',
  failedTitle: 'The test plan could not be prepared.',
  prepared: 'Test plan prepared',
  noStoredPlan: 'No test plan is stored for these saved sections.',
} as const;

/** The reason a plan could not be prepared, in the Builder's words where it is a draft gap. */
export function planFailureSentence(reason: string | null): string {
  if (reason === null || reason.trim() === '') return PLAN_PREVIEW_WORDS.noStoredPlan;
  return draftGapWords(reason) ?? reason;
}
