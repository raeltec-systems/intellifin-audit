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
import { ESCALATION_KINDS } from '@intellifin/application';

import {
  COUNT_MECHANISM_WORDS,
  FILTER_COMPARISONS,
  IDENTITY_KEYS_EXACT_SENTENCE,
  SECTION_WORDS,
  SOURCE_KIND_WORDS,
  TARGET_KIND_WORDS,
  ESCALATION_KIND_WORDS,
  ESCALATION_KIND_UNKNOWN,
  escalationKindWord,
  filterComparisonId,
  frozenFieldAbsentWord,
  frozenFieldWord,
} from './plain-words';
import { NO_AUTOMATIC_RUNS_SENTENCE } from './run-start-words';

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

  it.each(ESCALATION_KINDS)('%s says what the Escalation is asking', (kind) => {
    // Walked against the APPLICATION's own closed vocabulary, so a kind added there and
    // not given words here fails, rather than reaching a reader as its own identifier.
    expect(escalationKindWord(kind)).toBe(ESCALATION_KIND_WORDS[kind]);
    expect(escalationKindWord(kind)).not.toBe(kind);
    expect(escalationKindWord(kind)).not.toBe(ESCALATION_KIND_UNKNOWN);
  });

  /**
   * The Schedule step promised something this release does not do.
   *
   * "How often it runs" and "When should this procedure run on its own?" both state a
   * fact that is false: the scheduler is Epic 8 and does not exist, and a Run starts
   * when an auditor presses Initiate Run. The saved frequency is the INTENT, and
   * `run-start-words.ts` already owns the sentence that says so.
   */
  it('asks the Schedule section for the intent, never claiming the Procedure runs itself', () => {
    const { title, question } = SECTION_WORDS.Schedule;
    expect(title).toBe('How often this is meant to run');
    for (const words of [title, question]) {
      expect(words).not.toContain('run on its own');
      expect(words).not.toContain('runs on its own');
    }
    // The fact itself is not retyped here; it is one sentence, said in one place.
    expect(NO_AUTOMATIC_RUNS_SENTENCE.length).toBeGreaterThan(0);
  });

  it('never answers a stored kind with the kind itself, or with an inherited property', () => {
    // `run_wait.kind` reaches the surface typed `string`. A plain-object index inherits
    // from `Object.prototype`, so `constructor` returns a FUNCTION -- the trap this
    // codebase has met six times.
    expect(escalationKindWord('constructor')).toBe(ESCALATION_KIND_UNKNOWN);
    expect(escalationKindWord('toString')).toBe(ESCALATION_KIND_UNKNOWN);
    expect(escalationKindWord('a-kind-this-build-does-not-know')).toBe(ESCALATION_KIND_UNKNOWN);
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
 * An absent frozen field whose absence means something.
 *
 * The version review printed "Model: Not set" for a version whose plan was derived
 * deterministically, beside a writing assistant that had just worked — two different
 * models, and the surface said nothing that would tell them apart.
 */
describe('a frozen field that is absent for a reason says the reason', () => {
  it('explains an unconfigured plan-check model instead of calling it unfilled', () => {
    const sentence = frozenFieldAbsentWord('model');
    expect(sentence).not.toBeNull();
    expect(sentence).toContain('No plan-check model is configured');
    // The two facts the owner needed: why there is none, and that the assistant that
    // helped them write is a different thing.
    expect(sentence).toContain('saved sections alone');
    expect(sentence).toContain('assistant');
    expect(sentence).not.toContain('Not set');
  });

  it('names the field so a reader is not left with a bare "Model"', () => {
    expect(frozenFieldWord('model')).toBe('Plan-check model');
    expect(frozenFieldWord('model')).not.toBe('Model');
  });

  it('leaves every other absent field its generic word', () => {
    // Only a field whose absence has a KNOWN meaning gets a sentence; the rest keep
    // "Not set", which is right for something a person could have filled in.
    for (const key of ['scope', 'secondary_key', 'policy', 'rule']) {
      expect(frozenFieldAbsentWord(key), key).toBeNull();
    }
  });

  it('never answers a stored key with an inherited property', () => {
    // The key comes from a stored frozen review, so a plain index would return a
    // function for `constructor`. The standing rule, met an eighth time.
    for (const key of ['constructor', 'toString', 'hasOwnProperty']) {
      expect(frozenFieldAbsentWord(key), key).toBeNull();
    }
  });
});

/**
 * One statement about how identity keys are compared.
 *
 * The frozen canonical plan text says both "exact normalized employee_id" and "never
 * trim, normalize or parse them as numbers" — a contradiction to a reader, inside bytes
 * the version froze and this surface must not rewrite. So the presentation states the
 * rule and says what the plan's own word means there.
 */
describe('identity matching is stated once and unambiguously', () => {
  it('says the comparison is exact and says what the plan step means by its own word', () => {
    expect(IDENTITY_KEYS_EXACT_SENTENCE).toContain('compared exactly, character for character');
    expect(IDENTITY_KEYS_EXACT_SENTENCE).toContain('exact normalized');
    // Compiler 1's rule, in the words a person reads: nothing is changed before the
    // comparison. A sentence that allowed any of these would be the other half of the
    // contradiction, restated.
    for (const change of ['trimmed', 're-spelled', 'read as a number']) {
      expect(IDENTITY_KEYS_EXACT_SENTENCE, change).toContain(change);
    }
  });

  it('does not tell an auditor a key is changed before it is compared', () => {
    expect(IDENTITY_KEYS_EXACT_SENTENCE).not.toMatch(/\bis normalized\b/);
    expect(IDENTITY_KEYS_EXACT_SENTENCE).not.toMatch(/\bnormalises\b|\bnormalizes\b/);
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
  // UX-13 (UI cleanup 2026-09-21): the compiler's own rule grammar, met as the
  // criteria step's primary text — `found = false or account_status in [Disabled]
  // else [Active]`, `Gate failure`, an "unnamed value" left unexplained. `Condition
  // N`, beside the sentence `conditionSentence` produces, is what replaces C1/C2 in
  // that ONE new context; the ids stay everywhere they are a stable identifier
  // (`data-condition-id`, `Rule text C1`), which this list does not reach because it
  // scans for these phrases specifically, not for C1/C2 themselves.
  'found = false',
  'account_status',
  'Gate failure',
  'unnamed value',
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
