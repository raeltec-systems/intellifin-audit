import {
  PopulationAcquisitionError,
  type PopulationAcquisitionPort,
} from '@intellifin/application';
import type { ExplicitPeriod, ProcedureSourceSnapshot } from '@intellifin/domain';
import { canonicalJson, type JsonValue } from '@intellifin/domain';
import { createHmac } from 'node:crypto';

/** The largest source body an acquisition adapter will retain. */
export const POPULATION_ACQUISITION_MAX_BYTES = 16 * 1024 * 1024;

type FetchLike = typeof globalThis.fetch;

export interface PopulationDeclarationContext {
  readonly source: ProcedureSourceSnapshot;
  readonly period: ExplicitPeriod;
  readonly response: Response;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

/**
 * A declaration is produced independently of the bytes being acquired.  A resolver is
 * therefore an explicit composition choice: this adapter never counts rows or hashes a
 * response and calls that result an expected declaration.
 */
export type PopulationDeclarationResolver = (
  context: PopulationDeclarationContext,
) => unknown | Promise<unknown>;

export interface HttpPopulationAcquisitionOptions {
  readonly fetch?: FetchLike;
  readonly declaration?: PopulationDeclarationResolver;
  readonly maxBytes?: number;
}

const URL_PATH_ENDPOINTS = new Set(['count', 'counts', 'page', 'pages', 'pagination']);
const URL_QUERY_ENDPOINTS = new Set([
  'count',
  'counts',
  'cursor',
  'limit',
  'offset',
  'page',
  'pagesize',
  'page_size',
  'pageno',
  'page_number',
  'next',
  'next_page',
  'continuation',
  'continuation_token',
  'start',
]);
const URL_SECRET_QUERY_KEYS = new Set([
  'access_key',
  'accesskey',
  'auth',
  'authorization',
  'credential',
  'key',
  'password',
  'secret',
  'sig',
  'signature',
  'token',
  'access_token',
]);

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
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2 ** 31 - 1) {
    throw contractFailure();
  }
}

function sourceUrl(source: ProcedureSourceSnapshot): URL {
  if (source.contract.kind !== 'versioned-file' && source.contract.kind !== 'read-only-api') {
    throw contractFailure();
  }
  const location = source.contract.location;
  if (typeof location !== 'string' || location.length === 0 || location.trim() !== location) {
    throw contractFailure();
  }

  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    throw contractFailure();
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw contractFailure();
  if (parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') throw contractFailure();
  if (isRefusedSourceHost(parsed.hostname)) throw contractFailure();

  for (const segment of parsed.pathname.split('/').filter(Boolean)) {
    if (URL_PATH_ENDPOINTS.has(segment.toLowerCase())) throw contractFailure();
  }
  for (const key of parsed.searchParams.keys()) {
    if (URL_QUERY_ENDPOINTS.has(key.toLowerCase())) throw contractFailure();
    if (URL_SECRET_QUERY_KEYS.has(key.toLowerCase())) throw contractFailure();
  }
  return parsed;
}

/**
 * Refuse a frozen source that names an address only the infrastructure answers on.
 *
 * Scoped deliberately. This deployment's own synthetic Target Systems are served on
 * loopback (`http://localhost:4300/loancore`), and a PoC may bind a source to a private
 * neighbour, so neither loopback nor the RFC1918 ranges can be refused without breaking
 * the documented path. What no legitimate source ever names is the link-local range that
 * carries cloud instance metadata, or the unspecified address. Those are refused before
 * a request is made, because the response would be frozen into Evidence and the chain is
 * immutable: anything that enters it can never be taken out.
 *
 * This covers a literal only. A host name that RESOLVES to link-local is not covered and
 * needs a resolved-address check at connect time; the residual is recorded in the story.
 */
export function isRefusedSourceHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === '') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number) as [number, number, number, number];
    return (a === 169 && b === 254) || a === 0;
  }
  if (!host.includes(':')) return false;
  if (host === '::') return true;
  // fe80::/10 is written fe8, fe9, fea or feb in the first hextet.
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  // An IPv4-mapped address normalizes to hex, so 169.254.x.x arrives as ::ffff:a9fe:*.
  if (/^::ffff:a9fe:/.test(host)) return true;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  return mapped ? isRefusedSourceHost(mapped[1]!) : false;
}

function mediaTypeFrom(response: Response): string {
  const raw = response.headers.get('content-type');
  if (raw === null) return 'application/octet-stream';
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  if (encoding && !['identity', 'gzip', 'deflate', 'br'].includes(encoding)) return 'unsupported-http-encoding';
  const [type, ...parameters] = raw.split(';');
  const mediaType = type?.trim().toLowerCase() ?? '';
  if (mediaType !== 'text/csv' && mediaType !== 'application/json') return raw;
  for (const parameter of parameters) {
    const [name, value] = parameter.split('=', 2).map((part) => part.trim().toLowerCase());
    if (name === 'charset' && value !== 'utf-8' && value !== '"utf-8"') {
      return raw;
    }
  }
  return mediaType;
}

function declaredLength(response: Response, maxBytes: number): number | null {
  const raw = response.headers.get('content-length');
  if (raw === null || raw.trim() === '') return null;
  if (!/^\d+$/.test(raw.trim())) throw contractFailure();
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length > maxBytes) throw integrityFailure();
  return length;
}

async function readResponseBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  // Fetch exposes the decoded representation. A compressed Content-Length describes
  // wire bytes, not this stream; enforce the bound on the actual decoded bytes below.
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  const length = encoding && encoding !== 'identity' ? null : declaredLength(response, maxBytes);
  if (response.body === null) {
    if (length !== null && length !== 0) throw integrityFailure();
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
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
  if (length !== null && total !== length) throw integrityFailure();
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw contractFailure();
  }
}

function normalizeCoverDeclaration(value: unknown, sourceUrlValue: URL): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const cover = value as Record<string, unknown>;
  const digest = cover['content_digest'];
  const effectivePeriod = cover['effective_period'];
  const schema = cover['declared_schema'];
  const sourceFile = sourceUrlValue.pathname.slice(sourceUrlValue.pathname.lastIndexOf('/') + 1);
  const declarationFile = typeof cover['covers'] === 'string' ? cover['covers'] : null;
  if (
    typeof cover['source'] !== 'string' ||
    typeof cover['generation'] !== 'string' ||
    typeof cover['generated_at'] !== 'string' ||
    !('effective_period' in cover) ||
    !Array.isArray(schema) ||
    !Number.isSafeInteger(cover['row_count']) ||
    digest === null || typeof digest !== 'object' || Array.isArray(digest) ||
    typeof (digest as Record<string, unknown>)['value'] !== 'string' ||
    (digest as Record<string, unknown>)['algorithm'] !== 'sha256' ||
    cover['complete'] !== true ||
    declarationFile !== sourceFile
  ) return null;
  if (!verifySyntheticCover(cover)) return null;
  return {
    schema_version: 1,
    representation: 'csv-raw-v1',
    source: cover['source'],
    generation: cover['generation'],
    generated_at: cover['generated_at'],
    effective_period: effectivePeriod,
    schema,
    count: cover['row_count'],
    sha256: (digest as Record<string, unknown>)['value'],
    complete: true,
  };
}

/** Published synthetic integrity convention, not authentication or a production key. */
function verifySyntheticCover(cover: Record<string, unknown>): boolean {
  const signature = cover['signature'];
  if (!signature || typeof signature !== 'object' || Array.isArray(signature)) return false;
  const s = signature as Record<string, unknown>;
  if (s['scheme'] !== 'synthetic-hmac-sha256' || s['key_id'] !== 'northstar-cover-sheet-2026' || s['key_is_published'] !== true || typeof s['value'] !== 'string' || !/^[0-9a-f]{64}$/.test(s['value'])) return false;
  try {
    const fields = ['source','covers','generation','generated_at','effective_period','complete','row_count','declared_schema','content_digest','format'];
    const signed = Object.fromEntries(fields.map(key => [key, cover[key]]));
    const expected = createHmac('sha256', 'northstar-synthetic-cover-sheet-key-2026').update(canonicalJson(signed as JsonValue), 'utf8').digest('hex');
    return expected === s['value'];
  } catch { return false; }
}

function declarationUrl(sourceUrlValue: URL, source: ProcedureSourceSnapshot, payload: unknown): URL | null {
  try {
    if (source.contract.declared_count_mechanism === 'none') return null;
    if (source.contract.declared_count_mechanism === 'cover-sheet') {
      if (source.contract.kind !== 'versioned-file' || sourceUrlValue.search !== '' || !sourceUrlValue.pathname.toLowerCase().endsWith('.csv')) {
        return null;
      }
      const slash = sourceUrlValue.pathname.lastIndexOf('/');
      const directory = slash < 0 ? '/' : sourceUrlValue.pathname.slice(0, slash + 1);
      const file = sourceUrlValue.pathname.slice(slash + 1, -'.csv'.length);
      return new URL(`${directory}${file}.cover-sheet.json`, sourceUrlValue);
    }
    if (source.contract.kind !== 'read-only-api' || payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    const advertised = (payload as Record<string, unknown>)['declared_count_endpoint'];
    if (typeof advertised !== 'string' || advertised.trim() === '') return null;
    const candidate = new URL(advertised, sourceUrlValue);
    if (candidate.protocol !== sourceUrlValue.protocol || candidate.origin !== sourceUrlValue.origin || candidate.username !== '' || candidate.password !== '' || candidate.hash !== '') {
      return null;
    }
    if (candidate.search !== '' || candidate.pathname !== `${sourceUrlValue.pathname.replace(/\/$/, '')}/count`) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

async function fetchDeclaration(
  sourceUrlValue: URL,
  source: ProcedureSourceSnapshot,
  primaryPayload: unknown,
  fetchImpl: FetchLike,
  signal: AbortSignal,
  maxBytes: number,
): Promise<unknown> {
  const url = declarationUrl(sourceUrlValue, source, primaryPayload);
  if (url === null) return null;
  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal, headers: { 'accept-encoding': 'identity' } });
  } catch {
    if (signal.aborted) throw transportFailure();
    // The raw primary response remains useful Evidence even when its independently
    // published declaration is unavailable. Reconciliation records the failed checks.
    return null;
  }
  try {
    if (response.redirected || (response.url !== '' && response.url !== url.href) || (response.status >= 300 && response.status < 400)) {
      return null;
    }
    if (!response.ok) return null;
    const mediaType = mediaTypeFrom(response);
    if (mediaType !== 'application/json') return null;
    const declaration = parseJson(await readResponseBody(response, Math.min(maxBytes, 1024 * 1024)));
    return source.contract.declared_count_mechanism === 'cover-sheet'
      ? normalizeCoverDeclaration(declaration, sourceUrlValue)
      : declaration;
  } catch (error) {
    if (error instanceof PopulationAcquisitionError && signal.aborted) throw transportFailure();
    // Declaration failures do not discard the already fetched raw source bytes.
    return null;
  }
}

function withDeadline(timeoutMs: number, parentSignal?: AbortSignal): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let onAbort: (() => void) | undefined;
  if (parentSignal !== undefined) {
    onAbort = () => controller.abort(parentSignal.reason);
    if (parentSignal.aborted) onAbort();
    else parentSignal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      if (onAbort !== undefined) parentSignal?.removeEventListener('abort', onAbort);
      // `fetch` resolves on HEADERS, so a response whose body is never read holds the
      // socket open after the only timer that would have bounded it is cleared. Every
      // early exit here leaves a body unread: a non-2xx, a redirect, a bad or over-long
      // Content-Length, and each `return null` in the declaration fetch. Aborting is a
      // no-op on a request that already finished, and releases the socket on one that
      // has not. Same defect and same fix as the Target System probe.
      controller.abort();
    },
  };
}

/**
 * GET-only acquisition for a frozen HTTP source contract.
 *
 * No binding lookup, credential lookup, redirects, pagination, or calculated expected
 * declarations occur here. Count endpoints supply independent metadata, never primary
 * population rows. The optional resolver is the seam for an
 * independently generated cover sheet/declaration and receives the preserved body only
 * as context, never as an instruction to calculate a count or digest.
 */
export class HttpPopulationAcquisition implements PopulationAcquisitionPort {
  private readonly fetchImpl: FetchLike;
  private readonly declarationResolver: PopulationDeclarationResolver | undefined;
  private readonly maxBytes: number;

  constructor(options: HttpPopulationAcquisitionOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.declarationResolver = options.declaration;
    this.maxBytes = options.maxBytes ?? POPULATION_ACQUISITION_MAX_BYTES;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0 || this.maxBytes > POPULATION_ACQUISITION_MAX_BYTES) {
      throw contractFailure();
    }
  }

  async acquire(
    source: ProcedureSourceSnapshot,
    period: ExplicitPeriod,
    timeoutMs: number,
    parentSignal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; mediaType: string; declaration: unknown }> {
    validateTimeout(timeoutMs);
    let url: URL;
    try {
      url = sourceUrl(source);
    } catch (error) {
      if (error instanceof PopulationAcquisitionError) throw error;
      throw contractFailure();
    }
    const deadline = withDeadline(timeoutMs, parentSignal);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        signal: deadline.signal,
        headers: { 'accept-encoding': 'identity' },
      });
    } catch {
      deadline.dispose();
      throw transportFailure();
    }

    try {
      if (response.redirected || (response.url !== '' && response.url !== url.href)) throw contractFailure();
      if (response.status >= 300 && response.status < 400) throw contractFailure();
      if (!response.ok) throw transportFailure();
      const bytes = await readResponseBody(response, this.maxBytes);
      const mediaType = mediaTypeFrom(response);
      let primaryPayload: unknown = null;
      if (mediaType === 'application/json') {
        try {
          primaryPayload = parseJson(bytes);
        } catch {
          primaryPayload = null;
        }
      }
      const declaration = this.declarationResolver === undefined
        ? await fetchDeclaration(url, source, primaryPayload, this.fetchImpl, deadline.signal, this.maxBytes)
        : await this.declarationResolver({ source, period, response, bytes, mediaType });
      return { bytes, mediaType, declaration };
    } catch (error) {
      if (error instanceof PopulationAcquisitionError) throw error;
      throw transportFailure();
    } finally {
      deadline.dispose();
    }
  }
}
