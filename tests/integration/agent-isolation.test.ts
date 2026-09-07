import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { guardedCredentials } from '@intellifin/application';
import { parseWebTree } from '@intellifin/domain';
import { PlaywrightBrowserExecution } from '@intellifin/infrastructure/browser';
import { ManifestCredentialResolver } from '@intellifin/infrastructure/credentials';

// LOCAL browser-state isolation only: both Runs share the worker process. This is not
// Solari acceptance or the complete Story 4.11 gate.
const available = process.env['DATABASE_URL'];
const PASSWORD_A = 'synthetic-isolation-audit-a-password', PASSWORD_B = 'synthetic-isolation-audit-b-password';
const REF_A = 'cred://synthetic/isolation-a', REF_B = 'cred://synthetic/isolation-b';
const marker = '<p role="status" aria-label="Current signed-in account">Signed in as audit.readonly</p>';
async function fixture() {
  const requests: { method: string; path: string; account: string | null }[] = [];
  let writes = 0;
  let markHeld!: () => void;
  const heldReadStarted = new Promise<void>(resolve => { markHeld = resolve; });
  let releaseHeld: (() => void) | null = null;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const path = new URL(request.url ?? '/', 'http://synthetic.invalid').pathname;
      const cookie = request.headers.cookie ?? '';
      const account = cookie.includes('session=audit-a') ? 'audit-a' : cookie.includes('session=audit-b') ? 'audit-b' : null;
      requests.push({ method: request.method ?? '', path, account });
      if (request.method === 'POST' && path === '/target/sign-in') {
        const password = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('credential');
        const principal = password === PASSWORD_A ? 'audit-a' : password === PASSWORD_B ? 'audit-b' : null;
        if (principal === null) { response.writeHead(401); response.end('Refused'); return; }
        response.writeHead(303, { location: '/target', 'set-cookie': `session=${principal}; Path=/; HttpOnly` }); response.end(); return;
      }
      if (path === '/target/write' && request.method !== 'GET') { writes += 1; response.writeHead(200); response.end('Business record changed'); return; }
      response.setHeader('content-type', 'text/html; charset=utf-8');
      if (account === null) { response.end('<!doctype html><body><form method="post" action="/target/sign-in"><input name="credential" type="password"><button type="submit">Sign in</button></form></body>'); return; }
      if (path === '/target/held-read') { releaseHeld = () => response.end(`<!doctype html><body>${marker}<p>${account}</p></body>`); markHeld(); return; }
      if (path === '/target/hostile') {
        response.end(`<!doctype html><body>${marker}<p>Untrusted retrieved content</p><script>
          Promise.all(['POST','PUT','PATCH','DELETE'].map(method => fetch('/target/write', {method, body:'synthetic-mutation'}).catch(() => null)))
            .then(() => {document.body.dataset.attackComplete = 'yes'});
        </script></body>`); return;
      }
      if (path === '/target/reflected-secret') { response.end(`<!doctype html><body>${marker}<dl><dt>Unexpected credential</dt><dd>${account === 'audit-a' ? PASSWORD_A : PASSWORD_B}</dd></dl></body>`); return; }
      // Application JavaScript sets storage. Test code only reads it; it never installs a
      // logged-in identity or writes browser storage to simulate authentication.
      response.end(`<!doctype html><body>${marker}<dl><dt>Audit account</dt><dd>${account}</dd></dl><script>
        localStorage.setItem('audit-account', '${account}'); sessionStorage.setItem('audit-account', '${account}');
      </script></body>`);
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/target`;
  const browser = new PlaywrightBrowserExecution({ mode: 'local' });
  const held = guardedCredentials(new ManifestCredentialResolver(new Map([[REF_A, PASSWORD_A], [REF_B, PASSWORD_B]])));
  return { server, origin, browser, held, requests, writes: () => writes, heldReadStarted, releaseHeld: () => { if (!releaseHeld) throw new Error('No held request'); releaseHeld(); } };
}
async function close(browser: PlaywrightBrowserExecution, server: Server) {
  await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}

describe.skipIf(!available)('local browser cross-Run isolation and hostile-page requests', () => {
  it('keeps concurrent authenticated Runs on the same origin in separate cookie and storage contexts', async () => {
    const f = await fixture();
    try {
      const a = await f.browser.create({ runId: 'isolation-run-a', policy: { allowedOrigins: [f.origin] }, timeoutMs: 10_000 });
      const b = await f.browser.create({ runId: 'isolation-run-b', policy: { allowedOrigins: [f.origin] }, timeoutMs: 10_000 });
      expect(a.ref.workspaceId).not.toBe(b.ref.workspaceId); expect(a.ref.mode).toBe('local');
      const credentialA = await f.held.credentials.resolve(REF_A, 1000);
      const loggedA = await f.browser.perform(a.ref, { action: 'navigate', destination: f.origin, credential: credentialA }, 10_000);
      expect(loggedA.session).toBe(true); expect(loggedA.artifacts ?? []).toHaveLength(0);
      await f.browser.perform(b.ref, { action: 'navigate', destination: f.origin, credential: null, capture: [] }, 10_000);
      const pageB = b.context.pages()[0]!;
      expect(await pageB.locator('input[type="password"]').count()).toBe(1);
      expect(await pageB.evaluate(() => ({ local: localStorage.getItem('audit-account'), session: sessionStorage.getItem('audit-account') }))).toEqual({ local: null, session: null });
      expect(await b.context.cookies()).toEqual([]);
      const credentialB = await f.held.credentials.resolve(REF_B, 1000);
      expect((await f.browser.perform(b.ref, { action: 'navigate', destination: f.origin, credential: credentialB }, 10_000)).session).toBe(true);
      const pageA = a.context.pages()[0]!;
      expect(await pageA.evaluate(() => ({ local: localStorage.getItem('audit-account'), session: sessionStorage.getItem('audit-account') }))).toEqual({ local: 'audit-a', session: 'audit-a' });
      expect(await pageB.evaluate(() => ({ local: localStorage.getItem('audit-account'), session: sessionStorage.getItem('audit-account') }))).toEqual({ local: 'audit-b', session: 'audit-b' });
      expect((await a.context.cookies()).find(cookie => cookie.name === 'session')?.value).toBe('audit-a');
      expect((await b.context.cookies()).find(cookie => cookie.name === 'session')?.value).toBe('audit-b');
      expect(await f.browser.attach({ ...a.ref, runId: b.ref.runId })).toBeNull();
      await expect(f.browser.perform({ ...a.ref, runId: b.ref.runId }, { action: 'navigate', destination: f.origin, credential: null, capture: [] }, 1000)).rejects.toMatchObject({ code: 'unavailable' });
      // Hold A's request open while B completes. Two merely sequential Runs do not prove
      // simultaneous context ownership or independence while one Run is blocked.
      const pendingA = f.browser.perform(a.ref, { action: 'navigate', destination: f.origin + '/held-read', credential: null, capture: [] }, 10_000);
      await f.heldReadStarted;
      try {
        const independentB = await f.browser.perform(b.ref, { action: 'navigate', destination: f.origin, credential: null, capture: [] }, 5000);
        expect(independentB.status).toBe(200); expect(f.requests.at(-1)).toMatchObject({ account: 'audit-b' });
      } finally { f.releaseHeld(); }
      expect((await pendingA).status).toBe(200);
      await expect(f.browser.perform(b.ref, { action: 'navigate', destination: f.origin.replace('/target', '/webapp'), credential: null, capture: [] }, 1000)).rejects.toMatchObject({ code: 'scope' });
      expect(f.requests.some(request => request.path === '/webapp')).toBe(false);
      await f.browser.release(a.ref, 10_000);
      expect(await f.browser.attach(a.ref)).toBeNull(); expect(await f.browser.attach(b.ref)).not.toBeNull();
      const readB = await f.browser.perform(b.ref, { action: 'navigate', destination: f.origin, credential: null, capture: ['structural-snapshot'] }, 10_000, f.held.guard);
      const snapshot = readB.artifacts?.find(artifact => artifact.kind === 'structural-snapshot'); expect(snapshot).toBeDefined();
      const tree = parseWebTree(new TextDecoder().decode(snapshot!.bytes));
      expect(tree?.nodes).toContainEqual(expect.objectContaining({ label: 'Audit account', value: 'audit-b' }));
      expect(tree?.nodes.some(node => node.value === 'audit-a')).toBe(false);
      expect(f.requests.at(-1)).toMatchObject({ path: '/target', account: 'audit-b' }); expect(f.writes()).toBe(0);
    } finally { await close(f.browser, f.server); }
  }, 60_000);
  it('blocks a retrieved page from writing to its allowed origin outside sign-in', async () => {
    const f = await fixture();
    try {
      const workspace = await f.browser.create({ runId: 'hostile-page-run', policy: { allowedOrigins: [f.origin] }, timeoutMs: 10_000 });
      const credential = await f.held.credentials.resolve(REF_A, 1000);
      expect((await f.browser.perform(workspace.ref, { action: 'navigate', destination: f.origin, credential }, 10_000)).session).toBe(true);
      await f.browser.perform(workspace.ref, { action: 'navigate', destination: f.origin + '/hostile', credential: null, capture: [] }, 10_000).catch(() => null);
      await workspace.context.pages()[0]!.waitForFunction(() => document.body.dataset['attackComplete'] === 'yes', null, { timeout: 5000 });
      expect(f.requests.filter(request => request.path === '/target/sign-in' && request.method === 'POST')).toHaveLength(1);
      expect(f.writes()).toBe(0); expect(f.requests.filter(request => request.path === '/target/write')).toHaveLength(0);
      expect(workspace.takeDenials().map(denial => denial.method).sort()).toEqual(['DELETE', 'PATCH', 'POST', 'PUT']);
    } finally { await close(f.browser, f.server); }
  }, 60_000);
  it('refuses reflected credentials before screenshot capture in an authenticated workspace', async () => {
    const f = await fixture();
    try {
      const workspace = await f.browser.create({ runId: 'reflected-secret-run', policy: { allowedOrigins: [f.origin] }, timeoutMs: 10_000 });
      const credential = await f.held.credentials.resolve(REF_A, 1000);
      expect((await f.browser.perform(workspace.ref, { action: 'navigate', destination: f.origin, credential }, 10_000)).session).toBe(true);
      const screenshot = vi.spyOn(workspace.context.pages()[0]!, 'screenshot');
      await expect(f.browser.perform(workspace.ref, { action: 'navigate', destination: f.origin + '/reflected-secret', credential: null, capture: ['structural-snapshot','screenshot'] }, 10_000, f.held.guard)).rejects.toMatchObject({ code: 'contract' });
      expect(screenshot).not.toHaveBeenCalled(); screenshot.mockRestore(); expect(f.writes()).toBe(0);
      await expect(f.browser.perform(workspace.ref, { action: 'read-attribute', destination: f.origin + '/reflected-secret', credential: null, capture: ['structural-snapshot'] }, 1000)).rejects.toMatchObject({ code: 'contract' });
    } finally { await close(f.browser, f.server); }
  }, 60_000);
});
