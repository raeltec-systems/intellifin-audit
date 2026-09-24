import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspacePreviewMetadataStore } from '@intellifin/application';
import { WorkspacePreviewProxy } from './workspace-preview-transport.js';
const metadata = { runId: 'run', runtimeId: 'runtime', workspaceRevision: 1, privacyEpoch: 2, mode: 'public' as const, sequence: 3, capturedAt: 1000, captureCompletedAt: 1100, expiresAt: 5000 };
const viewer = { actorId: 'actor', sessionId: 'session' };
function fixture() {
  const store: WorkspacePreviewMetadataStore = { claim: vi.fn(async () => 1), publish: vi.fn(async () => true), current: vi.fn(async () => true), authorized: vi.fn(async () => metadata) };
  const fetcher = vi.fn(async () => Response.json({ metadata, image: 'AQI=' })); vi.stubGlobal('fetch', fetcher);
  return { store, fetcher, proxy: new WorkspacePreviewProxy(4311, 'synthetic-test-secret-32-characters', store) };
}
afterEach(() => vi.unstubAllGlobals());
describe('application-owned preview proxy', () => {
  it('signs exact actor/session/runtime/epoch and routes only to the fixed owner without redirects or cache', async () => {
    const f = fixture(); expect(await f.proxy.read('run', viewer, true)).toEqual({ metadata, image: 'AQI=' });
    const [url, init] = f.fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:4311/preview'); expect(init).toMatchObject({ redirect: 'error', cache: 'no-store' });
    expect(JSON.parse(String(init.body))).toMatchObject({ ...viewer, runId: 'run', identity: metadata });
    expect(init.headers).toMatchObject({ 'x-preview-signature': expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
  it('refuses revoked sessions before touching the broker and after bytes arrive', async () => {
    const f = fixture(); vi.mocked(f.store.authorized).mockResolvedValueOnce(null);
    expect(await f.proxy.read('run', viewer, true)).toBeNull(); expect(f.fetcher).not.toHaveBeenCalled();
    vi.mocked(f.store.authorized).mockResolvedValueOnce(metadata).mockResolvedValueOnce(null);
    expect(await f.proxy.read('run', viewer, true)).toBeNull();
  });
  it.each([{ runtimeId: 'new' }, { privacyEpoch: 3 }, { workspaceRevision: 2 }])('discards crossing runtime or private metadata: %j', async changed => {
    const f = fixture(); vi.mocked(f.store.authorized).mockResolvedValueOnce(metadata).mockResolvedValueOnce({ ...metadata, ...changed });
    expect(await f.proxy.read('run', viewer, true)).toBeNull();
  });
  it('never attributes old pixels to a newer sequence and never returns pixels for status reads', async () => {
    const f = fixture(); vi.mocked(f.store.authorized).mockResolvedValueOnce(metadata).mockResolvedValueOnce({ ...metadata, sequence: 4 });
    expect((await f.proxy.read('run', viewer, true))?.image).toBeNull();
    expect((await f.proxy.read('run', viewer, false))?.image).toBeNull();
  });
  it('bounds the body and projects source errors to unavailable', async () => {
    const f = fixture(); f.fetcher.mockResolvedValueOnce(new Response('x'.repeat(710001)));
    expect(await f.proxy.read('run', viewer, true)).toBeNull();
    f.fetcher.mockRejectedValueOnce(new Error('secret target login URL'));
    expect(await f.proxy.read('run', viewer, true)).toBeNull();
  });
});
