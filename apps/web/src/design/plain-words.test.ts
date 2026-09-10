import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  DECLARED_COUNT_MECHANISMS,
  DECIMAL_OPERATORS,
  DRAFT_SECTION_HEADINGS,
  POPULATION_SOURCE_KINDS,
  TARGET_SYSTEM_KINDS,
} from '@intellifin/domain';

import {
  COUNT_MECHANISM_WORDS,
  FILTER_COMPARISONS,
  SECTION_WORDS,
  SOURCE_KIND_WORDS,
  TARGET_KIND_WORDS,
  filterComparisonId,
} from './plain-words';

describe('every domain vocabulary the Builder shows has words for it', () => {
  it.each(DRAFT_SECTION_HEADINGS)('%s has a title and a question', (heading) => {
    const words = SECTION_WORDS[heading];
    expect(words.title.length).toBeGreaterThan(0);
    expect(words.question.endsWith('?')).toBe(true);
  });

  it.each(POPULATION_SOURCE_KINDS)('%s says how the records arrive', (kind) => {
    expect(SOURCE_KIND_WORDS[kind].label.length).toBeGreaterThan(0);
    expect(SOURCE_KIND_WORDS[kind].detail.length).toBeGreaterThan(0);
  });

  it.each(DECLARED_COUNT_MECHANISMS)('%s says how the count is confirmed', (mechanism) => {
    expect(COUNT_MECHANISM_WORDS[mechanism].label.length).toBeGreaterThan(0);
    expect(COUNT_MECHANISM_WORDS[mechanism].detail.length).toBeGreaterThan(0);
  });

  it.each(TARGET_SYSTEM_KINDS)('%s says what kind of system it is', (kind) => {
    expect(TARGET_KIND_WORDS[kind].length).toBeGreaterThan(0);
  });
});

/**
 * The filter list has to cover every predicate the domain can hold, or an inclusion rule
 * saved before this build — or through another editor — opens on a comparison the
 * dropdown cannot show and silently reads as the first entry in the list.
 */
describe('the one filter list covers every stored predicate', () => {
  it('offers text equality, every decimal operator and the period test', () => {
    expect(FILTER_COMPARISONS.map((option) => option.id).sort()).toEqual(
      ['text:eq', 'within-period', ...DECIMAL_OPERATORS.map((operator) => `decimal:${operator}`)].sort(),
    );
  });

  it.each(DECIMAL_OPERATORS)('a decimal predicate on %s resolves to its own entry', (operator) => {
    const id = filterComparisonId({ column: 'amount', kind: 'decimal', operator, value: '1' });
    expect(FILTER_COMPARISONS.some((option) => option.id === id)).toBe(true);
  });

  it('resolves text and period predicates to their own entries', () => {
    expect(filterComparisonId({ column: 'status', kind: 'text', operator: 'eq', value: 'x' })).toBe(
      'text:eq',
    );
    expect(filterComparisonId({ column: 'termination_date', kind: 'within-period' })).toBe(
      'within-period',
    );
  });
});

/**
 * The words the owner read as gibberish, refused where a person can read them.
 *
 * "im reading this as an auditor and its giberish...i have no idea what this is, i cant
 * understand a single word of whats happening here and what im expected to do" — every
 * phrase below was on a label, a legend or a sentence on one of these two surfaces. Each
 * is the right name for what the domain freezes and the wrong thing to ask an auditor.
 *
 * The scan is over rendered TEXT, not over identifiers: `declaredCountMechanism` is a
 * field name and must keep working, while "Declared-count mechanism" on a `<label>` is
 * the defect. A phrase preceded and followed by an identifier character is part of a
 * name and is left alone.
 */
const BANNED_ON_AUTHORING_SURFACES = [
  'Declared column',
  'Comparison type',
  'Comparison value',
  'Comparison boundary',
  'Comparison threshold',
  'Numeric tolerance',
  'Declared-count mechanism',
  'Declared schema',
  'Binding kind',
  'Attribute name',
  'Grounded by',
  'Recording segment',
  'Condition text',
  'Agent-Judged confidence threshold',
  'Registration digest',
  'Credential reference',
  'Permitted read actions',
  'Expected field labels',
  'Declare model-read',
  'deterministic grounding',
];

const AUTHORING_DIRS = ['../procedures', '../admin'];

function sources(dir: string): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue; // a broken symlink must not fail the suite
    }
    if (info.isDirectory()) found.push(...sources(full));
    else if (entry.endsWith('.tsx')) {
      found.push({
        path: full,
        // Comments explain the defect and quote the old words on purpose.
        text: readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, ''),
      });
    }
  }
  return found;
}

const IDENTIFIER = /[A-Za-z0-9_$.]/;

describe('the authoring surfaces do not print the platform at the auditor', () => {
  it.each(BANNED_ON_AUTHORING_SURFACES)('no surface renders %s', (phrase) => {
    const offenders: string[] = [];
    for (const dir of AUTHORING_DIRS) {
      for (const { path, text } of sources(fileURLToPath(new URL(dir, import.meta.url)))) {
        let at = text.indexOf(phrase);
        while (at !== -1) {
          const before = text[at - 1] ?? '';
          const after = text[at + phrase.length] ?? '';
          if (!IDENTIFIER.test(before) && !IDENTIFIER.test(after)) {
            offenders.push(`${path}: ${text.slice(Math.max(0, at - 40), at + phrase.length + 20)}`);
          }
          at = text.indexOf(phrase, at + 1);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
