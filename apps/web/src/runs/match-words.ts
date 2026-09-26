import { matchOriginWord } from './labels';

/**
 * The words every surface uses for a record a PERSON matched (Story 10.6, legacy 4.7).
 *
 * The flag is the word the Evidence cards already print for `matchOrigin`
 * (`matchOriginWord('human-matched')`), so a record reads the same on the Result, the
 * record review, the inspector and the Exceptions list as it does beside its captured
 * Observation. Everything else here is NEW platform wording, written down in ONE place free
 * of React so the components and the browser specs read the same sentences — the
 * `run-start-words.ts` rule: a sentence retyped in a test is pinned against nothing.
 *
 * `[PROPOSED, needs owner confirmation]` Every sentence below except `flag` is wording the
 * UX artifacts do not contain (the story's "Ask First" rule for wording).
 */
export const MATCH_DECISION_WORDS = {
  /** The existing word for a human-selected match. */
  flag: matchOriginWord('human-matched'),
  /**
   * A human-matched record whose decision cannot be read exactly: registered before the
   * link existed, or with a link that does not establish an answered candidate choice. The
   * sentence says what the absence MEANS and names no cause, because there is more than one.
   */
  notLinked: 'The decision that matched this record is not linked to it, so who chose it and when cannot be shown.',
  /** The label beside the candidate's own text, which the Audit Agent wrote and is inert. */
  candidateField: 'the candidate the person chose, as the Audit Agent described it',
  /** The Technical details label for the answered wait's identifier. */
  waitIdentifier: 'Escalation that matched it',
  /** The Result's own list of every record a person matched. */
  sectionHeading: 'Records a person matched',
  sectionIntro:
    'A person chose which account on the Target System each of these records is, by answering an Escalation. The Result stands on those choices.',
} as const;

/** "chose candidate 2 of 3" — the answer, as its position among the candidates offered. */
export function choseCandidateWords(candidate: number, candidates: number): string {
  return `chose candidate ${candidate.toLocaleString('en-US')} of ${candidates.toLocaleString('en-US')}`;
}

/** The bounded list's own caption, when the Result's list does not hold every record. */
export function humanMatchesBoundedWords(shown: number, total: number): string {
  return `Showing the first ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} records a person matched.`;
}
