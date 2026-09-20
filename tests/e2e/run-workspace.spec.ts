import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { ConversationContentCipher } from '@intellifin/infrastructure';

import {
  createRunWorkspaceBrowserFixture,
  RUN_WORKSPACE_CONVERSATION_KEY,
  RUN_WORKSPACE_RECORD_ORDINAL,
  RUN_WORKSPACE_SUBMITTED_TEXT,
  type RunWorkspaceBrowserFixture,
} from '../fixtures/run-workspace-browser';
import { AUTH_STATE } from './accounts';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

let fixture: RunWorkspaceBrowserFixture;

function shell(page: Page): ReturnType<Page['getByTestId']> {
  return page.getByTestId('run-workspace-shell');
}

function conversationPane(page: Page): ReturnType<Page['locator']> {
  return shell(page).locator('.run-workspace-shell__conversation-pane');
}

function history(page: Page): ReturnType<Page['getByLabel']> {
  return conversationPane(page).getByLabel('Conversation history');
}

function workspaceUrl(): string {
  return `/runs/${fixture.runId}/workspace?record=${fixture.sourceOrdinal}`;
}

async function scan(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const violations = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false, caret: 'initial' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function assertShellLoaded(page: Page): Promise<void> {
  await expect(shell(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Auditor Workspace · / })).toBeVisible();
  await expect(conversationPane(page).getByLabel('Message the Run')).toBeVisible();
  await expect(shell(page).locator('.run-workspace-shell__workspace-pane')).toContainText('Action-linked captures');
  await expect(shell(page).locator('.run-workspace-shell__workspace-pane')).toContainText('No registered workspace capture is available yet.');
  await expect(shell(page).locator('.run-workspace-shell__decision').getByRole('heading', { name: 'Open Escalation', exact: true })).toBeVisible();
  await expect(shell(page).locator('.run-workspace-shell__decision')).toContainText('The captured record needs an auditor decision');
  await expect(shell(page).locator('.run-workspace-shell__decision').getByRole('button', { name: 'Select candidate 1', exact: true })).toBeVisible();
}

async function captureWorkspaceBounds(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const bounds = await page.evaluate(() => {
    const rect = (element: Element | null): Record<string, number> | null => {
      if (!(element instanceof HTMLElement)) return null;
      const box = element.getBoundingClientRect();
      return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height };
    };
    const shell = document.querySelector('[data-testid="run-workspace-shell"]');
    const decision = shell?.querySelector('.run-workspace-shell__decision') ?? null;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight, scrollY: window.scrollY },
      shell: rect(shell),
      decision: rect(decision),
      history: rect(shell?.querySelector('.run-conversation__thread') ?? null),
      send: rect(shell?.querySelector('.run-conversation__send') ?? null),
      firstChoice: rect(decision?.querySelector('button') ?? null),
    };
  });
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false, caret: 'initial' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  await testInfo.attach(`${name}-bounds`, {
    body: JSON.stringify(bounds, null, 2),
    contentType: 'application/json',
  });
}

async function assertWorkspaceFitsViewport(page: Page, testInfo: TestInfo): Promise<void> {
  // Visibility alone allows an offscreen or clipped element. Inspect the actual bounds
  // before clicking/scrollIntoView can conceal a broken initial composition.
  const send = shell(page).getByRole('button', { name: 'Send message', exact: true });
  try {
    await expect.poll(() => send.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth;
    })).toBe(true);
  } catch (error) {
    await captureWorkspaceBounds(page, testInfo, `workspace-bounds-send-${page.viewportSize()?.width ?? 'unknown'}x${page.viewportSize()?.height ?? 'unknown'}`);
    throw error;
  }
  const firstChoice = shell(page).getByRole('button', { name: 'Select candidate 1', exact: true });
  try {
    await expect.poll(() => firstChoice.evaluate(element => {
      const box = element.getBoundingClientRect();
      const decision = element.closest('.run-workspace-shell__decision')!.getBoundingClientRect();
      return box.top >= Math.max(0, decision.top) && box.bottom <= Math.min(window.innerHeight, decision.bottom);
    })).toBe(true);
  } catch (error) {
    await captureWorkspaceBounds(page, testInfo, `workspace-bounds-choice-${page.viewportSize()?.width ?? 'unknown'}x${page.viewportSize()?.height ?? 'unknown'}`);
    throw error;
  }
  const conversationHistory = history(page);
  try {
    await expect.poll(() => conversationHistory.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.height >= 120 && box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth;
    })).toBe(true);
  } catch (error) {
    await captureWorkspaceBounds(page, testInfo, `workspace-bounds-history-${page.viewportSize()?.width ?? 'unknown'}x${page.viewportSize()?.height ?? 'unknown'}`);
    throw error;
  }
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  fixture = await createRunWorkspaceBrowserFixture();
});

test.afterAll(async () => {
  await fixture?.cleanup();
});

test.describe('Run Workspace through the authenticated application', () => {
  test.use({ storageState: AUTH_STATE.auditor });

  test('renders the persisted decision, submits encrypted Q&A, and survives reload', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(workspaceUrl());
    await assertShellLoaded(page);
    await assertWorkspaceFitsViewport(page, testInfo);
    await screenshot(page, testInfo, 'run-workspace-decision-1440x900');

    // The selected source ordinal is carried into the workspace from request state. The
    // link remains a protected Record Review navigation, not a client-side mock or a label.
    const recordLink = shell(page).locator('.run-workspace-shell__decision').getByRole('link', { name: 'Open record inspector', exact: true });
    await expect(recordLink).toHaveAttribute('href', /\/runs\/[^/]+\/evidence\?selected=1$/);
    await recordLink.click();
    await expect(page).toHaveURL(/\/runs\/[^/]+\/evidence\?(?:[^#]*&)?(?:selected|record)=1$/);
    const inspector = page.getByRole('region', { name: 'Record inspector', exact: true });
    await expect(inspector).toBeVisible();
    await inspector.scrollIntoViewIfNeeded();
    await expect(inspector).toBeInViewport();
    await screenshot(page, testInfo, 'run-workspace-record-inspector-1440x900');
    await expect(inspector.getByRole('heading', { name: 'parameter-0001', exact: true })).toBeVisible();
    // This fixture has a source row and a real registered wait Evidence reference, but no
    // Observation for the selected row. The inspector's typed Not captured state is the
    // honest result and does not claim that metadata alone made bytes available.
    await expect(inspector.getByText('Not captured', { exact: true })).toBeVisible();
    await page.goto(workspaceUrl());
    await assertShellLoaded(page);

    const thread = history(page);
    await expect(thread.locator('article[data-message-sequence]')).toHaveCount(50);
    await expect(thread.locator(`[data-message-sequence="${fixture.initialMessageCount - 49}"]`)).toBeVisible();
    await expect(thread.locator('[data-message-sequence="55"]')).toContainText('historical decision context');
    await expect(conversationPane(page).getByRole('button', { name: 'Load older messages', exact: true })).toBeVisible();

    // Conversation and workspace have separate scroll surfaces. The composer is pinned
    // outside the history, so changing history position does not hide the action surface.
    const scrollMetrics = await thread.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
    await thread.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
    await expect.poll(() => thread.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(conversationPane(page).getByLabel('Message the Run')).toBeVisible();

    const separator = shell(page).getByRole('separator', { name: 'Resize conversation and workspace panes', exact: true });
    await expect(separator).toHaveAttribute('aria-valuenow', '40');
    const composer = conversationPane(page).getByLabel('Message the Run');
    await composer.fill('Draft survives pane resize and focus changes.');
    await separator.press('ArrowRight');
    await expect(separator).toHaveAttribute('aria-valuenow', '45');
    await shell(page).getByRole('button', { name: 'Focus workspace', exact: true }).click();
    await expect(conversationPane(page)).toBeHidden();
    await shell(page).getByRole('button', { name: 'Show conversation', exact: true }).click();
    await expect(composer).toHaveValue('Draft survives pane resize and focus changes.');
    await separator.press('End');
    await expect(separator).toHaveAttribute('aria-valuenow', '65');
    await composer.fill(RUN_WORKSPACE_SUBMITTED_TEXT);
    await shell(page).getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(conversationPane(page).locator('.run-conversation__composer-status')).toHaveText('Message accepted.');

    // The receipt is followed by a direct database assertion: metadata and governed content
    // were committed, ciphertext contains no plaintext, and the request text decrypts only
    // with the disposable synthetic key used by the browser server.
    await expect.poll(async () => (await fixture.readConversationRows()).length, { timeout: 10_000 }).toBe(fixture.initialMessageCount + 2);
    const rows = await fixture.readConversationRows();
    const submitted = rows.find((row) => row.sequence === fixture.initialMessageCount + 1);
    expect(submitted).toBeDefined();
    expect(submitted!.ciphertext).not.toBeNull();
    expect(submitted!.ciphertext).not.toContain(RUN_WORKSPACE_SUBMITTED_TEXT);
    const cipher = new ConversationContentCipher(RUN_WORKSPACE_CONVERSATION_KEY);
    const opened = JSON.parse(cipher.open(fixture.runId, submitted!.message_id, submitted!.ciphertext!)) as { text?: unknown };
    expect(opened.text).toBe(RUN_WORKSPACE_SUBMITTED_TEXT);

    await page.reload();
    await assertShellLoaded(page);
    await expect(history(page).locator(`[data-message-sequence="${fixture.initialMessageCount + 1}"]`)).toContainText(RUN_WORKSPACE_SUBMITTED_TEXT);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await screenshot(page, testInfo, 'run-workspace-persisted-1440x900');
    await scan(page);
    expect(consoleErrors).toEqual([]);
  });

  test('keeps older history bounded and the split surface usable at 1280×800', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(workspaceUrl());
    await assertShellLoaded(page);
    await assertWorkspaceFitsViewport(page, testInfo);

    const thread = history(page);
    const rowsBeforePaging = await fixture.readConversationRows();
    const latestSequence = rowsBeforePaging.at(-1)?.sequence ?? 0;
    const olderCount = Math.max(0, rowsBeforePaging.length - 50);
    await expect(thread.locator('article[data-message-sequence]')).toHaveCount(50);
    await conversationPane(page).getByRole('button', { name: 'Load older messages', exact: true }).click();
    await expect(conversationPane(page).getByRole('button', { name: 'Return to latest messages', exact: true })).toBeVisible();
    // The older controller replaces the current page, rather than appending unbounded
    // stale content. Its expected size is derived from the durable fixture state so this
    // viewport test remains independently runnable before the submit test.
    await expect(thread.locator('article[data-message-sequence]')).toHaveCount(olderCount);
    await expect(thread.locator('[data-message-sequence="1"]')).toBeVisible();
    await expect(thread.locator(`[data-message-sequence="${latestSequence}"]`)).toHaveCount(0);
    await conversationPane(page).getByRole('button', { name: 'Return to latest messages', exact: true }).click();
    await expect(thread.locator('article[data-message-sequence]')).toHaveCount(50);
    await expect(thread.locator(`[data-message-sequence="${latestSequence}"]`)).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await screenshot(page, testInfo, 'run-workspace-bounded-1280x800');
    await scan(page);
    expect(consoleErrors).toEqual([]);
  });

  test('does not reuse the workspace view after the auditor role is revoked', async ({ page }) => {
    test.setTimeout(120_000);
    const consoleErrors: string[] = [];
    let checkingRevocation = false;
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const resource = message.location().url;
      const expectedRefusal = checkingRevocation
        && message.text() === 'Failed to load resource: the server responded with a status of 403 (Forbidden)'
        && resource.startsWith(new URL(page.url()).origin + '/')
        && ['/api/runs/events', `/api/runs/${fixture.runId}/events`].includes(new URL(resource).pathname);
      if (!expectedRefusal) consoleErrors.push(`${message.text()} [${resource}]`);
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await page.goto(workspaceUrl());
    await assertShellLoaded(page);

    expect(consoleErrors).toEqual([]);
    checkingRevocation = true;
    await fixture.revokeAuditor();
    try {
      await page.reload();
      await expect(page.getByRole('alert')).toContainText('Your role does not permit this action.');
      await expect(page.getByTestId('run-workspace-shell')).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Run conversation', exact: true })).toHaveCount(0);
      await expect(page.getByText(RUN_WORKSPACE_SUBMITTED_TEXT, { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await fixture.restoreAuditor();
    }
    expect(consoleErrors).toEqual([]);
  });
});
