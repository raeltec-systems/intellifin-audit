import { canonicalJson, type JsonValue } from '../canonical-json.js';
import { isRuleDecimal } from './population-draft.js';

/** Frozen, closed data contract. Nothing in this vocabulary is executable authored code. */
export const COMPLIANCE_SCHEMA_VERSION = 1 as const;
export const COMPLIANCE_COMPILER_VERSION = '1' as const;
export const COMPLIANCE_LIMITS = { conditions: 32, text: 10000, expression: 2000, nodes: 64, depth: 12, values: 32 } as const;
export const COMPLIANCE_MESSAGES = {
  INPUT: 'Enter valid Compliance Rule conditions with unique stable ids and storable text.',
  APPLICABILITY: 'Enter a supported applicability expression over declared Observation fields.',
  NUMBER: 'Enter exact decimal comparison values and a non-negative tolerance.',
  CONFIDENCE: 'Enter one finite Agent-Judged confidence threshold from 0 to 1.',
  COMPILER: 'This Procedure Version uses an unsupported Compliance Rule compiler version.',
} as const;

export type BoundarySemantics = 'inclusive' | 'exclusive';
export interface ComplianceComparison {
  readonly boundary: BoundarySemantics;
  readonly threshold: string;
  readonly tolerance: string;
}
export interface ComplianceConditionInput {
  readonly conditionId: string;
  readonly text: string;
  readonly applicability: string;
  readonly comparison: ComplianceComparison | null;
}
export interface ComplianceDraftInput {
  readonly conditions: readonly ComplianceConditionInput[];
  readonly confidenceThreshold: string;
}
export type ComparisonOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
export type CompliancePredicate =
  | { readonly kind: 'constant'; readonly value: boolean }
  | { readonly kind: 'boolean'; readonly field: string; readonly value: boolean }
  | { readonly kind: 'numeric'; readonly field: string; readonly operator: ComparisonOperator; readonly value: string; readonly tolerance: string }
  | { readonly kind: 'time'; readonly field: string; readonly operator: ComparisonOperator; readonly otherField: string }
  | { readonly kind: 'named-set'; readonly field: string; readonly compliant: readonly string[]; readonly exception: readonly string[] }
  | { readonly kind: 'all' | 'any'; readonly expressions: readonly CompliancePredicate[] }
  | { readonly kind: 'not'; readonly expression: CompliancePredicate };

export type ComplianceRule =
  | { readonly kind: 'predicate'; readonly predicate: CompliancePredicate }
  | { readonly kind: 'disablement-window'; readonly disabledField: 'disabled_time'; readonly terminationField: 'termination_time'; readonly hours: string; readonly boundary: BoundarySemantics; readonly tolerance: string }
  | { readonly kind: 'approval'; readonly amountField: 'amount'; readonly currencyField: 'currency'; readonly decisionField: 'decision'; readonly decisionTimeField: 'decided_at'; readonly processedTimeField: 'processed_time'; readonly limitField: 'approver_limit'; readonly threshold: string; readonly boundary: BoundarySemantics; readonly tolerance: string }
  | { readonly kind: 'permission-pairs'; readonly rolesField: 'roles'; readonly prohibitedPairs: readonly (readonly [string, string])[] }
  | { readonly kind: 'baseline'; readonly parameterField: 'parameter'; readonly observedField: 'observed_value'; readonly observationTimeField: 'observation_time'; readonly tolerance: string };

export interface CompiledComplianceCondition extends ComplianceConditionInput {
  readonly applicabilityAst: CompliancePredicate;
  readonly rule: ComplianceRule | null;
  readonly status: 'RULE' | 'AGENT_JUDGED';
}
export interface DraftComplianceFields {
  readonly complianceSchemaVersion: 1;
  readonly complianceCompilerVersion: '1';
  readonly complianceConditions: readonly CompiledComplianceCondition[];
  readonly agentJudgedThreshold: string;
}
export type ComplianceCompilation = { readonly ok: true; readonly value: DraftComplianceFields } | { readonly ok: false; readonly reason: string };

export function complianceObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function complianceExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
export function isComplianceText(value: unknown, limit: number): value is string {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) return false;
  try { canonicalJson(value); return true; } catch { return false; }
}

/** Decimal operations use scaled integers throughout; no binary rounding or exponent coercion. */
function decimalParts(value: string): { units: bigint; scale: number } {
  if (!isRuleDecimal(value)) throw new Error(COMPLIANCE_MESSAGES.NUMBER);
  const [whole = '', fraction = ''] = value.split('.');
  return { units: BigInt(whole + fraction), scale: fraction.length };
}
function decimalAligned(a: string, b: string): readonly [bigint, bigint, number] {
  const left = decimalParts(a), right = decimalParts(b), scale = Math.max(left.scale, right.scale);
  return [left.units * 10n ** BigInt(scale - left.scale), right.units * 10n ** BigInt(scale - right.scale), scale];
}
export function compareComplianceDecimals(a: string, b: string): -1 | 0 | 1 {
  const [left, right] = decimalAligned(a, b);
  return left < right ? -1 : left > right ? 1 : 0;
}
function decimalString(units: bigint, scale: number): string {
  const negative = units < 0n, digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  return `${negative ? '-' : ''}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
}
export function addComplianceDecimals(a: string, b: string): string {
  const [left, right, scale] = decimalAligned(a, b);
  return decimalString(left + right, scale);
}
export function subtractComplianceDecimals(a: string, b: string): string {
  const [left, right, scale] = decimalAligned(a, b);
  return decimalString(left - right, scale);
}
export function multiplyComplianceDecimal(a: string, factor: bigint): string {
  const { units, scale } = decimalParts(a);
  return decimalString(units * factor, scale);
}
export function isComplianceConfidence(value: unknown): value is string {
  return isRuleDecimal(value) && compareComplianceDecimals(value, '0') >= 0 && compareComplianceDecimals(value, '1') <= 0;
}
export function complianceInputFromFields(fields: DraftComplianceFields): ComplianceDraftInput {
  return {
    conditions: fields.complianceConditions.map(({ conditionId, text, applicability, comparison }) => ({ conditionId, text, applicability, comparison })),
    confidenceThreshold: fields.agentJudgedThreshold,
  };
}
export function complianceCanonical(value: unknown): string {
  return canonicalJson(value as JsonValue);
}
