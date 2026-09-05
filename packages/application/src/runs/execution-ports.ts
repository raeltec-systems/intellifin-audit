import type {
  ExplicitPeriod,
  ProcedureSourceSnapshot,
  ExecutablePlan,
  RunRecord,
  PopulationResult,
} from '@intellifin/domain';
import type { AuditEventWriter } from '../audit/ports.js';

export interface PopulationAcquisitionPort {
  acquire(
    source: ProcedureSourceSnapshot,
    period: ExplicitPeriod,
    timeoutMs: number,
  ): Promise<{
    bytes: Uint8Array;
    mediaType: string;
    declaration: unknown;
  }>;
}
export interface EvidenceStore {
  read(key: string, timeoutMs: number): Promise<Uint8Array | null>;
  putIfAbsent(key: string, bytes: Uint8Array, timeoutMs: number): Promise<void>;
}
export class PopulationAcquisitionError extends Error {
  constructor(readonly code: 'transport' | 'integrity' | 'contract') {
    super(`Population acquisition ${code} failure`);
  }
}
export interface PopulationCheckpoint {
  revision: number;
  status: 'ACQUIRING' | 'RETRY' | 'POPULATION_READY' | 'TERMINAL';
  attempts: number;
  startedAt: string;
  attemptStartedAt: string;
  leaseUntil: string;
  evidenceId: string;
  objectKey: string;
  envelopeKey: string;
  rawDigest: string | null;
  size: number | null;
  diagnostic: string | null;
  envelopeDigest: string | null;
  stepId: string;
  attemptId: string;
}
export interface PopulationExecutionContext {
  run: RunRecord | null;
  checkpoint: PopulationCheckpoint | null;
  auditEvents: AuditEventWriter;
  frozenPlan(): Promise<ExecutablePlan | null>;
  save(
    checkpoint: PopulationCheckpoint,
    state: RunRecord['state'],
    result?: PopulationResult,
  ): Promise<void>;
  notifyTimeline(sequence: number): Promise<void>;
}
export interface PopulationExecutionRepository {
  transaction<T>(
    runId: string,
    work: (context: PopulationExecutionContext) => Promise<T>,
  ): Promise<T>;
  recoverableRunIds(limit: number): Promise<string[]>;
}
