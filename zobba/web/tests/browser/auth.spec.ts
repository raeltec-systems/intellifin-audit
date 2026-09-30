import { expect, test, request as playwrightRequest } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { connect } from 'node:net';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { restoreAndClose } from './cleanup';

// Certificate exceptions apply only to this explicitly local browser fixture.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const restoreAuthority = `
UPDATE public.identities SET active=true WHERE id IN ('actor-a','actor-manager','actor-b','actor-admin','actor-unassigned');
UPDATE public.organisation_memberships SET active=true, expires_at=NULL, roles=ARRAY['auditor'] WHERE actor_id='actor-a';
UPDATE public.engagement_assignments SET active=true, expires_at=NULL WHERE actor_id='actor-a';
`;

test.beforeAll(async () => { runtime = await startAuthRuntime(); });
test.beforeEach(() => runtime.sql(restoreAuthority));
test.afterEach(async ({ page }) => {
  // Playwright's failure DOM snapshot includes password input values. Clear the
  // local fixture field before artifact collection, even when login fails.
  await page.getByLabel('Password', { exact: true }).fill('', { timeout: 250 }).catch(() => {});
});
test.afterAll(async () => {
  if (runtime) await restoreAndClose(runtime, restoreAuthority);
});

async function signIn(page: Page, account = 'auditor-a') {
  await page.goto(runtime.url);
  await expect(page).toHaveTitle('Zobba · Pair');
  await expect(page.getByRole('heading', { name: 'Your work starts here' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic account sign-in' })).toBeVisible();
  expect(new URL(page.url()).origin).toBe(runtime.issuer);
  await page.getByLabel('Account', { exact: true }).selectOption(account);
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your engagements', exact: true })).toBeVisible();
  expect(new URL(page.url()).origin).toBe(runtime.url);
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(name);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // These real HTTP refusals are asserted explicitly below.
    if (['error', 'warning'].includes(message.type()) && !/Failed to load resource: the server responded with a status of (401|403|405|503)/.test(message.text())) {
      errors.push(message.text());
    }
  });
  return errors;
}

test('HTTPS OIDC login opens only assigned scope, supports keyboard and narrow layouts', async ({ page }, info) => {
  const errors = consoleErrors(page);
  await signIn(page);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Northstar.*Alder Manufacturing.*FY2026 audit/ })).toBeVisible();
  await expect(page.getByText('Beacon Services', { exact: false })).toHaveCount(0);
  const session = (await page.context().cookies(runtime.url)).find((cookie) => cookie.name === '__Host-zobba-session');
  expect(session && { secure: session.secure, httpOnly: session.httpOnly, sameSite: session.sameSite, path: session.path, domain: session.domain })
    .toEqual({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/', domain: 'localhost' });
  expect((await page.context().cookies(runtime.issuer)).some((cookie) => cookie.name === '__Host-zobba-session')).toBe(false);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator('img').evaluateAll((images) => images.every((image) =>
    image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
  expect(await page.evaluate(() => document.fonts.check('15px "Hanken Grotesk"'))).toBe(true);
  await capture(page, info, 'engagement-chooser-desktop.png');
  const open = page.getByRole('button', { name: /FY2026 audit/ });
  await open.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'FY2026 audit', exact: true })).toBeFocused();
  await expect(page.locator('.scope-panel > summary')).toBeVisible();
  await page.locator('.scope-panel').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  await expect(page.locator('.scope-panel dd')).toHaveText(['Northstar', 'Alder Manufacturing', 'FY2026 audit', 'Auditor']);
  await capture(page, info, 'engagement-scope-desktop.png');
  const refresh = page.getByRole('button', { name: 'Refresh access' });
  await refresh.focus();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.scope-panel > summary')).toBeVisible();
  await expect(refresh).toBeFocused();
  const denied = await page.context().request.get(`${runtime.url}/api/engagements/engagement-b?organisation_id=org-b&client_id=client-b`);
  expect(denied.status()).toBe(403);
  expect(await denied.text()).not.toContain('Beacon');
  const mismatch = await page.context().request.get(`${runtime.url}/api/engagements/engagement-a?organisation_id=org-a&client_id=client-b`);
  expect(mismatch.status()).toBe(403);
  await page.goto(`${runtime.url}/?organisation_id=org-b&client_id=client-b&engagement_id=engagement-b`);
  await expect(page.getByText('This engagement is no longer available to you.', { exact: false })).toBeVisible();
  await expect(page.getByText('Beacon Services', { exact: false })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.locator('.scope-panel > summary')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(page, info, 'engagement-scope-mobile.png');
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'All engagements' }).click();
  await expect(page.getByRole('heading', { name: 'Your engagements' })).toBeFocused();
  expect(errors).toEqual([]);
});

test('CSRF and Origin refusals preserve session; invalid callback cannot log out; POST logout revokes replay', async ({ page }) => {
  await signIn(page);
  const response = await page.context().request.get(`${runtime.url}/api/auth/session`);
  expect(response.headers()['cache-control']).toContain('no-store');
  const session = await response.json();
  const before = (await page.context().cookies(runtime.url)).find((cookie) => cookie.name === '__Host-zobba-session');
  expect(before).toBeDefined();
  expect((await page.context().request.get(`${runtime.url}/api/auth/logout`)).status()).toBe(405);
  expect((await page.context().request.post(`${runtime.url}/api/auth/logout`, { headers: { Origin: runtime.url } })).status()).toBe(403);
  expect((await page.context().request.post(`${runtime.url}/api/auth/logout`, { headers: { Origin: 'https://attacker.invalid', 'X-CSRF-Token': session.csrf_token } })).status()).toBe(403);
  expect((await page.context().request.post(`${runtime.url}/api/auth/logout`, { headers: { Origin: runtime.url, 'X-CSRF-Token': 'wrong' } })).status()).toBe(403);
  await page.goto(`${runtime.url}/api/auth/callback?state=wrong&code=wrong`);
  await expect(page.getByRole('heading', { name: 'Your engagements' })).toBeVisible();
  expect((await page.context().request.get(`${runtime.url}/api/auth/session`)).status()).toBe(200);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your work starts here' })).toBeVisible();
  await expect(page.getByText('You have signed out of Zobba.')).toBeVisible();
  expect((await page.context().request.get(`${runtime.url}/api/auth/session`)).status()).toBe(401);
  const replay = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
  try {
    const result = await replay.get(`${runtime.url}/api/auth/session`, { headers: { Cookie: `__Host-zobba-session=${before!.value}` } });
    expect(result.status()).toBe(401);
  } finally { await replay.dispose(); }
  await page.goBack();
  await expect(page.getByRole('button', { name: /FY2026 audit/ })).toHaveCount(0);
});

for (const account of ['admin-only', 'unassigned']) {
  test(`${account} signs in without access to client work`, async ({ page }, info) => {
    await signIn(page, account);
    await expect(page.getByRole('heading', { name: 'No assigned engagements' })).toBeVisible();
    await expect(page.locator('.engagement-card')).toHaveCount(0);
    expect((await page.context().request.get(`${runtime.url}/api/engagements/engagement-a?organisation_id=org-a&client_id=client-a`)).status()).toBe(403);
    if (account === 'admin-only') await capture(page, info, 'admin-empty-state.png');
  });
}

test('manager with combined roles sees current audit authority', async ({ page }) => {
  await signIn(page, 'manager-a');
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.locator('.scope-panel dd').last()).toHaveText(/Audit manager/);
  await expect(page.locator('.scope-panel dd').last()).toHaveText(/Admin/);
});

test('role demotion, membership expiry and session expiry clear previously opened scope', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.locator('.scope-panel > summary')).toBeVisible();
  runtime.sql("UPDATE public.organisation_memberships SET roles=ARRAY['admin'] WHERE actor_id='actor-a';");
  await page.getByRole('button', { name: 'Refresh access' }).click();
  await expect(page.getByRole('heading', { name: 'No assigned engagements' })).toBeVisible();
  await expect(page.locator('.scope-panel > summary')).toHaveCount(0);
  runtime.sql(restoreAuthority);
  await page.getByRole('button', { name: 'Refresh access' }).click();
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.locator('.scope-panel > summary')).toBeVisible();
  runtime.sql("UPDATE public.organisation_memberships SET expires_at=1 WHERE actor_id='actor-a';");
  await page.getByRole('button', { name: 'All engagements' }).focus();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'No assigned engagements' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your engagements', exact: true })).toBeFocused();
  runtime.sql(restoreAuthority);
  await page.getByRole('button', { name: 'Refresh access' }).click();
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.locator('.scope-panel > summary')).toBeVisible();
  runtime.sql("UPDATE public.sessions SET expires_at=1 WHERE actor_id='actor-a';");
  // Conversation polling can already withdraw the expired session and remove
  // Refresh access. A focus refresh exercises the same current-authority read
  // without requiring an obsolete protected control to survive the revocation.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Your work starts here' })).toBeFocused();
  await expect(page.getByText('Alder Manufacturing', { exact: false })).toHaveCount(0);
  expect((await page.context().cookies(runtime.url)).some((cookie) => cookie.name === '__Host-zobba-session')).toBe(false);
});

test('pending logout survives focus, periodic refresh, visibility changes and navigation', async ({ page }) => {
  await page.clock.install();
  await signIn(page);
  await page.clock.fastForward(29_000);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let accessReads = 0;
  page.on('request', (request) => { if (/\/api\/(auth\/session|engagements)/.test(request.url())) accessReads += 1; });
  await page.route('**/api/auth/logout', async (route) => { entered(); await held; await route.continue(); });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  try {
    await started;
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.clock.fastForward(1500);
    await page.getByRole('link', { name: 'Engagements', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Signing you out…' })).toBeVisible();
    await expect(page.getByText('Alder Manufacturing', { exact: false })).toHaveCount(0);
    expect(accessReads).toBe(0);
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Your work starts here' })).toBeFocused();
  expect((await page.context().request.get(`${runtime.url}/api/auth/session`)).status()).toBe(401);
});

test('logout outage retains intent and retry uses fresh CSRF without reopening work', async ({ page }) => {
  await signIn(page);
  runtime.disconnectDatabase();
  try {
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connection interrupted' })).toBeFocused();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button', { name: 'Try signing out again' })).toBeVisible();
    await expect(page.getByText('Alder Manufacturing', { exact: false })).toHaveCount(0);
  } finally { runtime.restoreDatabase(); }
  runtime.sql("UPDATE public.sessions SET csrf_token='refreshed-after-outage' WHERE actor_id='actor-a';");
  const reads: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/')) reads.push(new URL(request.url()).pathname); });
  await page.getByRole('button', { name: 'Try signing out again' }).click();
  await expect(page.getByRole('heading', { name: 'Your work starts here' })).toBeFocused();
  expect(reads).toEqual(['/api/auth/session', '/api/auth/logout']);
  expect((await page.context().request.get(`${runtime.url}/api/auth/session`)).status()).toBe(401);
});

test('a lost successful logout response retries safely and does not reopen work', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/auth/logout', async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(204);
    await route.abort('failed');
  }, { times: 1 });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Try signing out again' })).toBeVisible();
  await page.getByRole('button', { name: 'Try signing out again' }).click();
  await expect(page.getByRole('heading', { name: 'Your work starts here' })).toBeFocused();
  await expect(page.getByText('You have signed out of Zobba.')).toBeVisible();
});

test('signing out an expired session completes without a failure state', async ({ page }) => {
  await signIn(page);
  runtime.sql("UPDATE public.sessions SET expires_at=1 WHERE actor_id='actor-a';");
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your work starts here' })).toBeFocused();
  await expect(page.getByText('You have signed out of Zobba.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connection interrupted' })).toHaveCount(0);
});

test('stale CSRF is a real logout refusal and retry refreshes it before signing out', async ({ page }) => {
  await signIn(page);
  runtime.sql("UPDATE public.sessions SET csrf_token='changed-before-logout' WHERE actor_id='actor-a';");
  const refused = page.waitForResponse((response) => response.url().endsWith('/api/auth/logout'));
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  expect((await refused).status()).toBe(403);
  await expect(page.getByRole('heading', { name: 'Connection interrupted' })).toBeFocused();
  expect((await page.context().request.get(`${runtime.url}/api/auth/session`)).status()).toBe(200);
  await expect(page.getByText('Alder Manufacturing', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try signing out again' }).click();
  await expect(page.getByRole('heading', { name: 'Your work starts here' })).toBeFocused();
  expect((await page.context().request.get(`${runtime.url}/api/auth/session`)).status()).toBe(401);
});

test('database loss clears protected content and retry restores verified access', async ({ page }, info) => {
  await signIn(page);
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.locator('.scope-panel > summary')).toBeVisible();
  runtime.disconnectDatabase();
  try {
    await page.getByRole('button', { name: 'Refresh access' }).click();
    await expect(page.getByRole('heading', { name: 'Connection interrupted' })).toBeVisible();
    await expect(page.getByText('Alder Manufacturing', { exact: false })).toHaveCount(0);
    await capture(page, info, 'access-unavailable.png');
  } finally { runtime.restoreDatabase(); }
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.scope-panel > summary')).toBeVisible();
});

async function captureCallback(page: Page, replacing = false): Promise<string> {
  const captured = runtime.captureCallback();
  if (replacing) {
    // Require another real password interaction while retaining the valid app
    // cookie that the callback must revoke. Host separation makes this precise.
    await page.context().clearCookies({ domain: '127.0.0.1' });
    await page.goto(`${runtime.url}/api/auth/login`);
  }
  else {
    await page.goto(runtime.url);
    await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Synthetic account sign-in' })).toBeVisible();
  await page.getByLabel('Account', { exact: true }).selectOption('auditor-a');
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Callback held for boundary verification.')).toBeVisible();
  const callback = await captured;
  expect(new URL(callback).pathname).toBe('/api/auth/callback');
  return callback;
}

for (const attack of ['state', 'missing-browser-binding', 'wrong-browser-binding']) {
  test(`actual authorization callback rejects ${attack}`, async ({ page }) => {
    const callback = new URL(await captureCallback(page));
    const login = (await page.context().cookies(runtime.url)).find((cookie) => cookie.name === '__Host-zobba-login');
    expect(login && { secure: login.secure, httpOnly: login.httpOnly, sameSite: login.sameSite, path: login.path, domain: login.domain })
      .toEqual({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/', domain: 'localhost' });
    if (attack === 'state') callback.searchParams.set('state', 'unrelated-state');
    if (attack === 'missing-browser-binding') await page.context().clearCookies({ name: '__Host-zobba-login' });
    if (attack === 'wrong-browser-binding') await page.context().addCookies([{ ...login!, value: 'unrelated-binding' }]);
    const refused = await page.context().request.get(callback.toString(), { maxRedirects: 0 });
    expect(refused.status()).toBe(303);
    expect(new URL(refused.headers().location!).searchParams.get('auth_error')).toBe('sign_in_failed');
    expect((await page.context().request.get(`${runtime.url}/api/auth/session`)).status()).toBe(401);
    expect((await page.context().cookies(runtime.url)).some((cookie) => cookie.name === '__Host-zobba-session')).toBe(false);
  });
}

test('successful callback replaces fixation value and replay cannot mint another session', async ({ page }) => {
  const callback = await captureCallback(page);
  await page.context().addCookies([{ name: '__Host-zobba-session', value: 'attacker-controlled-value',
    url: runtime.url, secure: true, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(callback);
  await expect(page.getByRole('heading', { name: 'Your engagements' })).toBeVisible();
  const fresh = (await page.context().cookies(runtime.url)).find((cookie) => cookie.name === '__Host-zobba-session');
  expect(fresh).toBeDefined();
  expect(fresh!.value === 'attacker-controlled-value').toBe(false);
  const replayed = await page.context().request.get(callback, { maxRedirects: 0 });
  expect(replayed.status()).toBe(303);
  expect(new URL(replayed.headers().location!).searchParams.get('auth_error')).toBe('sign_in_failed');
  expect((await page.context().request.get(`${runtime.url}/api/auth/session`)).status()).toBe(200);
  expect((await page.context().cookies(runtime.url)).find((cookie) => cookie.name === '__Host-zobba-session')?.value === fresh!.value).toBe(true);
  await page.context().clearCookies({ name: '__Host-zobba-session' });
  await page.context().request.get(callback, { maxRedirects: 0 });
  expect((await page.context().request.get(`${runtime.url}/api/auth/session`)).status()).toBe(401);
});

test('a second successful OIDC callback revokes the previous valid session', async ({ page }) => {
  await signIn(page);
  const previous = (await page.context().cookies(runtime.url)).find((cookie) => cookie.name === '__Host-zobba-session')!;
  expect((await page.context().request.get(`${runtime.url}/api/auth/session`)).status()).toBe(200);
  const callback = await captureCallback(page, true);
  await page.goto(callback);
  await expect(page.getByRole('heading', { name: 'Your engagements' })).toBeVisible();
  const replacement = (await page.context().cookies(runtime.url)).find((cookie) => cookie.name === '__Host-zobba-session')!;
  expect(replacement.value === previous.value).toBe(false);
  const replay = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
  try {
    expect((await replay.get(`${runtime.url}/api/auth/session`, { headers: { Cookie: `__Host-zobba-session=${previous.value}` } })).status()).toBe(401);
    expect((await page.context().request.get(`${runtime.url}/api/auth/session`)).status()).toBe(200);
  } finally { await replay.dispose(); }
});

test('an unrelated callback preserves the valid in-flight browser binding and sign-in', async ({ page }) => {
  const callback = await captureCallback(page);
  const before = (await page.context().cookies(runtime.url)).find((cookie) => cookie.name === '__Host-zobba-login')!;
  const unrelated = await page.context().request.get(`${runtime.url}/api/auth/callback?state=unrelated-state&code=unrelated-code`, { maxRedirects: 0 });
  expect(unrelated.status()).toBe(303);
  const after = (await page.context().cookies(runtime.url)).find((cookie) => cookie.name === '__Host-zobba-login');
  expect(after?.value === before.value).toBe(true);
  await page.goto(callback);
  await expect(page.getByRole('heading', { name: 'Your engagements' })).toBeVisible();
  expect((await page.context().request.get(`${runtime.url}/api/auth/session`)).status()).toBe(200);
});

test('a different organisation receives its own assignment only', async ({ page }) => {
  await signIn(page, 'auditor-b');
  await expect(page.getByRole('button', { name: /Meridian.*Beacon Services.*FY2026 review/ })).toBeVisible();
  await expect(page.getByText('Alder Manufacturing', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: /FY2026 review/ }).click();
  await page.locator('.scope-panel').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  await expect(page.locator('.scope-panel dd')).toHaveText(['Meridian', 'Beacon Services', 'FY2026 review', 'Auditor']);
});

test('more than 100 assignments paginate by full scope with fresh back navigation and direct opening', async ({ page }, info) => {
  const cleanup = `
DELETE FROM public.engagement_assignments WHERE organisation_id IN ('org-pagination-a','org-pagination-b');
DELETE FROM public.organisation_memberships WHERE organisation_id IN ('org-pagination-a','org-pagination-b');
DELETE FROM public.engagements WHERE organisation_id IN ('org-pagination-a','org-pagination-b');
DELETE FROM public.clients WHERE organisation_id IN ('org-pagination-a','org-pagination-b');
DELETE FROM public.organisations WHERE id IN ('org-pagination-a','org-pagination-b');`;
  runtime.sql(cleanup);
  runtime.sql(`
INSERT INTO public.organisations VALUES ('org-pagination-a','Pagination A'),('org-pagination-b','Pagination B');
INSERT INTO public.clients VALUES ('org-pagination-a','client-shared','Shared local client A'),('org-pagination-b','client-shared','Shared local client B');
INSERT INTO public.engagements (organisation_id,client_id,id,name)
SELECT organisation_id,'client-shared','engagement-' || lpad(n::text,3,'0'),'Assignment ' || lpad(n::text,3,'0')
FROM (VALUES ('org-pagination-a'),('org-pagination-b')) AS organisations(organisation_id),generate_series(1,60) AS n;
INSERT INTO public.organisation_memberships (organisation_id,actor_id,roles)
VALUES ('org-pagination-a','actor-a',ARRAY['auditor']),('org-pagination-b','actor-a',ARRAY['auditor']);
INSERT INTO public.engagement_assignments (organisation_id,client_id,engagement_id,actor_id)
SELECT organisation_id,client_id,id,'actor-a' FROM public.engagements WHERE organisation_id IN ('org-pagination-a','org-pagination-b');`);
  try {
    await signIn(page);
    const scopes: string[] = [];
    for (const [index, count] of [[1, 50], [2, 50], [3, 21]] as const) {
      await expect(page.locator('.pagination')).toContainText(`Page ${index}`);
      await expect(page.locator('.engagement-card')).toHaveCount(count);
      scopes.push(...await page.locator('.engagement-card').evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.focus!)));
      if (index < 3) await page.getByRole('button', { name: 'Next page', exact: true }).click();
    }
    expect(scopes.length).toBe(121);
    expect(new Set(scopes).size).toBe(121);
    expect(scopes.filter((scope) => scope.endsWith('/client-shared/engagement-060')).length).toBe(2);
    await expect(page.getByRole('button', { name: 'Next page', exact: true })).toHaveCount(0);
    const last = page.getByRole('button', { name: /Pagination B.*Assignment 060/ });
    await last.click();
    await page.locator('.scope-panel').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  await expect(page.locator('.scope-panel dd')).toHaveText(['Pagination B', 'Shared local client B', 'Assignment 060', 'Auditor']);
    await page.getByRole('button', { name: 'All engagements' }).click();
    await expect(page.locator('.pagination')).toContainText('Page 3');
    runtime.sql("UPDATE public.engagements SET name='Updated assignment 001' WHERE organisation_id='org-pagination-a' AND id='engagement-001';");
    await page.getByRole('button', { name: 'Previous page' }).click();
    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(page.locator('.pagination')).toContainText('Page 1');
    await expect(page.getByRole('button', { name: /Pagination A.*Updated assignment 001/ })).toBeVisible();
    await page.goto(`${runtime.url}/?organisation_id=org-pagination-b&client_id=client-shared&engagement_id=engagement-060`);
    await expect(page.getByRole('heading', { name: 'Assignment 060', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, info, 'paginated-direct-scope-mobile.png');
    runtime.sql("UPDATE public.engagement_assignments SET active=false WHERE organisation_id='org-pagination-b' AND engagement_id='engagement-060' AND actor_id='actor-a';");
    await page.getByRole('button', { name: 'All engagements' }).focus();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('heading', { name: 'Your engagements', exact: true })).toBeFocused();
    await expect(page.getByText('This engagement is no longer available to you.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.locator('.engagement-card')).toHaveCount(20);
    await expect(page.getByRole('button', { name: /Assignment 060/ })).toHaveCount(0);
  } finally { runtime.sql(cleanup); }
});

test('cold provider discovery failure bounds concurrent sign-in requests and recovers', async ({ page }) => {
  await runtime.scenario('slow_discovery');
  await runtime.restartApi();
  try {
    const started = Date.now();
    const responses = await Promise.all(Array.from({ length: 16 }, () => page.context().request.get(
      `${runtime.url}/api/auth/login`, { maxRedirects: 0, timeout: 20_000 },
    )));
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(responses.every((response) => response.status() === 503)).toBe(true);
    for (const response of responses) expect(await response.text()).not.toMatch(/https:|client_secret|stack|nonce|verifier/);
    expect((await page.context().cookies(runtime.url)).some((cookie) => cookie.name === '__Host-zobba-session')).toBe(false);
    const unavailable = await page.goto(`${runtime.url}/api/auth/login`);
    expect(unavailable?.status()).toBe(503);
    await expect(page.getByRole('heading', { name: 'Sign-in is temporarily unavailable' })).toBeVisible();
    await page.getByRole('link', { name: 'Return to Zobba' }).click();
    await expect(page.getByRole('heading', { name: 'Your work starts here' })).toBeVisible();
    await runtime.scenario('normal');
    await expect.poll(async () => (await page.context().request.get(`${runtime.url}/api/auth/login`, { maxRedirects: 0 })).status(), { timeout: 10_000 }).toBe(303);
    await signIn(page);
    await expect(page.getByRole('button', { name: /FY2026 audit/ })).toBeVisible();
  } finally {
    await runtime.scenario('normal');
    await runtime.restartApi();
  }
});

test('failed restoration SQL still closes the owned fixture servers', async ({ page }) => {
  await expect(restoreAndClose(runtime, 'SELECT 1 / 0;')).rejects.toThrow('Synthetic browser database mutation failed.');
  await expect(page.context().request.get(runtime.url, { timeout: 1500 })).rejects.toThrow();
  await expect(page.context().request.get(`${runtime.issuer}/.well-known/openid-configuration`, { timeout: 1500 })).rejects.toThrow();
  for (const listener of runtime.listeners) {
    const closed = await new Promise<boolean>((resolveClosed) => {
      const socket = connect(listener);
      socket.setTimeout(1500);
      socket.once('connect', () => { socket.destroy(); resolveClosed(false); });
      socket.once('timeout', () => { socket.destroy(); resolveClosed(false); });
      socket.once('error', (error: NodeJS.ErrnoException) => { socket.destroy(); resolveClosed(error.code === 'ECONNREFUSED'); });
    });
    expect(closed).toBe(true);
  }
});
