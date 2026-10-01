import type { paths } from './generated/api.ts';

export type Session = paths['/auth/session']['get']['responses'][200]['content']['application/json'];

export class AccessError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, code?: string) { super('Access could not be verified'); this.status = status; this.code = code; }
}

export const MAX_JSON_BYTES = 4 * 1024 * 1024;

async function readConflictCode(response: Response): Promise<string | undefined> {
  if (response.headers.get('X-Zobba-Error-Code') === 'last_admin') {
    // Headers are sufficient even if the body or its cancellation never settles.
    void response.body?.cancel().catch(() => {});
    return 'last_admin';
  }
  if (!response.body) return undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = response.body.getReader(); }
  catch { return undefined; }
  const deadline = performance.now() + 250;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 250); });
  const chunks: Uint8Array[] = [];
  let length = 0, complete = false;
  try {
    if (Number(response.headers.get('Content-Length') ?? 0) > 4096) return undefined;
    for (;;) {
      // The absolute check also bounds streams that keep supplying empty chunks.
      if (performance.now() >= deadline) return undefined;
      const next = await Promise.race([reader.read(), expired]);
      if (!next || performance.now() >= deadline) return undefined;
      if (next.done) { complete = true; break; }
      length += next.value.byteLength;
      if (length > 4096) return undefined;
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (body && typeof body === 'object' && !Array.isArray(body) && 'error' in body && body.error === 'last_admin') return 'last_admin';
  } catch { /* The definite HTTP refusal does not depend on this optional body. */ }
  finally {
    clearTimeout(timer);
    // Cancellation can itself stall. Start it while this reader owns the stream,
    // then release the lock without making refusal depend on source cleanup.
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return undefined;
}

export async function readJson(path: string, signal?: AbortSignal, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    ...init, signal, cache: 'no-store', credentials: 'same-origin',
    headers: { Accept: 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    // Only this known conflict needs different recovery guidance. Neither a slow
    // body nor malformed server text may delay the definite refusal indefinitely.
    const code = response.status === 409 ? await readConflictCode(response) : undefined;
    throw new AccessError(response.status, code);
  }
  return readJsonBody(response);
}

export async function readJsonBody(response: Response, limit = MAX_JSON_BYTES): Promise<unknown> {
  if (response.status === 204) return null;
  // Bound the actual decompressed body too; Content-Length alone is insufficient.
  if (!response.body || Number(response.headers.get('Content-Length') ?? 0) > limit) {
    await response.body?.cancel(); throw new Error('Invalid response size');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error('Invalid response size'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function parseSession(value: unknown): Session {
  if (!value || typeof value !== 'object' || !('identity' in value) ||
    !value.identity || typeof value.identity !== 'object' ||
    !('id' in value.identity) || typeof value.identity.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.identity.id) ||
    !('display_name' in value.identity) || typeof value.identity.display_name !== 'string' || !value.identity.display_name ||
    [...value.identity.display_name].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(value.identity.display_name) ||
    !('csrf_token' in value) || typeof value.csrf_token !== 'string' || !value.csrf_token ||
    value.csrf_token.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(value.csrf_token)) {
    throw new Error('Invalid session response');
  }
  return value as Session;
}

export async function readSession(signal: AbortSignal): Promise<Session> {
  return parseSession(await readJson('/auth/session', signal));
}

export function readSessionJson(path: string, session: Session | null, signal: AbortSignal): Promise<unknown> {
  // In-memory refusal fence only: cookie-derived identity remains authoritative.
  if (!session) throw new AccessError(401);
  return readJson(path, signal, { headers: { 'X-Expected-Session': session.csrf_token } });
}

export async function logout(session: Session, signal: AbortSignal): Promise<void> {
  try {
    await readJson('/auth/logout', signal, { method: 'POST', headers: { 'X-CSRF-Token': session.csrf_token } });
  } catch (error) {
    // Expiry or a lost successful response has already ended this session.
    if (!(error instanceof AccessError && error.status === 401)) throw error;
  }
}
