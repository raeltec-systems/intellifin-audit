import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Every `<form>` declares `method="post"`.
 *
 * This is the third appearance of one defect: a control whose only working path is
 * JavaScript. The sign-in form shipped without a `method`, so a submission that beat
 * hydration would have sent the password as a GET query string. The sign-out control
 * was an `onClick` that fetched, so a click before hydration did nothing at all and
 * looked like success. `UserForm` then repeated the sign-in mistake with the new user's
 * initial password.
 *
 * A form with no `method` submits as a GET. Anything typed into it lands in the URL, in
 * browser history, in the `Referer` header and in every access log in between. The rule
 * is therefore mechanical, and so is this check.
 *
 * The first version of this file was three separate mistakes, all of which made it pass
 * without checking anything, and each is now a fixed rule below:
 *
 *   1. it asserted `/\bmethod=/`, so `method="get"` — the exact defect — passed;
 *   2. it matched tags with `/<form\b[^>]*>/`, which stops at the first `>`, and in JSX
 *      that is normally the `=>` inside an `onSubmit` handler. It only passed because
 *      `method` happened to be written before `onSubmit` in the one file that had both;
 *   3. it scanned `.tsx` only, so a `.ts` module emitting raw HTML — `sign-out-route.ts`
 *      does — was never looked at.
 */

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Directories that hold build output or dependencies rather than source. */
const SKIP_DIRECTORIES = new Set(['node_modules', '.next', 'dist', 'coverage']);

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const path = `${directory}/${entry}`;
    // A broken symlink makes `statSync` throw, which would fail this suite for a reason
    // that has nothing to do with forms. Anything we cannot stat is not a source file.
    let isDirectory: boolean;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      found.push(...sourceFiles(path));
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      // `.ts` as well as `.tsx`: a route handler can emit raw HTML, and `sign-out-route`
      // does. A guard that only looks at components misses the server's own markup.
      found.push(path);
    }
  }
  return found;
}

/**
 * The full opening `<form ...>` tag, however its attributes are written.
 *
 * Brace-aware, because the naive `[^>]*` stops at the first `>` in the source, and in
 * JSX an attribute is routinely `onSubmit={(event) => ...}` — whose `=>` ends the match
 * three characters in. Braces and quotes are tracked so that a `>` inside an expression
 * or a string is not mistaken for the end of the tag.
 */
export function formTags(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const tags: string[] = [];

  for (const match of withoutComments.matchAll(/<form\b/g)) {
    let depth = 0;
    let quote: string | null = null;
    let index = match.index + match[0].length;
    for (; index < withoutComments.length; index += 1) {
      const character = withoutComments[index] as string;
      if (quote !== null) {
        if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
      } else if (character === '>' && depth === 0) {
        break;
      }
    }
    tags.push(withoutComments.slice(match.index, Math.min(index + 1, withoutComments.length)));
  }
  return tags;
}

/** `method="post"` or `method='post'`, in any case, anywhere in the tag. */
export function declaresPostMethod(tag: string): boolean {
  return /\bmethod\s*=\s*(["'])post\1/i.test(tag);
}

describe('every form declares method="post"', () => {
  const files = sourceFiles(WEB_ROOT).filter((path) => !path.includes('.test.'));

  it('finds the components that render forms at all', () => {
    const withForms = files.filter((path) => formTags(readFileSync(path, 'utf8')).length > 0);
    // A guard that matches nothing passes for the wrong reason.
    expect(withForms.length).toBeGreaterThanOrEqual(3);
  });

  it('scans .ts files that emit raw HTML, not only components', () => {
    expect(files.some((path) => path.endsWith('sign-out-route.ts'))).toBe(true);
  });

  it.each(files)('%s', (path) => {
    for (const tag of formTags(readFileSync(path, 'utf8'))) {
      expect(
        declaresPostMethod(tag),
        `${path}: a form must declare method="post" — with no method, or with "get", a submission that beats hydration puts every field in the URL. Tag: ${tag.slice(0, 160)}`,
      ).toBe(true);
    }
  });
});

/**
 * The guard, checked against the three ways it previously failed to guard.
 *
 * A checker with no tests of its own is an assertion that the code is fine, made by code
 * nobody has checked. These are the exact mutations the old version let through.
 */
describe('the guard itself', () => {
  it('rejects a form with no method at all', () => {
    const tags = formTags('<form className="x" onSubmit={handle}>');
    expect(tags).toHaveLength(1);
    expect(declaresPostMethod(tags[0] as string)).toBe(false);
  });

  it('rejects method="get" — the defect it exists to prevent', () => {
    const tags = formTags('<form method="get" action="/x">');
    expect(tags).toHaveLength(1);
    expect(declaresPostMethod(tags[0] as string)).toBe(false);
  });

  it('reads the whole tag when an arrow function precedes the method', () => {
    // The naive `<form\b[^>]*>` truncates at the `=>` and never sees `method`.
    const source = '<form onSubmit={(event) => handle(event)} method="post">';
    const tags = formTags(source);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toBe(source);
    expect(declaresPostMethod(tags[0] as string)).toBe(true);
  });

  it('reads a tag whose attributes span several lines', () => {
    const source = '<form\n  className="a"\n  method="post"\n  onSubmit={(e) => f(e)}\n>';
    const tags = formTags(source);
    expect(tags).toHaveLength(1);
    expect(declaresPostMethod(tags[0] as string)).toBe(true);
  });

  it('is not fooled by a > inside a string attribute', () => {
    const tags = formTags('<form data-note="a > b" method="post">');
    expect(declaresPostMethod(tags[0] as string)).toBe(true);
  });

  it('ignores a form written inside a comment', () => {
    expect(formTags('/* <form> */')).toEqual([]);
    expect(formTags('  // <form>')).toEqual([]);
  });

  it('accepts single quotes and odd spacing', () => {
    expect(declaresPostMethod("<form method = 'POST'>")).toBe(true);
  });
});
