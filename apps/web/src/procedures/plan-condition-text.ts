import { addComplianceDecimals, subtractComplianceDecimals, type CompliancePredicate, type ComplianceRule, type ComparisonOperator } from '@intellifin/domain';

const field = (name: string) => name.replaceAll('_', ' ');
const operator: Readonly<Record<ComparisonOperator, string>> = {
  eq: 'equals', neq: 'does not equal', gt: 'is greater than (exclusive)',
  gte: 'is at least (inclusive)', lt: 'is less than (exclusive)', lte: 'is at most (inclusive)',
};
const timeOperator: Readonly<Record<ComparisonOperator, string>> = {
  eq: 'is at the same time as', neq: 'is at a different time from',
  gt: 'is after (exclusive)', gte: 'is at or after (inclusive)',
  lt: 'is before (exclusive)', lte: 'is at or before (inclusive)',
};

function numeric(name: string, comparison: ComparisonOperator, value: string, tolerance: string): string {
  if (comparison === 'eq' || comparison === 'neq') return `${field(name)} differs from ${value} by ${comparison === 'eq' ? 'at most (inclusive)' : 'more than (exclusive)'} ${tolerance}`;
  const effective = comparison === 'gt' || comparison === 'gte' ? subtractComplianceDecimals(value, tolerance) : addComplianceDecimals(value, tolerance);
  return `${field(name)} ${operator[comparison]} ${effective} (authored boundary ${value}; tolerance ${tolerance})`;
}

/** Displays the stored predicate tree; it neither parses authored prose nor evaluates it. */
export function predicateText(predicate: CompliancePredicate): string {
  switch (predicate.kind) {
    case 'constant': return predicate.value ? 'true for every record' : 'false for every record';
    case 'boolean': return `${field(predicate.field)} is ${predicate.value ? 'true' : 'false'}`;
    case 'numeric': return numeric(predicate.field, predicate.operator, predicate.value, predicate.tolerance);
    case 'time': return `${field(predicate.field)} ${timeOperator[predicate.operator]} ${field(predicate.otherField)}`;
    case 'named-set': return `${field(predicate.field)} is one of [${predicate.compliant.join(', ')}] for true, or [${predicate.exception.join(', ')}] for false; an unnamed value is unknown`;
    case 'all': return `all of these must be true: ${predicate.expressions.map((expression) => `(${predicateText(expression)})`).join(' AND ')}`;
    case 'any': return `at least one of these must be true: ${predicate.expressions.map((expression) => `(${predicateText(expression)})`).join(' OR ')}`;
    case 'not': return `the following must be false: (${predicateText(predicate.expression)}); an unknown value remains unknown`;
  }
}

/** Literal field names and exact decimal strings stay visible; outcome wording follows the evaluator. */
export function ruleText(rule: ComplianceRule): string {
  switch (rule.kind) {
    case 'predicate': {
      if (rule.predicate.kind === 'named-set') return `${field(rule.predicate.field)}: Compliant for [${rule.predicate.compliant.join(', ')}]; Exception for [${rule.predicate.exception.join(', ')}]; any unnamed or missing value is Unevaluated.`;
      return `Compliant when ${predicateText(rule.predicate)}. Exception when the expression is false. Unevaluated when its result is unknown.`;
    }
    case 'disablement-window': return `Compliant for proven account absence, or when ${field(rule.disabledField)} minus ${field(rule.terminationField)} is ${rule.boundary === 'inclusive' ? 'at most (inclusive)' : 'less than (exclusive)'} ${addComplianceDecimals(rule.hours, rule.tolerance)} hours (authored window ${rule.hours} hours; tolerance ${rule.tolerance} hours). Exception outside that window. Missing or invalid required times are Unevaluated.`;
    case 'approval': return `For USD, approval is required when ${numeric(rule.amountField, rule.boundary === 'inclusive' ? 'gte' : 'gt', rule.threshold, rule.tolerance)}. Below that boundary the condition is Compliant. Where approval is required, Compliant requires an APPROVED decision, ${field(rule.decisionTimeField)} strictly before ${field(rule.processedTimeField)} (exclusive), and ${field(rule.limitField)} at least ${field(rule.amountField)} minus tolerance ${rule.tolerance} (inclusive). Proven absence, REJECTED, late approval or an insufficient limit is an Exception. An unnamed currency or decision, or missing required values, is Unevaluated.`;
    case 'permission-pairs': return `Expand ${field(rule.rolesField)} through the complete versioned role matrix. Exception when both permissions in any pair are present: ${rule.prohibitedPairs.map(([left, right]) => `${left} + ${right}`).join('; ')}. Report every matching pair. Compliant when no pair matches. Missing roles, unknown roles, incomplete expansion or conflicting matrix entries are Unevaluated.`;
    case 'baseline': return `Match ${field(rule.parameterField)} to exactly one baseline effective at ${field(rule.observationTimeField)}: its start is inclusive and its end is exclusive. For an approved parameter, Compliant requires a found value equal to the baseline; decimal values may differ by at most ${rule.tolerance} (inclusive), and other text must match exactly. A differing value is an Exception. A prohibited parameter is Compliant only when proven absent. Missing or stale observations, an unknown parameter, or missing or overlapping baselines are Unevaluated.`;
  }
}
