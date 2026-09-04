import { canonicalJson, type JsonValue } from '../canonical-json.js';
import { bindingDigest, bindingDigestEnvelope, isDeclaredCountMechanism, isPopulationSourceKind, type BindingDigestEnvelope } from '../sources/population-source.js';

export interface ExplicitPeriod { readonly from: string; readonly to: string }
export type DecimalOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
export type InclusionPredicate =
  | { readonly column: string; readonly kind: 'text'; readonly operator: 'eq'; readonly value: string }
  | { readonly column: string; readonly kind: 'decimal'; readonly operator: DecimalOperator; readonly value: string }
  | { readonly column: string; readonly kind: 'within-period' };
export interface InclusionRule { readonly schemaVersion: 1; readonly all: readonly InclusionPredicate[] }
export interface ProcedureSourceSnapshot {
  readonly bindingId: string;
  readonly displayName: string;
  readonly digest: string;
  readonly contract: BindingDigestEnvelope;
}
export const POPULATION_DRAFT_LIMITS = { scope: 10000, predicates: 32, column: 200, text: 2000, decimal: 100 } as const;
export const POPULATION_DRAFT_MESSAGES = {
  PERIOD: 'Enter a valid explicit Period with a start date on or before the end date.',
  SCOPE: 'Enter a scope statement of no more than 10,000 characters.',
  RULE: 'Enter a valid inclusion rule using only declared Population Source columns.',
  SOURCE: 'Choose an active Population Source.',
  STALE_SOURCE: 'That Population Source changed since this page was loaded. Reload the page and try again.',
  FLAGS: 'Choose valid values for the Population Source Gate policies.',
  /**
   * Story 2.5 makes the Schedule a real, auditor-set field (`evidence-draft.js`'s
   * `DraftSchedule`) rather than pinned Template prose, and the upload/frequency pairing
   * moves from a save-time refusal here to that module's `evidenceBlockersFor` — a
   * completeness blocker surfaced inline on both sections, never silent, but never a
   * refusal either. This sentence stays exported so the two sections use one wording.
   */
  MANUAL_UPLOAD: 'A manual upload is valid only for a `once` Schedule. Bind a versioned file or an API for weekly Runs.',
  COUNT_MISSING: 'Population Source must declare an expected record count.',
} as const;
export type PopulationBlocker = 'declared-count-missing';
export interface DraftPopulationFields {
  readonly period: ExplicitPeriod | null;
  readonly scope: string;
  readonly sourceSnapshot: ProcedureSourceSnapshot | null;
  readonly inclusionRule: InclusionRule;
  readonly zeroRecordPass: boolean;
  readonly allowVersionedDuplicates: boolean;
  readonly populationBlockers: readonly PopulationBlocker[];
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function storable(value: unknown): boolean {
  try { canonicalJson(value as JsonValue); return true; } catch { return false; }
}
/** Date-only Gregorian dates, years 0001–9999. No Date parsing, rollover or timezone coercion. */
export function isGregorianDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12) return false;
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1]!;
}
export function isExplicitPeriod(value: unknown): value is ExplicitPeriod {
  return object(value) && exact(value, ['from', 'to']) && isGregorianDate(value['from']) && isGregorianDate(value['to']) && value['from'] <= value['to'];
}
export function isScopeStatement(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= POPULATION_DRAFT_LIMITS.scope && storable(value);
}
/** Decimals stay decimal strings: no exponent, whitespace, Infinity, or floating-point conversion. */
export function isRuleDecimal(value: unknown): value is string {
  return typeof value === 'string' && value.length <= POPULATION_DRAFT_LIMITS.decimal && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}
export function isInclusionRule(value: unknown, declaredColumns?: readonly string[]): value is InclusionRule {
  if (!object(value) || !exact(value, ['schemaVersion', 'all']) || value['schemaVersion'] !== 1 || !Array.isArray(value['all']) || value['all'].length > POPULATION_DRAFT_LIMITS.predicates) return false;
  return value['all'].every((predicate: unknown) => {
    if (!object(predicate) || typeof predicate['column'] !== 'string' || predicate['column'].trim() === '' || predicate['column'].length > POPULATION_DRAFT_LIMITS.column || !storable(predicate['column'])) return false;
    if (declaredColumns !== undefined && !declaredColumns.includes(predicate['column'])) return false;
    if (predicate['kind'] === 'within-period') return exact(predicate, ['column', 'kind']);
    if (!exact(predicate, ['column', 'kind', 'operator', 'value'])) return false;
    if (predicate['kind'] === 'text') return predicate['operator'] === 'eq' && typeof predicate['value'] === 'string' && predicate['value'].length <= POPULATION_DRAFT_LIMITS.text && storable(predicate['value']);
    return predicate['kind'] === 'decimal' && typeof predicate['operator'] === 'string' && ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(predicate['operator']) && isRuleDecimal(predicate['value']);
  });
}
export function isProcedureSourceSnapshot(value: unknown): value is ProcedureSourceSnapshot {
  if (!object(value) || !exact(value, ['bindingId', 'displayName', 'digest', 'contract']) || typeof value['bindingId'] !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value['bindingId']) || typeof value['displayName'] !== 'string' || value['displayName'].trim() === '' || value['displayName'].length > 200 || typeof value['digest'] !== 'string' || !/^[0-9a-f]{64}$/.test(value['digest'])) return false;
  const c = value['contract'];
  if (!object(c) || !exact(c, ['kind', 'location', 'declared_schema', 'declared_count_mechanism', 'sensitive_fields']) || !isPopulationSourceKind(c['kind']) || !isDeclaredCountMechanism(c['declared_count_mechanism']) || !(c['location'] === null || typeof c['location'] === 'string') || !Array.isArray(c['declared_schema']) || c['declared_schema'].length === 0 || c['declared_schema'].length > 200 || !c['declared_schema'].every((v: unknown) => typeof v === 'string' && v.length <= 200) || !Array.isArray(c['sensitive_fields']) || !c['sensitive_fields'].every((v: unknown) => typeof v === 'string' && (c['declared_schema'] as string[]).includes(v))) return false;
  if (c['kind'] === 'manual-upload' ? c['location'] !== null : typeof c['location'] !== 'string' || c['location'].trim() === '') return false;
  const input = { kind: c['kind'], location: c['location'] ?? '', declaredSchema: c['declared_schema'] as string[], declaredCountMechanism: c['declared_count_mechanism'], sensitiveFields: c['sensitive_fields'] as string[] };
  try { return storable(value) && canonicalJson(c as JsonValue) === canonicalJson(bindingDigestEnvelope(input) as unknown as JsonValue) && bindingDigest(input) === value['digest']; } catch { return false; }
}
export function populationBlockersFor(source: ProcedureSourceSnapshot | null): readonly PopulationBlocker[] {
  return source?.contract.declared_count_mechanism === 'none' ? ['declared-count-missing'] : [];
}
/**
 * The Population Source's own validity, independent of the Schedule.
 *
 * The upload/frequency pairing used to be checked here, against the Schedule's PINNED
 * Template prose — the only Schedule that existed before this story. Now that the
 * Schedule is a real, auditor-set field (`evidence-draft.js`'s `DraftSchedule`), that
 * pairing is a completeness blocker (`evidenceBlockersFor`) surfaced on both sections,
 * never a save-time refusal here.
 */
export function validatePopulationBinding(source: ProcedureSourceSnapshot, rule: unknown): string | null {
  if (!isProcedureSourceSnapshot(source)) return POPULATION_DRAFT_MESSAGES.SOURCE;
  if (!isInclusionRule(rule, source.contract.declared_schema)) return POPULATION_DRAFT_MESSAGES.RULE;
  return null;
}
/** Reads historical snapshots without resolving or rewriting the current registration. */
export function isDraftPopulationFields(value: DraftPopulationFields): boolean {
  return (value.period === null || isExplicitPeriod(value.period)) && (value.scope === '' || isScopeStatement(value.scope)) && (value.sourceSnapshot === null || isProcedureSourceSnapshot(value.sourceSnapshot)) && isInclusionRule(value.inclusionRule, value.sourceSnapshot?.contract.declared_schema) && typeof value.zeroRecordPass === 'boolean' && typeof value.allowVersionedDuplicates === 'boolean' && Array.isArray(value.populationBlockers) && JSON.stringify(value.populationBlockers) === JSON.stringify(populationBlockersFor(value.sourceSnapshot));
}
