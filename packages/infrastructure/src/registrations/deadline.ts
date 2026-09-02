import type { DeadlinePort } from '@intellifin/application';

/**
 * The host timer, behind the application's {@link DeadlinePort}.
 *
 * The application layer has no ambient host types — that absence is what stops
 * `process.env` typechecking there (AD-11) — so it cannot reach `setTimeout` itself.
 * The policy (how long is too long) stays in the command; this is only the mechanism.
 *
 * The timer is always cleared, including on the happy path: an uncleared 5-second timer
 * per request keeps the event loop alive and, in a process that exits when idle, delays
 * shutdown for no reason.
 */
export class TimerDeadline implements DeadlinePort {
  async within<T>(work: Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`the call did not answer within ${String(milliseconds)}ms`));
          }, milliseconds);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
