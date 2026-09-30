import type { paths } from './generated/api.ts';

export type Session = paths['/auth/session']['get']['responses'][200]['content']['application/json'];

export class AccessError extends Error {
  readonly status: number;
  constructor(status: number) { super('Access could not be verified'); this.status = status; }
}

export const MAX_JSON_BYTES = 4 * 1024 * 1024;

export async function readJson(path: string, signal?: AbortSignal, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    ...init, signal, cache: 'no-store', credentials: 'same-origin',
    headers: { Accept: 'application/json', ...init?.headers },
  });
  if (!response.ok) throw new AccessError(response.status);
  if (response.status === 204) return null;
  // Bound the actual decompressed body too; Content-Length alone is insufficient.
  if (!response.body || Number(response.headers.get('Content-Length') ?? 0) > MAX_JSON_BYTES) {
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
      if (length > MAX_JSON_BYTES) { await reader.cancel(); throw new Error('Invalid response size'); }
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
    value.csrf_token.length > 4096 || /[\u0000-\u001f\u007f-\u009f]/.test(value.csrf_token)) {
    throw new Error('Invalid session response');
  }
  return value as Session;
}

export async function readSession(signal: AbortSignal): Promise<Session> {
  return parseSession(await readJson('/auth/session', signal));
}

export async function logout(session: Session, signal: AbortSignal): Promise<void> {
  try {
    await readJson('/auth/logout', signal, { method: 'POST', headers: { 'X-CSRF-Token': session.csrf_token } });
  } catch (error) {
    // Expiry or a lost successful response has already ended this session.
    if (!(error instanceof AccessError && error.status === 401)) throw error;
  }
}
