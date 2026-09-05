import type { ExecutablePlan, FrozenPlanInputs } from '@intellifin/domain';

export interface ModelIdentity {
  readonly provider: string;
  readonly modelId: string;
  readonly promptVersion: string;
}
/** Provider names and credentials are deployment details; responses are untrusted data. */
export interface ModelGateway {
  readonly identity: ModelIdentity;
  derive(input: FrozenPlanInputs, compilerVersion: string): Promise<unknown>;
}
/** Only fixed, safe operational reasons may cross this port; never provider payloads. */
export class ModelGatewayError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}
export interface PlanDerivationAttempt {
  readonly attemptId: string;
  readonly inputDigest: string;
  readonly attemptedAt: string;
  readonly outcome: 'started' | 'success' | 'failure' | 'stale';
  readonly published?: boolean;
  readonly completedAt?: string;
  readonly jobId?: string;
  readonly reason: string | null;
  readonly model: ModelIdentity | null;
}
export interface PlanDerivationFields {
  readonly planCompilerVersion: string;
  readonly derivationModel: ModelIdentity | null;
  readonly compiledPlan: ExecutablePlan | null;
  readonly planInputDigest: string | null;
  readonly planStatus: 'pending' | 'succeeded' | 'failed';
  readonly planFailureReason: string | null;
  readonly planDerivable: boolean;
  readonly planAttempts: readonly PlanDerivationAttempt[];
}
export interface PlanDerivationJob {
  readonly schemaVersion: 1;
  readonly versionId: string;
  readonly inputDigest: string;
}
/** Bound to the same transaction as the saved Draft and audit event. */
export interface PlanDerivationQueue {
  enqueue(job: PlanDerivationJob): Promise<void>;
  hasLiveDelivery?(job: PlanDerivationJob): Promise<boolean>;
}
