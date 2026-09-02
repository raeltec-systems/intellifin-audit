import { describe, expect, it } from 'vitest';

import {
  DECLARED_COUNT_MECHANISMS,
  POPULATION_SOURCE_KINDS,
  bindingDigest,
  bindingDigestEnvelope,
  declaresNoExpectedCount,
  isDeclaredCountMechanism,
  isPopulationSourceKind,
  sensitiveFieldsAreDeclared,
  type BindingDigestInput,
} from './population-source.js';

/**
 * The binding digest contract: the five keys, the two OPPOSITE normalization rules, and
 * the sensitive-field subset rule.
 *
 * The comparison against independently produced vectors is
 * `tests/unit/binding-digest.test.ts` — this package has no `@types/node` and cannot read
 * a fixture off disk, exactly as `packages/domain` cannot read `process.env`.
 */

/** The exact five keys, in the order canonical JSON puts them. */
const FIVE_KEYS = [
  'declared_count_mechanism',
  'declared_schema',
  'kind',
  'location',
  'sensitive_fields',
];

const BASE: BindingDigestInput = {
  kind: 'versioned-file',
  location: 's3://synthetic-bucket/hr/leavers/2026-08.csv',
  declaredSchema: ['employee_id', 'employment_status', 'termination_date', 'salary'],
  declaredCountMechanism: 'cover-sheet',
  sensitiveFields: ['salary'],
};

describe('the binding digest envelope', () => {
  it('gives every kind the same five keys, whether or not a value is empty', () => {
    for (const kind of POPULATION_SOURCE_KINDS) {
      const envelope = bindingDigestEnvelope({
        ...BASE,
        kind,
        location: '',
        declaredSchema: [],
        sensitiveFields: [],
      });
      expect(Object.keys(envelope).sort()).toEqual(FIVE_KEYS);
      expect(envelope.location).toBeNull();
    }
  });

  it('gives a manual upload a null location, whatever was typed', () => {
    // A manual upload names nowhere: the file arrives with the Run. A location typed
    // into a form that then switched kind must not reach the hash, or two bindings
    // that behave identically would freeze different contracts.
    const envelope = bindingDigestEnvelope({
      ...BASE,
      kind: 'manual-upload',
      location: 'https://ignored.synthetic.invalid/never-read',
    });
    expect(envelope.location).toBeNull();
    expect(Object.keys(envelope).sort()).toEqual(FIVE_KEYS);
    expect(bindingDigest({ ...BASE, kind: 'manual-upload', location: 'a' })).toBe(
      bindingDigest({ ...BASE, kind: 'manual-upload', location: 'b' }),
    );
  });

  it('carries no key the five do not name, however the input grows', () => {
    // A binding also has an id, a display name, a note, a status and timestamps. A
    // spread would put every one of them in the hash and move a digest that must not
    // move.
    const envelope = bindingDigestEnvelope({
      ...BASE,
      displayName: 'HR leavers export',
      note: 'a note',
      status: 'retired',
      bindingId: '018f0000-0000-7000-8000-000000000001',
    } as BindingDigestInput & Record<string, unknown>);
    expect(Object.keys(envelope).sort()).toEqual(FIVE_KEYS);
    expect(bindingDigest(BASE)).toBe(
      bindingDigest({ ...BASE, displayName: 'Something else' } as BindingDigestInput),
    );
  });

  it('keeps the declared schema in the order it was typed', () => {
    // A schema declares field POSITIONS. `[account, amount]` and `[amount, account]`
    // are two different declarations and a parser told the second reads the wrong
    // column, so the order is part of what a Procedure Version freezes.
    const reordered = bindingDigestEnvelope({
      ...BASE,
      declaredSchema: ['salary', 'employee_id', 'employment_status', 'termination_date'],
    });
    expect(reordered.declared_schema).toEqual([
      'salary',
      'employee_id',
      'employment_status',
      'termination_date',
    ]);
    expect(bindingDigest({ ...BASE, declaredSchema: reordered.declared_schema })).not.toBe(
      bindingDigest(BASE),
    );
  });

  it('trims and deduplicates the declared schema without sorting it', () => {
    expect(
      bindingDigestEnvelope({
        ...BASE,
        declaredSchema: [
          '  employee_id  ',
          'employment_status',
          '',
          'termination_date',
          'salary',
          'employee_id',
          '   ',
        ],
      }).declared_schema,
    ).toEqual(BASE.declaredSchema);
  });

  it('treats the sensitive fields as a set, not as a list', () => {
    // Masking asks only whether a field is in the group. Retyping the same two names in
    // the other order has not changed which values are hidden, and a digest that moved
    // would mint a platform-authored draft for every referencing Procedure over nothing.
    const digest = bindingDigest({ ...BASE, sensitiveFields: ['salary', 'employee_id'] });
    expect(bindingDigest({ ...BASE, sensitiveFields: ['employee_id', 'salary'] })).toBe(digest);
    expect(
      bindingDigest({ ...BASE, sensitiveFields: ['  salary ', 'employee_id', 'salary', ''] }),
    ).toBe(digest);
  });

  it('moves when any one of the five changes', () => {
    const base = bindingDigest(BASE);
    const variants: readonly BindingDigestInput[] = [
      { ...BASE, kind: 'read-only-api' },
      { ...BASE, location: 's3://synthetic-bucket/hr/leavers/2026-09.csv' },
      { ...BASE, declaredSchema: [...BASE.declaredSchema, 'department'] },
      { ...BASE, declaredCountMechanism: 'none' },
      { ...BASE, sensitiveFields: ['employee_id'] },
    ];
    for (const variant of variants) {
      expect(bindingDigest(variant)).not.toBe(base);
    }
    expect(new Set(variants.map(bindingDigest)).size).toBe(variants.length);
  });

  it('is 64 lower-case hex characters', () => {
    expect(bindingDigest(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the binding vocabularies', () => {
  it('recognizes the three kinds and nothing else', () => {
    for (const kind of POPULATION_SOURCE_KINDS) expect(isPopulationSourceKind(kind)).toBe(true);
    expect(POPULATION_SOURCE_KINDS).toEqual(['manual-upload', 'versioned-file', 'read-only-api']);
    expect(isPopulationSourceKind('database')).toBe(false);
    // A plain object lookup answers `constructor` with an inherited function; the guard
    // is a list membership test, so it cannot.
    expect(isPopulationSourceKind('constructor')).toBe(false);
    expect(isPopulationSourceKind('toString')).toBe(false);
    expect(isPopulationSourceKind(undefined)).toBe(false);
  });

  it('recognizes the three declared-count mechanisms and nothing else', () => {
    for (const mechanism of DECLARED_COUNT_MECHANISMS) {
      expect(isDeclaredCountMechanism(mechanism)).toBe(true);
    }
    expect(DECLARED_COUNT_MECHANISMS).toEqual(['cover-sheet', 'count-endpoint', 'none']);
    expect(isDeclaredCountMechanism('signed')).toBe(false);
    expect(isDeclaredCountMechanism('constructor')).toBe(false);
    expect(isDeclaredCountMechanism(null)).toBe(false);
  });

  it('names `none` as the one mechanism that blocks submission', () => {
    expect(declaresNoExpectedCount('none')).toBe(true);
    expect(declaresNoExpectedCount('cover-sheet')).toBe(false);
    expect(declaresNoExpectedCount('count-endpoint')).toBe(false);
  });
});

describe('the sensitive-field subset rule', () => {
  it('accepts a designation that names a declared field', () => {
    expect(
      sensitiveFieldsAreDeclared({
        declaredSchema: ['employee_id', 'salary'],
        sensitiveFields: ['salary'],
      }),
    ).toBe(true);
  });

  it('accepts no designation at all', () => {
    expect(
      sensitiveFieldsAreDeclared({ declaredSchema: ['employee_id'], sensitiveFields: [] }),
    ).toBe(true);
  });

  it('refuses a mask over a field the schema does not declare', () => {
    // A mask over a field that does not exist masks nothing and reads, in a list view,
    // exactly like protection.
    expect(
      sensitiveFieldsAreDeclared({
        declaredSchema: ['employee_id', 'salary'],
        sensitiveFields: ['salary', 'bonus'],
      }),
    ).toBe(false);
  });

  it('compares the normalized values, so surrounding space is not a mismatch', () => {
    expect(
      sensitiveFieldsAreDeclared({
        declaredSchema: ['  salary  '],
        sensitiveFields: ['salary'],
      }),
    ).toBe(true);
  });

  it('refuses an inherited key, which a Set does not answer for', () => {
    expect(
      sensitiveFieldsAreDeclared({
        declaredSchema: ['employee_id'],
        sensitiveFields: ['constructor'],
      }),
    ).toBe(false);
  });
});
