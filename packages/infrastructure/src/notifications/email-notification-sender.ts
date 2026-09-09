import type { EscalationNotification, InAppNotification, NotificationSender } from '@intellifin/application';
import type { Database } from '../db/client.js';
import { lockEscalationWait, recordEmailOutcome } from './notification-delivery.js';
import type { PostgresAuditDependencies } from '../db/audit-events.js';

/**
 * Email's explicit no-transport implementation.
 *
 * It records `unconfigured` transactionally and never claims that a message was sent. The
 * in-app sender also invokes the same operation for escalation rows, so the current worker's
 * existing single delivery loop records both channels without a second queue.
 */
export class EmailNotificationSender implements NotificationSender {
  constructor(
    private readonly db: Database,
    private readonly dependencies: PostgresAuditDependencies = {},
  ) {}

  async send(notification: InAppNotification): Promise<void> {
    if (notification.kind !== 'escalation') return;
    await this.db.transaction(async transaction => {
      const closed = await lockEscalationWait(transaction, notification);
      await recordEmailOutcome(
        transaction,
        notification,
        closed ? 'superseded' : 'unconfigured',
        this.dependencies,
      );
    });
  }
}
