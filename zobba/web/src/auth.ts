import type { paths } from './generated/api.ts';

export type Session = paths['/auth/session']['get']['responses'][200]['content']['application/json'];

export class AccessError extends Error {
  readonly status: number;
  constructor(status: number) { super('Access could not be verified'); this.status = status; }
}

export async function readJson(path: string, signal?: AbortSignal, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    ...init, signal, cache: 'no-store', credentials: 'same-origin',
    headers: { Accept: 'application/json', ...init?.headers },
  });
  if (!response.ok) throw new AccessError(response.status);
  return response.status === 204 ? null : response.json();
}

export function parseSession(value: unknown): Session {
  if (!value || typeof value !== 'object' || !('identity' in value) ||
    !value.identity || typeof value.identity !== 'object' ||
    !('id' in value.identity) || typeof value.identity.id !== 'string' ||
    !('display_name' in value.identity) || typeof value.identity.display_name !== 'string' ||
    !('csrf_token' in value) || typeof value.csrf_token !== 'string' || !value.csrf_token) {
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
