import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_CREDENTIALS, type BrowserActionResult, type BrowserToolAction, type WorkspacePreviewMetadataStore } from '@intellifin/application';
import { PlaywrightBrowserExecution } from './browser-execution.js';
import { WorkspacePreviewSession } from './workspace-preview-session.js';
import { withActionDeadline } from './web-tree-capture.js';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const ref = { runId: 'run', workspaceId: 'workspace', mode: 'local' as const };
const result: BrowserActionResult = { status: 200, method: 'GET', location: 'http://localhost:4300/loancore', redirected: false, downloads: 0, session: true, artifacts: [] };
const action: BrowserToolAction = { action: 'navigate', destination: result.location, credential: null, capture: [] };
const signIn: BrowserToolAction = { action: 'navigate', destination: result.location, authenticationDestination: `${result.location}/sign-in`, credential: {} as never };
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.forEach(fn => fn()); cleanups.length = 0; vi.useRealTimers(); });
async function fixture() {
  const store: WorkspacePreviewMetadataStore = { claim: vi.fn(async () => 1), publish: vi.fn(async () => true), current: vi.fn(async () => true), authorized: vi.fn(async () => null) };
  const execution = new PlaywrightBrowserExecution({ mode: 'local' }, { runtimeId: 'runtime', store });
  const page = { evaluate: vi.fn(async () => true), screenshot: vi.fn(async (): Promise<Uint8Array> => new Uint8Array([1])), isClosed: () => false, url: () => result.location, close: vi.fn(async () => {}) };
  const live = { ref, page, preview: null as WorkspacePreviewSession | null, previewOpening: null, previewFenced: false, authPost: null,
    browser: { isConnected: () => true, close: vi.fn(async () => {}) }, context: { close: vi.fn(async () => {}) }, allowed: () => true };
  (Reflect.get(execution, 'live') as Map<string, unknown>).set(ref.workspaceId, live);
  // Replace only the already-tested action implementation; all adapter ownership,
  // private entry, sampler and actual deadline tracking below are production wiring.
  const perform = vi.fn(async (): Promise<BrowserActionResult> => result);
  Reflect.set(execution, 'performUncoordinated', perform);
  await execution.perform(ref, action, 1000);
  cleanups.push(() => live.preview?.close());
  return { execution, live, page, perform, store, preview: live.preview! };
}
describe('LiveWorkspace preview and stored sign-in admission', () => {
  it.each(['preview', 'registered capture'] as const)('drains actual %s completion before dispatching saved sign-in', async kind => {
    vi.useFakeTimers(); const f = await fixture(); const pending = deferred<Uint8Array>(); let crossing: Promise<unknown>;
    if (kind === 'preview') {
      f.page.screenshot.mockImplementationOnce(() => pending.promise);
      await f.execution.read(f.preview.metadata(), { actorId: 'actor', sessionId: 'session' });
      await vi.advanceTimersByTimeAsync(1000); crossing = Promise.resolve();
    } else {
      f.perform.mockImplementationOnce(async () => {
        const bytes = await withActionDeadline(() => pending.promise, Date.now() + 5000);
        return { ...result, artifacts: [{ kind: 'screenshot', bytes, mediaType: 'image/png', location: result.location }] };
      });
      crossing = f.execution.perform(ref, { ...action, credential: null, capture: ['screenshot'] }, 5000, NO_CREDENTIALS);
      void crossing.catch(() => {}); await vi.advanceTimersByTimeAsync(0);
    }
    const count = f.perform.mock.calls.length; const login = f.execution.perform(ref, signIn, 5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.preview.metadata().mode).toBe('private'); expect(f.perform).toHaveBeenCalledTimes(count);
    const bytes = new Uint8Array([77]); pending.resolve(bytes);
    if (kind === 'registered capture') await expect(crossing).rejects.toBeDefined();
    await login; expect(bytes[0]).toBe(0); expect(f.perform).toHaveBeenCalledTimes(count + 1);
    expect(f.preview.metadata().mode).toBe('public');
  });
  it('a timed-out actual operation permanently fences the workspace and never admits later sign-in', async () => {
    vi.useFakeTimers(); const f = await fixture(); const pending = deferred<Uint8Array>();
    f.perform.mockImplementationOnce(async () => { await withActionDeadline(() => pending.promise, Date.now() + 10); return result; });
    const running = f.execution.perform(ref, action, 10); const rejected = expect(running).rejects.toMatchObject({ code: 'unavailable' });
    await vi.advanceTimersByTimeAsync(11); await rejected;
    await expect(f.execution.perform(ref, signIn, 1000)).rejects.toMatchObject({ code: 'unavailable' });
    expect(f.live.previewFenced).toBe(true); expect(f.page.close).toHaveBeenCalled();
    expect(await f.execution.attach(ref)).toBeNull();
    pending.resolve(new Uint8Array([1]));
  });
  it('does not hand back failed authentication or capture from a private gap', async () => {
    const f = await fixture(); f.perform.mockResolvedValueOnce({ ...result, session: false });
    await f.execution.perform(ref, signIn, 1000); expect(f.preview.metadata().mode).toBe('private');
    const count = f.perform.mock.calls.length;
    await expect(f.execution.perform(ref, { ...action, credential: null, capture: ['screenshot'] }, 1000, NO_CREDENTIALS)).rejects.toMatchObject({ code: 'unavailable' });
    expect(f.perform).toHaveBeenCalledTimes(count);
  });
  it('samples the existing Page once for multiple viewers without creating or resizing it', async () => {
    vi.useFakeTimers(); const f = await fixture();
    await f.execution.read(f.preview.metadata(), { actorId: 'a', sessionId: 'a' }); await f.execution.read(f.preview.metadata(), { actorId: 'b', sessionId: 'b' });
    await vi.advanceTimersByTimeAsync(1000); expect(f.page.screenshot).toHaveBeenCalledOnce();
    expect(f.page.screenshot).toHaveBeenCalledWith({ type: 'jpeg', quality: 70, timeout: 2000 });
    const first = await f.execution.read(f.preview.metadata(), { actorId: 'a', sessionId: 'a' });
    const second = await f.execution.read(f.preview.metadata(), { actorId: 'b', sessionId: 'b' });
    expect(first?.bytes).toEqual(second?.bytes); expect(first?.metadata.sequence).toBe(second?.metadata.sequence);
  });
});
