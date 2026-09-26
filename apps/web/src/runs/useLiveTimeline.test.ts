import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[], index: 0,
  effects: [] as { deps: readonly unknown[]; cleanup?: (() => void) | undefined }[], effectIndex: 0,
}));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useRef: (value: unknown) => {
    const index = hooks.index++;
    hooks.slots[index] ??= { current: value };
    return hooks.slots[index];
  },
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = value; }];
  },
  useEffect: (effect: () => (() => void) | undefined, deps: readonly unknown[]) => {
    const index = hooks.effectIndex++;
    const previous = hooks.effects[index];
    if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
      previous?.cleanup?.();
      hooks.effects[index] = { deps, cleanup: effect() };
    }
  },
}));
import { liveGateReason, LIVE_LOST_MS, LIVE_STALE_MS } from './live-status';
import { useLiveTimeline } from './useLiveTimeline';

class Source extends EventTarget {
  static CLOSED = 2;
  static instances: Source[] = [];
  readyState = 1;
  close = vi.fn();
  constructor(readonly url: string) { super(); Source.instances.push(this); }
  frame(seq: number, eventType = 'execution.capture-registered'): void {
    this.dispatchEvent(new MessageEvent('timeline', { data: JSON.stringify({ runId: 'run', seq, eventType, occurredAt: new Date().toISOString(), outcome: 'success', source: 'worker' }) }));
  }
}
let url = '';
let serial = 0;
const receive = vi.fn();
function render(cursor: number | null = 5, target = url) {
  hooks.index = 0; hooks.effectIndex = 0;
  return useLiveTimeline(target, cursor, receive);
}
function source(): Source { return Source.instances.at(-1)!; }
function unmount(): void {
  for (const effect of hooks.effects) effect.cleanup?.();
  hooks.slots = []; hooks.effects = [];
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-26T00:00:00Z'));
  vi.stubGlobal('window', {}); vi.stubGlobal('EventSource', Source);
  Source.instances = []; receive.mockReset(); url = `/api/runs/test-${++serial}/events`;
});
afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('stream health belongs to frames, never to the server cursor', () => {
  it('keeps the lost gate closed through a cursor refresh and a React remount', () => {
    render(); source().dispatchEvent(new Event('heartbeat'));
    expect(render().status).toBe('live');
    vi.advanceTimersByTime(LIVE_LOST_MS);
    expect(liveGateReason(render().status, false)).toBe('lost');
    const old = source();
    expect(render(8).status).toBe('lost');
    expect(old.close).toHaveBeenCalledOnce();
    source().dispatchEvent(new Event('open'));
    expect(render(8).status).toBe('lost');
    unmount();
    expect(render(9).status).toBe('lost');
    expect(liveGateReason(render(9).status, false)).toBe('lost');
    source().dispatchEvent(new Event('heartbeat'));
    expect(render(9).status).toBe('live');
    expect(liveGateReason(render(9).status, false)).toBeNull();
  });

  it('does not postpone stale or lost for an initially silent stream', () => {
    expect(render().status).toBe('connecting');
    source().dispatchEvent(new Event('open'));
    expect(render().status).toBe('connecting');
    vi.advanceTimersByTime(LIVE_STALE_MS);
    expect(render(6).status).toBe('stale');
    unmount();
    expect(render(7).silence).toBe(15);
    vi.advanceTimersByTime(LIVE_LOST_MS - LIVE_STALE_MS);
    expect(render(8).status).toBe('lost');
  });

  it('accepts a replayed frame as health without delivering it twice', () => {
    render(); source().frame(6); expect(receive).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(LIVE_LOST_MS); expect(render().status).toBe('lost');
    source().frame(6);
    expect(render().status).toBe('live');
    expect(receive).toHaveBeenCalledTimes(1);
    source().frame(7); expect(render().lastSeq).toBe(7);
    expect(receive).toHaveBeenCalledTimes(2);
  });

  it('does not recover on malformed data or a transport open after permanent closure', () => {
    render(); source().readyState = Source.CLOSED; source().dispatchEvent(new Event('error'));
    expect(render().status).toBe('ended');
    render(7); source().dispatchEvent(new Event('open'));
    source().dispatchEvent(new MessageEvent('timeline', { data: '{}' }));
    source().frame(1.5);
    expect(render(7).status).toBe('ended');
    source().frame(8); expect(render(7).status).toBe('live');
  });

  it('refuses incomplete envelopes as recovery, but accepts a complete future event family', () => {
    render(); vi.advanceTimersByTime(LIVE_LOST_MS);
    const valid = { runId: 'run', seq: 6, eventType: 'future.new-event', occurredAt: new Date().toISOString(), outcome: 'success', source: 'worker' };
    for (const malformed of [
      { runId: '', seq: 1, eventType: '' },
      ...['runId', 'eventType', 'occurredAt', 'outcome', 'source'].flatMap(field => [
        { ...valid, [field]: '' }, { ...valid, [field]: '   ' }, { ...valid, [field]: undefined },
      ]),
      { ...valid, occurredAt: 'not a timestamp' }, { ...valid, seq: 0 },
    ]) {
      source().dispatchEvent(new MessageEvent('timeline', { data: JSON.stringify(malformed) }));
      expect(render().status).toBe('lost');
      expect(liveGateReason(render().status, render().runEnded)).toBe('lost');
    }
    expect(receive).not.toHaveBeenCalled();
    source().dispatchEvent(new MessageEvent('timeline', { data: JSON.stringify(valid) }));
    expect(render().status).toBe('live'); expect(receive).toHaveBeenCalledOnce();
  });

  it('keeps the per-Run terminal latch closed through remount and heartbeat recovery', () => {
    render(); source().frame(6, 'lifecycle.result-sealed');
    expect(liveGateReason(render().status, render().runEnded)).toBe('runEnded');
    unmount();
    expect(liveGateReason(render(6).status, render(6).runEnded)).toBe('runEnded');
    source().dispatchEvent(new Event('heartbeat'));
    expect(render(6).status).toBe('live');
    expect(liveGateReason(render(6).status, render(6).runEnded)).toBe('runEnded');
    unmount();
    render(null, '/api/runs/events'); source().frame(7, 'lifecycle.result-sealed');
    expect(render(null, '/api/runs/events').runEnded).toBe(false);
    unmount();
    expect(render(0, `${url}-other`).runEnded).toBe(false);
  });

  it('isolates a different Run and removes every old listener on cleanup', () => {
    render(); const old = source(); old.frame(6);
    vi.advanceTimersByTime(LIVE_LOST_MS);
    expect(render(2, `${url}-other`).status).toBe('connecting');
    expect(source().url).toContain('after=2');
    old.frame(7); expect(receive).toHaveBeenCalledTimes(1);
    unmount(); source().frame(3); expect(receive).toHaveBeenCalledTimes(1);
  });
});
