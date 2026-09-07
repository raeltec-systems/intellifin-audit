import {
  OBSERVATION_LIMITS,
  canonicalJson,
  declaredCountMatches,
  type ExecutablePlan,
  type JsonObject,
  type JsonValue,
  type PopulationCheck,
  WEB_TREE_LIMITS,
} from '@intellifin/domain';

/** The immutable event used to retain the agent's page-level declaration. */
export const AGENT_PAGE_DECLARATION_EVENT = 'execution.agent-page-declaration' as const;
export const AGENT_PAGE_DECLARATION_SCHEMA_VERSION = 1 as const;

/** The bounded page declaration the model-selected reads are allowed to produce. */
export interface AgentPageDeclarationInput {
  readonly targetSystem: string;
  readonly workItemId: string;
  readonly stepExecutionId: string;
  /** The platform Evidence identity of the Structural Snapshot that was read. */
  readonly snapshotEvidenceId: string;
  /** The page's signed/published identifier, or null when the read found none. */
  readonly snapshotIdentifier: string | null;
  readonly snapshotIdentifierLocator: string | null;
  /** The page's own expected number of parameters, or null when it was not read. */
  readonly expectedParameterCount: number | null;
  readonly expectedParameterCountLocator: string | null;
  /** The number of Parameter datum nodes in the captured page, when known. */
  readonly pageParameterCount: number;
  /** The count the producer observed while preparing the event. SQL rebinds it later. */
  readonly registeredObservations: number;
}

export interface AgentPageDeclaration extends AgentPageDeclarationInput {
  readonly schemaVersion: typeof AGENT_PAGE_DECLARATION_SCHEMA_VERSION;
}

/**
 * A page declaration after infrastructure has bound it to durable rows.
 *
 * `declaration.registeredObservations` is the event's claim. `registeredObservationCount`
 * is read from `run_observation` in the same transaction as the Gate and is the only count
 * the reconciliation trusts. Keeping both makes an event that was written with a stale
 * count visible rather than silently replacing one untrusted value with another.
 */
export interface AgentPageDeclarationFacts {
  readonly declaration: AgentPageDeclaration;
  readonly registeredObservationCount: number;
  readonly binding: {
    readonly evidenceId: string;
    readonly toolActionId: string;
    readonly workItemId: string;
    readonly stepExecutionId: string;
  };
}

const DECLARATION_KEYS = [
  'schemaVersion',
  'targetSystem',
  'workItemId',
  'stepExecutionId',
  'snapshotEvidenceId',
  'snapshotIdentifier',
  'snapshotIdentifierLocator',
  'expectedParameterCount',
  'expectedParameterCountLocator',
  'pageParameterCount',
  'registeredObservations',
] as const;

function object(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function exactKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === DECLARATION_KEYS.length &&
    DECLARATION_KEYS.every((key) => Object.hasOwn(value, key));
}

/** Text is retained verbatim; only its boundedness and canonicalizability are checked here. */
function boundedText(value: unknown, limit: number = OBSERVATION_LIMITS.text): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) return false;
  try {
    canonicalJson(value as JsonValue);
    return true;
  } catch {
    return false;
  }
}

function boundedCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= OBSERVATION_LIMITS.batch;
}

function boundedLocator(value: unknown): value is string {
  if (!boundedText(value)) return false;
  const match = /^\$\.nodes\[(\d+)\]\.value$/u.exec(value);
  return match !== null && Number(match[1]) < WEB_TREE_LIMITS.nodes;
}

function validTextPair(value: unknown, locator: unknown): boolean {
  return (value === null && locator === null) ||
    (typeof value === 'string' && typeof locator === 'string' && boundedText(value) && boundedLocator(locator));
}

function validCountPair(value: unknown, locator: unknown): boolean {
  return (value === null && locator === null) ||
    (boundedCount(value) && typeof locator === 'string' && boundedLocator(locator));
}

function validDeclaration(value: unknown): value is AgentPageDeclaration {
  if (!object(value) || !exactKeys(value) || value['schemaVersion'] !== AGENT_PAGE_DECLARATION_SCHEMA_VERSION) return false;
  if (!boundedText(value['targetSystem']) || !boundedText(value['workItemId']) ||
      !boundedText(value['stepExecutionId']) || !boundedText(value['snapshotEvidenceId'])) return false;
  if (!validTextPair(value['snapshotIdentifier'], value['snapshotIdentifierLocator'])) return false;
  if (!validCountPair(value['expectedParameterCount'], value['expectedParameterCountLocator'])) return false;
  return boundedCount(value['pageParameterCount']) && boundedCount(value['registeredObservations']);
}

/** Validate and freeze one page declaration before it is put into an audit payload. */
export function buildAgentPageDeclaration(input: AgentPageDeclarationInput): AgentPageDeclaration | null {
  const candidate: AgentPageDeclaration = {
    schemaVersion: AGENT_PAGE_DECLARATION_SCHEMA_VERSION,
    targetSystem: input.targetSystem,
    workItemId: input.workItemId,
    stepExecutionId: input.stepExecutionId,
    snapshotEvidenceId: input.snapshotEvidenceId,
    snapshotIdentifier: input.snapshotIdentifier,
    snapshotIdentifierLocator: input.snapshotIdentifierLocator,
    expectedParameterCount: input.expectedParameterCount,
    expectedParameterCountLocator: input.expectedParameterCountLocator,
    pageParameterCount: input.pageParameterCount,
    registeredObservations: input.registeredObservations,
  };
  return validDeclaration(candidate) ? candidate : null;
}

/**
 * Build the exact JSON object the append-only audit writer receives.
 *
 * It intentionally contains page metadata and row identities only. Structural Snapshot
 * bytes, extracted parameter values and credentials remain in Evidence or the Observation
 * wire rows, never in this immutable event.
 */
export function buildAgentPageDeclarationPayload(input: AgentPageDeclarationInput): JsonObject | null {
  const declaration = buildAgentPageDeclaration(input);
  return declaration === null ? null : { ...declaration };
}

/** Parse an event payload and reject any added, missing or malformed fields. */
export function parseAgentPageDeclaration(value: unknown): AgentPageDeclaration | null {
  return validDeclaration(value) ? value : null;
}

/** P-4 is the one template whose agent page declaration is required by this contract. */
export function requiresP4PageDeclaration(plan: ExecutablePlan | null): boolean {
  return plan?.inputs.templateId === 'P-4';
}

/** The single frozen web Target a P-4 page declaration must name, or null when malformed. */
export function p4PageTargetSystem(plan: ExecutablePlan | null): string | null {
  if (!requiresP4PageDeclaration(plan)) return null;
  const targets = plan!.inputs.targets.filter((target) => target.contract.kind === 'web');
  return targets.length === 1 ? targets[0]!.registrationId : null;
}

/**
 * Route page metadata through the existing population checks and diagnostics.
 *
 * The source snapshot's checks and declared count stay separate. The Gate appends these
 * two checks only for P-4, and `declaredCountMatches` is the exact predicate used by the
 * source population reconciler for the `declared-count` §H row.
 */
export function agentPageDeclarationChecks(
  facts: AgentPageDeclarationFacts | null | undefined,
  expectedTargetSystem: string | null,
): readonly PopulationCheck[] {
  const declaration = facts?.declaration;
  const binding = facts?.binding;
  const bindingBound = declaration !== undefined && binding !== undefined &&
    binding.evidenceId === declaration.snapshotEvidenceId &&
    binding.workItemId === declaration.workItemId &&
    binding.stepExecutionId === declaration.stepExecutionId;
  const metadataBound = declaration !== undefined &&
    expectedTargetSystem !== null &&
    declaration.targetSystem === expectedTargetSystem &&
    declaration.snapshotIdentifier !== null &&
    declaration.snapshotIdentifierLocator !== null &&
    bindingBound;
  const countBound = declaration !== undefined && facts !== null && facts !== undefined &&
    bindingBound &&
    expectedTargetSystem !== null &&
    declaration.targetSystem === expectedTargetSystem &&
    declaredCountMatches(declaration.expectedParameterCount, facts.registeredObservationCount) &&
    declaredCountMatches(declaration.registeredObservations, facts.registeredObservationCount) &&
    declaredCountMatches(declaration.expectedParameterCount, declaration.pageParameterCount);
  return [
    { name: 'declaration', passed: metadataBound },
    { name: 'declared-count', passed: countBound },
  ];
}
