import { expect, test } from '@playwright/test';

import { SIGN_IN_PREPARING, SIGN_IN_REQUIRES_JAVASCRIPT } from '../../apps/web/src/sign-in-words';

/**
 * A credential typed before the handlers attach must never be silently discarded.
 *
 * `email` and `password` are CONTROLLED inputs whose initial state is empty, so anything
 * typed into the server-rendered page is thrown away the moment React hydrates — and the
 * submit that follows posts two empty strings. Better Auth answers 400 and the route
 * rewrites every failure to one sentence, so the person reads "Check your email address
 * and password" about a page defect. Found driving the deployed acceptance, where the
 * same sign-in failed three times in four with a password that was provably correct.
 *
 * ONE attempt reaches the server here: `/sign-in/email` allows ten a minute and that
 * limiter is real production behaviour.
 */
test('the sign-in fields are unavailable until their handlers attach', async ({ page }) => {
  let release!: () => void;
  const scripts = new Promise<void>(resolve => { release = resolve; });
  const attempts: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/sign-in/email') {
      attempts.push(request.postData() ?? '');
    }
  });
  await page.route('**/*', async route => {
    if (route.request().resourceType() === 'script') await scripts;
    await route.continue();
  });
  try {
    await page.goto('/sign-in', { waitUntil: 'commit' });
    await expect(page.getByLabel('Email address')).toBeVisible();
    // Native `disabled`, because it is the only guard that holds before any handler runs.
    await expect(page.getByLabel('Email address')).toBeDisabled();
    await expect(page.getByLabel('Password')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    await expect(page.getByText(SIGN_IN_PREPARING)).toBeVisible();
    // Ordinary markup, never `<noscript>`: a blocked bundle is the case this must reach,
    // and Chromium leaves the parser's scripting flag on, so no locator sees inside one.
    await expect(page.getByText(SIGN_IN_REQUIRES_JAVASCRIPT)).toBeVisible();
    expect(attempts).toEqual([]);

    release();
    await expect(page.locator('[data-signin-ready]')).toHaveAttribute('data-signin-ready', 'true');
    await page.getByLabel('Email address').fill('readiness-probe@example.test');
    await page.getByLabel('Password').fill('not-the-password-abcdefghijkl');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.ls-signin').getByRole('alert')).toBeVisible();

    // The decisive assertion: what the browser POSTED carried what was typed. An empty
    // body is the defect, and it produces exactly the same sentence on screen.
    expect(attempts).toHaveLength(1);
    const sent = JSON.parse(attempts[0] ?? '{}') as { email?: string; password?: string };
    expect(sent.email).toBe('readiness-probe@example.test');
    expect(sent.password).toBe('not-the-password-abcdefghijkl');
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
