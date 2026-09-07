import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { PlaywrightBrowserExecution } from '@intellifin/infrastructure/browser';
import { ManifestCredentialResolver } from '@intellifin/infrastructure/credentials';

const token = 'synthetic-authentication-regression';
const credentialRef = 'cred://synthetic/authentication-regression';
const marker = '<p role="status" aria-label="Current signed-in account">Signed in as audit.readonly</p>';

describe('actual browser authentication confirmation', () => {
  it.each(['unrelated', 'stale', 'rejected-session'] as const)('does not trust a %s cookie on a successful login page', async mode => {
    let submissions = 0;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.method === 'POST' && request.url === '/target/sign-in') {
          submissions += 1;
          expect(new URLSearchParams(Buffer.concat(chunks).toString()).get('credential')).toBe(token);
          response.writeHead(303, { location: '/target', 'set-cookie': 'session=granted; Path=/' });
          response.end();
          return;
        }
        const signedIn = mode !== 'rejected-session' && String(request.headers.cookie).includes('session=granted');
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><body>' + (signedIn ? marker : '<form method="post" action="/target/sign-in"><input type="password" name="credential"><button type="submit">Sign in</button></form>') + '</body>');
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/target`;
    const browser = new PlaywrightBrowserExecution({ mode: 'local' });
    try {
      const workspace = await browser.create({ runId: 'authentication-test', policy: { allowedOrigins: [origin] }, timeoutMs: 10000 });
      await workspace.context.addCookies([{ name: mode === 'unrelated' ? 'preferences' : 'session', value: 'stale', url: origin }]);
      const credential = await new ManifestCredentialResolver(new Map([[credentialRef, token]])).resolve(credentialRef, 1000);
      const action = { action: 'navigate' as const, destination: origin, parameters: {}, credential };
      const result = await browser.perform(workspace.ref, action, 10000);
      expect(submissions).toBe(1);
      expect(result.session).toBe(mode !== 'rejected-session');
      if (mode !== 'rejected-session') {
        expect((await browser.perform(workspace.ref, action, 10000)).session).toBe(true);
        expect(submissions).toBe(1);
      }
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
