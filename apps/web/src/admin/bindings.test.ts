import { describe, expect, it } from 'vitest';

import { DECLARED_COUNT_MECHANISMS, POPULATION_SOURCE_KINDS } from '@intellifin/domain';
import { BINDING_STATUSES } from '@intellifin/application';

import {
  BINDING_KIND_OPTIONS,
  MECHANISM_OPTIONS,
  UNKNOWN_LABEL,
  bindingKindLabel,
  bindingStatusLabel,
  declaresNoCount,
  linesToList,
  listToLines,
  mechanismLabel,
} from './bindings';

/**
 * The binding label lookups, and the guard that makes them safe.
 *
 * Every one of these is keyed by a value that arrives from request input — a `<select>`
 * value, or a column of a row somebody else wrote. A plain `MAP[key]` inherits from
 * `Object.prototype`, so `key = 'constructor'` returns a function and the caller carries
 * on with it. This codebase has been bitten by that five times (`ACTION_RULES`,
 * `SECTION_LABELS`, `ICON_GLYPHS`, `ROLE_LABELS`, and the registration labels), which is
 * exactly why these three functions use `Object.hasOwn` — and why the guards need their
 * own test rather than a comment saying they are there.
 */

const PROTOTYPE_KEYS = ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'];

describe('the binding label lookups', () => {
  it.each(POPULATION_SOURCE_KINDS)('names the %s kind', (kind) => {
    expect(typeof bindingKindLabel(kind)).toBe('string');
    expect(bindingKindLabel(kind)).not.toBe('');
    expect(bindingKindLabel(kind)).not.toBe(UNKNOWN_LABEL);
  });

  it.each(DECLARED_COUNT_MECHANISMS)('names the %s mechanism', (mechanism) => {
    expect(typeof mechanismLabel(mechanism)).toBe('string');
    expect(mechanismLabel(mechanism)).not.toBe(UNKNOWN_LABEL);
  });

  it.each(BINDING_STATUSES)('names the %s status', (status) => {
    expect(bindingStatusLabel(status)).not.toBe(UNKNOWN_LABEL);
  });

  it('says "None declared" in words rather than leaving a blank', () => {
    // A dash or an empty cell is something a reader takes for "fine", and this is the one
    // value that stops every Procedure bound to the source from being submitted.
    expect(mechanismLabel('none')).toBe('None declared');
  });

  it.each(PROTOTYPE_KEYS)('returns a string, never an inherited member, for %s', (key) => {
    for (const label of [bindingKindLabel, mechanismLabel, bindingStatusLabel]) {
      const value = label(key);
      expect(typeof value).toBe('string');
      // The tell for the defect: an inherited member stringifies with "function".
      expect(value).not.toContain('function');
      expect(value).toBe(UNKNOWN_LABEL);
    }
  });

  it('offers exactly the vocabularies the domain and application declare', () => {
    // Derived from the source lists, so a kind added there is offerable here without
    // anybody remembering — and one removed there stops being offerable.
    expect(BINDING_KIND_OPTIONS.map((option) => option.value)).toEqual([
      ...POPULATION_SOURCE_KINDS,
    ]);
    expect(MECHANISM_OPTIONS.map((option) => option.value)).toEqual([
      ...DECLARED_COUNT_MECHANISMS,
    ]);
  });
});

describe('the missing-count predicate', () => {
  it('is true for `none` and false for the two real mechanisms', () => {
    expect(declaresNoCount('none')).toBe(true);
    expect(declaresNoCount('cover-sheet')).toBe(false);
    expect(declaresNoCount('count-endpoint')).toBe(false);
  });

  it('is false for anything outside the vocabulary', () => {
    // Failing the other way would hide the warning on a row nobody can interpret.
    expect(declaresNoCount('constructor')).toBe(false);
    expect(declaresNoCount('')).toBe(false);
  });
});

describe('the textarea list helpers', () => {
  it('round-trips a list through the text a person edits, in order', () => {
    const values = ['employee_id', 'employment_status', 'salary'];
    expect(linesToList(listToLines(values))).toEqual(values);
  });

  it('drops blank lines and trims, so a trailing newline adds no empty field', () => {
    expect(linesToList('employee_id\n\n  salary  \n')).toEqual(['employee_id', 'salary']);
  });

  it('never sorts: the declared schema is a positional declaration', () => {
    expect(linesToList('salary\nemployee_id')).toEqual(['salary', 'employee_id']);
  });
});

