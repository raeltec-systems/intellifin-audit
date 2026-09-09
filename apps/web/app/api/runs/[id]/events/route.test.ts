import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET /api/runs/<id>/events`: the gate before the lookup, the cursor rules, the SSE
 * headers, and the engine receiving exactly the Run, cursor and signal the request named.
 * The route module is imported inside each test so the mocks are in effect when it is
 * evaluated (the `session-route.test.ts` template).
 */

const state = vi.hoisted(() => ({
  run: null as { runId: string } | null,
  opened: [] as Array<{ runId: string | null; after: number; signal: AbortSignal | undefined }>,
}));

vi.mock('@intellifin/infrastructure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intellifin/infrastructure')>();
  return {
    ...actual,
    DrizzleRunRepository: class {
      findRun(id: string) {
        return Promise.resolve(state.run !== null && state.run.runId === id ? state.run : null);
      }
    },
    openRunTimelineStream: (_deps: unknown, options: { runId: string | null; after: number; signal?: AbortSignal }) => {
      state.opened.push({ runId: options.runId, after: options.after, signal: options.signal });
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('retry: 2000\n\n'));
          controller.close();
        },
      });
    },
  };
});

const getRuntime = vi.fn();
vi.mock('../../../../../src/bootstrap', () => ({ getRuntime }));

const requireAction = vi.fn();
vi.mock('../../../../../src/require-role', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/require-role')>();
  return { ...actual, requireAction };
});

const RUN = '01a0a0a0-0000-7000-8000-000000000001';

async function call(path: string, headers: Record<string, string> = {}, id = RUN) {
  const { GET } = await import('./route');
  return GET(new Request(`https://audit.example.test${path}`, { headers }), { params: Promise.resolve({ id }) });
}

describe('GET /api/runs/<id>/events', () => {
  beforeEach(() => {
    state.run = { runId: RUN };
    state.opened.length = 0;
    getRuntime.mockReset();
    getRuntime.mockResolvedValue({ db: {}, sql: {} });
    requireAction.mockReset();
    requireAction.mockResolvedValue({ allowed: true, session: { userId: 'u', sessionId: 's' }, role: 'auditor' });
  });

  it('answers 401 before it resolves the Run, so a probe learns nothing from a missing one', async () => {
    requireAction.mockResolvedValue({ allowed: false, status: 401, reason: 'Sign in to continue.' });
    state.run = null;
    const response = await call(`/api/runs/${RUN}/events`);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    expect(state.opened).toHaveLength(0);
  });

  it('answers 403 with the denial reason', async () => {
    requireAction.mockResolvedValue({ allowed: false, status: 403, reason: 'Your role does not permit this action.' });
    const response = await call(`/api/runs/${RUN}/events`);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ reason: 'Your role does not permit this action.' });
  });

  it('answers 404 for a Run that is not there, after authorization', async () => {
    state.run = null;
    const response = await call(`/api/runs/${RUN}/events`);
    expect(response.status).toBe(404);
    expect(requireAction).toHaveBeenCalledTimes(1);
    expect(state.opened).toHaveLength(0);
  });

  it('answers 400 for a cursor that is not a non-negative integer', async () => {
    const response = await call(`/api/runs/${RUN}/events?after=abc`);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ reason: 'The cursor must be a non-negative integer.' });
    expect(state.opened).toHaveLength(0);
  });

  it('streams SSE for the Run, from the cursor, with the request signal', async () => {
    const response = await call(`/api/runs/${RUN}/events?after=7`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform');
    expect(await response.text()).toBe('retry: 2000\n\n');
    expect(state.opened).toEqual([{ runId: RUN, after: 7, signal: expect.any(AbortSignal) }]);
  });

  it('prefers Last-Event-ID over the query on a reconnect', async () => {
    const response = await call(`/api/runs/${RUN}/events?after=7`, { 'last-event-id': '11' });
    expect(response.status).toBe(200);
    expect(state.opened[0]?.after).toBe(11);
  });

  it('answers 503 and no driver detail when the runtime is unavailable', async () => {
    getRuntime.mockRejectedValue(new Error('connect ECONNREFUSED 10.1.2.3:5432'));
    const response = await call(`/api/runs/${RUN}/events`);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('ECONNREFUSED');
  });
});
