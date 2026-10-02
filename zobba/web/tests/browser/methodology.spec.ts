import { expect, test } from '@playwright/test';
import type { ConsoleMessage, Page, Request, Response, TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration, restoreAndClose } from './cleanup';
import type { MethodologySnapshot, TaskBasis } from '../../src/methodology';

// Owned Playwright drives the real HTTPS OIDC/API/PostgreSQL foundation.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const restore = fixtureRestoration(['actor-admin', 'actor-manager'], `
UPDATE public.identities SET active=true WHERE id IN ('actor-admin','actor-manager');
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['admin'] WHERE organisation_id='org-a' AND actor_id='actor-admin';
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['audit_manager','admin'] WHERE organisation_id='org-a' AND actor_id='actor-manager';
UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id='actor-manager';
`);
test.beforeAll(async () => { runtime = await startAuthRuntime(); await runtime.stopWorker(); });
test.afterAll(async () => { if (runtime) await restoreAndClose(runtime, restore()); });

async function signIn(page: Page, account: string) {
  const started = Date.now(), events: Record<string, unknown>[] = [];
  // Keep bootstrap evidence without callback queries, headers, response bodies,
  // console text, passwords or session values. Unknown paths are classified only.
  const safePath = (value: string) => {
    try { const path = new URL(value).pathname; return /^(?:\/$|\/(?:src|node_modules|assets)\/|\/@|\/api\/(?:auth\/session|engagements)$)/.test(path) ? path : '[other]'; }
    catch { return '[unavailable]'; }
  };
  const record = (event: Record<string, unknown>) => { if (events.length < 400) events.push({ elapsedMs: Date.now() - started, ...event }); };
  const category = (message: string) => /does not provide an export named/.test(message) ? 'missing-module-export'
    : /Failed to fetch dynamically imported module|Failed to load module script/.test(message) ? 'module-load'
    : /Outdated Optimize Dep|optimized dependenc/i.test(message) ? 'dependency-optimization'
    : /Failed to load resource/.test(message) ? 'resource-load' : 'other';
  const onRequest = (request: Request) => record({ kind: 'request', path: safePath(request.url()), resource: request.resourceType() });
  const onResponse = (response: Response) => record({ kind: 'response', path: safePath(response.url()), resource: response.request().resourceType(), status: response.status() });
  const onFailed = (request: Request) => record({ kind: 'request-failed', path: safePath(request.url()), resource: request.resourceType(), code: request.failure()?.errorText.match(/net::[A-Z_]+/)?.[0] ?? 'other' });
  const onConsole = (message: ConsoleMessage) => { if (message.type() === 'error') record({ kind: 'console-error', category: category(message.text()), path: safePath(message.location().url), line: message.location().lineNumber }); };
  const onError = (error: Error) => record({ kind: 'page-error', name: /^[A-Za-z]+Error$/.test(error.name) ? error.name : 'Error', category: category(error.message), frames: (error.stack?.match(/https?:\/\/[^\s)]+/g) ?? []).slice(0, 8).map(safePath) });
  page.on('request', onRequest); page.on('response', onResponse); page.on('requestfailed', onFailed); page.on('console', onConsole); page.on('pageerror', onError);
  try {
    await page.goto(`${runtime.url}/api/auth/login`);
    await page.getByLabel('Account', { exact: true }).selectOption(account);
    await page.getByLabel('Password', { exact: true }).fill(runtime.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your engagements', exact: true })).toBeVisible().catch(async error => {
      const documentState = await page.evaluate(() => ({ title: document.title, ready: document.readyState,
        rootChildren: document.getElementById('root')?.childElementCount ?? null, rootTextLength: document.getElementById('root')?.textContent?.length ?? null,
        bodyTextLength: document.body.textContent?.length ?? 0, scriptCount: document.scripts.length, stylesheetCount: document.styleSheets.length }));
      const info = test.info(), name = `methodology-bootstrap-${account}.json`, path = info.outputPath(name);
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify({ path: safePath(page.url()), ...documentState, events }, null, 2));
      await info.attach(name, { path, contentType: 'application/json' });
      throw new Error(`Sign-in did not open the workspace: ${JSON.stringify({ path: safePath(page.url()), ...documentState })}`, { cause: error });
    });
  } finally {
    page.off('request', onRequest); page.off('response', onResponse); page.off('requestfailed', onFailed); page.off('console', onConsole); page.off('pageerror', onError);
  }
  await expect(page).toHaveTitle('Zobba · Pair');
  expect(new URL(page.url()).origin).toBe(runtime.url);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
}
async function openSettings(page: Page) {
  await page.getByRole('link', { name: 'Methodology and skills', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Methodology and skills', exact: true })).toBeVisible();
  const organisation = page.getByRole('button', { name: /Northstar.*Manage methodology/ });
  await page.getByRole('button', { name: 'New methodology', exact: true }).or(organisation).first().waitFor({ state: 'visible' });
  if (await organisation.isVisible()) await organisation.click();
  await expect(page.getByRole('button', { name: 'New methodology', exact: true })).toBeVisible();
}
async function snapshot(page: Page): Promise<MethodologySnapshot> {
  const response = await page.request.get(`${runtime.url}/api/methodology/organisations/org-a`);
  expect(response.status()).toBe(200); return response.json();
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const path = info.outputPath(name); await page.screenshot({ path, fullPage: false }); await info.attach(name, { path, contentType: 'image/png' });
}
async function recordedCommand(page: Page, command: { key: string; kind: string; content: string; context?: unknown }) {
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/conversation?organisation_id=org-a&client_id=client-a`);
  expect(response.status()).toBe(200);
  const matching = (await response.json()).messages.filter((message: { key: string }) => message.key === command.key);
  expect(matching).toHaveLength(1);
  const recorded = matching[0]!;
  expect(recorded.kind).toBe(command.kind); expect(recorded.content).toBe(command.content); expect(recorded.author_id).toBe('actor-manager');
  expect(recorded.context ?? null).toEqual(command.context ?? null);
  return recorded;
}

test('Guide supplies missing Task context with exact attribution and stages a binding without replacing the original', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page, 'manager-a');
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
  await page.getByLabel('Task objective', { exact: true }).fill('Discover audit context before evaluation');
  const created = page.waitForResponse(response => response.url().includes('/task-commands?') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  const createResponse = await created; expect(createResponse.status()).toBe(202);
  const createCommand = createResponse.request().postDataJSON();
  await expect(page.getByRole('button', { name: 'Open Discover audit context before evaluation', exact: true })).toBeVisible();
  const receipt = await recordedCommand(page, createCommand);
  await page.getByRole('button', { name: 'Open Discover audit context before evaluation', exact: true }).click();
  const basis = page.getByRole('region', { name: 'What Zobba is using', exact: true });
  await expect(basis.getByText('Not yet specified', { exact: true })).toHaveCount(2);
  const basisPath = `${runtime.url}/api/engagements/engagement-a/tasks/${receipt.task_id}/methodology?organisation_id=org-a&client_id=client-a`;
  const original: TaskBasis = await (await page.request.get(basisPath)).json();
  await page.getByRole('button', { name: 'Guide this Task', exact: true }).click();
  await page.getByLabel('Update Task audit context', { exact: true }).check();
  await expect(page.getByLabel('Task audit area', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Task period start', { exact: true })).toHaveValue('');
  await page.getByLabel('Task audit area', { exact: true }).fill('Revenue');
  await page.getByLabel('Task period start', { exact: true }).fill('2025-01-01');
  const reason = 'Discovery established the revenue audit area.\n  The 2025 business period is confirmed.\n';
  await page.getByLabel('Guidance', { exact: true }).fill(reason);
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect(page.getByText('Use an audit area without surrounding spaces, and enter both business period dates in order or leave both blank.', { exact: true })).toBeVisible();
  await page.getByLabel('Task period end', { exact: true }).fill('2025-12-31');
  const accepted = page.waitForResponse(response => response.url().includes('/task-controls?') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  const guideResponse = await accepted;
  expect(guideResponse.status()).toBe(202);
  const echo = page.getByRole('article', { name: 'Guidance from manager-a', exact: true });
  await expect(echo).toBeVisible();
  const guide = await recordedCommand(page, guideResponse.request().postDataJSON());
  expect(guide.task_id).toBe(receipt.task_id);
  expect(guide.target_task_id).toBe(receipt.task_id); expect(guide.target_cycle_id).toBe(receipt.cycle_id);
  expect(guideResponse.request().postDataJSON().context).toEqual({ audit_area: 'Revenue', period_start: '2025-01-01', period_end: '2025-12-31' });
  await basis.getByRole('button', { name: 'Refresh methodology basis', exact: true }).click();
  await expect(basis.getByText('Pending methodology change', { exact: true })).toBeVisible();
  const pending: TaskBasis = await (await page.request.get(basisPath)).json();
  expect(pending.current).toEqual(original.current);
  expect(pending.pending?.id).toBe(guide.command_id);
  expect(pending.pending?.actor_id).toBe('actor-manager');
  expect(pending.pending?.reason).toBe(`Explicit Task context supplied by Guide: ${reason}`);
  expect(pending.pending?.resolution.context).toEqual({ audit_area: 'Revenue', period_start: '2025-01-01', period_end: '2025-12-31' });
  await expect(page.getByLabel('Update Task audit context', { exact: true })).not.toBeChecked();
  await echo.getByText('Attribution and receipt', { exact: true }).click();
  await expect(echo.getByText('2025-01-01 to 2025-12-31', { exact: true })).toBeVisible();
  await page.getByLabel('Update Task audit context', { exact: true }).check();
  await expect(page.getByLabel('Task audit area', { exact: true })).toHaveValue('Revenue');
  await expect(page.getByLabel('Task period end', { exact: true })).toHaveValue('2025-12-31');
  await expect(page.getByText('Prefilled from the pending change.', { exact: false })).toBeVisible();
  await page.getByLabel('Update Task audit context', { exact: true }).uncheck();
  await page.setViewportSize({ width: 1280, height: 800 });
  await basis.getByText('Pending methodology change', { exact: true }).scrollIntoViewIfNeeded();
  await capture(page, info, 'methodology-guide-context-pending.png');
  await basis.getByText('2025-01-01 to 2025-12-31', { exact: true }).scrollIntoViewIfNeeded();
  await capture(page, info, 'methodology-guide-context-values.png');
  expect(errors).toEqual([]);
});

test('Admin Save, frozen lost-receipt retry, Undo, exact Task templates, new-only notice, recall and draft withdrawal', async ({ page, browser }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  const watchErrors = (target: Page) => {
    target.on('pageerror', error => errors.push(error.message));
    target.on('console', message => { if (message.type() === 'error' && !/Failed to load resource: (the server responded with a status of (400|401|403|404|409|412|429|503)|net::ERR_FAILED)/.test(message.text())) errors.push(message.text()); });
  };
  watchErrors(page);
  await signIn(page, 'admin-only');
  await expect(page.getByRole('heading', { name: 'No assigned engagements', exact: true })).toBeVisible();
  await openSettings(page);
  await expect(page.getByLabel('Task objective', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'New methodology', exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit methodology', exact: true });
  await form.getByLabel('Package name', { exact: true }).fill('\ufeffNorthstar requirements');
  await form.getByLabel('Default audit area', { exact: true }).fill('Revenue');
  await form.getByLabel('Default period start', { exact: true }).fill('2025-01-01');
  await form.getByLabel('Default period end', { exact: true }).fill('2025-12-31');
  await form.getByLabel('Requirement identifier', { exact: true }).fill('support');
  await form.getByLabel('Requirement label', { exact: true }).fill('Support the conclusion');
  await form.getByLabel('Criteria', { exact: true }).fill('\ufeffObtain appropriate support');
  await form.getByLabel('Template versions', { exact: true }).fill('paper@v1');
  await form.getByLabel('Review and issuance rules', { exact: true }).fill('Independent review before issuance');
  await form.getByRole('button', { name: 'Add template', exact: true }).click();
  await form.getByLabel('Template identifier', { exact: true }).fill('paper');
  await form.getByLabel('Template version', { exact: true }).fill('v1');
  await form.getByLabel('Template name', { exact: true }).fill('Conclusion paper');
  await form.getByLabel('Section identifier', { exact: true }).fill('basis');
  await form.getByLabel('Section title', { exact: true }).fill('Recorded basis');
  const templateContent = '  State the criterion.\n\tList supporting evidence.\n';
  await form.getByLabel('Section content', { exact: true }).fill(templateContent);
  const beforeOversized = await snapshot(page);
  const authoringFields = [
    ['Criteria', '\ufeffObtain appropriate support'], ['Population and sampling conventions', ''],
    ['Evidence checks', ''], ['Rating vocabulary', ''], ['Review and issuance rules', 'Independent review before issuance'],
  ] as const;
  const largeValues = Array.from({ length: 32 }, (_, index) => `Bounded value ${index} ${'x'.repeat(1980)}`).join('\n');
  for (const [label] of authoringFields) await form.getByLabel(label, { exact: true }).fill(largeValues);
  const refused = page.waitForResponse(response => response.url().endsWith('/methodology/organisations/org-a/save') && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Save methodology', exact: true }).click();
  expect((await refused).status()).toBe(400);
  await expect(form.getByRole('button', { name: 'Save methodology', exact: true })).toBeEnabled();
  for (const [label] of authoringFields) await expect(form.getByLabel(label, { exact: true })).toHaveValue(largeValues);
  const afterOversized = await snapshot(page);
  expect(afterOversized.revision).toBe(beforeOversized.revision);
  expect(afterOversized.versions).toHaveLength(beforeOversized.versions.length);
  for (const [label, original] of authoringFields) {
    if (original) await form.getByLabel(label, { exact: true }).fill(original);
    else await form.getByRole('combobox', { name: `${label} behavior`, exact: true }).selectOption('inherit');
  }
  // A transport refusal admits no command. Its first-attempt editor behavior
  // is distinct from the uncertain committed request exercised below.
  await page.route('**/api/methodology/organisations/org-a/save', route => route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"capacity"}' }));
  await form.getByRole('button', { name: 'Save methodology', exact: true }).click();
  await expect(page.getByText('Your edit is retained;', { exact: false })).toBeVisible();
  await expect(form.getByLabel('Package name', { exact: true })).toBeEnabled();
  await expect(form.getByLabel('Section content', { exact: true })).toHaveValue(templateContent);
  await expect(page.getByRole('button', { name: 'Retry exact methodology request', exact: true })).toHaveCount(0);
  await page.unroute('**/api/methodology/organisations/org-a/save');
  await form.getByLabel('Package name', { exact: true }).focus();
  // The real periodic read must not hide the editor or move its keyboard focus.
  await page.waitForResponse(response => response.url().endsWith('/api/methodology/organisations/org-a') && response.request().method() === 'GET', { timeout: 20000 });
  await expect(form.getByLabel('Package name', { exact: true })).toBeFocused();
  await expect(form.getByLabel('Section content', { exact: true })).toHaveValue(templateContent);
  const posted: string[] = [];
  await page.route('**/api/methodology/organisations/org-a/save', async route => {
    posted.push(route.request().postData()!);
    if (posted.length === 2) { await route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"capacity"}' }); return; }
    const committed = await route.fetch(); expect(committed.status()).toBe(200);
    if (posted.length === 1) await route.abort('failed'); else await route.fulfill({ response: committed });
  });
  await form.getByRole('button', { name: 'Save methodology', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry exact methodology request', exact: true })).toBeEnabled();
  await expect(form.getByLabel('Package name', { exact: true })).toBeDisabled();
  await page.route('**/api/auth/session', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily_unavailable"}' }));
  await page.getByRole('button', { name: 'Refresh access', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connection interrupted', exact: true })).toBeVisible();
  await page.unroute('**/api/auth/session');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry exact methodology request', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Retry exact methodology request', exact: true }).click();
  await expect(page.getByText('The original delivery remains unconfirmed;', { exact: false })).toBeVisible();
  await expect(page.locator('form[aria-label="Edit methodology"] input:enabled')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New methodology', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Retry exact methodology request', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Retry exact methodology request', exact: true }).click();
  await expect(page.getByText('Methodology saved.', { exact: true })).toBeVisible();
  expect(posted).toHaveLength(3); expect(posted[1]).toBe(posted[0]); expect(posted[2]).toBe(posted[0]);
  await page.unroute('**/api/methodology/organisations/org-a/save');
  const first = (await snapshot(page)).versions[0]!;
  expect(first.command.definition.name).toBe('\ufeffNorthstar requirements');
  expect(first.command.definition.templates[0]!.sections[0]!.content).toBe(templateContent);
  await page.getByRole('button', { name: `Edit version ${first.revision}`, exact: true }).click();
  await form.getByLabel('Package name', { exact: true }).fill('Changed firm requirements');
  await form.getByLabel('Criteria', { exact: true }).fill('Revised support criterion');
  await form.getByRole('button', { name: 'Save methodology', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo to version 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Undo to version ${first.revision}`, exact: true }).click();
  await expect(form.getByText('Undo as a successor', { exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Save methodology', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit version 3', exact: true })).toBeVisible();
  const restored = (await snapshot(page)).versions.find(version => version.revision === '3')!;
  expect(restored.command.undo_of).toBe(first.id); expect(restored.command.definition).toEqual(first.command.definition);
  await capture(page, info, 'methodology-admin-versions.png');

  const managerContext = await browser.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } });
  const manager = await managerContext.newPage(); watchErrors(manager);
  try {
    await signIn(manager, 'manager-a');
    await manager.getByRole('button', { name: /FY2026 audit/ }).click();
    await expect(manager.getByText('Conversation up to date', { exact: true })).toBeVisible();
    await manager.getByLabel('Task objective', { exact: true }).fill('Inspect firm methodology basis');
    await manager.getByRole('button', { name: 'Send', exact: false }).click();
    await expect(manager.getByRole('button', { name: 'Open Inspect firm methodology basis', exact: true })).toBeVisible();
    await manager.getByRole('button', { name: 'Open Inspect firm methodology basis', exact: true }).click();
    const basis = manager.getByRole('region', { name: 'What Zobba is using', exact: true });
    await expect(basis.getByText('Applicable firm methodology', { exact: true })).toBeVisible();
    const inspectedTaskId = await manager.getByRole('region', { name: 'Task details', exact: true }).locator('.message-binding dd').first().textContent();
    const boundResponse = await manager.request.get(`${runtime.url}/api/engagements/engagement-a/tasks/${inspectedTaskId}/methodology?organisation_id=org-a&client_id=client-a`);
    expect(boundResponse.status()).toBe(200);
    const bound: TaskBasis = await boundResponse.json();
    await expect(basis.getByText(bound.current.resolution.reason, { exact: true })).toBeVisible();
    await basis.getByText('Binding attribution', { exact: true }).click();
    await expect(basis.getByText('applies from execution epoch', { exact: false })).toBeVisible();
    await basis.getByText('Binding attribution', { exact: true }).click();
    await basis.getByText('Support the conclusion · Mandatory', { exact: true }).click();
    await expect(basis.getByText('\ufeffObtain appropriate support', { exact: true })).toBeVisible();
    await basis.getByText('Template: Conclusion paper · paper@v1', { exact: true }).click();
    expect(await basis.locator('.retained-text').filter({ hasText: 'State the criterion.' }).textContent()).toBe(templateContent);
    const templateSummary = basis.getByText('Template: Conclusion paper · paper@v1', { exact: true });
    await templateSummary.focus();
    await manager.waitForResponse(response => response.url().includes('/methodology?') && response.request().method() === 'GET', { timeout: 20000 });
    await expect(templateSummary).toBeFocused();
    await expect(templateSummary.locator('..')).toHaveAttribute('open', '');
    await manager.getByLabel('Task objective', { exact: true }).fill('Unsent conversation retained');
    await openSettings(manager);
    await manager.getByRole('button', { name: 'Return to workspace', exact: true }).click();
    await expect(manager.getByLabel('Task objective', { exact: true })).toHaveValue('Unsent conversation retained');
    await expect(basis).toBeVisible();
    await manager.setViewportSize({ width: 390, height: 844 });
    await basis.getByRole('heading', { name: 'What Zobba is using', exact: true }).scrollIntoViewIfNeeded();
    await capture(manager, info, 'methodology-task-narrow.png');
    expect(await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await basis.locator('.retained-text').filter({ hasText: 'State the criterion.' }).scrollIntoViewIfNeeded();
    await capture(manager, info, 'methodology-template-narrow.png');
    await manager.setViewportSize({ width: 1280, height: 800 });
    await basis.getByRole('heading', { name: 'What Zobba is using', exact: true }).scrollIntoViewIfNeeded();
    await capture(manager, info, 'methodology-task-basis.png');
    await basis.locator('.retained-text').filter({ hasText: 'State the criterion.' }).scrollIntoViewIfNeeded();
    await capture(manager, info, 'methodology-template-desktop.png');
    await manager.getByRole('button', { name: 'Guide this Task', exact: true }).click();
    await manager.getByLabel('Update Task audit context', { exact: true }).check();
    await expect(manager.getByLabel('Task audit area', { exact: true })).toHaveValue('Revenue');
    await expect(manager.getByLabel('Task period start', { exact: true })).toHaveValue('2025-01-01');
    await expect(manager.getByLabel('Task period end', { exact: true })).toHaveValue('2025-12-31');
    await manager.getByLabel('Update Task audit context', { exact: true }).uncheck();

    await page.getByRole('button', { name: 'Edit version 3', exact: true }).click();
    await form.getByLabel('Package name', { exact: true }).fill('Next Task requirements');
    await form.getByRole('button', { name: 'Save methodology', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit version 4', exact: true })).toBeVisible();
    await basis.getByRole('button', { name: 'Refresh methodology basis', exact: true }).click();
    await expect(basis.getByText('Updates available for new Tasks', { exact: true })).toBeVisible();
    await expect(basis.getByText('This Task retains its original binding.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Recall version 3', exact: true }).click();
    const recallReason = ('Synthetic faulty criterion recall. ' + 'The criterion requires correction. '.repeat(70)).slice(0, 1999) + 'x';
    expect(recallReason).toHaveLength(2000);
    await page.getByLabel('Recall reason', { exact: true }).fill(recallReason);
    await page.getByRole('form', { name: 'Recall methodology', exact: true }).getByRole('button', { name: 'Recall version', exact: true }).click();
    await expect(page.getByText('Recall recorded.', { exact: true })).toBeVisible();
    expect((await snapshot(page)).impacts.at(-1)!.diff).toEqual([`Recalled: ${recallReason}`]);
    await basis.getByRole('button', { name: 'Refresh methodology basis', exact: true }).click();
    await expect(basis.getByText('This basis includes a recalled version.', { exact: false })).toBeVisible();
  } finally { await managerContext.close(); }

  await page.getByRole('button', { name: 'New methodology', exact: true }).click();
  await form.getByLabel('Package name', { exact: true }).fill('Private unsaved Admin draft');
  await runtime.sqlAsync(restore("UPDATE public.organisation_memberships SET active=false WHERE organisation_id='org-a' AND actor_id='actor-admin';"));
  await page.getByRole('button', { name: 'Refresh methodology access', exact: true }).click();
  await expect(page.getByText('Private drafts have been cleared.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Package name', { exact: true })).toHaveCount(0);
  await runtime.sqlAsync(restore());
  expect(errors).toEqual([]);
});

test('a real saved incomplete methodology retains more than 100 limitations in Task inspection', async ({ page, browser }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page, 'admin-only');
  const current = await snapshot(page);
  const sessionResponse = await page.request.get(`${runtime.url}/api/auth/session`);
  expect(sessionResponse.status()).toBe(200);
  const session = await sessionResponse.json();
  const headers = { Origin: runtime.url, 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, 'X-Expected-Session': session.csrf_token };
  // Establish the normal adopted contribution explicitly. Playwright may start
  // this case in a fresh fixture after another case fails.
  const normalResponse = await page.request.post(`${runtime.url}/api/methodology/organisations/org-a/save`, {
    headers, data: {
      key: crypto.randomUUID(), expected_revision: current.revision, supersedes: null, undo_of: null,
      assignment: { kind: 'client', client_id: 'client-a', engagement_id: null },
      applicability: { audit_area: 'Revenue', period_start: null, period_end: null },
      activation: { mode: 'new_tasks', available_at: Math.floor(Date.now() / 1000) },
      definition: { name: 'Normal adopted parity requirement', neutral_starter: false,
        default_context: { audit_area: 'Revenue', period_start: '2025-01-01', period_end: '2025-12-31' }, templates: [],
        requirements: [{ id: 'normal-parity', label: 'Ordinary support', mandatory: true, criteria: ['Support the conclusion'], review_rules: ['Independent review'] }] },
      source: { kind: 'authored', reference: null, note: 'Normal record alongside the incomplete parity record' },
    },
  });
  expect(normalResponse.status()).toBe(200);
  const normal = await normalResponse.json();
  const savedResponse = await page.request.post(`${runtime.url}/api/methodology/organisations/org-a/save`, {
    headers,
    data: {
      key: crypto.randomUUID(), expected_revision: normal.revision, supersedes: null, undo_of: null,
      assignment: { kind: 'engagement', client_id: 'client-a', engagement_id: 'engagement-a' },
      applicability: { audit_area: null, period_start: null, period_end: null },
      activation: { mode: 'new_tasks', available_at: Math.floor(Date.now() / 1000) },
      definition: {
        name: 'Discovery requirements still needing evaluation criteria', neutral_starter: false,
        default_context: { audit_area: 'Revenue', period_start: '2025-01-01', period_end: '2025-12-31' }, templates: [],
        requirements: Array.from({ length: 51 }, (_, index) => ({ id: `discovery-${index}`, label: `Discovery requirement ${index}`, mandatory: true })),
      },
      source: { kind: 'authored', reference: null, note: 'Synthetic bounded missing-criteria inspection proof' },
    },
  });
  expect(savedResponse.status()).toBe(200);
  const managerContext = await browser.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } });
  const manager = await managerContext.newPage();
  manager.on('pageerror', error => errors.push(error.message));
  try {
    await signIn(manager, 'manager-a');
    await manager.getByRole('button', { name: /FY2026 audit/ }).click();
    await expect(manager.getByText('Conversation up to date', { exact: true })).toBeVisible();
    await manager.getByLabel('Task objective', { exact: true }).fill('Inspect every recorded methodology limitation');
    const accepted = manager.waitForResponse(response => response.url().includes('/task-commands?') && response.request().method() === 'POST');
    await manager.getByRole('button', { name: 'Send', exact: false }).click();
    const receiptResponse = await accepted; expect(receiptResponse.status()).toBe(202);
    const createCommand = receiptResponse.request().postDataJSON();
    await expect(manager.getByRole('button', { name: 'Open Inspect every recorded methodology limitation', exact: true })).toBeVisible();
    const conversationResponse = await manager.request.get(`${runtime.url}/api/engagements/engagement-a/conversation?organisation_id=org-a&client_id=client-a`);
    expect(conversationResponse.status()).toBe(200);
    const messages = (await conversationResponse.json()).messages as { key: string; kind: string; task_id: string; content: string; author_id: string }[];
    const matching = messages.filter(message => message.key === createCommand.key);
    expect(matching).toHaveLength(1);
    const receipt = matching[0]!;
    expect(receipt.kind).toBe('create'); expect(receipt.content).toBe(createCommand.content); expect(receipt.author_id).toBe('actor-manager');
    await manager.getByRole('button', { name: 'Open Inspect every recorded methodology limitation', exact: true }).click();
    const basis = manager.getByRole('region', { name: 'What Zobba is using', exact: true });
    await expect(basis.getByText('Incomplete methodology basis', { exact: true })).toBeVisible();
    const response = await manager.request.get(`${runtime.url}/api/engagements/engagement-a/tasks/${receipt.task_id}/methodology?organisation_id=org-a&client_id=client-a`);
    expect(response.status()).toBe(200);
    const actual: TaskBasis = await response.json();
    expect(actual.current.resolution.version_ids).toContain(normal.version_id);
    expect(actual.current.resolution.issues.length).toBeGreaterThan(100);
    await expect(basis.getByRole('list', { name: 'Basis limitations', exact: true }).getByRole('listitem')).toHaveCount(actual.current.resolution.issues.length);
    await expect(basis.getByText('Define evaluation criteria for Discovery requirement 0.', { exact: true })).toBeVisible();
    await basis.getByRole('heading', { name: 'Basis limitations', exact: true }).scrollIntoViewIfNeeded();
    await capture(manager, info, 'methodology-incomplete-limitations.png');
    expect(errors).toEqual([]);
  } finally { await managerContext.close(); }
});
