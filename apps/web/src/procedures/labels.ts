import { findProcedureTemplate, type ProcedureVersionState } from '@intellifin/domain';

/**
 * How the interface writes the Procedure vocabularies.
 *
 * Only the labels are ours: `P-1` is a stored value, "Terminated Users Retaining
 * Access" is what a person reads, and it is read from the Template record itself so a
 * surface can never show a name the domain does not own.
 */

/** The Template name from the Template record. Only a shipped id reaches this. */
export function templateLabel(templateId: string): string {
  return findProcedureTemplate(templateId as never).name;
}

/**
 * A version's number and state, as a list row reads: "Version 1 · DRAFT".
 *
 * The state word is spelled the way the domain stores it; the badge beside it carries
 * the display word, so the two never disagree about spelling.
 */
export function versionLabel(versionNumber: number, state: string): string {
  return `Version ${versionNumber} · ${state}`;
}
