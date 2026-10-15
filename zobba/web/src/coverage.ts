// Story 24.2 coverage: population manifests, sample manifests, coverage
// summaries and the exact member page of one population. Every response is
// strictly parsed. Counts are exact digit strings; a count trusted code could
// not establish is a sentence, never a number or a blank. There are no
// percentages and no confidence score anywhere.
import { readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import { parseSource } from './citation.ts';
import { cursor, identifier } from './conversation.ts';
import { parseScope } from './engagements.ts';
import type { Scope } from './engagements.ts';
import type { components } from './generated/api.ts';
import {
  array, boolean, count, digest, exact, factTypes, invalid, measure, name, nullable, oneOf, record, rules, subject, text,
} from './assessment.ts';

export type CoveragePopulation = components['schemas']['CoveragePopulationResponse'];
export type CoverageSample = components['schemas']['CoverageSampleResponse'];
export type CoverageSummary = components['schemas']['CoverageSummaryResponse'];
export type PopulationCounts = components['schemas']['PopulationCountsResponse'];
export type CriterionCounts = components['schemas']['CriterionCountsResponse'];
export type PopulationMembers = components['schemas']['PopulationMembersResponse'];
export type Member = components['schemas']['MemberResponse'];

export const dispositions = ['in_scope', 'excluded', 'scope_unknown', 'duplicate_row', 'unkeyed'] as const;
export type Disposition = typeof dispositions[number];
const dispositionReasons = ['out_of_period', 'period_unparsed', 'period_missing', 'conflicting_duplicate'] as const;
const incompleteReasons = ['not_exhaustive', 'row_bound', 'count_mismatch'] as const;
export const conclusions = ['no_eligible_items', 'exceptions_found', 'exceptions_found_inconclusive', 'no_exception_found', 'inconclusive', 'no_items_found_absence_not_proven'] as const;
const evaluationReasons = ['missing_fact', 'fact_unavailable', 'fact_ambiguous', 'fact_unsupported', 'unit_mismatch', 'unknown_applicability', 'authority_unverified', 'analysis_failed', 'subject_unverified', 'unit_unverified', 'not_evaluated'] as const;

/** A header (cell text) as the manifest names it. */
function header(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || new TextEncoder().encode(value).length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) invalid();
  return value;
}
function n(value: unknown): bigint { return BigInt(cursor(value)); }

function parseCounts(value: unknown): PopulationCounts {
  const v = record(value);
  const c: PopulationCounts = {
    received_rows: cursor(v.received_rows), unkeyed: cursor(v.unkeyed), duplicate_rows: cursor(v.duplicate_rows),
    distinct_subjects: cursor(v.distinct_subjects), excluded_out_of_period: cursor(v.excluded_out_of_period),
    scope_unknown_period_unparsed: cursor(v.scope_unknown_period_unparsed), scope_unknown_period_missing: cursor(v.scope_unknown_period_missing),
    scope_unknown_conflicting_duplicate: cursor(v.scope_unknown_conflicting_duplicate), in_scope: cursor(v.in_scope),
  };
  // Every received row is exactly one disposition; distinct subjects are the
  // keyed rows less the collapsed duplicates (one grain, never mixed).
  if (n(c.received_rows) !== n(c.unkeyed) + n(c.duplicate_rows) + n(c.excluded_out_of_period) + n(c.scope_unknown_period_unparsed)
    + n(c.scope_unknown_period_missing) + n(c.scope_unknown_conflicting_duplicate) + n(c.in_scope)
    || n(c.distinct_subjects) > n(c.received_rows) - n(c.unkeyed) - n(c.duplicate_rows)) invalid();
  return exact(v, c);
}

export function parsePopulation(value: unknown): CoveragePopulation {
  const v = record(value);
  const population: CoveragePopulation = {
    id: identifier(v.id),
    invocation_id: identifier(v.invocation_id),
    basis_id: identifier(v.basis_id),
    key: identifier(v.key),
    supersedes: nullable(v.supersedes, identifier),
    original_id: identifier(v.original_id),
    original_sha256: digest(v.original_sha256),
    filename: nullable(v.filename, value => text(value, 255)),
    sheet: nullable(v.sheet, value => text(value, 31)),
    header_row: count(v.header_row, 1000),
    subject_unit: name(v.subject_unit),
    grain: array(v.grain, 3).map(header),
    period_column: nullable(v.period_column, header),
    period_rule: nullable(v.period_rule, value => oneOf(value, rules)),
    values: array(v.values, 8).map(item => {
      const c = record(item);
      return exact(c, {
        header: header(c.header), name: name(c.name), fact_type: oneOf(c.fact_type, factTypes), rule: oneOf(c.rule, rules),
        measure: nullable(c.measure, measure), measure_column: nullable(c.measure_column, header),
      });
    }),
    exhaustive: boolean(v.exhaustive),
    selection: text(v.selection, 500),
    declared_count: nullable(v.declared_count, cursor),
    control_source: nullable(v.control_source, parseSource),
    job_id: nullable(v.job_id, identifier),
    last_row: count(v.last_row, 1_048_576),
    rows_read: count(v.rows_read, 20_000),
    truncated: boolean(v.truncated),
    completeness: oneOf(v.completeness, ['complete', 'incomplete'] as const),
    incomplete_reason: nullable(v.incomplete_reason, value => oneOf(value, incompleteReasons)),
    reconciliation: oneOf(v.reconciliation, ['matched', 'mismatch', 'not_declared'] as const),
    counts: parseCounts(v.counts),
    methodology_binding_id: identifier(v.methodology_binding_id),
    execution_epoch: cursor(v.execution_epoch),
  };
  if (population.grain.length === 0
    || (population.completeness === 'complete') !== (population.incomplete_reason === null)
    // Complete needs the agent's exhaustive statement and every row read.
    || (population.completeness === 'complete' && (!population.exhaustive || population.truncated))
    || (!population.exhaustive && population.incomplete_reason !== 'not_exhaustive')
    || (population.reconciliation === 'not_declared') !== (population.declared_count === null)
    || (population.declared_count === null) !== (population.control_source === null)
    || (population.period_column === null) !== (population.period_rule === null)) invalid();
  return exact(v, population);
}

export function parseSample(value: unknown): CoverageSample {
  const v = record(value);
  const sample: CoverageSample = {
    id: identifier(v.id),
    invocation_id: identifier(v.invocation_id),
    population_id: identifier(v.population_id),
    key: identifier(v.key),
    method: oneOf(v.method, ['all_in_scope', 'judgmental', 'seeded_random'] as const),
    seed: nullable(v.seed, value => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n) invalid(); return value; }),
    algorithm: nullable(v.algorithm, value => oneOf(value, ['splitmix64-fisher-yates-v1'] as const)),
    size: count(v.size, 20_000),
    strata: typeof v.strata === 'string' && v.strata === '' ? '' : text(v.strata, 500),
    justification: text(v.justification, 1000),
    selected_count: cursor(v.selected_count),
    keys_withheld: boolean(v.keys_withheld),
    keys: array(v.keys, 200).map(subject),
    substitutions: array(v.substitutions, 16).map(item => {
      const s = record(item);
      return exact(s, { replaced: subject(s.replaced), substitute: subject(s.substitute), reason: text(s.reason, 500) });
    }),
    statistical_inference: boolean(v.statistical_inference),
    methodology_binding_id: identifier(v.methodology_binding_id),
    execution_epoch: cursor(v.execution_epoch),
  };
  if (sample.statistical_inference
    || (sample.method === 'seeded_random') !== (sample.seed !== null)
    || (sample.seed === null) !== (sample.algorithm === null)
    || BigInt(sample.selected_count) !== BigInt(sample.size)
    || (sample.keys_withheld && (sample.keys.length > 0 || sample.substitutions.length > 0))) invalid();
  return exact(v, sample);
}

function parseCriterionCounts(value: unknown): CriterionCounts {
  const v = record(value);
  const c: CriterionCounts = {
    criterion_id: identifier(v.criterion_id),
    applicable: cursor(v.applicable), not_applicable: cursor(v.not_applicable), applicability_unknown: cursor(v.applicability_unknown),
    met: cursor(v.met), not_met: cursor(v.not_met), undetermined: cursor(v.undetermined),
    undetermined_by_reason: array(v.undetermined_by_reason, 16).map(item => {
      const r = record(item);
      return exact(r, { reason: oneOf(r.reason, evaluationReasons), count: cursor(r.count) });
    }),
    execution_failed: cursor(v.execution_failed), not_evaluated: cursor(v.not_evaluated),
  };
  const byReason = c.undetermined_by_reason.reduce((sum, r) => sum + BigInt(r.count), 0n);
  if (n(c.applicable) !== n(c.met) + n(c.not_met) + n(c.undetermined) + n(c.execution_failed) + n(c.not_evaluated)
    || byReason !== n(c.undetermined)) invalid();
  return exact(v, c);
}

export function parseSummary(value: unknown): CoverageSummary {
  const v = record(value);
  const summary: CoverageSummary = {
    id: identifier(v.id),
    invocation_id: identifier(v.invocation_id),
    basis_id: identifier(v.basis_id),
    population_id: identifier(v.population_id),
    sample_id: nullable(v.sample_id, identifier),
    aggregation: oneOf(v.aggregation, ['subject_partition_v1'] as const),
    conclusion: oneOf(v.conclusion, conclusions),
    completeness: oneOf(v.completeness, ['complete', 'incomplete'] as const),
    incomplete_reason: nullable(v.incomplete_reason, value => oneOf(value, incompleteReasons)),
    reconciliation: oneOf(v.reconciliation, ['matched', 'mismatch', 'not_declared'] as const),
    declared_count: nullable(v.declared_count, cursor),
    counts: parseCounts(v.counts),
    selected: nullable(v.selected, cursor),
    criteria: array(v.criteria, 16).map(parseCriterionCounts),
    failing_subjects: cursor(v.failing_subjects),
    meets_every_applicable: cursor(v.meets_every_applicable),
    unresolved_subjects: cursor(v.unresolved_subjects),
    not_applicable_to_any: cursor(v.not_applicable_to_any),
    failing_opportunities: cursor(v.failing_opportunities),
    statistical_inference: boolean(v.statistical_inference),
    limitations: array(v.limitations, 16).map(item => text(item, 500)),
    summary_sha256: digest(v.summary_sha256),
    methodology_binding_id: identifier(v.methodology_binding_id),
    execution_epoch: cursor(v.execution_epoch),
  };
  const domain = summary.selected === null ? n(summary.counts.in_scope) : BigInt(summary.selected);
  const notMet = summary.criteria.reduce((sum, c) => sum + BigInt(c.not_met), 0n);
  // The same arithmetic the database recounts: the partition covers every
  // in-scope (or selected) subject once, and failing opportunities are the
  // not-met counts, never failing records.
  if (summary.statistical_inference
    || (summary.sample_id === null) !== (summary.selected === null)
    || (summary.completeness === 'complete') !== (summary.incomplete_reason === null)
    || n(summary.failing_subjects) + n(summary.meets_every_applicable) + n(summary.unresolved_subjects) + n(summary.not_applicable_to_any) !== domain
    || notMet !== n(summary.failing_opportunities)
    || n(summary.failing_subjects) > n(summary.failing_opportunities)
    // Never a pass on an incomplete population, a sample or zero applicable.
    || (summary.conclusion === 'no_exception_found' && (summary.completeness !== 'complete' || summary.sample_id !== null
      || n(summary.failing_subjects) + n(summary.unresolved_subjects) > 0n || n(summary.meets_every_applicable) === 0n))
    || ((summary.conclusion === 'exceptions_found' || summary.conclusion === 'exceptions_found_inconclusive') && n(summary.failing_subjects) === 0n)
    || (summary.conclusion === 'no_eligible_items' && (summary.completeness !== 'complete' || n(summary.meets_every_applicable) + n(summary.failing_subjects) + n(summary.unresolved_subjects) > 0n))) invalid();
  return exact(v, summary);
}

function parseMember(value: unknown, withheld: boolean): Member {
  const v = record(value);
  const disposition = oneOf(v.disposition, dispositions);
  const member: Member = {
    ordinal: count(v.ordinal, 20_000),
    row: count(v.row, 1_048_576),
    subject: nullable(v.subject, subject),
    disposition,
    reason: nullable(v.reason, value => oneOf(value, dispositionReasons)),
    duplicate_of: nullable(v.duplicate_of, value => count(value, 20_000)),
    cells: array(v.cells, 12).map(item => {
      const c = record(item);
      return exact(c, { column: header(c.column), text: nullable(c.text, value => { if (typeof value !== 'string' || new TextEncoder().encode(value).length > 256) invalid(); return value; }), location: nullable(c.location, value => text(value, 80)) });
    }),
    values: array(v.values, 8).map(item => {
      const x = record(item);
      return exact(x, {
        name: name(x.name), state: oneOf(x.state, ['value', 'missing', 'unsupported'] as const),
        value: nullable(x.value, value => text(value, 1000)), measure: nullable(x.measure, measure), measure_grounded: nullable(x.measure_grounded, boolean),
      });
    }),
  };
  if ((disposition === 'excluded' || disposition === 'scope_unknown') !== (member.reason !== null)
    || (disposition === 'excluded' && member.reason !== 'out_of_period')
    || (disposition === 'duplicate_row') !== (member.duplicate_of !== null)
    || (withheld && (member.subject !== null || member.cells.some(c => c.text !== null) || member.values.some(x => x.value !== null)))
    || (!withheld && (disposition === 'unkeyed') === (member.subject !== null))) invalid();
  return exact(v, member);
}

export function parseMembers(value: unknown, populationId: string, disposition: Disposition | null): PopulationMembers {
  const v = record(value);
  const withheld = boolean(v.values_withheld);
  const page: PopulationMembers = {
    population: parsePopulation(v.population),
    disposition: nullable(v.disposition, value => oneOf(value, dispositions)),
    total: cursor(v.total),
    values_withheld: withheld,
    members: array(v.members, 50).map(item => parseMember(item, withheld)),
    next_cursor: nullable(v.next_cursor, value => { if (typeof value !== 'string' || !/^[0-9]{1,10}$/.test(value)) invalid(); return value; }),
  };
  if (page.population.id !== populationId || page.disposition !== disposition
    || BigInt(page.total) < BigInt(page.members.length)
    || (disposition !== null && page.members.some(m => m.disposition !== disposition))) invalid();
  return exact(v, page);
}

export async function readMembers(scope: Scope, taskId: string, populationId: string, disposition: Disposition | null, after: string | null, session: Session | null, signal: AbortSignal): Promise<PopulationMembers> {
  parseScope(scope);
  const query = new URLSearchParams({ organisation_id: scope.organisation_id, client_id: scope.client_id });
  if (disposition) query.set('disposition', disposition);
  if (after) query.set('cursor', after);
  const path = `/engagements/${encodeURIComponent(scope.engagement_id)}/tasks/${identifier(taskId)}/assessment/populations/${identifier(populationId)}/members?${query}`;
  return parseMembers(await readSessionJson(path, session, signal), populationId, disposition);
}

// ------------------------------------------------------------------ words

/** A count with its unit; on an incomplete population, a lower bound. */
export function found(value: string, unit: string, complete: boolean): string {
  const plural = value === '1' ? unit : `${unit}s`;
  const number = BigInt(value).toLocaleString('en-GB');
  return complete ? `${number} ${plural}` : `at least ${number} ${plural} found`;
}

export const conclusionLabel: Record<string, string> = {
  no_eligible_items: 'No eligible items; operating effectiveness was not demonstrated.',
  exceptions_found: 'Exceptions found.',
  exceptions_found_inconclusive: 'Exceptions found; overall assessment inconclusive.',
  no_exception_found: 'No exception found.',
  inconclusive: 'Inconclusive.',
  no_items_found_absence_not_proven: 'No items found; absence is not proven.',
};

/** The conclusion sentence. A sample's conclusion names its selected items. */
export function conclusionSentence(summary: CoverageSummary): string {
  const sentence = conclusionLabel[summary.conclusion] ?? 'Inconclusive.';
  return summary.sample_id === null ? sentence : `Among the selected items only: ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)} Nothing is concluded about items not selected.`;
}

export const incompleteLabel: Record<string, string> = {
  not_exhaustive: 'the source was declared not exhaustive (for example a search or filtered export)',
  row_bound: 'not every row could be read',
  count_mismatch: 'the cited control count does not match the distinct items found',
};

export function completenessSentence(c: { completeness: string; incomplete_reason: string | null }): string {
  return c.completeness === 'complete'
    ? 'Complete: every row to the end of the source was read.'
    : `Incomplete: ${incompleteLabel[c.incomplete_reason ?? ''] ?? 'completeness not proven'}. The total is not known.`;
}

export function reconciliationSentence(c: { reconciliation: string; declared_count: string | null; counts: PopulationCounts }): string {
  if (c.reconciliation === 'not_declared') return 'No control count was cited; the total is not reconciled.';
  if (c.reconciliation === 'matched') return `Reconciled: the cited control count matches ${BigInt(c.counts.distinct_subjects).toLocaleString('en-GB')} distinct items.`;
  return `Not reconciled: the cited control count is ${BigInt(c.declared_count ?? '0').toLocaleString('en-GB')}; ${BigInt(c.counts.distinct_subjects).toLocaleString('en-GB')} distinct items were found.`;
}

export const dispositionLabel: Record<string, string> = {
  in_scope: 'In scope', excluded: 'Excluded', scope_unknown: 'Scope unknown', duplicate_row: 'Duplicate row', unkeyed: 'No key',
};
export const dispositionReasonLabel: Record<string, string> = {
  out_of_period: 'outside the basis period', period_unparsed: 'its date does not parse',
  period_missing: 'its date is blank', conflicting_duplicate: 'the same key appears with different values',
};
