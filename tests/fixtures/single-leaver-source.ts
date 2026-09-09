import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

/** An independently declared single-case source keeps the golden row unchanged while
 * allowing its isolated-case expectation to be tested. The complete golden source's
 * unrelated missing dates/duplicate keys remain unchanged and must still fail its Gate. */
export async function startCanonicalLeaverSource(recordKey: string, options: { readonly terminationTime?: boolean } = {}) {
  if (!/^E-[0-9]{6}$/.test(recordKey)) throw new Error('Canonical leaver key is malformed.');
  const generated = JSON.parse(execFileSync('python3', [
    fileURLToPath(new URL('./generate-single-leaver-source.py', import.meta.url)), recordKey,
    ...(options.terminationTime ? ['with-termination-time'] : []),
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })) as {
    csv: string; cover: { row_count: number; content_digest: { value: string } };
    row: Record<string, string>; schema: string[]; period: { from: string; to: string };
  };
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://synthetic.invalid').pathname;
    requests.push(`${request.method ?? ''} ${path}`);
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    const body = path === '/single-leaver.csv' ? generated.csv : path === '/single-leaver.cover-sheet.json' ? JSON.stringify(generated.cover) : null;
    if (body === null) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': path.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/json', 'content-length': Buffer.byteLength(body) });
    response.end(body);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Single-case source could not bind.');
  return {
    ...generated, location: `http://127.0.0.1:${address.port}/single-leaver.csv`, requests,
    async close() { const ended = once(server, 'close'); server.close(); server.closeAllConnections(); await ended; },
  };
}
