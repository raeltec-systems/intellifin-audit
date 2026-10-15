import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration, restoreAndClose } from './cleanup';
import { newMethodologyRequirement } from '../../src/methodology';
import type { MethodologySnapshot, SaveMethodology, TaskBasis } from '../../src/methodology';

test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const restore = fixtureRestoration(['actor-admin', 'actor-manager'], `
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['admin'] WHERE organisation_id='org-a' AND actor_id='actor-admin';
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['audit_manager','admin'] WHERE organisation_id='org-a' AND actor_id='actor-manager';
`);
test.beforeAll(async () => { runtime = await startAuthRuntime(); await runtime.stopWorker(); });
test.afterAll(async () => { if (runtime) await restoreAndClose(runtime, restore()); });

async function signIn(page: Page, account = 'admin-only') {
  await page.goto(`${runtime.url}/api/auth/login`);
  await page.getByLabel('Account', { exact: true }).selectOption(account);
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your engagements', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Zobba · Pair');
  expect(new URL(page.url()).origin).toBe(runtime.url);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
}
async function settings(page: Page) {
  await page.getByRole('link', { name: 'Methodology and skills', exact: true }).click();
  await page.getByRole('button', { name: /Northstar.*Manage methodology/ }).click();
  await expect(page.getByRole('button', { name: 'New methodology', exact: true })).toBeVisible();
}
async function snapshot(page: Page): Promise<MethodologySnapshot> {
  const response = await page.request.get(`${runtime.url}/api/methodology/organisations/org-a`);
  expect(response.status()).toBe(200); return response.json();
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const path = info.outputPath(name); await page.screenshot({ path }); await info.attach(name, { path, contentType: 'image/png' });
}
async function saveForm(page: Page) {
  const response = page.waitForResponse(response => response.url().endsWith('/methodology/organisations/org-a/save') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save methodology', exact: true }).click();
  const accepted = await response; expect(accepted.status()).toBe(200);
  const command: SaveMethodology = accepted.request().postDataJSON();
  await expect(page.getByText('Methodology saved.', { exact: true })).toBeVisible();
  const recorded = (await snapshot(page)).versions.filter(version => version.command.key === command.key);
  expect(recorded).toHaveLength(1); expect(recorded[0]!.command).toEqual(command);
  return recorded[0]!;
}
const emptyContext = { audit_area: null, period_start: null, period_end: null };
function authored(name: string, area: string): SaveMethodology {
  return { key: crypto.randomUUID(), expected_revision: '0', supersedes: null, undo_of: null,
    assignment: { kind: 'firm', client_id: null, engagement_id: null }, applicability: { ...emptyContext, audit_area: area },
    activation: { mode: 'new_tasks', available_at: Math.floor(Date.now() / 1000) },
    definition: { name, neutral_starter: false, default_context: emptyContext, templates: [], requirements: [{ ...newMethodologyRequirement('review-rule'), criteria: ['Retain support'], review_rules: ['Independent review'] }] },
    source: { kind: 'authored', reference: null, note: null } };
}
async function saveApi(page: Page, supplied: SaveMethodology) {
  const session = await (await page.request.get(`${runtime.url}/api/auth/session`)).json();
  const command = { ...supplied, key: crypto.randomUUID(), expected_revision: (await snapshot(page)).revision };
  const response = await page.request.post(`${runtime.url}/api/methodology/organisations/org-a/save`, {
    headers: { Origin: runtime.url, 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, 'X-Expected-Session': session.csrf_token }, data: command,
  });
  expect(response.status()).toBe(200);
  const receipt = await response.json();
  return (await snapshot(page)).versions.find(version => version.id === receipt.version_id)!;
}
async function createTask(page: Page, objective: string, context?: { audit_area: string; period_start: string; period_end: string }) {
  await page.getByLabel('Task objective', { exact: true }).fill(objective);
  if (context) {
    await page.getByText('Audit context (optional)', { exact: true }).click();
    await page.getByLabel('Task audit area', { exact: true }).fill(context.audit_area);
    await page.getByLabel('Task period start', { exact: true }).fill(context.period_start);
    await page.getByLabel('Task period end', { exact: true }).fill(context.period_end);
  }
  const response = page.waitForResponse(response => response.url().includes('/task-commands?') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  const accepted = await response; expect(accepted.status()).toBe(202);
  const command = accepted.request().postDataJSON();
  await expect(page.getByRole('button', { name: `Open ${objective}`, exact: true })).toBeVisible();
  const conversation = await page.request.get(`${runtime.url}/api/engagements/engagement-a/conversation?organisation_id=org-a&client_id=client-a`);
  expect(conversation.status()).toBe(200);
  const messages = (await conversation.json()).messages.filter((message: { key: string }) => message.key === command.key);
  expect(messages).toHaveLength(1);
  expect(messages[0].kind).toBe('create'); expect(messages[0].author_id).toBe('actor-manager'); expect(messages[0].content).toBe(objective);
  if (context) { expect(command.context).toEqual(context); expect(messages[0].context).toEqual(context); }
  await page.getByRole('button', { name: `Open ${objective}`, exact: true }).click();
  const path = `${runtime.url}/api/engagements/engagement-a/tasks/${messages[0].task_id}/methodology?organisation_id=org-a&client_id=client-a`;
  return { command, message: messages[0], read: async (): Promise<TaskBasis> => {
    const response = await page.request.get(path); expect(response.status()).toBe(200); return response.json();
  } };
}

test('explicit Create overrides firm defaults and a real active-task Save applies at the owned worker boundary', async ({ page, browser }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await signIn(page); await settings(page);
  await page.getByRole('button', { name: 'New methodology', exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit methodology', exact: true });
  await form.getByLabel('Package name', { exact: true }).fill('Default Revenue methodology');
  await form.getByLabel('Default audit area', { exact: true }).fill('Revenue');
  await form.getByLabel('Default period start', { exact: true }).fill('2025-01-01');
  await form.getByLabel('Default period end', { exact: true }).fill('2025-12-31');
  await form.getByLabel('Requirement identifier', { exact: true }).fill('initial-context');
  // Leave the optional label untouched: it must remain null, not an invalid empty string.
  await form.getByLabel('Criteria', { exact: true }).fill('Original criterion');
  await form.getByLabel('Review and issuance rules', { exact: true }).fill('Independent review');
  const initial = await saveForm(page);
  expect(initial.command.definition.requirements[0]!.label).toBeNull();
  const managerContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const manager = await managerContext.newPage(); manager.on('pageerror', error => errors.push(error.message));
  try {
    await signIn(manager, 'manager-a'); await manager.getByRole('button', { name: /FY2026 audit/ }).click();
    await expect(manager.getByText('Conversation up to date', { exact: true })).toBeVisible();
    const explicit = { audit_area: 'Inventory', period_start: '2024-01-01', period_end: '2024-12-31' };
    const task = await createTask(manager, 'Inspect differing explicit Create context', explicit);
    const original = await task.read();
    expect(original.current.resolution.context).toEqual(explicit);
    expect(original.current.resolution.context).not.toEqual(initial.command.definition.default_context);
    expect(original.current.resolution.version_ids).toEqual([initial.id]);
    expect(original.current.candidate_version_ids).toEqual([initial.id]);
    expect(original.current.context_command_id).toBeNull();
    expect(original.current.resolution.status).toBe('resolved');
    expect(original.current.resolution.neutral_source_version_ids).toContain('builtin_neutral_v1');
    const basis = manager.getByRole('region', { name: 'What Zobba is using', exact: true });
    await expect(basis.getByText('Firm methodology with neutral starter content', { exact: true })).toBeVisible();
    await expect(basis.getByText(/Template:.*Neutral starter/)).toBeVisible();
    await expect(basis.getByText('Inventory', { exact: true })).toBeVisible();
    await expect(basis.getByText('2024-01-01 to 2024-12-31', { exact: true })).toBeVisible();
    await basis.getByText('Firm methodology with neutral starter content', { exact: true }).scrollIntoViewIfNeeded();
    await capture(manager, info, 'methodology-explicit-context-neutral-attribution.png');
    await page.getByRole('button', { name: `Edit version ${initial.revision}`, exact: true }).click();
    await form.getByLabel('Criteria', { exact: true }).fill('Active Task replacement criterion');
    await form.getByRole('combobox', { name: 'Apply change to', exact: true }).selectOption('active_tasks');
    const successor = await saveForm(page);
    expect(successor.command.activation.mode).toBe('active_tasks'); expect(successor.command.supersedes).toBe(initial.id);
    const staged = await task.read();
    expect(staged.current).toEqual(original.current);
    expect(staged.pending?.resolution.version_ids).toEqual([successor.id]);
    expect(staged.pending?.actor_id).toBe('actor-admin');
    expect(staged.pending?.resolution.context).toEqual(explicit);
    await basis.getByRole('button', { name: 'Refresh methodology basis', exact: true }).click();
    await expect(basis.getByText('Pending methodology change', { exact: true })).toBeVisible();
    await basis.getByText('Pending methodology change', { exact: true }).scrollIntoViewIfNeeded();
    await capture(manager, info, 'methodology-active-form-save-pending.png');
    await runtime.startWorker(100);
    await expect.poll(async () => (await task.read()).current.resolution.version_ids, { timeout: 15000 }).toEqual([successor.id]);
    const applied = await task.read();
    expect(applied.pending).toBeNull(); expect(applied.current.id).not.toBe(original.current.id);
    expect(BigInt(applied.current.execution_epoch)).toBeGreaterThan(BigInt(original.current.execution_epoch));
    expect(applied.current.resolution.context).toEqual(explicit);
    expect(applied.history.find(binding => binding.id === original.current.id)).toEqual(original.current);
    await basis.getByRole('button', { name: 'Refresh methodology basis', exact: true }).click();
    await expect(basis.getByText('Pending methodology change', { exact: true })).toHaveCount(0);
    await expect(basis.getByText('Prior recorded bindings', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await runtime.stopWorker(); await managerContext.close(); }
});

test('Undo and conflict recovery keep independent overlapping lineages separate and historical Edit opens the current head', async ({ page }) => {
  await signIn(page);
  const a1 = await saveApi(page, authored('Lineage A original', 'Lineage proof'));
  const a2 = await saveApi(page, { ...a1.command, supersedes: a1.id, definition: { ...a1.command.definition, name: 'Lineage A current' } });
  const b1 = await saveApi(page, authored('Independent overlapping B', 'Lineage proof'));
  const b2 = await saveApi(page, { ...b1.command, supersedes: b1.id, definition: { ...b1.command.definition, name: 'Independent B current' } });
  await settings(page);
  const form = page.getByRole('form', { name: 'Edit methodology', exact: true });
  await page.getByRole('button', { name: `Undo to version ${a1.revision}`, exact: true }).click();
  await expect(form.getByLabel('Package name', { exact: true })).toHaveValue('Lineage A original');
  await expect(form.getByRole('combobox', { name: 'Assignment scope', exact: true })).toBeDisabled();
  for (const label of ['Applicable audit area', 'Business period start', 'Business period end']) await expect(form.getByLabel(label, { exact: true })).toBeDisabled();
  const undone = await saveForm(page);
  expect(undone.command.supersedes).toBe(a2.id); expect(undone.command.undo_of).toBe(a1.id);
  expect(undone.command.definition).toEqual(a1.command.definition);
  const historical = page.locator('.methodology-version').filter({ has: page.getByRole('heading', { name: 'Lineage A original', exact: true }) }).filter({ has: page.getByRole('button', { name: `Undo to version ${a1.revision}`, exact: true }) });
  await historical.getByRole('button', { name: `Edit current version ${undone.revision} for this lineage`, exact: true }).click();
  await expect(form.getByLabel('Package name', { exact: true })).toHaveValue(undone.command.definition.name);
  await form.getByLabel('Package name', { exact: true }).fill('Retained A edit after conflict');
  const concurrentA = await saveApi(page, { ...undone.command, supersedes: undone.id, undo_of: null, definition: { ...undone.command.definition, name: 'Concurrent A successor' } });
  const concurrentB = await saveApi(page, { ...b2.command, supersedes: b2.id, definition: { ...b2.command.definition, name: 'Later unrelated B successor' } });
  const refused = page.waitForResponse(response => response.url().endsWith('/methodology/organisations/org-a/save') && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Save methodology', exact: true }).click();
  expect((await refused).status()).toBe(409);
  await form.getByRole('button', { name: 'Use latest settings revision', exact: true }).click();
  await expect(form.getByLabel('Package name', { exact: true })).toHaveValue('Retained A edit after conflict');
  const recovered = await saveForm(page);
  expect(recovered.command.supersedes).toBe(concurrentA.id);
  expect(recovered.command.definition.name).toBe('Retained A edit after conflict');
  expect((await snapshot(page)).versions.filter(version => version.command.supersedes === concurrentB.id)).toHaveLength(0);
  await page.getByRole('button', { name: 'New methodology', exact: true }).click();
  await expect(form.getByRole('combobox', { name: 'Assignment scope', exact: true })).toBeEnabled();
  for (const label of ['Applicable audit area', 'Business period start', 'Business period end']) await expect(form.getByLabel(label, { exact: true })).toBeEnabled();
});

test('field controls distinguish clear from inherit while mandatory inherited text and references remain in force', async ({ page, browser }, info) => {
  await signIn(page);
  const parent = authored('Inheritance parent', 'Inheritance proof');
  const optional = { ...newMethodologyRequirement('optional-rule'), mandatory: false, criteria: ['Optional parent criterion'], review_rules: ['Inherited optional review'], templates: [{ id: 'inheritance-paper', version: 'v1' }], suitable_skills: [{ id: 'review-skill', version: 'v1' }] };
  const mandatory = { ...optional, id: 'mandatory-rule', mandatory: true, criteria: ['Mandatory parent criterion'] };
  parent.definition.requirements = [optional, mandatory];
  parent.definition.templates = [{ id: 'inheritance-paper', version: 'v1', name: 'Inherited working paper', sections: [{ id: 'basis', title: 'Basis', content: 'Retain supporting evidence.', required: true }] }];
  const inherited = await saveApi(page, parent);
  await settings(page); await page.getByRole('button', { name: 'New methodology', exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit methodology', exact: true });
  await form.getByLabel('Package name', { exact: true }).fill('Narrow optional clearing');
  await form.getByRole('combobox', { name: 'Assignment scope', exact: true }).selectOption('engagement');
  await form.getByRole('combobox', { name: 'Client', exact: true }).selectOption('client-a');
  await form.getByRole('combobox', { name: 'Engagement', exact: true }).selectOption('engagement-a');
  await form.getByLabel('Applicable audit area', { exact: true }).fill('Inheritance proof');
  await form.getByLabel('Requirement identifier', { exact: true }).fill('optional-rule');
  await form.getByLabel('Mandatory requirement', { exact: true }).uncheck();
  for (const label of ['Criteria', 'Template versions', 'Suitable skill versions']) {
    await form.getByRole('combobox', { name: `${label} behavior`, exact: true }).selectOption('clear');
    await expect(form.getByLabel(label, { exact: true })).toBeDisabled();
  }
  await expect(form.getByRole('combobox', { name: 'Review and issuance rules behavior', exact: true })).toHaveValue('inherit');
  await form.getByRole('combobox', { name: 'Criteria behavior', exact: true }).scrollIntoViewIfNeeded();
  await capture(page, info, 'methodology-field-inheritance-controls.png');
  await form.getByRole('button', { name: 'Add requirement', exact: true }).click();
  const required = form.locator('.methodology-requirement').nth(1);
  await required.getByLabel('Requirement identifier', { exact: true }).fill('mandatory-rule');
  await required.getByLabel('Mandatory requirement', { exact: true }).uncheck();
  for (const label of ['Criteria', 'Template versions', 'Suitable skill versions']) await required.getByRole('combobox', { name: `${label} behavior`, exact: true }).selectOption('clear');
  const saved = await saveForm(page);
  for (const rule of saved.command.definition.requirements) {
    expect(rule.label).toBeNull(); expect(rule.criteria).toEqual([]); expect(rule.templates).toEqual([]); expect(rule.suitable_skills).toEqual([]); expect(rule.review_rules).toBeNull();
  }
  const managerContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const manager = await managerContext.newPage();
  try {
    await signIn(manager, 'manager-a'); await manager.getByRole('button', { name: /FY2026 audit/ }).click();
    await expect(manager.getByText('Conversation up to date', { exact: true })).toBeVisible();
    const task = await createTask(manager, 'Inspect explicit optional clearing', { audit_area: 'Inheritance proof', period_start: '2024-01-01', period_end: '2024-12-31' });
    const actual = (await task.read()).current.resolution;
    expect(actual.version_ids).toEqual(expect.arrayContaining([inherited.id, saved.id]));
    const cleared = actual.requirements.find(({ requirement }) => requirement.id === 'optional-rule')!.requirement;
    expect(cleared.mandatory).toBe(false); expect(cleared.criteria).toEqual([]); expect(cleared.templates).toEqual([]); expect(cleared.suitable_skills).toEqual([]);
    expect(cleared.review_rules).toEqual(['Inherited optional review']);
    const retained = actual.requirements.find(({ requirement }) => requirement.id === 'mandatory-rule')!.requirement;
    expect(retained.mandatory).toBe(true); expect(retained.criteria).toEqual(['Mandatory parent criterion']);
    expect(retained.templates).toEqual([{ id: 'inheritance-paper', version: 'v1' }]);
    expect(retained.suitable_skills).toEqual([{ id: 'review-skill', version: 'v1' }]);
    expect(retained.review_rules).toEqual(['Inherited optional review']);
  } finally { await managerContext.close(); }
});

test('later organisation pages and verified names survive quiet refresh, and revoked selection returns to the authorised chooser', async ({ page }) => {
  const cleanup = `BEGIN;
DELETE FROM public.organisation_memberships WHERE organisation_id LIKE 'methodology-page-%';
DELETE FROM public.membership_versions WHERE organisation_id LIKE 'methodology-page-%';
DELETE FROM public.organisations WHERE id LIKE 'methodology-page-%';
COMMIT;`;
  await runtime.sqlAsync(cleanup);
  await runtime.sqlAsync(`BEGIN;
INSERT INTO public.organisations(id,name) SELECT 'methodology-page-' || lpad(n::text,3,'0'),'Review organisation ' || lpad(n::text,3,'0') FROM generate_series(1,51) AS n;
INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) SELECT id,actor,ARRAY['admin'] FROM public.organisations CROSS JOIN (VALUES ('actor-admin'),('actor-manager')) AS actors(actor) WHERE id LIKE 'methodology-page-%';
COMMIT;`);
  try {
    await signIn(page);
    await page.getByRole('link', { name: 'Methodology and skills', exact: true }).click();
    await page.getByRole('button', { name: 'More organisations', exact: true }).click();
    const later = page.getByRole('button', { name: /Review organisation 051.*Manage methodology/ });
    await expect(later).toBeVisible(); await later.focus();
    const refresh = page.waitForResponse(response => response.url().includes('/membership/organisations?after=') && response.request().method() === 'GET', { timeout: 20000 });
    await refresh;
    await expect(later).toBeFocused();
    const focusRefresh = page.waitForResponse(response => response.url().includes('/membership/organisations?after=') && response.request().method() === 'GET');
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await focusRefresh;
    await expect(later).toBeVisible(); await later.click();
    await expect(page.getByRole('heading', { name: 'Review organisation 051', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Refresh methodology access', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review organisation 051', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New methodology', exact: true }).click();
    await page.getByLabel('Package name', { exact: true }).fill('Private later-page draft');
    await runtime.sqlAsync("UPDATE public.organisation_memberships SET active=false WHERE organisation_id='methodology-page-051' AND actor_id='actor-admin';");
    await page.getByRole('button', { name: 'Refresh methodology access', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your organisations', exact: true })).toBeVisible();
    await expect(page.getByLabel('Package name', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Private later-page draft', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Review organisation 001.*Manage methodology/ })).toBeVisible();
    await page.getByRole('button', { name: /Review organisation 001.*Manage methodology/ }).click();
    await expect(page.getByRole('heading', { name: 'Review organisation 001', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New methodology', exact: true })).toBeVisible();
  } finally { await runtime.sqlAsync(cleanup); }
});
