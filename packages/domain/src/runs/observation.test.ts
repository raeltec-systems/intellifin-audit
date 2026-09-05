import { describe, expect, it } from 'vitest';

import {
  OBSERVATION_CAPTURE_METHODS,
  OBSERVATION_FOUND_VALUES,
  OBSERVATION_LIMITS,
  OBSERVATION_MATCH_ORIGINS,
  isObservationAttribute,
  isObservationGrounding,
  isObservationInstant,
  isObservationRecord,
  type ObservationAttribute,
  type ObservationRecord,
} from './observation.js';

const grounding = {
  evidenceId: 'evidence-1',
  locator: '$.accounts[0].roles',
  label: 'roles',
  extractedText: '["AP_CLERK"]',
};

const identity: ObservationAttribute = {
  name: 'account_id',
  originalValue: 'AG-1001',
  normalizedValue: 'AG-1001',
  grounding: { ...grounding, locator: '$.accounts[0].account_id', label: 'account_id', extractedText: 'AG-1001' },
  corroboration: null,
};

function record(overrides: Partial<ObservationRecord> = {}): unknown {
  return {
    schemaVersion: 1,
    observationId: 'obs-1',
    workItemId: 'item-1',
    populationRecordKey: 'AG-1001',
    targetSystem: 'reg-1',
    found: 'true',
    observedAt: '2026-09-05T10:00:00.000Z',
    stepExecutionId: 'step-1',
    captureMethod: 'adapter',
    matchOrigin: 'platform',
    identity,
    attributes: [{ name: 'roles', originalValue: ['AP_CLERK'], normalizedValue: ['AP_CLERK'], grounding, corroboration: null }],
    evidenceIds: ['evidence-1'],
    ...overrides,
  };
}

describe('the B.1 Observation vocabulary', () => {
  it('is three-valued found, two capture methods and two match origins', () => {
    expect([...OBSERVATION_FOUND_VALUES]).toEqual(['true', 'false', 'ambiguous']);
    expect([...OBSERVATION_CAPTURE_METHODS]).toEqual(['agent', 'adapter']);
    expect([...OBSERVATION_MATCH_ORIGINS]).toEqual(['platform', 'human-matched']);
  });
});

describe('isObservationRecord', () => {
  it('accepts a grounded adapter Observation', () => {
    expect(isObservationRecord(record())).toBe(true);
  });

  it('accepts a proven-absence and an ambiguous Observation without an identity', () => {
    expect(isObservationRecord(record({ found: 'false', identity: null, attributes: [] }))).toBe(true);
    expect(isObservationRecord(record({ found: 'ambiguous', identity: null, attributes: [] }))).toBe(true);
  });

  it('requires a GROUNDED identity when found is true', () => {
    expect(isObservationRecord(record({ identity: null }))).toBe(false);
    expect(isObservationRecord(record({ identity: { ...identity, grounding: null } }))).toBe(false);
  });

  it('refuses an identity on an Observation that did not find one', () => {
    // Carrying an identity would assert the very match the Observation says did not
    // resolve. Both directions are checked, so neither can be inverted silently.
    expect(isObservationRecord(record({ found: 'false' }))).toBe(false);
    expect(isObservationRecord(record({ found: 'ambiguous' }))).toBe(false);
  });

  it('refuses an unknown found value, capture method or match origin', () => {
    expect(isObservationRecord(record({ found: 'maybe' as never }))).toBe(false);
    expect(isObservationRecord(record({ captureMethod: 'model' as never }))).toBe(false);
    expect(isObservationRecord(record({ matchOrigin: 'guessed' as never }))).toBe(false);
  });

  it('refuses an extra or missing key', () => {
    expect(isObservationRecord({ ...(record() as object), extra: true })).toBe(false);
    const { evidenceIds, ...rest } = record() as Record<string, unknown>;
    void evidenceIds;
    expect(isObservationRecord(rest)).toBe(false);
  });

  it('requires every grounding to name Evidence the Observation links', () => {
    expect(isObservationRecord(record({ evidenceIds: ['evidence-2'] }))).toBe(false);
    expect(isObservationRecord(record({ evidenceIds: [] }))).toBe(false);
  });

  it('refuses duplicate attribute names and duplicate Evidence ids', () => {
    const duplicated = [
      { name: 'roles', originalValue: 'a', normalizedValue: 'a', grounding, corroboration: null },
      { name: 'roles', originalValue: 'b', normalizedValue: 'b', grounding, corroboration: null },
    ];
    expect(isObservationRecord(record({ attributes: duplicated }))).toBe(false);
    expect(isObservationRecord(record({ evidenceIds: ['evidence-1', 'evidence-1'] }))).toBe(false);
  });

  it('refuses a schema version it was not written for', () => {
    expect(isObservationRecord(record({ schemaVersion: 2 as never }))).toBe(false);
  });

  it('refuses a value with no canonical form', () => {
    // A lone surrogate and a NUL both hash and canonicalize nowhere and store nowhere.
    expect(isObservationRecord(record({ attributes: [{ name: 'roles', originalValue: '\ud800', normalizedValue: 'x', grounding, corroboration: null }] }))).toBe(false);
    expect(isObservationRecord(record({ attributes: [{ name: 'roles', originalValue: 'a\u0000b', normalizedValue: 'x', grounding, corroboration: null }] }))).toBe(false);
  });

  it('refuses more attributes or Evidence items than the bounds allow', () => {
    const many = Array.from({ length: OBSERVATION_LIMITS.attributes + 1 }, (_, index) => ({
      name: `field-${String(index)}`, originalValue: 'v', normalizedValue: 'v', grounding, corroboration: null,
    }));
    expect(isObservationRecord(record({ attributes: many }))).toBe(false);
  });
});

describe('attribute and grounding shape', () => {
  it('requires the exact five attribute keys and four grounding keys', () => {
    expect(isObservationAttribute({ ...identity, extra: 1 })).toBe(false);
    expect(isObservationGrounding({ ...grounding, extra: 1 })).toBe(false);
    const { label, ...withoutLabel } = grounding;
    void label;
    expect(isObservationGrounding(withoutLabel)).toBe(false);
  });

  it('accepts only the corroboration values the Gate may set, and null until it does', () => {
    expect(isObservationAttribute({ ...identity, corroboration: 'matched' })).toBe(true);
    expect(isObservationAttribute({ ...identity, corroboration: 'contradictory' })).toBe(true);
    expect(isObservationAttribute({ ...identity, corroboration: 'model-read' })).toBe(true);
    expect(isObservationAttribute({ ...identity, corroboration: null })).toBe(true);
    expect(isObservationAttribute({ ...identity, corroboration: 'probably' })).toBe(false);
  });
});

describe('isObservationInstant', () => {
  it('accepts a UTC instant and refuses anything else', () => {
    expect(isObservationInstant('2026-09-05T10:00:00.000Z')).toBe(true);
    expect(isObservationInstant('2026-09-05T10:00:00Z')).toBe(true);
    expect(isObservationInstant('2026-09-05T10:00:00+02:00')).toBe(false);
    expect(isObservationInstant('2026-09-05')).toBe(false);
    expect(isObservationInstant('2026-02-30T10:00:00.000Z')).toBe(false);
    expect(isObservationInstant('')).toBe(false);
  });
});
