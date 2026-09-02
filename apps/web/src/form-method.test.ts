import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Every `<form>` names its method.
 *
 * This is the third appearance of one defect: a control whose only working path is
 * JavaScript. The sign-in form shipped without a `method`, so a submission that beat
 * hydration would have sent the password as a GET query string. The sign-out control
 * was an `onClick` that fetched, so a click before hydration did nothing at all and
 * looked like success. `UserForm` then repeated the sign-in mistake with the new
 * user's initial password.
 *
 * A form with no `method` submits as a GET. Anything typed into it lands in the URL,
 * in browser history, in the Referer header and in every access log in between. The
 * rule is therefore mechanical, and so is this check: name the method, every time.
 */

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
    const path = `${directory}/${entry}`;
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (entry.endsWith('.tsx')) {
      found.push(path);
    }
  }
  return found;
}

/** Opening `<form` tags, with their attributes, ignoring any inside a comment block. */
function formTags(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return [...withoutComments.matchAll(/<form\b[^>]*>/g)].map((match) => match[0]);
}

describe('every form declares its method', () => {
  const files = sourceFiles(WEB_ROOT).filter((path) => !path.endsWith('.test.tsx'));

  it('finds the components that render forms at all', () => {
    const withForms = files.filter((path) => formTags(readFileSync(path, 'utf8')).length > 0);
    // A guard that matches nothing passes for the wrong reason.
    expect(withForms.length).toBeGreaterThan(0);
  });

  it.each(files)('%s', (path) => {
    for (const tag of formTags(readFileSync(path, 'utf8'))) {
      expect(tag, `${path}: a form with no method submits as a GET`).toMatch(/\bmethod=/);
    }
  });
});
