import type { ExplicitPeriod, RunRecord } from '@intellifin/domain';
import type { AuditUnitOfWorkContext } from '../audit/ports.js';
import type { RoleRepository } from '../identity/ports.js';
import type { ProcedurePeriodOwnerReader } from '../procedures/ports.js';
export interface RunWriter {
  bindRequest(initiatorId: string, requestToken: string, runId: string): Promise<void>;
  findRequest(initiatorId: string, requestToken: string): Promise<RunRecord | null>;
  insert(run: RunRecord): Promise<boolean>;
  findActive(procedureId: string, period: ExplicitPeriod): Promise<RunRecord | null>;
}
export interface RunReader { findRun(runId: string): Promise<RunRecord | null> }
export interface RunDispatch { enqueue(job: { schemaVersion: 1; runId: string; correlationId: string }): Promise<void> }
export interface RunsUnitOfWorkContext extends AuditUnitOfWorkContext {
  readonly authorizationRoles: RoleRepository; readonly procedures: ProcedurePeriodOwnerReader;
  readonly runs: RunWriter; readonly dispatch: RunDispatch;
  notifyTimeline(runId: string, sequence: number): Promise<void>;
}
