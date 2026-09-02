import type { IconName } from './icons';

/**
 * The status vocabulary, as data.
 *
 * DESIGN.md → Colors → Status is a nine-row table: eight independent state families
 * plus the evaluation-value row, which labels a value rather than a state. Every row
 * gives, in order, the states, the badge treatment of each, and the icon of each.
 *
 * The table is transcribed here and nowhere else. `StatusBadge` reads it, so a badge
 * cannot be rendered with a word the table does not contain, with the wrong treatment,
 * or without an icon: the state IS the key, and the treatment and icon come with it.
 * `status.test.ts` reads the table off disk and fails when the two disagree.
 *
 * Why the whole vocabulary now, when no surface uses most of it: the families exist to
 * be distinguishable from one another, and that is a property of the set, not of any
 * one badge. Nine surfaces each transcribing their own row is how two families end up
 * sharing a treatment.
 */

/**
 * The treatment names DESIGN.md uses, resolved as its own sentence says: a plain
 * family fills with `{colors.<family>-bg}`, borders with `-border`, and writes in
 * `-text`; a `-solid` variant fills with `-solid` and writes in `{colors.text-inverse}`;
 * a `-outline` variant keeps the border and text with no fill.
 */
export const STATUS_TREATMENTS = [
  'neutral',
  'neutral-solid',
  'info',
  'info-solid',
  'success',
  'warning',
  'danger',
  'danger-outline',
] as const;

export type StatusTreatment = (typeof STATUS_TREATMENTS)[number];

interface StatusStateDefinition {
  readonly treatment: StatusTreatment;
  readonly icon: IconName;
}

interface StatusFamilyDefinition {
  /** The family name exactly as DESIGN.md's first column spells it. */
  readonly label: string;
  readonly states: Readonly<Record<string, StatusStateDefinition>>;
}

export const STATUS_VOCABULARY = {
  'procedure-version': {
    label: 'Procedure Version',
    states: {
      Draft: { treatment: 'neutral', icon: 'pencil' },
      Submitted: { treatment: 'warning', icon: 'clock' },
      Approved: { treatment: 'info', icon: 'check' },
      Rejected: { treatment: 'danger-outline', icon: 'x-circle' },
      Active: { treatment: 'neutral-solid', icon: 'lock' },
      Retired: { treatment: 'neutral', icon: 'slash' },
    },
  },
  'run-lifecycle': {
    label: 'Run lifecycle',
    states: {
      Queued: { treatment: 'neutral', icon: 'clock' },
      Running: { treatment: 'info', icon: 'refresh-cw' },
      Paused: { treatment: 'neutral', icon: 'pause' },
      'Awaiting Auditor': { treatment: 'info-solid', icon: 'user' },
      // Grey by design. Only a Result outcome may be green.
      Completed: { treatment: 'neutral', icon: 'check' },
      Inconclusive: { treatment: 'warning', icon: 'alert-triangle' },
      'Run Failed': { treatment: 'danger-outline', icon: 'cloud-off' },
      Canceled: { treatment: 'neutral-solid', icon: 'ban' },
    },
  },
  'evidence-quality-gate': {
    label: 'Evidence Quality Gate',
    states: {
      Passed: { treatment: 'success', icon: 'shield-check' },
      'Not passed': { treatment: 'warning', icon: 'shield-alert' },
      Incomplete: { treatment: 'danger-outline', icon: 'shield-alert' },
      'Not evaluated': { treatment: 'neutral', icon: 'shield' },
    },
  },
  'result-outcome': {
    label: 'Result outcome',
    states: {
      Pass: { treatment: 'success', icon: 'check-circle-2' },
      'Control Failure': { treatment: 'danger', icon: 'alert-circle' },
      'Pending Confirmation': { treatment: 'info-solid', icon: 'user' },
      'No conclusion issued': { treatment: 'neutral', icon: 'slash' },
    },
  },
  'auditor-review': {
    label: 'Auditor Review',
    states: {
      // No Rejected state: rejection is a review event rendered in history, and the
      // badge returns to Draft with a "returned to Draft" annotation.
      Draft: { treatment: 'neutral', icon: 'pencil' },
      Submitted: { treatment: 'warning', icon: 'clock' },
      Approved: { treatment: 'info', icon: 'check' },
      Finalized: { treatment: 'neutral-solid', icon: 'lock' },
    },
  },
  exception: {
    label: 'Exception',
    states: {
      Open: { treatment: 'danger-outline', icon: 'alert-circle' },
      'Under Review': { treatment: 'info', icon: 'clock' },
      Confirmed: { treatment: 'danger', icon: 'alert-circle' },
      'Not an Exception': { treatment: 'neutral-solid', icon: 'ban' },
    },
  },
  'evaluation-origin': {
    label: 'Evaluation origin',
    states: {
      'Rule-Classified': { treatment: 'neutral', icon: 'braces' },
      'Agent-Judged (pending)': { treatment: 'info-solid', icon: 'user' },
      'Agent-Judged (confirmed)': { treatment: 'info', icon: 'cpu' },
      'Human-classified': { treatment: 'info', icon: 'user-check' },
    },
  },
  'evaluation-value': {
    label: 'Evaluation value',
    states: {
      Compliant: { treatment: 'success', icon: 'check-circle-2' },
      Exception: { treatment: 'danger', icon: 'alert-circle' },
      // A value, never an origin.
      Unevaluated: { treatment: 'warning', icon: 'help-circle' },
    },
  },
  'work-item': {
    label: 'Work Item',
    states: {
      Pending: { treatment: 'neutral', icon: 'clock' },
      'In progress': { treatment: 'info', icon: 'refresh-cw' },
      Awaiting: { treatment: 'info-solid', icon: 'user' },
      Observed: { treatment: 'success', icon: 'check' },
      Uninspected: { treatment: 'warning', icon: 'slash' },
      Ambiguous: { treatment: 'warning', icon: 'git-compare' },
      Failed: { treatment: 'danger-outline', icon: 'x-circle' },
    },
  },
} as const satisfies Readonly<Record<string, StatusFamilyDefinition>>;

export type StatusFamily = keyof typeof STATUS_VOCABULARY;

/** The states one family holds. An unknown state is a type error, not a grey badge. */
export type StatusState<F extends StatusFamily> = keyof (typeof STATUS_VOCABULARY)[F]['states'] &
  string;

export const STATUS_FAMILIES = Object.keys(STATUS_VOCABULARY) as readonly StatusFamily[];

/** One badge's data: the word to write, the treatment to wear, the icon to carry. */
export interface StatusPresentation {
  readonly word: string;
  readonly treatment: StatusTreatment;
  readonly icon: IconName;
}

export function statusPresentation<F extends StatusFamily>(
  family: F,
  state: StatusState<F>,
): StatusPresentation {
  const definition = (STATUS_VOCABULARY[family].states as Readonly<
    Record<string, StatusStateDefinition>
  >)[state];
  if (!definition) {
    // Unreachable through the types. Kept because `STATUS_VOCABULARY` is also read
    // by the badge gallery through the string keys, and a lookup that silently
    // returned undefined would render a badge with no icon and no word — the one
    // outcome the whole vocabulary exists to make impossible.
    throw new Error(`Unknown ${family} state: ${state}`);
  }
  return { word: state, treatment: definition.treatment, icon: definition.icon };
}

/**
 * The "needs a human" set. DESIGN.md: Awaiting Auditor, Pending Confirmation,
 * Agent-Judged pending, and a Work Item awaiting an Escalation answer all use
 * `{colors.info-solid}` with the `user` icon, and nothing else in the product does.
 */
export const NEEDS_A_HUMAN: readonly { family: StatusFamily; state: string }[] = [
  { family: 'run-lifecycle', state: 'Awaiting Auditor' },
  { family: 'result-outcome', state: 'Pending Confirmation' },
  { family: 'evaluation-origin', state: 'Agent-Judged (pending)' },
  { family: 'work-item', state: 'Awaiting' },
];
