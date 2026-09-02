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

/**
 * `globals.css` with its comments removed, whitespace squeezed out and lower-cased. A
 * comment may quote a value; a rule may not, and `rgba(16, 42, 67, .24)` and
 * `rgba(16,42,67,.24)` are the same declaration.
 */
const scannableGlobals = readFileSync(
  fileURLToPath(new URL('../../app/globals.css', import.meta.url)),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, '')
  .toLowerCase();

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
    // A whole typography ROLE, as `components.data-table.header-type` uses it. There is
    // no single property to compare, so the font size stands for the role.
    if (head === 'typography' && rest.length === 1) {
      return `var(${NAMES.type(rest[0] as string, 'fontSize')})`;
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

  it('is the only stylesheet that states a token value, in any notation', () => {
    // `globals.css` may reference tokens and may carry the literals the contract states
    // inline (a component pattern's padding, the one dialog shadow); it may not restate
    // a documented colour, in hex or in `rgb()`/`rgba()`, in either case.
    //
    // The contract's own literals are removed first. `{components.confirmation-dialog
    // .shadow}` is `0 12px 32px rgba(16,42,67,0.24)` — navy in another notation, written
    // that way by DESIGN.md itself, so copying it verbatim is compliance, not drift.
    let scanned = scannableGlobals;
    for (const [, value] of componentLeaves) {
      if (value.startsWith('{IntelliFinDesignSystem')) continue;
      const literal = value.replace(/\s+/g, '').toLowerCase();
      if (literal.length > 3) scanned = scanned.split(literal).join('|');
    }

    const restated: string[] = [];
    for (const [key, value] of colorEntries) {
      if (!value.startsWith('#')) continue;
      const red = Number.parseInt(value.slice(1, 3), 16);
      const green = Number.parseInt(value.slice(3, 5), 16);
      const blue = Number.parseInt(value.slice(5, 7), 16);
      for (const form of [
        value.toLowerCase(),
        `rgb(${red},${green},${blue}`,
        `rgba(${red},${green},${blue}`,
      ]) {
        if (scanned.includes(form)) restated.push(`${key} as ${form}`);
      }
    }
    expect(restated).toEqual([]);
  });
});

/* ------------------------------------------------------- component patterns ---- */

/**
 * The fifth frontmatter group. Its entries are not tokens — they are compositions of
 * tokens — but `globals.css` hand-copies the ones it implements, and a hand copy is
 * exactly what drifts. Every leaf is classified below, and the classification is
 * asserted exhaustive, so a pattern added to DESIGN.md fails this file until somebody
 * decides whether it is implemented, inherited, or still to come.
 */
const componentLeaves = ((): [string, string][] => {
  const leaves: [string, string][] = [];
  for (const [name, entry] of Object.entries(group('components'))) {
    if (typeof entry === 'string') leaves.push([name, entry]);
    else {
      for (const [property, value] of Object.entries(entry as Record<string, string>)) {
        leaves.push([`${name}.${property}`, value]);
      }
    }
  }
  return leaves;
})();

/** Patterns named as the parent bundle's, with no value of their own to check. */
const INHERITED_FROM_BUNDLE = [
  'sidebar',
  'button',
  'status-badge',
  'banner',
  'environment-ribbon',
  'empty-state',
  'tabs',
  'icon',
] as const;

/** Patterns `globals.css` implements today. Each value must appear in the stylesheet. */
const IMPLEMENTED = [
  'status-badge-info-solid.background',
  'status-badge-info-solid.border',
  'status-badge-info-solid.text',
  'data-table.header-background',
  'data-table.header-type',
  'data-table.header-text',
  'data-table.header-padding',
  'data-table.cell-padding',
  'data-table.row-border',
  'data-table.first-cell-type',
  'unavailable-actions-panel.background',
  'unavailable-actions-panel.radius',
  'unavailable-actions-panel.padding',
  'confirmation-dialog.width',
  'confirmation-dialog.radius',
  'confirmation-dialog.shadow',
  'confirmation-dialog.scrim',
] as const;

/** Every documented token value, so a literal can be recognised behind its token. */
const tokenByValue = new Map<string, string>();
for (const [name, value] of tokens) {
  if (!tokenByValue.has(squash(value))) tokenByValue.set(squash(value), name);
}

function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

/** A value counts as implemented if the stylesheet writes it, or the token holding it. */
function stylesheetStates(value: string): boolean {
  const wanted = squash(expected(value));
  if (scannableGlobals.includes(wanted.toLowerCase())) return true;
  const token = tokenByValue.get(wanted);
  return token !== undefined && scannableGlobals.includes(`var(${token})`);
}


/**
 * Patterns whose surfaces do not exist yet — the conclusion triptych, the Execution
 * Timeline, the session viewer and the rest arrive with Epics 2 to 6, and `card` has no
 * caller until a surface has cards. They are listed rather than defaulted so that the
 * exhaustiveness check above stays meaningful: a new pattern in DESIGN.md lands here
 * deliberately, not by falling through.
 */
const DEFERRED_PATTERNS = [
  'card.background',
  'card.border',
  'card.radius',
  'card.shadow',
  'conclusion-triptych.columns',
  'conclusion-triptych.cell-padding',
  'conclusion-triptych.divider',
  'conclusion-triptych.statement-background',
  'conclusion-triptych.statement-type',
  'gate-checklist.row-grid',
  'gate-checklist.row-padding',
  'gate-checklist.group-label',
  'timeline-row.grid',
  'timeline-row.row-padding',
  'timeline-row.call-box-background',
  'timeline-row.call-box-font',
  'timeline-row.indent-per-level',
  'provenance-chain.marker-size',
  'provenance-chain.marker-radius',
  'provenance-chain.connector',
  'provenance-chain.step-gap',
  'evaluation-card.border',
  'evaluation-card.origin-badge',
  'evaluation-card.confidence-font',
  'grounding-inspector.label-font',
  'grounding-inspector.value-font',
  'grounding-inspector.corroboration-badge',
  'reconciliation-table.label-width',
  'reconciliation-table.value-align',
  'reconciliation-table.value-font',
  'evidence-item.grid',
  'evidence-item.gap',
  'evidence-item.kind-badge',
  'evidence-item.note-background',
  'evidence-item.note-border',
  'version-diff.changed-section-border',
  'version-diff.added-value-background',
  'version-diff.removed-value-background',
  'version-diff.value-font',
  'exception-row.padding',
  'exception-row.identifier-font',
  'exception-row.state-badge',
  'notification-row.padding',
  'notification-row.countdown-font',
  'notification-row.unread-marker',
  'untrusted-block.border',
  'untrusted-block.body-font',
  'untrusted-block.body-background',
  'safe-next-action-panel.background',
  'safe-next-action-panel.border',
  'safe-next-action-panel.text',
  'execution-failure-panel.background',
  'execution-failure-panel.border',
  'execution-failure-panel.text',
  'escalation-panel.background',
  'escalation-panel.border',
  'escalation-panel.heading-text',
  'escalation-panel.question-background',
  'escalation-panel.question-font',
  'session-viewer.chrome-background',
  'session-viewer.chrome-text',
  'session-viewer.live-dot',
  'session-viewer.replay-dot',
  'session-viewer.paused-dot',
  'session-viewer.awaiting-dot',
  'session-viewer.stage-background',
  'session-viewer.stage-min-height',
  'session-viewer.scrubber-pill-height',
  'builder-section.label-width',
  'builder-section.label-type',
  'builder-section.plan-row-font',
  'filter-chip.height',
  'filter-chip.radius',
  'filter-chip.pressed-background',
  'filter-chip.pressed-text',
] as const;

describe('the component patterns globals.css implements', () => {
  it('classifies every leaf of the components group exactly once', () => {
    const classified = new Set<string>([
      ...INHERITED_FROM_BUNDLE,
      ...IMPLEMENTED,
      ...DEFERRED_PATTERNS,
    ]);
    const leaves = componentLeaves.map(([path]) => path);
    expect(leaves.filter((path) => !classified.has(path))).toEqual([]);
    expect([...classified].filter((path) => !leaves.includes(path))).toEqual([]);
  });

  it.each(INHERITED_FROM_BUNDLE)('%s is named as the parent bundle\'s, not restated', (name) => {
    const value = componentLeaves.find(([path]) => path === name)?.[1];
    expect(value).toMatch(/^\{IntelliFinDesignSystem\./);
  });

  it.each(IMPLEMENTED)('%s is written into globals.css with the documented value', (path) => {
    const value = componentLeaves.find(([leaf]) => leaf === path)?.[1];
    expect(value, `no such component leaf: ${path}`).toBeDefined();
    expect(stylesheetStates(value as string), `${path} = ${value ?? ""}`).toBe(true);
  });
});
