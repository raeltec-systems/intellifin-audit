import { GATE_CHECKS, type GateCheckName } from '@intellifin/domain';

/**
 * The addendum §H checklist, as the Gate checklist renders it.
 *
 * DESIGN.md: "Each row: status icon, check name and status word, diagnostic detail, and
 * the rule applied." The domain's `GATE_CHECKS` is the row VOCABULARY — the ids a Gate
 * row is stored under — and it deliberately carries no prose, because the domain module
 * does not render anything. This is the prose: §H's own first cell (the check name) and
 * its own second cell (the rule applied), transcribed.
 *
 * `gate-rows.test.ts` reads the addendum OFF DISK and requires both cells of all twenty
 * rows, character for character, plus the order. A transcription asserted against a copy
 * of itself proves only that it equals itself, and this one is what an auditor reads to
 * decide whether a failed row matters.
 *
 * The two GROUPS are EXPERIENCE.md's, from the Gate checklist row of Component Patterns:
 * the seven Per-Observation checks are named there and every other §H row is Run-level.
 */

export type GateGroup = 'per-observation' | 'run-level';

export interface GateRowContract {
  /** §H's first cell: the check name, as the addendum writes it. */
  readonly heading: string;
  /** §H's second cell: the PoC rule this row applies. */
  readonly rule: string;
  readonly group: GateGroup;
}

/**
 * EXPERIENCE.md's Per-Observation set, by §H row id.
 *
 * "Per-Observation (update live during a Run, FR-20): required Evidence, identity
 * corroboration, Observation corroboration, search completeness, ambiguous match,
 * unnamed value, Target System freshness." Seven rows; "Target System freshness" is
 * §H's "Freshness — Target System Observations".
 */
export const PER_OBSERVATION_CHECKS: readonly GateCheckName[] = [
  'required-evidence',
  'identity-corroboration',
  'observation-corroboration',
  'search-completeness',
  'ambiguous-match',
  'unnamed-value',
  'observation-freshness',
];

export const GATE_ROW_CONTRACTS: Readonly<Record<GateCheckName, GateRowContract>> = {
  'workspace-access': {
    heading: 'Workspace and Target System access',
    rule: 'Agent Workspace is created and each required Target System sign-in succeeds within bounded retries',
    group: 'run-level',
  },
  'population-acquisition': {
    heading: 'Population acquisition',
    rule: 'The Adapter acquires the bound Population Source snapshot and its independently generated declared count and digest',
    group: 'run-level',
  },
  'count-reconciliation-file': {
    heading: 'Record-count reconciliation — file level',
    rule: 'Rows parsed equal the declared row count exactly; digest matches; tolerance is zero',
    group: 'run-level',
  },
  'count-reconciliation-inclusion': {
    heading: 'Record-count reconciliation — inclusion level',
    rule: 'Rows in = rows included + rows excluded, every exclusion carries a reason, and the included set is the population of record',
    group: 'run-level',
  },
  'empty-population': {
    heading: 'Empty population',
    rule: 'Post-inclusion population is non-empty, unless the Procedure Version opts in to a zero-record Pass',
    group: 'run-level',
  },
  'per-record-coverage': {
    heading: 'Per-record coverage',
    rule: 'Every population record has an Observation with `found ∈ {true, false}` for every required Target System, computed over Observations per the Template\'s coverage rule (§C)',
    group: 'run-level',
  },
  'identity-corroboration': {
    heading: 'Identity corroboration',
    rule: 'For every `found = true` Observation, the extractor\'s re-read of the grounded identity attribute equals the normalized population record key, or the record is flagged human-matched by a *choose candidate* answer on a declared secondary key',
    group: 'per-observation',
  },
  'search-completeness': {
    heading: 'Search completeness (absence)',
    rule: 'Every `found = false` Observation carries, per declared search key, a Tool-Action-derived query string equal to the record\'s normalized key value and a grounded empty result; all result pages were consumed',
    group: 'per-observation',
  },
  'required-evidence': {
    heading: 'Required Evidence',
    rule: 'Every Observation carries every Evidence Requirement, each attribute grounded',
    group: 'per-observation',
  },
  'observation-corroboration': {
    heading: 'Observation corroboration',
    rule: 'For every attribute not declared model-read, the deterministic extractor\'s re-read of the grounding in the stored Structural Snapshot equals `original_value` and the grounded label matches the declared label',
    group: 'per-observation',
  },
  'condition-completeness': {
    heading: 'Condition completeness',
    rule: 'Every condition has an evaluation for every record its applicability predicate selects; no uncompiled condition is silently skipped',
    group: 'run-level',
  },
  'extraction-completeness': {
    heading: 'Pagination / extraction completeness',
    rule: 'All declared pages, rows, or search results are consumed once, without gaps or loops',
    group: 'run-level',
  },
  schema: {
    heading: 'Schema',
    rule: 'Required fields and supported types match the Procedure Version',
    group: 'run-level',
  },
  'mandatory-values': {
    heading: 'Mandatory values',
    rule: 'Every population record contains its matching key and required evaluation fields',
    group: 'run-level',
  },
  'duplicate-primary-keys': {
    heading: 'Duplicate primary keys',
    rule: 'No duplicate Source primary key unless the Procedure Version explicitly permits versioned records',
    group: 'run-level',
  },
  'ambiguous-match': {
    heading: 'Ambiguous match',
    rule: 'A Target System search resolves to exactly one candidate, or a *choose candidate* Escalation answer resolved it',
    group: 'per-observation',
  },
  'unnamed-value': {
    heading: 'Unnamed value',
    rule: 'Every compiled condition meets only values it names (§B)',
    group: 'per-observation',
  },
  'snapshot-freshness': {
    heading: 'Freshness — snapshot Sources',
    rule: 'The acquired snapshot\'s generation time is no earlier than the end of the effective period and no later than Run initiation, so the snapshot covers the period',
    group: 'run-level',
  },
  'observation-freshness': {
    heading: 'Freshness — Target System Observations',
    rule: 'Observation is captured during the Run',
    group: 'per-observation',
  },
  integrity: {
    heading: 'Integrity',
    rule: 'Stored Evidence digest matches the digest computed at capture and export',
    group: 'run-level',
  },
};

/**
 * The §H contract for one stored row's check name.
 *
 * `Object.hasOwn`, because the name is read out of a database row and a plain index on
 * `'constructor'` answers with an inherited function. A row naming a check outside the
 * vocabulary cannot be stored — generation 24's CHECK says so — but a read is request
 * -shaped input all the same, and the eighth occurrence of this defect is one too many.
 */
export function gateRowContract(check: string): GateRowContract | null {
  return Object.hasOwn(GATE_ROW_CONTRACTS, check)
    ? GATE_ROW_CONTRACTS[check as GateCheckName]
    : null;
}

/** The §H rows of one group, in the addendum's own order. */
export function gateGroupChecks(group: GateGroup): readonly GateCheckName[] {
  return GATE_CHECKS.filter((check) => GATE_ROW_CONTRACTS[check].group === group);
}

/** The two group headers, in the order EXPERIENCE.md names them. */
export const GATE_GROUPS: readonly { readonly group: GateGroup; readonly label: string }[] = [
  { group: 'per-observation', label: 'Per-Observation checks' },
  { group: 'run-level', label: 'Run-level checks' },
];
