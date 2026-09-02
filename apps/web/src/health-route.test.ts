import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigError, UnsupportedDatabaseError, UnsupportedSchemaError } from '@intellifin/infrastructure';

const getRuntime = vi.fn();
vi.mock('./bootstrap', () => ({ getRuntime }));

async function callHealth() {
  const { GET } = await import('../app/api/health/route');
  return GET();
}

/** Matrix row "Health": 200 with the schema version, 503 with a reason otherwise. */
describe('GET /api/health', () => {
  beforeEach(() => {
    getRuntime.mockReset();
  });

  it('returns 200 and the applied schema version when the startup checks passed', async () => {
    const sql = Object.assign(async () => [{ '?column?': 1 }], {});
    getRuntime.mockResolvedValue({ schemaVersion: 1, sql });

    const response = await callHealth();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'ok', schema: 1 });
  });

  it('returns 503 naming the schema range and the found version', async () => {
    getRuntime.mockRejectedValue(
      new UnsupportedSchemaError(
        'Unsupported schema version: found 1, this build supports 7..9.',
        1,
        7,
        9,
      ),
    );

    const response = await callHealth();
    const body = (await response.json()) as { status: string; reason: string };

    expect(response.status).toBe(503);
    expect(body.status).toBe('unavailable');
    expect(body.reason).toContain('found 1, this build supports 7..9');
  });

  it('returns 503 naming the PostgreSQL major when the server is the wrong one', async () => {
    getRuntime.mockRejectedValue(
      new UnsupportedDatabaseError('Unsupported PostgreSQL major: found 16 ...', 16),
    );

    const body = (await (await callHealth()).json()) as { reason: string };
    expect(body.reason).toContain('found 16');
  });

  it('returns 503 naming the offending configuration key', async () => {
    getRuntime.mockRejectedValue(new ConfigError(['SERVICE_NAME: must be "web"']));

    const body = (await (await callHealth()).json()) as { reason: string };
    expect(body.reason).toContain('SERVICE_NAME');
  });

  it('never echoes a raw driver error to an unauthenticated caller', async () => {
    getRuntime.mockRejectedValue(
      new Error('connect ECONNREFUSED 10.1.2.3:5432 for user "audit_app" database "intellifin"'),
    );

    const response = await callHealth();
    const body = (await response.json()) as { status: string; reason: string };

    expect(response.status).toBe(503);
    expect(body.reason).toBe('Database unavailable');
    expect(body.reason).not.toContain('10.1.2.3');
    expect(body.reason).not.toContain('audit_app');
  });

  it('returns 503 instead of hanging when the liveness query never answers', async () => {
    vi.useFakeTimers();
    try {
      const sql = Object.assign(() => new Promise(() => {}), {});
      getRuntime.mockResolvedValue({ schemaVersion: 1, sql });

      const pending = callHealth();
      await vi.advanceTimersByTimeAsync(5_000);
      const response = await pending;
      const body = (await response.json()) as { status: string; reason: string };

      expect(response.status).toBe(503);
      expect(body.reason).toBe('Database unavailable');
    } finally {
      vi.useRealTimers();
    }
  });
});
