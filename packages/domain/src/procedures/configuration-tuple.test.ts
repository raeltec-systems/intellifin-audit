import { describe, it, expect } from 'vitest';
import { configurationTuplesEqual, regressionRequirement, handoverAt, type ConfigurationTuple } from './configuration-tuple.js';
import { PERIOD_DERIVATION_RULES, type Frequency } from './evidence-draft.js';
const tuple: ConfigurationTuple = { model: null, toolConfiguration: { interpreter: '1' }, registrationDigests: [{ kind: 'target', id: 'a', digest: 'a' }, { kind: 'source', id: 'b', digest: 'b' }] };
describe('approval configuration and calendar ownership', () => {
  it('first version is immediate; identity order is immaterial; each tuple change gates regression', () => {
    expect(regressionRequirement(tuple, null)).toEqual({ requiresRegression: false, reason: 'first-version' });
    expect(configurationTuplesEqual(tuple, { ...tuple, registrationDigests: [...tuple.registrationDigests].reverse() })).toBe(true);
    for (const changed of [{ ...tuple, model: { provider: 'anthropic', modelId: 'new', promptVersion: '1' } }, { ...tuple, toolConfiguration: { interpreter: '2' } }, { ...tuple, registrationDigests: [] }]) expect(regressionRequirement(changed, tuple).requiresRegression).toBe(true);
    expect(regressionRequirement(tuple, tuple).requiresRegression).toBe(false);
  });
  it.each([
    ['daily', '2026-12-31T23:59:59Z', '2027-01-01T00:00:00.000Z'],
    ['daily', '2026-09-05T00:00:00Z', '2026-09-06T00:00:00.000Z'],
    ['weekly', '2026-09-07T00:00:00Z', '2026-09-14T00:00:00.000Z'],
    ['weekly', '2026-09-06T23:00:00Z', '2026-09-07T00:00:00.000Z'],
    ['monthly', '2026-12-31T23:59:00Z', '2027-01-01T00:00:00.000Z'],
    ['monthly', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00.000Z'],
    ['once', '2026-09-01T00:00:00Z', null],
  ] as const)('%s takes a strictly later calendar start with a non-midnight launch', (frequency, time, expected) => {
    expect(handoverAt(time, { frequency, startTime: '14:35', periodDerivationRule: PERIOD_DERIVATION_RULES[frequency as Frequency] })).toBe(expected);
  });
});
