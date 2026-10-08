import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { once } from 'node:events';

const bucket = 'fixture-bucket';
const maxObjectBytes = 10 * 1024 * 1024;
const healthPrefix = '__health/sentinel/';
const listResponse = '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>fixture-bucket</Name><Prefix>__health/sentinel/</Prefix><KeyCount>0</KeyCount><MaxKeys>1</MaxKeys><IsTruncated>false</IsTruncated></ListBucketResult>';

type HeldMethod = 'PUT' | 'GET';
type Fault = 'lost-put-ack' | 'corrupt-get' | 'missing-version' | 'missing-bucket';

interface StoredVersion {
  id: string;
  body: Buffer;
}

interface HoldGate {
  entered: Promise<void>;
  release: () => void;
  wait: Promise<void>;
  enter: () => void;
}

export interface EvidenceS3Stats {
  objects: number;
  puts: number;
  gets: number;
}

export interface EvidenceS3Fixture {
  endpoint: string;
  stats: () => EvidenceS3Stats;
  holdNext: (method: HeldMethod) => { entered: Promise<void>; release: () => void };
  faultNext: (fault: Fault) => void;
  close: () => Promise<void>;
}

class LocalEvidenceS3Fixture implements EvidenceS3Fixture {
  private readonly server: Server;
  private readonly versions = new Map<string, StoredVersion[]>();
  private readonly held = new Map<HeldMethod, HoldGate>();
  private readonly activeGates = new Set<HoldGate>();
  private readonly faults = new Map<Fault, number>();
  private nextVersion = 1;
  private putCount = 0;
  private getCount = 0;
  private closePromise?: Promise<void>;

  endpoint = '';

  constructor() {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server.headersTimeout = 5_000;
    this.server.requestTimeout = 20_000;
    this.server.keepAliveTimeout = 1_000;
    this.server.on('clientError', (_error, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
  }

  async start(): Promise<void> {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1' || address.port === 0) {
      await this.close();
      throw new Error('Evidence S3 fixture did not bind an owned numeric loopback listener.');
    }
    this.endpoint = `http://127.0.0.1:${address.port}`;
  }

  stats(): EvidenceS3Stats {
    return { objects: this.versions.size, puts: this.putCount, gets: this.getCount };
  }

  holdNext(method: HeldMethod): { entered: Promise<void>; release: () => void } {
    if (this.held.has(method)) throw new Error(`An evidence S3 ${method} hold is already pending.`);
    let entered!: () => void;
    let release!: () => void;
    let released = false;
    const enteredPromise = new Promise<void>((resolveEntered) => { entered = resolveEntered; });
    const wait = new Promise<void>((resolveRelease) => { release = resolveRelease; });
    const gate: HoldGate = {
      entered: enteredPromise,
      wait,
      enter: entered,
      release: () => {
        if (released) return;
        released = true;
        entered();
        release();
        this.activeGates.delete(gate);
        if (this.held.get(method) === gate) this.held.delete(method);
      },
    };
    this.held.set(method, gate);
    return { entered: enteredPromise, release: gate.release };
  }

  faultNext(fault: Fault): void {
    this.faults.set(fault, (this.faults.get(fault) ?? 0) + 1);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    for (const gate of [...this.activeGates, ...this.held.values()]) gate.release();
    this.closePromise = new Promise<void>((resolveClose, rejectClose) => {
      if (!this.server.listening) { resolveClose(); return; }
      this.server.close((error) => error ? rejectClose(error) : resolveClose());
      this.server.closeAllConnections();
    });
    return this.closePromise;
  }

  private consumeFault(fault: Fault): boolean {
    const count = this.faults.get(fault) ?? 0;
    if (count === 0) return false;
    if (count === 1) this.faults.delete(fault);
    else this.faults.set(fault, count - 1);
    return true;
  }

  private async hold(method: HeldMethod): Promise<void> {
    const gate = this.held.get(method);
    if (!gate) return;
    this.held.delete(method);
    this.activeGates.add(gate);
    const timeout = setTimeout(gate.release, 30_000);
    // The control promise is resolved before waiting so tests can deterministically
    // revoke authority while the API is blocked on this exact object request.
    gate.enter();
    try { await gate.wait; } finally { clearTimeout(timeout); this.activeGates.delete(gate); }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      let pathname: string;
      try { pathname = decodeURIComponent(url.pathname); } catch { respondError(response, 400, 'InvalidURI'); return; }
      if (url.origin !== 'http://127.0.0.1' || !pathname.startsWith(`/${bucket}`)) {
        respondError(response, 404, 'NoSuchBucket', request.method === 'HEAD'); return;
      }

      if (request.method === 'GET' && pathname === `/${bucket}`) {
        if (this.consumeFault('missing-bucket')) { respondError(response, 404, 'NoSuchBucket'); return; }
        if (!signed(request)) { respondError(response, 403, 'AccessDenied'); return; }
        if (url.searchParams.get('list-type') !== '2' || url.searchParams.get('prefix') !== healthPrefix ||
          url.searchParams.get('max-keys') !== '1') {
          respondError(response, 400, 'BadMaxKeys'); return;
        }
        respondXml(response, 200, listResponse);
        return;
      }

      const key = pathname.slice(`/${bucket}/`.length);
      if (!pathname.startsWith(`/${bucket}/`) || !validObjectKey(key)) {
        respondError(response, 404, 'NoSuchKey', request.method === 'HEAD'); return;
      }

      if (request.method === 'PUT') {
        this.putCount += 1;
        if (!signed(request) || url.search) { respondError(response, 403, 'AccessDenied'); return; }
        if (request.headers['if-none-match'] !== '*') { respondError(response, 400, 'MissingConditional'); return; }
        const body = await readBody(request);
        if (!body) { respondError(response, 413, 'EntityTooLarge'); return; }
        await this.hold('PUT');
        if (this.versions.has(key)) { respondError(response, 412, 'PreconditionFailed'); return; }
        const id = `v${this.nextVersion++}`;
        this.versions.set(key, [{ id, body }]);
        if (this.consumeFault('lost-put-ack')) { destroyResponse(response); return; }
        const missingVersion = this.consumeFault('missing-version');
        response.writeHead(200, {
          connection: 'close', 'content-length': '0', etag: `"etag-${id}"`,
          ...(missingVersion ? {} : { 'x-amz-version-id': id }),
        });
        response.end();
        return;
      }

      if (request.method === 'HEAD' || request.method === 'GET') {
        if (!signed(request)) { respondError(response, 403, 'AccessDenied'); return; }
        if (request.method === 'GET') this.getCount += 1;
        const versions = this.versions.get(key);
        if (!versions?.length) { respondError(response, 404, 'NoSuchKey', request.method === 'HEAD'); return; }
        const requestedVersion = url.searchParams.get('versionId');
        if (request.method === 'GET' && !requestedVersion) { respondError(response, 400, 'VersionIdRequired'); return; }
        const stored = requestedVersion ? versions.find((version) => version.id === requestedVersion) : versions.at(-1);
        if (!stored) { respondError(response, 404, 'NoSuchVersion', request.method === 'HEAD'); return; }
        if (request.method === 'GET') await this.hold('GET');
        const corrupt = request.method === 'GET' && this.consumeFault('corrupt-get');
        const missingVersion = this.consumeFault('missing-version');
        const body = corrupt && stored.body.length > 0
          ? Buffer.concat([Buffer.from([stored.body[0]! ^ 0xff]), stored.body.subarray(1)])
          : stored.body;
        response.writeHead(200, {
          connection: 'close', 'content-length': String(request.method === 'HEAD' ? stored.body.length : body.length),
          etag: `"etag-${stored.id}"`,
          ...(missingVersion ? {} : { 'x-amz-version-id': stored.id }),
        });
        response.end(request.method === 'HEAD' ? undefined : body);
        return;
      }

      respondError(response, 405, 'MethodNotAllowed');
    } catch {
      if (!response.headersSent) respondError(response, 500, 'InternalError');
      else destroyResponse(response);
    }
  }
}

export async function startEvidenceS3Fixture(): Promise<EvidenceS3Fixture> {
  const fixture = new LocalEvidenceS3Fixture();
  try {
    await fixture.start();
    return fixture;
  } catch (error) {
    await fixture.close();
    throw error;
  }
}

function validObjectKey(value: string): boolean {
  const match = /^evidence\/([A-Za-z0-9_-]{1,128})\/original$/.exec(value);
  return match !== null;
}

function signed(request: IncomingMessage): boolean {
  return request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ') ?? false;
}

async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let length = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (tooLarge) continue;
    length += bytes.length;
    if (length > maxObjectBytes) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(bytes);
  }
  return tooLarge ? undefined : Buffer.concat(chunks, length);
}

function respondXml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { connection: 'close', 'content-length': String(Buffer.byteLength(body)), 'content-type': 'application/xml' });
  response.end(body);
}

function respondError(response: ServerResponse, status: number, code: string, head = false): void {
  if (head) {
    response.writeHead(status, { connection: 'close', 'content-length': '0' });
    response.end();
    return;
  }
  respondXml(response, status, `<Error><Code>${code}</Code></Error>`);
}

function destroyResponse(response: ServerResponse): void {
  const socket: Socket | null = response.socket;
  if (socket) socket.destroy();
  else response.destroy();
}
