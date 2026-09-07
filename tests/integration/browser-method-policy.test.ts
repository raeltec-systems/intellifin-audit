import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { PlaywrightBrowserExecution } from '@intellifin/infrastructure/browser';
import { ManifestCredentialResolver } from '@intellifin/infrastructure/credentials';

const TOKEN = 'synthetic-agent-isolation-password';
const CREDENTIAL_REF = 'cred://synthetic/agent-isolation';

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ readonly server: Server; readonly origin: string }> {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('test server did not bind');
  return { server, origin: `http://127.0.0.1:${String(address.port)}/target` };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('agent workspace page isolation', () => {
  it('blocks page-script POST writes while allowing the fresh approved form login', async () => {
    let writeRequests = 0;
    let authenticationPosts = 0;
    const requests: string[] = [];
    const { server, origin } = await listen((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const current = new URL(request.url ?? '/', 'http://127.0.0.1');
        const body = Buffer.concat(chunks).toString('utf8');
        requests.push(`${request.method ?? 'GET'} ${current.pathname}${current.search}`);

        if (request.method === 'POST' && current.pathname === '/target/write') {
          writeRequests += 1;
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('write reached');
          return;
        }

        if (request.method === 'POST' && current.pathname === '/target/sign-in') {
          authenticationPosts += 1;
          const form = new URLSearchParams(body);
          if (form.get('credential') !== TOKEN) {
            response.writeHead(401, { 'content-type': 'text/plain' });
            response.end('invalid credential');
            return;
          }
          response.writeHead(303, {
            location: '/target/home',
            'set-cookie': 'session=granted; Path=/; HttpOnly',
          });
          response.end();
          return;
        }

        const authenticated = String(request.headers.cookie ?? '').includes('session=granted');
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        if (!authenticated) {
          // Both requests are page-script attempts. The first targets a same-origin write
          // path; the second targets the auth path but is a fetch with no credential body.
          // The context route must reject both while the real form submit below succeeds.
          response.end(`<!doctype html><body>
            <form method="post" action="/target/sign-in">
              <input type="password" name="credential">
              <button type="submit">Sign in</button>
            </form>
            <script>
              void fetch('/target/write', { method: 'POST', body: 'write=from-script' }).catch(() => {});
              document.querySelector('button').addEventListener('click', () => {
                void fetch('/target/sign-in', { method: 'POST', body: 'credential=forged' }).catch(() => {});
              });
            </script>
          </body>`);
          return;
        }

        response.end(`<!doctype html><body>
          <p role="status" aria-label="Current signed-in account">Signed in as audit.readonly</p>
        </body>`);
      });
    });
    const browser = new PlaywrightBrowserExecution({ mode: 'local' });
    try {
      const workspace = await browser.create({
        runId: 'agent-isolation-test',
        policy: { allowedOrigins: [origin] },
        timeoutMs: 10_000,
      });
      const credential = await new ManifestCredentialResolver(
        new Map([[CREDENTIAL_REF, TOKEN]]),
      ).resolve(CREDENTIAL_REF, 1_000);
      const result = await browser.perform(
        workspace.ref,
        { action: 'navigate', destination: origin, parameters: [], credential },
        10_000,
      );

      expect(result).toMatchObject({ status: 200, method: 'POST', session: true });
      // Give the rejected fetch promises a turn to settle before checking the server log.
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(writeRequests).toBe(0);
      expect(authenticationPosts).toBe(1);
      expect(workspace.denied()).toBe(2);
      expect(requests).toEqual([
        'GET /target',
        'POST /target/sign-in',
        'GET /target/home',
      ]);
    } finally {
      await browser.close();
      await closeServer(server);
    }
  }, 60_000);

  it('uses an explicit submitter formaction when one is declared', async () => {
    let authenticationPath = '';
    const { server, origin } = await listen((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const current = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (request.method === 'POST' && current.pathname === '/target/submitter-sign-in') {
          authenticationPath = current.pathname;
          expect(new URLSearchParams(Buffer.concat(chunks).toString()).get('credential')).toBe(TOKEN);
          response.writeHead(303, {
            location: '/target/home',
            'set-cookie': 'session=granted; Path=/; HttpOnly',
          });
          response.end();
          return;
        }

        const authenticated = String(request.headers.cookie ?? '').includes('session=granted');
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(authenticated
          ? '<!doctype html><body><p role="status" aria-label="Current signed-in account">Signed in as audit.readonly</p></body>'
          : `<!doctype html><body>
            <form method="post" action="/target/sign-in">
              <input type="password" name="credential">
              <button type="submit" formaction="/target/submitter-sign-in">Sign in</button>
            </form>
          </body>`);
      });
    });
    const browser = new PlaywrightBrowserExecution({ mode: 'local' });
    try {
      const workspace = await browser.create({
        runId: 'agent-submit-button-override-test',
        policy: { allowedOrigins: [origin] },
        timeoutMs: 10_000,
      });
      const credential = await new ManifestCredentialResolver(
        new Map([[CREDENTIAL_REF, TOKEN]]),
      ).resolve(CREDENTIAL_REF, 1_000);
      const result = await browser.perform(
        workspace.ref,
        { action: 'navigate', destination: origin, parameters: [], credential },
        10_000,
      );

      expect(result).toMatchObject({ status: 200, method: 'POST', session: true });
      expect(authenticationPath).toBe('/target/submitter-sign-in');
    } finally {
      await browser.close();
      await closeServer(server);
    }
  }, 60_000);
});
