import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ROLE_LABELS } from '../admin/roles';
import { AppShell } from './AppShell';
import { SIGNED_IN_AS_LABEL } from './SignedInAs';

const NAMES = new Map([['synthetic-manager', 'Dana Mwale']]);

/**
 * UX-01: the top bar offered Sign out and named nobody. The identity line is asserted
 * HERE as well as in `SignedInAs.test.ts`, because a component that renders correctly
 * and is never mounted is a fix nobody sees — the same reason `.ls-actions` could ship
 * with no rule at all.
 */
describe('the top bar says whose session it is', () => {
  it('names the person and their authority beside Sign out', () => {
    const html = renderToStaticMarkup(
      createElement(AppShell, {
        role: 'audit-manager',
        signedIn: { userId: 'synthetic-manager', names: NAMES },
        children: 'page',
      }),
    );
    const topbar = /<div class="ls-topbar">([\s\S]*?)<main /.exec(html)?.[1] ?? '';
    expect(topbar).toContain(SIGNED_IN_AS_LABEL);
    expect(topbar).toContain('Dana Mwale');
    expect(topbar).toContain(ROLE_LABELS['audit-manager']);
    // Beside Sign out, in the same cluster, so the control that ends a session sits
    // next to the name of the session it ends.
    expect(topbar).toContain('Sign out');
  });

  it('keeps the shell, and names nobody, when the identity could not be resolved', () => {
    const html = renderToStaticMarkup(
      createElement(AppShell, { role: null, children: 'page' }),
    );
    expect(html).toContain('Sign out');
    expect(html).not.toContain(SIGNED_IN_AS_LABEL);
  });
});
