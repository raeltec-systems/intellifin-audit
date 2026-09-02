/**
 * The one RFC 8785 (JSON Canonicalization Scheme) serializer in this codebase.
 *
 * It lived inside `audit-event.ts` as a private function until Story 1.6 needed the
 * same bytes for the Target System registration digest. Copying it would have produced
 * two implementations that agree on every value anybody thought to try and diverge on
 * the first one nobody did — an escaped lone surrogate, a `-0`, an integer past 2^53 —
 * and both would look correct in isolation, because each would be checked only against
 * itself. There is therefore exactly one, and both digests import it.
 *
 * Two independently produced golden fixtures pin the bytes this function emits:
 * `tests/fixtures/audit-chain-golden.json` and
 * `tests/fixtures/registration-digest-golden.json`, both generated with Python
 * `rfc8785` + `hashlib` rather than with this code.
 */

/** JSON values accepted by a canonical envelope. */
export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * RFC 8785 canonical text for `value`.
 *
 * Object keys are sorted, arrays keep their order (an array is data, not a set), and
 * scalars are serialized by `JSON.stringify`, whose string and number forms are the
 * ones JCS specifies for the values this product uses. Callers are responsible for
 * handing over a value that is already valid canonical-JSON input: finite numbers,
 * plain objects, no lone surrogates. `assertAuditPayload` and
 * `assertCanonicalizableString` are the two guards that do that in this codebase.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key] as JsonValue)}`)
    .join(',')}}`;
}
