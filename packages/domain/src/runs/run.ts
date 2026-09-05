import { isExplicitPeriod, type ExplicitPeriod } from '../procedures/population-draft.js';
export const RUN_STATES = ['QUEUED', 'RUNNING', 'PAUSED', 'AWAITING_AUDITOR', 'COMPLETED', 'INCONCLUSIVE', 'RUN_FAILED', 'CANCELED'] as const;
export type RunState = typeof RUN_STATES[number];
export type RunKind = 'STANDARD' | 'REGRESSION';
export interface RunRecord {
  readonly runId: string; readonly correlationId: string; readonly procedureId: string;
  readonly versionId: string; readonly versionNumber: number; readonly procedureName: string;
  readonly period: ExplicitPeriod; readonly state: RunState; readonly kind: RunKind;
  readonly initiatorId: string; readonly sessionId: string; readonly initiatedAt: string;
  readonly authorizationRole: string; readonly requestToken: string;
}
export interface ActivatedVersion { readonly versionId: string; readonly state: string }
export interface SuccessionEdge { readonly predecessorId: string; readonly successorId: string; readonly activatedAt: string | null; readonly handoverAt: string | null }
/** Walk the stored chain. Neither approval time nor version number expresses succession. */
export function periodOwner(versions: readonly ActivatedVersion[], edges: readonly SuccessionEdge[], period: ExplicitPeriod): string | null {
  if (!isExplicitPeriod(period)) return null;
  const nodes = new Map(versions.map(v => [v.versionId, v]));
  if (nodes.size !== versions.length || nodes.size === 0) return null;
  const incoming = new Map<string, SuccessionEdge>(), outgoing = new Map<string, SuccessionEdge>();
  for (const edge of edges) {
    if (edge.activatedAt === null) continue;
    if (!nodes.has(edge.predecessorId) || !nodes.has(edge.successorId) || incoming.has(edge.successorId) || outgoing.has(edge.predecessorId) || edge.predecessorId === edge.successorId) return null;
    if (!Number.isFinite(Date.parse(edge.activatedAt)) || (edge.handoverAt !== null && (!Number.isFinite(Date.parse(edge.handoverAt)) || Date.parse(edge.handoverAt) <= Date.parse(edge.activatedAt)))) return null;
    incoming.set(edge.successorId, edge); outgoing.set(edge.predecessorId, edge);
  }
  const roots = versions.filter(v => !incoming.has(v.versionId));
  if (roots.length !== 1) return null;
  let current = roots[0]!.versionId, owner = current, lower: number | null = null;
  const visited = new Set<string>(), start = Date.parse(`${period.from}T00:00:00.000Z`);
  while (!visited.has(current)) {
    visited.add(current);
    const edge = outgoing.get(current);
    if (!edge) break;
    const boundary = edge.handoverAt === null ? null : Date.parse(edge.handoverAt);
    if (boundary !== null && lower !== null && boundary < lower) return null;
    lower = boundary;
    if (boundary === null || start >= boundary) owner = edge.successorId;
    current = edge.successorId;
  }
  if (visited.size !== nodes.size || outgoing.has(current)) return null;
  return nodes.get(owner)?.state === 'ACTIVE' ? owner : null;
}


export function isInitiationRequestToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
