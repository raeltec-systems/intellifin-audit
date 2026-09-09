import type { RunRecord, SanitizedToolAction } from '@intellifin/domain';
import type { AdapterExecutionContext, WorkspaceRef } from './execution-ports.js';
import type { RunWait, EscalationKind, EscalationOption } from './waits.js';
import type { AgentModelIdentity, AgentModelResponse } from './agent-ports.js';

/** Operational progress only. Evidence and Observations use the existing shared tables. */
export interface AgentWorkCheckpoint {
  readonly revision: number;
  readonly status: 'EXECUTING' | 'RETRY' | 'WAITING' | 'COMPLETE' | 'TERMINAL';
  readonly runStartedAt: string;
  readonly leaseUntil: string;
  readonly attemptId: string;
  readonly workItemId: string | null;
  readonly waitId: string | null;
  readonly pendingWait: { readonly kind: EscalationKind; readonly options: readonly EscalationOption[]; readonly retainedDecisionWaitIds?: readonly string[] } | null;
  readonly nextTurn: number;
  /** Actual provider usage; never replaced with a guessed zero after a paid call. */
  readonly tokens: number;
  /** Conservatively charged when a claimed provider turn has an unknown outcome. */
  readonly reservedTokens: number;
  readonly model: AgentModelIdentity | null;
  readonly diagnostic: string | null;
}

/** One leased model turn. The request contains Evidence references, never credentials. */
export interface AgentTurnRecord {
  readonly sequence: number;
  readonly workItemId: string;
  readonly stepExecutionId: string;
  readonly snapshotEvidenceId: string;
  readonly status: 'RESERVED' | 'COMPLETED' | 'FAILED';
  readonly reservedTokens: number;
  readonly response: AgentModelResponse | null;
  readonly diagnostic: string | null;
}

export interface AgentWaitRaise { readonly runId: string; readonly waitId: string; readonly stepId: string; readonly supportingEvidenceIds: readonly string[] }

export interface AgentWorkContext extends Omit<AdapterExecutionContext, 'checkpoint' | 'saveCheckpoint'> {
  checkpoint: AgentWorkCheckpoint | null;
  workspace: WorkspaceRef | null;
  /** Sign-in and extraction completed, with no pending workspace provisioning/retry. */
  prerequisitesReady: boolean;
  turns: readonly AgentTurnRecord[];
  toolActions: readonly SanitizedToolAction[];
  captures: readonly { evidenceId: string; toolActionId: string; sourceLocation: string }[];
  wait: RunWait | null;
  /** Immutable provenance of the wait currently attached to this checkpoint. */
  waitRaise: AgentWaitRaise | null;
  /** At most the candidate choice and unnamed-value acknowledgement retained for this item. */
  retainedDecisions: readonly { readonly wait: RunWait; readonly raised: AgentWaitRaise }[];
  saveCheckpoint(checkpoint: AgentWorkCheckpoint, state: RunRecord['state']): Promise<void>;
  saveTurn(turn: AgentTurnRecord): Promise<void>;
  saveToolAction(action: SanitizedToolAction): Promise<void>;
  saveCapture(binding: { evidenceId: string; toolActionId: string; sourceLocation: string }): Promise<void>;
}

export interface AgentWorkRepository {
  transaction<T>(runId: string, work: (context: AgentWorkContext) => Promise<T>): Promise<T>;
  recoverableRunIds(limit: number): Promise<string[]>;
}
