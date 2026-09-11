import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { STATUS_TREATMENTS } from './status';

/**
 * Every variant a component can name must have a rule that paints it.
 *
 * `status.test.ts` proves the vocabulary matches the contract, and `tokens.test.ts`
 * proves the token values do. Neither notices that a class exists: delete
 * `.ls-badge--danger-outline` from `globals.css` and Run Failed, Incomplete, Open and
 * Failed render as unstyled text with the whole suite green, because the treatment
 * name is still spelled correctly everywhere it is spelled.
 *
 * This closes that gap for the three components whose appearance is chosen by a string:
 * StatusBadge treatments, Banner tones, and Button variants and sizes.
 */

const globals = (readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8') + readFileSync(fileURLToPath(new URL('../procedures/guided-preparation.css', import.meta.url)), 'utf8') + readFileSync(fileURLToPath(new URL('../procedures/writing-assistant.css', import.meta.url)), 'utf8'))
  // A class named only in a comment is not a rule.
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The selectors `globals.css` actually defines, as a set. */
const selectors = new Set(
  [...globals.matchAll(/(^|[\s,{}])(\.[A-Za-z0-9_-]+)/g)].map((match) => match[2] as string),
);

function declares(selector: string): boolean {
  return selectors.has(selector);
}

/** Kept in step with the component by hand; the test below proves the list is complete. */
const BANNER_TONES = ['info', 'success', 'warning', 'danger'] as const;
const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'destructive'] as const;
const CONTROL_SIZES = ['sm', 'md'] as const;

describe('the stylesheet paints every variant a component can name', () => {
  it.each(STATUS_TREATMENTS)('.ls-badge--%s has a rule', (treatment) => {
    expect(declares(`.ls-badge--${treatment}`)).toBe(true);
  });

  it.each(CONTROL_SIZES)('.ls-badge--%s has a rule', (size) => {
    expect(declares(`.ls-badge--${size}`)).toBe(true);
  });

  it.each(BANNER_TONES)('.ls-banner--%s has a rule', (tone) => {
    expect(declares(`.ls-banner--${tone}`)).toBe(true);
  });

  it.each(BUTTON_VARIANTS)('.ls-button--%s has a rule', (variant) => {
    expect(declares(`.ls-button--${variant}`)).toBe(true);
  });

  it.each(CONTROL_SIZES)('.ls-button--%s has a rule', (size) => {
    expect(declares(`.ls-button--${size}`)).toBe(true);
  });

  it('lists exactly the Banner tones the component accepts', () => {
    const source = readFileSync(fileURLToPath(new URL('./Banner.tsx', import.meta.url)), 'utf8');
    const declared = /export type BannerTone =([^;]+);/.exec(source)?.[1] ?? '';
    const parsed = [...declared.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
    expect(parsed).toEqual([...BANNER_TONES]);
  });

  it('lists exactly the Button variants the component accepts', () => {
    const source = readFileSync(fileURLToPath(new URL('./Button.tsx', import.meta.url)), 'utf8');
    const declared = /export type ButtonVariant =([^;]+);/.exec(source)?.[1] ?? '';
    const parsed = [...declared.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
    expect(parsed).toEqual([...BUTTON_VARIANTS]);
  });

  it('paints the shell classes the layout depends on', () => {
    for (const selector of [
      '.ls-app',
      '.ls-shell',
      '.ls-sidebar',
      '.ls-nav-item',
      '.ls-topbar',
      '.ls-main',
      '.ls-ribbon',
      '.ls-skip-link',
      '.ls-scrim',
      '.ls-dialog',
      '.ls-table',
      '.ls-empty',
      '.ls-tab',
      '.ls-unavailable',
      '.ls-visually-hidden',
    ]) {
      expect(declares(selector), selector).toBe(true);
    }
  });
});

/**
 * Every `ls-` class a component names in a string literal must have a rule.
 *
 * The list above is kept by hand and only covers the classes somebody remembered to add
 * to it; this reads the components instead. `.ls-actions` shipped in Story 2.7 with no
 * rule at all — every Procedure Version action bar rendered as a bare stack — and nothing
 * noticed, because a class that exists only in the TSX is invisible to every other test.
 *
 * Only fully static tokens are checked. A class assembled from a template
 * (`ls-badge--${treatment}`) does not survive the pattern, which is why the treatments,
 * tones, variants and sizes have their own explicit assertions above, and why the two
 * `--pass`/`--fail` and `--contradictory`/`--neutral` modifiers are listed here.
 */
const DYNAMIC_CLASSES = [
  '.ls-gate__row--pass',
  '.ls-gate__row--fail',
  '.ls-corroboration-badge--contradictory',
  '.ls-corroboration-badge--neutral',
  // `ls-step__mark--${state}`, one per `SectionState`. A Builder step whose mark had no
  // rule would render the word with none of the treatment that separates "To do" from
  // "Set" at a glance.
  '.ls-step__mark--done',
  '.ls-step__mark--todo',
  '.ls-step__mark--attention',
  '.ls-step__mark--reference',
];

function tsxSources(dir: string): { path: string; source: string }[] {
  const found: { path: string; source: string }[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue; // a broken symlink must not fail the suite
    }
    if (info.isDirectory()) found.push(...tsxSources(full));
    else if (entry.endsWith('.tsx')) {
      found.push({
        path: full,
        source: readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, ''),
      });
    }
  }
  return found;
}

describe('every class a component names has a rule that paints it', () => {
  it.each(DYNAMIC_CLASSES)('%s has a rule', (selector) => {
    expect(declares(selector)).toBe(true);
  });

  it('finds no static ls- class under apps/web that globals.css does not define', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const offenders: string[] = [];
    for (const { path, source } of tsxSources(root)) {
      for (const match of source.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)) {
        const value = match[1] ?? match[2] ?? match[3] ?? '';
        for (const token of value.split(/\s+/)) {
          if (/^ls-[a-z0-9_-]+$/.test(token) && !declares(`.${token}`)) {
            offenders.push(`${path.slice(root.length)}: .${token}`);
          }
        }
      }
    }
    expect(
      [...new Set(offenders)],
      'these classes render as unstyled text because nothing paints them',
    ).toEqual([]);
  });
});

describe('the hidden attribute wins over every component class', () => {
  it('is enforced once, at the root, with the specificity to beat a display rule', () => {
    // The browser's own `[hidden] { display: none }` is a user-agent rule, so any class
    // that sets `display` beats it. `.ls-dialog__field` does exactly that, so a field
    // marked `hidden` stayed visible and focusable. A control the page believes is
    // hidden and a person can still tab into is worse than one never hidden at all.
    const raw = readFileSync(
      fileURLToPath(new URL('../../app/globals.css', import.meta.url)),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(raw).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  });
});

describe('every custom property the stylesheet reads is defined', () => {
  it('names no token that does not exist', () => {
    // `.ls-definition dt` read `var(--font-size-sm, 0.875rem)`, a token defined
    // nowhere, and lived on its fallback: the rule looked token-driven, was not, and
    // nothing said so. A typo in a token name fails silently in CSS, which is exactly
    // the class of defect a stylesheet test exists to catch.
    // Comments stripped on BOTH sides: a token named only in a comment is neither read
    // nor defined, and this file's own prose quotes the defect it exists to catch.
    const raw = readFileSync(
      fileURLToPath(new URL('../../app/globals.css', import.meta.url)),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    const tokens = readFileSync(
      fileURLToPath(new URL('../../app/tokens.css', import.meta.url)),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    const defined = new Set([
      ...[...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
      // A rule may define a property for its own subtree; that counts as defined.
      ...[...raw.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
    ]);
    const used = [...raw.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((match) => match[1] as string);
    const missing = [...new Set(used)].filter((name) => !defined.has(name));
    expect(missing, `globals.css reads tokens nothing defines: ${missing.join(', ')}`).toEqual([]);
  });
});
