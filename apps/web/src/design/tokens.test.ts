import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The token drift guard.
 *
 * `tokens.css` is the single source of design values for the application, and DESIGN.md
 * is the single source of `tokens.css`. This test reads both off disk and fails when
 * they disagree — the same shape as `schema-range.test.ts`, which reads the migrations
 * rather than trusting a constant that claims to match them.
 *
 * The failure it prevents is quiet: a colour changed in the contract and not in the
 * stylesheet still renders, still passes typecheck, and still looks plausible. Nothing
 * else in the repository would notice.
 *
 * The planning-artifact folder name contains a space, so the path is one string
 * resolved relative to this file rather than assembled from segments.
 */

const DESIGN_PATH = fileURLToPath(
  new URL(
    '../../../../_bmad-output/planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/DESIGN.md',
    import.meta.url,
  ),
);

const TOKENS_PATH = fileURLToPath(new URL('../../app/tokens.css', import.meta.url));

const design = readFileSync(DESIGN_PATH, 'utf8');
const tokensCss = readFileSync(TOKENS_PATH, 'utf8');

type Frontmatter = Record<string, unknown>;

/**
 * A parser for the shape DESIGN.md's frontmatter actually has: two-space nested
 * mappings of scalars, values optionally single- or double-quoted, `#` comments after
 * a value or on their own line. Deliberately not a general YAML implementation — the
 * repository has no YAML dependency, and a parser that accepts only what this document
 * contains fails loudly if the document ever grows a construct it does not model.
 */
function parseFrontmatter(markdown: string): Frontmatter {
  const parts = markdown.split(/^---$/m);
  const block = parts[1];
  if (block === undefined) throw new Error('DESIGN.md has no frontmatter block');

  const root: Frontmatter = {};
  const stack: { indent: number; node: Frontmatter }[] = [{ indent: -1, node: root }];

  for (const raw of block.split('\n')) {
    if (raw.trim() === '' || /^\s*#/.test(raw)) continue;
    const line = raw.trim();
    // Sequence entries (`sources:`) carry no token and are not modelled.
    if (line.startsWith('- ')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;

    const indent = raw.length - raw.trimStart().length;
    const key = unquote(line.slice(0, colon).trim());
    const value = stripComment(line.slice(colon + 1).trim());

    while (stack.length > 1 && (stack[stack.length - 1] as { indent: number }).indent >= indent) {
      stack.pop();
    }
    const parent = (stack[stack.length - 1] as { node: Frontmatter }).node;

    if (value === '') {
      const child: Frontmatter = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = unquote(value);
    }
  }
  return root;
}

function unquote(value: string): string {
  const single = /^'(.*)'$/.exec(value);
  if (single) return single[1] as string;
  const double = /^"(.*)"$/.exec(value);
  if (double) return double[1] as string;
  return value;
}

/** Drop a trailing `# comment`, but only outside quotes and only after whitespace. */
function stripComment(value: string): string {
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string;
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/.test(value[index - 1] as string))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

/** Every `--name: value;` declaration in `tokens.css`, in file order. */
function parseCustomProperties(css: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const match of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
    declarations.set(match[1] as string, (match[2] as string).trim());
  }
  return declarations;
}

const frontmatter = parseFrontmatter(design);
const tokens = parseCustomProperties(tokensCss);

const group = (name: string): Record<string, unknown> => {
  const value = frontmatter[name];
  if (typeof value !== 'object' || value === null) {
    throw new Error(`DESIGN.md frontmatter has no \`${name}\` group`);
  }
  return value as Record<string, unknown>;
};

const kebab = (value: string): string =>
  value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/**
 * The name mapping, stated once. It is mechanical on purpose: a token that needed a
 * judgement call to name would need the same judgement call to find.
 */
const NAMES = {
  color: (key: string) => `--color-${key}`,
  rounded: (key: string) => `--rounded-${key}`,
  spacing: (key: string) => `--spacing-${key}`,
  type: (role: string, property: string) => `--type-${role}-${kebab(property)}`,
} as const;

/** `{a.b.c}` in the contract becomes `var(--…)` in the stylesheet, same mapping. */
function expected(value: string): string {
  return value.replace(/\{([^}]+)\}/g, (_match, path: string) => {
    const segments = path.split('.');
    const [head, ...rest] = segments;
    if (head === 'colors' && rest.length === 1) return `var(${NAMES.color(rest[0] as string)})`;
    if (head === 'rounded' && rest.length === 1) return `var(${NAMES.rounded(rest[0] as string)})`;
    if (head === 'spacing' && rest.length === 1) return `var(${NAMES.spacing(rest[0] as string)})`;
    if (head === 'typography' && rest.length === 2) {
      return `var(${NAMES.type(rest[0] as string, rest[1] as string)})`;
    }
    throw new Error(`unresolvable reference {${path}}`);
  });
}

const colorEntries = Object.entries(group('colors')) as [string, string][];
const roundedEntries = Object.entries(group('rounded')) as [string, string][];
const spacingEntries = Object.entries(group('spacing')) as [string, string][];
const typographyEntries = Object.entries(group('typography')).flatMap(([role, properties]) =>
  Object.entries(properties as Record<string, string>).map(
    ([property, value]) => [role, property, value] as const,
  ),
);

describe('the token stylesheet against DESIGN.md', () => {
  it('reads a frontmatter with all four token groups', () => {
    expect(colorEntries.length).toBeGreaterThan(30);
    expect(roundedEntries.length).toBe(4);
    expect(spacingEntries.length).toBeGreaterThan(20);
    expect(typographyEntries.length).toBeGreaterThan(40);
  });

  it.each(colorEntries)('colors.%s is declared with the documented value', (key, value) => {
    expect(tokens.get(NAMES.color(key))).toBe(expected(value));
  });

  it.each(roundedEntries)('rounded.%s is declared with the documented value', (key, value) => {
    expect(tokens.get(NAMES.rounded(key))).toBe(expected(value));
  });

  it.each(spacingEntries)('spacing.%s is declared with the documented value', (key, value) => {
    expect(tokens.get(NAMES.spacing(key))).toBe(expected(value));
  });

  it.each(typographyEntries)(
    'typography.%s.%s is declared with the documented value',
    (role, property, value) => {
      expect(tokens.get(NAMES.type(role, property))).toBe(expected(value));
    },
  );

  it('declares nothing the contract does not document', () => {
    const documented = new Set<string>([
      ...colorEntries.map(([key]) => NAMES.color(key)),
      ...roundedEntries.map(([key]) => NAMES.rounded(key)),
      ...spacingEntries.map(([key]) => NAMES.spacing(key)),
      ...typographyEntries.map(([role, property]) => NAMES.type(role, property)),
    ]);
    expect([...tokens.keys()].filter((name) => !documented.has(name))).toEqual([]);
  });

  it('keeps the two values the rest of the story is written against', () => {
    // Named explicitly so a change to either one fails with a sentence rather than a
    // diff: teal-700 is the only interactive colour, and it is also the focus ring.
    expect(tokens.get('--color-teal')).toBe('#0F766E');
    expect(tokens.get('--color-focus')).toBe('#0F766E');
  });

  it('is the only stylesheet that states a token value', () => {
    // `globals.css` may reference tokens and may carry the handful of literals the
    // contract states inline; it may not restate a documented token's value.
    const globals = readFileSync(
      fileURLToPath(new URL('../../app/globals.css', import.meta.url)),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, ''); // a comment may quote a value; a rule may not
    const restated = [...colorEntries]
      .map(([, value]) => value)
      .filter((value) => value.startsWith('#'))
      .filter((value) => globals.includes(value));
    expect(restated).toEqual([]);
  });
});
