import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectOutput,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import {
  PopulationAcquisitionError,
  type EvidenceStore,
} from '@intellifin/application';
import { sha256HexOfBytes } from '@intellifin/domain';

import type { EvidenceS3Config } from '../config.js';

/** Evidence reads are larger than a raw population because the application envelope
 * stores the original bytes as hex together with its declaration. */
export const EVIDENCE_STORE_MAX_BYTES = 40 * 1024 * 1024;

export interface S3EvidenceStoreOptions {
  readonly bucket: string;
  readonly client?: S3Client;
  readonly region?: string;
  readonly endpoint?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly forcePathStyle?: boolean;
  readonly maxBytes?: number;
}

function contractFailure(): PopulationAcquisitionError {
  return new PopulationAcquisitionError('contract');
}

function transportFailure(): PopulationAcquisitionError {
  return new PopulationAcquisitionError('transport');
}

function integrityFailure(): PopulationAcquisitionError {
  return new PopulationAcquisitionError('integrity');
}

function timeoutFailure(): PopulationAcquisitionError {
  return transportFailure();
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2 ** 31 - 1) {
    throw contractFailure();
  }
}

function validateKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > 1024 || key.startsWith('/')) {
    throw contractFailure();
  }
  const segments = key.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw contractFailure();
  }
}

function validateBytes(bytes: Uint8Array, maxBytes: number): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) throw contractFailure();
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as {
    readonly $metadata?: { readonly httpStatusCode?: unknown };
    readonly $response?: { readonly statusCode?: unknown };
    readonly statusCode?: unknown;
  };
  for (const value of [candidate.$metadata?.httpStatusCode, candidate.$response?.statusCode, candidate.statusCode]) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  return undefined;
}

function errorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as { readonly name?: unknown }).name;
  return typeof value === 'string' ? value : undefined;
}

function isMissing(error: unknown): boolean {
  const name = errorName(error);
  return statusCode(error) === 404 || name === 'NoSuchKey' || name === 'NotFound' || name === 'NoSuchBucket';
}

function isConditionalConflict(error: unknown): boolean {
  const name = errorName(error);
  const status = statusCode(error);
  return status === 409 || status === 412 || name === 'PreconditionFailed' || name === 'ConditionalRequestConflict';
}

function withDeadline(timeoutMs: number): {
  readonly signal: AbortSignal;
  readonly remaining: () => number;
  readonly dispose: () => void;
} {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    remaining: () => {
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining <= 0 || controller.signal.aborted) throw timeoutFailure();
      return remaining;
    },
    dispose: () => clearTimeout(timer),
  };
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

async function readBody(body: unknown, maxBytes: number): Promise<Uint8Array> {
  if (body === undefined || body === null) throw integrityFailure();
  const direct = toUint8Array(body);
  if (direct !== null) {
    if (direct.byteLength > maxBytes) throw integrityFailure();
    return new Uint8Array(direct);
  }

  if (typeof body === 'object' && body !== null && 'getReader' in body && typeof body.getReader === 'function') {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = toUint8Array(next.value);
        if (chunk === null) throw integrityFailure();
        total += chunk.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw integrityFailure();
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }

  if (typeof body === 'object' && body !== null && Symbol.asyncIterator in body) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const value of body as AsyncIterable<unknown>) {
      const chunk = toUint8Array(value);
      if (chunk === null) throw integrityFailure();
      total += chunk.byteLength;
      if (total > maxBytes) throw integrityFailure();
      chunks.push(chunk);
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }

  throw integrityFailure();
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

function verifiedSameBytes(expected: Uint8Array, actual: Uint8Array): boolean {
  return expected.byteLength === actual.byteLength && sha256HexOfBytes(expected) === sha256HexOfBytes(actual) && equalBytes(expected, actual);
}

function outputBody(output: GetObjectOutput): unknown {
  return output.Body;
}

function clientFrom(options: S3EvidenceStoreOptions): S3Client {
  if (options.client !== undefined) return options.client;
  if (options.region === undefined || options.endpoint === undefined || options.accessKeyId === undefined || options.secretAccessKey === undefined) {
    throw contractFailure();
  }
  const config: S3ClientConfig = {
    region: options.region,
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle ?? true,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  };
  return new S3Client(config);
}

/**
 * Private S3-compatible Evidence storage. The client is deliberately a real AWS SDK
 * client even when the endpoint is Railway or a local S3-compatible contract server.
 */
export class S3EvidenceStore implements EvidenceStore {
  private readonly client: S3Client;
  private readonly maxBytes: number;

  constructor(private readonly options: S3EvidenceStoreOptions) {
    if (options.bucket.trim() === '') throw contractFailure();
    this.client = clientFrom(options);
    this.maxBytes = options.maxBytes ?? EVIDENCE_STORE_MAX_BYTES;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0 || this.maxBytes > EVIDENCE_STORE_MAX_BYTES) {
      throw contractFailure();
    }
  }

  async read(key: string, timeoutMs: number): Promise<Uint8Array | null> {
    validateKey(key);
    validateTimeout(timeoutMs);
    const deadline = withDeadline(timeoutMs);
    try {
      const output = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
        { abortSignal: deadline.signal },
      );
      const contentLength = output.ContentLength;
      if (contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength > this.maxBytes)) {
        throw integrityFailure();
      }
      const bytes = await readBody(outputBody(output), this.maxBytes);
      if (contentLength !== undefined && contentLength !== bytes.byteLength) throw integrityFailure();
      return bytes;
    } catch (error) {
      if (error instanceof PopulationAcquisitionError) throw error;
      if (isMissing(error)) return null;
      if (deadline.signal.aborted) throw timeoutFailure();
      throw transportFailure();
    } finally {
      deadline.dispose();
    }
  }

  async putIfAbsent(key: string, bytes: Uint8Array, timeoutMs: number): Promise<void> {
    validateKey(key);
    validateBytes(bytes, this.maxBytes);
    validateTimeout(timeoutMs);
    const deadline = withDeadline(timeoutMs);
    try {
      try {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.options.bucket,
            Key: key,
            Body: bytes,
            ContentLength: bytes.byteLength,
            IfNoneMatch: '*',
          }),
          { abortSignal: deadline.signal },
        );
      } catch (error) {
        if (!isConditionalConflict(error)) {
          if (deadline.signal.aborted) throw timeoutFailure();
          throw transportFailure();
        }
      }

      // A conditional conflict is expected during a retry. In both paths, fetch the
      // stored bytes and verify size and content before acknowledging the write.
      deadline.remaining();
      const stored = await this.readWithDeadline(key, deadline);
      if (stored === null || !verifiedSameBytes(bytes, stored)) throw integrityFailure();
    } catch (error) {
      if (error instanceof PopulationAcquisitionError) throw error;
      if (deadline.signal.aborted) throw timeoutFailure();
      throw transportFailure();
    } finally {
      deadline.dispose();
    }
  }

  private async readWithDeadline(key: string, deadline: ReturnType<typeof withDeadline>): Promise<Uint8Array | null> {
    try {
      const output = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
        { abortSignal: deadline.signal },
      );
      const contentLength = output.ContentLength;
      if (contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength > this.maxBytes)) {
        throw integrityFailure();
      }
      const bytes = await readBody(outputBody(output), this.maxBytes);
      if (contentLength !== undefined && contentLength !== bytes.byteLength) throw integrityFailure();
      return bytes;
    } catch (error) {
      if (error instanceof PopulationAcquisitionError) throw error;
      if (isMissing(error)) return null;
      if (deadline.signal.aborted) throw timeoutFailure();
      throw transportFailure();
    }
  }
}

/** Composition-root factory for the production S3-compatible Evidence backend. */
export function createS3EvidenceStore(config: EvidenceS3Config): S3EvidenceStore {
  return new S3EvidenceStore({
    bucket: config.bucket,
    region: config.region,
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    forcePathStyle: config.forcePathStyle,
  });
}
