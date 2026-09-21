import { describe, expect, it, vi } from 'vitest';
import { withTrackedBrowserIo } from './browser-io-tracker.js';
import { withActionDeadline } from './web-tree-capture.js';

describe('underlying browser I/O ownership', () => {
  it('fences a deadline wrapper that returned while its actual browser operation is pending', async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    const underlying = new Promise<string>(done => { resolve = done; });
    const fence = vi.fn();
    const work = withTrackedBrowserIo(() => withActionDeadline(() => underlying, Date.now() + 10), fence);
    const failed = expect(work).rejects.toThrow('Tool Action deadline exceeded');
    await vi.advanceTimersByTimeAsync(11); await failed;
    expect(fence).toHaveBeenCalledOnce();
    resolve('late'); await underlying; expect(fence).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
  it('tracks nested registered-capture promises beyond an expired parent wrapper', async () => {
    vi.useFakeTimers();
    let settle!: () => void;
    const fence = vi.fn();
    const screenshot = new Promise<void>(done => { settle = done; });
    const operation = withTrackedBrowserIo(() => withActionDeadline(async () => {
      await withActionDeadline(() => screenshot, Date.now() + 100);
    }, Date.now() + 10), fence);
    const failed = expect(operation).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(11); await failed;
    expect(fence).toHaveBeenCalledOnce(); settle(); await vi.runAllTimersAsync(); vi.useRealTimers();
  });
  it('keeps successful settled I/O admitted and isolates concurrent workspaces', async () => {
    const fence = vi.fn();
    expect(await withTrackedBrowserIo(() => withActionDeadline(async () => 7, Date.now() + 100), fence)).toBe(7);
    expect(fence).not.toHaveBeenCalled();
  });
});
