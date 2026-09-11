import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { spokenDigest } from './digest-text';

const digest = 'a1b2c3d4'.repeat(8);

describe('how a digest is announced', () => {
  it('names what the digest is of, so a row says which', () => {
    expect(spokenDigest(digest, 'Registration')).toMatch(/^Registration digest starting /);
    expect(spokenDigest(digest, 'Binding')).toMatch(/^Binding digest starting /);
  });

  it('spaces the ends, so they are heard as characters', () => {
    expect(digest).toHaveLength(64);
    expect(spokenDigest(digest, 'Binding')).toContain('a 1 b 2');
    expect(spokenDigest(digest, 'Binding')).toContain('c 3 d 4');
  });

  it('never reads all 64 characters aloud', () => {
    expect(spokenDigest(digest, 'Binding')).not.toContain(digest);
  });
});

/**
 * ARIA prohibits an accessible name on a generic element, and both digests shipped as
 * `<span aria-label={...}>` and `<dd aria-label={...}>`. A prohibited name is not
 * applied, so the accessible name stayed the 64 hex characters — exactly what the label
 * existed to prevent. axe reports that as INCOMPLETE, not as a violation, and the
 * browser gate asserts only `results.violations`, so nothing caught it.
 *
 * This is the guard the browser gate could not be. It reads the source rather than the
 * rendered page, so it needs no DOM and cannot be defeated by a rule's severity.
 */
const PROHIBITED_NAME_ELEMENTS = ['span', 'dd', 'dt', 'div', 'p', 'li', 'td'];

/**
 * The roles that prohibit an accessible name (ARIA 1.2 §5.2.8.6).
 *
 * A generic element with an EXPLICIT role can carry a name — `<div role="group"
 * aria-label>` is a labelled group and is exactly what Replay's scrubber is — so the rule
 * is about elements with no role to carry the name, not about the tag alone. These roles
 * are the ones that still prohibit it, so a `role="presentation"` cannot be used to smuggle
 * a label back onto a generic element.
 */
const NAME_PROHIBITED_ROLES = [
  'caption', 'code', 'deletion', 'emphasis', 'generic', 'insertion',
  'none', 'paragraph', 'presentation', 'strong', 'subscript', 'superscript',
];

/**
 * Every opening tag of one element, brace- and quote-aware.
 *
 * `[^>]*` is not good enough and the reason is in this repository's own source: a JSX
 * handler is `onClick={() => go(position)}`, whose arrow contains a `>`, so a lazy scan
 * ends the tag in the middle of an attribute and reads the rest of the file as markup.
 * The same trap `form-method.test.ts` records.
 */
function openingTags(source: string, element: string): string[] {
  const tags: string[] = [];
  const opener = new RegExp(`<${element}(?=[\\s/>])`, 'g');
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    let depth = 0;
    let quote: string | null = null;
    for (let index = match.index; index < source.length; index += 1) {
      const character = source[index]!;
      if (quote !== null) { if (character === quote) quote = null; continue; }
      if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
      if (character === '{') { depth += 1; continue; }
      if (character === '}') { depth -= 1; continue; }
      if (character === '>' && depth === 0) { tags.push(source.slice(match.index, index + 1)); break; }
    }
  }
  return tags;
}

function carriesName(tag: string): boolean {
  if (!/\saria-label[=\s]/.test(tag)) return false;
  const role = /\srole="([a-z]+)"/.exec(tag);
  return role === null || NAME_PROHIBITED_ROLES.includes(role[1]!);
}

function tsxFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue; // a broken symlink must not fail the suite
    }
    if (info.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      found.push(...tsxFiles(full));
    } else if (entry.endsWith('.tsx')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The guard's own tests.
 *
 * `form-method.test.ts` shipped asserting `/\bmethod=/`, so `method="get"` passed — the
 * exact defect it existed to prevent — and nothing noticed because a guard with no tests
 * is a guard nobody can be wrong about. These fixtures are what a widened scan has to keep
 * failing on.
 */
describe('the scanner itself', () => {
  const offends = (source: string, element: string): boolean =>
    openingTags(source, element).some(carriesName);

  it('catches the defect it was written for', () => {
    expect(offends('<span aria-label={spokenDigest(v, "Binding")}>{v}</span>', 'span')).toBe(true);
    expect(offends('<dd aria-label="x">1</dd>', 'dd')).toBe(true);
  });

  it('permits a generic element that was given a role to carry the name', () => {
    expect(offends('<div role="group" aria-label="Step scrubber" />', 'div')).toBe(false);
    expect(offends('<div role="timer" aria-label="x" />', 'div')).toBe(false);
  });

  it('is not fooled by a role that prohibits a name either', () => {
    expect(offends('<div role="presentation" aria-label="x" />', 'div')).toBe(true);
    expect(offends('<div role="generic" aria-label="x" />', 'div')).toBe(true);
  });

  it('does not end a tag on the arrow of a JSX handler', () => {
    // `[^>]*` ends the tag at the `>` of `=>`, so the label after it is never seen and
    // the rest of the file is read as markup.
    expect(offends('<span onClick={() => go(1)} aria-label="x">v</span>', 'span')).toBe(true);
    expect(offends('<div onClick={() => go(1)} role="group" aria-label="x" />', 'div')).toBe(false);
  });

  it('does not match a longer element name', () => {
    expect(offends('<divider aria-label="x" />', 'div')).toBe(false);
  });
});

describe('aria-label is never put on an element that cannot carry a name', () => {
  it('finds none anywhere under apps/web', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const offenders: string[] = [];
    for (const file of tsxFiles(root)) {
      // Comments are stripped first. This file's own doc comment quotes the defect it
      // exists to prevent, and a scan that matched prose would fail on the explanation.
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
      for (const element of PROHIBITED_NAME_ELEMENTS) {
        if (openingTags(source, element).some(carriesName)) {
          offenders.push(`${path.relative(root, file)}: <${element} aria-label>`);
        }
      }
    }
    expect(
      offenders,
      `ARIA prohibits a name on these elements, so the label is silently dropped:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
