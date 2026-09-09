import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_MESSAGES, MISSING_OBSERVATION_FIELD,
  compileComplianceDraft, complianceFieldMappings, complianceInputFromFields, evaluateComplianceRecord, initialDraftCompliance,
  isDraftComplianceFields, normalizeFieldMappings, observationIdFor, observationRuleValues,
  type ComplianceObservation, type DraftComplianceFields, type ObservationRecord, type PopulationFieldMapping,
} from '../index.js';

/**
 * Owner decision 2 (2026-09-08): the P-1 24-hour disablement variant, end to end at the
 * domain level. The window rule itself is compiler 1's (Story 2.4); what this story adds
 * is the explicit frozen mapping that supplies `termination_time` from the population's
 * `termination_effective_time`, and the proof that the comparison is deterministic over
 * instants with declared boundary semantics.
 */
const MAPPING: readonly PopulationFieldMapping[] = [{ field: 'termination_time', column: 'termination_effective_time' }];
const WINDOW = 'disabled_time - termination_time <= 24h';
const TERMINATED = '2026-08-07T00:00:00+02:00';
const evidence = { inspected: true, complete: true, ambiguous: false, contradictory: false, absenceProven: false } as const;

function windowFields(boundary: 'inclusive' | 'exclusive' = 'inclusive', tolerance = '0'): DraftComplianceFields {
  const authored = complianceInputFromFields(initialDraftCompliance('P-1'));
  const result = compileComplianceDraft('P-1', { ...authored, conditions: [...authored.conditions,
    { conditionId: 'C3', text: WINDOW, applicability: 'found = true', comparison: { boundary, threshold: '24', tolerance }, mapping: MAPPING }] });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
function c3(fields: DraftComplianceFields, values: Record<string, unknown>, facts: Partial<ComplianceObservation['evidence']> = {}) {
  return evaluateComplianceRecord('P-1', fields, { values: { found: true, account_status: 'disabled', ...values }, evidence: { ...evidence, ...facts } })
    .conditions.find((condition) => condition.conditionId === 'C3')!;
}
function found(attributes: ObservationRecord['attributes'] = []): ObservationRecord {
  return {
    schemaVersion: 1, observationId: observationIdFor('01920000-0000-7000-8000-00000000a001', 'E-000105'),
    workItemId: '01920000-0000-7000-8000-00000000a001', populationRecordKey: 'E-000105', targetSystem: 'loancore',
    found: 'true', observedAt: '2026-09-05T10:00:00.000Z', stepExecutionId: '01920000-0000-7000-8000-00000000b001',
    captureMethod: 'agent', matchOrigin: 'platform', identity: null, attributes, evidenceIds: ['01920000-0000-7000-8000-00000000c001'],
  };
}

describe('the frozen population field mapping (D3)', () => {
  it('compiles onto the window condition only, omits the key everywhere else, and recompiles byte for byte', () => {
    const fields = windowFields();
    const [c1, c2, window] = fields.complianceConditions;
    expect(window).toMatchObject({ conditionId: 'C3', status: 'RULE', rule: { kind: 'disablement-window', hours: '24', boundary: 'inclusive' }, mapping: MAPPING });
    expect(Object.hasOwn(c1!, 'mapping')).toBe(false); expect(Object.hasOwn(c2!, 'mapping')).toBe(false);
    expect(isDraftComplianceFields(fields, 'P-1')).toBe(true);
    expect(complianceInputFromFields(fields).conditions[2]).toMatchObject({ mapping: MAPPING });
    expect(Object.hasOwn(complianceInputFromFields(fields).conditions[0]!, 'mapping')).toBe(false);
    expect(complianceFieldMappings(fields)).toEqual(MAPPING);
    expect(complianceFieldMappings(initialDraftCompliance('P-1'))).toEqual([]);
    expect(normalizeFieldMappings('P-1', null)).toBeUndefined();
    expect(normalizeFieldMappings('P-1', [{ field: 'termination_time', column: 'b' }, { field: 'disabled_time', column: 'a' }])).toEqual([{ field: 'disabled_time', column: 'a' }, { field: 'termination_time', column: 'b' }]);
  });

  it('refuses a mapping that is not an explicit declared time field with one bounded column, or that conflicts across conditions', () => {
    const authored = complianceInputFromFields(initialDraftCompliance('P-1'));
    const attempt = (mapping: unknown, extra: object[] = []) => compileComplianceDraft('P-1', { ...authored, conditions: [...authored.conditions,
      { conditionId: 'C3', text: WINDOW, applicability: 'found = true', comparison: { boundary: 'inclusive', threshold: '24', tolerance: '0' }, mapping }, ...extra] });
    for (const bad of [
      [{ field: 'roles', column: 'roles' }],                        // not a time field
      [{ field: 'nothing', column: 'x' }],                          // not declared
      [{ field: 'termination_time', column: 'bad column' }],        // not an identifier
      [{ field: 'termination_time', column: '' }],
      [{ field: 'termination_time', column: 'a' }, { field: 'termination_time', column: 'b' }], // twice
      [{ field: 'termination_time', column: 'a', extra: 1 }],
      [], 'termination_effective_time', {},
    ]) expect(attempt(bad), JSON.stringify(bad)).toEqual({ ok: false, reason: `C3: ${COMPLIANCE_MESSAGES.MAPPING}` });
    // One field, one column, across the whole version.
    expect(attempt(MAPPING, [{ conditionId: 'C4', text: WINDOW, applicability: 'found = true', comparison: { boundary: 'inclusive', threshold: '48', tolerance: '0' }, mapping: [{ field: 'termination_time', column: 'termination_at' }] }]))
      .toEqual({ ok: false, reason: `C4: ${COMPLIANCE_MESSAGES.MAPPING}` });
    expect(attempt(MAPPING, [{ conditionId: 'C4', text: WINDOW, applicability: 'found = true', comparison: { boundary: 'inclusive', threshold: '48', tolerance: '0' }, mapping: MAPPING }])).toMatchObject({ ok: true });
  });

  it('supplies the mapped population column as the declared field, and a grounded attribute still wins', () => {
    const population = { employee_id: 'E-000105', termination_effective_time: TERMINATED };
    expect(observationRuleValues('P-1', found(), population, MAPPING)['termination_time']).toBe('2026-08-06T22:00:00.000Z');
    expect(Object.hasOwn(observationRuleValues('P-1', found(), population), 'termination_time')).toBe(false);
    expect(Object.hasOwn(observationRuleValues('P-1', found(), { employee_id: 'E-000105', termination_effective_date: '2026-08-07' }, MAPPING), 'termination_time')).toBe(false);
    const grounded = found([{ name: 'termination_time', originalValue: '2026-08-07T05:00:00Z', normalizedValue: '2026-08-07T05:00:00.000Z', grounding: null, corroboration: null }]);
    expect(observationRuleValues('P-1', grounded, population, MAPPING)['termination_time']).toBe('2026-08-07T05:00:00.000Z');
  });
});

describe('the 24-hour disablement window, evaluated (D3)', () => {
  const fields = windowFields();
  it('is Compliant below and exactly at 24 hours, and an Exception above it', () => {
    expect(c3(fields, { disabled_time: '2026-08-07T20:00:00+02:00', termination_time: TERMINATED })).toMatchObject({ value: 'COMPLIANT', origin: 'RULE', diagnostics: [] });
    expect(c3(fields, { disabled_time: '2026-08-08T00:00:00+02:00', termination_time: TERMINATED })).toMatchObject({ value: 'COMPLIANT' });
    expect(c3(fields, { disabled_time: '2026-08-08T00:00:01+02:00', termination_time: TERMINATED })).toMatchObject({ value: 'EXCEPTION' });
    expect(c3(fields, { disabled_time: '2026-08-09T00:00:00+02:00', termination_time: TERMINATED })).toMatchObject({ value: 'EXCEPTION' });
  });
  it('applies the declared boundary and tolerance rather than an assumed one', () => {
    expect(c3(windowFields('exclusive'), { disabled_time: '2026-08-08T00:00:00+02:00', termination_time: TERMINATED })).toMatchObject({ value: 'EXCEPTION' });
    expect(c3(windowFields('exclusive'), { disabled_time: '2026-08-07T23:59:59+02:00', termination_time: TERMINATED })).toMatchObject({ value: 'COMPLIANT' });
    expect(c3(windowFields('inclusive', '0.5'), { disabled_time: '2026-08-08T00:30:00+02:00', termination_time: TERMINATED })).toMatchObject({ value: 'COMPLIANT' });
    expect(c3(windowFields('inclusive', '0.5'), { disabled_time: '2026-08-08T00:30:01+02:00', termination_time: TERMINATED })).toMatchObject({ value: 'EXCEPTION' });
  });
  it('compares instants, so equivalent times with different offsets are the same time', () => {
    expect(c3(fields, { disabled_time: '2026-08-07T22:00:00Z', termination_time: TERMINATED })).toMatchObject({ value: 'COMPLIANT' });
    expect(c3(fields, { disabled_time: '2026-08-08T00:00:00+02:00', termination_time: '2026-08-06T22:00:00Z' })).toMatchObject({ value: 'COMPLIANT' });
    expect(c3(fields, { disabled_time: '2026-08-07T22:00:01Z', termination_time: '2026-08-06T22:00:00.000Z' })).toMatchObject({ value: 'EXCEPTION' });
    expect(c3(fields, { disabled_time: '2026-08-08T00:00:00-02:00', termination_time: TERMINATED })).toMatchObject({ value: 'EXCEPTION' });
  });
  it('cannot substantiate a missing, invalid or date-only timestamp, and says which', () => {
    expect(c3(fields, { termination_time: TERMINATED })).toMatchObject({ value: 'UNEVALUATED', diagnostics: [`${MISSING_OBSERVATION_FIELD}disabled_time`] });
    expect(c3(fields, { disabled_time: 'not a time', termination_time: TERMINATED })).toMatchObject({ value: 'UNEVALUATED', diagnostics: [`${MISSING_OBSERVATION_FIELD}disabled_time`] });
    expect(c3(fields, { disabled_time: '2026-08-08T00:00:00+02:00' })).toMatchObject({ value: 'UNEVALUATED', diagnostics: [`${MISSING_OBSERVATION_FIELD}termination_time`] });
    // A date-only source: the leavers export declares termination_effective_date only.
    expect(c3(fields, { disabled_time: '2026-08-08T00:00:00+02:00', termination_time: '2026-08-07' })).toMatchObject({ value: 'UNEVALUATED', diagnostics: [`${MISSING_OBSERVATION_FIELD}termination_time`] });
    expect(c3(fields, { disabled_time: '2026-08-08T00:00:00', termination_time: TERMINATED })).toMatchObject({ value: 'UNEVALUATED' });
    expect(c3(fields, { disabled_time: '2026-02-30T00:00:00Z', termination_time: TERMINATED })).toMatchObject({ value: 'UNEVALUATED' });
  });
  it('never decides a record whose identity did not correlate, and passes a proven absence through applicability', () => {
    expect(c3(fields, { disabled_time: '2026-08-08T00:00:00+02:00', termination_time: TERMINATED }, { contradictory: true })).toMatchObject({ value: 'UNEVALUATED', diagnostics: ['missing, ambiguous, contradictory, uninspected, or unproven Evidence'] });
    expect(c3(fields, { disabled_time: '2026-08-08T00:00:00+02:00', termination_time: TERMINATED }, { ambiguous: true }).value).toBe('UNEVALUATED');
    const absent = evaluateComplianceRecord('P-1', fields, { values: { found: false }, evidence: { ...evidence, absenceProven: true } });
    expect(absent.conditions.find((condition) => condition.conditionId === 'C3')).toMatchObject({ applicable: false, value: 'COMPLIANT' });
  });
  it('evaluates the whole record through one mapping: the population supplies the instant the rules read', () => {
    const population = { employee_id: 'E-000105', termination_effective_time: TERMINATED };
    const record = found([{ name: 'disabled_time', originalValue: '2026-08-08T00:00:00+02:00', normalizedValue: '2026-08-07T22:00:00.000Z', grounding: null, corroboration: null },
      { name: 'account_status', originalValue: 'disabled', normalizedValue: 'disabled', grounding: null, corroboration: null }]);
    const values = observationRuleValues('P-1', record, population, complianceFieldMappings(fields));
    expect(evaluateComplianceRecord('P-1', fields, { values, evidence }).conditions.map((condition) => [condition.conditionId, condition.value])).toEqual([['C1', 'COMPLIANT'], ['C2', 'UNEVALUATED'], ['C3', 'COMPLIANT']]);
  });
});
