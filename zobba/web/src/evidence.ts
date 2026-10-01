import { AccessError, readJsonBody, readSession } from './auth.ts';
import type { Session } from './auth.ts';
import { parseScope, readEngagement, sameScope } from './engagements.ts';
import type { Scope } from './engagements.ts';
import type { components } from './generated/api.ts';

export type ReservationRequest = components['schemas']['EvidenceReservationRequest'];
export type Reservation = components['schemas']['EvidenceReservationResponse'];
export type Evidence = components['schemas']['EvidenceResponse'];
export type EvidencePage = components['schemas']['EvidencePageResponse'];
export type ReservationPage = components['schemas']['EvidenceReservationPageResponse'];
export type Preview = components['schemas']['EvidencePreviewResponse'];
export const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;
const DRAFT_KEY = 'zobba.evidence-draft.v1';
// The 32 KiB reservation envelope plus the bounded session binding and ID.
const MAX_DRAFT_BYTES = 40 * 1024;
export type AcquisitionDraft = { audience: string; request: ReservationRequest; reservationId: string | null };
export class ReservationLimitError extends AccessError { constructor() { super(409); } }

export function liveEvidenceAudience(session: Session, scope: Scope): string {
  return `${session.identity.id}/${session.csrf_token}/${scope.organisation_id}/${scope.client_id}/${scope.engagement_id}`;
}
export async function evidenceAudience(session: Session, scope: Scope): Promise<string> {
  return sha256(new TextEncoder().encode(liveEvidenceAudience(session, scope)).buffer);
}
function invalid(): never { throw new Error('Invalid evidence response'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid();
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || new TextEncoder().encode(value).length > max || /[\u0000-\u001f\u007f-\u009f]/.test(value)) invalid();
  return value;
}
// Match Rust str::trim: Unicode White_Space excludes the accepted U+FEFF.
export function trimEvidenceWhitespace(value: string): string {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
}
export function parseReservationRequest(value: unknown): ReservationRequest {
  const row = record(value), identity = record(row.identity), source = record(row.source);
  if (typeof identity.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(identity.sha256) ||
    !Number.isSafeInteger(identity.size) || (identity.size as number) < 0 || (identity.size as number) > MAX_ORIGINAL_BYTES) invalid();
  const asserted = (key: string) => {
    if (source[key] === null) return null;
    const value = text(source[key], 2000);
    if (!value || trimEvidenceWhitespace(value) !== value) invalid();
    return value;
  };
  const filename = text(row.filename, 255);
  if (!filename || trimEvidenceWhitespace(filename) !== filename || /[/\\]/.test(filename)) invalid();
  return { key: identifier(row.key), filename, identity: { sha256: identity.sha256, size: identity.size as number },
    source: { system: asserted('system'), account: asserted('account'), source_version: asserted('source_version'), selection: asserted('selection'), coverage: asserted('coverage') } };
}
function timestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid();
  return value as number;
}
export function parseReservation(value: unknown, scope: Scope): Reservation {
  const row = record(value), selected = parseScope(row.scope);
  if (!sameScope(selected, scope)) invalid();
  return { id: identifier(row.id), actor_id: identifier(row.actor_id), scope: selected,
    request: parseReservationRequest(row.request), reserved_at: timestamp(row.reserved_at) };
}
export function parseEvidence(value: unknown, scope: Scope): Evidence {
  const row = record(value), version = text(row.version, 512);
  if (!version || version === 'null') invalid();
  return { reservation: parseReservation(row.reservation, scope), version, registered_at: timestamp(row.registered_at) };
}
function parsePage<T>(value: unknown, parse: (row: unknown) => T, id: (item: T) => string, after?: string): { items: T[]; next_cursor: string | null } {
  const row = record(value);
  if (!Array.isArray(row.items) || row.items.length > 50) invalid();
  const items = row.items.map(parse), next_cursor = row.next_cursor === null ? null : identifier(row.next_cursor);
  if (new Set(items.map(id)).size !== items.length || next_cursor !== null && (items.length !== 50 || next_cursor !== id(items.at(-1)!))) invalid();
  items.forEach((item, index) => { if (index && id(items[index - 1]!) >= id(item) || after && id(item) <= after) invalid(); });
  return { items, next_cursor };
}
function route(scope: Scope, suffix: string, after?: string): string {
  parseScope(scope);
  return `/engagements/${encodeURIComponent(scope.engagement_id)}/${suffix}?${new URLSearchParams({ organisation_id: scope.organisation_id, client_id: scope.client_id, ...(after ? { after: identifier(after) } : {}) })}`;
}
function headers(session: Session, mutation = false): Record<string, string> {
  return { 'X-Expected-Session': session.csrf_token, ...(mutation ? { 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id } : {}) };
}
// A successful response may have been held while another tab replaced the
// cookie. Recheck the exact session and current scope after buffering it.
export async function verifyEvidenceAudience(session: Session, scope: Scope, signal: AbortSignal): Promise<void> {
  const latest = await readSession(signal);
  if (latest.identity.id !== session.identity.id || latest.csrf_token !== session.csrf_token) throw new AccessError(412);
  await readEngagement(scope, signal, session);
  signal.throwIfAborted();
}
async function protectedJson(path: string, scope: Scope, session: Session, signal: AbortSignal, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api${path}`, { ...init, signal, cache: 'no-store', credentials: 'same-origin',
    headers: { Accept: 'application/json', ...headers(session, !!init?.method), ...init?.headers } });
  if (!response.ok) {
    let reservationLimit = false;
    if (response.status === 409) {
      try {
        const body = await readJsonBody(response, 4096);
        reservationLimit = !!body && typeof body === 'object' && 'error' in body && body.error === 'evidence_reservation_limit';
      } catch { /* Unrecognized or malformed refusal stays a generic conflict. */ }
    } else { await response.body?.cancel(); }
    throw reservationLimit ? new ReservationLimitError() : new AccessError(response.status);
  }
  const result = await readJsonBody(response);
  await verifyEvidenceAudience(session, scope, signal);
  return result;
}
export async function listEvidence(scope: Scope, session: Session, signal: AbortSignal, after?: string): Promise<EvidencePage> {
  const value = record(await protectedJson(route(scope, 'evidence', after), scope, session, signal));
  if (typeof value.storage_configured !== 'boolean') invalid();
  return { ...parsePage(value, value => parseEvidence(value, scope), value => value.reservation.id, after), storage_configured: value.storage_configured };
}
export async function listReservations(scope: Scope, session: Session, signal: AbortSignal, after?: string): Promise<ReservationPage> {
  return parsePage(await protectedJson(route(scope, 'evidence-reservations', after), scope, session, signal), value => {
    const reservation = parseReservation(value, scope);
    if (reservation.actor_id !== session.identity.id) invalid();
    return reservation;
  }, value => value.id, after);
}
export async function reserveEvidence(scope: Scope, session: Session, request: ReservationRequest, signal: AbortSignal): Promise<Reservation> {
  const canonical = parseReservationRequest(request);
  const reservation = parseReservation(await protectedJson(route(scope, 'evidence-reservations'), scope, session, signal,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(canonical) }), scope);
  if (reservation.actor_id !== session.identity.id || JSON.stringify(reservation.request) !== JSON.stringify(canonical)) invalid();
  return reservation;
}
export async function uploadEvidence(scope: Scope, session: Session, reservationId: string, file: File, signal: AbortSignal): Promise<Evidence> {
  const result = parseEvidence(await protectedJson(route(scope, `evidence-reservations/${identifier(reservationId)}/upload`), scope, session, signal,
    { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file }), scope);
  if (result.reservation.id !== reservationId) invalid();
  return result;
}
export async function inspectEvidence(scope: Scope, session: Session, id: string, signal: AbortSignal): Promise<Evidence> {
  const item = parseEvidence(await protectedJson(route(scope, `evidence/${identifier(id)}`), scope, session, signal), scope);
  if (item.reservation.id !== id) invalid();
  return item;
}
export async function previewEvidence(scope: Scope, session: Session, id: string, signal: AbortSignal): Promise<Preview> {
  const row = record(await protectedJson(route(scope, `evidence/${identifier(id)}/preview`), scope, session, signal));
  if (typeof row.truncated !== 'boolean' || !['plain_text', 'download_only'].includes(row.kind as string)) invalid();
  if (row.kind === 'download_only') { if (row.text !== null) invalid(); return { kind: 'download_only', text: null, truncated: row.truncated }; }
  if (typeof row.text !== 'string' || new TextEncoder().encode(row.text).length > 65536 || row.text.split('\n').length > 100) invalid();
  return { kind: 'plain_text', text: row.text, truncated: row.truncated };
}
export async function downloadEvidence(scope: Scope, session: Session, item: Evidence, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(`/api${route(scope, `evidence/${identifier(item.reservation.id)}/download`)}`, {
    signal, credentials: 'same-origin', cache: 'no-store', headers: headers(session),
  });
  if (!response.ok) throw new AccessError(response.status);
  if (!response.body || Number(response.headers.get('Content-Length') ?? 0) > MAX_ORIGINAL_BYTES) {
    await response.body?.cancel(); invalid();
  }
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ORIGINAL_BYTES || size > item.reservation.request.identity.size) { await reader.cancel(); invalid(); }
      chunks.push(new Uint8Array(value));
    }
  } finally { reader.releaseLock(); }
  if (size !== item.reservation.request.identity.size) invalid();
  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  const hash = await sha256(await blob.arrayBuffer());
  if (hash !== item.reservation.request.identity.sha256) invalid();
  await verifyEvidenceAudience(session, scope, signal);
  return blob;
}
export function safeFilename(filename: string): string {
  const safe = [...filename].map(character => /^[A-Za-z0-9._-]$/.test(character) ? character : '_').join('').replace(/^\.+|\.+$/g, '');
  if (!safe) return 'evidence-original';
  if (safe.length <= 120) return safe;
  const extension = safe.match(/\.[A-Za-z0-9]{1,20}$/)?.[0] ?? '';
  return (safe.slice(0, 120 - extension.length) + extension).replace(/\.+$/g, '');
}
async function sha256(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function measureFile(file: File): Promise<{ size: number; sha256: string }> {
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error('Choose an original of 10 MiB or less.');
  return { size: file.size, sha256: await sha256(await file.arrayBuffer()) };
}
export function discardAcquisitionDraft(): void { try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* Storage may be unavailable. */ } }
export function saveAcquisitionDraft(draft: AcquisitionDraft): void {
  // Persist before reserve, so a lost acknowledgement can recover the same key.
  if (!/^[0-9a-f]{64}$/.test(draft.audience)) throw new Error('Invalid recovery audience');
  const canonical = { audience: draft.audience, request: parseReservationRequest(draft.request),
    reservationId: draft.reservationId === null ? null : identifier(draft.reservationId) };
  const raw = JSON.stringify(canonical);
  if (new TextEncoder().encode(raw).length > MAX_DRAFT_BYTES) throw new Error('Invalid recovery size');
  sessionStorage.setItem(DRAFT_KEY, raw);
}
export function recoverAcquisitionDraft(audience: string): AcquisitionDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    if (raw.length > MAX_DRAFT_BYTES || new TextEncoder().encode(raw).length > MAX_DRAFT_BYTES) { discardAcquisitionDraft(); return null; }
    const row = record(JSON.parse(raw));
    if (row.audience !== audience) { discardAcquisitionDraft(); return null; }
    return { audience, request: parseReservationRequest(row.request), reservationId: row.reservationId === null ? null : identifier(row.reservationId) };
  } catch { discardAcquisitionDraft(); return null; }
}
