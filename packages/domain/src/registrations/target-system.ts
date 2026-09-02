import { canonicalJson, type JsonValue } from '../canonical-json.js';
import { sha256Hex } from '../sha256.js';

/**
 * Target System registrations: the kinds, the read-only action vocabulary, and the
 * AD-2 registration digest (FR-8).
 *
 * **This module is the only place the digest is computed.** A Procedure Version freezes
 * the digest of every registration it was allowed to touch, so a second implementation
 * anywhere — a query that recomputes it in SQL, a helper in the web layer, a fixture
 * builder in a test — would eventually disagree with this one, and the disagreement
 * would show up as a Run that cannot prove what it was permitted to read.
 *
 * The canonicalizer is `canonical-json.ts`, shared with the audit chain rather than
 * copied, for the same reason at one level down.
 */

/** FR-8: every registered Target System is one of these four. */
export const TARGET_SYSTEM_KINDS = ['web', 'desktop', 'api', 'versioned-file'] as const;
export type TargetSystemKind = (typeof TARGET_SYSTEM_KINDS)[number];

export function isTargetSystemKind(value: unknown): value is TargetSystemKind {
  return typeof value === 'string' && (TARGET_SYSTEM_KINDS as readonly string[]).includes(value);
}

/**
 * The complete vocabulary of actions an audit credential may be permitted.
 *
 * Every member observes; none of them changes anything in the Target System. There is
 * no "write" half of this list to be careful about, because a write action is not
 * expressible: `PermittedReadAction` is a union of these literals, so
 * `permittedActions: ['create-record']` does not compile. `isPermittedReadAction` is
 * the same rule for values that arrive as request input, where the type is a comment.
 *
 * `registrations.test.ts` also asserts that no member contains a mutating verb, which
 * is what stops a plausible-looking `export-report` or `submit-query` being added here
 * later and quietly becoming permissible.
 */
export const PERMITTED_READ_ACTIONS = [
  'navigate',
  'search',
  'list-records',
  'open-record',
  'read-attribute',
  'read-metadata',
  'read-file',
  'capture-screenshot',
] as const;
export type PermittedReadAction = (typeof PERMITTED_READ_ACTIONS)[number];

export function isPermittedReadAction(value: unknown): value is PermittedReadAction {
  return typeof value === 'string' && (PERMITTED_READ_ACTIONS as readonly string[]).includes(value);
}

/**
 * Verbs that describe changing something. No permitted action may contain one.
 *
 * This is a guard on the VOCABULARY, checked by a test, not a check on user input —
 * input is already confined to the list above. It exists because the list is the thing
 * a later story will be tempted to extend.
 */
export const MUTATING_VERBS = [
  'create',
  'update',
  'delete',
  'write',
  'insert',
  'upload',
  'submit',
  'approve',
  'execute',
  'modify',
  'remove',
  'post',
  'put',
  'patch',
  'send',
] as const;

/** The six-key envelope, exactly as it is canonicalized and hashed. */
export interface RegistrationDigestEnvelope {
  /**
   * The locator slot. Allowlisted origins for a `web`, `api` or `versioned-file`
   * system; the application identity, as a one-element list, for a `desktop` one.
   * There is one slot and not two so that the envelope has the same six keys for
   * every kind — a key set that varied by kind would make "exactly these keys" a
   * statement with four different meanings.
   */
  readonly allowed_origins: readonly string[];
  readonly attribute_label_patterns: readonly string[];
  readonly credential_ref: string;
  readonly kind: TargetSystemKind;
  readonly permitted_actions: readonly PermittedReadAction[];
  /** `null` when the system has no secondary key. Absent is a value, not a missing key. */
  readonly secondary_key: string | null;
}

/** The six digest-bearing fields, as a registration holds them. */
export interface RegistrationDigestInput {
  readonly kind: TargetSystemKind;
  /** Allowlisted origins. Empty for a `desktop` system. */
  readonly allowedOrigins: readonly string[];
  /** The desktop application identity. Empty for every other kind. */
  readonly applicationIdentity: string;
  /** Opaque. Never a secret, never resolvable to one from here. */
  readonly credentialRef: string;
  readonly permittedActions: readonly PermittedReadAction[];
  readonly attributeLabelPatterns: readonly string[];
  /** The empty string means "no secondary key" and canonicalizes to `null`. */
  readonly secondaryKey: string;
}

/**
 * A set of strings, made order-independent and duplicate-free.
 *
 * Origins, label patterns and permitted actions are sets: an administrator who retypes
 * the same two origins in the other order has not changed what the agent may touch, and
 * a digest that moved would mint a platform-authored draft for every Procedure that
 * references the registration, over nothing. Sorting is by UTF-16 code unit, which is
 * what `Array.prototype.sort` does and what the golden fixture was produced to match.
 */
function normalizedSet(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))].sort();
}

/**
 * Project a registration onto the exact six keys AD-2 names.
 *
 * Explicit, key by key, in the same style as `canonicalizeAuditEvent`: a spread of the
 * input would carry the display name, the id, the timestamps and anything a later story
 * adds into the hash, and every one of those would change a digest that must not move.
 */
export function registrationDigestEnvelope(
  input: RegistrationDigestInput,
): RegistrationDigestEnvelope {
  const secondaryKey = input.secondaryKey.trim();
  return {
    allowed_origins:
      input.kind === 'desktop'
        ? normalizedSet([input.applicationIdentity])
        : normalizedSet(input.allowedOrigins),
    attribute_label_patterns: normalizedSet(input.attributeLabelPatterns),
    credential_ref: input.credentialRef.trim(),
    kind: input.kind,
    permitted_actions: normalizedSet(input.permittedActions) as readonly PermittedReadAction[],
    secondary_key: secondaryKey === '' ? null : secondaryKey,
  };
}

/** The RFC 8785 text that is hashed. Exposed so a fixture can pin the bytes, not only the digest. */
export function registrationCanonicalText(input: RegistrationDigestInput): string {
  return canonicalJson(registrationDigestEnvelope(input) as unknown as JsonValue);
}

/**
 * The AD-2 registration digest: SHA-256 over the RFC 8785 canonical JSON of the six-key
 * envelope, lower-case hex.
 *
 * Checked against `tests/fixtures/registration-digest-golden.json`, which was produced
 * by Python `rfc8785` + `hashlib.sha256` and not by this function.
 */
export function registrationDigest(input: RegistrationDigestInput): string {
  return sha256Hex(registrationCanonicalText(input));
}
