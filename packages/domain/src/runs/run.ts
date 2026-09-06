import { isExplicitPeriod, type ExplicitPeriod } from '../procedures/population-draft.js';
export const RUN_STATES = ['QUEUED', 'RUNNING', 'PAUSED', 'AWAITING_AUDITOR', 'COMPLETED', 'INCONCLUSIVE', 'RUN_FAILED', 'CANCELED'] as const;
export type RunState = typeof RUN_STATES[number];
export type RunKind = 'STANDARD' | 'REGRESSION';
/**
 * One person's request that a Run stop (Story 3.10).
 *
 * Durable and carried on the Run row, so the owner of the Run's current stage reads it
 * from the state its own transaction just read rather than from a second query. It names
 * the requester, the session they asked from and the time — the three facts the Canceled
 * Run Detail state has to state — beside the reason it records.
 */
export interface RunCancellationRequest {
  readonly requestedBy: string;
  readonly sessionId: string;
  readonly requestedAt: string;
  readonly reason: string;
}
export interface RunRecord {
  readonly runId: string; readonly correlationId: string; readonly procedureId: string;
  readonly versionId: string; readonly versionNumber: number; readonly procedureName: string;
  readonly period: ExplicitPeriod; readonly state: RunState; readonly kind: RunKind;
  readonly initiatorId: string; readonly sessionId: string; readonly initiatedAt: string;
  readonly authorizationRole: string; readonly requestToken: string;
  /** The Run this one reruns, and why it exists. Both, or neither. */
  readonly predecessorRunId: string | null; readonly rerunReason: string | null;
  /** A person's durable cancellation request, or `null`. */
  readonly cancellation: RunCancellationRequest | null;
}

/**
 * The states in which a Run is still doing something (Story 3.10).
 *
 * The same four the partial unique index and `findActive` use, in ONE place: a second
 * spelling of this list is a second answer to "is this Run still running", and the two
 * would agree until the day they did not.
 */
export const ACTIVE_RUN_STATES = ['QUEUED', 'RUNNING', 'PAUSED', 'AWAITING_AUDITOR'] as const;
export type ActiveRunState = (typeof ACTIVE_RUN_STATES)[number];
export function isActiveRunState(state: unknown): state is ActiveRunState {
  return typeof state === 'string' && (ACTIVE_RUN_STATES as readonly string[]).includes(state);
}

/**
 * Who performs the `CANCELED` transition.
 *
 * `command` means the transition happens in the cancelling command's own transaction:
 * nothing is executing the Run, so leaving a request on it would mean the Run is
 * cancelled only if a worker eventually collects it — which is backwards.
 *
 * `worker` means the Run is held under a live lease by a worker that is mid-unit, so the
 * only safe place to stop is the boundary that worker already commits at. The request is
 * recorded and honoured there, never by interrupting a unit mid-commit.
 */
export type CancellationPerformer = 'command' | 'worker';

export interface RunCancelTransition {
  readonly from: ActiveRunState;
  readonly to: Extract<RunState, 'CANCELED'>;
  readonly performedBy: CancellationPerformer;
}

/**
 * The permitted cancellation transitions, as DATA (Story 3.10).
 *
 * All four active states are here even though Epic 3 produces only the first two: a table
 * that grows one row per epic ends up not being a table, which is the same reason the
 * whole §E state vocabulary and the whole §E.1 outcome table landed at once. `PAUSED` and
 * `AWAITING_AUDITOR` are `command` because neither is held by a worker mid-unit — a
 * paused Run has stopped and a Run awaiting an auditor is waiting on a person — so the
 * command that cancels is the only thing that can finish the job.
 *
 * The domain owns which states may be cancelled. No caller restates the list.
 */
export const RUN_CANCEL_TRANSITIONS: readonly RunCancelTransition[] = [
  { from: 'QUEUED', to: 'CANCELED', performedBy: 'command' },
  { from: 'RUNNING', to: 'CANCELED', performedBy: 'worker' },
  { from: 'PAUSED', to: 'CANCELED', performedBy: 'command' },
  { from: 'AWAITING_AUDITOR', to: 'CANCELED', performedBy: 'command' },
];

/**
 * The permitted transition out of one state, or `null` when there is none.
 *
 * `Array.prototype.find`, never an object index: the state can be read back out of a row
 * or off a URL, and `TABLE['constructor']` returning an inherited function has bitten this
 * repository seven times. A table walked in order cannot be reached that way at all.
 */
export function runCancelTransition(state: unknown): RunCancelTransition | null {
  return RUN_CANCEL_TRANSITIONS.find((row) => row.from === state) ?? null;
}

/**
 * The reason recorded when the person cancelling gave no note.
 *
 * EXPERIENCE.md makes cancel a ROUTINE confirmation — it restates the consequence and has
 * no rationale field, unlike the "routine with rationale" weight a Result rejection gets —
 * so the surface collects no text and this is what the marker, the Timeline event and the
 * Result then carry. A blank reason would read as a missing fact rather than as an absent
 * note, and the marker is immutable once written.
 */
export const RUN_CANCELED_DEFAULT_REASON = 'Canceled on request; no note was given.';

/** The reason a rerun records when the person starting it gave no note. Same rule. */
export const RUN_RERUN_DEFAULT_REASON = 'Rerun of a terminal Run; no note was given.';

/** The longest reason either command stores. The database refuses a longer one as well. */
export const RUN_REASON_MAX_LENGTH = 500;

/** Refusals both commands state, in the domain that owns the transition table. */
export const RUN_CANCEL_REFUSALS = {
  UNKNOWN: 'That Run does not exist.',
  ALREADY_TERMINAL: 'That Run has already ended, so it cannot be canceled.',
} as const;

export const RUN_RERUN_REFUSALS = {
  UNKNOWN: 'That Run does not exist.',
  STILL_ACTIVE: 'That Run has not ended yet. Cancel it or wait for it to end before starting a rerun.',
} as const;
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
