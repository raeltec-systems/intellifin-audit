import type {
  AuditUnitOfWork,
  IdentityUnitOfWorkContext,
  UserCreator,
} from '@intellifin/application';

import type { Database } from '../db/client.js';
import {
  CryptoUuidV7Generator,
  SystemClock,
  createAuditEventWriter,
  type PostgresAuditDependencies,
} from '../db/audit-events.js';
import type { Clock, UuidV7Generator } from '@intellifin/application';
import { DrizzleRoleWriter, DrizzleSessionWriter } from './role-repository.js';
import { BetterAuthUserCreator } from './user-creator.js';
import type { AuthConfig } from './auth.js';

/**
 * One PostgreSQL transaction carrying the audit appender AND the three identity writers
 * (FR-45, AD-8).
 *
 * `PostgresAuditUnitOfWork` gives a command the appender alone, which is right for a
 * command whose only write IS the event. The administration commands write state as
 * well, and that state must not be able to commit without its event — so they get a
 * context in which every writer is bound to the same transaction and no other writer is
 * reachable. Roll back and the account, the role and the event all disappear together.
 */
export class PostgresIdentityUnitOfWork implements AuditUnitOfWork<IdentityUnitOfWorkContext> {
  private readonly clock: Clock;
  private readonly ids: UuidV7Generator;

  constructor(
    private readonly db: Database,
    /** Needed only to build the privileged account creator; never used to serve a route. */
    private readonly authConfig: AuthConfig,
    dependencies: PostgresAuditDependencies = {},
  ) {
    this.clock = dependencies.clock ?? new SystemClock();
    this.ids = dependencies.ids ?? new CryptoUuidV7Generator();
  }

  execute<TResult>(
    work: (context: IdentityUnitOfWorkContext) => Promise<TResult>,
  ): Promise<TResult> {
    return this.db.transaction(async (transaction) => {
      /**
       * Built on first use, not on every transaction.
       *
       * `BetterAuthUserCreator` constructs `createSeedAuth` — the ONE sign-up-capable
       * identity instance in the process. Constructing it eagerly meant every identity
       * transaction built it: every sign-out, and every `security.denied` append from a
       * refused authorization. A privileged object that exists on paths which never
       * create a user is a privilege sitting where nothing needs it, and it is wasted
       * work on the commonest path. It is now built only when a command actually asks
       * for `users`.
       */
      let creator: UserCreator | undefined;
      const users: UserCreator = {
        createUser: (account) =>
          (creator ??= new BetterAuthUserCreator(transaction, this.authConfig)).createUser(
            account,
          ),
      };

      return work({
        auditEvents: createAuditEventWriter(transaction, this.clock, this.ids),
        roles: new DrizzleRoleWriter(transaction),
        users,
        sessions: new DrizzleSessionWriter(transaction),
      });
    });
  }
}
