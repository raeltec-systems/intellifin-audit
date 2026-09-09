import { beforeEach, describe, expect, it, vi } from 'vitest';

/** `GET /api/runs/events`: the same gate as the Runs list, and a list-mode engine. */

const state = vi.hoisted(() => ({ opened: [] as Array<{ runId: string | null; after: number }> }));

vi.mock('@intellifin/infrastructure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intellifin/infrastructure')>();
  return {
    ...actual,
    openRunTimelineStream: (_deps: unknown, options: { runId: string | null; after: number }) => {
      state.opened.push({ runId: options.runId, after: options.after });
      return new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    },
  };
});

const getRuntime = vi.fn();
vi.mock('../../../../src/bootstrap', () => ({ getRuntime }));

const requireAction = vi.fn();
vi.mock('../../../../src/require-role', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/require-role')>();
  return { ...actual, requireAction };
});

async function call() {
  const { GET } = await import('./route');
  return GET(new Request('https://audit.example.test/api/runs/events'));
}

describe('GET /api/runs/events', () => {
  beforeEach(() => {
    state.opened.length = 0;
    getRuntime.mockReset();
    getRuntime.mockResolvedValue({ db: {}, sql: {} });
    requireAction.mockReset();
  });

  it('is gated like the Runs list', async () => {
    requireAction.mockResolvedValue({ allowed: false, status: 401, reason: 'Sign in to continue.' });
    expect((await call()).status).toBe(401);
    expect(state.opened).toHaveLength(0);
  });

  it('opens the list-mode engine: every Run, no cursor', async () => {
    requireAction.mockResolvedValue({ allowed: true, session: { userId: 'u', sessionId: 's' }, role: 'auditor' });
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(state.opened).toEqual([{ runId: null, after: 0 }]);
  });
});
