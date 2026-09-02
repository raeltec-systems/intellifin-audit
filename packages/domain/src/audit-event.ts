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
