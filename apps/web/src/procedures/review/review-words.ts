import { PROCEDURE_TEMPLATES, type PermittedReadAction } from '@intellifin/domain';

/**
 * The words the manager's version review says (UI cleanup 2026-09-22, UX-33, UX-34).
 *
 * The walkthrough measured the submitted-version review at 13,887px: nested `dl` dumps of
 * every frozen structure, every first-version section marked "Changed", the executable
 * plan rendered twice, and the Approve / Reject controls at the very bottom of it. What
 * an approver has to decide is much smaller than what the platform froze — is this the
 * right control, over the right records, in the right systems, with criteria and evidence
 * that support a conclusion — so the surface leads with that and keeps the frozen
 * contract behind one disclosure.
 *
 * These are the PLATFORM's own sentences, derived from what the version actually freezes,
 * not quotations from the UX contract — the `run-start-words.ts` rule — so they live
 * beside the surface rather than in `copy.ts`, and `review-words.test.ts` refuses a copy
 * retyped in a component.
 */

/** The decision summary's sections, in reading order. */
export const REVIEW_HEADINGS = {
  tested: 'What is being tested',
  scope: 'Which records this covers',
  systems: 'Where the agent looks, and what it may do there',
  criteria: 'What counts as a finding',
  evidence: 'Proof kept for every record',
  frequency: 'How often this is meant to run',
  access: 'Access limits',
  changed: 'What changed',
  history: 'Decision history',
} as const;

/** Every label the summary puts beside a fact, in one place. */
export const SUMMARY_LABELS = {
  procedureName: 'Procedure name',
  template: 'Template',
  controlStatement: 'Control statement',
  objective: 'Objective',
  risk: 'Risk',
  criterionReference: 'Criterion reference',
  period: 'Period',
  scope: 'Scope',
  source: 'Records come from',
  arrival: 'How they arrive',
  countMechanism: 'How the record count is confirmed',
  fields: 'Fields this source provides',
  masked: 'Fields shown masked',
  filters: 'Tested records',
  mayDo: 'May do here',
  mayGo: 'Where it may go',
  frequency: 'Planned frequency',
  certainty: 'How certain the agent must be',
  passesEmpty: 'Passes when no records match',
  duplicates: 'Same record may appear more than once',
  howOften: 'How often',
} as const;

export const CRITERIA_LABELS = { agentJudged: 'judged by the agent' } as const;

/** Where the certainty threshold is said: beside the criteria it actually decides. */
export function AGENT_JUDGED_NOTE(threshold: string): string {
  return `A criterion judged by the agent is only concluded when the agent is at least ${threshold} certain. Below that the record is left for a person to decide.`;
}

export const EVIDENCE_LABELS = {
  note: 'Every record a Run of this version reaches carries the proof named here, frozen at the moment it was read.',
} as const;

/** The sticky bar's own heading, and the label on the one saved decision it shows. */
export const DECISION_HEADING = 'Decision';
export const SAVED_DECISION_LABEL = 'Saved decision';

/** What the decision bar says about the version it is a decision on. */
export const AUTHOR_LABEL = 'Author';
export const SUBMITTED_BY_LABEL = 'Submitted by';
export const NO_SUBMISSION_RECORDED = 'Not yet submitted for approval.';

/**
 * Said when no submission is on record for a version that is past Draft — one inserted by
 * a migration or a fixture, or older than submission records. "Not yet submitted" would
 * then be false about an Active version; what is true is that no record says who sent it.
 */
export const SUBMISSION_NOT_RECORDED = 'No submission is recorded for this version.';

/** What the decision bar says when it finds no submission record, for this state. */
export function missingSubmissionWords(state: string): string {
  return state === 'DRAFT' ? NO_SUBMISSION_RECORDED : SUBMISSION_NOT_RECORDED;
}

/** The one disclosure the frozen contract lives under. */
export const FROZEN_CONTRACT_SUMMARY = 'Technical details — the frozen contract';
export const FROZEN_CONTRACT_SENTENCE =
  'The exact bytes this version froze: the canonical plan text, the compiled criteria, the model and tool configuration and the identifiers. Nothing here is editable, and everything above is read from it.';

/** The identifier labels inside that disclosure. */
export const TECHNICAL_LABELS = {
  versionId: 'Version identifier',
  procedureId: 'Procedure identifier',
  templateId: 'Template identifier',
  baselineId: 'Compared-with version identifier',
  submittedAt: 'Submitted at',
  revision: 'Reviewed row revision',
} as const;

/**
 * What a first version has to compare itself against.
 *
 * The stored diff marks every section `changed: true` for a first version — deliberately,
 * because `isConsistentVersionReview` requires it of a review with no baseline — so a
 * surface that rendered the stored flag told an approver that fourteen sections had been
 * changed by somebody, on a version that has no predecessor at all.
 */
export const FIRST_VERSION_SENTENCE = 'First version: nothing to compare.';

/** What a version with no frozen review yet has to compare. */
export const NOT_SUBMITTED_COMPARISON_SENTENCE =
  'This version has not been submitted, so nothing is frozen to compare. The summary above reads its Draft as it stands now.';

/** What a later version says when its predecessor's saved sections are identical. */
export function nothingChangedSentence(baselineVersionNumber: number): string {
  return `Nothing changed: every section is identical to version ${baselineVersionNumber}.`;
}

/** What a later version says above the list of sections that differ. */
export function comparedWithSentence(baselineVersionNumber: number): string {
  return `Compared with version ${baselineVersionNumber}. Only the sections that differ are listed.`;
}

/** Said where sections changed with nothing to show in words, so their absence is not silence. */
export function technicalSectionsChangedSentence(count: number): string {
  return count === 1
    ? 'One more section changed only in the frozen contract: it is under Technical details below.'
    : `${count} more sections changed only in the frozen contract: they are under Technical details below.`;
}

/** The arrow between a previous value and the submitted one, in one place. */
export const CHANGE_ARROW = '→';

/** Said once, beside the access limits, rather than under every system. */
export const READ_ONLY_ACCESS_SENTENCE =
  'The agent may only read. Every action listed above is a read, and the platform refuses anything else, and anywhere else, while the Run is going.';
export const CREDENTIAL_BY_NAME_SENTENCE =
  'Sign-in credentials are named by reference only. No password or token is stored in this Procedure, shown on this page or written into a Run’s records.';

/** Empty states that say what would be here, and never imply a passed control. */
export const NO_CONDITIONS_SENTENCE =
  'No criterion is frozen with this version, so a Run of it could reach no finding. Reject it and ask for the criteria.';
export const NO_EVIDENCE_SENTENCE =
  'No extra proof is asked for beyond what the Template already keeps for every record.';
export const NO_SYSTEMS_SENTENCE =
  'No Target System is frozen with this version, so the agent has nowhere to look.';
export const NO_SOURCE_SENTENCE =
  'No Population Source is frozen with this version, so there is no list of records to test.';
export const NO_FILTERS_SENTENCE = 'Every record the source provides is tested.';
export const NO_ADDRESS_SENTENCE = 'No address is frozen for this system.';
export const NO_DECISIONS_SENTENCE =
  'Nothing has been decided on this version yet. A decision is recorded here the moment one is taken.';
export const NO_FIELDS_SENTENCE = 'None declared';
export const NONE = 'None';
export const NOT_SET = 'Not set';

/**
 * A Template, by the name it carries, never by its stored id.
 *
 * `findProcedureTemplate` THROWS on an id it does not ship, and the id here comes from a
 * stored frozen review — so a version frozen under a Template a later build removed would
 * take the whole approval surface down with it. This finds the record and falls back to
 * the stored id, which is honest about what the version froze.
 */
export function templateWords(templateId: string): string {
  return PROCEDURE_TEMPLATES.find((template) => template.id === templateId)?.name ?? templateId;
}

/**
 * A registered read action, in words.
 *
 * `PERMITTED_READ_ACTIONS` is the frozen vocabulary the digest covers and the gate
 * compares against; these are the same eight things said to a person who has to decide
 * whether that reach is acceptable. Typed against the domain union, so an action added
 * there without words here does not COMPILE.
 */
export const READ_ACTION_WORDS: Readonly<Record<PermittedReadAction, string>> = {
  navigate: 'open pages',
  search: 'search',
  'list-records': 'list records',
  'open-record': 'open a record',
  'read-attribute': 'read a field',
  'read-metadata': 'read page details',
  'read-file': 'read a file',
  'capture-screenshot': 'take a screenshot',
};

/**
 * `Object.hasOwn`, not a plain index: the action arrives from a stored frozen contract
 * typed `string`, so a plain lookup would answer `'constructor'` with a function. An
 * action this build has no word for keeps its stored spelling, which is honest about
 * what the version froze and never a blank.
 */
export function readActionWord(action: string): string {
  return Object.hasOwn(READ_ACTION_WORDS, action)
    ? READ_ACTION_WORDS[action as PermittedReadAction]
    : action;
}
