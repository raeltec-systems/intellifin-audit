import type { DraftSectionHeading, PreparationSectionId, ProcedureReadinessCode, ProcedureReadinessItem } from '@intellifin/domain';

import { SECTION_WORDS } from '../design/plain-words';
import { conditionLabel, fieldWords } from './condition-words';

/**
 * Readiness and submission sentences in the Builder's own words, each naming the section
 * that fixes it (UI cleanup 2026-09-22, UX-15, UX-16).
 *
 * `procedureReadiness` and `completenessReason` are the domain's closed vocabularies and
 * are right about WHAT is wrong; their sentences name the section by its stored heading —
 * "Choose at least one registered system in Target System selection" — which is not a
 * title anywhere on the Builder the auditor is reading. The domain keeps its sentence (the
 * version review and the command refusal still read it); the Builder says the same finding
 * with `SECTION_WORDS[...].title` and a link to the step that resolves it.
 *
 * The readiness table is typed `Record<ProcedureReadinessCode, …>`, so a code added to the
 * domain without words here does not compile. The completeness table is keyed by the
 * domain's own sentences, and `readiness-words.test.ts` drives the real
 * `completenessReason` through every branch, so a reworded domain sentence fails a test
 * rather than silently falling back to the raw text.
 */

/** Which guided step resolves a finding about each stored section. */
export const SECTION_STEP: Readonly<Record<DraftSectionHeading, PreparationSectionId>> = {
  Risk: 'context',
  'Criterion reference': 'context',
  Control: 'context',
  Objective: 'context',
  'Period and scope': 'scope',
  'Population Source binding': 'evidence',
  'Target System selection': 'evidence',
  'Evidence Requirements': 'evidence',
  'Audit Instructions': 'instructions',
  'Compliance Rule conditions': 'assessment',
  Schedule: 'frequency',
};

const title = (heading: DraftSectionHeading): string => SECTION_WORDS[heading].title;

function quoted(value: string | null): string {
  return value === null || value === '' ? 'this item' : `“${value}”`;
}

const READINESS_SENTENCES: Readonly<Record<ProcedureReadinessCode, (item: ProcedureReadinessItem) => string>> = {
  'targets-missing': () =>
    `No system is chosen to check, so a Run would read nothing and reach no conclusion. Choose at least one under ${title('Target System selection')}.`,
  'unsupported-target-selected': (item) =>
    `${quoted(item.subject)} is a desktop system. This release cannot check a desktop system, so a Run that reaches it stops without a conclusion. Remove it under ${title('Target System selection')}.`,
  'source-not-bound': () =>
    `No list of records is chosen, so a Run would have nothing to test. Choose where the records come from under ${title('Population Source binding')}. If none suits this procedure, ask a PoC Administrator to add one.`,
  'agent-judged-without-policy': (item) =>
    `${item.subject === null ? 'A condition' : conditionLabel(item.subject)} is judged by the agent and reads an account's roles, but no list of privileged roles is saved with it, so the agent would stop to ask you about every role it meets. Add the privileged roles under ${title('Compliance Rule conditions')}.`,
  'termination-time-precision-missing': (item) =>
    `${item.subject === null ? 'A condition' : conditionLabel(item.subject)} compares, in hours, when an account was disabled with when employment ended, but the chosen records give only a date for when employment ended, so every record would need review. Choose records that include the time under ${title('Population Source binding')}, or use the account-status rule under ${title('Compliance Rule conditions')}.`,
  'disablement-capture-missing': (item) =>
    `A rule reads when the account was disabled (${quoted(item.subject === null ? null : fieldWords(item.subject))}), but nothing is set to capture it, so every record would need review. Add it under ${title('Evidence Requirements')}.`,
  'model-read-attribute': (item) =>
    `${quoted(item.subject === null ? null : fieldWords(item.subject))} is set to be read by the agent with nothing to check that reading against, so the agent's own reading is the only evidence for it. Link it to the page or file it comes from under ${title('Evidence Requirements')} if that is not what you intend.`,
};

export interface ReadinessLine {
  readonly code: ProcedureReadinessCode;
  /** The guided step that resolves it — the outline anchor the line links to. */
  readonly step: PreparationSectionId;
  /** The section's title as the Builder shows it. */
  readonly sectionTitle: string;
  readonly sentence: string;
}

export function readinessLine(item: ProcedureReadinessItem): ReadinessLine {
  return {
    code: item.code,
    step: SECTION_STEP[item.section],
    sectionTitle: title(item.section),
    sentence: READINESS_SENTENCES[item.code](item),
  };
}

/** The words a link to a step carries. */
export function goToSection(sectionTitle: string): string {
  return `Go to ${sectionTitle}`;
}

/**
 * The domain's completeness sentences, and the application's plan sentences, in the
 * Builder's words — each naming the section that fixes it (UX-15, UX-16).
 *
 * Exact sentences first, then the two with a variable tail. A sentence this table does not
 * know is returned as it came: the domain's own words are true, only less readable, and a
 * blank or a guess would be worse than either.
 */
const EXACT: ReadonlyMap<string, string> = new Map([
  ['Choose a Population Source.', `Choose where the records come from under ${title('Population Source binding')}.`],
  ['Enter the procedure scope.', `Describe what this test covers under ${title('Period and scope')}.`],
  ['Choose a Schedule.', `Choose how often this is meant to run under ${title('Schedule')}.`],
  ['Choose an explicit Period. Scheduled Run period derivation happens at execution.', `Set the first and last date the test covers under ${title('Period and scope')}.`],
  ['Resolve the Population Source count or Schedule requirement.', `Resolve the record-count or frequency warning under ${title('Population Source binding')}.`],
  ['Select the required Target Systems.', `Choose at least one system under ${title('Target System selection')}.`],
  ['Enter Audit Instructions for every agent-driven Target System.', `Write the steps for every system the agent checks under ${title('Audit Instructions')}.`],
  ['Author at least one Compliance Rule condition.', `Add at least one rule under ${title('Compliance Rule conditions')}.`],
  ['Wait for the test plan to finish preparing.', 'The test plan is still being prepared from your saved sections. Wait a moment, then submit.'],
  ['Prepare the current test plan before submitting.', 'The test plan has not been prepared from your latest saved sections yet. Wait a moment, then submit.'],
]);

const LOOKUP_PREFIX = 'The Population Source must declare lookup columns: ';
const GROUNDING = /^Attribute "(.+)": /u;
const PLAN_FAILED_PREFIX = 'The test plan could not be prepared: ';

export function draftGapWords(reason: string | null): string | null {
  if (reason === null) return null;
  const exact = EXACT.get(reason);
  if (exact !== undefined) return exact;
  if (reason.startsWith(LOOKUP_PREFIX)) {
    const columns = reason.slice(LOOKUP_PREFIX.length).replace(/\.$/u, '').split(', ').map(fieldWords);
    return `The chosen records do not include ${columns.map((column) => `“${column}”`).join(', ')}, which the agent needs to find each record. Choose records that include ${columns.length === 1 ? 'it' : 'them'} under ${title('Population Source binding')}.`;
  }
  const grounding = GROUNDING.exec(reason);
  if (grounding !== null) {
    return `“${fieldWords(grounding[1]!)}” needs the page or file it comes from, or to be marked as read by the agent. Set it under ${title('Evidence Requirements')}.`;
  }
  if (reason.startsWith(PLAN_FAILED_PREFIX)) {
    const inner = reason.slice(PLAN_FAILED_PREFIX.length);
    const missing = draftGapWords(inner);
    return missing !== inner && missing !== null
      ? `Something is missing in your draft. ${missing}`
      : `The platform could not prepare the test plan. Try preparing it again below. (${inner})`;
  }
  return reason;
}
