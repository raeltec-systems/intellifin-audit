import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { NO_CREDENTIALS } from '@intellifin/application';
import { parseWebTree, WEB_TREE_MEDIA_TYPE } from '@intellifin/domain';
import { PlaywrightBrowserExecution } from '@intellifin/infrastructure/browser';
import { resolvedCredential } from '@intellifin/infrastructure/credentials';

/**
 * Real browser coverage for the platform capture seam (Story 4.4).
 *
 * The server below is deliberately local HTML, rather than a Northstar fixture import: the
 * assertion is that the browser resolves a real form and reads its rendered result. CI has
 * the Chromium binary; a local checkout without the isolated integration environment skips
 * this file in the same way as the other browser workspace integration.
 */
const databaseUrl = process.env.DATABASE_URL;

interface RequestRecord {
  readonly method: string;
  readonly url: string;
}

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

function html(response: ServerResponse, body: string, status = 200): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><body>${body}</body></html>`);
}

describe.skipIf(!databaseUrl)('real browser web-tree capture', () => {
  it('types approved values into the exact labelled GET form and captures the final result', async () => {
    const requests: RequestRecord[] = [];
    const { server, origin } = await listen((request, response) => {
      requests.push({ method: request.method ?? '', url: request.url ?? '' });
      if (request.url?.startsWith('/target/search')) {
        html(response, `
          <p id="result-summary">Showing 1 of 1 matching accounts.</p>
          <table>
            <tr><th>Employee ID</th><th>Full name</th><th>Status</th></tr>
            <tr><td>E-000105</td><td>Esther Kabwe</td><td>Disabled</td></tr>
          </table>
          <dl><dt>Username</dt><dd>e.kabwe</dd><dt>Roles</dt><dd><ul><li>COLLECTIONS_AGENT</li></ul></dd></dl>
        `);
        return;
      }
      html(response, `
        <form method="get" action="/target/search">
          <label for="employee-id">Employee ID</label>
          <input id="employee-id" name="employee_id" type="text">
          <label for="full-name">Full name</label>
          <input id="full-name" name="name" type="text">
          <button type="submit">Search</button>
        </form>
      `);
    });
    const browser = new PlaywrightBrowserExecution({ mode: 'local' });
    try {
      const workspace = await browser.create({
        runId: 'web-tree-search-test',
        policy: { allowedOrigins: [origin] },
        timeoutMs: 10_000,
      });
      const result = await browser.perform(
        workspace.ref,
        {
          action: 'search',
          destination: origin,
          parameters: [
            { name: 'employee_id', value: 'E-000105' },
            { name: 'name', value: 'Esther Kabwe' },
          ],
          credential: null,
          capture: ['structural-snapshot', 'screenshot'],
        },
        10_000,
        NO_CREDENTIALS,
      );

      expect(result.status).toBe(200);
      expect(result.method).toBe('GET');
      expect(result.location).toBe(`${origin}/search`);
      expect(result.redirected).toBe(false);
      expect(requests.map((entry) => `${entry.method} ${entry.url}`)).toEqual([
        'GET /target',
        'GET /target/search?employee_id=E-000105&name=Esther+Kabwe',
      ]);

      const artifacts = result.artifacts ?? [];
      expect(artifacts.map((artifact) => artifact.kind)).toEqual(['structural-snapshot', 'screenshot']);
      const snapshot = artifacts.find((artifact) => artifact.kind === 'structural-snapshot');
      const screenshot = artifacts.find((artifact) => artifact.kind === 'screenshot');
      expect(snapshot).toMatchObject({ mediaType: WEB_TREE_MEDIA_TYPE, location: `${origin}/search` });
      expect(screenshot).toMatchObject({ mediaType: 'image/png', location: `${origin}/search` });
      expect(screenshot?.bytes.slice(0, 8)).toEqual(
        Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );

      const document = parseWebTree(new TextDecoder().decode(snapshot!.bytes));
      expect(document).not.toBeNull();
      expect(document?.completion).toEqual({ complete: true, returned: 1 });
      expect(document?.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ group: 'table:0:row:0', role: 'datum', label: 'Employee ID', value: 'E-000105' }),
        expect.objectContaining({ group: 'table:0:row:0', role: 'datum', label: 'Status', value: 'Disabled' }),
        expect.objectContaining({ group: 'record:0', role: 'datum', label: 'Username', value: 'e.kabwe' }),
        expect.objectContaining({ group: 'record:0', role: 'datum', label: 'Roles', value: ['COLLECTIONS_AGENT'] }),
      ]));
    } finally {
      await browser.close();
      await closeServer(server);
    }
  }, 60_000);

  it('rejects a password surface and a secret-bearing rendered page before screenshot', async () => {
    const secret = 'synthetic-browser-secret-never-capture';
    let visits = 0;
    const { server, origin } = await listen((_request, response) => {
      visits += 1;
      html(response, visits === 1
        ? `<input type="password" aria-label="Password" value="${secret}"><p>Account data</p>`
        : `<p>${secret}</p>`);
    });
    const browser = new PlaywrightBrowserExecution({ mode: 'local' });
    try {
      const workspace = await browser.create({
        runId: 'web-tree-password-test',
        policy: { allowedOrigins: [origin] },
        timeoutMs: 10_000,
      });
      await expect(browser.perform(
        workspace.ref,
        {
          action: 'navigate',
          destination: origin,
          credential: null,
          capture: ['structural-snapshot', 'screenshot'],
        },
        10_000,
        NO_CREDENTIALS,
      )).rejects.toMatchObject({ code: 'contract' });

      const held = resolvedCredential('cred://synthetic/browser-capture', secret);
      const guard = {
        held: 1,
        discloses: (bytes: Uint8Array) => held.discloses(bytes),
        redact: (text: string) => held.redact(text),
      };
      // The first navigation is refused on the password surface. A second real navigation
      // returns ordinary visible text, which the held guard must reject before screenshot.
      await expect(browser.perform(
        workspace.ref,
        {
          action: 'navigate',
          destination: origin,
          credential: null,
          capture: ['structural-snapshot', 'screenshot'],
        },
        10_000,
        guard,
      )).rejects.toMatchObject({ code: 'contract' });
    } finally {
      await browser.close();
      await closeServer(server);
    }
  }, 60_000);

  it('refuses a POST search form before typing or sending it', async () => {
    let submissions = 0;
    const { server, origin } = await listen((request, response) => {
      if (request.method === 'POST') submissions += 1;
      html(response, `
        <form method="post" action="/target/search">
          <label for="employee-id">Employee ID</label>
          <input id="employee-id" name="employee_id" type="text">
          <button type="submit">Search</button>
        </form>
      `);
    });
    const browser = new PlaywrightBrowserExecution({ mode: 'local' });
    try {
      const workspace = await browser.create({
        runId: 'web-tree-post-search-test',
        policy: { allowedOrigins: [origin] },
        timeoutMs: 10_000,
      });
      await expect(browser.perform(
        workspace.ref,
        {
          action: 'search',
          destination: origin,
          parameters: [{ name: 'employee_id', value: 'E-000105' }],
          credential: null,
          capture: [],
        },
        10_000,
      )).rejects.toMatchObject({ code: 'scope' });
      expect(submissions).toBe(0);
    } finally {
      await browser.close();
      await closeServer(server);
    }
  }, 60_000);

  it('binds a search redirect to its selected target even when another target is allowed', async () => {
    let otherTargetRequests = 0;
    const { server, origin } = await listen((request, response) => {
      if (request.url === '/other/result') {
        otherTargetRequests += 1;
        html(response, '<p>redirected target</p>');
        return;
      }
      if (request.url?.startsWith('/target/search')) {
        response.writeHead(302, { location: '/other/result' });
        response.end();
        return;
      }
      html(response, `
        <form method="get" action="/target/search">
          <label for="employee-id">Employee ID</label>
          <input id="employee-id" name="employee_id" type="text">
          <button type="submit">Search</button>
        </form>
      `);
    });
    const browser = new PlaywrightBrowserExecution({ mode: 'local' });
    try {
      const workspace = await browser.create({
        runId: 'web-tree-redirect-test',
        policy: { allowedOrigins: [origin, origin.replace('/target', '/other')] },
        timeoutMs: 10_000,
      });
      await expect(browser.perform(
        workspace.ref,
        {
          action: 'search',
          destination: origin,
          parameters: [{ name: 'employee_id', value: 'E-000105' }],
          credential: null,
          capture: [],
        },
        10_000,
      )).rejects.toMatchObject({ code: 'scope' });
      expect(otherTargetRequests).toBe(1);
    } finally {
      await browser.close();
      await closeServer(server);
    }
  }, 60_000);
});
