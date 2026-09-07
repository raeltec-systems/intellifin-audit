import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { guardedCredentials } from '@intellifin/application';
import { parseWebTree } from '@intellifin/domain';
import { PlaywrightBrowserExecution } from '@intellifin/infrastructure/browser';
import { ManifestCredentialResolver } from '@intellifin/infrastructure/credentials';
import { GOLDEN_AGENT_INJECTIONS } from '../fixtures/agent-abuse-cases.js';

// Real LOCAL Chromium and adapter, synthetic HTTP target. No model service/worker is
// invoked here. Local browser state is weaker than Solari process/network isolation.
const PASSWORD = 'synthetic-abuse-audit-password';
async function authenticatedFixture(text: string) {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      if (request.method === 'POST' && request.url === '/target/sign-in') {
        if (new URLSearchParams(Buffer.concat(chunks).toString()).get('credential') !== PASSWORD) { response.writeHead(401); response.end(); return; }
        response.writeHead(303, { location: '/target', 'set-cookie': 'audit_session=synthetic-auditor; HttpOnly; Path=/' }); response.end(); return;
      }
      response.setHeader('content-type', 'text/html; charset=utf-8');
      if (!(request.headers.cookie ?? '').includes('audit_session=synthetic-auditor')) {
        response.end('<form method="post" action="/target/sign-in"><input type="password" name="credential"><button type="submit">Sign in</button></form>'); return;
      }
      // Golden strings have no HTML tags. They are served verbatim, never rewritten to
      // neutralize the prompt; capture must preserve the same text as inert data.
      response.end(`<p role="status" aria-label="Current signed-in account">Signed in as audit.readonly</p><dl><dt>Untrusted note</dt><dd>${text}</dd></dl>`);
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/target`;
  const browser = new PlaywrightBrowserExecution({ mode: 'local' });
  const held = guardedCredentials(new ManifestCredentialResolver(new Map([['cred://synthetic/abuse', PASSWORD]])));
  const close = async () => { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); };
  try {
    const workspace = await browser.create({ runId: 'golden-abuse-run', policy: { allowedOrigins: [origin] }, timeoutMs: 10000 });
    const credential = await held.credentials.resolve('cred://synthetic/abuse', 1000);
    expect((await browser.perform(workspace.ref, { action: 'navigate', destination: origin, authenticationDestination: `${origin}/sign-in`, credential }, 10000)).session).toBe(true);
    return { browser, workspace, origin, held, close };
  } catch (error) { await close(); throw error; }
}
describe('local browser golden retrieved content and ended workspace', () => {
  it.each(GOLDEN_AGENT_INJECTIONS)('$id is captured verbatim without copying audit credentials', async row => {
    const f = await authenticatedFixture(row.text);
    try {
      const result = await f.browser.perform(f.workspace.ref, { action: 'navigate', destination: f.origin, credential: null, capture: ['structural-snapshot'] }, 10000, f.held.guard);
      const captured = result.artifacts?.find(artifact => artifact.kind === 'structural-snapshot'); expect(captured).toBeDefined();
      const bytes = new TextDecoder().decode(captured!.bytes);
      expect(parseWebTree(bytes)?.nodes).toContainEqual(expect.objectContaining({ label: 'Untrusted note', value: row.text }));
      expect(bytes).not.toContain(PASSWORD);
      expect(result.location).toBe(f.origin);
    } finally { await f.close(); }
  });
  it('removes credential-bearing browser state from the workspace after release', async () => {
    const f = await authenticatedFixture(GOLDEN_AGENT_INJECTIONS[0]!.text);
    try {
      const page = f.workspace.context.pages()[0]!;
      expect((await f.workspace.context.cookies()).some(cookie => cookie.name === 'audit_session')).toBe(true);
      await f.browser.release(f.workspace.ref, 10000);
      expect(page.isClosed()).toBe(true);
      await expect(f.workspace.context.cookies()).rejects.toThrow();
      expect(await f.browser.attach(f.workspace.ref)).toBeNull();
      await expect(f.browser.perform(f.workspace.ref, { action: 'navigate', destination: f.origin, credential: null, capture: [] }, 1000)).rejects.toMatchObject({ code: 'unavailable' });
    } finally { await f.close(); }
  });
});
