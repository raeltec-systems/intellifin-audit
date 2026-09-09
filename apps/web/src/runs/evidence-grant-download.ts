import type {
  EvidenceReadIntegrityMismatch,
  EvidenceReadGrantCapability,
  EvidenceReadGrantRepository,
} from '@intellifin/application';
import { sha256HexOfBytes, WEB_TREE_LIMITS } from '@intellifin/domain';

/** The largest artifact the web server will ever buffer through a grant. */
export const EVIDENCE_READ_MAX_BYTES = WEB_TREE_LIMITS.bytes;

/**
 * Why a server-side grant consumption did not yield bytes. Values are platform vocabulary;
 * the readers that parse the bytes add their own codes on top of these.
 *
 * The list is DATA and the type is derived from it, so a caller that has to answer every
 * one of them — the frames route's status table — can be checked against the vocabulary
 * itself rather than against a copy of its own definition.
 */
export const EVIDENCE_GRANT_DOWNLOAD_FAILURES = [
  'grant-unavailable',
  'capability-mismatch',
  'download-failed',
  'download-object-missing',
  'download-redirected',
  'download-media-type-mismatch',
  'download-too-large',
  'download-size-mismatch',
  'download-digest-mismatch',
  'access-denied',
] as const;

export type EvidenceGrantDownloadFailure = (typeof EVIDENCE_GRANT_DOWNLOAD_FAILURES)[number];

export interface GrantDownloadInput {
  readonly grantId: string;
  readonly runId: string;
  readonly evidenceId: string;
  readonly actorId: string;
  readonly locator: string;
  readonly correlationId: string;
  readonly maxGrantWaitMs?: number;
  readonly pollIntervalMs?: number;
  readonly fetchTimeoutMs?: number;
}

export interface GrantDownloadEnvironment {
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly fetch?: typeof fetch;
  /**
   * Reuse the application's canonical integrity outcome path when bytes disagree with
   * registered metadata. The callback receives digests and sizes only; infrastructure
   * resolves the object identity and decides the active-versus-sealed consequence.
   */
  readonly reportIntegrityMismatch?: (input: EvidenceReadIntegrityMismatch) => Promise<void>;
}

export type GrantDownloadResult =
  | { readonly bytes: Uint8Array; readonly capability: EvidenceReadGrantCapability; readonly failure: null }
  | { readonly bytes: null; readonly capability: null; readonly failure: EvidenceGrantDownloadFailure };

function instant(value: Date): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function safeCapabilityUrl(value: string): boolean {
  if (value.length === 0 || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === '' && url.hash === '' && url.hostname !== '';
  } catch {
    return false;
  }
}

function validCapability(capability: EvidenceReadGrantCapability, input: GrantDownloadInput, now: string): boolean {
  return capability.grantId === input.grantId && capability.runId === input.runId && capability.evidenceId === input.evidenceId &&
    capability.actorId === input.actorId && capability.locator === input.locator && safeCapabilityUrl(capability.signedUrl) &&
    Number.isSafeInteger(capability.size) && capability.size >= 0 && capability.size <= EVIDENCE_READ_MAX_BYTES &&
    /^[0-9a-f]{64}$/.test(capability.digest) && typeof capability.mediaType === 'string' && capability.mediaType.length > 0 &&
    instant(new Date(capability.signedUrlExpiresAt)) === capability.signedUrlExpiresAt && Date.parse(capability.signedUrlExpiresAt) > Date.parse(now);
}

async function readResponseBody(response: Response): Promise<Uint8Array | EvidenceGrantDownloadFailure> {
  if (response.body !== null) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        const chunk = part.value;
        total += chunk.byteLength;
        if (total > EVIDENCE_READ_MAX_BYTES) {
          await reader.cancel();
          return 'download-too-large';
        }
        chunks.push(chunk);
      }
    } catch {
      return 'download-failed';
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  try {
    const value = new Uint8Array(await response.arrayBuffer());
    return value.byteLength > EVIDENCE_READ_MAX_BYTES ? 'download-too-large' : value;
  } catch {
    return 'download-failed';
  }
}

/** The media type without its parameters, lower-cased, for comparison. */
export function contentTypeBase(value: string): string {
  return value.split(';', 1)[0]!.trim().toLowerCase();
}

async function reportIntegrityMismatch(
  environment: GrantDownloadEnvironment,
  input: EvidenceReadIntegrityMismatch,
): Promise<void> {
  try {
    await environment.reportIntegrityMismatch?.(input);
  } catch {
    // The bytes still fail closed at this boundary. A reporting outage must not turn a
    // tampered response into rendered content or leak the reporter's error to the page.
  }
}

/**
 * Consume one capability entirely on the web server: wait for the worker to issue it,
 * check it names exactly this request, fetch the exact URL with no redirect, verify size
 * and SHA-256 against the registered metadata, record the access under the fresh role,
 * and return the verified bytes.
 *
 * ONE implementation for every artifact kind the web may read through a grant — the
 * Structural Snapshot cell inspector (Story 4.4) and the Live View frame (Story 5.3) —
 * because two copies would agree on every response anybody thought to try and diverge on
 * the first one nobody did. The signed URL is never returned, rendered, linked or logged.
 */
export async function downloadWithGrant(
  repository: Pick<EvidenceReadGrantRepository, 'readForActor' | 'recordAccess'>,
  input: GrantDownloadInput,
  environment: GrantDownloadEnvironment = {},
): Promise<GrantDownloadResult> {
  const failed = (failure: EvidenceGrantDownloadFailure): GrantDownloadResult => ({ bytes: null, capability: null, failure });
  const now = environment.now ?? (() => new Date());
  const sleep = environment.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const fetcher = environment.fetch ?? fetch;
  const maxWaitMs = input.maxGrantWaitMs ?? 2_000;
  const pollIntervalMs = input.pollIntervalMs ?? 50;
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 0 || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) return failed('grant-unavailable');

  const started = Date.now();
  let capability: EvidenceReadGrantCapability | null = null;
  while (Date.now() - started <= maxWaitMs) {
    const at = instant(now());
    if (at === null) return failed('grant-unavailable');
    capability = await repository.readForActor({ grantId: input.grantId, actorId: input.actorId, now: at });
    if (capability !== null) break;
    if (Date.now() - started >= maxWaitMs) break;
    await sleep(pollIntervalMs);
  }
  const at = instant(now());
  if (capability === null || at === null) return failed('grant-unavailable');
  if (!validCapability(capability, input, at)) return failed('capability-mismatch');

  const controller = new AbortController();
  const timeoutMs = input.fetchTimeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return failed('download-failed');
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(capability.signedUrl, { redirect: 'error', signal: controller.signal });
  } catch {
    clearTimeout(timer);
    return failed('download-failed');
  }
  let body: Uint8Array | EvidenceGrantDownloadFailure;
  try {
    if (response.url !== '' && response.url !== capability.signedUrl) return failed('download-redirected');
    if (response.status === 404) {
      await reportIntegrityMismatch(environment, {
        runId: input.runId,
        evidenceId: input.evidenceId,
        finding: 'object-missing',
        expectedDigest: capability.digest,
        observedDigest: null,
        expectedSize: capability.size,
        observedSize: null,
      });
      return failed('download-object-missing');
    }
    // A transient 5xx, timeout or signed-URL denial says nothing about the registered
    // bytes. Only a confirmed object-store 404 is an integrity fact.
    if (!response.ok) return failed('download-failed');
    const registeredMediaType = contentTypeBase(capability.mediaType);
    const responseMediaType = response.headers.get('content-type');
    if (responseMediaType !== null && contentTypeBase(responseMediaType) !== registeredMediaType) return failed('download-media-type-mismatch');
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
      const declaredSize = Number(contentLength);
      if (!/^[0-9]+$/.test(contentLength) || !Number.isSafeInteger(declaredSize)) return failed('download-size-mismatch');
      if (declaredSize !== capability.size) {
        await reportIntegrityMismatch(environment, {
          runId: input.runId,
          evidenceId: input.evidenceId,
          finding: 'size-mismatch',
          expectedDigest: capability.digest,
          // The header disagrees before the body is consumed, so there is no observed
          // digest to claim. The measured content length is still a bounded observed size.
          observedDigest: null,
          expectedSize: capability.size,
          observedSize: declaredSize,
        });
        return failed('download-size-mismatch');
      }
    }
    body = await readResponseBody(response);
  } catch {
    return failed('download-failed');
  } finally {
    clearTimeout(timer);
  }
  if (typeof body === 'string') return failed(body);
  const observedDigest = sha256HexOfBytes(body);
  if (body.byteLength !== capability.size) {
    await reportIntegrityMismatch(environment, {
      runId: input.runId,
      evidenceId: input.evidenceId,
      finding: 'size-mismatch',
      expectedDigest: capability.digest,
      observedDigest,
      expectedSize: capability.size,
      observedSize: body.byteLength,
    });
    return failed('download-size-mismatch');
  }
  if (observedDigest !== capability.digest) {
    await reportIntegrityMismatch(environment, {
      runId: input.runId,
      evidenceId: input.evidenceId,
      finding: 'digest-mismatch',
      expectedDigest: capability.digest,
      observedDigest,
      expectedSize: capability.size,
      observedSize: body.byteLength,
    });
    return failed('download-digest-mismatch');
  }

  // Bytes have been fetched and verified. Record the access before the caller parses
  // them, so an unreadable document still has an ID-only access audit rather than looking
  // like no read occurred — and so a role revoked meanwhile refuses the render.
  const accessedAt = instant(now());
  if (accessedAt === null || Date.parse(accessedAt) >= Date.parse(capability.signedUrlExpiresAt)) return failed('access-denied');
  const accessed = await repository.recordAccess({ grantId: input.grantId, actorId: input.actorId, correlationId: input.correlationId, at: accessedAt });
  if (!accessed) return failed('access-denied');
  return { bytes: body, capability, failure: null };
}
