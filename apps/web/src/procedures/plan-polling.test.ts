import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAN_POLL_BUDGET_MS, startPlanPolling } from './plan-polling';

afterEach(() => { vi.useRealTimers(); });
describe('pending plan refresh budget', () => {
  it('backs off, stops after two minutes and reports prolonged pending once', () => {
    vi.useFakeTimers();
    const refresh = vi.fn(), prolonged = vi.fn();
    startPlanPolling(refresh, prolonged);
    vi.advanceTimersByTime(1499); expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2999); expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1); expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(PLAN_POLL_BUDGET_MS - 4500);
    expect(prolonged).toHaveBeenCalledTimes(1);
    const calls = refresh.mock.calls.length;
    expect(calls).toBeLessThan(16);
    vi.advanceTimersByTime(600000);
    expect(refresh).toHaveBeenCalledTimes(calls);
    expect(prolonged).toHaveBeenCalledTimes(1);
  });
  it('cancels a previous digest or terminal result and starts a fresh budget', () => {
    vi.useFakeTimers();
    const oldRefresh = vi.fn(), oldProlonged = vi.fn();
    const stop = startPlanPolling(oldRefresh, oldProlonged);
    vi.advanceTimersByTime(5000); stop();
    const nextRefresh = vi.fn(), nextProlonged = vi.fn();
    const stopNext = startPlanPolling(nextRefresh, nextProlonged);
    vi.advanceTimersByTime(1500);
    expect(oldRefresh).toHaveBeenCalledTimes(2);
    expect(nextRefresh).toHaveBeenCalledTimes(1);
    stopNext(); vi.advanceTimersByTime(PLAN_POLL_BUDGET_MS);
    expect(oldProlonged).not.toHaveBeenCalled();
    expect(nextProlonged).not.toHaveBeenCalled();
  });
});
