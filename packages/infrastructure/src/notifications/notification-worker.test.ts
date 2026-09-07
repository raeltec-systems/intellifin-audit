import { describe, expect, it, vi } from 'vitest';
import type {
  InAppNotification,
  NotificationRepository,
  NotificationSender,
} from '@intellifin/application';
import { startNotificationWorker } from './notification-worker.js';

const notice: InAppNotification = {
  sendKey: 'review:one',
  recipientId: 'manager',
  procedureId: 'procedure',
  versionId: 'version',
  procedureName: 'Terminated users',
  versionNumber: 1,
  kind: 'submitted',
};

function repository(pending: readonly InAppNotification[] = [notice]): NotificationRepository & { calls: number } {
  let calls = 0;
  return {
    get calls() { return calls; },
    pending: vi.fn(async () => {
      calls += 1;
      return pending;
    }),
    deliveredFor: vi.fn(async () => ({ items: [], nextCursor: null })),
  };
}

describe('the single notification delivery loop', () => {
  it('delivers immediately and does not overlap a second batch', async () => {
    const source = repository();
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const active = new Promise<void>((resolve) => { started = resolve; });
    const sender: NotificationSender = {
      send: vi.fn(async () => {
        started();
        await held;
      }),
    };
    const stop = startNotificationWorker(source, sender, vi.fn(), { intervalMs: 1 });
    await active;
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(source.calls).toBe(1);
    expect(sender.send).toHaveBeenCalledOnce();
    release();
    await stop();
  });

  it('reports a failed batch and retries it on the next interval', async () => {
    const source = repository();
    const onError = vi.fn();
    const sender: NotificationSender = {
      send: vi.fn()
        .mockRejectedValueOnce(new Error('temporary delivery failure'))
        .mockResolvedValue(undefined),
    };
    const stop = startNotificationWorker(source, sender, onError, { intervalMs: 1 });
    try {
      await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(source.calls).toBeGreaterThan(1));
      expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    } finally {
      await stop();
    }
  });

  it('stops scheduling and waits for the active batch', async () => {
    const source = repository();
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const active = new Promise<void>((resolve) => { started = resolve; });
    const sender: NotificationSender = {
      send: vi.fn(async () => {
        started();
        await held;
      }),
    };
    const stop = startNotificationWorker(source, sender, vi.fn(), { intervalMs: 1 });
    await active;
    let stopped = false;
    const stopping = stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
    expect(source.calls).toBe(1);
  });
});
