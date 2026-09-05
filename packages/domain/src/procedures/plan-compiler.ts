import { isGregorianDate, isRuleDecimal } from './population-draft.js';
import { findProcedureTemplate, isTemplateId, type TemplateCondition, type TemplateId } from './templates.js';
import {
  COMPLIANCE_COMPILER_VERSION, COMPLIANCE_SCHEMA_VERSION, COMPLIANCE_LIMITS, COMPLIANCE_MESSAGES,
  addComplianceDecimals, subtractComplianceDecimals, multiplyComplianceDecimal, compareComplianceDecimals,
  complianceObject, complianceExactKeys, isComplianceText, isComplianceConfidence, complianceCanonical,
  complianceInputFromFields,
  type ComparisonOperator, type ComplianceComparison, type ComplianceCompilation, type ComplianceConditionInput,
  type CompliancePredicate, type ComplianceRule, type CompiledComplianceCondition, type DraftComplianceFields,
} from './compliance-draft.js';

/** Only these Observation attributes exist for the shipped Template contracts. No name guessing. */
export const COMPLIANCE_OBSERVATION_FIELDS: Readonly<Record<TemplateId, Readonly<Record<string, 'boolean' | 'decimal' | 'text' | 'time' | 'roles'>>>> = {
  'P-1': { found: 'boolean', account_status: 'text', username: 'text', roles: 'roles', identity: 'text', disabled_time: 'time', termination_time: 'time' },
  'P-2': { found: 'boolean', roles: 'roles', status: 'text' },
  'P-3': { found: 'boolean', amount: 'decimal', currency: 'text', decision: 'text', decided_at: 'time', processed_time: 'time', approver_limit: 'decimal', transaction_id: 'text', approval_id: 'text' },
  'P-4': { found: 'boolean', parameter: 'text', observed_value: 'text', approved_value: 'text', observation_time: 'time' },
};

/** All source wording remains verbatim, including constraints not present in legacy section prose. */
export function templateConditionText(condition: TemplateCondition): string {
  return [condition.compliant, condition.exception, condition.unevaluated, ...condition.also]
    .filter((part): part is string => part !== null).join('\n');
}

const OPERATORS: Readonly<Record<string, ComparisonOperator>> = { '=': 'eq', '!=': 'neq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };

/** A bounded grammar, not JavaScript and not an unconstrained expression engine. */
export function parseCompliancePredicate(text: string, templateId: TemplateId): CompliancePredicate | null {
  if (!isComplianceText(text, COMPLIANCE_LIMITS.expression)) return null;
  if (text.trim() === 'all records') return { kind: 'constant', value: true };
  const tokens: string[] = [];
  const tokenPattern = /\s*(>=|<=|!=|[=><()[\],]|-?(?:0|[1-9]\d*)(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_-]*|"(?:[^"\\]|\\["\\])*")/gy;
  let position = 0;
  while (position < text.length) {
    if (text.slice(position).trim() === '') break;
    tokenPattern.lastIndex = position;
    const match = tokenPattern.exec(text);
    if (!match || !match[1] || tokens.length >= COMPLIANCE_LIMITS.nodes * 8) return null;
    tokens.push(match[1]); position = tokenPattern.lastIndex;
  }
  let cursor = 0, nodes = 0;
  const take = (): string => tokens[cursor++] ?? '';
  const peek = (): string => tokens[cursor] ?? '';
  const fail = (): never => { throw new Error('Unsupported expression'); };
  function set(): readonly string[] {
    if (take() !== '[') return fail();
    const values: string[] = [];
    do {
      const value = take();
      if (!/^(?:[A-Za-z_][A-Za-z0-9_-]*|"(?:[^"\\]|\\["\\])*")$/.test(value)) return fail();
      const parsed: string = value.startsWith('"') ? JSON.parse(value) as string : value;
      if (values.includes(parsed) || values.length >= COMPLIANCE_LIMITS.values) return fail();
      values.push(parsed);
      if (peek() !== ',') break;
      take();
    } while (true);
    if (take() !== ']') return fail();
    return values;
  }
  function primary(depth: number): CompliancePredicate {
    if (depth > COMPLIANCE_LIMITS.depth || ++nodes > COMPLIANCE_LIMITS.nodes) return fail();
    if (peek() === 'not') { take(); return { kind: 'not', expression: primary(depth + 1) }; }
    if (peek() === '(') { take(); const expression = disjunction(depth + 1); if (take() !== ')') return fail(); return expression; }
    const field = take();
    if (field === 'true' || field === 'false') return { kind: 'constant', value: field === 'true' };
    const fields = COMPLIANCE_OBSERVATION_FIELDS[templateId];
    if (!Object.hasOwn(fields, field)) return fail();
    const operator = take();
    if (fields[field] === 'text' && operator === 'in') {
      const compliant = set();
      if (take() !== 'else') return fail();
      const exception = set();
      if (compliant.some((value) => exception.includes(value))) return fail();
      return { kind: 'named-set', field, compliant, exception };
    }
    if (!Object.hasOwn(OPERATORS, operator)) return fail();
    const value = take();
    if (fields[field] === 'boolean' && ['=', '!='].includes(operator) && ['true', 'false'].includes(value)) {
      return { kind: 'boolean', field, value: operator === '=' ? value === 'true' : value !== 'true' };
    }
    if (fields[field] === 'decimal' && isRuleDecimal(value)) return { kind: 'numeric', field, operator: OPERATORS[operator]!, value, tolerance: '0' };
    if (fields[field] === 'time' && Object.hasOwn(fields, value) && fields[value] === 'time') return { kind: 'time', field, operator: OPERATORS[operator]!, otherField: value };
    return fail();
  }
  function conjunction(depth: number): CompliancePredicate {
    const expressions = [primary(depth)];
    while (peek() === 'and') { take(); expressions.push(primary(depth)); }
    if (expressions.length > 1 && ++nodes > COMPLIANCE_LIMITS.nodes) return fail();
    return expressions.length === 1 ? expressions[0]! : { kind: 'all', expressions };
  }
  function disjunction(depth: number): CompliancePredicate {
    const expressions = [conjunction(depth)];
    while (peek() === 'or') { take(); expressions.push(conjunction(depth)); }
    if (expressions.length > 1 && ++nodes > COMPLIANCE_LIMITS.nodes) return fail();
    return expressions.length === 1 ? expressions[0]! : { kind: 'any', expressions };
  }
  try { const expression = disjunction(0); return cursor === tokens.length ? expression : null; } catch { return null; }
}

function isComparison(value: unknown): value is ComplianceComparison {
  return complianceObject(value) && complianceExactKeys(value, ['boundary', 'threshold', 'tolerance'])
    && (value['boundary'] === 'inclusive' || value['boundary'] === 'exclusive') && isRuleDecimal(value['threshold'])
    && isRuleDecimal(value['tolerance']) && compareComplianceDecimals(value['tolerance'], '0') >= 0;
}
function withComparison(rule: ComplianceRule, comparison: ComplianceComparison | null): ComplianceRule | null {
  if (!comparison) return rule;
  if (rule.kind === 'approval') return { ...rule, ...comparison };
  if (rule.kind === 'disablement-window') return compareComplianceDecimals(comparison.threshold, '0') < 0 ? null : { ...rule, hours: comparison.threshold, boundary: comparison.boundary, tolerance: comparison.tolerance };
  if (rule.kind === 'baseline') return { ...rule, tolerance: comparison.tolerance };
  if (rule.kind !== 'predicate' || rule.predicate.kind !== 'numeric') return null;
  const p = rule.predicate;
  const operator = p.operator === 'gt' || p.operator === 'gte' ? (comparison.boundary === 'inclusive' ? 'gte' : 'gt')
    : p.operator === 'lt' || p.operator === 'lte' ? (comparison.boundary === 'inclusive' ? 'lte' : 'lt') : p.operator;
  return { kind: 'predicate', predicate: { ...p, operator, value: comparison.threshold, tolerance: comparison.tolerance } };
}

export function compileComplianceDraft(templateId: TemplateId, input: unknown, compilerVersion: string = COMPLIANCE_COMPILER_VERSION): ComplianceCompilation {
  if (compilerVersion !== COMPLIANCE_COMPILER_VERSION) return { ok: false, reason: COMPLIANCE_MESSAGES.COMPILER };
  if (!isTemplateId(templateId) || !complianceObject(input) || !complianceExactKeys(input, ['conditions', 'confidenceThreshold'])
    || !Array.isArray(input['conditions']) || input['conditions'].length < 1 || input['conditions'].length > COMPLIANCE_LIMITS.conditions) return { ok: false, reason: COMPLIANCE_MESSAGES.INPUT };
  if (!isComplianceConfidence(input['confidenceThreshold'])) return { ok: false, reason: COMPLIANCE_MESSAGES.CONFIDENCE };
  const conditions: CompiledComplianceCondition[] = [], ids = new Set<string>();
  for (const candidate of input['conditions'] as unknown[]) {
    if (!complianceObject(candidate) || !complianceExactKeys(candidate, ['conditionId', 'text', 'applicability', 'comparison'])
      || typeof candidate['conditionId'] !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(candidate['conditionId']) || ids.has(candidate['conditionId'])
      || !isComplianceText(candidate['text'], COMPLIANCE_LIMITS.text) || !candidate['text'].trim()
      || !isComplianceText(candidate['applicability'], COMPLIANCE_LIMITS.expression)) return { ok: false, reason: COMPLIANCE_MESSAGES.INPUT };
    if (candidate['comparison'] !== null && !isComparison(candidate['comparison'])) return { ok: false, reason: COMPLIANCE_MESSAGES.NUMBER };
    const condition = candidate as unknown as ComplianceConditionInput;
    const applicability = condition.applicability.trim() === '' ? 'found = true' : condition.applicability;
    const applicabilityAst = parseCompliancePredicate(applicability, templateId);
    if (!applicabilityAst) return { ok: false, reason: `${condition.conditionId}: ${COMPLIANCE_MESSAGES.APPLICABILITY}` };
    ids.add(condition.conditionId);
    const templateCondition = findProcedureTemplate(templateId).conditions.find((c) => c.conditionId === condition.conditionId);
    let rule: ComplianceRule | null = templateCondition && condition.text === templateConditionText(templateCondition) ? templateCondition.rule ?? null : null;
    if (!rule) {
      const window = templateId === 'P-1' ? /^disabled_time\s*-\s*termination_time\s*(<=|<)\s*(-?(?:0|[1-9]\d*)(?:\.\d+)?)h$/.exec(condition.text.trim()) : null;
      if (window) {
        if (!isRuleDecimal(window[2]) || compareComplianceDecimals(window[2], '0') < 0) return { ok: false, reason: COMPLIANCE_MESSAGES.NUMBER };
        rule = { kind: 'disablement-window', disabledField: 'disabled_time', terminationField: 'termination_time', hours: window[2], boundary: window[1] === '<=' ? 'inclusive' : 'exclusive', tolerance: '0' };
      } else {
        const predicate = parseCompliancePredicate(condition.text, templateId);
        if (predicate) rule = { kind: 'predicate', predicate };
        // A recognizable numeric comparison with an invalid literal is an input error,
        // never silently recategorized as prose (NaN/Infinity/exponents included).
        else if (/^(?:amount|approver_limit)\s*[<>=!]/.test(condition.text.trim()) || /^disabled_time\s*-\s*termination_time\s*[<>]/.test(condition.text.trim())) return { ok: false, reason: COMPLIANCE_MESSAGES.NUMBER };
      }
    }
    if (!rule && condition.comparison !== null) return { ok: false, reason: COMPLIANCE_MESSAGES.NUMBER };
    if (rule) {
      if (condition.comparison === null && (rule.kind === 'approval' || rule.kind === 'disablement-window' || rule.kind === 'predicate' && rule.predicate.kind === 'numeric')) {
        return { ok: false, reason: COMPLIANCE_MESSAGES.NUMBER };
      }
      rule = withComparison(rule, condition.comparison);
      if (!rule) return { ok: false, reason: COMPLIANCE_MESSAGES.NUMBER };
    }
    // Preserve the authored string byte-for-byte. A blank string is an authored input;
    // only its compiled meaning defaults to `found = true`.
    conditions.push({ ...condition, applicabilityAst, rule, status: rule ? 'RULE' : 'AGENT_JUDGED' });
  }
  return { ok: true, value: { complianceSchemaVersion: COMPLIANCE_SCHEMA_VERSION, complianceCompilerVersion: COMPLIANCE_COMPILER_VERSION, complianceConditions: conditions, agentJudgedThreshold: input['confidenceThreshold'] } };
}

export function initialDraftCompliance(templateId: TemplateId): DraftComplianceFields {
  const conditions: ComplianceConditionInput[] = findProcedureTemplate(templateId).conditions.map((condition) => ({
    conditionId: condition.conditionId, text: templateConditionText(condition),
    // P-3 must evaluate a proven absent approval. `found = true` would hide its Exception.
    applicability: templateId === 'P-3' || templateId === 'P-4' || templateId === 'P-1' && condition.conditionId === 'C1' ? 'all records' : 'found = true',
    comparison: condition.rule?.kind === 'approval' ? { boundary: 'inclusive', threshold: '100000', tolerance: '0' } : null,
  }));
  const result = compileComplianceDraft(templateId, { conditions, confidenceThreshold: '0.80' });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

/** Fail-closed read: stored compiler claims must reproduce exactly from authored inputs. */
export function isDraftComplianceFields(value: unknown, templateId?: TemplateId): value is DraftComplianceFields {
  if (!complianceObject(value) || value['complianceSchemaVersion'] !== 1 || value['complianceCompilerVersion'] !== COMPLIANCE_COMPILER_VERSION
    || !Array.isArray(value['complianceConditions']) || !isComplianceConfidence(value['agentJudgedThreshold'])) return false;
  const id = templateId ?? value['templateId'];
  if (!isTemplateId(id)) return false;
  try {
    const fields = value as unknown as DraftComplianceFields;
    const result = compileComplianceDraft(id, complianceInputFromFields(fields), fields.complianceCompilerVersion);
    return result.ok && complianceCanonical(result.value.complianceConditions) === complianceCanonical(fields.complianceConditions);
  } catch { return false; }
}

export type ComplianceEvaluationValue = 'EXCEPTION' | 'UNEVALUATED' | 'COMPLIANT';
export interface ComplianceObservation {
  readonly values: Readonly<Record<string, unknown>>;
  /** Explicit evidence facts. Missing/ambiguous/contradictory/uninspected is never a pass. */
  readonly evidence: { readonly inspected: boolean; readonly complete: boolean; readonly ambiguous: boolean; readonly contradictory: boolean; readonly absenceProven: boolean };
  readonly roleMatrix?: { readonly complete: boolean; readonly entries: readonly { readonly role: string; readonly permissions: readonly string[] }[] };
  readonly baselines?: readonly { readonly parameter: string; readonly value: string; readonly effectiveFrom: string; readonly effectiveTo: string | null; readonly disposition: 'approved' | 'prohibited' }[];
  readonly stale?: boolean;
}
export interface ComplianceConditionEvaluation {
  readonly conditionId: string;
  readonly applicable: boolean | null;
  readonly value: ComplianceEvaluationValue;
  readonly origin: 'RULE' | 'AGENT_JUDGED';
  readonly diagnostics: readonly string[];
}
export interface ComplianceRecordEvaluation {
  readonly value: ComplianceEvaluationValue;
  readonly conditions: readonly ComplianceConditionEvaluation[];
  readonly diagnostics: readonly string[];
}
export interface AgentJudgedEvaluation {
  readonly value: ComplianceEvaluationValue;
  readonly confidence: string;
}
interface Truth { readonly value: boolean | null; readonly diagnostics: readonly string[] }
const truth = (value: boolean): Truth => ({ value, diagnostics: [] });
const unknown = (message: string): Truth => ({ value: null, diagnostics: [message] });
const missing = (field: string): Truth => unknown(`missing or invalid Observation field ${field}`);

function numericTruth(left: string, right: string, operator: ComparisonOperator, tolerance: string): Truth {
  const difference = subtractComplianceDecimals(left, right);
  if (operator === 'eq' || operator === 'neq') {
    const absolute = difference.startsWith('-') ? difference.slice(1) : difference;
    const equal = compareComplianceDecimals(absolute, tolerance) <= 0;
    return truth(operator === 'eq' ? equal : !equal);
  }
  const comparison = compareComplianceDecimals(left, operator === 'gt' || operator === 'gte' ? subtractComplianceDecimals(right, tolerance) : addComplianceDecimals(right, tolerance));
  return truth(operator === 'gt' ? comparison > 0 : operator === 'gte' ? comparison >= 0 : operator === 'lt' ? comparison < 0 : comparison <= 0);
}

function evaluatePredicate(predicate: CompliancePredicate, values: Readonly<Record<string, unknown>>): Truth {
  switch (predicate.kind) {
    case 'constant': return truth(predicate.value);
    case 'boolean': return typeof values[predicate.field] === 'boolean' ? truth(values[predicate.field] === predicate.value) : missing(predicate.field);
    case 'numeric': {
      const value = values[predicate.field];
      return isRuleDecimal(value) ? numericTruth(value, predicate.value, predicate.operator, predicate.tolerance) : missing(predicate.field);
    }
    case 'time': {
      const left = instant(values[predicate.field]), right = instant(values[predicate.otherField]);
      if (left === null) return missing(predicate.field);
      if (right === null) return missing(predicate.otherField);
      const comparison = left < right ? -1 : left > right ? 1 : 0;
      return truth(predicate.operator === 'eq' ? comparison === 0 : predicate.operator === 'neq' ? comparison !== 0
        : predicate.operator === 'gt' ? comparison > 0 : predicate.operator === 'gte' ? comparison >= 0
          : predicate.operator === 'lt' ? comparison < 0 : comparison <= 0);
    }
    case 'named-set': {
      const value = values[predicate.field];
      if (typeof value !== 'string') return missing(predicate.field);
      if (predicate.compliant.includes(value)) return truth(true);
      if (predicate.exception.includes(value)) return truth(false);
      return unknown(`rule does not name value ${value}`);
    }
    case 'not': { const result = evaluatePredicate(predicate.expression, values); return result.value === null ? result : truth(!result.value); }
    case 'all':
    case 'any': {
      const results = predicate.expressions.map((expression) => evaluatePredicate(expression, values));
      const decisive = predicate.kind === 'any';
      if (results.some((result) => result.value === decisive)) return truth(decisive);
      if (results.some((result) => result.value === null)) return { value: null, diagnostics: results.flatMap((result) => result.diagnostics) };
      return truth(!decisive);
    }
  }
}

/** Timestamp parser rejects rolled Gregorian dates and missing timezones before Date is used. */
function instant(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !isGregorianDate(value.slice(0, 10))) return null;
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null;
  const offset = /[+-](\d{2}):(\d{2})$/.exec(value);
  if (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? BigInt(milliseconds) : null;
}

function evaluateRule(rule: ComplianceRule, observation: ComplianceObservation): Truth {
  const values = observation.values;
  if (rule.kind === 'predicate') return evaluatePredicate(rule.predicate, values);
  if (rule.kind === 'disablement-window') {
    if (values['found'] === false) return truth(true);
    const disabled = instant(values[rule.disabledField]), terminated = instant(values[rule.terminationField]);
    if (disabled === null) return missing(rule.disabledField);
    if (terminated === null) return missing(rule.terminationField);
    return numericTruth((disabled - terminated).toString(), multiplyComplianceDecimal(rule.hours, 3600000n), rule.boundary === 'inclusive' ? 'lte' : 'lt', multiplyComplianceDecimal(rule.tolerance, 3600000n));
  }
  if (rule.kind === 'approval') {
    const amount = values[rule.amountField];
    if (!isRuleDecimal(amount)) return missing(rule.amountField);
    const currency = values[rule.currencyField];
    if (currency !== 'USD') return typeof currency === 'string' ? unknown(`rule does not name value ${currency}`) : missing(rule.currencyField);
    const requiresApproval = numericTruth(amount, rule.threshold, rule.boundary === 'inclusive' ? 'gte' : 'gt', rule.tolerance).value;
    if (!requiresApproval) return truth(true); // Pure condition; never changes Population inclusion.
    if (values['found'] === false) return truth(false);
    const decision = values[rule.decisionField];
    if (decision === 'REJECTED') return truth(false);
    if (decision !== 'APPROVED') return typeof decision === 'string' ? unknown(`rule does not name value ${decision}`) : missing(rule.decisionField);
    const decided = instant(values[rule.decisionTimeField]), processed = instant(values[rule.processedTimeField]);
    const limit = values[rule.limitField];
    if (decided === null) return missing(rule.decisionTimeField);
    if (processed === null) return missing(rule.processedTimeField);
    if (!isRuleDecimal(limit)) return missing(rule.limitField);
    return truth(decided < processed && numericTruth(limit, amount, 'gte', rule.tolerance).value === true);
  }
  if (rule.kind === 'permission-pairs') {
    const roles = values[rule.rolesField], matrix = observation.roleMatrix;
    if (!Array.isArray(roles) || roles.length === 0 || !roles.every((role: unknown) => typeof role === 'string')) return missing(rule.rolesField);
    if (!matrix || matrix.complete !== true || !Array.isArray(matrix.entries)) return unknown('incomplete role expansion');
    const permissions = new Set<string>();
    for (const role of roles as string[]) {
      const entries = matrix.entries.filter((entry) => entry.role === role);
      if (entries.length === 0) return unknown(`rule does not name value ${role}`);
      if (entries.some((entry) => !Array.isArray(entry.permissions) || !entry.permissions.every((permission: unknown) => typeof permission === 'string'))) return unknown('incomplete role expansion');
      const signatures = entries.map((entry) => complianceCanonical([...new Set(entry.permissions)].sort()));
      if (new Set(signatures).size > 1) return unknown(`duplicate conflicting policy entries for ${role}`);
      for (const permission of entries[0]!.permissions) permissions.add(permission);
    }
    const pairs = rule.prohibitedPairs.filter(([a, b]) => permissions.has(a) && permissions.has(b));
    return pairs.length ? { value: false, diagnostics: pairs.map(([a, b]) => `prohibited permission pair ${a} + ${b}`) } : truth(true);
  }
  const parameter = values[rule.parameterField], observed = values[rule.observedField], at = instant(values[rule.observationTimeField]);
  if (typeof parameter !== 'string') return missing(rule.parameterField);
  if (at === null) return missing(rule.observationTimeField);
  if (observation.stale !== false) return unknown('observation freshness is missing or stale');
  if (!observation.baselines) return unknown('missing effective baseline');
  const entries = observation.baselines.filter((entry) => entry.parameter === parameter);
  if (!entries.length) return unknown(`rule does not name value ${parameter}`);
  const effective = [];
  for (const entry of entries) {
    const from = instant(entry.effectiveFrom), to = entry.effectiveTo === null ? null : instant(entry.effectiveTo);
    if (from === null || entry.effectiveTo !== null && (to === null || to <= from)) return unknown('invalid effective baseline interval');
    if (from <= at && (to === null || at < to)) effective.push(entry);
  }
  if (effective.length !== 1) return unknown(effective.length ? 'multiple effective baselines apply' : 'missing effective baseline');
  const baseline = effective[0]!;
  if (baseline.disposition === 'prohibited') return truth(values['found'] === false);
  if (baseline.disposition !== 'approved') return unknown('unknown baseline disposition');
  if (values['found'] !== true || typeof observed !== 'string') return missing(rule.observedField);
  if (isRuleDecimal(observed) && isRuleDecimal(baseline.value)) return numericTruth(observed, baseline.value, 'eq', rule.tolerance);
  return truth(observed === baseline.value);
}

/** Fixed FR-9 reduction; an absent evaluation is represented explicitly, never filtered out. */
export function reduceComplianceEvaluations(values: readonly (ComplianceEvaluationValue | null | undefined)[]): ComplianceEvaluationValue {
  if (values.includes('EXCEPTION')) return 'EXCEPTION';
  if (!values.length || values.some((value) => value !== 'COMPLIANT')) return 'UNEVALUATED';
  return 'COMPLIANT';
}

export function evaluateComplianceRecord(
  templateId: TemplateId, fields: DraftComplianceFields, observation: ComplianceObservation,
  agentEvaluations: Readonly<Record<string, AgentJudgedEvaluation | undefined>> = {},
): ComplianceRecordEvaluation {
  if (!isDraftComplianceFields(fields, templateId)) return { value: 'UNEVALUATED', conditions: [], diagnostics: [COMPLIANCE_MESSAGES.COMPILER] };
  const e = observation.evidence;
  const evidenceValid = e && e.inspected === true && e.complete === true && e.ambiguous === false && e.contradictory === false
    && typeof observation.values['found'] === 'boolean' && (observation.values['found'] !== false || e.absenceProven === true);
  const conditions: ComplianceConditionEvaluation[] = fields.complianceConditions.map((condition) => {
    const application = evaluatePredicate(condition.applicabilityAst, observation.values);
    const base = { conditionId: condition.conditionId, applicable: application.value, origin: condition.status };
    if (application.value === null) return { ...base, value: 'UNEVALUATED', diagnostics: application.diagnostics };
    if (!evidenceValid) return { ...base, value: 'UNEVALUATED', diagnostics: ['missing, ambiguous, contradictory, uninspected, or unproven Evidence'] };
    if (!application.value) return { ...base, value: 'COMPLIANT', diagnostics: [] };
    if (!condition.rule) {
      const evaluation = Object.hasOwn(agentEvaluations, condition.conditionId) ? agentEvaluations[condition.conditionId] : undefined;
      if (!evaluation || !['EXCEPTION', 'COMPLIANT', 'UNEVALUATED'].includes(evaluation.value) || !isComplianceConfidence(evaluation.confidence)) return { ...base, value: 'UNEVALUATED', diagnostics: [`missing Agent-Judged evaluation for ${condition.conditionId}`] };
      if (compareComplianceDecimals(evaluation.confidence, fields.agentJudgedThreshold) < 0) return { ...base, value: 'UNEVALUATED', diagnostics: [`Agent-Judged confidence for ${condition.conditionId} is below the stored threshold`] };
      return { ...base, value: evaluation.value, diagnostics: [] };
    }
    const result = evaluateRule(condition.rule, observation);
    const value = result.value === null ? 'UNEVALUATED' : result.value ? 'COMPLIANT' : 'EXCEPTION';
    return { ...base, value, diagnostics: result.diagnostics };
  });
  return { value: reduceComplianceEvaluations(conditions.map((condition) => condition.value)), conditions, diagnostics: conditions.flatMap((condition) => condition.diagnostics) };
}
