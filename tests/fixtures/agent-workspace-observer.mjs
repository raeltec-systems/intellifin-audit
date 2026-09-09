// Test-only observation of actual worker-owned browser state. This does not call release,
// close a page, erase a cookie or grant authentication on the worker's behalf.
import { PlaywrightBrowserExecution } from '../../packages/infrastructure/dist/runs/browser-execution.js';
if (process.env.ANTHROPIC_API_KEY !== 'synthetic-agent-abuse-interception') throw new Error('Requires the synthetic worker abuse environment.');
const held = new Map();
const create = PlaywrightBrowserExecution.prototype.create;
PlaywrightBrowserExecution.prototype.create = async function (input) {
  const workspace = await create.call(this, input);
  held.set(workspace.ref.workspaceId, workspace);
  return workspace;
};
const release = PlaywrightBrowserExecution.prototype.release;
PlaywrightBrowserExecution.prototype.release = async function (ref, timeout) {
  const workspace = held.get(ref.workspaceId);
  const pages = workspace?.context.pages() ?? [];
  await release.call(this, ref, timeout);
  if (!workspace) return;
  let cookieReadRefused = false;
  try { await workspace.context.cookies(); } catch { cookieReadRefused = true; }
  process.stdout.write(`Synthetic workspace state after worker release:${JSON.stringify({ runId: ref.runId, mode: ref.mode,
    hadPages: pages.length > 0, allPagesClosed: pages.every(page => page.isClosed()), cookieReadRefused })}\n`);
};
