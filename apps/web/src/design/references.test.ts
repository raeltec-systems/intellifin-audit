import { describe, expect, it } from 'vitest';

import { REFERENCE_LENGTH, referenceLabel, shortReference } from './references';

describe('a short reference', () => {
  it('is the tail of the identifier, where a UUIDv7 differs', () => {
    // Two Runs started in the same minute share their first eight characters; the last
    // eight are random.
    expect(shortReference('01a0b465-a21d-7fba-acbd-fc2abf4ea3e7')).toBe('bf4ea3e7');
    expect(shortReference('01a0b452-3b49-71c8-846d-8aac3cc45884')).toBe('3cc45884');
    expect(shortReference('01a0b465-a21d-7fba-acbd-fc2abf4ea3e7')).toHaveLength(REFERENCE_LENGTH);
  });

  it('tells two identifiers from one minute apart', () => {
    expect(shortReference('01a0b465-a21d-7fba-acbd-fc2abf4ea3e7')).not.toBe(
      shortReference('01a0b465-a21d-7fba-acbd-fc2abf4ea3e8'),
    );
  });

  it('leaves a short identifier whole', () => {
    expect(shortReference('E-000103')).toBe('E000103');
    expect(shortReference('abc')).toBe('abc');
  });

  it('names the kind of thing first', () => {
    expect(referenceLabel('Run', '01a0b465-a21d-7fba-acbd-fc2abf4ea3e7')).toBe('Run bf4ea3e7');
  });
});
