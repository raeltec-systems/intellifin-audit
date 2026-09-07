import {
  deliverNotifications,
  type NotificationRepository,
  type NotificationSender,
} from '@intellifin/application';

/**
 * The notification table is the durable queue. There is deliberately one polling loop for
 * both review notices and Run Escalations: the sender's conditional updates make a replay
 * safe, while this guard prevents one process from starting overlapping batches of its own.
 */
export interface NotificationWorkerOptions {
  /** How often to look for pending rows. Production uses one second like Story 2.7. */
  readonly intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 1_000;

/**
 * Start the single notification delivery loop and return its graceful stop operation.
 *
 * The first bounded batch is attempted immediately. A delivery failure is reported and the
 * next interval remains live so one malformed or temporarily unavailable row cannot disable
 * all later notifications. Shutdown clears the timer, then waits for the active batch before
 * returning; no new batch begins after shutdown starts.
 */
export function startNotificationWorker(
  repository: NotificationRepository,
  sender: NotificationSender,
  onError: (error: unknown) => void,
  options: NotificationWorkerOptions = {},
): () => Promise<void> {
  let pending: Promise<void> | undefined;
  let stopping = false;

  const tick = (): void => {
    if (stopping || pending !== undefined) return;
    pending = deliverNotifications(repository, sender)
      .catch((error: unknown) => {
        onError(error);
      })
      .finally(() => {
        pending = undefined;
      });
  };

  const timer = setInterval(tick, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  tick();

  return async (): Promise<void> => {
    stopping = true;
    clearInterval(timer);
    await pending;
  };
}
