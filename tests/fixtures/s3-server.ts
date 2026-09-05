import { createServer } from 'node:http';
import { once } from 'node:events';

/** Test-only HTTP storage surface. The worker still uses its real AWS SDK adapter. */
export async function startSyntheticS3() {
  const objects = new Map<string, Uint8Array>();
  const requests: { method: string; key: string; conditional: boolean }[] = [];
  let pendingHold: { suffix: string; entered: (key: string) => void; released: Promise<void>; release: () => void } | undefined;
  const server = createServer(async (request, response) => {
    const reply = (status: number, bytes: Uint8Array = new Uint8Array()) => {
      response.writeHead(status, { 'content-length': bytes.length });
      response.end(Buffer.from(bytes));
    };
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (!path.startsWith('/evidence/')) { reply(404); return; }
      const key = decodeURIComponent(path.slice('/evidence/'.length));
      const conditional = request.headers['if-none-match'] === '*';
      requests.push({ method: request.method ?? '', key, conditional });
      if (request.method === 'PUT') {
        if (!conditional) { reply(428); return; }
        const chunks: Buffer[] = []; let length = 0;
        for await (const chunk of request) {
          const bytes = Buffer.from(chunk); length += bytes.length;
          if (length > 40 * 1024 * 1024) { reply(413); return; }
          chunks.push(bytes);
        }
        if (objects.has(key)) { reply(412); return; }
        objects.set(key, new Uint8Array(Buffer.concat(chunks)));
        const hold = pendingHold;
        if (hold && key.endsWith(hold.suffix)) {
          pendingHold = undefined;
          hold.entered(key);
          await hold.released;
        }
        reply(200); return;
      }
      if (request.method === 'GET') {
        const bytes = objects.get(key);
        if (bytes) reply(200, bytes); else reply(404);
        return;
      }
      reply(405);
    } catch { if (!response.headersSent) reply(500); else response.end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic storage did not bind.');
  return {
    env: {
      EVIDENCE_S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
      EVIDENCE_S3_REGION: 'us-east-1', EVIDENCE_S3_BUCKET: 'evidence',
      EVIDENCE_S3_ACCESS_KEY_ID: 'synthetic', EVIDENCE_S3_SECRET_ACCESS_KEY: 'synthetic-test-only',
      EVIDENCE_S3_FORCE_PATH_STYLE: 'true',
    },
    objects, requests,
    holdNextPut(suffix: string) {
      if (pendingHold) throw new Error('An object response is already held.');
      let entered!: (key: string) => void;
      let release!: () => void;
      const stored = new Promise<string>(resolve => { entered = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      pendingHold = { suffix, entered, released, release };
      return { stored, release };
    },
    async close() {
      pendingHold?.release();
      const closed = once(server, 'close');
      server.close(); server.closeAllConnections();
      await closed;
    },
  };
}
