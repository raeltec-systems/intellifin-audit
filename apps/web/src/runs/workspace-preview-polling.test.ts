import { afterEach, describe, expect, it, vi } from 'vitest';
import { startWorkspacePreviewPolling } from './workspace-preview-polling';

afterEach(() => vi.useRealTimers());
describe('sequential preview polling cadence', () => {
  it('includes fetch/decode/check work inside each second instead of adding it to the interval', async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    let active = 0, peak = 0;
    const stop = startWorkspacePreviewPolling(async () => {
      starts.push(performance.now()); active++; peak = Math.max(peak, active);
      await new Promise<void>(resolve => setTimeout(resolve, 250)); active--;
    });
    await vi.advanceTimersByTimeAsync(2500);
    stop();
    expect(starts.map(value => value - starts[0]!)).toEqual([0, 1000, 2000]);
    expect(peak).toBe(1);
  });

  it('waits for slow work and resumes once without overlap or queued catch-up polls', async () => {
    vi.useFakeTimers();
    const releases: Array<() => void> = [];
    const poll = vi.fn(() => new Promise<void>(resolve => releases.push(resolve)));
    const stop = startWorkspacePreviewPolling(poll);
    await vi.advanceTimersByTimeAsync(3500);
    expect(poll).toHaveBeenCalledTimes(1);
    releases[0]!();
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(poll).toHaveBeenCalledTimes(2);
    stop(); releases[1]!();
    await vi.advanceTimersByTimeAsync(5000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('cancels a scheduled poll and keeps failures on the same bounded cadence', async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => { throw new Error('Synthetic unavailable response'); });
    const stop = startWorkspacePreviewPolling(poll);
    await vi.advanceTimersByTimeAsync(999);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(poll).toHaveBeenCalledTimes(2);
  });
});
