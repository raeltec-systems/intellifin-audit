import {
  PopulationAcquisitionError,
  type AcquiredArtifact,
  type AdapterExtractionPort,
  type ReferenceAcquisitionPort,
  type ResolvedCredential,
} from '@intellifin/application';
import type { ProcedureTargetSnapshot } from '@intellifin/domain';

import { isRefusedSourceHost, POPULATION_ACQUISITION_MAX_BYTES } from './population-acquisition-http.js';

/**
 * The read-only HTTP adapter for Story 3.3: Reference Source acquisition and
 * adapter-acquired Target System extraction.
 *
 * Deliberately outside the barrel (`./extraction`), like `./acquisition`: this module
 * makes the outbound call to a registered Target System and presents an audit
 * credential, and `apps/web` imports the barrel. `no-adapter-extraction-in-web` fails the
 * build on any import of it from the web, in both the `src` and the `dist` spelling.
 *
 * Every guard the population adapter uses applies here: GET only, `redirect: 'error'`,
 * the link-local/unspecified host refusal, an explicit decoded-byte cap, and a deadline
 * that aborts the request on dispose so an unread body cannot hold the socket open past
 * the timer that was supposed to bound it.
 *
 * **The token goes on the wire and nowhere else.** `credential.authorize(headers)` is the
 * only call that can see it, it writes into a `Headers` this function owns, and that
 * `Headers` never leaves. No URL here carries a credential, so nothing this returns —
 * including `location`, which is recorded as provenance — can carry one either.
 */

type FetchLike = typeof globalThis.fetch;

export interface HttpAdapterExtractionOptions {
  readonly fetch?: FetchLike;
  readonly maxBytes?: number;
}

/**
 * The keys a v1 read-only service index answers with.
 *
 * A `versioned-file` Target System's frozen origin IS the artifact; an `api` Target
 * System's frozen origin is either the extraction collection itself or the system's own
 * read-only index, which names its endpoints. Following exactly one such index entry —
 * and only one, and only to a location inside the SAME frozen origin — is what lets a
 * registration written for the Story 1.8 probe (`http://host/accessgate`) be extracted
 * from without guessing a path. Anything outside the frozen origin is refused before a
 * request is made.
 */
const SERVICE_INDEX_KEYS = ['service', 'synthetic', 'access', 'endpoints'] as const;

function contractFailure(): PopulationAcquisitionError {
  return new PopulationAcquisitionError('contract');
}
function transportFailure(): PopulationAcquisitionError {
  return new PopulationAcquisitionError('transport');
}
function integrityFailure(): PopulationAcquisitionError {
  return new PopulationAcquisitionError('integrity');
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2 ** 31 - 1) throw contractFailure();
}

/**
 * The frozen origin, as a URL this adapter may read.
 *
 * The FROZEN contract decides, never a current registration. `allowed_origins` is a set
 * and its members are sorted, so "the first" is deterministic for one frozen contract.
 */
export function targetOrigin(target: ProcedureTargetSnapshot): URL {
  const origins = target.contract.allowed_origins;
  if (!Array.isArray(origins) || origins.length === 0) throw contractFailure();
  const location = origins[0]!;
  if (typeof location !== 'string' || location === '' || location.trim() !== location) throw contractFailure();
  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    throw contractFailure();
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw contractFailure();
  if (parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') throw contractFailure();
  if (isRefusedSourceHost(parsed.hostname)) throw contractFailure();
  return parsed;
}

/** `true` when `candidate` is the frozen origin or sits underneath it on a path boundary. */
export function withinOrigin(origin: URL, candidate: URL): boolean {
  if (candidate.origin !== origin.origin || candidate.protocol !== origin.protocol) return false;
  if (candidate.username !== '' || candidate.password !== '' || candidate.hash !== '') return false;
  const base = origin.pathname.replace(/\/$/, '');
  if (base === '') return true;
  return candidate.pathname === base || candidate.pathname.startsWith(`${base}/`);
}

function mediaTypeFrom(response: Response): string {
  const raw = response.headers.get('content-type');
  if (raw === null) return 'application/octet-stream';
  const [type, ...parameters] = raw.split(';');
  const mediaType = type?.trim().toLowerCase() ?? '';
  if (mediaType !== 'text/csv' && mediaType !== 'application/json') return raw;
  for (const parameter of parameters) {
    const [name, value] = parameter.split('=', 2).map((part) => part.trim().toLowerCase());
    if (name === 'charset' && value !== 'utf-8' && value !== '"utf-8"') return raw;
  }
  return mediaType;
}

async function readBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw integrityFailure();
      }
      chunks.push(next.value);
    }
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

function withDeadline(timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      // `fetch` resolves on HEADERS. Every early exit here leaves a body unread, and an
      // unread body holds the socket after the only timer bounding it is cleared.
      // Aborting a finished request is a no-op; aborting an unfinished one frees it.
      controller.abort();
    },
  };
}

/** A parsed v1 read-only service index, or `null` when the payload is not one. */
export function serviceIndexEndpoints(bytes: Uint8Array, mediaType: string): readonly string[] | null {
  if (mediaType !== 'application/json') return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  // Closed shape: an index has exactly these keys. A collection response has a
  // collection key and would not match, so a collection is never mistaken for an index.
  if (!SERVICE_INDEX_KEYS.every((key) => Object.hasOwn(record, key))) return null;
  if (Object.keys(record).length !== SERVICE_INDEX_KEYS.length) return null;
  if (record['access'] !== 'read-only') return null;
  const endpoints = record['endpoints'];
  if (!Array.isArray(endpoints) || endpoints.length === 0 || endpoints.length > 16) return null;
  if (!endpoints.every((entry) => typeof entry === 'string' && entry !== '')) return null;
  return endpoints as readonly string[];
}

export class HttpAdapterExtraction implements AdapterExtractionPort, ReferenceAcquisitionPort {
  private readonly fetchImpl: FetchLike;
  private readonly maxBytes: number;

  constructor(options: HttpAdapterExtractionOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.maxBytes = options.maxBytes ?? POPULATION_ACQUISITION_MAX_BYTES;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0 || this.maxBytes > POPULATION_ACQUISITION_MAX_BYTES) {
      throw contractFailure();
    }
  }

  /** A `versioned-file` Target System: its frozen origin is the artifact, read as bytes. */
  async acquireReference(target: ProcedureTargetSnapshot, timeoutMs: number): Promise<AcquiredArtifact> {
    if (target.contract.kind !== 'versioned-file') throw contractFailure();
    validateTimeout(timeoutMs);
    const url = targetOrigin(target);
    const deadline = withDeadline(timeoutMs);
    try {
      return await this.read(url, deadline.signal, null);
    } finally {
      deadline.dispose();
    }
  }

  /** An `api` Target System: one complete read-only extraction, with the credential. */
  async extract(
    target: ProcedureTargetSnapshot,
    credential: ResolvedCredential,
    timeoutMs: number,
  ): Promise<AcquiredArtifact> {
    if (target.contract.kind !== 'api') throw contractFailure();
    if (credential.reference !== target.contract.credential_ref) throw contractFailure();
    validateTimeout(timeoutMs);
    const origin = targetOrigin(target);
    const deadline = withDeadline(timeoutMs);
    try {
      const first = await this.read(origin, deadline.signal, credential);
      const endpoints = serviceIndexEndpoints(first.bytes, first.mediaType);
      if (endpoints === null) return first;
      // Exactly one hop, and only to a location the frozen origin already covers.
      for (const endpoint of endpoints) {
        let candidate: URL;
        try {
          candidate = new URL(endpoint, origin);
        } catch {
          continue;
        }
        if (!withinOrigin(origin, candidate) || candidate.href === origin.href) continue;
        const followed = await this.read(candidate, deadline.signal, credential);
        if (serviceIndexEndpoints(followed.bytes, followed.mediaType) !== null) throw contractFailure();
        return followed;
      }
      throw contractFailure();
    } finally {
      deadline.dispose();
    }
  }

  private async read(
    url: URL,
    signal: AbortSignal,
    credential: ResolvedCredential | null,
  ): Promise<AcquiredArtifact> {
    const headers = new Headers({ 'accept-encoding': 'identity' });
    // The only place the value exists in this process outside the resolver's closure,
    // and it exists inside a Headers this function owns and never returns.
    credential?.authorize(headers);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: 'GET', redirect: 'error', signal, headers });
    } catch {
      throw transportFailure();
    }
    if (response.redirected || (response.url !== '' && response.url !== url.href)) throw contractFailure();
    if (response.status >= 300 && response.status < 400) throw contractFailure();
    if (!response.ok) throw transportFailure();
    const bytes = await readBody(response, this.maxBytes);
    return { bytes, mediaType: mediaTypeFrom(response), location: url.href };
  }
}
