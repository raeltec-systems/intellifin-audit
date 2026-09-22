import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { PERMITTED_READ_ACTIONS, PROCEDURE_TEMPLATES } from '@intellifin/domain';

import {
  CHANGE_ARROW,
  CRITERIA_LABELS,
  EVIDENCE_LABELS,
  FIRST_VERSION_SENTENCE,
  FROZEN_CONTRACT_SENTENCE,
  FROZEN_CONTRACT_SUMMARY,
  NOT_SET,
  NO_CONDITIONS_SENTENCE,
  NO_DECISIONS_SENTENCE,
  NO_EVIDENCE_SENTENCE,
  NO_SOURCE_SENTENCE,
  NO_SYSTEMS_SENTENCE,
  NOT_SUBMITTED_COMPARISON_SENTENCE,
  READ_ACTION_WORDS,
  READ_ONLY_ACCESS_SENTENCE,
  REVIEW_HEADINGS,
  SUMMARY_LABELS,
  comparedWithSentence,
  nothingChangedSentence,
  readActionWord,
  technicalSectionsChangedSentence,
  templateWords,
} from './review-words';

/**
 * The manager review's own sentences, pinned where they are declared.
 *
 * These are the PLATFORM's words rather than quotations from the UX contract — the
 * `run-start-words.ts` rule — so the thing to prove is that a component reads them from
 * here rather than retyping one, and that the two lookups keyed by a STORED value are
 * guarded.
 */

function sources(dir: string): { path: string; source: string }[] {
  const found: { path: string; source: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue; // a broken symlink must not fail the suite
    }
    if (info.isDirectory()) found.push(...sources(full));
    else if ((entry.endsWith('.tsx') || entry.endsWith('.ts')) && !entry.endsWith('.test.ts')) {
      found.push({ path: full, source: readFileSync(full, 'utf8') });
    }
  }
  return found;
}

/** Every file that could render one of these sentences: the review surface and its page. */
const SURFACE = [
  ...sources(fileURLToPath(new URL('.', import.meta.url))),
  ...sources(fileURLToPath(new URL('../../../app/procedures', import.meta.url))),
].filter((file) => !file.path.endsWith('review-words.ts'));

const PINNED: readonly (readonly [string, string])[] = [
  ['REVIEW_HEADINGS.tested', REVIEW_HEADINGS.tested],
  ['REVIEW_HEADINGS.scope', REVIEW_HEADINGS.scope],
  ['REVIEW_HEADINGS.systems', REVIEW_HEADINGS.systems],
  ['REVIEW_HEADINGS.criteria', REVIEW_HEADINGS.criteria],
  ['REVIEW_HEADINGS.evidence', REVIEW_HEADINGS.evidence],
  ['REVIEW_HEADINGS.frequency', REVIEW_HEADINGS.frequency],
  ['REVIEW_HEADINGS.access', REVIEW_HEADINGS.access],
  ['REVIEW_HEADINGS.changed', REVIEW_HEADINGS.changed],
  ['REVIEW_HEADINGS.history', REVIEW_HEADINGS.history],
  ['FIRST_VERSION_SENTENCE', FIRST_VERSION_SENTENCE],
  ['NOT_SUBMITTED_COMPARISON_SENTENCE', NOT_SUBMITTED_COMPARISON_SENTENCE],
  ['READ_ONLY_ACCESS_SENTENCE', READ_ONLY_ACCESS_SENTENCE],
  ['NO_CONDITIONS_SENTENCE', NO_CONDITIONS_SENTENCE],
  ['NO_EVIDENCE_SENTENCE', NO_EVIDENCE_SENTENCE],
  ['NO_SYSTEMS_SENTENCE', NO_SYSTEMS_SENTENCE],
  ['NO_SOURCE_SENTENCE', NO_SOURCE_SENTENCE],
  ['NO_DECISIONS_SENTENCE', NO_DECISIONS_SENTENCE],
  ['FROZEN_CONTRACT_SUMMARY', FROZEN_CONTRACT_SUMMARY],
  ['FROZEN_CONTRACT_SENTENCE', FROZEN_CONTRACT_SENTENCE],
  ['EVIDENCE_LABELS.note', EVIDENCE_LABELS.note],
  ['CRITERIA_LABELS.agentJudged', CRITERIA_LABELS.agentJudged],
  ['SUMMARY_LABELS.procedureName', SUMMARY_LABELS.procedureName],
  ['SUMMARY_LABELS.mayDo', SUMMARY_LABELS.mayDo],
  ['SUMMARY_LABELS.mayGo', SUMMARY_LABELS.mayGo],
  ['NOT_SET', NOT_SET],
  ['CHANGE_ARROW', CHANGE_ARROW],
];

describe('the review surface reads its sentences rather than retyping them', () => {
  it.each(PINNED)('%s appears in no component as a literal', (_name, sentence) => {
    for (const { path, source } of SURFACE) {
      expect(source.includes(`'${sentence}'`), `${path} retypes it`).toBe(false);
      expect(source.includes(`"${sentence}"`), `${path} retypes it`).toBe(false);
      expect(source.includes(`>${sentence}<`), `${path} retypes it`).toBe(false);
    }
  });
});

describe('a registered read action is said in words', () => {
  it('has a word for every action the domain can freeze', () => {
    // Typed `Record<PermittedReadAction, string>`, so an added action does not COMPILE
    // without a word; this proves the other direction, against the domain's own list.
    expect(Object.keys(READ_ACTION_WORDS).toSorted()).toEqual([...PERMITTED_READ_ACTIONS].toSorted());
    for (const word of Object.values(READ_ACTION_WORDS)) expect(word).not.toContain('-');
  });

  it('keeps an unrecognised stored action rather than inheriting a function', () => {
    // The action arrives from a stored frozen contract typed `string`, so a plain index
    // would answer `'constructor'` with `Object.prototype.constructor`.
    expect(readActionWord('constructor')).toBe('constructor');
    expect(readActionWord('toString')).toBe('toString');
    expect(readActionWord('read-attribute')).toBe(READ_ACTION_WORDS['read-attribute']);
  });
});

describe('a Template is named, and an unknown one does not take the page down', () => {
  it('names every Template this build ships', () => {
    for (const template of PROCEDURE_TEMPLATES) expect(templateWords(template.id)).toBe(template.name);
  });

  it('falls back to the stored id rather than throwing', () => {
    // `findProcedureTemplate` THROWS on an id it does not ship, and this id comes from a
    // stored frozen review: a version frozen under a removed Template would otherwise
    // take the whole approval surface down.
    expect(templateWords('P-99')).toBe('P-99');
    expect(templateWords('constructor')).toBe('constructor');
  });
});

describe('the comparison sentences name the version they compare against', () => {
  it('says which version, so "changed" is never an unanchored claim', () => {
    expect(comparedWithSentence(2)).toContain('version 2');
    expect(nothingChangedSentence(7)).toContain('version 7');
  });

  it('counts frozen-only changes in the singular and the plural', () => {
    expect(technicalSectionsChangedSentence(1)).toContain('One more section');
    expect(technicalSectionsChangedSentence(3)).toContain('3 more sections');
  });

  it('never claims a first version changed anything', () => {
    expect(FIRST_VERSION_SENTENCE).not.toMatch(/\bchanged\b/i);
  });
});
