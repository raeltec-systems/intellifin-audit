import type { VersionDecision } from '@intellifin/domain';

/**
 * How the version review surface writes a saved decision, and what it tells somebody
 * about to take one.
 *
 * The platform's own sentences, derived from what `transitionVersion` actually does —
 * not quotations from the UX contract — so they live beside the surface rather than in
 * `copy.ts`. Every claim here is checked against `decide-version.ts` in
 * `version-review-words.test.ts`, because a confirmation dialog that describes a
 * consequence the command does not have is worse than one that describes none: a person
 * presses Approve believing something the platform will not do.
 */

/**
 * A decision, in the past tense, because a decision history lists what already happened.
 *
 * `edit` is "Returned to Draft" and not "Edited": the transition it performs is
 * `REJECTED → DRAFT`, and nothing was edited at the moment it was recorded.
 */
const DECISION_WORDS: Readonly<Record<VersionDecision, string>> = {
  submit: 'Submitted for approval',
  approve: 'Approved',
  reject: 'Rejected',
  edit: 'Returned to Draft',
};

/**
 * The decisions this module writes words for.
 *
 * The table is typed `Record<VersionDecision, string>`, so a decision added to the
 * domain without words here does not COMPILE. This exists so the test can also check
 * the other direction — that the table holds nothing the domain does not have — against
 * the domain's own type read off disk, rather than against a copy of this list.
 */
export const DECISION_WORD_KEYS: readonly VersionDecision[] = Object.keys(DECISION_WORDS) as VersionDecision[];

/**
 * `Object.hasOwn`, not a plain index: the value reaches here from the stored `jsonb`
 * decision payload, so a row holding `constructor` or `toString` would otherwise inherit
 * a function from `Object.prototype` and render it where a word belongs. A value outside
 * the vocabulary keeps its stored spelling, which is honest about what the row holds and
 * never a blank. (The same rule as `roleLabelOfValue`, `kindLabel` and `sectionLabel`.)
 */
export function decisionWord(decision: string): string {
  return Object.hasOwn(DECISION_WORDS, decision)
    ? DECISION_WORDS[decision as VersionDecision]
    : decision;
}

/** What a confirmation is about: this Procedure, this version. */
export interface DecisionSubject {
  readonly controlName: string;
  readonly versionNumber: number;
  /**
   * Whether this is version 1, in which case no other version of this Procedure can
   * exist: numbers start at 1 and rise, and `PROCEDURE_VERSION_TRANSITIONS` has no edge
   * back to `SUBMITTED` from any later state. So there is no Active predecessor,
   * `regressionRequirement` answers `first-version`, and approval activates at once.
   */
  readonly firstVersion: boolean;
}

/** `Approve version 3 of Terminated user access?` — never a bare "Approve?". */
export function decisionTitle(decision: VersionDecision, label: string, subject: DecisionSubject | null): string {
  if (subject === null) return `${label}?`;
  return `${label} version ${subject.versionNumber} of ${subject.controlName}?`;
}

/**
 * What confirming does, stated from the command rather than from the button's name.
 *
 * Approval is the one decision whose outcome is not a single state.
 * `transitionVersion` compares this version's configuration — its model, its tool
 * contract, and the frozen digests of every Target System registration and the
 * Population Source binding — against the Active version's. Unchanged, or no Active
 * version at all, and the version goes straight to `ACTIVE`, which is the one state
 * `createRun` will start a Run against. Changed, and it stays `APPROVED` pending a
 * Regression Run, with no activation and no handover date (owner decision 2026-09-04).
 */
export function decisionConsequence(decision: VersionDecision, subject: DecisionSubject | null): string {
  if (decision === 'approve') {
    if (subject === null) return APPROVE_GENERIC;
    return `${APPROVE_RECORDED} ${
      subject.firstVersion
        ? `This is version 1, so nothing else is Active: version ${subject.versionNumber} becomes Active as soon as you approve it, and Runs can be started against it.`
        : `If it uses the same model, tools, Target Systems and Population Source as the Active version, version ${subject.versionNumber} becomes Active as soon as you approve it and Runs can be started against it. If any of those changed, it stays Approved until a Regression Run and no handover date is set.`
    }`;
  }
  if (decision === 'reject') {
    return subject === null
      ? REJECT_GENERIC
      : `Your rationale is recorded against your name and version ${subject.versionNumber} of ${subject.controlName} goes back to its author, who can edit it into a new Draft. Nothing is activated and no Run can use it.`;
  }
  return subject === null
    ? DECIDE_GENERIC
    : `This changes the state of version ${subject.versionNumber} of ${subject.controlName} and records the decision against your name.`;
}

/**
 * The wording where the surface holds no subject — the Builder's Submit and the
 * Procedure page's Submit, which name their Draft on the page around the control.
 * Unchanged from what those two surfaces have always said.
 */
const APPROVE_GENERIC = 'This freezes the reviewed Procedure Version and records your approval.';
const REJECT_GENERIC = 'This records your rationale and returns the Procedure Version to its author.';
const DECIDE_GENERIC = 'This changes the Procedure Version state and records the decision against your name.';

/** The half of the approval consequence that is true whichever state it lands in. */
const APPROVE_RECORDED =
  'Your approval is recorded against your name and freezes this version as the reviewed definition.';

/** The link back out of a version, to the Procedure that owns it. */
export const BACK_TO_PROCEDURE_LABEL = 'Back to Procedure';

/** The last crumb of a version's trail, and the heading a decision history sits under. */
export function versionCrumb(versionNumber: number): string {
  return `Version ${versionNumber}`;
}
