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
        // The opening tag only, up to the first `>` that is not inside a brace or quote.
        const pattern = new RegExp(`<${element}\\b[^>]*?\\saria-label[=\\s]`, 'g');
        if (pattern.test(source)) {
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
