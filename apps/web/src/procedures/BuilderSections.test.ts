import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BUILDER_SECTION_NOT_EDITABLE_SENTENCE } from '../design/copy';

const SOURCE = readFileSync(
  fileURLToPath(new URL('./BuilderSections.tsx', import.meta.url)),
  'utf8',
);

/**
 * The read-only sentence is the ONLY thing on the Builder that says a section cannot be
 * edited yet. It shipped as `aria-hidden="true"`, which tells a screen-reader user the
 * opposite of what the page tells everyone else: they meet section after section of
 * content with no indication that any of it is read-only.
 *
 * Nothing else could catch it. axe reports nothing — hiding your own content from
 * assistive technology is legal, and there is no rule for "this page lies by omission".
 * The browser suite asserts the sentence is VISIBLE, which `aria-hidden` does not
 * affect. So the guard is here, over the source, in the same spirit as `Digest.test.ts`
 * and `form-method.test.ts`.
 */
describe('the Builder read-only sentence', () => {
  it('is rendered from the pinned constant, not retyped', () => {
    expect(SOURCE).toContain('BUILDER_SECTION_NOT_EDITABLE_SENTENCE');
    expect(SOURCE).not.toContain(BUILDER_SECTION_NOT_EDITABLE_SENTENCE);
  });

  it('is never inside an aria-hidden element', () => {
    // Every opening tag that hides itself from assistive technology, and what it wraps
    // up to the next closing tag. The sentence must appear in none of them.
    const hidden = /<[a-zA-Z][^>]*aria-hidden\s*=\s*\{?["']?true["']?\}?[^>]*>([\s\S]*?)<\//g;
    const offenders: string[] = [];
    for (const match of SOURCE.matchAll(hidden)) {
      if ((match[1] ?? '').includes('BUILDER_SECTION_NOT_EDITABLE_SENTENCE')) {
        offenders.push(match[0].slice(0, 120));
      }
    }
    expect(offenders).toEqual([]);
  });
});
