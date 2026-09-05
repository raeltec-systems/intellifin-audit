import { describe, expect, it } from 'vitest';
import { initialDraftCompliance } from '@intellifin/domain';
import { predicateText, ruleText } from './plan-condition-text';

describe('readable stored compliance contracts', () => {
  it('shows exact tolerance-adjusted boundaries, including strict comparisons', () => {
    expect(predicateText({ kind: 'numeric', field: 'amount', operator: 'gte', value: '100000.00', tolerance: '0.01' })).toBe('amount is at least (inclusive) 99999.99 (authored boundary 100000.00; tolerance 0.01)');
    expect(predicateText({ kind: 'numeric', field: 'amount', operator: 'lt', value: '100', tolerance: '1' })).toContain('less than (exclusive) 101');
    expect(predicateText({ kind: 'numeric', field: 'amount', operator: 'eq', value: '100', tolerance: '0.50' })).toContain('at most (inclusive) 0.50');
    expect(predicateText({ kind: 'time', field: 'decided_at', operator: 'lt', otherField: 'processed_time' })).toBe('decided at is before (exclusive) processed time');
  });
  it('retains recursive grouping and unknown outcomes', () => {
    const text = predicateText({ kind: 'all', expressions: [{ kind: 'boolean', field: 'found', value: true }, { kind: 'any', expressions: [{ kind: 'constant', value: false }, { kind: 'not', expression: { kind: 'boolean', field: 'found', value: false } }] }] });
    expect(text).toContain('(found is true) AND (at least one');
    expect(text).toContain(' OR (the following must be false: (found is false)');
    expect(text).toContain('unknown value remains unknown');
  });
  it('names every named-set outcome instead of treating unknown values as exceptions', () => {
    expect(ruleText({ kind: 'predicate', predicate: { kind: 'named-set', field: 'account_status', compliant: ['disabled'], exception: ['active'] } })).toBe('account status: Compliant for [disabled]; Exception for [active]; any unnamed or missing value is Unevaluated.');
  });
  it('explains all shipped specialized rule families and their boundaries', () => {
    for (const template of ['P-2', 'P-3', 'P-4'] as const) {
      const rule = initialDraftCompliance(template).complianceConditions[0]!.rule!;
      const description = ruleText(rule);
      expect(description).toContain('Compliant');
      expect(description).toContain('Exception');
      expect(description).toContain('Unevaluated');
      expect(description).not.toContain('{');
    }
    expect(ruleText({ kind: 'disablement-window', disabledField: 'disabled_time', terminationField: 'termination_time', hours: '24', tolerance: '0.5', boundary: 'exclusive' })).toContain('less than (exclusive) 24.5 hours');
    expect(ruleText(initialDraftCompliance('P-3').complianceConditions[0]!.rule!)).toContain('strictly before processed time (exclusive)');
  });
});
