import type { AuditUnitOfWork, ProceduresUnitOfWorkContext } from '@intellifin/application';

import {
  CryptoUuidV7Generator,
  SystemClock,
  createAuditEventWriter,
  type PostgresAuditDependencies,
} from '../db/audit-events.js';
import type { Clock, UuidV7Generator } from '@intellifin/application';
import type { Database } from '../db/client.js';
import { DrizzleProcedureWriter } from './procedure-repository.js';
import { DrizzlePopulationSourceReader } from '../sources/binding-repository.js';

/**
 * One PostgreSQL transaction carrying the audit appender AND the Procedure writer
 * (AD-8).
 *
 * The context is the guarantee: a Procedure command can reach exactly two writers and
 * both are bound to this transaction, so the Procedure row, its DRAFT version row and
 * the `lifecycle.procedure-created` event commit together or none of the three does.
 * Roll back and all of it disappears together.
 */
export class PostgresProceduresUnitOfWork implements AuditUnitOfWork<ProceduresUnitOfWorkContext> {
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
    work: (context: ProceduresUnitOfWorkContext) => Promise<TResult>,
  ): Promise<TResult> {
    return this.db.transaction(async (transaction) =>
      work({
        auditEvents: createAuditEventWriter(transaction, this.clock, this.ids),
        procedures: new DrizzleProcedureWriter(transaction),
        populationSources: new DrizzlePopulationSourceReader(transaction),
      }),
    );
  }
}
