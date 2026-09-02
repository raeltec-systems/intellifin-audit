import { canonicalJson, type JsonValue } from '../canonical-json.js';
import { sha256Hex } from '../sha256.js';

/**
 * Population Source bindings: the binding kinds, the declared-count vocabulary, and the
 * binding digest a Procedure Version freezes (FR-6, FR-41).
 *
 * **This module is the only place the binding digest is computed.** It is the other half
 * of what a Procedure Version freezes — Story 1.6 froze what the agent may READ, this
 * freezes where the population COMES FROM — and it is built the same way for the same
 * reason: a second implementation anywhere would eventually disagree with this one, and
 * the disagreement would show up as a Run that cannot prove which population contract it
 * was executed against.
 *
 * The canonicalizer is `canonical-json.ts`, shared with the audit chain and with the
 * registration digest rather than copied.
 *
 * AD-2 names the six-key registration envelope by name and says only that approval
 * freezes the Population Source binding. This module therefore extends that mechanism by
 * ANALOGY rather than by citation — one domain function, an explicit key-by-key
 * projection, an independently produced vector. It is written down here, and in the
 * story spec's Design Notes, so that a later story reconciles the two deliberately
 * instead of discovering that the codebase grew a second, differently shaped freezing
 * mechanism by accident.
 */

/**
 * FR-6: the three binding kinds the PoC supports.
 *
 * `manual-upload` is valid only for a `once` Schedule. That rule is enforced by the
 * Builder in Epic 2 (AD-23), not here: this module records WHAT the binding is, and a
 * Schedule does not exist yet to check it against. The surface states the restriction so
 * that an administrator registering one is not surprised by it later.
 */
export const POPULATION_SOURCE_KINDS = ['manual-upload', 'versioned-file', 'read-only-api'] as const;
export type PopulationSourceKind = (typeof POPULATION_SOURCE_KINDS)[number];

export function isPopulationSourceKind(value: unknown): value is PopulationSourceKind {
  return (
    typeof value === 'string' && (POPULATION_SOURCE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * How the binding's expected row count is declared INDEPENDENTLY of this platform
 * (FR-6).
 *
 * `none` is a real member, not a missing value. FR-6 requires the absence of a declared
 * count to be "surfaced at authoring time", and a binding that cannot be saved cannot be
 * surfaced at all: nobody can see what is missing on a binding that does not exist. So
 * `none` is saveable, it is inside the digest like the other two, and the surface warns
 * that no Procedure can submit against it.
 */
export const DECLARED_COUNT_MECHANISMS = ['cover-sheet', 'count-endpoint', 'none'] as const;
export type DeclaredCountMechanism = (typeof DECLARED_COUNT_MECHANISMS)[number];

export function isDeclaredCountMechanism(value: unknown): value is DeclaredCountMechanism {
  return (
    typeof value === 'string' && (DECLARED_COUNT_MECHANISMS as readonly string[]).includes(value)
  );
}

/** `true` when no Procedure Version may be submitted against a binding declared this way. */
export function declaresNoExpectedCount(mechanism: DeclaredCountMechanism): boolean {
  return mechanism === 'none';
}

/** The five-key envelope, exactly as it is canonicalized and hashed. */
export interface BindingDigestEnvelope {
  readonly declared_count_mechanism: DeclaredCountMechanism;
  /**
   * The declared field names, IN ORDER.
   *
   * This is the one member of the envelope that is a list rather than a set, and the
   * difference is deliberate. A schema is a declaration about a file or a response whose
   * fields have positions; `[account, amount]` and `[amount, account]` are two different
   * declarations, and a parser told the second would read the wrong column. Duplicates
   * are still removed — a field cannot be declared twice — and blanks are dropped, but
   * the order the administrator typed is the order that is hashed.
   *
   * {@link BindingDigestEnvelope.sensitive_fields} is the opposite case and is a set:
   * masking asks only whether a field is in the group, and reordering the group changes
   * nothing about which values are hidden.
   */
  readonly declared_schema: readonly string[];
  readonly kind: PopulationSourceKind;
  /**
   * Where the population is found, or `null` when there is nowhere to name.
   *
   * A `manual-upload` binding has no location: the file arrives with the Run. `null`
   * rather than an omitted key, so every kind produces the same five keys and "exactly
   * these keys" is one statement rather than three.
   */
  readonly location: string | null;
  /** A set: trimmed, deduplicated, sorted. Always a subset of `declared_schema`. */
  readonly sensitive_fields: readonly string[];
}

/** The five digest-bearing fields, as a binding holds them. */
export interface BindingDigestInput {
  readonly kind: PopulationSourceKind;
  /** Empty for a `manual-upload` binding, which names nowhere. */
  readonly location: string;
  readonly declaredSchema: readonly string[];
  readonly declaredCountMechanism: DeclaredCountMechanism;
  /** Must be a subset of the declared schema; the command refuses anything else. */
  readonly sensitiveFields: readonly string[];
}

/**
 * Trim, drop blanks, remove duplicates, KEEP the order.
 *
 * Used for the declared schema, where position is part of the declaration.
 */
function normalizedList(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))];
}

/**
 * The same, then sorted: a set.
 *
 * Sorting is by UTF-16 code unit, which is what `Array.prototype.sort` does and what the
 * golden fixture was produced to match. Used for the sensitive fields, where an
 * administrator who retypes the same two field names in the other order has not changed
 * which values are masked — and a digest that moved would mint a platform-authored draft
 * for every Procedure that references the binding, over nothing.
 */
function normalizedSet(values: readonly string[]): readonly string[] {
  return [...normalizedList(values)].sort();
}

/**
 * Project a binding onto the exact five keys the digest covers.
 *
 * Explicit, key by key, in the same style as `registrationDigestEnvelope` and
 * `canonicalizeAuditEvent`: a spread of the input would carry the display name, the id,
 * the note and the timestamps into the hash, and every one of those would move a digest
 * that must not move.
 */
export function bindingDigestEnvelope(input: BindingDigestInput): BindingDigestEnvelope {
  const location = input.kind === 'manual-upload' ? '' : input.location.trim();
  return {
    declared_count_mechanism: input.declaredCountMechanism,
    declared_schema: normalizedList(input.declaredSchema),
    kind: input.kind,
    location: location === '' ? null : location,
    sensitive_fields: normalizedSet(input.sensitiveFields),
  };
}

/** The RFC 8785 text that is hashed. Exposed so a fixture can pin the bytes, not only the digest. */
export function bindingCanonicalText(input: BindingDigestInput): string {
  return canonicalJson(bindingDigestEnvelope(input) as unknown as JsonValue);
}

/**
 * The binding digest: SHA-256 over the RFC 8785 canonical JSON of the five-key envelope,
 * lower-case hex.
 *
 * Checked against `tests/fixtures/binding-digest-golden.json`, which was produced by
 * Python `rfc8785` + `hashlib.sha256` and not by this function.
 */
export function bindingDigest(input: BindingDigestInput): string {
  return sha256Hex(bindingCanonicalText(input));
}

/**
 * `true` when every sensitive field is one of the declared schema fields.
 *
 * FR-41 makes the masking designation part of the Population Source contract, and a mask
 * over a field the schema does not declare masks nothing while reading, in a list view,
 * exactly like protection. The comparison is over the NORMALIZED values, so a trailing
 * space in one field name and not the other is not a mismatch.
 */
export function sensitiveFieldsAreDeclared(input: {
  readonly declaredSchema: readonly string[];
  readonly sensitiveFields: readonly string[];
}): boolean {
  const declared = new Set(normalizedList(input.declaredSchema));
  return normalizedList(input.sensitiveFields).every((field) => declared.has(field));
}
