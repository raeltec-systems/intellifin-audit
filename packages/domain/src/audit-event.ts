import { canonicalJson, type JsonObject, type JsonValue } from './canonical-json.js';

/**
 * The RFC 8785 serializer is NOT defined here any more. `canonical-json.ts` owns it and
 * the registration digest imports the same function, so the two digests cannot disagree
 * about what canonical JSON is. The projection below — which keys are hashed — is still
 * this module's own, and is the part that must never be shared.
 */

export const AUDIT_ACTOR_TYPES = ['human', 'agent', 'adapter', 'system'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const AUDIT_EVENT_FAMILIES = [
  'security',
  'configuration',
  'lifecycle',
  'execution',
  'evidence-access',
  'review',
  'notification',
  'export',
  'failure',
] as const;
export type AuditEventFamily = (typeof AUDIT_EVENT_FAMILIES)[number];
export type AuditEventType = `${AuditEventFamily}.${string}`;

export const AUDIT_EVENT_SOURCES = ['web', 'worker', 'adapter', 'platform'] as const;
export type AuditEventSource = (typeof AUDIT_EVENT_SOURCES)[number];

export const AUDIT_EVENT_OUTCOMES = ['success', 'failure', 'denied'] as const;
export type AuditEventOutcome = (typeof AUDIT_EVENT_OUTCOMES)[number];

export interface AuditActor {
  readonly type: AuditActorType;
  readonly id: string;
}

/** Metadata supplied by a command before the clock, id and chain position are assigned. */
export interface AuditEventDraft {
  readonly actor: AuditActor;
  readonly eventType: AuditEventType;
  readonly source: AuditEventSource;
  readonly outcome: AuditEventOutcome;
  readonly sessionId: string;
  readonly correlationId: string;
  /** System-wide events omit this and are chained under `platform`. */
  readonly aggregateId?: string;
  readonly payload: JsonObject;
}

/** The exact RFC 8785 input. Previous/event hashes are deliberately absent. */
export interface CanonicalAuditEvent {
  readonly actor: AuditActor;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly eventId: string;
  readonly eventType: AuditEventType;
  readonly occurredAt: string;
  readonly outcome: AuditEventOutcome;
  readonly payload: JsonObject;
  readonly sequence: number;
  readonly sessionId: string;
  readonly source: AuditEventSource;
}

export interface AuditEventRecord extends CanonicalAuditEvent {
  /** Lower-case, 64-character SHA-256 hex. */
  readonly previousHash: string;
  /** Lower-case, 64-character SHA-256 hex. */
  readonly eventHash: string;
}

export const ZERO_HASH = '0'.repeat(64);

export type AuditChainFailureReason =
  | 'SEQUENCE_MISMATCH'
  | 'PREVIOUS_HASH_MISMATCH'
  | 'EVENT_HASH_MISMATCH'
  | 'HEAD_MISMATCH';

export type AuditChainVerificationResult =
  | {
      readonly valid: true;
      readonly aggregateId: string;
      readonly eventCount: number;
      readonly headSequence: number;
      readonly headHash: string;
    }
  | {
      readonly valid: false;
      readonly aggregateId: string;
      readonly firstInvalidSequence: number;
      readonly reason: AuditChainFailureReason;
    };

export class AuditEventValidationError extends Error {
  override readonly name = 'AuditEventValidationError';
  readonly field: string;

  constructor(field: string, message: string) {
    super(`Invalid audit event ${field}: ${message}`);
    this.field = field;
  }
}

const EVENT_TYPE_PATTERN = new RegExp(
  `^(?:${AUDIT_EVENT_FAMILIES.join('|').replace('evidence-access', 'evidence\\-access')})\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$`,
);
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,254}$/;

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  'authorization',
  'cookie',
  'credential',
  'credentials',
  // A credential REFERENCE is opaque and holds no secret, but the chain is immutable:
  // anything credential-shaped that enters it can never be taken out. The registration
  // commands already omit it from every payload by discipline; these two entries make
  // that a refusal, because the suffix rule below matches only a key ENDING in
  // `credential` and `credentialRef` normalizes to `credentialref`.
  'credentialref',
  'credentialreference',
  'credref',
  'evidence',
  'evidencedata',
  'evidencecontent',
  'password',
  'passwd',
  'prompt',
  'provider',
  'providerpayload',
  'requestbody',
  'responsebody',
  'secret',
  'signedurl',
  'snapshot',
  'snapshotdata',
  'token',
  'tool',
  'toolpayload',
  'aiinput',
  'aioutput',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isForbiddenPayloadKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (FORBIDDEN_PAYLOAD_KEYS.has(normalized)) return true;
  return /(?:password|passwd|secret|token|credential|signedurl|prompt)$/.test(normalized);
}

function assertNoLoneSurrogates(value: string, field: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new AuditEventValidationError(field, 'contains an unpaired Unicode surrogate');
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new AuditEventValidationError(field, 'contains an unpaired Unicode surrogate');
    }
  }
}

function assertIdentifier(value: string, field: string): void {
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new AuditEventValidationError(
      field,
      'must be 1..255 characters and contain only letters, digits, colon, dot, underscore, slash, or hyphen',
    );
  }
}

function assertJsonValue(value: unknown, field: string, seen: Set<object>): asserts value is JsonValue {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    assertNoLoneSurrogates(value, field);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new AuditEventValidationError(field, 'numbers must be finite');
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new AuditEventValidationError(field, 'must contain JSON values only');
  }
  if (seen.has(value)) {
    throw new AuditEventValidationError(field, 'must not contain a circular reference');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new AuditEventValidationError(`${field}[${index}]`, 'sparse arrays are not canonical JSON');
        }
        assertJsonValue(value[index], `${field}[${index}]`, seen);
      }
      return;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new AuditEventValidationError(field, 'objects must be plain JSON objects');
    }
    for (const [key, child] of Object.entries(value)) {
      assertNoLoneSurrogates(key, `${field} key`);
      if (isForbiddenPayloadKey(key)) {
        throw new AuditEventValidationError(`${field}.${key}`, 'sensitive payload keys are forbidden');
      }
      assertJsonValue(child, `${field}.${key}`, seen);
    }
  } finally {
    seen.delete(value);
  }
}

/** Validate and normalize caller input before it is allowed into a database transaction. */
export function validateAuditEventDraft(draft: AuditEventDraft): AuditEventDraft {
  if (!AUDIT_ACTOR_TYPES.includes(draft.actor.type)) {
    throw new AuditEventValidationError('actor.type', 'is not in the audit vocabulary');
  }
  assertIdentifier(draft.actor.id, 'actor.id');
  if (!EVENT_TYPE_PATTERN.test(draft.eventType)) {
    throw new AuditEventValidationError('eventType', 'must use a documented family and lower-case action');
  }
  if (!AUDIT_EVENT_SOURCES.includes(draft.source)) {
    throw new AuditEventValidationError('source', 'is not in the audit vocabulary');
  }
  if (!AUDIT_EVENT_OUTCOMES.includes(draft.outcome)) {
    throw new AuditEventValidationError('outcome', 'is not in the audit vocabulary');
  }
  assertIdentifier(draft.sessionId, 'sessionId');
  assertIdentifier(draft.correlationId, 'correlationId');
  if (draft.aggregateId !== undefined) assertIdentifier(draft.aggregateId, 'aggregateId');
  assertJsonValue(draft.payload, 'payload', new Set());
  if (Array.isArray(draft.payload)) {
    throw new AuditEventValidationError('payload', 'must be a JSON object');
  }
  // Conversation cancellation extends the existing fact with one server-owned ID.
  // Retain a closed payload so arbitrary interaction text cannot enter the audit fact.
  if (['lifecycle.run-cancel-requested', 'lifecycle.run-canceled'].includes(draft.eventType) &&
    Object.hasOwn(draft.payload, 'commandId')) {
    const fields = draft.eventType === 'lifecycle.run-canceled'
      ? ['commandId', 'priorState', 'state', 'reason', 'requestedAt', 'occurredAt', 'performedBy']
      : ['commandId', 'state', 'reason', 'requestedAt', 'performedBy'];
    if (Object.keys(draft.payload).length !== fields.length || fields.some(key => !Object.hasOwn(draft.payload, key)) ||
      typeof draft.payload.commandId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(draft.payload.commandId))
      throw new AuditEventValidationError('payload', 'cancellation interaction identity requires its closed payload');
  }
  if (draft.eventType === 'execution.escalation-answered' && Object.hasOwn(draft.payload, 'commandId')) {
    const fields = ['waitId','kind','answerOptionId','closureKind','priorState','state','occurredAt','commandId','planDigest','expectedRunRevision','questionAnchor'];
    const rawAnchor = draft.payload.questionAnchor;
    const anchor = rawAnchor as JsonObject;
    const keys = ['runId','waitId','kind','runRevision','openedAt','deadline','raisedEventId','questionDigest'];
    if (Object.keys(draft.payload).length !== fields.length || fields.some(key => !Object.hasOwn(draft.payload, key)) ||
      typeof draft.payload.commandId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(draft.payload.commandId) ||
      typeof rawAnchor !== 'object' || rawAnchor === null || Array.isArray(rawAnchor) || Object.keys(anchor).length !== keys.length ||
      keys.some(key => !Object.hasOwn(anchor, key)) || anchor.runId !== draft.aggregateId || anchor.waitId !== draft.payload.waitId ||
      anchor.kind !== draft.payload.kind || anchor.runRevision !== draft.payload.expectedRunRevision ||
      !['runId','waitId','raisedEventId'].every(key => typeof anchor[key] === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(anchor[key] as string)) ||
      typeof anchor.runRevision !== 'number' || !Number.isInteger(anchor.runRevision) || anchor.runRevision < 0 || anchor.runRevision > 2147483647 ||
      !['openedAt','deadline'].every(key => typeof anchor[key] === 'string' && Number.isFinite(Date.parse(anchor[key] as string)) &&
        new Date(anchor[key] as string).toISOString() === anchor[key]) ||
      Date.parse(anchor.deadline as string) <= Date.parse(anchor.openedAt as string) ||
      !['choose-candidate','unnamed-value','retry-or-skip'].includes(anchor.kind as string) ||
      typeof draft.payload.answerOptionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(draft.payload.answerOptionId) ||
      draft.source !== 'web' || draft.actor.type !== 'human' || draft.outcome !== 'success' ||
      draft.payload.closureKind !== 'answer' || draft.payload.priorState !== 'AWAITING_AUDITOR' ||
      draft.payload.state !== (draft.payload.answerOptionId === 'abort' ? 'CANCELED' : 'RUNNING') ||
      typeof anchor.questionDigest !== 'string' || !HASH_PATTERN.test(anchor.questionDigest) ||
      typeof draft.payload.planDigest !== 'string' || !HASH_PATTERN.test(draft.payload.planDigest))
      throw new AuditEventValidationError('payload', 'answer interaction requires its exact question identity and closed payload');
  }
  if (draft.eventType === 'configuration.user-permission-changed') {
    const p = draft.payload;
    if (Object.keys(p).length !== 7 || typeof p.subjectUserId !== 'string' || !p.subjectUserId || p.subjectUserId.includes('@') ||
      p.permission !== 'run.control-transfer' || typeof p.granted !== 'boolean' || p.priorGranted !== !p.granted ||
      typeof p.revision !== 'number' || !Number.isInteger(p.revision) || p.revision < 1 || p.revision > 2147483647 || p.priorRevision !== p.revision-1 ||
      !['administration','role-change'].includes(p.cause as string) || draft.actor.type !== 'human' || draft.source !== 'web' || draft.outcome !== 'success' ||
      (draft.aggregateId !== undefined && draft.aggregateId !== 'platform'))
      throw new AuditEventValidationError('payload', 'permission receipt requires its exact grant revision');
  }
  if (draft.eventType === 'lifecycle.run-control-lease-transferred') {
    const p = draft.payload;
    const fields = ['operation','commandId','requestKey','expectedEpoch','priorEpoch','priorHolderId','epoch','holderId','reasonRef','updatedAt','expiresAt'];
    if (Object.keys(p).length !== fields.length || fields.some(key => !Object.hasOwn(p,key)) ||
      p.operation !== 'transfer' || !['commandId','requestKey'].every(key => typeof p[key] === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p[key] as string)) ||
      p.reasonRef !== p.commandId || typeof p.expectedEpoch !== 'number' || !Number.isInteger(p.expectedEpoch) ||
      p.expectedEpoch < 1 || p.expectedEpoch >= 2147483647 || p.priorEpoch !== p.expectedEpoch || p.epoch !== p.expectedEpoch+1 ||
      p.holderId !== draft.actor.id || typeof p.priorHolderId !== 'string' || !p.priorHolderId || p.priorHolderId === p.holderId ||
      !['updatedAt','expiresAt'].every(key => typeof p[key] === 'string' && Number.isFinite(Date.parse(p[key] as string)) &&
        new Date(p[key] as string).toISOString() === p[key]) || Date.parse(p.expiresAt as string)-Date.parse(p.updatedAt as string) !== 120000 ||
      draft.actor.type !== 'human' || draft.source !== 'web' || draft.outcome !== 'success')
      throw new AuditEventValidationError('payload', 'transfer receipt requires its exact proposal and lease transition');
  }
  return draft;
}

/** Build and validate the exact envelope that is hashed. */
export function createCanonicalAuditEvent(
  draft: AuditEventDraft,
  generated: { readonly eventId: string; readonly occurredAt: string; readonly sequence: number },
): CanonicalAuditEvent {
  validateAuditEventDraft(draft);
  if (!UUID_V7_PATTERN.test(generated.eventId)) {
    throw new AuditEventValidationError('eventId', 'must be a lower-case UUIDv7');
  }
  const occurredAt = new Date(generated.occurredAt);
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.toISOString() !== generated.occurredAt) {
    throw new AuditEventValidationError('occurredAt', 'must be an ISO 8601 UTC instant');
  }
  if (!Number.isSafeInteger(generated.sequence) || generated.sequence < 1) {
    throw new AuditEventValidationError('sequence', 'must be a positive safe integer');
  }
  return {
    actor: { type: draft.actor.type, id: draft.actor.id },
    aggregateId: draft.aggregateId ?? 'platform',
    correlationId: draft.correlationId,
    eventId: generated.eventId,
    eventType: draft.eventType,
    occurredAt: generated.occurredAt,
    outcome: draft.outcome,
    payload: draft.payload,
    sequence: generated.sequence,
    sessionId: draft.sessionId,
    source: draft.source,
  };
}

/**
 * RFC 8785 JSON Canonicalization Scheme text for the hash input.
 *
 * The eleven canonical keys are projected explicitly. `AuditEventRecord` extends
 * `CanonicalAuditEvent` with `previousHash` and `eventHash`, so a record is
 * assignable here; without this projection those two keys would silently enter
 * the hashed bytes and produce a different digest than the envelope they were
 * built from.
 */
export function canonicalizeAuditEvent(event: CanonicalAuditEvent): string {
  const envelope: CanonicalAuditEvent = {
    actor: { type: event.actor.type, id: event.actor.id },
    aggregateId: event.aggregateId,
    correlationId: event.correlationId,
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    outcome: event.outcome,
    payload: event.payload,
    sequence: event.sequence,
    sessionId: event.sessionId,
    source: event.source,
  };
  assertJsonValue(envelope, 'event', new Set());
  return canonicalJson(envelope as unknown as JsonValue);
}

export function assertAuditHash(hash: string, field: 'previousHash' | 'eventHash'): void {
  if (!HASH_PATTERN.test(hash)) {
    throw new AuditEventValidationError(field, 'must be lower-case SHA-256 hex');
  }
}
