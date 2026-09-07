import { canonicalJson, type JsonValue } from '../canonical-json.js';
import { OBSERVATION_LIMITS } from './observation.js';

/**
 * The versioned, bounded projection a browser producer captures from one page.
 *
 * This is intentionally a semantic tree rather than HTML or a browser object. The producer
 * resolves accessible names and values before freezing the bytes; scripts, styles, markup and
 * browser handles never enter an Evidence artifact. `group` is an opaque producer key shared
 * by nodes from one result row (or page), so a caller can keep identity and values together
 * without interpreting a DOM locator. The node's array position is the stable locator index.
 */
export const WEB_TREE_SCHEMA_VERSION = 1 as const;

/** The media type stored beside a web-tree Evidence artifact. */
export const WEB_TREE_MEDIA_TYPE = 'application/vnd.intellifin.web-tree+json' as const;

/** The collection and value segment used by every web-tree locator. */
export const WEB_TREE_COLLECTION = 'nodes' as const;
export const WEB_TREE_VALUE_FIELD = 'value' as const;

export const WEB_TREE_ROLES = ['datum', 'link', 'input', 'button', 'status'] as const;
export type WebTreeRole = (typeof WEB_TREE_ROLES)[number];

/**
 * Bounds applied before a web-tree document can be treated as a snapshot.
 *
 * Labels, groups and targets use the identifier/text bound from Observation groundings;
 * values use the captured-value bound. `completion.returned` is the page's declared total and can be
 * larger than the bounded node page when `completion.complete` is false.
 */
export const WEB_TREE_LIMITS = {
  bytes: 4 * 1024 * 1024,
  nodes: 4096,
  returned: 100000,
  label: OBSERVATION_LIMITS.text,
  group: OBSERVATION_LIMITS.text,
  target: OBSERVATION_LIMITS.text,
  value: OBSERVATION_LIMITS.value,
} as const;

/** One platform-resolved semantic node from the captured page. */
export interface WebTreeNode {
  /** Opaque same-row/page key supplied by the platform producer. */
  readonly group: string;
  /** The bounded semantic role used by model-directed execution. */
  readonly role: WebTreeRole;
  /** Accessible name or platform-resolved label. */
  readonly label: string;
  /** Value presented by the Target System, retained with JSON type and exact spelling. */
  readonly value: JsonValue;
  /** Optional platform action target for a link or input. */
  readonly target: string | null;
}

/** The exact v1 web-tree document shape. */
export interface WebTreeCompletion {
  /** Whether the producer has a target-specific completeness postcondition. */
  readonly complete: boolean;
  /** A declared result total, never inferred from the captured node count. */
  readonly returned: number | null;
}

/** The exact v1 web-tree document shape. Generic capture omits `completion` when unknown. */
export interface WebTreeDocument {
  readonly schemaVersion: typeof WEB_TREE_SCHEMA_VERSION;
  readonly nodes: readonly WebTreeNode[];
  readonly completion?: WebTreeCompletion;
}

function object(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * Keep direct callers as strict as JSON.parse callers. `canonicalJson` deliberately accepts
 * the domain's JsonValue type, so this guard rejects functions, undefined and class instances
 * before the value is cast to that type. It also prevents an object with a custom prototype
 * from masquerading as a JSON object in an exported type guard.
 */
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!object(value)) return false;
  return Object.keys(value).every((key) => isJsonValue(value[key]));
}

/** A value that can survive canonical storage and fits one Observation field. */
function boundedValue(value: unknown): value is JsonValue {
  try {
    if (!isJsonValue(value)) return false;
    return canonicalJson(value).length <= WEB_TREE_LIMITS.value;
  } catch {
    return false;
  }
}

/** A non-empty platform-resolved text field that can survive canonical storage. */
function boundedText(value: unknown, limit: number): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) return false;
  if (value.length > limit) return false;
  try {
    canonicalJson(value);
    return true;
  } catch {
    return false;
  }
}

function boundedReturned(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= WEB_TREE_LIMITS.returned;
}

/** Validate optional target-specific completion metadata without deriving it from nodes. */
export function isWebTreeCompletion(value: unknown): value is WebTreeCompletion {
  if (!object(value) || !exactKeys(value, ['complete', 'returned']) || typeof value['complete'] !== 'boolean') {
    return false;
  }
  return value['returned'] === null || boundedReturned(value['returned']);
}

/** Validate one node without accepting a producer-specific field. */
export function isWebTreeNode(value: unknown): value is WebTreeNode {
  if (
    !object(value) ||
    !exactKeys(value, ['group', 'role', 'label', 'value', 'target']) ||
    !boundedText(value['group'], WEB_TREE_LIMITS.group) ||
    typeof value['role'] !== 'string' ||
    !(WEB_TREE_ROLES as readonly string[]).includes(value['role']) ||
    !boundedText(value['label'], WEB_TREE_LIMITS.label) ||
    !boundedValue(value['value'])
  ) {
    return false;
  }
  const target = value['target'];
  if (target !== null && !boundedText(target, WEB_TREE_LIMITS.target)) return false;
  // A datum or status is descriptive. An action role may carry a destination/field target,
  // but it is nullable when the browser could not resolve one; the key itself is mandatory.
  return (value['role'] === 'datum' || value['role'] === 'status') ? target === null : true;
}

/** Validate the complete, bounded document shape. */
export function isWebTreeDocument(value: unknown): value is WebTreeDocument {
  if (!object(value) || value['schemaVersion'] !== WEB_TREE_SCHEMA_VERSION || !Array.isArray(value['nodes'])) {
    return false;
  }
  const hasCompletion = Object.hasOwn(value, 'completion');
  if (!exactKeys(value, hasCompletion ? ['schemaVersion', 'nodes', 'completion'] : ['schemaVersion', 'nodes'])) {
    return false;
  }
  if (hasCompletion && !isWebTreeCompletion(value['completion'])) return false;
  if (value['nodes'].length > WEB_TREE_LIMITS.nodes || !value['nodes'].every(isWebTreeNode)) return false;
  // The per-node bounds prevent an oversized value; this whole-document check also bounds
  // labels, completion metadata, JSON punctuation and any nesting inside a node value. It guards
  // direct callers validating an object, where there are no source bytes to measure.
  try {
    return canonicalJson(value as unknown as JsonValue).length <= WEB_TREE_LIMITS.bytes;
  } catch {
    return false;
  }
}

/** Parse the UTF-8 text of one web-tree artifact, or return null for any invalid shape. */
export function parseWebTree(text: unknown): WebTreeDocument | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > WEB_TREE_LIMITS.bytes) return null;
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  return isWebTreeDocument(value) ? value : null;
}

/** The stable locator for the value of one ordered node. */
export function webTreeValueLocator(index: number): string | null {
  if (!Number.isSafeInteger(index) || index < 0 || index >= WEB_TREE_LIMITS.nodes) return null;
  return `$.${WEB_TREE_COLLECTION}[${String(index)}].${WEB_TREE_VALUE_FIELD}`;
}

/** The value and accessible label addressed by a web-tree locator's node index. */
export function readWebTreeCell(
  document: WebTreeDocument,
  index: number,
): { value: JsonValue; label: string } | null {
  if (!Number.isSafeInteger(index) || index < 0) return null;
  const node = document.nodes[index];
  return node === undefined ? null : { value: node.value, label: node.label };
}
