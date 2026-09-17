import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SignInForm } from './sign-in-form';
import { SIGN_IN_PREPARING, SIGN_IN_REQUIRES_JAVASCRIPT } from './sign-in-words';

/**
 * What the server sends before any handler exists.
 *
 * The fields are CONTROLLED and start empty, so a credential typed into the
 * server-rendered page is discarded when React attaches — and the submit that follows
 * posts two empty strings, which the server answers "Check your email address and
 * password". Native `disabled` is the only guard that holds before hydration.
 */
describe('the sign-in form before hydration', () => {
  it('makes the fields unavailable and says why, in ordinary markup', () => {
    const html = renderToStaticMarkup(React.createElement(SignInForm));
    expect(html).toContain('data-signin-ready="false"');
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toContain(SIGN_IN_PREPARING);
    expect(html).toContain(SIGN_IN_REQUIRES_JAVASCRIPT);
    // Both sentences are readable while the fields cannot be used, so they precede them.
    expect(html.indexOf(SIGN_IN_REQUIRES_JAVASCRIPT)).toBeLessThan(html.indexOf('<fieldset'));
    // `<noscript>` reaches only a browser whose scripting flag is off at parse time, and
    // a browser test cannot see inside one at all.
    expect(html).not.toContain('<noscript>');
    // The password field is still there, still required, and still carries no value.
    expect(html).toMatch(/<input[^>]*id="password"[^>]*>/);
    expect(html).not.toMatch(/id="password"[^>]*value="[^"]/);
  });
});
