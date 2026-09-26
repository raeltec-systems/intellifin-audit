import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveTimelineEvent } from '../runs/useLiveTimeline';

const harness = vi.hoisted(() => ({
  refresh: vi.fn(),
  receive: null as ((event: LiveTimelineEvent) => void) | null,
  cleanup: null as (() => void) | null,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: harness.refresh }) }));
// Run the actual throttle and bell callback with fake time. Browser coverage below
// exercises the real React mount, subscription and server-rendered counts.
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => () => void) => { harness.cleanup = effect(); },
}));
vi.mock('../runs/useLiveTimeline', () => ({
  useLiveTimeline: (_url: string, _cursor: null, receive: (event: LiveTimelineEvent) => void) => { harness.receive = receive; },
}));
import { BellLive } from './BellLive';

function event(eventType = 'execution.escalation-raised'): void {
  harness.receive!({ runId: 'run', seq: 2, eventType, occurredAt: new Date().toISOString(), outcome: 'success', source: 'worker' });
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-26T00:00:00Z')); harness.refresh.mockReset(); BellLive(); });
afterEach(() => { harness.cleanup?.(); vi.useRealTimers(); });

describe('BellLive trailing refresh', () => {
  it('coalesces a burst into one deferred read that includes the final change', () => {
    let committed = 1;
    const rendered: number[] = [];
    harness.refresh.mockImplementation(() => rendered.push(committed));
    event();
    vi.advanceTimersByTime(100);
    committed = 2; event();
    vi.advanceTimersByTime(800);
    committed = 3; event('lifecycle.run-flagged');
    expect(rendered).toEqual([1]);
    vi.advanceTimersByTime(100);
    expect(rendered).toEqual([1, 3]);
    vi.advanceTimersByTime(2_000);
    expect(rendered).toEqual([1, 3]);
  });

  it('schedules a new trailing read for an event after the previous trailing read', () => {
    event(); vi.advanceTimersByTime(100); event(); vi.advanceTimersByTime(900);
    vi.advanceTimersByTime(100); event('lifecycle.result-sealed');
    expect(harness.refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(900);
    expect(harness.refresh).toHaveBeenCalledTimes(3);
  });

  it('ignores nonqualifying events and cancels a queued read on unmount', () => {
    event('evidence-access.read');
    expect(harness.refresh).not.toHaveBeenCalled();
    event(); vi.advanceTimersByTime(100); event();
    harness.cleanup!(); vi.advanceTimersByTime(1_000);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });
});
