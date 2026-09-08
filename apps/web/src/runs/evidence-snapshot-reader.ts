import {
  type EvidenceReadIntegrityMismatch,
  type EvidenceReadGrantCapability,
  type EvidenceReadGrantRepository,
} from '@intellifin/application';
import {
  parseSnapshotLocator,
  readSnapshotCell,
  readStructuralSnapshot,
  sha256HexOfBytes,
  snapshotSubstrateForMediaType,
  type SnapshotCell,
  WEB_TREE_LIMITS,
} from '@intellifin/domain';

const EVIDENCE_READ_MAX_BYTES = WEB_TREE_LIMITS.bytes;

/** Why a server-side snapshot read did not yield a cell. Values are platform vocabulary. */
export type EvidenceSnapshotReadFailure =
  | 'grant-unavailable'
  | 'capability-mismatch'
  | 'download-failed'
  | 'download-object-missing'
  | 'download-redirected'
  | 'download-media-type-mismatch'
  | 'download-too-large'
  | 'download-size-mismatch'
  | 'download-digest-mismatch'
  | 'access-denied'
  | 'snapshot-unreadable'
  | 'locator-malformed'
  | 'locator-unresolved';

export type EvidenceSnapshotReadResult =
  | { readonly cell: SnapshotCell; readonly failure: null }
  | { readonly cell: null; readonly failure: EvidenceSnapshotReadFailure };

export interface ReadSnapshotCellInput {
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

export interface SnapshotReadEnvironment {
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

function validCapability(capability: EvidenceReadGrantCapability, input: ReadSnapshotCellInput, now: string): boolean {
  return capability.grantId === input.grantId && capability.runId === input.runId && capability.evidenceId === input.evidenceId &&
    capability.actorId === input.actorId && capability.locator === input.locator && safeCapabilityUrl(capability.signedUrl) &&
    Number.isSafeInteger(capability.size) && capability.size >= 0 && capability.size <= EVIDENCE_READ_MAX_BYTES &&
    /^[0-9a-f]{64}$/.test(capability.digest) && typeof capability.mediaType === 'string' && capability.mediaType.length > 0 &&
    instant(new Date(capability.signedUrlExpiresAt)) === capability.signedUrlExpiresAt && Date.parse(capability.signedUrlExpiresAt) > Date.parse(now);
}

async function readResponseBody(response: Response): Promise<Uint8Array | EvidenceSnapshotReadFailure> {
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

function contentTypeBase(value: string): string {
  return value.split(';', 1)[0]!.trim().toLowerCase();
}

async function reportIntegrityMismatch(
  environment: SnapshotReadEnvironment,
  input: Parameters<NonNullable<SnapshotReadEnvironment['reportIntegrityMismatch']>>[0],
): Promise<void> {
  try {
    await environment.reportIntegrityMismatch?.(input);
  } catch {
    // The bytes still fail closed at this boundary. A reporting outage must not turn a
    // tampered response into a rendered cell or leak the reporter's error to the page.
  }
}

/**
 * Consume one capability entirely on the web server and return only the domain cell.
 * `EvidenceReadGrantRepository` is an application port; the signed URL is never returned
 * by this function, rendered by React, placed in a link, or sent to telemetry.
 */
export async function readSnapshotCellWithGrant(
  repository: Pick<EvidenceReadGrantRepository, 'readForActor' | 'recordAccess'>,
  input: ReadSnapshotCellInput,
  environment: SnapshotReadEnvironment = {},
): Promise<EvidenceSnapshotReadResult> {
  const now = environment.now ?? (() => new Date());
  const sleep = environment.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const fetcher = environment.fetch ?? fetch;
  const maxWaitMs = input.maxGrantWaitMs ?? 2_000;
  const pollIntervalMs = input.pollIntervalMs ?? 50;
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 0 || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) return { cell: null, failure: 'grant-unavailable' };

  const started = Date.now();
  let capability: EvidenceReadGrantCapability | null = null;
  while (Date.now() - started <= maxWaitMs) {
    const at = instant(now());
    if (at === null) return { cell: null, failure: 'grant-unavailable' };
    capability = await repository.readForActor({ grantId: input.grantId, actorId: input.actorId, now: at });
    if (capability !== null) break;
    if (Date.now() - started >= maxWaitMs) break;
    await sleep(pollIntervalMs);
  }
  const at = instant(now());
  if (capability === null || at === null) return { cell: null, failure: 'grant-unavailable' };
  if (!validCapability(capability, input, at)) return { cell: null, failure: 'capability-mismatch' };

  const controller = new AbortController();
  const timeoutMs = input.fetchTimeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return { cell: null, failure: 'download-failed' };
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(capability.signedUrl, { redirect: 'error', signal: controller.signal });
  } catch {
    clearTimeout(timer);
    return { cell: null, failure: 'download-failed' };
  }
  let body: Uint8Array | EvidenceSnapshotReadFailure;
  try {
    if (response.url !== '' && response.url !== capability.signedUrl) return { cell: null, failure: 'download-redirected' };
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
      return { cell: null, failure: 'download-object-missing' };
    }
    // A transient 5xx, timeout or signed-URL denial says nothing about the registered
    // bytes. Only a confirmed object-store 404 is an integrity fact.
    if (!response.ok) return { cell: null, failure: 'download-failed' };
    const registeredMediaType = contentTypeBase(capability.mediaType);
    const responseMediaType = response.headers.get('content-type');
    if (responseMediaType !== null && contentTypeBase(responseMediaType) !== registeredMediaType) return { cell: null, failure: 'download-media-type-mismatch' };
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
      const declaredSize = Number(contentLength);
      if (!/^[0-9]+$/.test(contentLength) || !Number.isSafeInteger(declaredSize)) return { cell: null, failure: 'download-size-mismatch' };
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
        return { cell: null, failure: 'download-size-mismatch' };
      }
    }
    body = await readResponseBody(response);
  } catch {
    return { cell: null, failure: 'download-failed' };
  } finally {
    clearTimeout(timer);
  }
  if (typeof body === 'string') return { cell: null, failure: body };
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
    return { cell: null, failure: 'download-size-mismatch' };
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
    return { cell: null, failure: 'download-digest-mismatch' };
  }

  // Bytes have been fetched and verified. Record the access before parsing so an unreadable
  // document still has an ID-only access audit rather than looking like no read occurred.
  const accessedAt = instant(now());
  if (accessedAt === null || Date.parse(accessedAt) >= Date.parse(capability.signedUrlExpiresAt)) return { cell: null, failure: 'access-denied' };
  const accessed = await repository.recordAccess({ grantId: input.grantId, actorId: input.actorId, correlationId: input.correlationId, at: accessedAt });
  if (!accessed) return { cell: null, failure: 'access-denied' };
  const substrate = snapshotSubstrateForMediaType(capability.mediaType);
  if (substrate === null) return { cell: null, failure: 'snapshot-unreadable' };
  const parsed = readStructuralSnapshot({ evidenceId: input.evidenceId, substrate, bytes: body });
  if (!parsed.ok) return { cell: null, failure: 'snapshot-unreadable' };
  const locator = parseSnapshotLocator(input.locator);
  if (locator === null) return { cell: null, failure: 'locator-malformed' };
  const cell = readSnapshotCell(parsed, locator);
  return cell === null ? { cell: null, failure: 'locator-unresolved' } : { cell, failure: null };
}
