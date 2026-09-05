import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';

import { S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PopulationAcquisitionError } from '@intellifin/application';

import {
  EVIDENCE_STORE_MAX_BYTES,
  S3EvidenceStore,
} from './s3-evidence-store.js';

const objects = new Map<string, Uint8Array>();
const requests: Array<{ method: string; path: string; ifNoneMatch: string | undefined }> = [];
let server: ReturnType<typeof createServer>;
let endpoint: string;

async function body(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(chunks));
}

function keyFrom(request: IncomingMessage): string {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const prefix = '/evidence/';
  return decodeURIComponent(pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname.slice(1));
}

function respond(response: ServerResponse, statusCode: number, bytes: Uint8Array = new Uint8Array()): void {
  response.statusCode = statusCode;
  response.setHeader('content-length', String(bytes.byteLength));
  response.end(Buffer.from(bytes));
}

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const key = keyFrom(request);
    requests.push({ method: request.method ?? '', path: key, ifNoneMatch: request.headers['if-none-match'] });
    if (request.method === 'PUT') {
      if (request.headers['if-none-match'] === '*' && objects.has(key)) {
        respond(response, 412);
        return;
      }
      objects.set(key, await body(request));
      respond(response, 200);
      return;
    }
    if (request.method === 'GET') {
      const bytes = objects.get(key);
      if (bytes === undefined) {
        respond(response, 404);
        return;
      }
      respond(response, 200, bytes);
      return;
    }
    respond(response, 405);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('test server did not bind');
  endpoint = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.close();
  await once(server, 'close');
});

function store(maxBytes = EVIDENCE_STORE_MAX_BYTES): S3EvidenceStore {
  return new S3EvidenceStore({
    bucket: 'evidence',
    maxBytes,
    client: new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'synthetic', secretAccessKey: 'synthetic-secret' },
    }),
  });
}

describe('S3EvidenceStore', () => {
  it('uses a conditional PUT and verifies the bytes with a GET', async () => {
    const bytes = new TextEncoder().encode('immutable evidence');
    await store().putIfAbsent('population/raw', bytes, 5000);
    const relevant = requests.filter((request) => request.path === 'population/raw');
    expect(relevant.map((request) => request.method)).toEqual(['PUT', 'GET']);
    expect(relevant[0]?.ifNoneMatch).toBe('*');
    expect(await store().read('population/raw', 5000)).toEqual(bytes);
  });

  it('reconciles an existing object and refuses a mismatched retry', async () => {
    const original = new TextEncoder().encode('original');
    await store().putIfAbsent('population/existing', original, 5000);
    await expect(store().putIfAbsent('population/existing', new TextEncoder().encode('changed'), 5000))
      .rejects.toMatchObject({ code: 'integrity' });
    const relevant = requests.filter((request) => request.path === 'population/existing');
    expect(relevant.map((request) => request.method)).toEqual(['PUT', 'GET', 'PUT', 'GET']);
  });

  it('returns null for a missing object and refuses an oversized response', async () => {
    expect(await store().read('population/missing', 5000)).toBeNull();
    objects.set('population/large', new Uint8Array([1, 2, 3, 4]));
    await expect(store(3).read('population/large', 5000))
      .rejects.toMatchObject({ code: 'integrity' });
    expect(EVIDENCE_STORE_MAX_BYTES).toBe(40 * 1024 * 1024);
  });

  it('does not expose provider errors or object keys in failures', async () => {
    const error = await store().read('../private-secret', 5000).catch((value) => value);
    expect(error).toBeInstanceOf(PopulationAcquisitionError);
    expect(String(error)).not.toContain('private-secret');
  });
});
