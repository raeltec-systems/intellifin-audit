import { findProcedureTemplate, templateConditionText } from '@intellifin/domain';
import { describe, expect, it } from 'vitest';

import { CONDITION_NOT_IN_WORDS, conditionSentence, fieldWords, simpleConditionSentence } from './condition-words';

/**
 * A condition in audit language (UI cleanup 2026-09-21, UX-13).
 *
 * Every sentence keeps the values EXACTLY as the rule names them: compiler 1 compares
 * them as exact strings, so a sentence that re-cased one would describe another rule.
 */
describe('a condition in words', () => {
  it('says what is acceptable, what is an exception, and that anything else needs review', () => {
    expect(conditionSentence('found = false or account_status in [Disabled] else [Active]', 'P-1', 'C1')).toBe(
      'Acceptable: no record is found after every required search, or the account status is “Disabled”. Exception: the account status is “Active”. Any other account status needs review.',
    );
  });

  it('keeps every value exactly as the rule spells it', () => {
    const sentence = conditionSentence('account_status in [disabled, Retired] else [Active]', 'P-1', 'C1');
    expect(sentence).toContain('“disabled” or “Retired”');
    expect(sentence).not.toContain('“Disabled”');
    expect(simpleConditionSentence({ kind: 'status-set', field: 'account_status', provenAbsence: false, compliant: ['a', 'b', 'c'], exception: ['z'] }))
      .toContain('one of “a”, “b”, “c”');
  });

  it('reads the 24-hour disablement window with its boundary', () => {
    expect(conditionSentence('disabled_time - termination_time <= 24h', 'P-1', 'C3')).toBe(
      'Acceptable: the account was disabled within 24 hours of the termination time (exactly 24 hours counts as acceptable). Exception: it was disabled later than that. A record with no disablement time or no termination time needs review.',
    );
    expect(conditionSentence('disabled_time - termination_time < 24h', 'P-1', 'C3')).toContain('in less than 24 hours');
  });

  it('reads a Template’s own prose through the rule frozen beside it', () => {
    // P-1's C1 is pinned as prose in the Template and the compiler recognises it by
    // equality; the sentence comes from the frozen rule, never from parsing the prose.
    const c1 = findProcedureTemplate('P-1').conditions.find((condition) => condition.conditionId === 'C1');
    expect(c1).toBeDefined();
    const sentence = conditionSentence(templateConditionText(c1!), 'P-1', 'C1');
    expect(sentence).toMatch(/^Acceptable: /);
    expect(sentence).toContain('Exception:');
  });

  it('answers null for a condition it cannot put into words, and names that state', () => {
    expect(conditionSentence('Treat any account whose roles look privileged as an Exception.', 'P-1', 'C2')).toBeNull();
    expect(CONDITION_NOT_IN_WORDS).toContain('rule language');
  });

  it('spaces a field name out', () => {
    expect(fieldWords('account_status')).toBe('account status');
    expect(fieldWords('roles')).toBe('roles');
  });
});
