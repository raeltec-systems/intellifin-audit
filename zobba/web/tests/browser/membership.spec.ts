import { expect, test } from '@playwright/test';
import type { APIResponse, Browser, BrowserContext, Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration, restoreAndClose } from './cleanup';
import type { Member, MembershipSnapshot, SaveMember } from '../../src/membership';
import type { Session } from '../../src/auth';

test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const restore = fixtureRestoration(['actor-a', 'actor-manager', 'actor-admin', 'actor-unassigned', 'actor-b'], `
DELETE FROM public.engagement_assignments WHERE organisation_id='org-a' AND engagement_id LIKE 'ui20_6_%';
DELETE FROM public.engagements WHERE organisation_id='org-a' AND id LIKE 'ui20_6_%';
UPDATE public.identities SET active=true WHERE id IN ('actor-a','actor-manager','actor-admin','actor-unassigned','actor-b');
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE organisation_id='org-a' AND actor_id='actor-a';
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['audit_manager','admin'] WHERE organisation_id='org-a' AND actor_id='actor-manager';
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['admin'] WHERE organisation_id='org-a' AND actor_id='actor-admin';
UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id IN ('actor-a','actor-manager','actor-b');
DELETE FROM public.engagement_assignments WHERE actor_id='actor-unassigned';
DELETE FROM public.organisation_memberships WHERE actor_id='actor-unassigned';
`);
test.beforeAll(async () => { runtime = await startAuthRuntime(); });
test.beforeEach(async () => runtime.sqlAsync(restore()));
test.afterEach(async ({ page }) => {
  await page.getByLabel('Password', { exact: true }).fill('', { timeout: 250 }).catch(() => {});
  // Failure screenshots of the administrator page must not retain a private link.
  await page.locator('.private-invitation').evaluateAll(elements => elements.forEach(element => element.remove())).catch(() => {});
});
test.afterAll(async () => { if (runtime) await restoreAndClose(runtime, restore()); });

async function signIn(page: Page, account = 'admin-only', replacing = false) {
  if (replacing) await page.context().clearCookies({ domain: '127.0.0.1' });
  await page.goto(`${runtime.url}/api/auth/login`);
  await page.getByLabel('Account', { exact: true }).selectOption(account);
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your engagements', exact: true })).toBeVisible();
}
async function currentSession(page: Page): Promise<Session> {
  const response = await page.request.get(`${runtime.url}/api/auth/session`); expect(response.status()).toBe(200); return response.json();
}
async function snapshot(page: Page): Promise<MembershipSnapshot> {
  const session = await currentSession(page);
  const response = await page.request.get(`${runtime.url}/api/membership/organisations/org-a`, { headers: { 'X-Expected-Session': session.csrf_token } });
  expect(response.status()).toBe(200); return response.json();
}
async function adminWorkspace(page: Page) {
  await page.getByRole('link', { name: 'Membership administration', exact: true }).click();
  const open = page.getByRole('button', { name: /Northstar.*Manage membership/ });
  await expect(open).toBeVisible(); await open.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Northstar', exact: true })).toBeVisible();
}
async function editMember(page: Page, actor = 'actor-a') {
  const member = (await snapshot(page)).members.find(item => item.actor_id === actor)!;
  await page.getByRole('button', { name: `Edit ${member.display_name}`, exact: true }).click();
  return page.getByRole('form', { name: `Edit ${member.display_name}`, exact: true });
}
async function saveMemberApi(page: Page, member: Member) {
  const session = await currentSession(page), current = await snapshot(page);
  const response = await page.request.post(`${runtime.url}/api/membership/organisations/org-a/members`, {
    headers: { Origin: runtime.url, 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id },
    data: { key: crypto.randomUUID(), expected_version: current.version, actor_id: member.actor_id, roles: member.roles,
      active: member.active, expires_at: member.expires_at, assignments: member.assignments },
  });
  expect(response.status()).toBe(200); return response.json();
}
async function issue(page: Page) {
  await page.getByRole('button', { name: 'Invite a member', exact: true }).click();
  await page.getByLabel('Recipient email', { exact: true }).fill('unassigned@example.test');
  await page.getByLabel('Alder Manufacturing / FY2026 audit', { exact: true }).check();
  await page.getByRole('button', { name: 'Create private invitation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Private invitation ready' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Private invitation link', exact: true })).toBeFocused();
  return { link: await page.getByRole('textbox', { name: 'Private invitation link', exact: true }).inputValue(), id: (await page.getByRole('region', { name: 'Private invitation link', exact: true }).getAttribute('data-invitation-id'))! };
}
async function failedAccessRefresh(page: Page) {
  await page.route('**/api/auth/session', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily_unavailable"}' }));
  await page.getByRole('button', { name: 'Refresh access' }).click();
  await expect(page.getByRole('heading', { name: 'Connection interrupted' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry exact request' })).toHaveCount(0);
  await page.unroute('**/api/auth/session');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry exact request' })).toBeVisible();
}
function seedEngagements(count: number, assignAll = false) {
  runtime.sql(`INSERT INTO public.engagements(organisation_id,client_id,id,name)
    SELECT 'org-a','client-a','ui20_6_'||lpad(n::text,3,'0'),'Pagination engagement '||lpad(n::text,3,'0') FROM generate_series(0,${count - 1}) AS n;
    ${assignAll ? `INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) SELECT 'org-a','client-a','ui20_6_'||lpad(n::text,3,'0'),'actor-a' FROM generate_series(0,${count - 1}) AS n;` : ''}`);
}
async function recipient(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage(); await signIn(page, 'unassigned'); return { context, page };
}

test('Admin-only has separate keyboard-accessible membership, two current-version Saves and no audit authority', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    // Expected access refusals are asserted separately; any other browser error
    // is retained with the two secret-free membership-editor captures.
    if (message.type() === 'error' && !/Failed to load resource: the server responded with a status of (401|403|404|409|412|429|503)/.test(message.text())) errors.push(message.text());
  });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'No assigned engagements' })).toBeVisible();
  await adminWorkspace(page);
  await expect(page.getByRole('heading', { name: 'Membership administration' })).toBeFocused();
  await expect(page.getByText('Admin alone grants no audit content', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Task objective', { exact: true })).toHaveCount(0);
  const first = await editMember(page);
  await first.getByLabel('Audit manager', { exact: true }).check();
  await first.getByLabel('Alder Manufacturing / FY2026 audit', { exact: true }).uncheck();
  await first.getByRole('button', { name: 'Save membership' }).click();
  await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
  await expect(page.locator('[data-membership-focus="member-actor-a"]')).toBeFocused();
  expect((await snapshot(page)).members.find(item => item.actor_id === 'actor-a')?.assignments).toEqual([]);
  const second = await editMember(page);
  await second.getByLabel('Audit manager', { exact: true }).uncheck();
  await second.getByLabel('Alder Manufacturing / FY2026 audit', { exact: true }).check();
  await second.getByRole('button', { name: 'Save membership' }).click();
  await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
  const saved = (await snapshot(page)).members.find(item => item.actor_id === 'actor-a')!;
  expect(saved.roles).toEqual(['auditor']); expect(saved.assignments).toEqual([{ client_id: 'client-a', engagement_id: 'engagement-a' }]);
  await editMember(page);
  const desktop = info.outputPath('membership-desktop.png'); await page.screenshot({ path: desktop, fullPage: true });
  await info.attach('membership-desktop', { path: desktop, contentType: 'image/png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('link', { name: 'Assigned engagements', exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const path = info.outputPath('membership-mobile.png'); await page.screenshot({ path, fullPage: true }); await info.attach('membership-mobile', { path, contentType: 'image/png' });
  const session = await currentSession(page);
  const denied = await page.request.get(`${runtime.url}/api/engagements/engagement-a?organisation_id=org-a&client_id=client-a`, { headers: { 'X-Expected-Session': session.csrf_token } });
  expect(denied.status()).toBe(403);
  await page.goto(`${runtime.url}/membership?organisation_id=org-b`);
  await expect(page.getByText('This organisation is no longer available', { exact: false })).toBeVisible();
  await expect(page.getByText('Beacon Services', { exact: false })).toHaveCount(0);
  const evidencePath = info.outputPath('membership-ui-evidence.json');
  await writeFile(evidencePath, JSON.stringify({ unexpected_console_errors: errors, mobile_width: 390,
    no_horizontal_overflow: true, saved_member_focus_asserted: true, private_invitation_displayed_in_captures: false }, null, 2));
  await info.attach('membership-ui-evidence', { path: evidencePath, contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('lost invitation and acceptance acknowledgements retry exactly; acceptance receipt cannot regrant later revoked access', async ({ page, browser }) => {
  await signIn(page); await adminWorkspace(page);
  const issueBodies: string[] = [];
  await page.route('**/api/membership/organisations/org-a/invitations', async route => {
    issueBodies.push(route.request().postData()!); const response = await route.fetch(); expect(response.status()).toBe(200);
    if (issueBodies.length === 1) await route.abort('connectionreset'); else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Invite a member', exact: true }).click();
  await page.getByLabel('Recipient email').fill('unassigned@example.test');
  await page.getByLabel('Alder Manufacturing / FY2026 audit', { exact: true }).check();
  await page.getByRole('button', { name: 'Create private invitation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry exact request' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create private invitation', exact: true })).toBeDisabled();
  await failedAccessRefresh(page);
  await page.getByRole('button', { name: 'Retry exact request' }).click();
  await expect(page.getByRole('heading', { name: 'Private invitation ready' })).toBeVisible();
  expect(issueBodies).toHaveLength(2); expect(issueBodies[0] === issueBodies[1]).toBe(true);
  const link = await page.getByRole('textbox', { name: 'Private invitation link', exact: true }).inputValue();
  expect(new URL(link).hash).toMatch(/^#invitation=[A-Za-z0-9_-]{43}$/);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  const invited = await recipient(browser);
  try {
    const acceptBodies: string[] = [], acceptReceipts: unknown[] = [], leakedUrls: string[] = [];
    const secret = new URL(link).hash.slice('#invitation='.length);
    invited.page.on('request', request => { if (request.url().includes(secret)) leakedUrls.push(request.url()); });
    await invited.page.route('**/api/membership/invitations/accept', async route => {
      acceptBodies.push(route.request().postData()!); const response = await route.fetch(); expect(response.status()).toBe(200); acceptReceipts.push(await response.json());
      if (acceptBodies.length === 1) await route.abort('connectionreset'); else await route.fulfill({ response });
    });
    await invited.page.goto(link);
    await expect(invited.page.getByRole('button', { name: 'Accept invitation', exact: true })).toBeVisible();
    const terms = invited.page.getByRole('region', { name: 'Verified invitation access' });
    await expect(terms).toContainText('Northstar'); await expect(terms).toContainText('Auditor');
    await expect(terms).toContainText('Alder Manufacturing / FY2026 audit'); await expect(terms).toContainText('Expires');
    expect(new URL(invited.page.url()).hash).toBe(''); expect(acceptBodies).toEqual([]);
    expect(await invited.page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    await invited.page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(invited.page.getByRole('button', { name: 'Retry exact request' })).toBeVisible();
    await failedAccessRefresh(invited.page);
    await page.getByRole('button', { name: 'Refresh access' }).click();
    await expect(page.getByRole('button', { name: 'Edit unassigned', exact: true })).toBeVisible();
    const editor = await editMember(page, 'actor-unassigned');
    await editor.getByLabel('Active membership', { exact: true }).uncheck();
    await editor.getByRole('button', { name: 'Save membership' }).click();
    await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
    await invited.page.getByRole('button', { name: 'Retry exact request' }).click();
    await expect(invited.page.getByText('Change recorded.', { exact: false })).toBeVisible();
    expect(acceptBodies).toHaveLength(2); expect(acceptBodies[0] === acceptBodies[1]).toBe(true); expect(acceptReceipts[0]).toEqual(acceptReceipts[1]);
    expect(leakedUrls).toEqual([]);
    expect((await snapshot(page)).members.find(item => item.actor_id === 'actor-unassigned')?.active).toBe(false);
    await invited.page.getByRole('link', { name: 'View your current engagements' }).click();
    await expect(invited.page.getByRole('heading', { name: 'No assigned engagements' })).toBeVisible();
  } finally { await invited.context.close(); }
});

test('private invitation can be revoked, and the signed recipient receives an honest refusal', async ({ page, browser }) => {
  await signIn(page); await adminWorkspace(page); const { link, id } = await issue(page);
  // Prior runs retain attribution; target the exact newly issued receipt ID.
  const pending = page.locator(`li[data-invitation-id="${id}"]`).getByRole('button', { name: 'Revoke invitation for unassigned@example.test', exact: true });
  await pending.click(); await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
  const invited = await recipient(browser);
  try {
    await invited.page.goto(link);
    await expect(invited.page.getByRole('alert')).toContainText('not available to your current verified account');
    await expect(invited.page.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0);
    expect((await snapshot(page)).members.some(item => item.actor_id === 'actor-unassigned')).toBe(false);
  } finally { await invited.context.close(); }
});

test('acceptance needs a fresh verified callback and rejects a different signed recipient', async ({ page, browser }) => {
  await signIn(page); await adminWorkspace(page); const { link } = await issue(page);
  const otherContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const other = await otherContext.newPage();
  const invited = await recipient(browser);
  try {
    await signIn(other, 'auditor-b'); await other.goto(link);
    await expect(other.getByRole('alert')).toContainText('not available to your current verified account');
    await expect(other.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0);
    await expect(other.getByText('Northstar', { exact: false })).toHaveCount(0);
    runtime.sql("UPDATE public.sessions SET verified_at=extract(epoch FROM clock_timestamp())::bigint-301 WHERE actor_id='actor-unassigned';");
    await invited.page.goto(link);
    await expect(invited.page.getByRole('alert')).toContainText('not available to your current verified account');
    await expect(invited.page.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0);
    await signIn(invited.page, 'unassigned', true); await invited.page.goto(link);
    await invited.page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(invited.page.getByText('Change recorded.', { exact: false })).toBeVisible();
    await invited.page.getByRole('link', { name: 'View your current engagements' }).click();
    await expect(invited.page.getByRole('button', { name: /FY2026 audit/ })).toBeVisible();
  } finally { await invited.context.close(); await otherContext.close(); }
});

test('stale Save and the last Admin are refused without automatic overwrite', async ({ page }) => {
  await signIn(page); await adminWorkspace(page); const editor = await editMember(page);
  await editor.getByLabel('Audit manager', { exact: true }).check();
  const auditor = (await snapshot(page)).members.find(item => item.actor_id === 'actor-a')!;
  await saveMemberApi(page, { ...auditor, assignments: [] });
  await editor.getByRole('button', { name: 'Save membership' }).click();
  await expect(page.getByRole('alert')).toContainText('conflicts with current membership');
  await expect(page.getByRole('alert')).not.toContainText('non-expiring Admin');
  expect((await snapshot(page)).members.find(item => item.actor_id === 'actor-a')?.roles).toEqual(['auditor']);
  await page.getByRole('button', { name: 'Reload current state' }).click();
  const manager = (await snapshot(page)).members.find(item => item.actor_id === 'actor-manager')!;
  await saveMemberApi(page, { ...manager, roles: ['audit_manager'] });
  await page.getByRole('button', { name: 'Refresh access' }).click();
  const self = await editMember(page, 'actor-admin'); await self.getByLabel('Active membership', { exact: true }).uncheck();
  await self.getByRole('button', { name: 'Save membership' }).click();
  await expect(page.getByRole('alert')).toContainText('Establish another active, non-expiring Admin with an active account first');
  expect((await snapshot(page)).members.find(item => item.actor_id === 'actor-admin')?.active).toBe(true);
});

test('ordinary Save refuses the last non-expiring Admin and permits temporary Admins after establishing a replacement', async ({ page }, info) => {
  await signIn(page); await adminWorkspace(page);
  const membershipPath = '/api/membership/organisations/org-a/members';
  // Retain the real API responses for receipt assertions: Chromium may discard
  // page response bodies, including the optional body cancelled after a 409 code
  // header. Forward each original response unchanged; admission remains real.
  const captured: APIResponse[] = [];
  await page.route(`**${membershipPath}`, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const response = await route.fetch();
    captured.push(response);
    await route.fulfill({ response });
  });
  const saved = async (actor: string) => {
    const editor = await editMember(page, actor);
    return { editor, submit: async () => {
      const index = captured.length;
      const response = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === membershipPath);
      await editor.getByRole('button', { name: 'Save membership', exact: true }).click();
      const observed = await response;
      expect(captured).toHaveLength(index + 1);
      const upstream = captured[index]!;
      expect(observed.status()).toBe(upstream.status());
      expect(observed.headers()['x-zobba-error-code']).toBe(upstream.headers()['x-zobba-error-code']);
      return upstream;
    } };
  };
  const expiry = '2099-01-01T00:00';
  const expiresAt = Date.parse(`${expiry}Z`) / 1000;

  // An additional temporary Admin keeps current access, but cannot replace the
  // organisation's required active, non-expiring Admin.
  const manager = await saved('actor-manager');
  await manager.editor.getByLabel('Use a membership expiry', { exact: true }).check();
  await manager.editor.getByLabel('Membership expiry (UTC)', { exact: true }).fill(expiry);
  const temporaryResponse = await manager.submit(); expect(temporaryResponse.status()).toBe(200);
  const temporaryReceipt = await temporaryResponse.json();
  expect(temporaryReceipt).toMatchObject({ actor_id: 'actor-admin', subject_actor_id: 'actor-manager', kind: 'save_member' });
  await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
  const before = await snapshot(page);
  expect(before.members.find(item => item.actor_id === 'actor-manager')).toMatchObject({ active: true, roles: ['admin', 'audit_manager'], expires_at: expiresAt });

  const lastAdmin = await saved('actor-admin');
  await lastAdmin.editor.getByLabel('Use a membership expiry', { exact: true }).check();
  await lastAdmin.editor.getByLabel('Membership expiry (UTC)', { exact: true }).fill(expiry);
  const refused = await lastAdmin.submit(); expect(refused.status()).toBe(409);
  expect(refused.headers()['x-zobba-error-code']).toBe('last_admin');
  expect(await refused.json()).toEqual({ error: 'last_admin' });
  await expect(page.getByRole('alert')).toContainText('Establish another active, non-expiring Admin with an active account first');
  await expect(lastAdmin.editor.getByRole('button', { name: 'Save membership', exact: true })).toBeEnabled();
  expect(await snapshot(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Retry exact request', exact: true })).toHaveCount(0);
  const refusalCapture = info.outputPath('last-admin-refusal.png');
  await page.screenshot({ path: refusalCapture, fullPage: true });
  await info.attach('last-admin-refusal', { path: refusalCapture, contentType: 'image/png' });

  await page.getByRole('button', { name: 'Reload current state', exact: true }).click();
  const replacement = await saved('actor-manager');
  await replacement.editor.getByLabel('Use a membership expiry', { exact: true }).uncheck();
  const replacementResponse = await replacement.submit(); expect(replacementResponse.status()).toBe(200);
  const replacementReceipt = await replacementResponse.json();
  expect(replacementReceipt).toMatchObject({ actor_id: 'actor-admin', subject_actor_id: 'actor-manager', kind: 'save_member' });
  expect(BigInt(replacementReceipt.version)).toBe(BigInt(before.version) + 1n);
  await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();

  const self = await saved('actor-admin');
  await self.editor.getByLabel('Use a membership expiry', { exact: true }).check();
  await self.editor.getByLabel('Membership expiry (UTC)', { exact: true }).fill(expiry);
  const selfResponse = await self.submit(); expect(selfResponse.status()).toBe(200);
  const selfReceipt = await selfResponse.json();
  expect(selfReceipt).toMatchObject({ actor_id: 'actor-admin', subject_actor_id: 'actor-admin', kind: 'save_member' });
  expect(BigInt(selfReceipt.version)).toBe(BigInt(replacementReceipt.version) + 1n);
  expect(new Set([temporaryReceipt.event_id, replacementReceipt.event_id, selfReceipt.event_id]).size).toBe(3);
  await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
  const after = await snapshot(page);
  expect(after.members.find(item => item.actor_id === 'actor-admin')).toMatchObject({ active: true, roles: ['admin'], expires_at: expiresAt });
  expect(after.members.find(item => item.actor_id === 'actor-manager')).toMatchObject({ active: true, roles: ['admin', 'audit_manager'], expires_at: null });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const savedCapture = info.outputPath('temporary-admin-saved.png');
  await page.screenshot({ path: savedCapture, fullPage: true });
  await info.attach('temporary-admin-saved', { path: savedCapture, contentType: 'image/png' });
});

test('a combined role can narrow its own audit role while retaining only membership administration', async ({ page }) => {
  await signIn(page, 'manager-a'); await expect(page.getByRole('button', { name: /FY2026 audit/ })).toBeVisible();
  await adminWorkspace(page); const self = await editMember(page, 'actor-manager');
  await self.getByLabel('Audit manager', { exact: true }).uncheck();
  await self.getByRole('button', { name: 'Save membership' }).click();
  await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Assigned engagements', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'No assigned engagements' })).toBeVisible();
  await adminWorkspace(page); await expect(page.getByRole('heading', { name: 'Northstar', exact: true })).toBeVisible();
});

test('replacing the account withdraws membership metadata and discards unsent invitation drafts', async ({ page, context }) => {
  await signIn(page); await adminWorkspace(page);
  await page.getByRole('button', { name: 'Invite a member', exact: true }).click();
  const privateDraft = 'private-admin-draft@example.test'; await page.getByLabel('Recipient email').fill(privateDraft);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  let captured = false, posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/membership/')) posts++; });
  await page.route('**/api/auth/session', async route => {
    const response = await route.fetch();
    if (!captured) { captured = true; await held; }
    await route.fulfill({ response });
  });
  const replacement = await context.newPage();
  try {
    await page.getByRole('button', { name: 'Refresh access' }).click(); await expect.poll(() => captured).toBe(true);
    await expect(page.locator('.membership-protected')).toBeHidden();
    await page.evaluate(draft => {
      const leaks: string[] = [];
      const inspect = () => { for (const input of document.querySelectorAll('input')) if (input.value === draft && input.getClientRects().length) leaks.push('old draft'); };
      const observer = new MutationObserver(inspect); observer.observe(document.body, { attributes: true, childList: true, subtree: true });
      Object.assign(window, { membershipBindingEvidence: { observer, leaks } });
    }, privateDraft);
    await signIn(replacement, 'auditor-b', true); release();
    await expect(page.locator('.identity')).toContainText('auditor-b');
    await expect(page.getByRole('heading', { name: 'No organisations to administer' })).toBeVisible();
    await expect(page.getByLabel('Recipient email')).toHaveCount(0); await expect(page.getByText('Northstar', { exact: true })).toHaveCount(0);
    const leaks = await page.evaluate(() => { const evidence = (window as unknown as { membershipBindingEvidence: { observer: MutationObserver; leaks: string[] } }).membershipBindingEvidence; evidence.observer.disconnect(); return evidence.leaks; });
    expect(leaks).toEqual([]); expect(posts).toBe(0);
  } finally { release(); await replacement.close(); }
});

test('same-account session replacement clears drafts, private links and uncertain recovery without rebinding', async ({ page, context }) => {
  await signIn(page); await adminWorkspace(page);
  const replacement = await context.newPage();
  let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/invitations')) posts++; });
  try {
    for (const stage of ['draft', 'link', 'uncertain']) {
      if (stage === 'draft') {
        await page.getByRole('button', { name: 'Invite a member', exact: true }).click();
        await page.getByLabel('Recipient email').fill('old-session-private-draft@example.test');
      } else if (stage === 'link') await issue(page);
      else {
        await page.route('**/api/membership/organisations/org-a/invitations', async route => {
          const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('connectionreset');
        });
        await page.getByRole('button', { name: 'Invite a member', exact: true }).click();
        await page.getByLabel('Recipient email').fill('unassigned@example.test');
        await page.getByRole('button', { name: 'Create private invitation', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Retry exact request' })).toBeVisible();
      }
      const before = await currentSession(page), submitted = posts;
      await signIn(replacement, 'admin-only', true);
      const rotated = await currentSession(replacement); expect(rotated.identity.id).toBe(before.identity.id); expect(rotated.csrf_token).not.toBe(before.csrf_token);
      await page.getByRole('button', { name: 'Refresh access' }).click();
      await expect(page.getByRole('heading', { name: 'Northstar', exact: true })).toBeVisible();
      await expect(page.getByLabel('Recipient email')).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: 'Private invitation link', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Retry exact request' })).toHaveCount(0);
      expect(posts).toBe(submitted);
    }
  } finally { await page.unroute('**/api/membership/organisations/org-a/invitations'); await replacement.close(); }
});

test('same-document invitation navigation scrubs each secret and ignores a late previous preview', async ({ page, browser }) => {
  await signIn(page); await adminWorkspace(page); const first = await issue(page);
  const session = await currentSession(page), current = await snapshot(page), secondSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const response = await page.request.post(`${runtime.url}/api/membership/organisations/org-a/invitations`, {
    headers: { Origin: runtime.url, 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id },
    data: { key: crypto.randomUUID(), expected_version: current.version, recipient_email: 'unassigned@example.test', roles: ['admin'], assignments: [], expires_in_seconds: 86400, secret: secondSecret },
  }); expect(response.status()).toBe(200);
  const invited = await recipient(browser);
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; }); let firstHeld = false;
  const accepted: string[] = [];
  try {
    await invited.page.route('**/api/membership/invitations/preview', async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200);
      if (!firstHeld) { firstHeld = true; await hold; }
      await route.fulfill({ response }).catch(() => {});
    });
    invited.page.on('request', request => { if (request.url().endsWith('/invitations/accept')) accepted.push(JSON.parse(request.postData()!).secret); });
    await invited.page.goto(first.link); await expect.poll(() => firstHeld).toBe(true);
    await invited.page.evaluate(secret => { location.hash = `invitation=${secret}`; }, secondSecret);
    await expect(invited.page.getByRole('button', { name: 'Accept invitation', exact: true })).toBeVisible();
    expect(new URL(invited.page.url()).hash).toBe('');
    const terms = invited.page.getByRole('region', { name: 'Verified invitation access' });
    await expect(terms.locator('dd').nth(1)).toHaveText('Admin'); await expect(terms).toContainText('No engagement assignments.');
    release(); await expect(terms.locator('dd').nth(1)).toHaveText('Admin');
    await invited.page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(invited.page.getByRole('link', { name: 'View your current engagements' })).toBeFocused();
    expect(accepted).toHaveLength(1); expect(accepted[0] === secondSecret).toBe(true);
    expect((await snapshot(page)).members.find(member => member.actor_id === 'actor-unassigned')?.roles).toEqual(['admin']);
    await invited.page.evaluate(() => { location.hash = 'invitation=malformed'; });
    await expect(invited.page.getByRole('status').filter({ hasText: 'Open the original private invitation link' })).toBeVisible();
    expect(new URL(invited.page.url()).hash).toBe(''); await expect(invited.page.getByRole('region', { name: 'Verified invitation access' })).toHaveCount(0);
  } finally { release(); await invited.context.close(); }
});

test('preview capacity, outage and timeout remain retryable connection states without suggesting reauthentication', async ({ page, browser }) => {
  await signIn(page); await adminWorkspace(page); const { link } = await issue(page); const invited = await recipient(browser);
  try {
    for (const status of [429, 503]) {
      await invited.page.route('**/api/membership/invitations/preview', route => route.fulfill({ status, contentType: 'application/json', body: '{"error":"membership_unavailable"}' }));
      await invited.page.goto(link); await expect(invited.page.getByRole('alert')).toContainText('connection is unavailable');
      await expect(invited.page.getByRole('link', { name: 'Sign in again' })).toHaveCount(0);
      await expect(invited.page.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0);
      await invited.page.unroute('**/api/membership/invitations/preview');
      await invited.page.getByRole('button', { name: 'Retry invitation check' }).click();
      await expect(invited.page.getByRole('button', { name: 'Accept invitation', exact: true })).toBeVisible();
    }
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    await invited.page.route('**/api/membership/invitations/preview', async route => { await held; await route.abort('timedout').catch(() => {}); });
    try {
      await invited.page.goto(link); await expect(invited.page.getByRole('alert')).toContainText('connection is unavailable', { timeout: 12_000 });
      await expect(invited.page.getByRole('link', { name: 'Sign in again' })).toHaveCount(0);
    } finally { release(); await invited.page.unroute('**/api/membership/invitations/preview'); }
    await invited.page.getByRole('button', { name: 'Retry invitation check' }).click();
    await expect(invited.page.getByRole('button', { name: 'Accept invitation', exact: true })).toBeVisible();
  } finally { await invited.context.close(); }
});

test('new invitation fragments preserve pending, uncertain and completed sign-out guidance', async ({ page, browser }) => {
  await signIn(page); await adminWorkspace(page); const { link } = await issue(page);
  const invited = await recipient(browser);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  let logoutHeld = false, previews = 0, sessionReads = 0;
  try {
    invited.page.on('request', request => {
      if (request.url().endsWith('/invitations/preview')) previews++;
      if (request.url().endsWith('/auth/session')) sessionReads++;
    });
    await invited.page.goto(link);
    await expect(invited.page.getByRole('region', { name: 'Verified invitation access' })).toBeVisible();
    await invited.page.route('**/api/auth/logout', async route => {
      // Keep the real session valid, then lose the acknowledgement without
      // submitting logout. Recovery must retain the user's sign-out intent.
      logoutHeld = true; await held; await route.abort('connectionreset').catch(() => {});
    });
    await invited.page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect.poll(() => logoutHeld).toBe(true);
    const readsBefore = sessionReads, previewsBefore = previews;
    const navigateFragment = async () => {
      await invited.page.evaluate(fragment => { location.hash = fragment; }, new URL(link).hash);
      await expect.poll(() => new URL(invited.page.url()).hash).toBe('');
      await expect(invited.page.getByRole('region', { name: 'Verified invitation access' })).toHaveCount(0);
      await expect(invited.page.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0);
    };
    await navigateFragment();
    await expect(invited.page.getByRole('status')).toContainText('Checking current access');
    expect(sessionReads).toBe(readsBefore); expect(previews).toBe(previewsBefore);
    release();
    await expect(invited.page.getByRole('button', { name: 'Try signing out again', exact: true })).toBeVisible();
    await navigateFragment();
    await expect(invited.page.getByRole('alert')).toContainText('could not confirm sign-out');
    await expect(invited.page.getByRole('button', { name: 'Try signing out again', exact: true })).toBeVisible();
    expect(sessionReads).toBe(readsBefore); expect(previews).toBe(previewsBefore);
    await invited.page.unroute('**/api/auth/logout');
    await invited.page.getByRole('button', { name: 'Try signing out again', exact: true }).click();
    await expect(invited.page.getByRole('heading', { name: 'Sign in to continue', exact: true })).toBeVisible();
    const readsAfterLogout = sessionReads;
    await navigateFragment();
    await expect(invited.page.getByRole('heading', { name: 'Sign in to continue', exact: true })).toBeVisible();
    await expect(invited.page.getByRole('link', { name: 'Sign in to Zobba', exact: true })).toBeVisible();
    await expect(invited.page.getByText('Sign in, then reopen the original private invitation link.', { exact: false })).toBeVisible();
    expect(sessionReads).toBe(readsAfterLogout); expect(previews).toBe(previewsBefore);
    expect((await invited.page.request.get(`${runtime.url}/api/auth/session`)).status()).toBe(401);
    expect((await snapshot(page)).members.some(member => member.actor_id === 'actor-unassigned')).toBe(false);
  } finally { release(); await invited.context.close(); }
});

test('expired membership is shown honestly and can be renewed or have its expiry explicitly cleared', async ({ page }) => {
  runtime.sql("UPDATE public.organisation_memberships SET expires_at=1 WHERE organisation_id='org-a' AND actor_id='actor-a';");
  await signIn(page); await adminWorkspace(page);
  const row = page.locator('.membership-list li').filter({ has: page.locator('[data-membership-focus="member-actor-a"]') });
  await expect(row).toContainText('Expired');
  const editor = await editMember(page); await expect(editor.getByLabel('Use a membership expiry', { exact: true })).toBeChecked();
  const future = Math.floor(Date.now() / 1000) + 86400;
  await editor.getByLabel('Membership expiry (UTC)', { exact: true }).fill(new Date(future * 1000).toISOString().slice(0, 19).replace(/:00$/, ''));
  await editor.getByRole('button', { name: 'Save membership' }).click(); await expect(row).toContainText('Active');
  expect((await snapshot(page)).members.find(member => member.actor_id === 'actor-a')?.expires_at).toBe(future);
  const renewed = await editMember(page); await renewed.getByLabel('Use a membership expiry', { exact: true }).uncheck();
  await renewed.getByRole('button', { name: 'Save membership' }).click(); await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
  expect((await snapshot(page)).members.find(member => member.actor_id === 'actor-a')?.expires_at).toBeNull();
});

test('multi-page member and invitation edits retain selections and preserve existing off-page assignments', async ({ page, browser }) => {
  seedEngagements(53);
  runtime.sql("INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','ui20_6_052','actor-a');");
  await signIn(page); await adminWorkspace(page); const editor = await editMember(page);
  const saves: SaveMember[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/org-a/members')) saves.push(request.postDataJSON()); });
  await editor.getByLabel('Alder Manufacturing / Pagination engagement 000', { exact: true }).check();
  await editor.getByRole('button', { name: 'Next engagement page' }).click();
  await editor.getByLabel('Alder Manufacturing / Pagination engagement 050', { exact: true }).check();
  await expect(editor.getByLabel('Alder Manufacturing / Pagination engagement 052', { exact: true })).toBeChecked();
  await editor.getByRole('button', { name: 'First engagement page' }).click();
  await expect(editor.getByLabel('Alder Manufacturing / Pagination engagement 000', { exact: true })).toBeChecked();
  await editor.getByRole('button', { name: 'Save membership' }).click(); await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
  expect((await snapshot(page)).members.find(member => member.actor_id === 'actor-a')?.assignments.map(item => item.engagement_id).sort())
    .toEqual(['engagement-a', 'ui20_6_000', 'ui20_6_050', 'ui20_6_052']);
  expect(saves).toHaveLength(1);
  expect(saves[0]!.assignments.map(item => [item.engagement_id, item.renew]).sort()).toEqual([
    ['engagement-a', false], ['ui20_6_000', true], ['ui20_6_050', true], ['ui20_6_052', false],
  ]);
  await page.getByRole('button', { name: 'Invite a member', exact: true }).click();
  const invite = page.getByRole('form', { name: 'Create private invitation' }); await invite.getByLabel('Recipient email').fill('unassigned@example.test');
  await invite.getByLabel('Alder Manufacturing / Pagination engagement 001', { exact: true }).check();
  await invite.getByRole('button', { name: 'Next engagement page' }).click();
  await invite.getByLabel('Alder Manufacturing / Pagination engagement 051', { exact: true }).check();
  await invite.getByRole('button', { name: 'First engagement page' }).click();
  await expect(invite.getByLabel('Recipient email')).toHaveValue('unassigned@example.test');
  await expect(invite.getByLabel('Alder Manufacturing / Pagination engagement 001', { exact: true })).toBeChecked();
  await invite.getByRole('button', { name: 'Create private invitation', exact: true }).click();
  const linkField = page.getByRole('textbox', { name: 'Private invitation link', exact: true }); await expect(linkField).toBeFocused();
  const invited = await recipient(browser);
  try {
    await invited.page.goto(await linkField.inputValue());
    await expect(invited.page.getByRole('region', { name: 'Verified invitation access' })).toContainText('Pagination engagement 001');
    await expect(invited.page.getByRole('region', { name: 'Verified invitation access' })).toContainText('Pagination engagement 051');
    await invited.page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(invited.page.getByText('Change recorded.', { exact: false })).toBeVisible();
    expect((await snapshot(page)).members.find(member => member.actor_id === 'actor-unassigned')?.assignments.map(item => item.engagement_id).sort()).toEqual(['ui20_6_001', 'ui20_6_051']);
  } finally { await invited.context.close(); }
});

test('legacy members with over 100 assignments preserve access during role edits and remove only selected scopes across pages', async ({ page }) => {
  seedEngagements(102, true); await signIn(page); await adminWorkspace(page);
  expect((await snapshot(page)).members.find(member => member.actor_id === 'actor-a')).toMatchObject({ assignments_count: 103, assignments_complete: false });
  const editor = await editMember(page); await editor.getByLabel('Admin', { exact: true }).check();
  await editor.getByRole('button', { name: 'Save membership' }).click(); await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
  expect((await snapshot(page)).members.find(member => member.actor_id === 'actor-a')).toMatchObject({ roles: ['admin', 'auditor'], assignments_count: 103 });
  const removing = await editMember(page); await removing.getByRole('button', { name: 'Next existing assignment page' }).click();
  await removing.getByLabel('Remove Alder Manufacturing / Pagination engagement 050', { exact: true }).check();
  await removing.getByRole('button', { name: 'Next existing assignment page' }).click();
  await removing.getByLabel('Remove Alder Manufacturing / Pagination engagement 101', { exact: true }).check();
  await removing.getByRole('button', { name: 'Save membership' }).click(); await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
  expect((await snapshot(page)).members.find(member => member.actor_id === 'actor-a')).toMatchObject({ assignments_count: 101, assignments_complete: false });
  const narrowing = await editMember(page); await narrowing.getByRole('button', { name: 'Next existing assignment page' }).click();
  await narrowing.getByRole('button', { name: 'Next existing assignment page' }).click();
  await narrowing.getByLabel('Remove Alder Manufacturing / Pagination engagement 100', { exact: true }).check();
  await narrowing.getByRole('button', { name: 'Save membership' }).click(); await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
  const repaired = (await snapshot(page)).members.find(member => member.actor_id === 'actor-a')!;
  expect(repaired.assignments_count).toBe(100); expect(repaired.assignments_complete).toBe(true);
  expect(repaired.assignments.some(item => ['ui20_6_050', 'ui20_6_100', 'ui20_6_101'].includes(item.engagement_id))).toBe(false);
  expect(repaired.assignments.some(item => item.engagement_id === 'engagement-a')).toBe(true);
});

test('an opened legacy draft remains preserve-only when expiry changes 101 assignments to 100 on refresh', async ({ page }) => {
  seedEngagements(100, true); await signIn(page); await adminWorkspace(page);
  const expiresAt = Math.floor(Date.now() / 1000) + 7;
  runtime.sql(`UPDATE public.engagement_assignments SET expires_at=${expiresAt} WHERE organisation_id='org-a' AND actor_id='actor-a' AND engagement_id='engagement-a';`);
  await page.getByRole('button', { name: 'Refresh access' }).click();
  const opened = await snapshot(page), before = opened.members.find(member => member.actor_id === 'actor-a')!;
  expect(before).toMatchObject({ assignments_count: 101, assignments_complete: false });
  expect(before.assignments.some(item => item.engagement_id === 'ui20_6_099')).toBe(false);
  const editor = await editMember(page);
  await expect(editor.getByRole('group', { name: 'Existing engagement assignments', exact: true })).toBeVisible();
  await editor.getByLabel('Audit manager', { exact: true }).check();
  expect(Math.floor(Date.now() / 1000)).toBeLessThan(expiresAt);
  await expect.poll(() => Math.floor(Date.now() / 1000) >= expiresAt).toBe(true);
  await page.getByRole('button', { name: 'Refresh access' }).click();
  const refreshed = await snapshot(page);
  expect(refreshed.version).toBe(opened.version);
  expect(refreshed.members.find(member => member.actor_id === 'actor-a')).toMatchObject({ assignments_count: 100, assignments_complete: true });
  await expect(editor.getByRole('group', { name: 'Existing engagement assignments', exact: true })).toBeVisible();
  await expect(editor.getByRole('group', { name: 'Engagement assignments', exact: true })).toHaveCount(0);
  await expect(editor.getByLabel('Audit manager', { exact: true })).toBeChecked();
  const saved = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/org-a/members'));
  await editor.getByRole('button', { name: 'Save membership' }).click();
  expect((await saved).postDataJSON()).toMatchObject({ assignment_mode: 'preserve', assignments: [] });
  await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
  const after = (await snapshot(page)).members.find(member => member.actor_id === 'actor-a')!;
  expect(after.roles).toEqual(['audit_manager', 'auditor']);
  expect(after.assignments.map(item => item.engagement_id)).toEqual(Array.from({ length: 100 }, (_, index) => `ui20_6_${String(index).padStart(3, '0')}`));
  runtime.sql(`DO $assert$ BEGIN ASSERT (SELECT active AND expires_at=${expiresAt} FROM public.engagement_assignments WHERE organisation_id='org-a' AND actor_id='actor-a' AND engagement_id='engagement-a'), 'Ordinary legacy Save changed the expired assignment'; END $assert$;`);
});

test('a loaded assignment that expires before Save stays expired until explicitly selected in a later draft', async ({ page }) => {
  seedEngagements(1, true); await signIn(page); await adminWorkspace(page);
  const expiresAt = Math.floor(Date.now() / 1000) + 7;
  runtime.sql(`UPDATE public.engagement_assignments SET expires_at=${expiresAt} WHERE organisation_id='org-a' AND actor_id='actor-a' AND engagement_id='ui20_6_000';`);
  await page.getByRole('button', { name: 'Refresh access' }).click();
  const editor = await editMember(page);
  await expect(editor.getByLabel('Alder Manufacturing / Pagination engagement 000', { exact: true })).toBeChecked();
  await editor.getByLabel('Audit manager', { exact: true }).check();
  expect(Math.floor(Date.now() / 1000)).toBeLessThan(expiresAt);
  await expect.poll(() => Math.floor(Date.now() / 1000) >= expiresAt).toBe(true);
  await page.getByRole('button', { name: 'Refresh access' }).click();
  await expect(editor.getByLabel('Alder Manufacturing / Pagination engagement 000', { exact: true })).toBeChecked();
  const saves: SaveMember[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/org-a/members')) saves.push(request.postDataJSON()); });
  await editor.getByRole('button', { name: 'Save membership' }).click();
  await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
  expect(saves[0]!.assignments.find(item => item.engagement_id === 'ui20_6_000')?.renew).toBe(false);
  expect((await snapshot(page)).members.find(member => member.actor_id === 'actor-a')?.assignments.map(item => item.engagement_id)).toEqual(['engagement-a']);
  runtime.sql(`DO $assert$ BEGIN ASSERT (SELECT active AND expires_at=${expiresAt} FROM public.engagement_assignments WHERE organisation_id='org-a' AND actor_id='actor-a' AND engagement_id='ui20_6_000'), 'Ordinary Save renewed the expired assignment'; END $assert$;`);
  const regrant = await editMember(page);
  await expect(regrant.getByLabel('Alder Manufacturing / Pagination engagement 000', { exact: true })).not.toBeChecked();
  await regrant.getByLabel('Alder Manufacturing / Pagination engagement 000', { exact: true }).check();
  await regrant.getByRole('button', { name: 'Save membership' }).click();
  await expect(page.getByText('Change recorded.', { exact: false })).toBeVisible();
  expect(saves).toHaveLength(2);
  expect(saves[1]!.assignments.find(item => item.engagement_id === 'ui20_6_000')?.renew).toBe(true);
  expect(saves[1]!.assignments.find(item => item.engagement_id === 'engagement-a')?.renew).toBe(false);
  expect((await snapshot(page)).members.find(member => member.actor_id === 'actor-a')?.assignments.map(item => item.engagement_id)).toEqual(['engagement-a', 'ui20_6_000']);
  runtime.sql("DO $assert$ BEGIN ASSERT (SELECT active AND expires_at IS NULL FROM public.engagement_assignments WHERE organisation_id='org-a' AND actor_id='actor-a' AND engagement_id='ui20_6_000'), 'Explicit later selection did not renew access'; END $assert$;");
});
