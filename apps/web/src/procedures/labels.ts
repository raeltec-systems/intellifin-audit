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

/**
 * What a Template SUGGESTS, said against what this deployment actually registered.
 *
 * A Template names its default systems by name and a registration is never minted from
 * one — deliberately, because scope is the auditor's to declare. What that leaves is a
 * caption naming systems the deployment may not have: P-1 suggests LedgerDesk, no
 * deployment registers a desktop system because this release cannot execute one, and an
 * auditor reading "This Template suggests: LoanCore (web), LedgerDesk (desktop)" then
 * goes looking for LedgerDesk in a list that does not contain it. Nothing on the surface
 * distinguished "nobody has set this up" from "you are looking in the wrong place", so
 * the honest reading was that the Procedure could not be built at all.
 *
 * The match is by display name and kind, which is a HEURISTIC — a deployment may
 * register the same system under another name — so the wording says "no system with
 * this name", never "this system does not exist".
 */
export interface SuggestedTarget {
  readonly name: string;
  readonly kind: TargetSystemKind;
  readonly registered: boolean;
}

export function suggestedTargets(
  suggestions: readonly { readonly name: string; readonly kind: TargetSystemKind }[],
  registrations: readonly { readonly displayName: string; readonly kind: TargetSystemKind }[],
): readonly SuggestedTarget[] {
  return suggestions.map((suggestion) => ({
    name: suggestion.name,
    kind: suggestion.kind,
    registered: registrations.some(
      (registration) =>
        registration.kind === suggestion.kind &&
        registration.displayName.trim().toLowerCase() === suggestion.name.trim().toLowerCase(),
    ),
  }));
}

/** How one suggestion reads: its state, and what to do about it. */
export function suggestedTargetNote(target: SuggestedTarget): string {
  if (target.kind === 'desktop') {
    // Registered or not, the answer is the same and it is the stronger fact: this
    // release stops a Run that reaches a desktop system. `procedureReadiness` says so
    // again, at greater length, once one is actually selected.
    return target.registered
      ? 'set up, but this release cannot run a desktop system — a Run that reaches one stops without a conclusion. Leave it out.'
      : 'no system with this name is set up here, and this release cannot run a desktop system anyway. Leave it out.';
  }
  return target.registered
    ? 'ready to add below.'
    : 'no system with this name is set up here. Ask a PoC Administrator to add it under Administration, or add a different system below.';
}
