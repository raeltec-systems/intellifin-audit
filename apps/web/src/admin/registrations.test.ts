import { describe, expect, it } from 'vitest';

import { PERMITTED_READ_ACTIONS, TARGET_SYSTEM_KINDS } from '@intellifin/domain';
import { REGISTRATION_STATUSES } from '@intellifin/application';

import {
  actionLabel,
  connectivityLabel,
  kindLabel,
  linesToList,
  listToLines,
  spokenDigest,
  statusLabel,
} from './registrations';

/**
 * The label lookups, and the guard that makes them safe.
 *
 * Every one of these is keyed by a value that arrives from request input — a `<select>`
 * value, a path segment, a column of a row somebody else wrote. A plain `MAP[key]`
 * inherits from `Object.prototype`, so `key = 'constructor'` returns a function and the
 * caller carries on with it. This codebase has now been bitten by that four times
 * (`ACTION_RULES`, `SECTION_LABELS`, `ICON_GLYPHS`, `ROLE_LABELS`), which is exactly why
 * these four functions use `Object.hasOwn` — and why the guards need their own test
 * rather than a comment saying they are there.
 */

const PROTOTYPE_KEYS = ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'];

describe('the registration label lookups', () => {
  it.each(TARGET_SYSTEM_KINDS)('names the %s kind', (kind) => {
    expect(kindLabel(kind)).not.toBe('');
    expect(typeof kindLabel(kind)).toBe('string');
  });

  it.each(PERMITTED_READ_ACTIONS)('names the %s action', (action) => {
    expect(typeof actionLabel(action)).toBe('string');
    expect(actionLabel(action)).not.toBe('');
  });

  it.each(REGISTRATION_STATUSES)('names the %s status', (status) => {
    expect(typeof statusLabel(status)).toBe('string');
  });

  it.each(PROTOTYPE_KEYS)('returns a string, never an inherited member, for %s', (key) => {
    for (const label of [kindLabel, actionLabel, statusLabel, connectivityLabel]) {
      const value = label(key);
      expect(typeof value).toBe('string');
      // The tell for the defect: an inherited member stringifies with "function".
      expect(value).not.toContain('function');
    }
  });
});

describe('the textarea list helpers', () => {
  it('round-trips a list through the text a person edits', () => {
    const values = ['https://a.invalid', 'https://b.invalid'];
    expect(linesToList(listToLines(values))).toEqual(values);
  });

  it('drops blank lines and trims, so a trailing newline adds no empty origin', () => {
    expect(linesToList('https://a.invalid\n\n  https://b.invalid  \n')).toEqual([
      'https://a.invalid',
      'https://b.invalid',
    ]);
  });
});

describe('the spoken digest', () => {
  const digest = 'a1b2c3d4'.repeat(8);

  it('names the ends, so two digests can be told apart by ear', () => {
    expect(digest).toHaveLength(64);
    expect(spokenDigest(digest)).toContain('a 1 b 2');
    expect(spokenDigest(digest)).toContain('c 3 d 4');
  });

  it('never reads all 64 characters aloud', () => {
    expect(spokenDigest(digest)).not.toContain(digest);
  });
});
