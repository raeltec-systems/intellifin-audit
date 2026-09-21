import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspacePreviewMetadataStore } from '@intellifin/application';
import { WorkspacePreviewSession } from './workspace-preview-session.js';
const identity = { runId: 'run', workspaceId: 'page', workspaceRevision: 2, runtimeId: 'runtime' };
const viewer = { actorId: 'actor', sessionId: 'session' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const sessions: WorkspacePreviewSession[] = [];
afterEach(() => { sessions.forEach(s => s.close()); sessions.length = 0; vi.useRealTimers(); });
function fixture(capture = vi.fn(async (): Promise<Uint8Array | null> => new Uint8Array([1, 2]))) {
  const store: WorkspacePreviewMetadataStore = { claim: vi.fn(async () => 2), publish: vi.fn(async () => true), current: vi.fn(async () => true), authorized: vi.fn(async () => null) };
  const dispose = vi.fn(); const session = new WorkspacePreviewSession(identity, store, capture, dispose); sessions.push(session);
  return { session, capture, store, dispose };
}
async function open(session: WorkspacePreviewSession) { const token = await session.enterPrivate(); await session.handback(token, async () => true); }
describe('same-workspace preview lifecycle', () => {
  it('starts unavailable and needs a verified handback before sampling', async () => {
    vi.useFakeTimers(); const f = fixture();
    await f.session.read({ ...identity, privacyEpoch: 0 }, viewer); await vi.advanceTimersByTimeAsync(1000);
    expect(f.capture).not.toHaveBeenCalled();
    const token = await f.session.enterPrivate(); await f.session.handback(token, async () => false);
    await vi.advanceTimersByTimeAsync(1000); expect(f.capture).not.toHaveBeenCalled();
    await f.session.handback(token, async () => true); await vi.advanceTimersByTimeAsync(1000); expect(f.capture).toHaveBeenCalledOnce();
  });
  it('coalesces eight viewers, refuses a ninth, and stops sampling when demand expires', async () => {
    vi.useFakeTimers(); const f = fixture(); await open(f.session);
    for (let i = 0; i < 8; i++) expect(await f.session.read(f.session.metadata(), { actorId: String(i), sessionId: String(i) })).not.toBeNull();
    expect(await f.session.read(f.session.metadata(), viewer)).toBeNull();
    await vi.advanceTimersByTimeAsync(1000); expect(f.capture).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(6000); const count = f.capture.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000); expect(f.capture).toHaveBeenCalledTimes(count);
  });
  it('persists private epoch before returning permission for saved credential input, draining a crossing preview', async () => {
    vi.useFakeTimers(); const pending = deferred<Uint8Array>(); const f = fixture(vi.fn(() => pending.promise)); await open(f.session);
    await f.session.read(f.session.metadata(), viewer); await vi.advanceTimersByTimeAsync(1000);
    const publishing = deferred<boolean>(); vi.mocked(f.store.publish).mockReturnValueOnce(publishing.promise);
    const old = f.session.metadata(); const entering = f.session.enterPrivate(); let admitted = false; void entering.then(() => { admitted = true; });
    await Promise.resolve(); expect(f.session.coordinator.readLatest({ ...identity, privacyEpoch: old.privacyEpoch })).toBeNull(); expect(admitted).toBe(false);
    const bytes = new Uint8Array([99]); pending.resolve(bytes); await vi.advanceTimersByTimeAsync(0); expect(admitted).toBe(false);
    publishing.resolve(true); await entering; expect(bytes[0]).toBe(0); expect(admitted).toBe(true);
  });
  it('unsafe sampler results enter private and remove the prior frame', async () => {
    vi.useFakeTimers(); const f = fixture(); await open(f.session); await f.session.read(f.session.metadata(), viewer);
    await vi.advanceTimersByTimeAsync(1000); expect((await f.session.read(f.session.metadata(), viewer))?.bytes).not.toBeNull();
    f.capture.mockResolvedValueOnce(null); await vi.advanceTimersByTimeAsync(1000);
    expect(f.session.metadata().mode).toBe('private'); expect((await f.session.read(f.session.metadata(), viewer))?.bytes).toBeNull();
  });
  it('lost durable ownership disposes and cannot resume sampling', async () => {
    vi.useFakeTimers(); const f = fixture(); await open(f.session); await f.session.read(f.session.metadata(), viewer);
    vi.mocked(f.store.publish).mockResolvedValue(false); await vi.advanceTimersByTimeAsync(1000);
    expect(f.session.metadata().mode).toBe('closed'); expect(f.dispose).toHaveBeenCalled(); expect(f.capture).not.toHaveBeenCalled();
  });
});
