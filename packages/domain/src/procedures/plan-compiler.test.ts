import { describe, expect, it } from 'vitest';
import {
  compileComplianceDraft, evaluateComplianceRecord, initialDraftCompliance,
  reduceComplianceEvaluations, templateConditionText, findProcedureTemplate, COMPLIANCE_MESSAGES,
  type ComplianceObservation, type DraftComplianceFields,
} from './index.js';

const evidence = { inspected: true, complete: true, ambiguous: false, contradictory: false, absenceProven: false } as const;
const observation = (values: Record<string, unknown>, extra: Partial<ComplianceObservation> = {}): ComplianceObservation => ({ values, evidence, ...extra });

function p3(amount: string, boundary: 'inclusive' | 'exclusive' = 'inclusive', tolerance = '0'): DraftComplianceFields {
  const initial = initialDraftCompliance('P-3');
  const condition = initial.complianceConditions[0]!;
  const result = compileComplianceDraft('P-3', { conditions: [{ conditionId: condition.conditionId, text: condition.text, applicability: condition.applicability, comparison: { boundary, threshold: '100000', tolerance } }], confidenceThreshold: '0.80' });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
function approval(amount: string, limit = '100000'): ComplianceObservation {
  return observation({ found: true, amount, currency: 'USD', decision: 'APPROVED', decided_at: '2026-09-01T09:59:59Z', processed_time: '2026-09-01T10:00:00Z', approver_limit: limit });
}

describe('the deterministic Compliance Rule compiler', () => {
  it('seeds all four Templates, preserves their prose and classifies P-1 C1/C2', () => {
    for (const id of ['P-1', 'P-2', 'P-3', 'P-4'] as const) {
      const draft = initialDraftCompliance(id);
      expect(initialDraftCompliance(id)).toEqual(draft);
      expect(draft.complianceConditions.map((condition) => condition.text)).toEqual(findProcedureTemplate(id).conditions.map(templateConditionText));
    }
    expect(initialDraftCompliance('P-1').complianceConditions.map((condition) => condition.status)).toEqual(['RULE', 'AGENT_JUDGED']);
  });

  it('makes unsupported prose Agent-Judged and cannot retain prior Template output', () => {
    const before = initialDraftCompliance('P-1'), first = before.complianceConditions[0]!;
    const result = compileComplianceDraft('P-1', { conditions: [{ conditionId: first.conditionId, text: 'Use professional judgement.', applicability: first.applicability, comparison: null }], confidenceThreshold: '0.81' });
    expect(result).toMatchObject({ ok: true, value: { agentJudgedThreshold: '0.81', complianceConditions: [{ status: 'AGENT_JUDGED', rule: null }] } });
  });

  it('compiles typed boolean composition, named sets, numeric and time comparisons', () => {
    const p1 = compileComplianceDraft('P-1', { conditions: [{ conditionId: 'C1', text: 'found = false or account_status in [disabled] else [active]', applicability: 'all records', comparison: null }], confidenceThreshold: '0.8' });
    expect(p1).toMatchObject({ ok: true, value: { complianceConditions: [{ status: 'RULE' }] } });
    const p3 = compileComplianceDraft('P-3', { conditions: [{ conditionId: 'C1', text: 'amount >= 100000 and decided_at < processed_time', applicability: 'not (found = false)', comparison: null }], confidenceThreshold: '0.8' });
    expect(p3).toMatchObject({ ok: true, value: { complianceConditions: [{ status: 'RULE' }] } });
  });

  it('requires persisted comparison controls for a direct numeric, approval, or window rule', () => {
    const approval = initialDraftCompliance('P-3').complianceConditions[0]!;
    expect(compileComplianceDraft('P-3', { conditions: [{ conditionId: approval.conditionId, text: approval.text, applicability: approval.applicability, comparison: null }], confidenceThreshold: '0.8' })).toEqual({ ok: false, reason: COMPLIANCE_MESSAGES.NUMBER });
    expect(compileComplianceDraft('P-1', { conditions: [{ conditionId: 'C1', text: 'disabled_time - termination_time <= 24h', applicability: 'all records', comparison: null }], confidenceThreshold: '0.8' })).toEqual({ ok: false, reason: COMPLIANCE_MESSAGES.NUMBER });
    expect(compileComplianceDraft('P-3', { conditions: [{ conditionId: 'C1', text: 'amount >= 100000', applicability: 'all records', comparison: null }], confidenceThreshold: '0.8' })).toEqual({ ok: false, reason: COMPLIANCE_MESSAGES.NUMBER });
    expect(compileComplianceDraft('P-1', { conditions: [{ conditionId: 'C1', text: 'Use professional judgement.', applicability: 'all records', comparison: { boundary: 'inclusive', threshold: '1', tolerance: '0' } }], confidenceThreshold: '0.8' })).toEqual({ ok: false, reason: COMPLIANCE_MESSAGES.NUMBER });
  });

  it('refuses invalid applicability, duplicate ids, bad numeric controls, and non-storable text', () => {
    const base = initialDraftCompliance('P-1').complianceConditions[0]!;
    const input = (condition: unknown) => ({ conditions: [condition], confidenceThreshold: '0.80' });
    expect(compileComplianceDraft('P-1', input({ conditionId: 'C1', text: base.text, applicability: 'process.exit()', comparison: null }))).toMatchObject({ ok: false });
    expect(compileComplianceDraft('P-1', { conditions: [base, base].map(({ conditionId, text, applicability, comparison }) => ({ conditionId, text, applicability, comparison })), confidenceThreshold: '0.80' })).toMatchObject({ ok: false });
    expect(compileComplianceDraft('P-1', input({ conditionId: 'C1', text: 'amount >= Infinity', applicability: 'all records', comparison: { boundary: 'inclusive', threshold: 'Infinity', tolerance: '0' } }))).toMatchObject({ ok: false });
    expect(compileComplianceDraft('P-1', input({ conditionId: 'C1', text: '\ud800', applicability: 'all records', comparison: null }))).toMatchObject({ ok: false });
    expect(compileComplianceDraft('P-1', input({ conditionId: 'C1', text: base.text, applicability: 'all records', comparison: null }), 'future')).toMatchObject({ ok: false });
  });

  it('applies P-3 below, exactly and above USD 100,000 with explicit boundaries and tolerance', () => {
    expect(evaluateComplianceRecord('P-3', p3('99999.99'), approval('99999.99')).value).toBe('COMPLIANT');
    expect(evaluateComplianceRecord('P-3', p3('100000'), approval('100000')).value).toBe('COMPLIANT');
    expect(evaluateComplianceRecord('P-3', p3('100000.01'), approval('100000.01', '100000.01')).value).toBe('COMPLIANT');
    expect(evaluateComplianceRecord('P-3', p3('100000', 'exclusive'), observation({ found: false, amount: '100000', currency: 'USD' }, { evidence: { ...evidence, absenceProven: true } })).value).toBe('COMPLIANT');
    expect(evaluateComplianceRecord('P-3', p3('100000', 'inclusive'), observation({ found: false, amount: '100000', currency: 'USD' }, { evidence: { ...evidence, absenceProven: true } })).value).toBe('EXCEPTION');
    expect(evaluateComplianceRecord('P-3', p3('99999.95', 'inclusive', '0.05'), observation({ found: false, amount: '99999.95', currency: 'USD' }, { evidence: { ...evidence, absenceProven: true } })).value).toBe('EXCEPTION');
  });

  it('treats proven absent P-3 approval as Exception', () => {
    const result = evaluateComplianceRecord('P-3', p3('100000'), observation({ found: false, amount: '100000', currency: 'USD' }, { evidence: { ...evidence, absenceProven: true } }));
    expect(result.value).toBe('EXCEPTION');
  });

  it('compiles the optional P-1 disablement window and includes the exact 24-hour boundary', () => {
    const build = (boundary: 'inclusive' | 'exclusive') => {
      const result = compileComplianceDraft('P-1', { conditions: [{ conditionId: 'C1', text: 'disabled_time - termination_time <= 24h', applicability: 'all records', comparison: { boundary, threshold: '24', tolerance: '0' } }], confidenceThreshold: '0.80' });
      if (!result.ok) throw new Error(result.reason);
      return result.value;
    };
    const at24 = observation({ found: true, termination_time: '2026-09-01T00:00:00Z', disabled_time: '2026-09-02T00:00:00Z' });
    expect(evaluateComplianceRecord('P-1', build('inclusive'), at24).value).toBe('COMPLIANT');
    expect(evaluateComplianceRecord('P-1', build('exclusive'), at24).value).toBe('EXCEPTION');
  });

  it('reports unnamed values and preserves Exception then Unevaluated then Compliant reduction', () => {
    const draft = initialDraftCompliance('P-1');
    const suspended = evaluateComplianceRecord('P-1', draft, observation({ found: true, account_status: 'Suspended' }), { C2: { value: 'COMPLIANT', confidence: '0.9' } });
    expect(suspended.value).toBe('UNEVALUATED');
    expect(suspended.diagnostics).toContain('rule does not name value Suspended');
    expect(reduceComplianceEvaluations(['COMPLIANT', 'UNEVALUATED', 'EXCEPTION'])).toBe('EXCEPTION');
    expect(reduceComplianceEvaluations(['COMPLIANT', 'UNEVALUATED'])).toBe('UNEVALUATED');
    expect(reduceComplianceEvaluations(['COMPLIANT'])).toBe('COMPLIANT');
    expect(reduceComplianceEvaluations([])).toBe('UNEVALUATED');
  });

  it('makes a missing applicable Agent-Judged evaluation Unevaluated while another Exception wins', () => {
    const draft = initialDraftCompliance('P-1');
    expect(evaluateComplianceRecord('P-1', draft, observation({ found: true, account_status: 'disabled' })).value).toBe('UNEVALUATED');
    expect(evaluateComplianceRecord('P-1', draft, observation({ found: true, account_status: 'active' })).value).toBe('EXCEPTION');
  });

  it('does not return Compliant for missing, ambiguous, contradictory, or uninspected Evidence', () => {
    const draft = initialDraftCompliance('P-1'), values = { found: true, account_status: 'disabled' };
    for (const invalid of [
      { ...evidence, inspected: false }, { ...evidence, complete: false },
      { ...evidence, ambiguous: true }, { ...evidence, contradictory: true },
    ]) expect(evaluateComplianceRecord('P-1', draft, observation(values, { evidence: invalid }), { C2: { value: 'COMPLIANT', confidence: '0.9' } }).value).toBe('UNEVALUATED');
  });

  it('does not classify contradictory attributes as an Exception or a pass', () => {
    const draft = initialDraftCompliance('P-1');
    const result = evaluateComplianceRecord('P-1', draft, observation({ found: true, account_status: 'active' }, { evidence: { ...evidence, complete: false } }));
    expect(result.value).toBe('UNEVALUATED');
  });

  it('applies the one stored threshold to Agent-Judged condition values', () => {
    const draft = initialDraftCompliance('P-1'), input = observation({ found: true, account_status: 'disabled' });
    expect(evaluateComplianceRecord('P-1', draft, input, { C2: { value: 'COMPLIANT', confidence: '0.79' } }).value).toBe('UNEVALUATED');
    expect(evaluateComplianceRecord('P-1', draft, input, { C2: { value: 'COMPLIANT', confidence: '0.80' } }).value).toBe('COMPLIANT');
  });

  it('expands P-2 roles, finds all prohibited pairs, and refuses unknown or conflicting matrix values', () => {
    const draft = initialDraftCompliance('P-2');
    const base = { complete: true, entries: [
      { role: 'A', permissions: ['CREATE_PAYMENT'] }, { role: 'B', permissions: ['RELEASE_PAYMENT'] },
    ] };
    const conflict = evaluateComplianceRecord('P-2', draft, observation({ found: true, roles: ['A', 'B'] }, { roleMatrix: base }));
    expect(conflict.value).toBe('EXCEPTION');
    expect(conflict.diagnostics).toContain('prohibited permission pair CREATE_PAYMENT + RELEASE_PAYMENT');
    expect(evaluateComplianceRecord('P-2', draft, observation({ found: true, roles: ['UNKNOWN'] }, { roleMatrix: base })).value).toBe('UNEVALUATED');
    expect(evaluateComplianceRecord('P-2', draft, observation({ found: true, roles: ['A'] }, { roleMatrix: { complete: true, entries: [...base.entries, { role: 'A', permissions: ['RELEASE_PAYMENT'] }] } })).value).toBe('UNEVALUATED');
    expect(evaluateComplianceRecord('P-2', draft, observation({ found: true, roles: [] }, { roleMatrix: base })).value).toBe('UNEVALUATED');
  });

  it('evaluates the one P-4 baseline in effect and rejects prohibited or ambiguous baselines', () => {
    const draft = initialDraftCompliance('P-4');
    const values = { found: true, parameter: 'limit', observed_value: '50.00', observation_time: '2026-09-01T00:00:00Z' };
    const approved = { parameter: 'limit', value: '50', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null, disposition: 'approved' as const };
    expect(evaluateComplianceRecord('P-4', draft, observation(values, { stale: false, baselines: [approved] })).value).toBe('COMPLIANT');
    expect(evaluateComplianceRecord('P-4', draft, observation({ ...values, observed_value: '51' }, { stale: false, baselines: [approved] })).value).toBe('EXCEPTION');
    expect(evaluateComplianceRecord('P-4', draft, observation(values, { stale: false, baselines: [approved, approved] })).value).toBe('UNEVALUATED');
    expect(evaluateComplianceRecord('P-4', draft, observation(values, { stale: false, baselines: [{ ...approved, disposition: 'prohibited' }] })).value).toBe('EXCEPTION');
    expect(evaluateComplianceRecord('P-4', draft, observation({ ...values, found: false }, { evidence: { ...evidence, absenceProven: true }, stale: false, baselines: [approved] })).value).toBe('UNEVALUATED');
  });
});
