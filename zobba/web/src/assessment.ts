// Story 24.1 assessment basis. Every response is strictly parsed. Criterion,
// fact and basis text is attributed data: it is rendered as text and grants
// no authority. Applicability, execution, verdict and origin are separate
// fields; there is no confidence score anywhere.
import { parseSource } from './citation.ts';
import { cursor, identifier } from './conversation.ts';
import type { components } from './generated/api.ts';

export type Assessment = components['schemas']['AssessmentResponse'];
export type AssessmentBasis = components['schemas']['AssessmentBasisResponse'];
export type AssessmentCriterion = components['schemas']['AssessmentCriterionResponse'];
export type AssessmentFact = components['schemas']['AssessmentFactResponse'];
export type AssessmentEvaluation = components['schemas']['AssessmentEvaluationResponse'];

function invalid(): never { throw new Error('Invalid assessment response'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
/** The response has exactly the parsed keys: an unknown field (for example a
 * `confidence` score) refuses the response rather than being dropped. */
function exact<T extends object>(source: Record<string, unknown>, parsed: T): T {
  const keys = new Set(Object.keys(parsed));
  if (Object.keys(source).some(key => !keys.has(key)) || Object.keys(source).length !== keys.size) invalid();
  return parsed;
}
// Rust's `str::trim` removes Unicode White_Space only; JavaScript `trim` also
// removes U+FEFF, which Rust keeps. Blank means White_Space only.
const blank = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid();
  return value as T;
}
const bytes = (value: string) => new TextEncoder().encode(value).length;
/** Attributed text: bounded UTF-8 bytes, not blank, no control characters but line breaks and tabs. */
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || blank.test(value) || bytes(value) > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)) invalid();
  return value;
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) invalid();
  return value;
}
/** A subject exactly as stated (leading zeros kept). */
function subject(value: unknown): string {
  if (typeof value !== 'string' || blank.test(value) || bytes(value) > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) invalid();
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) invalid();
  return value;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}
function count(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) invalid();
  return value;
}
function measure(value: unknown): string {
  if (typeof value !== 'string' || !(/^[A-Z]{3}$/.test(value) || /^[a-z][a-z0-9_]{0,63}$/.test(value))) invalid();
  return value;
}

const factTypes = ['identifier', 'text', 'boolean', 'enum', 'decimal', 'date', 'instant'] as const;
const authorityReasons = ['not_found_at_location', 'location_missing', 'source_unreadable', 'page_only', 'method_changed', 'criterion_not_found'] as const;
const evaluationReasons = ['missing_fact', 'fact_unavailable', 'fact_ambiguous', 'fact_unsupported', 'unit_mismatch', 'unknown_applicability', 'authority_unverified', 'analysis_failed', 'subject_unverified', 'unit_unverified'] as const;
const supportReasons = ['type_mismatch', 'source_unverified', 'analysis_failed', 'partial_value'] as const;
const rules = ['identifier_exact', 'text_exact', 'enum_exact', 'boolean_yes_no', 'boolean_true_false', 'decimal_plain', 'decimal_grouped_comma', 'date_iso', 'date_dmy', 'instant_rfc3339'] as const;

function parseCriterion(value: unknown): AssessmentCriterion {
  const v = record(value);
  const kind = oneOf(v.kind, ['rule', 'judgment'] as const);
  const authorityKind = oneOf(v.authority_kind, ['method', 'original'] as const);
  const criterion: AssessmentCriterion = {
    id: identifier(v.id),
    invocation_id: identifier(v.invocation_id),
    key: identifier(v.key),
    supersedes: nullable(v.supersedes, identifier),
    assertion: text(v.assertion, 1000),
    kind,
    authority_kind: authorityKind,
    authority_verified: boolean(v.authority_verified),
    authority_reason: nullable(v.authority_reason, value => oneOf(value, authorityReasons)),
    requirement_id: nullable(v.requirement_id, identifier),
    criterion_ordinal: nullable(v.criterion_ordinal, value => count(value, 31)),
    authority_text_sha256: nullable(v.authority_text_sha256, digest),
    authority_source: nullable(v.authority_source, parseSource),
    effective_from: nullable(v.effective_from, date),
    effective_to: nullable(v.effective_to, date),
    applicability: nullable(v.applicability, value => text(value, 4000)),
    rule: nullable(v.rule, value => text(value, 4000)),
    rubric: nullable(v.rubric, value => text(value, 2000)),
    required_facts: array(v.required_facts, 8).map(item => {
      const r = record(item);
      return exact(r, { name: name(r.name), fact_type: oneOf(r.fact_type, factTypes), measure: nullable(r.measure, measure) });
    }),
    methodology_binding_id: identifier(v.methodology_binding_id),
    execution_epoch: cursor(v.execution_epoch),
  };
  if (criterion.authority_verified !== (criterion.authority_reason === null)
    || (kind === 'rule') !== (criterion.rule !== null) || (kind === 'judgment') !== (criterion.rubric !== null)
    || (authorityKind === 'method') !== (criterion.requirement_id !== null)
    || (authorityKind === 'original') !== (criterion.authority_source !== null)) invalid();
  return exact(v, criterion);
}

function parseBasis(value: unknown): AssessmentBasis {
  const v = record(value);
  const basis: AssessmentBasis = {
    id: identifier(v.id),
    invocation_id: identifier(v.invocation_id),
    key: identifier(v.key),
    supersedes: nullable(v.supersedes, identifier),
    objective: text(v.objective, 1000),
    criteria: array(v.criteria, 16).map(identifier),
    period_from: date(v.period_from),
    period_to: date(v.period_to),
    as_of: nullable(v.as_of, value => text(value, 40)),
    population: array(v.population, 8).map(item => {
      const p = record(item);
      return exact(p, {
        original_id: identifier(p.original_id), unit: name(p.unit), selection: text(p.selection, 500),
        sha256: nullable(p.sha256, digest), filename: nullable(p.filename, value => text(value, 255)),
      });
    }),
    limitations: array(v.limitations, 8).map(item => text(item, 500)),
    methodology_binding_id: identifier(v.methodology_binding_id),
    execution_epoch: cursor(v.execution_epoch),
  };
  if (basis.criteria.length === 0 || basis.period_from > basis.period_to) invalid();
  return exact(v, basis);
}

function parseFact(value: unknown): AssessmentFact {
  const v = record(value);
  const valueKind = oneOf(v.value_kind, [...factTypes, 'unavailable', 'ambiguous'] as const);
  const support = oneOf(v.support, ['supported', 'unsupported', 'no_value'] as const);
  const fact: AssessmentFact = {
    id: identifier(v.id),
    invocation_id: identifier(v.invocation_id),
    basis_id: identifier(v.basis_id),
    subject: subject(v.subject),
    subject_unit: name(v.subject_unit),
    name: name(v.name),
    value_kind: valueKind,
    value_withheld: boolean(v.value_withheld),
    value: nullable(v.value, value => text(value, 1000)),
    measure: nullable(v.measure, measure),
    mantissa: nullable(v.mantissa, value => { if (typeof value !== 'string' || !/^-?\d{1,19}$/.test(value)) invalid(); return value; }),
    scale: nullable(v.scale, value => count(value, 18)),
    utc: nullable(v.utc, value => text(value, 40)),
    offset_minutes: nullable(v.offset_minutes, value => { if (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > 840) invalid(); return value; }),
    unavailable_reason: nullable(v.unavailable_reason, value => oneOf(value, ['evidence_unavailable', 'action_not_permitted', 'tool_unavailable', 'source_unreadable'] as const)),
    candidates: nullable(v.candidates, value => count(value, 64)),
    rule: nullable(v.rule, value => oneOf(value, rules)),
    support,
    support_reason: nullable(v.support_reason, value => oneOf(value, supportReasons)),
    subject_grounded: boolean(v.subject_grounded),
    measure_grounded: nullable(v.measure_grounded, boolean),
    job_id: nullable(v.job_id, identifier),
    sources: array(v.sources, 4).map(parseSource),
    methodology_binding_id: identifier(v.methodology_binding_id),
    execution_epoch: cursor(v.execution_epoch),
  };
  const valued = valueKind !== 'unavailable' && valueKind !== 'ambiguous';
  // A withheld value (its original is not open to this viewer) has every
  // quote-derived field null; otherwise the typed fields pair with the kind.
  const shown = valued && !fact.value_withheld;
  if ((support === 'unsupported') !== (fact.support_reason !== null)
    || (fact.value_withheld && !valued)
    || shown !== (fact.value !== null) || valued !== (fact.rule !== null)
    || (valueKind === 'decimal') !== (fact.measure !== null)
    || (valueKind === 'decimal') !== (fact.measure_grounded !== null)
    || (valueKind === 'decimal' && shown) !== (fact.mantissa !== null && fact.scale !== null)
    || (fact.mantissa === null) !== (fact.scale === null)
    || (valueKind === 'instant' && shown) !== (fact.utc !== null && fact.offset_minutes !== null)
    || (fact.utc === null) !== (fact.offset_minutes === null)
    || (valueKind === 'unavailable') !== (fact.unavailable_reason !== null)
    || (valueKind === 'ambiguous') !== (fact.candidates !== null)) invalid();
  return exact(v, fact);
}

function parseEvaluation(value: unknown): AssessmentEvaluation {
  const v = record(value);
  const evaluation: AssessmentEvaluation = {
    id: identifier(v.id),
    invocation_id: identifier(v.invocation_id),
    basis_id: identifier(v.basis_id),
    criterion_id: identifier(v.criterion_id),
    subject: subject(v.subject),
    applicability: oneOf(v.applicability, ['applicable', 'not_applicable', 'unknown'] as const),
    execution: oneOf(v.execution, ['completed', 'failed'] as const),
    verdict: nullable(v.verdict, value => oneOf(value, ['met', 'not_met', 'undetermined'] as const)),
    reason: nullable(v.reason, value => oneOf(value, evaluationReasons)),
    origin: oneOf(v.origin, ['deterministic', 'model_proposal'] as const),
    inputs: array(v.inputs, 32).map(item => {
      const i = record(item);
      return exact(i, { fact_id: identifier(i.fact_id), digest: digest(i.digest) });
    }),
    output_digest: digest(v.output_digest),
    judgment: nullable(v.judgment, item => {
      const j = record(item);
      return exact(j, {
        supporting: array(j.supporting, 8).map(identifier), contrary: array(j.contrary, 8).map(identifier),
        rationale: text(j.rationale, 2000), uncertainty: typeof j.uncertainty === 'string' && j.uncertainty === '' ? '' : text(j.uncertainty, 2000),
      });
    }),
    methodology_binding_id: identifier(v.methodology_binding_id),
    execution_epoch: cursor(v.execution_epoch),
  };
  // The same structural rules the database enforces.
  const decided = evaluation.verdict === 'met' || evaluation.verdict === 'not_met';
  if ((decided && (evaluation.applicability !== 'applicable' || evaluation.execution !== 'completed' || evaluation.reason !== null || evaluation.inputs.length === 0))
    || (evaluation.execution === 'failed' && (evaluation.verdict !== null || evaluation.reason !== 'analysis_failed'))
    || (evaluation.applicability === 'not_applicable' && evaluation.verdict !== null)
    // A deterministic undetermined verdict names its closed reason.
    || (evaluation.verdict === 'undetermined' && evaluation.origin === 'deterministic' && evaluation.reason === null)
    || (evaluation.origin === 'model_proposal') !== (evaluation.judgment !== null)) invalid();
  return exact(v, evaluation);
}

/** The Task's assessment bases, criteria, facts and evaluations. */
export function parseAssessment(value: unknown): Assessment {
  const v = record(value);
  const assessment: Assessment = {
    bases: array(v.bases, 64).map(parseBasis),
    total_bases: cursor(v.total_bases),
    criteria: array(v.criteria, 64).map(parseCriterion),
    total_criteria: cursor(v.total_criteria),
    facts: array(v.facts, 1024).map(parseFact),
    total_facts: cursor(v.total_facts),
    evaluations: array(v.evaluations, 256).map(parseEvaluation),
    total_evaluations: cursor(v.total_evaluations),
  };
  if (BigInt(assessment.total_bases) < BigInt(assessment.bases.length)
    || BigInt(assessment.total_criteria) < BigInt(assessment.criteria.length)
    || BigInt(assessment.total_facts) < BigInt(assessment.facts.length)
    || BigInt(assessment.total_evaluations) < BigInt(assessment.evaluations.length)) invalid();
  return exact(v, assessment);
}

export const applicabilityLabel: Record<string, string> = {
  applicable: 'Applies', not_applicable: 'Does not apply', unknown: 'Applicability unknown',
};
export const executionLabel: Record<string, string> = {
  completed: 'Evaluation completed', failed: 'Evaluation failed',
};
/** Verdict words. `null` is "no verdict", never a pass. */
export function verdictLabel(verdict: string | null): string {
  return verdict === null ? 'No verdict' : ({ met: 'Met', not_met: 'Not met (exception)', undetermined: 'Undetermined' } as Record<string, string>)[verdict] ?? verdict;
}
/** Origin words. A deterministic evaluation was computed by the platform,
 * but the rule's operator, threshold and fact names were proposed by Zobba;
 * the platform proves only the cited authority text, not that the rule
 * follows from it. */
export const originLabel: Record<string, string> = {
  deterministic: 'Platform evaluated the rule Zobba proposed', model_proposal: 'Zobba proposes — awaiting your review',
};
export function reasonLabel(reason: string): string {
  return ({
    missing_fact: 'a required fact is missing',
    fact_unavailable: 'the evidence is unavailable',
    fact_ambiguous: 'the evidence is ambiguous',
    fact_unsupported: 'a fact is not supported by its source',
    unit_mismatch: 'currencies or units differ',
    unknown_applicability: 'whether it applies is unknown',
    authority_unverified: 'the criterion authority is unverified',
    analysis_failed: 'the analysis failed',
    subject_unverified: 'the subject was not found beside its source',
    unit_unverified: 'the currency or unit is only claimed, not shown by the source',
  } as Record<string, string>)[reason] ?? reason.replaceAll('_', ' ');
}
export function supportLabel(fact: AssessmentFact): string {
  if (fact.support === 'supported') return 'Supported by its verified source';
  if (fact.support === 'no_value') return fact.value_kind === 'ambiguous' ? `Ambiguous · ${fact.candidates} candidates` : `Unavailable · ${(fact.unavailable_reason ?? '').replaceAll('_', ' ')}`;
  return ({
    type_mismatch: 'Unsupported · the source does not show this value',
    source_unverified: 'Unsupported · its source was not verified',
    analysis_failed: 'Unsupported · the analysis it depends on failed',
    partial_value: 'Unsupported · the quote is only part of a longer value',
  } as Record<string, string>)[fact.support_reason ?? ''] ?? 'Unsupported';
}
/** What the source does not show about a supported fact, in words. */
export function groundingLabel(fact: AssessmentFact): string | null {
  const notes: string[] = [];
  if (fact.value_kind !== 'unavailable' && fact.value_kind !== 'ambiguous' && !fact.subject_grounded) notes.push('subject not found beside its source');
  if (fact.measure_grounded === false) notes.push(`${fact.measure ?? 'measure'} only claimed`);
  return notes.length ? notes.join(' · ') : null;
}
/** The value as typed: decimals with their measure, instants with UTC and the source offset. */
export function valueLabel(fact: AssessmentFact): string {
  if (fact.value_withheld) return 'Value withheld — you cannot open its source';
  if (fact.value === null) return '—';
  if (fact.value_kind === 'decimal') return `${fact.value} ${fact.measure ?? ''}`.trim();
  if (fact.value_kind === 'instant' && fact.utc) return `${fact.value} (UTC ${fact.utc.replace('T', ' ').replace('Z', '')})`;
  return fact.value;
}
