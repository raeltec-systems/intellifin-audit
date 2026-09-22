import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PageHeader } from './PageHeader';

describe('the page header', () => {
  it('puts the badge and the actions on the title row and the meta line under it', () => {
    const html = renderToStaticMarkup(
      React.createElement(PageHeader, {
        title: 'Run · Leaver access review',
        badge: React.createElement('span', { className: 'ls-badge' }, 'Completed'),
        actions: React.createElement('a', { href: '/x' }, 'Replay'),
        meta: 'v1 · 1–31 Aug 2026',
      }),
    );
    expect(html).toContain('<div class="ls-page-header__title"><h1>Run · Leaver access review</h1><span class="ls-badge">Completed</span></div>');
    expect(html).toContain('<div class="ls-page-header__actions ls-actions"><a href="/x">Replay</a></div>');
    expect(html).toContain('<p class="ls-page-header__meta">v1 · 1–31 Aug 2026</p>');
  });

  it('renders no empty row, meta or lede', () => {
    const html = renderToStaticMarkup(React.createElement(PageHeader, { title: 'Runs' }));
    expect(html).toBe('<header class="ls-page-header"><div class="ls-page-header__row"><div class="ls-page-header__title"><h1>Runs</h1></div></div></header>');
  });
});
