import type { Page } from 'playwright-core';
import { BrowserActionError, type CredentialGuard } from '@intellifin/application';
import {
  canonicalJson,
  isWebTreeDocument,
  WEB_TREE_LIMITS,
  type JsonValue,
  type WebTreeDocument,
} from '@intellifin/domain';

/** Fixed platform code; page content and model output are never evaluated as code. */
const PROJECT_PAGE = `(() => {
  const nodes = [];
  const visible = element => {
    const style = getComputedStyle(element);
    return !element.closest('[hidden],[aria-hidden="true"]') &&
      style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  const text = element => element.innerText;
  const value = element => {
    const list = element.querySelector(':scope > ul, :scope > ol');
    return list ? Array.from(list.children).filter(e => e.tagName === 'LI').map(text) : text(element);
  };
  const add = (label, value, group, role, target = null) => {
    // These are the domain's wire bounds, repeated in the fixed page projection so a
    // hostile document cannot first create a large intermediate object and only then be
    // refused by the host validator. The values are intentionally not clipped: clipping
    // would make a rendered field look like a complete one while changing its value.
    if (nodes.length >= 4096 || typeof label !== 'string' || label.length > 1024 ||
        typeof group !== 'string' || group.length > 1024 ||
        (target !== null && (typeof target !== 'string' || target.length > 1024)) ||
        JSON.stringify(value).length > 8192) throw new Error('capture-bound');
    if (label.trim()) nodes.push({label, value, group, role, target});
  };
  Array.from(document.querySelectorAll('table')).filter(visible).forEach((table, tableIndex) => {
    const headers = Array.from(table.querySelectorAll('tr:first-child th')).map(text);
    Array.from(table.querySelectorAll('tr')).filter(row => visible(row) && row.querySelector(':scope > td')).forEach((row, rowIndex) => {
      Array.from(row.querySelectorAll(':scope > td')).forEach((cell, column) => {
        const label = headers[column];
        if (label !== undefined && visible(cell)) add(label, value(cell), 'table:' + tableIndex + ':row:' + rowIndex, 'datum');
      });
    });
  });
  Array.from(document.querySelectorAll('dl')).filter(visible).forEach((list, index) => {
    for (const term of list.querySelectorAll(':scope > dt')) {
      const definition = term.nextElementSibling;
      if (definition && definition.tagName === 'DD' && visible(term) && visible(definition)) {
        add(text(term), value(definition), 'record:' + index, 'datum');
      }
    }
  });
  for (const element of document.querySelectorAll('a[href],input,button,p,h1,h2,[role="status"]')) {
    if (!visible(element)) continue;
    if (element.tagName === 'A') {
      const url = new URL(element.getAttribute('href'), document.URL);
      if (url.protocol === 'https:' || url.protocol === 'http:') add(text(element), text(element), 'page', 'link', url.href);
    } else if (element.tagName === 'INPUT') {
      if (element.type !== 'text' && element.type !== 'search') continue;
      const label = element.getAttribute('aria-label') || Array.from(element.labels || []).map(text).join(' ');
      add(label, element.value, 'page', 'input', element.name || null);
    } else if (element.tagName === 'BUTTON') {
      add(text(element), text(element), 'page', 'button');
    } else {
      add(element.getAttribute('aria-label') || element.id || element.tagName.toLowerCase(), text(element), 'page', 'status');
    }
  }
  return {schemaVersion: 1, nodes};
})()`;

/** A target-specific completion statement LoanCore renders beside its result table. */
const LOANCORE_RESULT_SUMMARY = /^Showing ([0-9]+) of ([0-9]+) matching accounts\.$/u;

/**
 * Read a completion count only from the approved visible result summary.
 *
 * An empty node list does not prove an empty result, and the number of captured nodes does
 * not prove a result total. Unknown pages therefore keep completion absent. LoanCore's
 * exact `result-summary` sentence is a target postcondition whose declared total can be
 * preserved without guessing.
 */
export function completionForWebTree(document: WebTreeDocument): WebTreeDocument {
  const summaries = document.nodes.filter(
    (node) => node.role === 'status' && node.label === 'result-summary' && typeof node.value === 'string',
  );
  if (summaries.length !== 1) return document;
  const match = LOANCORE_RESULT_SUMMARY.exec(summaries[0]!.value as string);
  if (match === null) return document;
  const listed = Number(match[1]);
  const returned = Number(match[2]);
  if (
    !Number.isSafeInteger(listed) ||
    !Number.isSafeInteger(returned) ||
    listed < 0 ||
    returned < 0 ||
    listed > returned ||
    returned > WEB_TREE_LIMITS.returned
  ) {
    return document;
  }
  return {
    ...document,
    completion: { complete: listed === returned, returned },
  };
}

/** The fixed DOM read used to find live values that `page.content()` does not serialize. */
const READ_LIVE_VALUES = `(() => {
  const values = [];
  for (const element of document.querySelectorAll('input,textarea,[contenteditable="true"]')) {
    if ('value' in element) values.push(String(element.value));
    if (element.isContentEditable) values.push(element.textContent || '');
  }
  return values.join('\\n');
})()`;

/** Password/autocomplete surfaces that must never be captured, even when hidden. */
const PASSWORD_SURFACE_SELECTOR = [
  'input[type="password" i]',
  'input[name*="password" i]',
  'input[id*="password" i]',
  'input[aria-label*="password" i]',
  'textarea[name*="password" i]',
  'textarea[id*="password" i]',
  'textarea[aria-label*="password" i]',
  'textarea[autocomplete~="current-password" i]',
  'textarea[autocomplete~="new-password" i]',
  '[autocomplete="current-password" i]',
  '[autocomplete="new-password" i]',
].join(',');

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function guardedDiscloses(guard: CredentialGuard, bytes: Uint8Array): boolean {
  try {
    const disclosed = guard.discloses(bytes);
    if (typeof disclosed !== 'boolean') throw new Error('invalid-guard');
    return disclosed;
  } catch {
    // A broken guard cannot prove containment. Capture refuses instead of falling through
    // to an unscanned artifact.
    throw new BrowserActionError('contract');
  }
}

/**
 * A semantic projection of the actual rendered document, never a fixture lookup. Input
 * controls remain separate from data cells so a filter option cannot ground an account
 * status. Row groups preserve which identity and values appeared together.
 */
export async function captureWebTree(
  page: Page,
  guard: CredentialGuard,
  options: { readonly screenshot: boolean; readonly timeoutMs: number },
): Promise<{ readonly snapshot: Uint8Array; readonly screenshot: Uint8Array | null }> {
  // A capture MUST name the guard. The type is required, but this also closes the runtime
  // seam for JavaScript callers and callers that cast through the port.
  if (!isCredentialGuard(guard)) {
    throw new BrowserActionError('contract');
  }

  // Fail before producing either artifact when the page is a credential-entry surface.
  try {
    if (await page.locator(PASSWORD_SURFACE_SELECTOR).count() !== 0) {
      throw new BrowserActionError('contract');
    }
  } catch (error) {
    if (error instanceof BrowserActionError) throw error;
    throw new BrowserActionError('contract');
  }

  let document: string;
  try {
    document = await page.content();
  } catch {
    throw new BrowserActionError('contract');
  }
  const raw = utf8(document);
  if (raw.length > WEB_TREE_LIMITS.bytes || guardedDiscloses(guard, raw)) {
    throw new BrowserActionError('contract');
  }

  // `page.content()` does not include values typed into live controls. Read those values
  // through fixed platform code, scan them, and discard the returned string before any
  // artifact is made. This catches a secret in a text input or contenteditable surface even
  // when the control's HTML attribute remains empty.
  let liveValues: unknown;
  try {
    liveValues = await page.evaluate(READ_LIVE_VALUES);
  } catch {
    throw new BrowserActionError('contract');
  }
  if (typeof liveValues !== 'string' || guardedDiscloses(guard, utf8(liveValues))) {
    throw new BrowserActionError('contract');
  }

  let projected: unknown;
  try { projected = await page.evaluate(PROJECT_PAGE); }
  catch { throw new BrowserActionError('contract'); }
  if (!isWebTreeDocument(projected)) throw new BrowserActionError('contract');
  const completed = completionForWebTree(projected);
  if (!isWebTreeDocument(completed)) throw new BrowserActionError('contract');
  const snapshot = utf8(canonicalJson(completed as unknown as JsonValue));
  if (snapshot.length > WEB_TREE_LIMITS.bytes) throw new BrowserActionError('contract');
  if (guardedDiscloses(guard, snapshot)) throw new BrowserActionError('contract');
  // Screenshots do not ground Observations. A failure degrades completeness without
  // discarding the successfully captured structural Evidence.
  const screenshot = options.screenshot
    ? await page.screenshot({ type: 'png', fullPage: true, timeout: options.timeoutMs }).catch(() => null)
    : null;
  if (screenshot !== null && guardedDiscloses(guard, screenshot)) {
    throw new BrowserActionError('contract');
  }
  return { snapshot, screenshot };
}

/** Validate the structural guard at this lower-level seam as well as at the action port. */
function isCredentialGuard(value: unknown): value is CredentialGuard {
  try {
    if (value === null || typeof value !== 'object') return false;
    const guard = value as Partial<CredentialGuard>;
    return (
      typeof guard.redact === 'function' &&
      typeof guard.discloses === 'function' &&
      typeof guard.held === 'number' &&
      Number.isSafeInteger(guard.held) &&
      guard.held >= 0
    );
  } catch {
    return false;
  }
}
