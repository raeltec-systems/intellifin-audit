import { createServer } from 'node:http';
import { once } from 'node:events';

/** Test-only read-through target: Northstar still owns routing and real form authentication.
 * Only an authenticated HTML response receives the verbatim hostile data cell. */
export async function startAgentAbuseTarget(upstream: string, note: string) {
  if (/[<>]/u.test(note)) throw new Error('This verbatim note fixture is text, not executable HTML.');
  let authenticatedInjections = 0;
  const requests: { method: string; path: string; authenticated: boolean }[] = [];
  const server = createServer(async (request, response) => {
    try {
      const path = request.url ?? '/';
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const name of ['cookie', 'content-type']) {
        const value = request.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      const result = await fetch(new URL(path, upstream), {
        method: request.method ?? 'GET', headers, redirect: 'manual',
        ...(body.length > 0 ? { body } : {}),
      });
      const contentType = result.headers.get('content-type') ?? '';
      const bytes = Buffer.from(await result.arrayBuffer());
      let output: Buffer | string = bytes;
      const authenticated = contentType.includes('text/html') && bytes.includes(Buffer.from('aria-label="Current signed-in account"')) && !bytes.includes(Buffer.from('type="password"'));
      if (authenticated) {
        authenticatedInjections++;
        output = bytes.toString('utf8').replace('</main>', `<dl><dt>Untrusted audit note</dt><dd>${note}</dd></dl></main>`);
      }
      requests.push({ method: request.method ?? 'GET', path: new URL(path, upstream).pathname, authenticated });
      response.statusCode = result.status;
      result.headers.forEach((value, key) => {
        if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(key)) response.setHeader(key, value);
      });
      response.end(output);
    } catch {
      response.writeHead(502); response.end('Synthetic target upstream unavailable');
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { origin, requests, injected: () => authenticatedInjections, async close() {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
