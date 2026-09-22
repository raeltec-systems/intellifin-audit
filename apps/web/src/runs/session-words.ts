import { fieldWords } from '../procedures/condition-words';
import { countNoun } from '../design/words';
import { planActionWord, toolActionNameWord } from './labels';

/**
 * What the Agent is doing, said as an audit action (UI cleanup 2026-09-22, UX-28, UX-29,
 * UX-49).
 *
 * The walkthrough met Replay and Live View narrating `Inspect the record for E-000105 on
 * Live acceptance LoanCore 35340181283-1, plan step 01a0b44d-2f30-7490-bf6f-cba0eac098c1-1,
 * started 2026-09-21T12:55:59.756Z.` — a plan-step UUID and a machine instant inside the one
 * sentence a screen-reader user hears as the frame's `alt`. EXPERIENCE.md's UI cleanup
 * section now says the two surfaces "narrate audit actions (\"Searching LoanCore for
 * E-000103\", \"Reading the account status\")".
 *
 * These are the PLATFORM's own sentences rather than contract quotations: EXPERIENCE.md
 * gives two examples and fixes the shape, and does not write the rest. They live here, free
 * of React, because `live-view.ts` composes them and the browser specs import them — the
 * `run-start-words.ts` rule: a sentence retyped in a test is a sentence pinned against
 * nothing.
 *
 * WHAT A NARRATION MAY CONTAIN. The record (`subjectKey`) is the frozen population's own
 * lookup value and the system name is the Procedure Version's frozen `display_name`; both
 * are platform-held facts. A Tool Action PARAMETER NAME is a form field read off a page the
 * Target System controls, so it never becomes platform prose here — only the field label a
 * caller has already resolved against the frozen `attribute_label_patterns` is spoken, and
 * a caller with none gets the general sentence instead of a guess.
 */

/** `E-000103` and `LoanCore`, as a narration's two optional halves. */
export interface NarrationSubject {
  /** The record being inspected, or `null` when the unit inspects no population (P-4). */
  readonly subject: string | null;
  /** The Target System's frozen display name, or `null` when it could not be resolved. */
  readonly system: string | null;
  /**
   * The attribute a read is reading, where the caller resolved one from the frozen
   * label patterns. `account_status` reads as "the account status".
   */
  readonly field?: string | null;
}

function on(system: string | null): string {
  return system === null ? '' : ` on ${system}`;
}

function forRecord(subject: string | null): string {
  return subject === null ? '' : ` for ${subject}`;
}

/**
 * One plan step, narrated.
 *
 * A plan action this build does not know falls through to `planActionWord`, which itself
 * falls back to the stored value: an unrecognised step is shown as it was stored, which is
 * a true statement about the row, rather than as a sentence this module invented.
 */
const PLAN_NARRATION: Readonly<Record<string, (at: NarrationSubject) => string>> = {
  'create-workspace': () => 'Creating the Agent Workspace',
  'acquire-population': () => 'Acquiring the records to test',
  'sign-in': (at) => `Signing in to ${at.system ?? 'the Target System'}`,
  'extract-adapter': (at) => `Reading the records${on(at.system)}`,
  'inspect-record': (at) =>
    at.subject === null ? `Opening the page${on(at.system)}` : `Opening the record for ${at.subject}${on(at.system)}`,
  'capture-observation': (at) =>
    at.subject === null
      ? `Capturing what ${at.system ?? 'the Target System'} shows`
      : `Capturing what ${at.system ?? 'the Target System'} shows for ${at.subject}`,
  'evaluate-conditions': (at) =>
    at.subject === null ? 'Checking the page against the criteria' : `Checking ${at.subject} against the criteria`,
};

/** One Tool Action, narrated — what the frame in front of the reader is a picture of. */
const TOOL_NARRATION: Readonly<Record<string, (at: NarrationSubject) => string>> = {
  navigate: (at) => `Opening a page${on(at.system)}`,
  search: (at) =>
    at.subject === null ? `Searching ${at.system ?? 'the Target System'}` : `Searching ${at.system ?? 'the Target System'} for ${at.subject}`,
  'list-records': (at) => `Listing the records${on(at.system)}`,
  'open-record': (at) =>
    at.subject === null ? `Opening a record${on(at.system)}` : `Opening the record for ${at.subject}${on(at.system)}`,
  // The one narration the field changes. With no resolved label there is nothing honest to
  // name, so the general sentence is said rather than a field this module guessed at.
  'read-attribute': (at) =>
    at.field === null || at.field === undefined || at.field.trim() === ''
      ? `Reading an approved field${on(at.system)}`
      : `Reading the ${fieldWords(at.field)}`,
  'read-metadata': (at) => `Reading the page details${on(at.system)}`,
  'read-file': (at) => `Reading the file${on(at.system)}`,
  'capture-screenshot': (at) => `Capturing the screen${on(at.system)}`,
};

/** The plan step's sentence: `Opening the record for E-000103 on LoanCore`. */
export function planActionNarration(action: string, at: NarrationSubject): string {
  return Object.hasOwn(PLAN_NARRATION, action)
    ? PLAN_NARRATION[action]!(at)
    : `${planActionWord(action)}${forRecord(at.subject)}${on(at.system)}`;
}

/** The Tool Action's sentence: `Searching LoanCore for E-000103`. */
export function toolActionNarration(action: string, at: NarrationSubject): string {
  return Object.hasOwn(TOOL_NARRATION, action)
    ? TOOL_NARRATION[action]!(at)
    : `${toolActionNameWord(action)}${forRecord(at.subject)}${on(at.system)}`;
}

/**
 * What the Work Item rail says when no Work Item is being worked (UX-49).
 *
 * The walkthrough found a COMPLETED Run saying "No Work Item is being worked yet." — a
 * sentence about a Run that is still to start, over one that finished. "Yet" is a claim
 * about the future, and only an active Run has one. Each sentence is true of its own state
 * and none of them implies that nothing happened.
 */
export const NO_WORK_ITEM: Readonly<Record<'not-started' | 'working' | 'paused' | 'waiting' | 'finished', string>> = {
  'not-started': 'The Run has not started, so no record is being inspected yet.',
  working: 'No record is being inspected at this moment.',
  paused: 'The Run is paused, so no record is being inspected.',
  waiting: 'The Run is waiting for your answer, so no record is being inspected.',
  finished: 'The Run has finished. Every record it inspected is on the Evidence tab.',
};

/** Which of the five the Run's state asks for. A state this build does not know is `working`. */
export function noWorkItemSentence(state: string): string {
  switch (state) {
    case 'QUEUED':
      return NO_WORK_ITEM['not-started'];
    case 'PAUSED':
      return NO_WORK_ITEM.paused;
    case 'AWAITING_AUDITOR':
      return NO_WORK_ITEM.waiting;
    case 'COMPLETED':
    case 'INCONCLUSIVE':
    case 'RUN_FAILED':
    case 'CANCELED':
      return NO_WORK_ITEM.finished;
    default:
      return NO_WORK_ITEM.working;
  }
}

/**
 * The record's own position in the session: `E-000103 · frame 2 of 5 for this record`
 * (UX-29).
 *
 * The walkthrough found Replay carrying two counters — a global `Frame 6 of 15` and a
 * per-inspection count — with nothing saying which was which. There is ONE global counter
 * now, and this is the selected record's own position beside it, which is the number a
 * reader following a single record actually wants.
 */
export function recordFramePosition(record: string, position: number, total: number): string {
  return `${record} · frame ${position.toLocaleString('en-US')} of ${countNoun(total, 'frame')} for this record`;
}

/**
 * The Step counter's secondary context, when the current Step is not on its first try.
 *
 * `attempt 1` is said nowhere: every Step Execution has one, so printing it makes a
 * retry indistinguishable from an ordinary first pass. Only a number above one is news.
 */
export function attemptContext(attempt: number): string | null {
  return attempt > 1 ? `attempt ${attempt.toLocaleString('en-US')}` : null;
}

/**
 * The words on Live View's flag disclosure, in the page header (UI cleanup 2026-09-22,
 * UX-48). The flag FORM used to be a full card on the header's action row, taller than the
 * header itself, which pushed the workspace screen below the first viewport. It opens from
 * this one word now, natively (a `<details>`), so it still needs no JavaScript.
 *
 * Deliberately NOT `FLAG_COPY.submit`: that is the submit button's name inside the panel,
 * and two controls sharing one accessible name would leave a reader — and a locator —
 * unable to tell the opener from the action.
 */
export const FLAG_MENU_LABEL = 'Flag this Run';

/** The opener says how many flags are already on the Run, so they are not hidden by it. */
export function flagMenuLabel(flags: number): string {
  return flags === 0 ? FLAG_MENU_LABEL : `${FLAG_MENU_LABEL} · ${flags === 1 ? '1 flag raised' : `${flags.toLocaleString('en-US')} flags raised`}`;
}
