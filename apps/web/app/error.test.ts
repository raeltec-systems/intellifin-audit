import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '/' as string | null }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));

import { ROUTE_BOUNDARY_COPY } from '../src/design/route-boundary-words';
import ErrorBoundary from './error';

/**
 * The route boundary, read back out of the page that renders it (Story 10.8).
 *
 * The boundary is where a Server Action lands when it committed and its acknowledgement
 * was lost, so what it says is a claim about an action it knows nothing about. These are
 * SSR renders of the real component: the sentences are asserted as the page prints them,
 * not as a module lists them.
 */

const RUN = '/runs/019823ab-0000-7000-8000-0000000000a1/live';
const SECRET = 'connect ECONNREFUSED db.internal:5432 password=hunter2';

function render(pathname: string | null): string {
  navigation.pathname = pathname;
  const error = Object.assign(new Error(SECRET), { digest: 'digest-1' });
  return renderToStaticMarkup(React.createElement(ErrorBoundary, { error, reset: vi.fn() }));
}

/** Markup text with entities decoded, so an apostrophe is compared as the reader sees it. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

beforeEach(() => { navigation.pathname = '/'; });

describe('the route boundary states only what it knows', () => {
  it('on a Run page, names the Run and asks the reader to look before repeating anything', () => {
    const page = text(render(RUN));
    expect(page).toContain(ROUTE_BOUNDARY_COPY.heading);
    expect(page).toContain(ROUTE_BOUNDARY_COPY.run);
    expect(page).toContain(ROUTE_BOUNDARY_COPY.body);
  });

  it('on a page with no Run, names nothing that is not there', () => {
    for (const pathname of ['/administration/users', '/procedures', '/runs', null]) {
      const page = text(render(pathname));
      expect(page, String(pathname)).toContain(ROUTE_BOUNDARY_COPY.other);
      expect(page, String(pathname)).not.toContain("the Run's");
    }
  });

  it('never claims that nothing was changed, on any page', () => {
    for (const pathname of [RUN, '/administration/users', null]) {
      expect(text(render(pathname)), String(pathname)).not.toMatch(/nothing (was|has been|has) (changed|altered)|no run, result, or evidence/i);
    }
  });

  it('announces the failure at once, as a destructive banner does', () => {
    expect(render(RUN)).toContain('role="alert"');
  });

  it('offers a reload that is a plain link to the page, so it can never resubmit', () => {
    const html = render(RUN);
    // A link is a GET: following it reads the page again. It needs no script, and it is
    // not `reset()`, which would re-render the page as it was before the action.
    expect(html).toMatch(new RegExp(`<a [^>]*href="${RUN}"[^>]*>${ROUTE_BOUNDARY_COPY.reload}</a>`));
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<form');
  });

  it('never prints the error itself', () => {
    const html = render(RUN);
    expect(html).not.toContain('ECONNREFUSED');
    expect(html).not.toContain('hunter2');
    expect(html).not.toContain('digest-1');
  });
});
