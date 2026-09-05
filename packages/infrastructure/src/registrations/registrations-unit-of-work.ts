import { transactionProcedureChangeHandler } from '../procedures/configuration-change.js';
import { sql } from 'drizzle-orm';
import type { AuditUnitOfWork, RegistrationsUnitOfWorkContext } from '@intellifin/application';

import {
  CryptoUuidV7Generator,
  SystemClock,
  createAuditEventWriter,
  type PostgresAuditDependencies,
} from '../db/audit-events.js';
import type { Clock, UuidV7Generator } from '@intellifin/application';
import type { Database } from '../db/client.js';
import { DrizzleRegistrationWriter } from './registration-repository.js';

/**
 * One PostgreSQL transaction carrying the audit appender AND the registration writer
 * (FR-45, AD-8).
 *
 * The context is the guarantee: a registration command can reach exactly two writers and
 * both are bound to this transaction, so a registration cannot commit while its
 * `RegistrationChanged` event fails. Roll back and the row and the event disappear
 * together.
 */
export class PostgresRegistrationsUnitOfWork
  implements AuditUnitOfWork<RegistrationsUnitOfWorkContext>
{
  private readonly clock: Clock;
  private readonly ids: UuidV7Generator;

  constructor(
    private readonly db: Database,
    dependencies: PostgresAuditDependencies = {},
  ) {
    this.clock = dependencies.clock ?? new SystemClock();
    this.ids = dependencies.ids ?? new CryptoUuidV7Generator();
  }

  execute<TResult>(
    work: (context: RegistrationsUnitOfWorkContext) => Promise<TResult>,
  ): Promise<TResult> {
    return this.db.transaction(async (transaction) => {
      // First lock across all three module UOWs: prevents inversions and Active-set phantoms.
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(20428, 1)`);
      return work({
        procedureChanges: transactionProcedureChangeHandler(transaction, this.clock, this.ids),
        auditEvents: createAuditEventWriter(transaction, this.clock, this.ids),
        registrations: new DrizzleRegistrationWriter(transaction),
      });
    });
  }
}
