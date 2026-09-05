import type { ProcedureSourceSnapshot, ProcedureTargetSnapshot } from '@intellifin/domain';
import type { ModelIdentity } from './plan-ports.js';
/** Private transaction data, never an audit payload; owns the exact post-change snapshot. */
export type ProcedureConfigurationChange =
  | { readonly changeId: string; readonly kind: 'registration'; readonly snapshot: ProcedureTargetSnapshot }
  | { readonly changeId: string; readonly kind: 'source'; readonly snapshot: ProcedureSourceSnapshot }
  | { readonly changeId: string; readonly kind: 'model' | 'prompt' | 'tool'; readonly revision: string; readonly model: ModelIdentity | null };
export interface ProcedureChangeHandler {
  count(kind: 'registration' | 'source', id: string): Promise<number>;
  handle(change: ProcedureConfigurationChange): Promise<readonly string[]>;
}
