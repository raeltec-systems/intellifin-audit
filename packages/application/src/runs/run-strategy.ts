import { canonicalJson, sha256Hex, type JsonValue, type SanitizedToolAction, type ToolActionParameter } from '@intellifin/domain';
import type { AgentApprovedTool } from './agent-ports.js';
import { eligibleLookupCapabilities, planAgentTools, type AgentToolPlannerInput } from './agent-tool-planner.js';

/** Stable unit identity; progress narration and unrelated Run revisions are excluded. */
export interface RunStrategyAnchor {
  readonly runId: string; readonly workItemId: string; readonly attemptId: string; readonly stepExecutionId: string;
  readonly targetSystemId: string; readonly subjectKey: string; readonly planDigest: string; readonly graphDigest: string;
  readonly nodeId: 'p1.full-name'; readonly snapshotEvidenceId: string;
  readonly prerequisiteEvidenceIds: readonly string[]; readonly prerequisiteActionIds: readonly string[];
}
export interface RunStrategyProposalAnchor extends RunStrategyAnchor { readonly controlEpoch: number }
export interface RunStrategyOpportunity {
  readonly anchor: RunStrategyAnchor;
  readonly tool: AgentApprovedTool;
  readonly parameters: readonly ToolActionParameter[];
}
export type RunStrategyRead = { readonly available: true; readonly anchor: RunStrategyProposalAnchor; readonly targetLabel: string; readonly label: 'Full name search' }
  | { readonly available: false; readonly reason: string };
export interface ClaimedRunStrategy { readonly commandId: string; readonly toolActionId: string }
export interface RunStrategyWorkerPort {
  /** Publishes only a freshly computed opportunity from committed Evidence. */
  publishStrategyOpportunity(opportunity: RunStrategyOpportunity | null): Promise<void>;
  /** Linearization before I/O: fresh role, controller, unit, evidence and safety checks. */
  claimStrategy(opportunity: RunStrategyOpportunity | null, toolActionId: string): Promise<ClaimedRunStrategy | null>;
  /** Called in the same transaction as the exact existing Tool Action registration. */
  completeStrategy(commandId: string, action: SanitizedToolAction): Promise<void>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const KEYS = ['runId','workItemId','attemptId','stepExecutionId','targetSystemId','subjectKey','planDigest','graphDigest','nodeId','snapshotEvidenceId','prerequisiteEvidenceIds','prerequisiteActionIds','controlEpoch'];
export function parseRunStrategyAnchor(value: unknown): RunStrategyProposalAnchor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== KEYS.length || !KEYS.every(key => Object.hasOwn(v, key)) ||
    !['runId','workItemId','attemptId','stepExecutionId','snapshotEvidenceId'].every(key => typeof v[key] === 'string' && UUID.test(v[key])) ||
    typeof v.targetSystemId !== 'string' || !v.targetSystemId || v.targetSystemId.length > 255 ||
    typeof v.subjectKey !== 'string' || !v.subjectKey || v.subjectKey.length > 512 || !v.subjectKey.isWellFormed() ||
    typeof v.planDigest !== 'string' || !HASH.test(v.planDigest) || typeof v.graphDigest !== 'string' || !HASH.test(v.graphDigest) ||
    v.nodeId !== 'p1.full-name' || typeof v.controlEpoch !== 'number' || !Number.isInteger(v.controlEpoch) || v.controlEpoch < 1 || v.controlEpoch > 2147483647 ||
    !['prerequisiteEvidenceIds','prerequisiteActionIds'].every(key => Array.isArray(v[key]) && v[key].length === 1 && v[key].every(id => typeof id === 'string' && UUID.test(id)))) return null;
  return v as unknown as RunStrategyProposalAnchor;
}
export function strategyAnchorMeaning(anchor: RunStrategyAnchor): string { return canonicalJson(anchor as unknown as JsonValue); }
export function sameStrategyAnchor(a: RunStrategyAnchor, b: RunStrategyAnchor): boolean { return strategyAnchorMeaning(a) === strategyAnchorMeaning(b); }
export function strategyOpportunity(input: AgentToolPlannerInput): RunStrategyOpportunity | null {
  if (input.plan.schemaVersion !== 2 || !input.runId || !input.workItemId || !input.attemptId || !input.stepExecutionId) return null;
  const eligible = eligibleLookupCapabilities(input).find(option => option.node.id === 'p1.full-name');
  if (!eligible) return null;
  const planned = planAgentTools({ ...input, selectedStrategyId: eligible.node.id });
  const tool = planned.tools.length === 1 ? planned.tools[0] : undefined;
  const subjectKey = input.population.values.employee_id;
  if (!tool || tool.action !== 'search' || typeof subjectKey !== 'string') return null;
  return { anchor: { runId: input.runId, workItemId: input.workItemId, attemptId: input.attemptId, stepExecutionId: input.stepExecutionId,
    targetSystemId: input.target.registrationId, subjectKey, nodeId: 'p1.full-name', snapshotEvidenceId: input.snapshot.evidenceId,
    planDigest: sha256Hex(canonicalJson(input.plan as unknown as JsonValue)), graphDigest: sha256Hex(canonicalJson(input.plan.capabilityGraph as unknown as JsonValue)),
    prerequisiteEvidenceIds: eligible.prerequisiteEvidenceIds, prerequisiteActionIds: eligible.prerequisiteActionIds },
    tool, parameters: planned.parametersByToolId[tool.toolId] ?? [] };
}

/** Blob I/O stays outside transactions. Registered metadata and digest validation are
 * repeated for every search/control snapshot before a retained selection is consumed. */
export async function refreshStrategyOpportunity(input: AgentToolPlannerInput,
  evidence: readonly import('./execution-ports.js').AdapterEvidenceRecord[],
  store: import('./execution-ports.js').EvidenceStore, budget: () => number): Promise<RunStrategyOpportunity | null> {
  const original = strategyOpportunity(input);
  if (!original) return null;
  const { readRegisteredArtifact } = await import('./evidence-package.js');
  const snapshots = new Map<string, import('@intellifin/domain').StoredSnapshot>();
  for (const snapshot of [input.snapshot, ...input.searches.flatMap(search => search.controlSnapshot ? [search.snapshot,search.controlSnapshot] : [search.snapshot])]) {
    const row = evidence.find(row => row.evidenceId === snapshot.evidenceId);
    if (!row || row.state !== 'REGISTERED' || row.kind !== 'structural-snapshot' || row.registrationId !== input.target.registrationId || row.size === null || !row.digest) return null;
    const bytes = await readRegisteredArtifact(store,row,budget);
    if (!bytes) return null;
    snapshots.set(snapshot.evidenceId,{...snapshot,bytes});
  }
  const fresh = strategyOpportunity({...input,snapshot:snapshots.get(input.snapshot.evidenceId)!,searches:input.searches.map(search => ({...search,
    snapshot:snapshots.get(search.snapshot.evidenceId)!, ...(search.controlSnapshot ? {controlSnapshot:snapshots.get(search.controlSnapshot.evidenceId)!} : {})}))});
  return fresh && canonicalJson(fresh as unknown as JsonValue) === canonicalJson(original as unknown as JsonValue) ? fresh : null;
}
