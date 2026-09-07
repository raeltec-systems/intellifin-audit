import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { PlaywrightBrowserExecution } from '@intellifin/infrastructure/browser';
import { ManifestCredentialResolver } from '@intellifin/infrastructure/credentials';

const token = 'synthetic-authentication-regression';
const credentialRef = 'cred://synthetic/authentication-regression';
const marker = '<p role="status" aria-label="Current signed-in account">Signed in as audit.readonly</p>';

describe('actual browser authentication confirmation', () => {
  it.each(['fresh', 'existing-session', 'unrelated', 'stale', 'rejected-session', 'wrong-identity', 'extra-suffix', 'invalid-credentials'] as const)('confirms authentication only after the approved UI for a %s cookie', async mode => {
    let submissions = 0;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.method === 'POST' && request.url === '/target/sign-in') {
          submissions += 1;
          const body = new URLSearchParams(Buffer.concat(chunks).toString());
          expect(body.get('credential')).toBe(token);
          if (mode === 'invalid-credentials') {
            response.writeHead(401, { 'content-type': 'text/html' });
            response.end('<!doctype html><body><form method="post" action="/target/sign-in"><input type="password" name="credential"><button type="submit">Sign in</button></form></body>');
            return;
          }
          response.writeHead(303, { location: '/target', 'set-cookie': 'session=granted; Path=/' });
          response.end();
          return;
        }
        const signedIn = mode !== 'rejected-session' && String(request.headers.cookie).includes('session=granted');
        const page = mode === 'wrong-identity'
          ? '<p role="status" aria-label="Current signed-in account">Signed in as another.account</p>'
          : mode === 'extra-suffix'
            ? '<p role="status" aria-label="Current signed-in account">Signed in as audit.readonly (administrator)</p>'
            : marker;
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><body>' + (signedIn ? page : '<form method="post" action="/target/sign-in"><input type="password" name="credential"><button type="submit">Sign in</button></form>') + '</body>');
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/target`;
    const browser = new PlaywrightBrowserExecution({ mode: 'local' });
    try {
      const workspace = await browser.create({ runId: 'authentication-test', policy: { allowedOrigins: [origin] }, timeoutMs: 10000 });
      if (mode !== 'fresh') {
        await workspace.context.addCookies([{ name: mode === 'unrelated' ? 'preferences' : 'session', value: mode === 'existing-session' ? 'granted' : 'stale', url: origin }]);
      }
      const credential = await new ManifestCredentialResolver(new Map([[credentialRef, token]])).resolve(credentialRef, 1000);
      const action = { action: 'navigate' as const, destination: origin, parameters: {}, credential };
      const result = await browser.perform(workspace.ref, action, 10000);
      const authenticated = mode === 'fresh' || mode === 'existing-session' || mode === 'unrelated' || mode === 'stale';
      expect(submissions).toBe(mode === 'existing-session' ? 0 : 1);
      expect(result.session).toBe(authenticated);
      if (mode === 'invalid-credentials') expect(result.status).toBe(401);
      if (mode === 'invalid-credentials') {
        const [page] = workspace.context.pages();
        expect(page).toBeDefined();
        expect(await page!.content()).not.toContain(token);
        expect(await page!.locator('input[type="password"]').inputValue()).toBe('');
      }
      if (mode === 'fresh' || mode === 'existing-session' || mode === 'unrelated' || mode === 'stale') {
        expect((await browser.perform(workspace.ref, action, 10000)).session).toBe(true);
        expect(submissions).toBe(mode === 'existing-session' ? 0 : 1);
      }
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('discards a page when submission fails before navigation, so its credential cannot be captured later', async () => {
    let submissionBody = '';
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.method === 'POST' && request.url === '/target/sign-in') {
          submissionBody = Buffer.concat(chunks).toString();
          response.destroy();
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><body><form method="post" action="/target/sign-in"><input type="password" name="credential"><button type="submit">Sign in</button></form></body>');
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/target`;
    const browser = new PlaywrightBrowserExecution({ mode: 'local' });
    try {
      const workspace = await browser.create({ runId: 'authentication-failure-test', policy: { allowedOrigins: [origin] }, timeoutMs: 10000 });
      const credential = await new ManifestCredentialResolver(new Map([[credentialRef, token]])).resolve(credentialRef, 1000);
      const action = { action: 'navigate' as const, destination: origin, parameters: {}, credential };
      await expect(browser.perform(workspace.ref, action, 1000)).rejects.toMatchObject({ code: 'unavailable' });
      expect(new URLSearchParams(submissionBody).get('credential')).toBe(token);

      // The failed page is closed before the workspace can be reused. If a provider refused
      // to close it, the fallback still closes the context/browser; either way no open page may
      // retain a live password field for a later capture.
      const pages = workspace.context.pages();
      expect(pages).toHaveLength(0);
      expect(await browser.attach(workspace.ref)).not.toBeNull();
      for (const page of pages) {
        expect(await page.content()).not.toContain(token);
        const fields = page.locator('input[type="password"]');
        for (let index = 0; index < await fields.count(); index += 1) {
          expect(await fields.nth(index).inputValue()).not.toBe(token);
        }
      }
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('rejects authentication that redirects into another configured target', async () => {
    let submissions = 0;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.method === 'POST' && request.url === '/target-a/sign-in') {
          submissions += 1;
          expect(new URLSearchParams(Buffer.concat(chunks).toString()).get('credential')).toBe(token);
          response.writeHead(303, { location: '/target-b', 'set-cookie': 'session=granted; Path=/' });
          response.end();
          return;
        }
        const body = request.url === '/target-b'
          ? '<p role="status" aria-label="Current signed-in account">Signed in as audit.readonly</p>'
          : '<form method="post" action="/target-a/sign-in"><input type="password" name="credential"><button type="submit">Sign in</button></form>';
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(`<!doctype html><body>${body}</body>`);
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const targetA = `http://127.0.0.1:${port}/target-a`;
    const targetB = `http://127.0.0.1:${port}/target-b`;
    const browser = new PlaywrightBrowserExecution({ mode: 'local' });
    try {
      const workspace = await browser.create({ runId: 'authentication-redirect-test', policy: { allowedOrigins: [targetA, targetB] }, timeoutMs: 10000 });
      const credential = await new ManifestCredentialResolver(new Map([[credentialRef, token]])).resolve(credentialRef, 1000);
      const action = { action: 'navigate' as const, destination: targetA, parameters: {}, credential };
      await expect(browser.perform(workspace.ref, action, 1000)).rejects.toMatchObject({ code: 'scope' });
      expect(submissions).toBe(1);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
