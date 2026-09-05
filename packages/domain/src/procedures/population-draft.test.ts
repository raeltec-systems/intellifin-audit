import { describe, expect, it } from 'vitest';
import { bindingDigest, bindingDigestEnvelope } from '../sources/population-source.js';
import { findProcedureTemplate } from './templates.js';
import { initialDraftPopulation } from './procedure-version.js';
import { isDraftPopulationFields, isExplicitPeriod, isGregorianDate, isInclusionRule, isProcedureSourceSnapshot, isRuleDecimal, isScopeStatement, validatePopulationBinding } from './population-draft.js';

describe('explicit Period and scope', () => {
  it.each(['0001-01-01', '2000-02-29', '2024-02-29', '9999-12-31'])('accepts %s', (date) => expect(isGregorianDate(date)).toBe(true));
  it.each(['0000-01-01', '1900-02-29', '2025-02-29', '2026-04-31', '2026-13-01', '2026-01-00', '2026-1-01', '2026-01-01T00:00:00Z', ' 2026-01-01', 20260101])('rejects %s', (date) => expect(isGregorianDate(date)).toBe(false));
  it('accepts inclusive same-day ranges and rejects reversed dates or unknown properties', () => {
    expect(isExplicitPeriod({ from: '2026-01-01', to: '2026-01-01' })).toBe(true);
    expect(isExplicitPeriod({ from: '2026-01-02', to: '2026-01-01' })).toBe(false);
    expect(isExplicitPeriod({ from: '2026-01-01', to: '2026-01-01', zone: 'UTC' })).toBe(false);
  });
  it('requires storable, bounded scope without trimming it', () => {
    expect(isScopeStatement('  All staff.\n  ')).toBe(true);
    for (const value of ['', '   ', 'x'.repeat(10001), '\0', '\ud800']) expect(isScopeStatement(value)).toBe(false);
  });
});

describe('inclusion rule schema 1', () => {
  const text = { column: 'status', kind: 'text', operator: 'eq', value: 'Active' };
  const rule = (predicate: unknown) => ({ schemaVersion: 1, all: [predicate] });
  it('supports include-all and exactly the typed comparison vocabulary', () => {
    expect(isInclusionRule({ schemaVersion: 1, all: [] }, [])).toBe(true);
    expect(isInclusionRule(rule(text), ['status'])).toBe(true);
    expect(isInclusionRule(rule({ column: 'date', kind: 'within-period' }), ['date'])).toBe(true);
    for (const operator of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']) expect(isInclusionRule(rule({ column: 'amount', kind: 'decimal', operator, value: '100000.00' }), ['amount'])).toBe(true);
  });
  it.each(['1e5', 'NaN', 'Infinity', '+1', '.5', '01', '1.', ' 1', '1,000', 10, '', '1'.repeat(101)])('refuses decimal %s without coercion', (value) => expect(isRuleDecimal(value)).toBe(false));
  it('keeps high-precision decimals as strings', () => expect(isRuleDecimal('-123456789012345678901234567890.00000000001')).toBe(true));
  it('rejects unknown columns, operators, version, types, extra keys and oversized input', () => {
    expect(isInclusionRule(rule(text), ['Status'])).toBe(false);
    expect(isInclusionRule(rule({ ...text, operator: 'contains' }), ['status'])).toBe(false);
    expect(isInclusionRule(rule({ ...text, value: 1 }), ['status'])).toBe(false);
    expect(isInclusionRule(rule({ ...text, value: '\ud800' }), ['status'])).toBe(false);
    expect(isInclusionRule(rule({ ...text, extra: true }), ['status'])).toBe(false);
    expect(isInclusionRule({ schemaVersion: 2, all: [] })).toBe(false);
    expect(isInclusionRule({ schemaVersion: 1, all: Array(33).fill(text) })).toBe(false);
    expect(isInclusionRule(rule({ ...text, value: 'x'.repeat(2001) }))).toBe(false);
    expect(isInclusionRule(rule({ column: 'amount', kind: 'decimal', operator: { toString: () => 'eq' }, value: '1' }))).toBe(false);
  });
  it('has the explicit P-1 field mapping and inclusive P-3 boundary', () => {
    expect(findProcedureTemplate('P-1').inclusionRule.all).toContainEqual({ column: 'termination_effective_date', kind: 'within-period' });
    expect(findProcedureTemplate('P-3').inclusionRule.all).toContainEqual({ column: 'amount', kind: 'decimal', operator: 'gte', value: '100000' });
  });
});

describe('version-owned source contract', () => {
  const fields = { kind: 'versioned-file' as const, location: 'https://data.synthetic.invalid/source.csv', declaredSchema: ['status'], sensitiveFields: [], declaredCountMechanism: 'cover-sheet' as const };
  const source = { bindingId: '018f0000-0000-7000-8000-000000000099', displayName: 'Synthetic source', digest: bindingDigest(fields), contract: bindingDigestEnvelope(fields) };
  it('validates the exact five-field envelope using the source-owned digest', () => {
    expect(isProcedureSourceSnapshot(source)).toBe(true);
    expect(isProcedureSourceSnapshot({ ...source, digest: '0'.repeat(64) })).toBe(false);
    expect(isProcedureSourceSnapshot({ ...source, contract: { ...source.contract, extra: 'field' } })).toBe(false);
  });
  it('validates a manual-upload binding on its own terms — the Schedule pairing moved to evidenceBlockersFor (Story 2.5)', () => {
    const fields = { ...source.contract, kind: 'manual-upload' as const, location: null };
    const input = { kind: fields.kind, location: '', declaredSchema: fields.declared_schema, sensitiveFields: fields.sensitive_fields, declaredCountMechanism: fields.declared_count_mechanism };
    const manual = { ...source, contract: fields, digest: bindingDigest(input) };
    // `validatePopulationBinding` no longer refuses on the Schedule at all — it is a
    // real, auditor-set field now (`evidence-draft.js`'s `DraftSchedule`), and the
    // upload/frequency pairing is a completeness blocker, never a save-time refusal.
    expect(validatePopulationBinding(manual, { schemaVersion: 1, all: [] })).toBeNull();
  });
  it('validates a saved source and its count blocker without reading a live registration', () => {
    const initial = initialDraftPopulation('P-1');
    expect(isDraftPopulationFields(initial)).toBe(true);
    expect(isDraftPopulationFields({ ...initial, sourceSnapshot: source })).toBe(false); // P-1 columns absent.
    expect(isDraftPopulationFields({ ...initial, sourceSnapshot: source, inclusionRule: { schemaVersion: 1, all: [] } })).toBe(true);
    expect(isDraftPopulationFields({ ...initial, populationBlockers: ['declared-count-missing'] })).toBe(false);
  });
});
