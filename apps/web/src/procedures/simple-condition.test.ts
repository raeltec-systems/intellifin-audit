import { describe, expect, it } from 'vitest';

import {
  COMPLIANCE_OBSERVATION_FIELDS,
  compileComplianceDraft,
  findProcedureTemplate,
  initialDraftCompliance,
  templateConditionText,
} from '@intellifin/domain';

import {
  DISABLEMENT_TIME_ATTRIBUTE,
  DISABLEMENT_WINDOW_APPLICABILITY,
  DISABLEMENT_WINDOW_COMPARISON,
  DISABLEMENT_WINDOW_CONDITION_ID,
  DISABLEMENT_WINDOW_PATTERN,
  DISABLEMENT_WINDOW_TEXT,
  disablementWindowCondition,
  isDisablementWindow,
  readSimpleCondition,
  valueLines,
  writeSimpleCondition,
  type SimpleCondition,
} from './simple-condition';

/**
 * Simple and advanced modes operate on ONE string. These tests hold both halves of that
 * claim: what is written reads back as the same controls, and what the compiler makes of
 * the written text is the rule the controls described. A round trip checked only against
 * this module would prove that it agrees with itself.
 */

const P1_C1_PROSE = templateConditionText(
  findProcedureTemplate('P-1').conditions.find((condition) => condition.conditionId === 'C1')!,
);

/** What the compiler makes of a text, as the editor's badge and the plan both read it. */
function compiledRule(text: string, comparison: { boundary: 'inclusive' | 'exclusive'; threshold: string; tolerance: string } | null = null) {
  const result = compileComplianceDraft('P-1', {
    conditions: [{ conditionId: 'C1', text, applicability: 'all records', comparison }],
    confidenceThreshold: '0.80',
  });
  expect(result.ok, result.ok ? '' : result.reason).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.value.complianceConditions[0]!;
}

describe('reading a condition as simple controls', () => {
  it("reads the Template's own prose out of the rule frozen beside it", () => {
    // P-1 C1 ships as PROSE. The compiler recognizes it by equality and uses the
    // Template's rule; the simple editor has to open on that, or the hero Template's
    // one Rule-Classified condition would meet the advanced textarea on first sight.
    const read = readSimpleCondition(P1_C1_PROSE, 'P-1', 'C1');
    expect(read).toEqual({
      kind: 'status-set',
      field: 'account_status',
      provenAbsence: true,
      compliant: ['disabled'],
      exception: ['active'],
    });
  });

  it('reads an explicit named-set expression, with and without proven absence', () => {
    expect(readSimpleCondition('account_status in [Disabled] else [Active]', 'P-1', 'C1')).toEqual({
      kind: 'status-set',
      field: 'account_status',
      provenAbsence: false,
      compliant: ['Disabled'],
      exception: ['Active'],
    });
    expect(
      readSimpleCondition('found = false or account_status in [Disabled, Closed] else [Active]', 'P-1', 'C1'),
    ).toEqual({
      kind: 'status-set',
      field: 'account_status',
      provenAbsence: true,
      compliant: ['Disabled', 'Closed'],
      exception: ['Active'],
    });
  });

  it('reads the disablement window with its hours and its boundary', () => {
    expect(readSimpleCondition('disabled_time - termination_time <= 24h', 'P-1', 'C1')).toEqual({
      kind: 'disablement-window',
      hours: '24',
      boundary: 'inclusive',
    });
    expect(readSimpleCondition('disabled_time - termination_time < 48h', 'P-1', 'C1')).toEqual({
      kind: 'disablement-window',
      hours: '48',
      boundary: 'exclusive',
    });
  });

  it('answers null for prose and for an expression with no simple form', () => {
    for (const text of [
      'Confirm that each retained access right has a documented business reason.',
      'found = true',
      'account_status in [Disabled] else [Active] and found = true',
      '',
      'not account_status in [Disabled] else [Active]',
    ]) {
      expect(readSimpleCondition(text, 'P-1', 'C1'), text).toBeNull();
    }
  });

  it('does not mistake another condition for the Template prose it does not own', () => {
    // The prose belongs to C1. Read as C2's text it is prose the simple editor cannot show.
    expect(readSimpleCondition(P1_C1_PROSE, 'P-1', 'C2')).toBeNull();
  });
});

describe('writing simple controls back into condition text', () => {
  it('round-trips every value it accepts, and the compiler agrees with the controls', () => {
    const cases: readonly SimpleCondition[] = [
      { kind: 'status-set', field: 'account_status', provenAbsence: true, compliant: ['Disabled'], exception: ['Active'] },
      { kind: 'status-set', field: 'account_status', provenAbsence: false, compliant: ['disabled'], exception: ['active'] },
      { kind: 'status-set', field: 'account_status', provenAbsence: true, compliant: ['Disabled', 'Closed'], exception: ['Active', 'Suspended'] },
      // Values the grammar cannot carry as bare tokens: a space, a reserved word, a
      // quote, a digit-first token, a non-ASCII letter.
      { kind: 'status-set', field: 'account_status', provenAbsence: true, compliant: ['Not Active'], exception: ['in'] },
      { kind: 'status-set', field: 'account_status', provenAbsence: false, compliant: ['say "no"'], exception: ['1-active'] },
      { kind: 'status-set', field: 'account_status', provenAbsence: false, compliant: ['Désactivé'], exception: ['Actif'] },
      { kind: 'disablement-window', hours: '24', boundary: 'inclusive' },
      { kind: 'disablement-window', hours: '0.5', boundary: 'exclusive' },
    ];
    for (const value of cases) {
      const text = writeSimpleCondition(value, 'P-1', 'C1');
      expect(text, JSON.stringify(value)).not.toBeNull();
      expect(readSimpleCondition(text!, 'P-1', 'C1'), text!).toEqual(value);
      // And the COMPILER — not this module — must make the intended rule of that text.
      const compiled = compiledRule(
        text!,
        value.kind === 'disablement-window' ? { boundary: value.boundary, threshold: value.hours, tolerance: '0' } : null,
      );
      expect(compiled.status).toBe('RULE');
      if (value.kind === 'disablement-window') {
        expect(compiled.rule).toEqual({
          kind: 'disablement-window',
          disabledField: 'disabled_time',
          terminationField: 'termination_time',
          hours: value.hours,
          boundary: value.boundary,
          tolerance: '0',
        });
      } else {
        const set = { kind: 'named-set', field: value.field, compliant: value.compliant, exception: value.exception };
        expect(compiled.rule).toEqual({
          kind: 'predicate',
          predicate: value.provenAbsence
            ? { kind: 'any', expressions: [{ kind: 'boolean', field: 'found', value: false }, set] }
            : set,
        });
      }
    }
  });

  it('writes the explicit expression the owner asked for, in the owner\'s own spelling', () => {
    expect(
      writeSimpleCondition(
        { kind: 'status-set', field: 'account_status', provenAbsence: true, compliant: ['Disabled'], exception: ['Active'] },
        'P-1',
        'C1',
      ),
    ).toBe('found = false or account_status in [Disabled] else [Active]');
  });

  it('refuses a value the compiler grammar cannot carry, rather than storing something else', () => {
    const write = (value: string): string | null =>
      writeSimpleCondition(
        { kind: 'status-set', field: 'account_status', provenAbsence: false, compliant: [value], exception: ['Active'] },
        'P-1',
        'C1',
      );
    // The grammar's string token carries a quote and a backslash as escapes and nothing
    // else, so a line break, a tab or a NUL has no spelling inside a rule at all.
    for (const bad of ['two\nlines', 'a\ttab', 'null\u0000byte', 'vertical\u000btab']) {
      expect(write(bad), JSON.stringify(bad)).toBeNull();
    }
    // BOTH directions: an awkward value that DOES have a spelling is written rather than
    // refused — a rule that refused everything would pass the loop above on its own.
    for (const awkward of ['Not Active', 'say "no"', 'back\\slash', 'D\u00e9sactiv\u00e9', 'in']) {
      expect(write(awkward), JSON.stringify(awkward)).not.toBeNull();
    }
  });

  it('refuses an empty list and a value claimed by both lists', () => {
    const base = { kind: 'status-set', field: 'account_status', provenAbsence: false } as const;
    expect(writeSimpleCondition({ ...base, compliant: [], exception: ['Active'] }, 'P-1', 'C1')).toBeNull();
    expect(writeSimpleCondition({ ...base, compliant: ['Disabled'], exception: [] }, 'P-1', 'C1')).toBeNull();
    // The compiler refuses an overlap outright; refusing it here names it while typing.
    expect(writeSimpleCondition({ ...base, compliant: ['Both'], exception: ['Both'] }, 'P-1', 'C1')).toBeNull();
  });

  it('never changes the case of a value', () => {
    const text = writeSimpleCondition(
      { kind: 'status-set', field: 'account_status', provenAbsence: false, compliant: ['DISABLED'], exception: ['Active'] },
      'P-1',
      'C1',
    );
    expect(text).toContain('DISABLED');
    expect(text).not.toContain('[disabled]');
  });
});

describe('switching modes changes nothing on its own', () => {
  it('leaves every Template pre-fill exactly as the Template wrote it', () => {
    // Reading is not writing: a condition opened in simple mode and closed again has to
    // be the same bytes, or the Builder would report a dirty section nobody edited.
    for (const templateId of ['P-1', 'P-2', 'P-3', 'P-4'] as const) {
      for (const condition of initialDraftCompliance(templateId).complianceConditions) {
        const read = readSimpleCondition(condition.text, templateId, condition.conditionId);
        if (read === null) continue;
        // The controls are readable; writing them back is a separate, explicit act.
        expect(readSimpleCondition(condition.text, templateId, condition.conditionId)).toEqual(read);
      }
    }
  });
});

describe('the shared disablement-window pattern', () => {
  it('is the one copy in apps/web, and matches what the editor offers', () => {
    expect(DISABLEMENT_WINDOW_PATTERN.test('disabled_time - termination_time <= 24h')).toBe(true);
    expect(DISABLEMENT_WINDOW_PATTERN.test('disabled_time - termination_time <= 24 hours')).toBe(false);
    // P-1 is the only Template that declares both time fields the window compares.
    expect(COMPLIANCE_OBSERVATION_FIELDS['P-1']['disabled_time']).toBe('time');
    expect(COMPLIANCE_OBSERVATION_FIELDS['P-1']['termination_time']).toBe('time');
  });
});

describe('one value per line', () => {
  it('keeps blank lines as typing room and trims only surrounding whitespace', () => {
    expect(valueLines('Disabled\n\n  Closed  \n')).toEqual(['Disabled', 'Closed']);
    expect(valueLines('')).toEqual([]);
    // An inner space is part of the value, not a separator.
    expect(valueLines('Not Active')).toEqual(['Not Active']);
  });
});

describe("P-1's 24-hour disablement window", () => {
  it('is a condition the frozen compiler accepts, and compiles to the intended rule', () => {
    const condition = disablementWindowCondition('P-1', '0.80');
    expect(condition.conditionId).toBe(DISABLEMENT_WINDOW_CONDITION_ID);
    expect(condition.text).toBe(DISABLEMENT_WINDOW_TEXT);
    expect(condition.applicability).toBe(DISABLEMENT_WINDOW_APPLICABILITY);
    expect(condition.comparison).toEqual({ ...DISABLEMENT_WINDOW_COMPARISON });

    // The COMPILER decides what this means, not this module. Exactly 24 hours must be
    // Compliant: `exclusive` would make a disablement at the boundary an Exception.
    const compiled = compileComplianceDraft('P-1', { conditions: [condition], confidenceThreshold: '0.80' });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.complianceConditions[0]!.rule).toEqual({
      kind: 'disablement-window',
      disabledField: DISABLEMENT_TIME_ATTRIBUTE,
      terminationField: 'termination_time',
      hours: '24',
      boundary: 'inclusive',
      tolerance: '0',
    });
    expect(compiled.value.complianceConditions[0]!.status).toBe('RULE');
  });

  it('carries the explicit mapping only when the compiler accepts the key, and never null or empty', () => {
    const condition = disablementWindowCondition('P-1', '0.80');
    const mapping = (condition as { readonly mapping?: unknown }).mapping;
    if (Object.hasOwn(condition, 'mapping')) {
      // Present: exactly the declared pair, so a Version freezes the auditor's own column.
      expect(mapping).toEqual([{ field: 'termination_time', column: 'termination_effective_time' }]);
    } else {
      // Absent: the key is OMITTED, never null and never empty. A compiled condition is
      // recompiled byte for byte on every read, and an empty key is not the same bytes.
      expect(mapping).toBeUndefined();
    }
    // Either way the condition is saveable by THIS build: a key the compiler refuses
    // would make the timing choice impossible to save at all.
    expect(compileComplianceDraft('P-1', { conditions: [condition], confidenceThreshold: '0.80' }).ok).toBe(true);
  });

  it('takes an explicit id, so a Draft that already uses C3 gets a fresh one', () => {
    expect(disablementWindowCondition('P-1', '0.80', 'C-other').conditionId).toBe('C-other');
  });

  it('recognises its own condition and leaves the status rule alone', () => {
    expect(isDisablementWindow(disablementWindowCondition('P-1', '0.80'))).toBe(true);
    expect(isDisablementWindow({ text: '  disabled_time - termination_time <= 24h  ' })).toBe(true);
    const status = initialDraftCompliance('P-1').complianceConditions.find((condition) => condition.conditionId === 'C1')!;
    expect(isDisablementWindow(status)).toBe(false);
  });
});
