// Loaded only by the opt-in compiled-worker proof. No domain state or privacy
// outcome is substituted. IPC delays actual browser/model promises and reports
// allowlisted metadata; credentials, DOM, pixels and provider output never leave.
import './agent-evaluation-worker-preload.mjs';
import { createHash } from 'node:crypto';
import { PlaywrightBrowserExecution } from '../../packages/infrastructure/dist/runs/browser-execution.js';
if (process.env.WORKSPACE_PREVIEW_PROOF !== '1' || !process.send || process.env.WORKSPACE_PREVIEW_MODE !== 'synthetic-local') {
  throw new Error('Preview worker preload requires explicit synthetic IPC proof configuration');
}
const send = value => process.send?.({ previewProof: true, pid: process.pid, ...value });
const waiting = new Map();
let serial = 0;
let stopping = false;
let credentialRun = null;
let credentialHeld = false;
let fillInstrumented = false;
process.on('SIGTERM', () => { stopping = true; for (const release of waiting.values()) release(); });
process.on('message', message => {
  if (message?.type === 'release' && Number.isSafeInteger(message.id)) waiting.get(message.id)?.();
  if (message?.type === 'release-all') for (const release of waiting.values()) release();
});
async function gate(kind, metadata = {}, signal) {
  if (stopping) return;
  const id = ++serial;
  await new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); waiting.delete(id); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('Synthetic preview gate aborted', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Synthetic preview gate timed out')); }, 90_000);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    waiting.set(id, () => { cleanup(); resolve(); });
    send({ kind, id, ...metadata });
  });
}
const create = PlaywrightBrowserExecution.prototype.create;
PlaywrightBrowserExecution.prototype.create = async function (input) {
  const workspace = await create.call(this, input);
  const live = this.live.get(workspace.ref.workspaceId);
  let pageNumber = 0;
  const newPage = workspace.context.newPage.bind(workspace.context);
  workspace.context.newPage = async () => {
    const page = await newPage();
    const pageId = ++pageNumber;
    send({ kind: 'page-created', runId: input.runId, pageId });
    if (!fillInstrumented) {
      fillInstrumented = true;
      const prototype = Object.getPrototypeOf(page.locator('html'));
      const fill = prototype.fill;
      prototype.fill = async function (...args) {
        const result = await fill.apply(this, args);
        // Wait only AFTER the real credential fill settles. Do not inspect, retain,
        // or send the value. Production privacy admission happened before this call.
        if (credentialRun !== null && !credentialHeld && await this.evaluate(element => element instanceof HTMLInputElement && element.type === 'password')) {
          credentialHeld = true;
          await gate('private-input', { runId: credentialRun });
        }
        return result;
      };
    }
    const screenshot = page.screenshot.bind(page);
    page.screenshot = async options => {
      const bytes = await screenshot(options);
      send({ kind: 'capture', runId: input.runId, pageId, preview: options?.type === 'jpeg',
        digest: createHash('sha256').update(bytes).digest('hex'),
        runtimeId: live.preview?.identity.runtimeId, revision: live.preview?.identity.workspaceRevision,
        epoch: live.preview?.coordinator.status().fence.privacyEpoch });
      return bytes;
    };
    return page;
  };
  send({ kind: 'workspace-created', runId: input.runId });
  return workspace;
};
// This method runs inside production private admission; identify its real fill
// without entering or changing privacy, browser session, or authentication state.
const perform = PlaywrightBrowserExecution.prototype.performUncoordinated;
PlaywrightBrowserExecution.prototype.performUncoordinated = async function (ref, action, ...args) {
  if (action.credential !== null) { credentialRun = ref.runId; credentialHeld = false; }
  try { return await perform.call(this, ref, action, ...args); }
  finally { credentialRun = null; }
};
const release = PlaywrightBrowserExecution.prototype.release;
PlaywrightBrowserExecution.prototype.release = async function (ref, timeout) {
  const live = this.live.get(ref.workspaceId);
  const pages = live?.context.pages() ?? [];
  await release.call(this, ref, timeout);
  send({ kind: 'released', runId: ref.runId, pagesClosed: pages.length > 0 && pages.every(page => page.isClosed()) });
};
const provider = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).hostname === 'api.anthropic.com') await gate('model-turn', {}, init?.signal ?? (typeof input === 'object' ? input.signal : undefined));
  return provider(input, init);
};
send({ kind: 'preloaded' });
