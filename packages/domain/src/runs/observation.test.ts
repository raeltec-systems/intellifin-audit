import { describe, expect, it } from 'vitest';

import {
  OBSERVATION_CAPTURE_METHODS,
  OBSERVATION_COVERAGE_VALUES,
  OBSERVATION_FOUND_VALUES,
  OBSERVATION_LIMITS,
  OBSERVATION_MATCH_ORIGINS,
  canBeCompliant,
  isHonestAbsence,
  isObservationAbsenceProof,
  isObservationAttribute,
  isObservationCheckResult,
  isObservationEvaluation,
  isObservationGrounding,
  isObservationInstant,
  isObservationRecord,
  judgeAbsence,
  normalizeObservedAt,
  observationChecks,
  observationCoverage,
  observationIdFor,
  type ObservationAbsenceProof,
  type ObservationAttribute,
  type ObservationCheckResult,
  type ObservationEvaluation,
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

/* ------------------------------------------------------------------ Story 3.4 --- */

const ABSENT = record({ found: 'false', identity: null, attributes: [] }) as ObservationRecord;
const AMBIGUOUS = record({ found: 'ambiguous', identity: null, attributes: [] }) as ObservationRecord;
const FOUND = record() as ObservationRecord;

const PROOF: ObservationAbsenceProof = {
  queryKeys: [{ key: 'account_id', value: 'AG-1001' }],
  emptyResultEvidenceId: 'evidence-1',
  extractionComplete: true,
};
const EXPECTED = [{ key: 'account_id', value: 'AG-1001' }];
const REGISTERED = ['evidence-1'];

describe('the derived Observation identity', () => {
  it('is the same name for the same Work Item and record key, every time', () => {
    expect(observationIdFor('item-1', 'AG-1001')).toBe(observationIdFor('item-1', 'AG-1001'));
  });

  it('is a syntactically valid UUID with the version-8 and variant nibbles set', () => {
    expect(observationIdFor('item-1', 'AG-1001')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('separates the two parts, so one pair cannot be spelled as another', () => {
    // Concatenation would make ("a","bc") and ("ab","c") the same Observation.
    expect(observationIdFor('a', 'bc')).not.toBe(observationIdFor('ab', 'c'));
    expect(observationIdFor('item-1', 'AG-1001')).not.toBe(observationIdFor('item-2', 'AG-1001'));
    expect(observationIdFor('item-1', 'AG-1001')).not.toBe(observationIdFor('item-1', 'AG-1002'));
  });
});

describe('honest absence', () => {
  const judge = (
    proof: ObservationAbsenceProof | null,
    expected = EXPECTED,
    registered = REGISTERED,
    linked = ABSENT.evidenceIds,
  ) => judgeAbsence({ proof, expected, linkedEvidenceIds: linked, registeredEvidenceIds: registered });

  it('believes an absence with all three proofs', () => {
    expect(judge(PROOF)).toEqual({ honest: true, failure: null });
    expect(isHonestAbsence({ proof: PROOF, expected: EXPECTED, linkedEvidenceIds: ABSENT.evidenceIds, registeredEvidenceIds: REGISTERED })).toBe(true);
  });

  it('disbelieves an absence with no proof at all', () => {
    expect(judge(null)).toEqual({ honest: false, failure: 'absence-proof-missing' });
  });

  it('disbelieves an absence that searched only some of the declared keys', () => {
    // The rule that actually bites: P-1 declares employee_id AND full_name, so an
    // adapter that indexed one of them has not proven the record absent.
    const twoKeys = [...EXPECTED, { key: 'full_name', value: 'Dana Ok' }];
    expect(judge(PROOF, twoKeys)).toEqual({ honest: false, failure: 'query-key-missing' });
  });

  it('disbelieves an absence whose query key is not the record key', () => {
    const wrong = { ...PROOF, queryKeys: [{ key: 'account_id', value: 'ag-1001' }] };
    // Exact opaque strings. No trimming, case folding or numeric parsing anywhere.
    expect(judge(wrong)).toEqual({ honest: false, failure: 'query-key-mismatch' });
  });

  it('disbelieves an absence with no declared search key to prove anything about', () => {
    expect(judge(PROOF, [])).toEqual({ honest: false, failure: 'query-key-missing' });
  });

  it('disbelieves an absence whose empty result the Observation does not link', () => {
    const other = { ...PROOF, emptyResultEvidenceId: 'evidence-2' };
    expect(judge(other)).toEqual({ honest: false, failure: 'empty-result-unlinked' });
  });

  it('disbelieves an absence whose empty result is not registered Evidence', () => {
    // A reservation nothing was written to is not a stored empty response.
    expect(judge(PROOF, EXPECTED, [])).toEqual({ honest: false, failure: 'empty-result-unregistered' });
  });

  it('disbelieves an absence from an extraction that did not prove itself complete', () => {
    expect(judge({ ...PROOF, extractionComplete: false })).toEqual({
      honest: false,
      failure: 'extraction-incomplete',
    });
  });

  it('refuses a proof that is not the proof shape', () => {
    expect(isObservationAbsenceProof(PROOF)).toBe(true);
    expect(isObservationAbsenceProof({ ...PROOF, extra: 1 })).toBe(false);
    expect(isObservationAbsenceProof({ ...PROOF, queryKeys: [] })).toBe(false);
    expect(isObservationAbsenceProof({ ...PROOF, extractionComplete: 'yes' })).toBe(false);
    // Two entries for one key is an ambiguous declaration, which declares nothing.
    expect(
      isObservationAbsenceProof({
        ...PROOF,
        queryKeys: [{ key: 'a', value: 'x' }, { key: 'a', value: 'y' }],
      }),
    ).toBe(false);
  });
});

describe('the coverage state', () => {
  const coverage = (
    subject: ObservationRecord,
    proof: ObservationAbsenceProof | null = null,
    registered = REGISTERED,
  ) => observationCoverage({ record: subject, absence: proof, expectedQueryKeys: EXPECTED, registeredEvidenceIds: registered });

  it('covers a resolved match', () => {
    expect(coverage(FOUND)).toBe('COVERED');
  });

  it('covers an absence that proved it looked', () => {
    expect(coverage(ABSENT, PROOF)).toBe('COVERED');
  });

  it('leaves an absence that proved nothing UNINSPECTED', () => {
    expect(coverage(ABSENT, null)).toBe('UNINSPECTED');
    expect(coverage(ABSENT, { ...PROOF, extractionComplete: false })).toBe('UNINSPECTED');
  });

  it('never calls an ambiguous match covered, whatever proof is offered', () => {
    // H's per-record coverage counts found in {true, false} only, so calling this
    // COVERED would be a lie in exactly the place the Gate reads.
    expect(coverage(AMBIGUOUS, PROOF)).toBe('AMBIGUOUS');
  });

  it('lets only a covered record be Compliant', () => {
    expect(OBSERVATION_COVERAGE_VALUES.filter(canBeCompliant)).toEqual(['COVERED']);
  });
});

describe('the per-Observation checks', () => {
  const run = (input: Partial<Parameters<typeof observationChecks>[0]> & { record: ObservationRecord }) =>
    observationChecks({
      absence: null,
      expectedQueryKeys: EXPECTED,
      registeredEvidenceIds: REGISTERED,
      runStartedAt: '2026-09-05T09:00:00.000Z',
      registeredAt: '2026-09-05T11:00:00.000Z',
      ...input,
    });
  const outcome = (results: readonly ObservationCheckResult[], name: string) =>
    results.find((entry) => entry.check === name) ?? null;

  it('passes everything for a grounded, fresh, resolved match', () => {
    const results = run({ record: FOUND });
    expect(results.every((entry) => entry.outcome === 'PASS')).toBe(true);
    expect(results.map((entry) => entry.check)).toEqual([
      'identity-corroboration', 'ambiguous-match', 'required-evidence', 'freshness',
    ]);
  });

  it('never carries a diagnostic on a PASS, and always carries one on a FAIL', () => {
    for (const subject of [FOUND, ABSENT, AMBIGUOUS]) {
      for (const entry of run({ record: subject })) {
        expect(entry.diagnostic === null).toBe(entry.outcome === 'PASS');
        if (entry.diagnostic !== null) expect(isObservationCheckResult(entry)).toBe(true);
      }
    }
  });

  it('fails identity corroboration when the displayed key is not the record key', () => {
    const mismatched = {
      ...FOUND,
      identity: { ...FOUND.identity!, normalizedValue: 'AG-9999' },
    } as ObservationRecord;
    expect(outcome(run({ record: mismatched }), 'identity-corroboration')).toEqual({
      check: 'identity-corroboration', outcome: 'FAIL', diagnostic: 'identity-mismatch',
    });
  });

  it('judges search completeness only on an absence, and by the absence rule', () => {
    expect(outcome(run({ record: FOUND }), 'search-completeness')).toBeNull();
    expect(outcome(run({ record: ABSENT, absence: PROOF }), 'search-completeness')?.outcome).toBe('PASS');
    expect(outcome(run({ record: ABSENT }), 'search-completeness')).toEqual({
      check: 'search-completeness', outcome: 'FAIL', diagnostic: 'absence-proof-missing',
    });
  });

  it('fails the ambiguous-match check for exactly the ambiguous ones', () => {
    expect(outcome(run({ record: AMBIGUOUS }), 'ambiguous-match')?.outcome).toBe('FAIL');
    expect(outcome(run({ record: FOUND }), 'ambiguous-match')?.outcome).toBe('PASS');
    expect(outcome(run({ record: ABSENT }), 'ambiguous-match')?.outcome).toBe('PASS');
  });

  it('fails required Evidence when a captured attribute is not grounded', () => {
    // §B.1: an attribute without grounding is treated as NOT CAPTURED.
    const ungrounded = {
      ...FOUND,
      attributes: [{ ...FOUND.attributes[0]!, grounding: null }],
    } as ObservationRecord;
    expect(outcome(run({ record: ungrounded }), 'required-evidence')).toEqual({
      check: 'required-evidence', outcome: 'FAIL', diagnostic: 'attribute-ungrounded',
    });
  });

  it('does not require an attribute another Target System supplies', () => {
    // `plan.observations` is the UNION across every Target System of the Procedure: P-3
    // declares `amount` and `processed_time`, which live in the population and not in the
    // approvals system. Requiring all of them of one adapter Observation would fail a
    // correct Run, so the check judges what the Observation carries and nothing else.
    expect(outcome(run({ record: FOUND }), 'required-evidence')?.outcome).toBe('PASS');
  });

  it('fails required Evidence when the linked Evidence is not registered', () => {
    // A reservation nothing was written to grounds nothing.
    expect(outcome(run({ record: FOUND, registeredEvidenceIds: [] }), 'required-evidence')).toEqual({
      check: 'required-evidence', outcome: 'FAIL', diagnostic: 'evidence-unregistered',
    });
  });

  it('requires no attributes of an absence or an ambiguous match', () => {
    expect(outcome(run({ record: ABSENT }), 'required-evidence')?.outcome).toBe('PASS');
    expect(outcome(run({ record: AMBIGUOUS }), 'required-evidence')?.outcome).toBe('PASS');
  });

  it('fails freshness for a capture outside the Run', () => {
    expect(outcome(run({ record: FOUND, runStartedAt: '2026-09-05T10:30:00.000Z' }), 'freshness')).toEqual({
      check: 'freshness', outcome: 'FAIL', diagnostic: 'capture-before-run',
    });
    expect(outcome(run({ record: FOUND, registeredAt: '2026-09-05T09:30:00.000Z' }), 'freshness')?.diagnostic).toBe(
      'capture-after-registration',
    );
  });
});

describe('per-condition evaluations', () => {
  const evaluation: ObservationEvaluation = {
    conditionId: 'C1',
    origin: 'RULE',
    value: 'EXCEPTION',
    confirmation: null,
    confidence: null,
    rationale: 'account_id AG-1001 retains access',
    diagnostic: null,
    evidenceIds: ['evidence-1'],
  };

  it('accepts a Rule-Classified evaluation', () => {
    expect(isObservationEvaluation(evaluation)).toBe(true);
  });

  it('accepts an Agent-Judged evaluation with a decimal confidence', () => {
    expect(
      isObservationEvaluation({ ...evaluation, origin: 'AGENT_JUDGED', confirmation: 'pending', confidence: '0.81' }),
    ).toBe(true);
  });

  it('refuses confirmation or confidence on anything but an Agent-Judged evaluation', () => {
    expect(isObservationEvaluation({ ...evaluation, confirmation: 'pending' })).toBe(false);
    expect(isObservationEvaluation({ ...evaluation, confidence: '0.5' })).toBe(false);
    expect(isObservationEvaluation({ ...evaluation, origin: 'HUMAN', confidence: '0.5' })).toBe(false);
  });

  it('refuses a confidence that is not a decimal string in [0,1]', () => {
    const judged = { ...evaluation, origin: 'AGENT_JUDGED' as const };
    // Never a binary float: the frozen Agent-Judged threshold is a decimal string, and
    // two representations of one quantity is one representation too many.
    expect(isObservationEvaluation({ ...judged, confidence: 0.81 })).toBe(false);
    expect(isObservationEvaluation({ ...judged, confidence: '1.2' })).toBe(false);
    expect(isObservationEvaluation({ ...judged, confidence: '-0' })).toBe(false);
    expect(isObservationEvaluation({ ...judged, confidence: '1' })).toBe(true);
    expect(isObservationEvaluation({ ...judged, confidence: '0' })).toBe(true);
  });

  it('refuses an evaluation outside the vocabulary or the shape', () => {
    expect(isObservationEvaluation({ ...evaluation, origin: 'PLATFORM' })).toBe(false);
    expect(isObservationEvaluation({ ...evaluation, value: 'PASS' })).toBe(false);
    expect(isObservationEvaluation({ ...evaluation, extra: 1 })).toBe(false);
    expect(isObservationEvaluation({ ...evaluation, evidenceIds: ['e', 'e'] })).toBe(false);
    expect(isObservationEvaluation({ ...evaluation, conditionId: '' })).toBe(false);
    // UNEVALUATED is a VALUE and never an origin.
    expect(isObservationEvaluation({ ...evaluation, origin: 'UNEVALUATED' })).toBe(false);
    expect(isObservationEvaluation({ ...evaluation, value: 'UNEVALUATED' })).toBe(true);
  });
});

describe('capture-time normalization', () => {
  it('normalizes an offset-bearing instant to UTC and keeps the original', () => {
    expect(normalizeObservedAt('2026-08-10T10:30:00+02:00')).toEqual({
      observedAt: '2026-08-10T08:30:00.000Z',
      source: '2026-08-10T10:30:00+02:00',
    });
  });

  it('leaves a UTC instant where it is', () => {
    expect(normalizeObservedAt('2026-09-05T00:00:00.000Z')).toEqual({
      observedAt: '2026-09-05T00:00:00.000Z',
      source: '2026-09-05T00:00:00.000Z',
    });
  });

  it('never shifts the instant it was given', () => {
    for (const source of ['2026-08-10T10:30:00+02:00', '2026-08-10T05:30:00-03:00', '2026-08-10T08:30:00Z']) {
      const normalized = normalizeObservedAt(source)!;
      expect(Date.parse(normalized.observedAt)).toBe(Date.parse(source));
      expect(isObservationInstant(normalized.observedAt)).toBe(true);
    }
  });

  it('refuses anything that is not an ISO 8601 instant with a real date behind it', () => {
    for (const value of ['', 'yesterday', '2026-09-05', '2026-09-05T00:00:00', '2026-02-30T00:00:00Z', 42, null]) {
      expect(normalizeObservedAt(value)).toBeNull();
    }
  });
});
