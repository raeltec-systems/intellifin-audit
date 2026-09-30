import type { paths } from './generated/api.ts';

export type Health = paths['/health/ready']['get']['responses'][200]['content']['application/json'];
export type HealthKind = 'live' | 'ready';

// Generated types describe the server contract; network input still needs validation.
export function parseHealth(value: unknown, kind: HealthKind, status: number): Health {
  if (typeof value !== 'object' || value === null ||
    !('service' in value) || value.service !== 'api' ||
    !('schema_version' in value) || (value.schema_version !== 2 && value.schema_version !== null) ||
    !('status' in value)) {
    throw new Error('Invalid service response');
  }

  const healthy = status === 200 && value.status === kind &&
    value.schema_version === (kind === 'live' ? null : 2);
  const unavailable = kind === 'ready' && status === 503 &&
    value.status === 'unavailable' && value.schema_version === null;
  if (!healthy && !unavailable) throw new Error('Invalid service response');
  return value as Health;
}

export async function readHealth(kind: HealthKind, signal: AbortSignal): Promise<Health> {
  const response = await fetch(`/api/health/${kind}`, {
    signal,
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  return parseHealth(await response.json(), kind, response.status);
}
