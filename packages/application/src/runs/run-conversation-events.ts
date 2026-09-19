import { RUN_STATES, type AuditEventRecord } from '@intellifin/domain';

/**
 * The small set of committed Run facts that may become a platform conversation entry.
 *
 * This is deliberately a projection vocabulary rather than a spelling of every audit
 * event.  A worker event is eligible only when its producer, source, outcome and payload
 * shape are all known below.  In particular, a capture-only fact does not become an
 * "inspection" sentence: inspection starts are taken from the agent work checkpoint
 * event, and record ordinals are supplied by an exact repository join.
 */
export const RUN_CONVERSATION_EVENT_KINDS = [
  'workspace-created',
  'capture-registered',
  'current-inspection',
  'observations-registered',
  'escalation-raised',
  'pause-requested',
  'paused',
  'resumed',
  'ended',
] as const;

export type RunConversationEventKind = (typeof RUN_CONVERSATION_EVENT_KINDS)[number];

/** An ID-only reference. Reading the referenced Evidence still uses the Evidence grant. */
export interface RunConversationEventEvidenceRef {
  readonly evidenceId: string;
  readonly locator: string | null;
}

/**
 * The event-shaped part of the conversation projection.  `text` is always selected from
 * fixed copy in this module; it is never copied from an audit payload.
 */
export interface RunConversationEventNarration {
  readonly eventId: string;
  readonly sequence: number;
  readonly at: string;
  readonly runId: string;
  readonly kind: RunConversationEventKind;
  readonly text: string;
  readonly evidenceRefs: readonly RunConversationEventEvidenceRef[];
  /** Null means this event has no proven source-record relationship. */
  readonly sourceOrdinal: number | null;
}

/**
 * Exact relationships are resolved by the repository, not guessed from time or order.
 * The maps are optional because most lifecycle events have no source record.  A caller
 * that already performed the join may pass `sourceOrdinal`; it must be the ordinal for
 * this very event's committed work/evidence relationship.
 */
export interface RunConversationEventContext {
  readonly sourceOrdinal?: number | null;
  readonly sourceOrdinalForWorkItemId?: ReadonlyMap<string, number>;
  readonly sourceOrdinalForStepId?: ReadonlyMap<string, number>;
  readonly sourceOrdinalForToolActionId?: ReadonlyMap<string, number>;
  readonly sourceOrdinalForEvidenceId?: ReadonlyMap<string, number>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DIGEST = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,254}$/u;
const MAX_SOURCE_ORDINAL = 10_000;

const CURRENT_INSPECTION_DIAGNOSTIC = 'work-item-attempt-started';
const WORKSPACE_CREATED_DIAGNOSTIC = 'workspace-created';
const SUPPORTED_ESCALATION_KINDS = new Set(['choose-candidate', 'unnamed-value', 'retry-or-skip']);

function field(payload: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(payload, key) ? payload[key] : undefined;
}

function stringField(payload: Record<string, unknown>, key: string): string | null {
  const value = field(payload, key);
  return typeof value === 'string' ? value : null;
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function boundedOrdinal(value: unknown): value is number {
  return positiveInteger(value) && value <= MAX_SOURCE_ORDINAL;
}

function isoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function actorIs(event: AuditEventRecord, type: 'human' | 'system', id?: string): boolean {
  return event.actor.type === type && (id === undefined || event.actor.id === id);
}

function baseEventIsValid(event: AuditEventRecord): boolean {
  return event.aggregateId !== 'platform' && safeId(event.aggregateId) && safeId(event.eventId) && positiveInteger(event.sequence) && isoInstant(event.occurredAt);
}

function mapOrdinal(value: number | null | undefined): number | null {
  return value === undefined ? null : boundedOrdinal(value) ? value : null;
}

function mappedOrdinal(
  context: RunConversationEventContext,
  keys: readonly { readonly id: unknown; readonly map: ReadonlyMap<string, number> | undefined }[],
): number | null {
  if (context.sourceOrdinal !== undefined) return mapOrdinal(context.sourceOrdinal);
  const values = keys.flatMap(({ id, map }) => {
    if (!safeId(id) || map === undefined) return [];
    const ordinal = map.get(id);
    return boundedOrdinal(ordinal) ? [ordinal] : [];
  });
  return values.length > 0 && values.every((value) => value === values[0]) ? values[0]! : null;
}

function evidenceRefs(value: unknown): readonly RunConversationEventEvidenceRef[] | null {
  if (!Array.isArray(value) || value.length > 16) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (!uuid(item) || ids.includes(item.toLowerCase())) return null;
    ids.push(item.toLowerCase());
  }
  return ids.map((evidenceId) => ({ evidenceId, locator: null }));
}

function oneEvidenceRef(value: unknown): RunConversationEventEvidenceRef | null {
  if (value === null) return null;
  return uuid(value) ? { evidenceId: value.toLowerCase(), locator: null } : null;
}

function fixed(
  event: AuditEventRecord,
  kind: RunConversationEventKind,
  text: string,
  context: RunConversationEventContext,
  relationship: readonly { readonly id: unknown; readonly map: ReadonlyMap<string, number> | undefined }[] = [],
  refs: readonly RunConversationEventEvidenceRef[] = [],
): RunConversationEventNarration {
  return {
    eventId: event.eventId,
    sequence: event.sequence,
    at: event.occurredAt,
    runId: event.aggregateId,
    kind,
    text,
    evidenceRefs: refs,
    sourceOrdinal: mappedOrdinal(context, relationship),
  };
}

function workspaceCreated(event: AuditEventRecord, context: RunConversationEventContext): RunConversationEventNarration | null {
  if (event.eventType !== 'lifecycle.agent-workspace' || event.source !== 'worker' || event.outcome !== 'success' || !actorIs(event, 'system', 'workspace-worker')) return null;
  const payload = event.payload;
  if (stringField(payload, 'diagnostic') !== WORKSPACE_CREATED_DIAGNOSTIC || stringField(payload, 'state') !== 'RUNNING') return null;
  if (!safeId(stringField(payload, 'stepId')) && field(payload, 'stepId') !== null && field(payload, 'stepId') !== undefined) return null;
  return fixed(event, 'workspace-created', 'A private workspace was created for this Run.', context);
}

function captureRegistered(event: AuditEventRecord, context: RunConversationEventContext): RunConversationEventNarration | null {
  if (event.eventType !== 'execution.capture-registered' || event.source !== 'worker' || event.outcome !== 'success' || !actorIs(event, 'system', 'agent-worker')) return null;
  const payload = event.payload;
  const toolActionId = stringField(payload, 'toolActionId');
  const targetSystem = stringField(payload, 'targetSystem');
  const registered = field(payload, 'registered');
  const structural = oneEvidenceRef(field(payload, 'structuralSnapshotEvidenceId'));
  const screenshotValue = field(payload, 'screenshotEvidenceId');
  const screenshot = oneEvidenceRef(screenshotValue === undefined ? null : screenshotValue);
  if (!safeId(toolActionId) || !safeId(targetSystem) || !positiveInteger(registered) || registered > 2 || structural === null) return null;
  if (screenshotValue !== null && screenshotValue !== undefined && screenshot === null) return null;
  if (screenshot !== null && screenshot.evidenceId === structural.evidenceId) return null;
  const refs = screenshot === null ? [structural] : [structural, screenshot];
  if (refs.length !== registered) return null;
  return fixed(event, 'capture-registered', 'A protected capture was registered for the current inspection.', context,
    [{ id: toolActionId, map: context.sourceOrdinalForToolActionId }], refs);
}

function currentInspection(event: AuditEventRecord, context: RunConversationEventContext): RunConversationEventNarration | null {
  if (event.eventType !== 'lifecycle.agent-work' || event.source !== 'worker' || event.outcome !== 'success' || !actorIs(event, 'system', 'agent-worker')) return null;
  const payload = event.payload;
  const workItemId = stringField(payload, 'workItemId');
  const stepExecutionId = stringField(payload, 'stepExecutionId');
  if (stringField(payload, 'diagnostic') !== CURRENT_INSPECTION_DIAGNOSTIC || stringField(payload, 'state') !== 'RUNNING' ||
      !safeId(workItemId) || !safeId(stepExecutionId) || !positiveInteger(field(payload, 'attempt'))) return null;
  return fixed(event, 'current-inspection', 'The current inspection started.', context,
    [{ id: workItemId, map: context.sourceOrdinalForWorkItemId }]);
}

function observationsRegistered(event: AuditEventRecord, context: RunConversationEventContext): RunConversationEventNarration | null {
  if (event.eventType !== 'execution.observations-registered' || event.source !== 'worker' || event.outcome !== 'success' || !actorIs(event, 'system', 'observation-registrar')) return null;
  const payload = event.payload;
  const workItemId = stringField(payload, 'workItemId');
  const stepExecutionId = stringField(payload, 'stepExecutionId');
  const registrationId = stringField(payload, 'registrationId');
  const digests = field(payload, 'digests');
  const batchDigest = field(payload, 'batchDigest');
  if (!safeId(workItemId) || !safeId(stepExecutionId) || !safeId(registrationId) || !positiveInteger(field(payload, 'registered')) ||
      !Array.isArray(digests) || digests.length === 0 || digests.length !== field(payload, 'registered') ||
      digests.some((digest) => typeof digest !== 'string' || !DIGEST.test(digest)) || typeof batchDigest !== 'string' || !DIGEST.test(batchDigest)) return null;
  return fixed(event, 'observations-registered', 'Committed observations were registered for the current inspection.', context,
    [{ id: workItemId, map: context.sourceOrdinalForWorkItemId }, { id: stepExecutionId, map: context.sourceOrdinalForStepId }]);
}

function escalationRaised(event: AuditEventRecord, context: RunConversationEventContext): RunConversationEventNarration | null {
  if (event.eventType !== 'execution.escalation-raised' || event.source !== 'platform' || event.outcome !== 'success' || !actorIs(event, 'system', 'escalation-platform')) return null;
  const payload = event.payload;
  const waitId = field(payload, 'waitId');
  const kind = field(payload, 'kind');
  const optionIds = field(payload, 'optionIds');
  const deadline = field(payload, 'deadline');
  const stepId = field(payload, 'stepId');
  const refs = field(payload, 'supportingEvidenceIds') === undefined ? [] : evidenceRefs(field(payload, 'supportingEvidenceIds'));
  if (!uuid(waitId) || typeof kind !== 'string' || !SUPPORTED_ESCALATION_KINDS.has(kind) || !Array.isArray(optionIds) || optionIds.length < 2 ||
      optionIds.some((option) => !safeId(option)) || !isoInstant(deadline) || refs === null ||
      (stepId !== undefined && stepId !== null && !safeId(stepId))) return null;
  // A partly resolved evidence set cannot name one record for the whole decision.
  // Preserve the decision itself, but leave its record context unknown.
  if (refs.some(ref => !boundedOrdinal(context.sourceOrdinalForEvidenceId?.get(ref.evidenceId)))) {
    return fixed(event, 'escalation-raised', 'The Run is waiting for an auditor decision.', {}, [], refs);
  }
  return fixed(event, 'escalation-raised', 'The Run is waiting for an auditor decision.', context,
    [{ id: stepId, map: context.sourceOrdinalForStepId }, ...refs.map((ref) => ({ id: ref.evidenceId, map: context.sourceOrdinalForEvidenceId }))], refs);
}

function pauseRequested(event: AuditEventRecord, context: RunConversationEventContext): RunConversationEventNarration | null {
  if (event.eventType !== 'lifecycle.run-pause-requested' || event.source !== 'web' || event.outcome !== 'success' || !actorIs(event, 'human')) return null;
  const payload = event.payload;
  if (stringField(payload, 'state') !== 'RUNNING' || stringField(payload, 'performedBy') !== 'worker' || !isoInstant(field(payload, 'requestedAt'))) return null;
  return fixed(event, 'pause-requested', 'A pause was requested for this Run.', context);
}

function paused(event: AuditEventRecord, context: RunConversationEventContext): RunConversationEventNarration | null {
  if (event.eventType !== 'lifecycle.run-paused' || event.source !== 'worker' || event.outcome !== 'success' || !actorIs(event, 'human')) return null;
  const payload = event.payload;
  const waitId = field(payload, 'waitId');
  const workItemId = field(payload, 'workItemId');
  const stepExecutionId = field(payload, 'stepExecutionId');
  if (stringField(payload, 'priorState') !== 'RUNNING' || stringField(payload, 'state') !== 'PAUSED' || !uuid(waitId) ||
      !isoInstant(field(payload, 'requestedAt')) || !isoInstant(field(payload, 'occurredAt')) || !isoInstant(field(payload, 'deadline')) ||
      (workItemId !== undefined && workItemId !== null && !safeId(workItemId)) ||
      (stepExecutionId !== undefined && stepExecutionId !== null && !safeId(stepExecutionId))) return null;
  return fixed(event, 'paused', 'The Run is paused.', context,
    [{ id: workItemId, map: context.sourceOrdinalForWorkItemId }]);
}

function resumed(event: AuditEventRecord, context: RunConversationEventContext): RunConversationEventNarration | null {
  if (event.eventType !== 'lifecycle.run-resumed' || event.source !== 'web' || event.outcome !== 'success' || !actorIs(event, 'human')) return null;
  const payload = event.payload;
  if (stringField(payload, 'priorState') !== 'PAUSED' || stringField(payload, 'state') !== 'RUNNING' || !uuid(field(payload, 'waitId')) ||
      stringField(payload, 'closureKind') !== 'resume' || !isoInstant(field(payload, 'pausedAt')) || !isoInstant(field(payload, 'occurredAt'))) return null;
  return fixed(event, 'resumed', 'The Run resumed.', context);
}

function ended(event: AuditEventRecord, context: RunConversationEventContext): RunConversationEventNarration | null {
  if (event.eventType !== 'lifecycle.result-sealed' || event.source !== 'worker' || !['success', 'failure'].includes(event.outcome) || !actorIs(event, 'system', 'result-sealer')) return null;
  const payload = event.payload;
  const runState = field(payload, 'runState');
  const sealed = field(payload, 'sealed');
  if (typeof runState !== 'string' || !RUN_STATES.includes(runState as (typeof RUN_STATES)[number]) || !['COMPLETED', 'INCONCLUSIVE', 'RUN_FAILED', 'CANCELED'].includes(runState) || typeof sealed !== 'boolean' || !positiveInteger(field(payload, 'version'))) return null;
  return fixed(event, 'ended', sealed ? 'The Run ended and its result was sealed.' : 'The Run ended; its result awaits review.', context);
}

/**
 * Map one committed audit record to safe operational copy, or return null when the record
 * is outside this projection's allowlist.  No provider/model/worker boundary is called.
 */
export function narrateRunConversationEvent(
  event: AuditEventRecord,
  context: RunConversationEventContext = {},
): RunConversationEventNarration | null {
  if (!baseEventIsValid(event)) return null;
  return workspaceCreated(event, context) ?? captureRegistered(event, context) ?? currentInspection(event, context) ??
    observationsRegistered(event, context) ?? escalationRaised(event, context) ?? pauseRequested(event, context) ??
    paused(event, context) ?? resumed(event, context) ?? ended(event, context);
}

/** Descriptive alias for repository callers that name the operation as a projection. */
export const mapAuditEventToRunConversationEvent = narrateRunConversationEvent;
