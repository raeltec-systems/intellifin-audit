import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspacePrivacyCoordinator,
  type WorkspacePrivacyFence,
  type WorkspacePrivateToken,
} from './workspace-privacy-coordinator.js';

const identity = { runId: 'run-1', workspaceId: 'workspace-1', workspaceRevision: 3, runtimeId: 'runtime-1' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(options: ConstructorParameters<typeof WorkspacePrivacyCoordinator>[1] = {}) {
  let now = 1_000;
  const coordinator = new WorkspacePrivacyCoordinator(identity, {
    monotonic: () => now, wallTime: () => 1_800_000_000_000 + now, ...options,
  });
  return {
    coordinator,
    admit: () => coordinator.admitPublic(coordinator.status().fence),
    advance: (ms: number) => { now += ms; },
  };
}

afterEach(() => vi.useRealTimers());

describe('same-workspace privacy and preview coordinator', () => {
  it('starts unavailable and requires explicit initial safe admission', async () => {
    const { coordinator, admit } = fixture();
    const initial = coordinator.status().fence;
    const capture = vi.fn(async () => new Uint8Array([1]));
    expect(await coordinator.capturePreview(initial, capture)).toBe('unavailable');
    await expect(coordinator.runAction(initial, async () => {})).rejects.toMatchObject({ code: 'unavailable' });
    expect(capture).not.toHaveBeenCalled();
    expect(admit().privacyEpoch).toBe(1);
    expect(() => coordinator.admitPublic(initial)).toThrow('fenced');
    expect(() => admit()).toThrow('unavailable');
  });

  it.each([
    { runId: 'run-2' }, { workspaceId: 'workspace-2' }, { workspaceRevision: 4 },
    { runtimeId: 'runtime-2' }, { privacyEpoch: 0 },
  ])('fences a mismatched runtime identity %j on all public entry points', async (changed) => {
    const { coordinator, admit } = fixture();
    const current = admit();
    await coordinator.capturePreview(current, async () => new Uint8Array([2]));
    const wrong: WorkspacePrivacyFence = { ...current, ...changed };
    expect(coordinator.readLatest(wrong)).toBeNull();
    expect(await coordinator.capturePreview(wrong, async () => new Uint8Array([3]))).toBe('unavailable');
    await expect(coordinator.runAction(wrong, async () => {})).rejects.toMatchObject({ code: 'fenced' });
    await expect(coordinator.beginPrivate(wrong)).rejects.toMatchObject({ code: 'fenced' });
    expect(coordinator.status().fence).toEqual(current);
  });

  it('owns only the latest bounded frame; delivery copies do not alias it', async () => {
    const { coordinator, admit, advance } = fixture({ maxFrameBytes: 2 });
    const fence = admit();
    const source = new Uint8Array([1, 2]);
    expect(await coordinator.capturePreview(fence, async () => source)).toBe('published');
    expect(source).toEqual(new Uint8Array([0, 0]));
    const first = coordinator.readLatest(fence)!;
    first.bytes.fill(9);
    expect(coordinator.readLatest(fence)!.bytes).toEqual(new Uint8Array([1, 2]));
    advance(1_000);
    const oversized = new Uint8Array([1, 2, 3]);
    expect(await coordinator.capturePreview(fence, async () => oversized)).toBe('oversized');
    expect(oversized).toEqual(new Uint8Array(3));
    expect(coordinator.readLatest(fence)!.sequence).toBe(1);
    advance(1_000);
    await coordinator.capturePreview(fence, async () => new Uint8Array([3]));
    expect(coordinator.readLatest(fence)).toMatchObject({ sequence: 2, bytes: new Uint8Array([3]) });
  });

  it('expires a frame by capture age despite delivery polls and wall-clock changes', async () => {
    let wall = 200;
    const { coordinator, admit, advance } = fixture({ maxFrameAgeMs: 1_500, wallTime: () => wall });
    const fence = admit();
    await coordinator.capturePreview(fence, async () => { wall = 250; return new Uint8Array([1]); });
    expect(coordinator.readLatest(fence)).toMatchObject({ captureStartedAt: 200, captureCompletedAt: 250 });
    wall = -1_000;
    advance(1_501);
    expect(coordinator.readLatest(fence)).toBeNull();
  });

  it('drops an already stale screenshot completion instead of making its age new', async () => {
    const { coordinator, admit, advance } = fixture({ maxFrameAgeMs: 1_000 });
    const fence = admit();
    const source = new Uint8Array([1]);
    expect(await coordinator.capturePreview(fence, async () => {
      advance(1_001);
      return source;
    })).toBe('discarded');
    expect(source[0]).toBe(0);
    expect(coordinator.readLatest(fence)).toBeNull();
  });

  it('coalesces viewers into one capture slot and enforces the one-second interval', async () => {
    const { coordinator, admit, advance } = fixture();
    const fence = admit();
    const screenshot = deferred<Uint8Array>();
    const started = deferred<void>();
    const capture = vi.fn(async () => { started.resolve(); return screenshot.promise; });
    const first = coordinator.capturePreview(fence, capture);
    await started.promise;
    expect(await coordinator.capturePreview(fence, capture)).toBe('busy');
    screenshot.resolve(new Uint8Array([1]));
    expect(await first).toBe('published');
    expect(await coordinator.capturePreview(fence, capture)).toBe('throttled');
    advance(999);
    expect(await coordinator.capturePreview(fence, capture)).toBe('throttled');
    advance(1);
    expect(await coordinator.capturePreview(fence, async () => new Uint8Array([2]))).toBe('published');
    expect(capture).toHaveBeenCalledTimes(1);
    expect(coordinator.readLatest(fence)!.sequence).toBe(2);
  });

  it('reserves ordinary action priority while a capture drains, with no unbounded action queue', async () => {
    const { coordinator, admit, advance } = fixture();
    const fence = admit();
    const screenshot = deferred<Uint8Array>();
    const captureStarted = deferred<void>();
    const first = coordinator.capturePreview(fence, async () => {
      captureStarted.resolve(); return screenshot.promise;
    });
    await captureStarted.promise;
    const actionDone = deferred<string>();
    const actionStarted = deferred<void>();
    const action = coordinator.runAction(fence, async () => {
      actionStarted.resolve(); return actionDone.promise;
    });
    await expect(coordinator.runAction(fence, async () => 'second')).rejects.toMatchObject({ code: 'busy' });
    screenshot.resolve(new Uint8Array([1]));
    await first;
    await actionStarted.promise;
    advance(1_000);
    expect(await coordinator.capturePreview(fence, async () => new Uint8Array([2]))).toBe('busy');
    actionDone.resolve('complete');
    expect(await action).toBe('complete');
    expect(await coordinator.capturePreview(fence, async () => new Uint8Array([2]))).toBe('published');
  });

  it('invalidates the epoch and buffer before waiting for an in-flight screenshot', async () => {
    const { coordinator, admit, advance } = fixture();
    const fence = admit();
    await coordinator.capturePreview(fence, async () => new Uint8Array([1]));
    advance(1_000);
    const screenshot = deferred<Uint8Array>();
    const started = deferred<AbortSignal>();
    const sampling = coordinator.capturePreview(fence, async (signal) => {
      started.resolve(signal); return screenshot.promise;
    });
    const signal = await started.promise;
    const entering = coordinator.beginPrivate(fence);
    expect(coordinator.status()).toMatchObject({ mode: 'private-draining', fence: { privacyEpoch: 2 } });
    expect(coordinator.readLatest(fence)).toBeNull();
    expect(signal.aborted).toBe(true);
    let entered = false;
    void entering.then(() => { entered = true; });
    await Promise.resolve();
    expect(entered).toBe(false);
    const lateBytes = new Uint8Array([7, 8]);
    screenshot.resolve(lateBytes);
    expect(await sampling).toBe('discarded');
    const token = await entering;
    expect(lateBytes).toEqual(new Uint8Array(2));
    expect(coordinator.status().mode).toBe('private');
    expect(await coordinator.capturePreview(token.fence, async () => new Uint8Array([9]))).toBe('unavailable');
  });

  it('does not even start deferred capture work if private entry won before dispatch', async () => {
    const { coordinator, admit } = fixture();
    const fence = admit();
    const capture = vi.fn(async () => new Uint8Array([1]));
    const sampling = coordinator.capturePreview(fence, capture);
    const privateEntry = coordinator.beginPrivate(fence);
    expect(await sampling).toBe('discarded');
    await privateEntry;
    expect(capture).not.toHaveBeenCalled();
  });

  it('drains the complete public action and discards its crossing artifacts before private input', async () => {
    const { coordinator, admit } = fixture();
    const fence = admit();
    const result = deferred<Uint8Array>();
    const started = deferred<void>();
    const discard = vi.fn((value: Uint8Array) => value.fill(0));
    const action = coordinator.runAction(fence, async () => { started.resolve(); return result.promise; }, discard);
    const rejection = expect(action).rejects.toMatchObject({ code: 'fenced' });
    await started.promise;
    const entering = coordinator.beginPrivate(fence);
    await expect(coordinator.runAction(coordinator.status().fence, async () => {}))
      .rejects.toMatchObject({ code: 'unavailable' });
    const bytes = new Uint8Array([4]);
    result.resolve(bytes);
    await rejection;
    const token = await entering;
    expect(bytes[0]).toBe(0);
    expect(discard).toHaveBeenCalledOnce();
    expect(await coordinator.runPrivate(token, async () => 'private operation')).toBe('private operation');
  });

  it('refuses a queued public action when a private transition overtakes admission', async () => {
    const { coordinator, admit } = fixture();
    const fence = admit();
    const shot = deferred<Uint8Array>();
    const started = deferred<void>();
    const sampling = coordinator.capturePreview(fence, async () => { started.resolve(); return shot.promise; });
    await started.promise;
    const work = vi.fn(async () => {});
    const action = coordinator.runAction(fence, work);
    const rejected = expect(action).rejects.toMatchObject({ code: 'fenced' });
    const entering = coordinator.beginPrivate(fence);
    shot.resolve(new Uint8Array([1]));
    await sampling;
    await rejected;
    await entering;
    expect(work).not.toHaveBeenCalled();
  });

  it.each(['private', 'action'] as const)('a hung capture bounds %s admission but never reopens after timeout', async (kind) => {
    vi.useFakeTimers();
    const { coordinator, admit } = fixture({ drainTimeoutMs: 50 });
    const fence = admit();
    const shot = deferred<Uint8Array>();
    const started = deferred<void>();
    const sampling = coordinator.capturePreview(fence, async () => { started.resolve(); return shot.promise; });
    await started.promise;
    const work = vi.fn(async () => {});
    const admission = kind === 'private' ? coordinator.beginPrivate(fence) : coordinator.runAction(fence, work);
    const refusal = expect(admission).rejects.toMatchObject({ code: 'drain-timeout' });
    await vi.advanceTimersByTimeAsync(50);
    await refusal;
    expect(coordinator.status().mode).toBe(kind === 'private' ? 'private-blocked' : 'blocked');
    const bytes = new Uint8Array([9]);
    shot.resolve(bytes);
    expect(await sampling).toBe('discarded');
    expect(bytes[0]).toBe(0);
    expect(work).not.toHaveBeenCalled();
    expect(() => coordinator.admitPublic(coordinator.status().fence)).toThrow('unavailable');
    await expect(coordinator.beginPrivate(coordinator.status().fence)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('keeps one private input owner and only reopens after successful exclusive verification', async () => {
    const { coordinator } = fixture();
    const token = await coordinator.beginPrivate(coordinator.status().fence);
    const forged = { ...token } as WorkspacePrivateToken;
    await expect(coordinator.runPrivate(forged, async () => {})).rejects.toMatchObject({ code: 'fenced' });
    const input = deferred<void>();
    const started = deferred<void>();
    const active = coordinator.runPrivate(token, async () => { started.resolve(); return input.promise; });
    await started.promise;
    await expect(coordinator.runPrivate(token, async () => {})).rejects.toMatchObject({ code: 'busy' });
    await expect(coordinator.handback(token, async () => true)).rejects.toMatchObject({ code: 'busy' });
    input.resolve();
    await active;
    expect(await coordinator.handback(token, async () => false)).toBeNull();
    expect(coordinator.status().mode).toBe('private');
    await expect(coordinator.handback(token, async () => { throw new Error('verification failed'); }))
      .rejects.toThrow('verification failed');
    expect(coordinator.status().mode).toBe('private');
    const publicFence = await coordinator.handback(token, async () => true);
    expect(publicFence!.privacyEpoch).toBe(token.fence.privacyEpoch + 1);
    await expect(coordinator.runPrivate(token, async () => {})).rejects.toMatchObject({ code: 'fenced' });
    expect(await coordinator.runAction(publicFence!, async () => 7)).toBe(7);
  });

  it('cannot admit a new private operation between verification and public handback', async () => {
    const { coordinator } = fixture();
    const token = await coordinator.beginPrivate(coordinator.status().fence);
    const verify = deferred<boolean>();
    const input = vi.fn(async () => {});
    let attempted!: Promise<unknown>;
    void verify.promise.then(() => {
      queueMicrotask(() => { attempted = coordinator.runPrivate(token, input).catch(error => error); });
    });
    const returning = coordinator.handback(token, () => verify.promise);
    await Promise.resolve();
    verify.resolve(true);
    expect(await returning).not.toBeNull();
    expect(await attempted).toMatchObject({ code: expect.stringMatching(/busy|fenced/u) });
    expect(input).not.toHaveBeenCalled();
  });

  it.each(['revoke', 'close'] as const)('late verification cannot reopen after %s', async (mode) => {
    const { coordinator } = fixture();
    const token = await coordinator.beginPrivate(coordinator.status().fence);
    const verified = deferred<boolean>();
    const started = deferred<AbortSignal>();
    const handback = coordinator.handback(token, async signal => { started.resolve(signal); return verified.promise; });
    const rejection = expect(handback).rejects.toMatchObject({ code: 'fenced' });
    const signal = await started.promise;
    if (mode === 'revoke') coordinator.revokePrivate(token);
    else coordinator.close();
    expect(signal.aborted).toBe(true);
    verified.resolve(true);
    await rejection;
    expect(coordinator.status().mode).toBe(mode === 'revoke' ? 'private-blocked' : 'closed');
  });

  it('release fences late screenshot completion, clears bytes and is idempotent', async () => {
    const { coordinator, admit } = fixture();
    const fence = admit();
    const shot = deferred<Uint8Array>();
    const started = deferred<void>();
    const capture = coordinator.capturePreview(fence, async () => { started.resolve(); return shot.promise; });
    await started.promise;
    coordinator.close();
    const closed = coordinator.status();
    coordinator.close();
    expect(coordinator.status()).toEqual(closed);
    const bytes = new Uint8Array([1]);
    shot.resolve(bytes);
    expect(await capture).toBe('discarded');
    expect(bytes[0]).toBe(0);
    expect(coordinator.readLatest(fence)).toBeNull();
  });

  it('a capture failure releases its slot without falsely publishing a frame', async () => {
    const { coordinator, admit } = fixture();
    const fence = admit();
    await expect(coordinator.capturePreview(fence, async () => { throw new Error('capture failed'); }))
      .rejects.toThrow('capture failed');
    expect(coordinator.readLatest(fence)).toBeNull();
    expect(await coordinator.runAction(fence, async () => 1)).toBe(1);
  });

  it.each([
    { intervalMs: 999 }, { maxFrameBytes: 0 }, { maxFrameBytes: 8 * 1024 * 1024 + 1 },
    { drainTimeoutMs: Infinity }, { drainTimeoutMs: 30_001 }, { maxFrameAgeMs: NaN },
  ])('rejects invalid or unbounded limits %j', options => {
    expect(() => fixture(options)).toThrow('Invalid workspace coordination limit');
  });
});
