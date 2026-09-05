import type { ExecutablePlan } from '../procedures/executable-plan.js';
import { PLAN_LOOKUP_COLUMNS } from '../procedures/executable-plan.js';
import { isAgentDrivenKind, type ProcedureTargetSnapshot } from '../procedures/target-draft.js';

/**
 * Session Step, Work Item and Step Execution vocabularies, their permitted transitions,
 * and the classification that decides which frozen `extract-adapter` step is a Reference
 * Source acquisition and which is an adapter-acquired Target System (addendum §E).
 *
 * Pure. No I/O, no clock, no host types.
 *
 * **The classification reads bytes that are already frozen.** `makePlan` emits one
 * `extract-adapter` Session Step per non-agent-driven Target in authored order, and
 * `inputs.targets[].contract.kind` is frozen beside it. A `versioned-file` Target is
 * consulted by the evaluator and owns no Work Items (addendum C P-2 names RoleMatrix
 * exactly that way), so its step is Reference Source acquisition; an `api` Target is
 * adapter-acquired and owns exactly one Work Item. Nothing here adds or renames an
 * action, and no canonical plan byte moves, so every ACTIVE version stays executable.
 *
 * The spec for this story wrote the two kinds as `read-only-api` and
 * `versioned-file`/`manual-upload`. Those are the POPULATION SOURCE binding vocabulary;
 * a Target System registration's `kind` is `web | desktop | api | versioned-file`
 * (`TARGET_SYSTEM_KINDS`), and `manual-upload` is not a Target System kind at all. The
 * frozen bytes decide, so `api` is the adapter-acquired kind here.
 */

/** A Reference Source acquisition, which is a Run-level Session Step (addendum §E). */
export const SESSION_STEP_STATES = ['PENDING', 'IN_PROGRESS', 'ACQUIRED', 'FAILED'] as const;
export type SessionStepState = (typeof SESSION_STEP_STATES)[number];

/** Addendum §E, verbatim vocabulary. `AWAITING` is the retry-or-skip Escalation state. */
export const WORK_ITEM_STATES = [
  'PENDING',
  'IN_PROGRESS',
  'AWAITING',
  'OBSERVED',
  'UNINSPECTED',
  'AMBIGUOUS',
  'FAILED',
] as const;
export type WorkItemState = (typeof WORK_ITEM_STATES)[number];

/** One attempt at one frozen plan step. */
export const STEP_EXECUTION_STATES = ['RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type StepExecutionState = (typeof STEP_EXECUTION_STATES)[number];

const SESSION_STEP_TRANSITIONS: Readonly<Record<SessionStepState, readonly SessionStepState[]>> = {
  PENDING: ['IN_PROGRESS'],
  // A failed acquisition is retried under a fresh claim, so IN_PROGRESS -> PENDING is
  // a real edge; the attempt counter, not the state, is what bounds it.
  IN_PROGRESS: ['ACQUIRED', 'FAILED', 'PENDING'],
  ACQUIRED: [],
  FAILED: [],
};

/**
 * Addendum §E: `PENDING → IN_PROGRESS → OBSERVED | UNINSPECTED | AMBIGUOUS | FAILED`;
 * `AMBIGUOUS → IN_PROGRESS` when a choose-candidate answer resolves it;
 * `IN_PROGRESS → AWAITING → IN_PROGRESS | UNINSPECTED` when a Step Execution's retry
 * limit is exhausted; `FAILED` only when the retry cycle is also exhausted.
 *
 * The whole table lands now, exactly as the `procedure_version.state` CHECK carried the
 * whole §E vocabulary from its first commit. A machine that grows one arrow per story
 * ends up not being a machine. Story 3.3 drives PENDING, IN_PROGRESS, AWAITING, OBSERVED
 * and FAILED; the Escalation-answer edges belong to a later story.
 */
const WORK_ITEM_TRANSITIONS: Readonly<Record<WorkItemState, readonly WorkItemState[]>> = {
  PENDING: ['IN_PROGRESS'],
  IN_PROGRESS: ['OBSERVED', 'UNINSPECTED', 'AMBIGUOUS', 'FAILED', 'AWAITING'],
  AWAITING: ['IN_PROGRESS', 'UNINSPECTED', 'FAILED'],
  AMBIGUOUS: ['IN_PROGRESS'],
  OBSERVED: [],
  UNINSPECTED: [],
  FAILED: [],
};

const STEP_EXECUTION_TRANSITIONS: Readonly<Record<StepExecutionState, readonly StepExecutionState[]>> = {
  RUNNING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: [],
};

/** `Object.hasOwn`, so `from = 'constructor'` is an unknown state and not a function. */
function permitted<TState extends string>(
  table: Readonly<Record<TState, readonly TState[]>>,
  from: unknown,
  to: unknown,
): boolean {
  if (typeof from !== 'string' || typeof to !== 'string') return false;
  if (!Object.hasOwn(table, from)) return false;
  return (table as Record<string, readonly string[]>)[from]!.includes(to);
}

export function canTransitionSessionStep(from: unknown, to: unknown): boolean {
  return permitted(SESSION_STEP_TRANSITIONS, from, to);
}
export function canTransitionWorkItem(from: unknown, to: unknown): boolean {
  return permitted(WORK_ITEM_TRANSITIONS, from, to);
}
export function canTransitionStepExecution(from: unknown, to: unknown): boolean {
  return permitted(STEP_EXECUTION_TRANSITIONS, from, to);
}

export function isSessionStepState(value: unknown): value is SessionStepState {
  return typeof value === 'string' && (SESSION_STEP_STATES as readonly string[]).includes(value);
}
export function isWorkItemState(value: unknown): value is WorkItemState {
  return typeof value === 'string' && (WORK_ITEM_STATES as readonly string[]).includes(value);
}
export function isStepExecutionState(value: unknown): value is StepExecutionState {
  return typeof value === 'string' && (STEP_EXECUTION_STATES as readonly string[]).includes(value);
}

/** A Work Item or Session Step in a state nothing can leave. */
export function isTerminalWorkItemState(state: WorkItemState): boolean {
  return WORK_ITEM_TRANSITIONS[state].length === 0;
}
export function isTerminalSessionStepState(state: SessionStepState): boolean {
  return SESSION_STEP_TRANSITIONS[state].length === 0;
}

/** One frozen `extract-adapter` step bound to the frozen Target System it names. */
export interface ClassifiedTarget {
  /** The FROZEN Session Step id. Step Execution provenance preserves it verbatim. */
  readonly stepId: string;
  /** Position in the authored Target order, 1-based. Execution order for the class. */
  readonly ordinal: number;
  readonly target: ProcedureTargetSnapshot;
}

export interface PlanClassification {
  /** `versioned-file` Targets: acquired as Session Steps, in authored order, first. */
  readonly references: readonly ClassifiedTarget[];
  /** `api` Targets: exactly one Work Item each, in authored order, after the references. */
  readonly adapters: readonly ClassifiedTarget[];
  /**
   * Why this plan cannot be executed by the adapter stage at all, or `null`.
   *
   * A plan naming an agent-driven Target needs a workspace and a sign-in, which is a
   * later epic; the population stage already refuses such a plan because its first
   * Session Step is `create-workspace`, and this is the same refusal said again where a
   * caller can see it rather than assumed.
   */
  readonly unsupported: string | null;
}

const EMPTY: readonly ClassifiedTarget[] = [];

/**
 * Split the frozen Targets into Reference Sources and adapter-acquired Target Systems.
 *
 * Reads `plan.inputs.targets` and `plan.sessionSteps` only. It never consults a current
 * registration and never re-derives a step.
 */
export function classifyPlanTargets(plan: ExecutablePlan): PlanClassification {
  const unsupported = (reason: string): PlanClassification => ({
    references: EMPTY,
    adapters: EMPTY,
    unsupported: reason,
  });
  if (plan.schemaVersion !== 1 || plan.compilerVersion !== '1') return unsupported('unsupported-plan-version');
  if (plan.sessionSteps[0]?.action !== 'acquire-population') return unsupported('unsupported-frozen-plan');
  if (!Object.hasOwn(PLAN_LOOKUP_COLUMNS, plan.inputs.templateId)) return unsupported('unsupported-frozen-plan');

  const references: ClassifiedTarget[] = [];
  const adapters: ClassifiedTarget[] = [];
  for (const [index, target] of plan.inputs.targets.entries()) {
    if (isAgentDrivenKind(target.contract.kind)) return unsupported('agent-driven-target');
    const step = plan.sessionSteps.find(
      (candidate) => candidate.action === 'extract-adapter' && candidate.targetSystemId === target.registrationId,
    );
    if (step === undefined) return unsupported('unsupported-frozen-plan');
    const classified: ClassifiedTarget = { stepId: step.id, ordinal: index + 1, target };
    if (target.contract.kind === 'versioned-file') references.push(classified);
    else if (target.contract.kind === 'api') adapters.push(classified);
    else return unsupported('unsupported-frozen-plan');
  }
  // Every non-population Session Step must be one of the steps just classified. A step
  // this stage cannot account for is a plan it must not claim to have executed.
  const classifiedIds = new Set([...references, ...adapters].map((entry) => entry.stepId));
  for (const step of plan.sessionSteps.slice(1)) {
    if (!classifiedIds.has(step.id)) return unsupported('unsupported-frozen-plan');
  }
  return { references, adapters, unsupported: null };
}

/** The `versioned-file` Targets, in authored order. Acquired before any Work Item. */
export function referenceTargets(plan: ExecutablePlan): readonly ClassifiedTarget[] {
  return classifyPlanTargets(plan).references;
}

/** The `api` Targets, in authored order. One Work Item each, executed sequentially. */
export function adapterTargets(plan: ExecutablePlan): readonly ClassifiedTarget[] {
  return classifyPlanTargets(plan).adapters;
}

/**
 * The execution order for one Run: every Reference Source, then every adapter Work Item.
 *
 * FR-20's ordering rule expressed once. A Work Item that ran before a Reference Source
 * was frozen would be evaluated against a reference nobody had yet acquired.
 */
export function executionUnitOrder(
  plan: ExecutablePlan,
): readonly { readonly unit: 'reference' | 'work-item'; readonly entry: ClassifiedTarget }[] {
  const classification = classifyPlanTargets(plan);
  return [
    ...classification.references.map((entry) => ({ unit: 'reference' as const, entry })),
    ...classification.adapters.map((entry) => ({ unit: 'work-item' as const, entry })),
  ];
}

/**
 * The population column an adapter extraction joins on, per Template (contract v1).
 *
 * Read from `PLAN_LOOKUP_COLUMNS`, which is the same table the compiler wrote into the
 * frozen plan text. A second copy would agree on every value anybody thought to try.
 */
export function adapterLookupColumn(templateId: string): string | null {
  return adapterSearchKeys(templateId)?.[0] ?? null;
}

/**
 * EVERY declared search key for a Template, in declared order (contract v1).
 *
 * The join uses the first; an absence has to prove it searched them ALL (§B.1's Absence
 * Observation). P-1 declares `employee_id` and `full_name`, so an adapter that indexed
 * one of them has not proven a record absent and its coverage stays `UNINSPECTED` — the
 * safe direction, and the reason this is a separate function rather than the first
 * element of one.
 */
export function adapterSearchKeys(templateId: string): readonly string[] | null {
  if (!Object.hasOwn(PLAN_LOOKUP_COLUMNS, templateId)) return null;
  return (PLAN_LOOKUP_COLUMNS as Record<string, readonly string[]>)[templateId]!;
}
