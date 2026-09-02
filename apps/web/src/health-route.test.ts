import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRuntime = vi.fn();
vi.mock('./bootstrap', () => ({ getRuntime }));

/** Matrix row "Health": 200 with the schema version, 503 with a reason otherwise. */
describe('GET /api/health', () => {
  beforeEach(() => {
    getRuntime.mockReset();
  });

  it('returns 200 and the applied schema version when the startup checks passed', async () => {
    const sql = Object.assign(async () => [{ '?column?': 1 }], {});
    getRuntime.mockResolvedValue({ schemaVersion: 1, sql });
    const { GET } = await import('../app/api/health/route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'ok', schema: 1 });
  });

  it('returns 503 with the failing check named when startup refused', async () => {
    getRuntime.mockRejectedValue(
      new Error('Unsupported schema version: found 1, this build supports 7..9.'),
    );
    const { GET } = await import('../app/api/health/route');
    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { status: string; reason: string };
    expect(body.status).toBe('unavailable');
    expect(body.reason).toContain('Unsupported schema version');
    expect(body.reason).not.toContain('postgres://');
  });
});
