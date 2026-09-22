import { describe, expect, it } from 'vitest';

import { countNoun } from './words';

describe('a count with its noun', () => {
  it('pluralises by the count, and only by the count', () => {
    expect(countNoun(1, 'Observation')).toBe('1 Observation');
    expect(countNoun(0, 'Observation')).toBe('0 Observations');
    expect(countNoun(2, 'Observation')).toBe('2 Observations');
  });

  it('takes an irregular plural', () => {
    expect(countNoun(1, 'Step Execution', 'Step Executions')).toBe('1 Step Execution');
    expect(countNoun(3, 'Step Execution', 'Step Executions')).toBe('3 Step Executions');
  });

  it('writes thousands separators', () => {
    expect(countNoun(1842, 'record')).toBe('1,842 records');
  });
});
