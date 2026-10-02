import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration, restoreAndClose } from './cleanup';
import { newMethodologyRequirement } from '../../src/methodology';
import type { MethodologySnapshot, SaveMethodology } from '../../src/methodology';

// Browser plugin unavailable: repository Playwright drives real HTTPS/OIDC/API/PG.
// Flow: unsent methodology -> actual session outage/remount -> fresh scoped Admin
// authorization -> exact restored editor, never an automatic mutation.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const restore = fixtureRestoration(['actor-admin', 'actor-manager'], `
UPDATE public.identities SET active=true WHERE id IN ('actor-admin','actor-manager');
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['admin'] WHERE organisation_id='org-a' AND actor_id='actor-admin';
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['audit_manager','admin'] WHERE organisation_id='org-a' AND actor_id='actor-manager';
`);
test.beforeAll(async () => { runtime = await startAuthRuntime(); await runtime.stopWorker(); });
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'wait' }); await runtime.sqlAsync(restore()); });
test.afterAll(async () => { if (runtime) await restoreAndClose(runtime, restore()); });
const methodPattern = '**/api/methodology/organisations/org-a';
function gate() { let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); return { held, release }; }
async function signIn(page: Page, account = 'admin-only', replacing = false) {
  if (replacing) await page.context().clearCookies({ domain: '127.0.0.1' });
  await page.goto(`${runtime.url}/api/auth/login`);
  await page.getByLabel('Account', { exact: true }).selectOption(account);
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your engagements', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Zobba · Pair'); expect(new URL(page.url()).origin).toBe(runtime.url);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
}
async function settings(page: Page) {
  await page.getByRole('link', { name: 'Methodology and skills', exact: true }).click();
  await reopen(page);
}
async function reopen(page: Page) {
  const organisation = page.getByRole('button', { name: /Northstar.*Manage methodology/ });
  const newMethod = page.getByRole('button', { name: 'New methodology', exact: true });
  await newMethod.or(organisation).first().waitFor({ state: 'visible' });
  if (await organisation.isVisible()) await organisation.click();
  await expect(newMethod).toBeEnabled();
}
async function session(page: Page) { const response = await page.request.get(`${runtime.url}/api/auth/session`); expect(response.status()).toBe(200); return response.json(); }
async function snapshot(page: Page): Promise<MethodologySnapshot> { const response = await page.request.get(`${runtime.url}/api/methodology/organisations/org-a`); expect(response.status()).toBe(200); return response.json(); }
async function seed(page: Page, name: string) {
  const owner = await session(page), initial = await snapshot(page);
  const command: SaveMethodology = { key: crypto.randomUUID(), expected_revision: initial.revision, supersedes: null, undo_of: null,
    assignment: { kind: 'engagement', client_id: 'client-a', engagement_id: 'engagement-a' },
    applicability: { audit_area: name, period_start: '2025-01-01', period_end: '2025-12-31' }, activation: { mode: 'new_tasks', available_at: Math.floor(Date.now() / 1000) },
    source: { kind: 'authored', reference: 'original-reference', note: null },
    definition: { name, neutral_starter: false, default_context: { audit_area: name, period_start: '2025-01-01', period_end: '2025-12-31' }, templates: [], requirements: [{ ...newMethodologyRequirement('custody-rule'), criteria: ['Exact criterion'], review_rules: ['Independent review'] }] } };
  const response = await page.request.post(`${runtime.url}/api/methodology/organisations/org-a/save`, { headers: { Origin: runtime.url, 'X-CSRF-Token': owner.csrf_token, 'X-Expected-Actor': owner.identity.id, 'X-Expected-Session': owner.csrf_token }, data: command });
  expect(response.status()).toBe(200); const receipt = await response.json();
  return (await snapshot(page)).versions.find(version => version.id === receipt.version_id)!;
}
async function values(form: Locator) { return form.locator('input, textarea, select').evaluateAll(elements => elements.map(element => {
  const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  return { tag: field.tagName, type: field.type, value: field.value, checked: field instanceof HTMLInputElement && field.type === 'checkbox' ? field.checked : null };
})); }
async function observeDisclosure(page: Page) {
  await page.evaluate(() => {
    const evidence = { withdrew: false, leaks: 0, observer: null as MutationObserver | null };
    const inspect = () => {
      const visible = [...document.querySelectorAll<HTMLElement>('[data-method-custody-field], [data-current-org-draft]')].some(element => element.getClientRects().length);
      if (!visible) evidence.withdrew = true;
      else if (evidence.withdrew) evidence.leaks++;
    };
    evidence.observer = new MutationObserver(inspect); evidence.observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    Object.assign(window, { methodologyDisclosureEvidence: evidence });
  });
}
async function finishDisclosure(page: Page) {
  return page.evaluate(() => {
    const evidence = (window as unknown as { methodologyDisclosureEvidence?: { withdrew: boolean; leaks: number; observer: MutationObserver | null } }).methodologyDisclosureEvidence;
    evidence?.observer?.disconnect(); return evidence ? { withdrew: evidence.withdrew, leaks: evidence.leaks } : null;
  });
}
async function interrupt(page: Page, form: Locator) {
  await form.evaluate(element => element.setAttribute('data-methodology-before-remount', 'true'));
  await page.route('**/api/auth/session', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily_unavailable"}' }));
  try {
    await page.getByRole('button', { name: 'Refresh access', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connection interrupted', exact: true })).toBeVisible();
    await expect(page.locator('[data-methodology-before-remount]')).toHaveCount(0);
    await expect(page.getByRole('form', { name: /Edit methodology|Recall methodology/ })).toHaveCount(0);
  } finally { await page.unroute('**/api/auth/session'); }
}

test('unsent exact edit and recall survive actual session outage/remount; recovery never submits', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await signIn(page); const original = await seed(page, 'Methodology unsent custody'); await settings(page);
  await page.getByRole('button', { name: `Edit version ${original.revision}`, exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit methodology', exact: true });
  await form.getByLabel('Package name', { exact: true }).fill('Exact recovered methodology 🧾');
  await form.getByRole('textbox', { name: 'Criteria', exact: true }).fill('Exact criterion\nSecond requirement');
  await form.getByRole('textbox', { name: 'Source note', exact: true }).fill('\uFEFFUnsent source note');
  await form.getByRole('combobox', { name: 'Apply change to', exact: true }).selectOption('active_tasks');
  const availableAt = '2028-12-03T08:04'; await form.getByLabel('Available from', { exact: true }).fill(availableAt);
  await form.getByRole('button', { name: 'Add template', exact: true }).click();
  await form.getByLabel('Template identifier', { exact: true }).fill('custody-template');
  await form.getByLabel('Template version', { exact: true }).fill('v1');
  await form.getByLabel('Template name', { exact: true }).fill('Exact template');
  await form.getByLabel('Section identifier', { exact: true }).fill('section');
  await form.getByLabel('Section title', { exact: true }).fill('Retained content');
  const exact = '\uFEFF  Exact unsent template\n\t🧾 supplementary content\n';
  await form.getByRole('textbox', { name: 'Section content', exact: true }).fill(exact);
  let posts = 0; page.on('request', request => { if (request.method() === 'POST' && /\/methodology\/organisations\/org-a\/(save|recall)$/.test(request.url())) posts++; });
  const fields = await values(form), before = await snapshot(page), owner = await session(page);
  await interrupt(page, form);
  const authorization = gate(); let held = false;
  await page.route(methodPattern, async route => { const response = await route.fetch(); expect(response.status()).toBe(200); held = true; await authorization.held; await route.fulfill({ response }); });
  try {
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    // The old implementation also forgets the selected organisation. Permit its
    // normal chooser so the negative control reaches the missing exact editor.
    const choose = page.getByRole('button', { name: /Northstar.*Manage methodology/ });
    await expect.poll(async () => held || await choose.isVisible()).toBe(true);
    if (await choose.isVisible()) await choose.click();
    await expect.poll(() => held).toBe(true);
    await expect(form).toBeHidden(); expect(await page.locator('body').innerText()).not.toContain('Exact recovered methodology 🧾'); expect(posts).toBe(0);
    authorization.release();
    await expect(form, 'The exact unsent methodology edit must return after actual session outage and fresh scoped Admin authorization').toBeVisible();
    expect(await values(form)).toEqual(fields);
  } finally { authorization.release(); await page.unrouteAll({ behavior: 'wait' }); }
  const recoveredOwner = await session(page); expect(recoveredOwner.identity.id).toBe(owner.identity.id); expect(recoveredOwner.csrf_token === owner.csrf_token).toBe(true);
  expect(posts).toBe(0); expect(await snapshot(page)).toEqual(before);
  const screenshot = info.outputPath('methodology-recovered-unsent-edit.png'); await page.screenshot({ path: screenshot }); await info.attach('methodology-recovered-unsent-edit', { path: screenshot, contentType: 'image/png' });
  const saved = page.waitForResponse(response => response.url().endsWith('/methodology/organisations/org-a/save') && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Save methodology', exact: true }).click();
  const accepted = await saved; expect(accepted.status()).toBe(200); const command = accepted.request().postDataJSON();
  expect(command.supersedes).toBe(original.id); expect(command.undo_of).toBeNull(); expect(command.expected_revision).toBe(before.revision);
  expect(command.assignment).toEqual(original.command.assignment); expect(command.applicability).toEqual(original.command.applicability);
  expect(command.activation).toEqual({ mode: 'active_tasks', available_at: Math.floor(new Date(availableAt).getTime() / 1000) });
  expect(command.definition.templates[0].sections[0].content).toBe(exact);
  await expect(form).toHaveCount(0); expect(posts).toBe(1);
  const current = (await snapshot(page)).versions.find(version => version.command.key === command.key)!;
  await page.getByRole('button', { name: `Recall version ${current.revision}`, exact: true }).click();
  const recall = page.getByRole('form', { name: 'Recall methodology', exact: true }), reason = '\uFEFF  Exact unsent recall\n\t🧾 explanation\n';
  await recall.getByRole('textbox', { name: 'Recall reason', exact: true }).fill(reason); const recallFields = await values(recall), beforeRecall = await snapshot(page);
  await interrupt(page, recall); await page.getByRole('button', { name: 'Try again', exact: true }).click(); await reopen(page);
  await expect(recall).toBeVisible(); expect(await values(recall)).toEqual(recallFields); expect(posts).toBe(1); expect(await snapshot(page)).toEqual(beforeRecall);
  await recall.getByRole('button', { name: 'Cancel recall', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh access', exact: true }).click(); await reopen(page);
  await expect(recall).toHaveCount(0); await expect(form).toHaveCount(0); expect(posts).toBe(1); expect(errors).toEqual([]);
});

test('retained inner DOM and focus wait for this activation current-Admin read; cancelled success cannot authorize it', async ({ page }) => {
  await signIn(page); await settings(page); await page.getByRole('button', { name: 'New methodology', exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit methodology', exact: true });
  const field = form.getByRole('textbox', { name: 'Criteria', exact: true }); await field.fill('Private retained inner criterion');
  const details = field.locator('xpath=ancestor::details');
  await details.evaluate(element => element.setAttribute('data-method-custody-details', 'retained'));
  await field.evaluate(element => element.setAttribute('data-method-custody-field', 'retained')); await field.focus();
  const old = gate(), fresh = gate(); let reads = 0, oldHeld = false, oldDelivered = false, freshHeld = false;
  await page.route(methodPattern, async route => {
    const index = reads++, response = await route.fetch(); expect(response.status()).toBe(200);
    if (index === 0) { oldHeld = true; await old.held; } else { freshHeld = true; await fresh.held; }
    await route.fulfill({ response }); if (index === 0) oldDelivered = true;
  });
  try {
    await observeDisclosure(page);
    await page.getByRole('button', { name: 'Refresh methodology access', exact: true }).evaluate(element => (element as HTMLButtonElement).click());
    await expect.poll(() => oldHeld).toBe(true); await expect(form).toBeHidden();
    await page.getByRole('button', { name: 'Refresh access', exact: true }).evaluate(element => (element as HTMLButtonElement).click());
    await expect.poll(() => freshHeld).toBe(true);
    old.release(); await expect.poll(() => oldDelivered).toBe(true);
    const retainedField = page.locator('[data-method-custody-field="retained"]'), retainedDetails = page.locator('[data-method-custody-details="retained"]');
    await expect(retainedField).toHaveCount(1); await expect(retainedDetails).toHaveAttribute('open', ''); await expect(retainedField).toBeHidden();
    expect(await page.locator('body').innerText()).not.toContain('Private retained inner criterion');
    expect(await finishDisclosure(page)).toEqual({ withdrew: true, leaks: 0 });
    fresh.release(); await expect(retainedField).toBeVisible(); await expect(retainedField).toHaveValue('Private retained inner criterion');
    await expect(retainedDetails).toHaveAttribute('open', ''); await expect(retainedField).toBeFocused();
  } finally { old.release(); fresh.release(); await finishDisclosure(page); await page.unrouteAll({ behavior: 'wait' }); }
});

test('same-account session replacement, another identity and logout discard private methodology drafts', async ({ page, context }) => {
  await signIn(page); await settings(page); const replacement = await context.newPage(); let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/methodology/')) posts++; });
  try {
    for (const account of ['admin-only', 'manager-a']) {
      await page.getByRole('button', { name: 'New methodology', exact: true }).click();
      await page.getByLabel('Package name', { exact: true }).fill('Private previous session edit');
      const previous = await session(page); await signIn(replacement, account, true); const next = await session(replacement);
      expect(previous.csrf_token === next.csrf_token).toBe(false); expect(previous.identity.id === next.identity.id).toBe(account === 'admin-only');
      await page.getByRole('button', { name: 'Refresh access', exact: true }).click(); await reopen(page);
      await expect(page.getByRole('form', { name: 'Edit methodology', exact: true })).toHaveCount(0);
      expect(posts).toBe(0);
    }
    await page.getByRole('button', { name: 'New methodology', exact: true }).click();
    await page.getByLabel('Package name', { exact: true }).fill('Private logout edit');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Edit methodology', exact: true })).toHaveCount(0);
    await signIn(page, 'manager-a'); await settings(page); await expect(page.getByLabel('Package name', { exact: true })).toHaveCount(0); expect(posts).toBe(0);
  } finally { await replacement.close(); }
});

test('another current Admin membership cannot reveal retained edits before exact-org denial, and restoration cannot resurrect them', async ({ page }) => {
  await runtime.sqlAsync(`BEGIN; INSERT INTO public.organisations(id,name) VALUES ('method-custody-other','Other custody organisation'); INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES ('method-custody-other','actor-admin',ARRAY['admin']),('method-custody-other','actor-manager',ARRAY['admin']); COMMIT;`);
  const cleanup = `BEGIN; DELETE FROM public.organisation_memberships WHERE organisation_id='method-custody-other'; DELETE FROM public.membership_versions WHERE organisation_id='method-custody-other'; DELETE FROM public.organisations WHERE id='method-custody-other'; COMMIT;`;
  const denied = gate(); let held = false, listChecked = false;
  try {
    await signIn(page); await settings(page); await page.getByRole('button', { name: 'New methodology', exact: true }).click();
    const form = page.getByRole('form', { name: 'Edit methodology', exact: true }); await form.getByLabel('Package name', { exact: true }).fill('Never disclose to unrelated Admin');
    await form.evaluate(element => element.setAttribute('data-current-org-draft', 'retained'));
    const owner = await session(page);
    await runtime.sqlAsync(restore("UPDATE public.organisation_memberships SET active=false WHERE organisation_id='org-a' AND actor_id='actor-admin';"));
    await page.route('**/api/membership/organisations', async route => { const response = await route.fetch(); expect(response.status()).toBe(200); const result = await response.json(); expect(result.organisations.some((org: { organisation_id: string }) => org.organisation_id === 'method-custody-other')).toBe(true); listChecked = true; await route.fulfill({ response }); });
    await page.route(methodPattern, async route => { const response = await route.fetch(); expect(response.status()).toBe(403); held = true; await denied.held; await route.fulfill({ response }); });
    await observeDisclosure(page);
    await page.getByRole('button', { name: 'Refresh access', exact: true }).click(); await expect.poll(() => held && listChecked).toBe(true);
    await expect(page.locator('[data-current-org-draft="retained"]')).toHaveCount(1); await expect(form).toBeHidden();
    expect(await page.locator('body').innerText()).not.toContain('Never disclose to unrelated Admin');
    const current = await session(page); expect(current.csrf_token === owner.csrf_token).toBe(true);
    denied.release(); await expect(page.locator('[data-current-org-draft="retained"]')).toHaveCount(0);
    expect(await finishDisclosure(page)).toEqual({ withdrew: true, leaks: 0 });
    await page.unrouteAll({ behavior: 'wait' }); await runtime.sqlAsync(restore());
    await page.getByRole('button', { name: 'Refresh methodology access', exact: true }).click(); await reopen(page);
    await expect(form).toHaveCount(0);
  } finally { denied.release(); await finishDisclosure(page); await page.unrouteAll({ behavior: 'wait' }); await runtime.sqlAsync(restore()); await runtime.sqlAsync(cleanup); }
});
