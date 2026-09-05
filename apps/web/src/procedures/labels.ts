import { findProcedureTemplate, type ProcedureVersionState, type TargetSystemKind } from '@intellifin/domain';

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

/** How a Target System kind reads in the interface. The stored value stays the token. */
const KIND_LABELS: Readonly<Record<TargetSystemKind, string>> = {
  web: 'web',
  desktop: 'desktop',
  api: 'API',
  'versioned-file': 'versioned file',
};

export function kindLabel(kind: TargetSystemKind): string {
  // `Object.hasOwn`, not a plain index: a kind is a closed vocabulary, but this reads a
  // stored value and the guard is the standing rule for a lookup keyed by data.
  return Object.hasOwn(KIND_LABELS, kind) ? KIND_LABELS[kind] : kind;
}

/**
 * The Target System completeness diagnostics (FR-7).
 *
 * Authored advisory wording, distinct from the FR-8 scope warnings and from the UX-quoted
 * copy in `copy.ts`: a missing selection, or a P-1 Draft not covering the web or desktop
 * system its Template names, is a gap surfaced so the auditor can fill it. Each names the
 * object it concerns, the same rule every guard sentence follows.
 */
export const TARGET_SELECTION_MISSING = 'No Target System is selected. Choose one or more registered systems.';

export function targetCoverageMissing(kind: 'web' | 'desktop'): string {
  return `This Template names a ${kind} Target System, and none is selected. Add the registered ${kind} system.`;
}

/** Shown in the Audit Instructions section when no agent-driven system is selected yet. */
export const AUDIT_INSTRUCTIONS_NO_AGENT =
  'Select a web or desktop Target System above to write its Audit Instructions. API and file systems are adapter-acquired and take no agent instructions.';
