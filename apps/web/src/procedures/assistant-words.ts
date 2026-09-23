import { readablePeriod } from '../design/time';

/**
 * What the procedure assistant says under its composer and beside a proposal
 * (UI cleanup 2026-09-22, UX-09, UX-10, UX-11).
 *
 * These are the platform's own sentences, not quotations from the UX contract, so they
 * live here beside the components that say them rather than in `copy.ts` — the
 * `run-start-words.ts` pattern. Each is exported so a test can pin it, and so a browser
 * spec reads the sentence rather than retyping it.
 */

/** What the composer is waiting for. */
export type ComposerState =
  /** An accepted, rejected or stale receipt: only commands or a fresh request. */
  | 'commands-only'
  /** A concrete proposal is on screen and can be saved by saying so. */
  | 'proposal'
  /** A concrete scope proposal WITH dates the auditor named. */
  | 'dated-proposal'
  /** The last reply was a question: the answer is what is wanted. */
  | 'question'
  /** A follow-up is being prepared, with no proposal on screen yet. */
  | 'correction'
  /** Nothing asked yet. */
  | 'first-answer';

/**
 * The hint under the composer (UX-10).
 *
 * It used to say "Say ‘record that’ to save this proposal" under every reply, including
 * one that was only a question — telling a person to save a proposal that did not exist.
 * The "record that" hint now appears only when there is something to record.
 */
export const COMPOSER_HINTS: Readonly<Record<ComposerState, string>> = {
  'commands-only': 'Ask for a new draft, review this saved section, or open another section.',
  proposal: 'Tell me what to keep, drop, add or change. Say “record that” to save this proposal.',
  'dated-proposal': 'Tell me what to keep, drop, add or change. Say “record that” to save these dates and this scope.',
  question: 'Answer the question above in your own words. Nothing is saved until you accept a proposal.',
  correction: 'Tell me what to keep, drop, add or change.',
  'first-answer': 'A rough answer is enough.',
};

/** The sentence above a scope proposal that also carries the dates the auditor named. */
export function datedScopeLead(period: { readonly from: string; readonly to: string }): string {
  return `I’ll use ${readablePeriod(period)} as the testing period, both dates included, with this scope:`;
}

/** Said after the scope proposal, before the actions. */
export const DATED_SCOPE_CONFIRM = 'Confirm these dates and scope, or tell me what to change.';

export const DATED_SCOPE_TITLE = 'Proposed dates and scope — not saved';
export const DATED_SCOPE_ACCEPT_LABEL = 'Use these dates and this scope';
export const DATED_SCOPE_SAVED = 'Your dates and scope are saved. Check them, then mark the section reviewed when you are satisfied.';

/** What the chat says when a person asks it to do something it cannot tell apart (UX-10). */
export function clarifyCommandReply(hasProposal: boolean): string {
  return hasProposal
    ? 'What would you like me to do? Say “record that” to save the displayed proposal, or “I’ve reviewed this; continue” to review saved content. Nothing has been changed.'
    : 'What would you like me to do? Name an option to choose it, answer the question in your own words, or say “I’ve reviewed this; continue” to review saved content. Nothing has been changed.';
}

/** Said in the chat when the choices are a list of rows beside it rather than in it (UX-11). */
export const CHOICES_LISTED_BESIDE =
  'Choose a source from the list below, or say “select” and its name here. Your record filters are kept.';
