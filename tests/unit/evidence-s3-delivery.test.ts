import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FRAME_LOCATOR, type EvidenceReadGrantCapability } from '@intellifin/application';
import { sha256HexOfBytes } from '@intellifin/domain';
import { createS3EvidenceStore } from '../../packages/infrastructure/src/evidence/s3-evidence-store.js';
import { createS3EvidenceReadSigner } from '../../packages/infrastructure/src/evidence/s3-evidence-read-signer.js';
import { downloadWithGrant } from '../../apps/web/src/runs/evidence-grant-download.js';
import { readFrameWithGrant } from '../../apps/web/src/runs/evidence-frame-reader.js';

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a46kAAAAASUVORK5CYII=', 'base64'));
const SNAPSHOT_TYPE = 'application/vnd.intellifin.web-tree+json';
type Mode = 'normal' | 'wrong-type' | 'wrong-bytes' | 'wrong-size';
interface Stored { bytes: Uint8Array; mediaType: string; mode: Mode }
const objects = new Map<string, Stored>();
const requests: { key: string; method: string; responseType: string | null; signed: boolean }[] = [];
let server: ReturnType<typeof createServer>;
let endpoint: string;

async function body(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(chunks));
}
function reply(response: ServerResponse, status: number, bytes = new Uint8Array(), type = 'application/octet-stream'): void {
  response.writeHead(status, { 'content-type': type, 'content-length': String(bytes.length) });
  response.end(Buffer.from(bytes));
}

beforeAll(async () => {
  // The real SDK talks HTTP to this contract server. Unlike the old fixture, a GET
  // always declares a media type and preserves an object's generic stored metadata.
  server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const key = decodeURIComponent(url.pathname.replace(/^\/evidence\//, ''));
      const responseType = url.searchParams.get('response-content-type');
      const signed = url.searchParams.has('X-Amz-Signature');
      requests.push({ key, method: request.method ?? '', responseType, signed });
      if (request.method === 'PUT') {
        if (objects.has(key)) { reply(response, 412); return; }
        objects.set(key, { bytes: await body(request), mediaType: request.headers['content-type'] ?? 'application/octet-stream', mode: 'normal' });
        reply(response, 200); return;
      }
      const stored = objects.get(key);
      if (request.method !== 'GET') { reply(response, 405); return; }
      if (!stored) { reply(response, 404); return; }
      // A response override belongs to an authenticated/presigned request. The SDK
      // performs signing; this fixture does not pretend to verify SigV4 itself.
      if (responseType !== null && !signed) { reply(response, 403); return; }
      const bytes = stored.bytes.slice();
      if (stored.mode === 'wrong-bytes') bytes[0] = bytes[0]! ^ 1;
      const output = stored.mode === 'wrong-size' ? bytes.slice(1) : bytes;
      const type = stored.mode === 'wrong-type' ? 'text/html' : responseType ?? stored.mediaType;
      reply(response, 200, output, type);
    })().catch(() => reply(response, 500));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('S3 contract server did not bind');
  endpoint = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => { server.closeAllConnections(); server.close(); await once(server, 'close'); });

function config() {
  return { bucket: 'evidence', region: 'us-east-1', endpoint, forcePathStyle: true, accessKeyId: 'synthetic', secretAccessKey: 'synthetic-secret' };
}

async function prepared(bytes: Uint8Array, mediaType: string, locator: string = FRAME_LOCATOR) {
  const key = `historical/${randomUUID()}`;
  const store = createS3EvidenceStore(config());
  await store.putIfAbsent(key, bytes, 5000);
  // Pin the actual historical case: the artifact bytes exist, but its object metadata
  // is generic. A presigned response must not rewrite either that metadata or the bytes.
  const stored = objects.get(key)!; stored.mediaType = 'application/octet-stream';
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const signer = createS3EvidenceReadSigner(config());
  const signed = await signer.signGet({ bucketKey: key, expiresAt, responseMediaType: mediaType });
  const input = { grantId: randomUUID(), runId: randomUUID(), evidenceId: randomUUID(), actorId: 'synthetic-auditor', locator, correlationId: randomUUID(), maxGrantWaitMs: 0 };
  const capability: EvidenceReadGrantCapability = { ...input, ...signed, mediaType, digest: sha256HexOfBytes(bytes), size: bytes.length };
  let accessCount = 0;
  let allowed = true;
  const repository = {
    readForActor: async () => capability,
    recordAccess: async () => { accessCount += 1; return allowed; },
  };
  return { key, bytes, stored, store, input, capability, repository, accessCount: () => accessCount, revoke: () => { allowed = false; } };
}

describe('real S3 HTTP signing through the shared web Evidence reader', () => {
  it('reproduces the unsigned-response MIME failure, then reads historical PNG bytes with no rewrite', async () => {
    const f = await prepared(PNG, 'image/png');
    const ordinary = await fetch(`${endpoint}/evidence/${f.key}`);
    expect(ordinary.headers.get('content-type')).toBe('application/octet-stream');
    const beforeWrites = requests.filter(r => r.key === f.key && r.method === 'PUT').length;
    const result = await readFrameWithGrant(f.repository, f.input);
    expect(result.failure).toBeNull(); expect(result.frame?.bytes).toEqual(PNG);
    expect(result.frame?.mediaType).toBe('image/png'); expect(f.accessCount()).toBe(1);
    expect(requests.filter(r => r.key === f.key).at(-1)).toMatchObject({ method: 'GET', responseType: 'image/png', signed: true });
    expect(requests.filter(r => r.key === f.key && r.method === 'PUT')).toHaveLength(beforeWrites);
    expect(f.stored.mediaType).toBe('application/octet-stream'); expect(f.stored.bytes).toEqual(PNG);
  });

  it('delivers a structural snapshot using its registered vendor media type, not storage defaults', async () => {
    const bytes = new TextEncoder().encode('{"schemaVersion":1,"nodes":[]}');
    const f = await prepared(bytes, SNAPSHOT_TYPE, '$.nodes[0].value');
    const result = await downloadWithGrant(f.repository, f.input);
    expect(result.failure).toBeNull(); expect(result.bytes).toEqual(bytes);
    expect(result.capability?.mediaType).toBe(SNAPSHOT_TYPE); expect(f.accessCount()).toBe(1);
    expect(requests.filter(r => r.key === f.key).at(-1)).toMatchObject({ responseType: SNAPSHOT_TYPE, signed: true });
  });

  it.each([
    ['wrong-type', 'download-media-type-mismatch'],
    ['wrong-bytes', 'download-digest-mismatch'],
    ['wrong-size', 'download-size-mismatch'],
  ] as const)('still refuses %s from a correctly signed URL', async (mode, failure) => {
    const f = await prepared(PNG, 'image/png'); f.stored.mode = mode;
    const result = await readFrameWithGrant(f.repository, f.input);
    expect(result).toEqual({ frame: null, failure }); expect(f.accessCount()).toBe(0);
  });

  it('does not return otherwise valid PNG bytes after the viewer role is revoked', async () => {
    const f = await prepared(PNG, 'image/png'); f.revoke();
    expect(await readFrameWithGrant(f.repository, f.input)).toEqual({ frame: null, failure: 'access-denied' });
    expect(f.accessCount()).toBe(1);
  });
});
