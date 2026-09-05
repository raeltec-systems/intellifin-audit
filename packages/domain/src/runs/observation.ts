import { canonicalJson, type JsonValue } from '../canonical-json.js';

/**
 * The versioned Observation wire schema (addendum §B.1), and its validator.
 *
 * One shape for every Observation, whatever produced it: an adapter extraction now, an
 * agent read later. Story 3.4 adds batched registration, the per-Observation Gate checks
 * and the `found = false` completeness rules; the SHAPE lands once, here, so those
 * stories extend it rather than inventing a second one beside it.
 *
 * `found` is a three-valued string, not a boolean plus a flag: §B.1's vocabulary is
 * `true` / `false` / `ambiguous`, and an `ambiguous` match is not a `found` boolean with
 * something else set. Written as a string it is storable, pinnable by a CHECK constraint
 * and impossible to read as "falsy".
 *
 * `corroboration` is set by the Evidence Quality Gate at registration (Story 3.6 reads
 * the stored Structural Snapshot). Until then it is `null`, which means "not yet judged"
 * and never "matched".
 */

export const OBSERVATION_SCHEMA_VERSION = 1 as const;

export const OBSERVATION_FOUND_VALUES = ['true', 'false', 'ambiguous'] as const;
export type ObservationFound = (typeof OBSERVATION_FOUND_VALUES)[number];

export const OBSERVATION_CAPTURE_METHODS = ['agent', 'adapter'] as const;
export type ObservationCaptureMethod = (typeof OBSERVATION_CAPTURE_METHODS)[number];

export const OBSERVATION_MATCH_ORIGINS = ['platform', 'human-matched'] as const;
export type ObservationMatchOrigin = (typeof OBSERVATION_MATCH_ORIGINS)[number];

export const OBSERVATION_CORROBORATIONS = ['matched', 'contradictory', 'model-read'] as const;
export type ObservationCorroboration = (typeof OBSERVATION_CORROBORATIONS)[number];

/** Bounds applied before anything else looks at a value. */
export const OBSERVATION_LIMITS = {
  /** Identifiers, locators, labels. */
  text: 1024,
  /** One captured value, original or normalized. */
  value: 8192,
  /** Declared attributes on one Observation. */
  attributes: 64,
  /** Evidence items one Observation may link. */
  evidence: 16,
} as const;

/**
 * Where an attribute value was read from, inside a stored Evidence artifact.
 *
 * `evidenceId` names a Structural Snapshot or a file/extraction Evidence item — never a
 * screenshot or a recording (§B.1). `locator` is a path within it, and it is the path
 * Story 3.6 re-reads; `label` is the field's name as the Target System presents it.
 */
export interface ObservationGrounding {
  readonly evidenceId: string;
  readonly locator: string;
  readonly label: string;
  readonly extractedText: string;
}

export interface ObservationAttribute {
  readonly name: string;
  /** Exactly what the Target System presented. Never trimmed, folded or reformatted. */
  readonly originalValue: JsonValue;
  /** The §B normalization of it. For an opaque identifier this IS the original string. */
  readonly normalizedValue: JsonValue;
  readonly grounding: ObservationGrounding | null;
  readonly corroboration: ObservationCorroboration | null;
}

export interface ObservationRecord {
  readonly schemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
  readonly observationId: string;
  readonly workItemId: string;
  readonly populationRecordKey: string;
  readonly targetSystem: string;
  readonly found: ObservationFound;
  /** UTC instant, ISO 8601 with a `Z` offset. */
  readonly observedAt: string;
  readonly stepExecutionId: string;
  readonly captureMethod: ObservationCaptureMethod;
  readonly matchOrigin: ObservationMatchOrigin;
  /** The grounded attribute holding the matching key as the Target System displays it. */
  readonly identity: ObservationAttribute | null;
  readonly attributes: readonly ObservationAttribute[];
  readonly evidenceIds: readonly string[];
}

const OBSERVATION_KEYS = [
  'schemaVersion', 'observationId', 'workItemId', 'populationRecordKey', 'targetSystem', 'found',
  'observedAt', 'stepExecutionId', 'captureMethod', 'matchOrigin', 'identity', 'attributes', 'evidenceIds',
] as const satisfies readonly (keyof ObservationRecord)[];

const GROUNDING_KEYS = ['evidenceId', 'locator', 'label', 'extractedText'] as const;
const ATTRIBUTE_KEYS = ['name', 'originalValue', 'normalizedValue', 'grounding', 'corroboration'] as const;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit;
}

/** A storable, canonicalizable captured value. `canonicalJson` refuses a lone surrogate
 * and a NUL, both of which have no canonical form and no storable form. */
function storableValue(value: unknown): value is JsonValue {
  try {
    return canonicalJson(value as JsonValue).length <= OBSERVATION_LIMITS.value;
  } catch {
    return false;
  }
}

/** ISO 8601 in UTC, to millisecond precision, with a real calendar date behind it. */
export function isObservationInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19);
}

export function isObservationGrounding(value: unknown): value is ObservationGrounding {
  if (!object(value) || !exactKeys(value, GROUNDING_KEYS)) return false;
  return (
    text(value['evidenceId'], OBSERVATION_LIMITS.text) &&
    text(value['locator'], OBSERVATION_LIMITS.text) &&
    text(value['label'], OBSERVATION_LIMITS.text) &&
    typeof value['extractedText'] === 'string' &&
    value['extractedText'].length <= OBSERVATION_LIMITS.value &&
    storableValue(value['extractedText'])
  );
}

export function isObservationAttribute(value: unknown): value is ObservationAttribute {
  if (!object(value) || !exactKeys(value, ATTRIBUTE_KEYS)) return false;
  const corroboration = value['corroboration'];
  return (
    text(value['name'], OBSERVATION_LIMITS.text) &&
    storableValue(value['originalValue']) &&
    storableValue(value['normalizedValue']) &&
    (value['grounding'] === null || isObservationGrounding(value['grounding'])) &&
    (corroboration === null ||
      (typeof corroboration === 'string' &&
        (OBSERVATION_CORROBORATIONS as readonly string[]).includes(corroboration)))
  );
}

/**
 * The whole schema, structurally.
 *
 * §B.1's one substantive cross-field rule is enforced here: a grounded identity
 * attribute is REQUIRED when `found = true`, and must be absent otherwise — an
 * `ambiguous` or absent Observation that carried an identity would be asserting the
 * match it exists to say did not resolve.
 */
export function isObservationRecord(value: unknown): value is ObservationRecord {
  if (!object(value) || !exactKeys(value, OBSERVATION_KEYS)) return false;
  const found = value['found'];
  if (value['schemaVersion'] !== OBSERVATION_SCHEMA_VERSION) return false;
  if (!text(value['observationId'], OBSERVATION_LIMITS.text)) return false;
  if (!text(value['workItemId'], OBSERVATION_LIMITS.text)) return false;
  if (!text(value['populationRecordKey'], OBSERVATION_LIMITS.text)) return false;
  if (!text(value['targetSystem'], OBSERVATION_LIMITS.text)) return false;
  if (typeof found !== 'string' || !(OBSERVATION_FOUND_VALUES as readonly string[]).includes(found)) return false;
  if (!isObservationInstant(value['observedAt'])) return false;
  if (!text(value['stepExecutionId'], OBSERVATION_LIMITS.text)) return false;
  if (
    typeof value['captureMethod'] !== 'string' ||
    !(OBSERVATION_CAPTURE_METHODS as readonly string[]).includes(value['captureMethod'])
  )
    return false;
  if (
    typeof value['matchOrigin'] !== 'string' ||
    !(OBSERVATION_MATCH_ORIGINS as readonly string[]).includes(value['matchOrigin'])
  )
    return false;
  const identity = value['identity'];
  if (identity !== null && !isObservationAttribute(identity)) return false;
  if (found === 'true' && (identity === null || identity.grounding === null)) return false;
  if (found !== 'true' && identity !== null) return false;
  const attributes = value['attributes'];
  if (!Array.isArray(attributes) || attributes.length > OBSERVATION_LIMITS.attributes) return false;
  if (!attributes.every(isObservationAttribute)) return false;
  const names = attributes.map((attribute) => attribute.name);
  if (new Set(names).size !== names.length) return false;
  const evidenceIds = value['evidenceIds'];
  if (!Array.isArray(evidenceIds) || evidenceIds.length > OBSERVATION_LIMITS.evidence) return false;
  if (!evidenceIds.every((id) => text(id, OBSERVATION_LIMITS.text))) return false;
  if (new Set(evidenceIds as string[]).size !== evidenceIds.length) return false;
  // Every grounding must name Evidence this Observation actually links, or the
  // Observation points at an artifact nothing recorded it as depending on.
  const linked = new Set(evidenceIds as string[]);
  const grounded = [identity, ...attributes].filter(
    (attribute): attribute is ObservationAttribute => attribute !== null && attribute.grounding !== null,
  );
  return grounded.every((attribute) => linked.has(attribute.grounding!.evidenceId));
}
