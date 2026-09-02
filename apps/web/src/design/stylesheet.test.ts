import { readFileSync } from 'node:fs';
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

const globals = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8')
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

describe('every custom property the stylesheet reads is defined', () => {
  it('names no token that does not exist', () => {
    // `.ls-definition dt` read `var(--font-size-sm, 0.875rem)`, a token defined
    // nowhere, and lived on its fallback: the rule looked token-driven, was not, and
    // nothing said so. A typo in a token name fails silently in CSS, which is exactly
    // the class of defect a stylesheet test exists to catch.
    const raw = readFileSync(
      fileURLToPath(new URL('../../app/globals.css', import.meta.url)),
      'utf8',
    );
    const tokens = readFileSync(
      fileURLToPath(new URL('../../app/tokens.css', import.meta.url)),
      'utf8',
    );
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
