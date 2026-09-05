import { mintPlatformDraft, type Clock, type UuidV7Generator, type ProcedureChangeHandler, type ProceduresUnitOfWorkContext } from '@intellifin/application';
import type { Transaction } from '../db/client.js';
import { createAuditEventWriter } from '../db/audit-events.js';
import { DrizzleProcedureWriter } from './procedure-repository.js';
import { transactionDerivationQueue } from './derivation-queue.js';
import { DrizzlePopulationSourceReader } from '../sources/binding-repository.js';
import { DrizzleTargetSystemRegistrationReader } from '../registrations/registration-repository.js';
import { DrizzleNotificationWriter } from '../notifications/notification-repository.js';
import { DrizzleNotificationRecipientReader, DrizzleRoleRepository } from '../identity/role-repository.js';

/** Infrastructure joins public module ports; every adapter retains the caller's transaction. */
export function transactionProcedureChangeHandler(transaction: Transaction, clock: Clock, ids: UuidV7Generator): ProcedureChangeHandler {
  const context: ProceduresUnitOfWorkContext = { procedures: new DrizzleProcedureWriter(transaction), auditEvents: createAuditEventWriter(transaction, clock, ids),
    derivationJobs: transactionDerivationQueue(transaction), populationSources: new DrizzlePopulationSourceReader(transaction), targetRegistrations: new DrizzleTargetSystemRegistrationReader(transaction),
    notifications: new DrizzleNotificationWriter(transaction), notificationRecipients: new DrizzleNotificationRecipientReader(transaction), authorizationRoles: new DrizzleRoleRepository(transaction) };
  return {
    async count(kind, id) { return new Set((await context.procedures.listActiveVersions!({ kind, id })).map(row => row.procedureId)).size; },
    handle(change) { return mintPlatformDraft(context, ids, change); },
  };
}
