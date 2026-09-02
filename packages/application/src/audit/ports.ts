import type {
  AuditChainVerificationResult,
  AuditEventDraft,
  AuditEventRecord,
} from '@intellifin/domain';

/** Append-only product audit-event port. There is deliberately no update/delete operation. */
export interface AuditEventWriter {
  append(event: AuditEventDraft): Promise<AuditEventRecord>;
}

/** Full-chain verification port. Results never contain payload data on failure. */
export interface AuditChainReader {
  verify(aggregateId: string): Promise<AuditChainVerificationResult>;
}

/** Repositories participating in a command extend this context with their own inward ports. */
export interface AuditUnitOfWorkContext {
  readonly auditEvents: AuditEventWriter;
}

/** One PostgreSQL transaction for the state change and its audit event(s), or none. */
export interface AuditUnitOfWork<TContext extends AuditUnitOfWorkContext = AuditUnitOfWorkContext> {
  execute<TResult>(work: (context: TContext) => Promise<TResult>): Promise<TResult>;
}
