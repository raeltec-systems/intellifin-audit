import { describe, expect, it } from 'vitest';

import { countWords, durationWords } from './plan-numbers';

/**
 * These render a frozen plan value in the form a person reads. The one property that
 * matters is that they never say a DIFFERENT value: a rounded limit on the surface an
 * auditor reads before spending a Run would be worse than the raw digits.
 */
describe('a plan number said to a person', () => {
  it.each([
    [0, '0'],
    [3, '3'],
    [999, '999'],
    [1000, '1,000'],
    [10000, '10,000'],
    [1000000, '1,000,000'],
    [-1234, '-1,234'],
  ])('%i groups as %s', (value, expected) => {
    expect(countWords(value)).toBe(expected);
  });

  it('says a value it cannot group rather than an empty string', () => {
    expect(countWords(Number.NaN)).toBe('NaN');
    expect(countWords(Number.POSITIVE_INFINITY)).toBe('Infinity');
  });
});

describe('a plan duration said to a person', () => {
  it.each([
    [0, '0 seconds'],
    [1, '1 second'],
    [59, '59 seconds'],
    [60, '1 minute'],
    [90, '1 minute 30 seconds'],
    [120, '2 minutes'],
    [3600, '1 hour'],
    [3660, '1 hour 1 minute'],
    [3661, '1 hour 1 minute 1 second'],
    [7200, '2 hours'],
    [86400, '24 hours'],
  ])('%i seconds reads as %s', (seconds, expected) => {
    expect(durationWords(seconds)).toBe(expected);
  });

  it('never rounds: every part of the frozen value survives', () => {
    // 3599 is one second short of an hour and must not read as "1 hour".
    expect(durationWords(3599)).toBe('59 minutes 59 seconds');
  });

  it('falls back to seconds for a value it cannot break down', () => {
    expect(durationWords(-1)).toBe('-1 seconds');
    expect(durationWords(Number.NaN)).toBe('NaN seconds');
  });
});
