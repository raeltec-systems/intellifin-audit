import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FRAME_LOCATOR } from '@intellifin/application';

import { EVIDENCE_GRANT_DOWNLOAD_FAILURES } from '../../../../../../src/runs/evidence-grant-download';

/**
 * `GET /api/runs/<id>/frames/<evidenceId>`: the gate before the lookup, the frame scope,
 * the conditional read, and the grant the route asks for. The module is imported inside
 * each test so the mocks are in effect when it is evaluated (the `session-route.test.ts`
 * template, the same one the events route follows).
 */

const RUN = '01a0a0a0-0000-7000-8000-000000000001';
const EVIDENCE = '01a0a0a0-0000-7000-8000-0000000000f1';
const DIGEST = 'c'.repeat(64);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

const state = vi.hoisted(() => ({
  run: null as { runId: string } | null,
  frame: null as { evidenceId: string; digest: string } | null,
  requested: [] as Array<{ runId: string; evidenceId: string; locator: string; actorId: string }>,
  grant: { ok: true, grantId: 'g-1' } as { ok: true; grantId: string } | { ok: false; reason: string },
  read: null as unknown,
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
    DrizzleRunDetailRepository: class {
      readFrame(runId: string, evidenceId: string) {
        return Promise.resolve(
          state.frame !== null && runId === state.run?.runId && evidenceId === state.frame.evidenceId
            ? state.frame
            : null,
        );
      }
    },
    PostgresEvidenceReadGrantRepository: class {
      reportIntegrityMismatch() { return Promise.resolve(); }
    },
  };
});

vi.mock('@intellifin/application', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intellifin/application')>();
  return {
    ...actual,
    requestEvidenceReadGrant: (_deps: unknown, input: { request: { runId: string; evidenceId: string; locator: string }; session: { userId: string } }) => {
      state.requested.push({ ...input.request, actorId: input.session.userId });
      return Promise.resolve(state.grant);
    },
  };
});

const readFrameWithGrant = vi.fn();
vi.mock('../../../../../../src/runs/evidence-frame-reader', () => ({ readFrameWithGrant }));

const getRuntime = vi.fn();
vi.mock('../../../../../../src/bootstrap', () => ({ getRuntime }));

const requireAction = vi.fn();
vi.mock('../../../../../../src/require-role', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../src/require-role')>();
  return { ...actual, requireAction };
});

async function call(headers: Record<string, string> = {}, id = RUN, evidenceId = EVIDENCE) {
  const { GET } = await import('./route');
  return GET(new Request(`https://audit.example.test/api/runs/${id}/frames/${evidenceId}`, { headers }), {
    params: Promise.resolve({ id, evidenceId }),
  });
}

describe('GET /api/runs/<id>/frames/<evidenceId>', () => {
  beforeEach(() => {
    state.run = { runId: RUN };
    state.frame = { evidenceId: EVIDENCE, digest: DIGEST };
    state.requested.length = 0;
    state.grant = { ok: true, grantId: 'g-1' };
    getRuntime.mockResolvedValue({ db: {} });
    requireAction.mockResolvedValue({ allowed: true, session: { userId: 'user-1' } });
    readFrameWithGrant.mockReset();
    readFrameWithGrant.mockResolvedValue({
      frame: { bytes: PNG, mediaType: 'image/png', digest: DIGEST, size: PNG.byteLength },
      failure: null,
    });
    // No `vi.resetModules()`: the route holds no module state — every fact it reads comes
    // through `state` or a mock — and resetting forces a full re-transform of the
    // workspace graph on each of these cases, which is what made the first one time out.
  });

  it('authorizes BEFORE it resolves the Run, so a probe learns nothing from a 404', async () => {
    requireAction.mockResolvedValue({ allowed: false, reason: 'Your role does not permit this action.', status: 403 });
    state.run = null;
    const response = await call();
    expect(response.status).toBe(403);
    // The refusal must not have needed a Run at all: nothing was looked up.
    expect(state.requested).toEqual([]);
  });

  it('answers 404 for a Run that is not there and for an artifact that is not a frame', async () => {
    state.run = null;
    expect((await call()).status).toBe(404);
    state.run = { runId: RUN };
    state.frame = null;
    expect((await call()).status).toBe(404);
    expect(state.requested).toEqual([]);
  });

  it('asks for a grant naming exactly this Run, this artifact, this actor and the frame locator', async () => {
    await call();
    expect(state.requested).toEqual([
      { runId: RUN, evidenceId: EVIDENCE, locator: FRAME_LOCATOR, actorId: 'user-1' },
    ]);
  });

  it('serves the verified bytes as an inert PNG that cannot be sniffed into something else', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe(String(PNG.byteLength));
    expect(response.headers.get('etag')).toBe(`"${DIGEST}"`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it('revalidates with the digest and answers 304 without asking for a grant', async () => {
    const response = await call({ 'if-none-match': `"${DIGEST}"` });
    expect(response.status).toBe(304);
    // The role was still checked; only the store read was skipped.
    expect(requireAction).toHaveBeenCalled();
    expect(state.requested).toEqual([]);
    expect(readFrameWithGrant).not.toHaveBeenCalled();
  });

  it('does not answer 304 for a different digest', async () => {
    expect((await call({ 'if-none-match': `"${'d'.repeat(64)}"` })).status).toBe(200);
  });

  it('maps a grant the worker has not signed yet to a retryable 503', async () => {
    readFrameWithGrant.mockResolvedValue({ frame: null, failure: 'grant-unavailable' });
    const response = await call();
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('2');
  });

  it('answers 403 when the role was lost between the request and the download', async () => {
    readFrameWithGrant.mockResolvedValue({ frame: null, failure: 'access-denied' });
    expect((await call()).status).toBe(403);
  });

  it.each([
    'download-object-missing',
    'download-digest-mismatch',
    'download-size-mismatch',
    'download-media-type-mismatch',
    'download-redirected',
    'download-too-large',
    'download-failed',
    'capability-mismatch',
  ] as const)('answers 502 rather than serving bytes the Run did not register (%s)', async (failure) => {
    readFrameWithGrant.mockResolvedValue({ frame: null, failure });
    const response = await call();
    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('maps every failure the reader can produce, so none falls through as a 200', async () => {
    const { FRAME_FAILURE_STATUS } = await import('./route');
    // Read off the reader's own union rather than a copy of this route's table: a new
    // failure added there without a status here is what would otherwise become
    // `undefined`, which `Response` rejects at runtime.
    for (const failure of [...EVIDENCE_GRANT_DOWNLOAD_FAILURES, 'frame-locator-mismatch'] as const) {
      expect(Object.hasOwn(FRAME_FAILURE_STATUS, failure), failure).toBe(true);
      expect(FRAME_FAILURE_STATUS[failure as keyof typeof FRAME_FAILURE_STATUS]).toBeGreaterThanOrEqual(400);
    }
  });

  it('never echoes a driver error to the caller', async () => {
    getRuntime.mockRejectedValue(new Error('password authentication failed for user "audit"'));
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('password');
  });
});
