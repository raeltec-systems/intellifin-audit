import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BUILDER_CONTROL_NAME_EDITABLE_SENTENCE,
  BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE,
} from '../design/copy';

const SOURCE = readFileSync(
  fileURLToPath(new URL('./BuilderSections.tsx', import.meta.url)),
  'utf8',
);

/**
 * The read-only sentences are the ONLY thing on the Builder that says a section is not
 * edited here. The first of them shipped as `aria-hidden="true"`, which tells a
 * screen-reader user the opposite of what the page tells everyone else: they meet
 * section after section of content with no indication that any of it is read-only.
 *
 * Nothing else could catch it. axe reports nothing — hiding your own content from
 * assistive technology is legal, and there is no rule for "this page lies by omission".
 * The browser suite asserts the sentence is VISIBLE, which `aria-hidden` does not
 * affect. So the guard is here, over the source, in the same spirit as `Digest.test.ts`
 * and `form-method.test.ts`.
 */
describe('the Builder read-only sentences', () => {
  it('are rendered from the pinned constants, not retyped', () => {
    for (const [name, sentence] of [
      ['BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE', BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE],
      ['BUILDER_CONTROL_NAME_EDITABLE_SENTENCE', BUILDER_CONTROL_NAME_EDITABLE_SENTENCE],
    ] as const) {
      expect(SOURCE).toContain(name);
      expect(SOURCE).not.toContain(sentence);
    }
  });

  it('are never inside an aria-hidden element', () => {
    // Every opening tag that hides itself from assistive technology, and what it wraps
    // up to the next closing tag. Neither sentence may appear in any of them.
    const hidden = /<[a-zA-Z][^>]*aria-hidden\s*=\s*\{?["']?true["']?\}?[^>]*>([\s\S]*?)<\//g;
    const offenders: string[] = [];
    for (const match of SOURCE.matchAll(hidden)) {
      const body = match[1] ?? '';
      if (
        body.includes('BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE') ||
        body.includes('BUILDER_CONTROL_NAME_EDITABLE_SENTENCE')
      ) {
        offenders.push(match[0].slice(0, 120));
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The Control-name pointer belongs to the Control section alone. Rendered under every
   * read-only section it would tell somebody reading the Objective to go and change a
   * name they were not looking at.
   */
  it('scope the Control-name pointer to the Control section', () => {
    expect(SOURCE).toMatch(
      /section\.heading === 'Control'[\s\S]{0,200}BUILDER_CONTROL_NAME_EDITABLE_SENTENCE/,
    );
  });
});
