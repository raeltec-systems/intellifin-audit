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
  POLICY: 'Enter a valid role-privilege policy: distinct bounded role names, no role in both lists, bound only to an Agent-Judged condition over a declared roles field.',
} as const;

/**
 * An explicit, reviewable role-privilege policy frozen with ONE Agent-Judged condition.
 *
 * Owner decision (2026-09-08): privilege is never inferred from a role's name, never read
 * from the system prompt, never hard-coded into the runtime, and never read from an
 * expectation fixture. It is authored here, frozen with the Procedure Version like every
 * other compiled input, rendered to the model as part of the condition it binds, and
 * enforced by the deterministic evaluator as a backstop the model cannot argue with.
 *
 * The two lists are SETS: trimmed, deduplicated, sorted (UTF-16 code unit order, which is
 * what `Array.prototype.sort` does), exactly as origins and label patterns are. A role in
 * both lists is refused, because it would decide nothing. Names are compared EXACTLY —
 * compiler 1 named sets compare exact strings and corroboration permits no case folding.
 */
export const ROLE_PRIVILEGE_POLICY_KIND = 'role-privilege' as const;
export const ROLE_PRIVILEGE_LIMITS = { roles: 64, roleLength: 128 } as const;
export interface RolePrivilegePolicy {
  readonly kind: typeof ROLE_PRIVILEGE_POLICY_KIND;
  readonly rolesField: 'roles';
  readonly privileged: readonly string[];
  readonly nonPrivileged: readonly string[];
}
/** The closed vocabulary of condition policies. One kind today; the key is optional and omitted when absent. */
export type ConditionPolicy = RolePrivilegePolicy;

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
  /**
   * Optional frozen policy binding. The key is ABSENT, never `null`, on every condition
   * without one: a compiled condition is compared byte for byte with its recompilation
   * on every read, so adding a key to legacy rows would make every stored version read
   * as nothing. `null` is accepted on input and means absent.
   */
  readonly policy?: ConditionPolicy;
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
    conditions: fields.complianceConditions.map(({ conditionId, text, applicability, comparison, policy }) =>
      ({ conditionId, text, applicability, comparison, ...(policy === undefined ? {} : { policy }) })),
    confidenceThreshold: fields.agentJudgedThreshold,
  };
}

/* ------------------------------------------------------- role-privilege policy --- */

/** Separators a plain-text roles cell may carry. A policy role name may contain none of them. */
const ROLE_LIST_SEPARATOR = /[,;\r\n]+/;

function isRoleName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= ROLE_PRIVILEGE_LIMITS.roleLength
    && !ROLE_LIST_SEPARATOR.test(value) && !value.includes('[') && !value.includes(']') && !value.includes('"') && isComplianceText(value, ROLE_PRIVILEGE_LIMITS.roleLength);
}

function roleSet(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > ROLE_PRIVILEGE_LIMITS.roles) return null;
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    const name = entry.trim();
    if (!isRoleName(name)) return null;
    if (!names.includes(name)) names.push(name);
  }
  return names.sort();
}

/**
 * Validate and normalize an authored policy. `null` means "no policy" and is returned as
 * `undefined` so the caller omits the key; a malformed policy is `false`.
 */
export function normalizeConditionPolicy(value: unknown): ConditionPolicy | undefined | false {
  if (value === null || value === undefined) return undefined;
  if (!complianceObject(value) || !complianceExactKeys(value, ['kind', 'rolesField', 'privileged', 'nonPrivileged'])) return false;
  if (value['kind'] !== ROLE_PRIVILEGE_POLICY_KIND || value['rolesField'] !== 'roles') return false;
  const privileged = roleSet(value['privileged']), nonPrivileged = roleSet(value['nonPrivileged']);
  if (privileged === null || nonPrivileged === null || privileged.length + nonPrivileged.length === 0) return false;
  if (privileged.some((role) => nonPrivileged.includes(role))) return false;
  return { kind: ROLE_PRIVILEGE_POLICY_KIND, rolesField: 'roles', privileged, nonPrivileged };
}

/**
 * Read a captured roles value as an exact list of names.
 *
 * A JSON array of strings is itself (the P-2 population carries roles as JSON text). A
 * plain-text cell — LoanCore renders `LOAN_ADMIN, SYSTEM_ADMIN` — is split on commas,
 * semicolons and line breaks and each entry trimmed of surrounding whitespace. Nothing is
 * case-folded, nothing is invented: a value that is not a list of names reads as
 * unreadable (`null`), never as an empty list.
 */
export function readRoleList(value: unknown): readonly string[] | null {
  if (Array.isArray(value)) {
    const names = value.map((entry) => typeof entry === 'string' ? entry.trim() : null);
    return names.every((name): name is string => name !== null && name.length > 0) && names.length > 0 ? names : null;
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  const text = value.trim();
  if (text.startsWith('[')) {
    try { return readRoleList(JSON.parse(text)); } catch { return null; }
  }
  const names = text.split(ROLE_LIST_SEPARATOR).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return names.length > 0 ? names : null;
}

export type RolePrivilegeClassification =
  | { readonly kind: 'privileged'; readonly roles: readonly string[]; readonly privileged: readonly string[] }
  | { readonly kind: 'non-privileged'; readonly roles: readonly string[] }
  | { readonly kind: 'unclassified'; readonly roles: readonly string[]; readonly unclassified: readonly string[] }
  | { readonly kind: 'unreadable' };

/**
 * Classify a captured roles value under a frozen policy. Any privileged role decides
 * `privileged` — an account retaining one privileged assignment retains it whatever else
 * it holds. Only a complete list of known non-privileged roles is `non-privileged`. A
 * role in neither list leaves the record `unclassified`, which the platform escalates
 * rather than guesses.
 */
export function classifyRolePrivilege(policy: RolePrivilegePolicy, value: unknown): RolePrivilegeClassification {
  const roles = readRoleList(value);
  if (roles === null) return { kind: 'unreadable' };
  const privileged = roles.filter((role) => policy.privileged.includes(role));
  if (privileged.length > 0) return { kind: 'privileged', roles, privileged };
  const unclassified = roles.filter((role) => !policy.nonPrivileged.includes(role));
  if (unclassified.length > 0) return { kind: 'unclassified', roles, unclassified };
  return { kind: 'non-privileged', roles };
}

/** The label an Exception carries when the policy decided it; the owner's own words. */
export const RETAINED_PRIVILEGED_ASSIGNMENT = 'retained privileged assignment ';
/** A proposal the frozen policy contradicts is Unevaluated, never silently corrected. */
export const POLICY_CONTRADICTED = 'Agent-Judged value contradicts the frozen role-privilege policy';

/** The policy rendered as instruction text: deterministic, so what the model read is what the auditor reviews. */
export function rolePrivilegeInstruction(policy: RolePrivilegePolicy): string {
  return [
    'Role-privilege policy (frozen with this Procedure Version; apply it exactly and do not infer privilege from a role name):',
    `Privileged roles: ${policy.privileged.length ? policy.privileged.join(', ') : '(none declared)'}`,
    `Known non-privileged roles: ${policy.nonPrivileged.length ? policy.nonPrivileged.join(', ') : '(none declared)'}`,
    'Read the Roles value as an exact, case-sensitive list. If any listed privileged role is present, the account retains a privileged assignment and the condition is EXCEPTION even when the account is disabled. If every role is a known non-privileged role, the condition is COMPLIANT. If any role is in neither list, or the roles cannot be read, do not decide: report insufficient evidence.',
  ].join('\n');
}

/** The text an Agent-Judged condition is evaluated against: the authored prose plus its frozen policy. */
export function conditionInstructionText(condition: Pick<ComplianceConditionInput, 'text' | 'policy'>): string {
  return condition.policy === undefined ? condition.text : `${condition.text}\n\n${rolePrivilegeInstruction(condition.policy)}`;
}
export function complianceCanonical(value: unknown): string {
  return canonicalJson(value as JsonValue);
}
