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

/** Raised for input that has no canonical form. Never for a value's content. */
export class NotCanonicalizableError extends TypeError {
  override readonly name = 'NotCanonicalizableError';
}

/**
 * Refuse a string containing an unpaired surrogate.
 *
 * A lone surrogate has no UTF-8 encoding, so it has no canonical form; Python
 * `rfc8785`, which produced both golden fixtures, raises on the same input. This
 * function has to live HERE rather than in `sha256.ts`, where the equivalent guard
 * already existed and was documented as the protection: `JSON.stringify` escapes a
 * lone surrogate to the six ASCII characters `\ud800` before the hash ever sees the
 * text, so by then there is nothing left to refuse and the guard could not fire.
 *
 * What that cost, on the registration path, was a row that permanently disagreed with
 * its own digest: the digest was taken over the escaped form, while the driver encoded
 * the same string for the wire with UTF-8 substitution and PostgreSQL stored U+FFFD.
 * Nothing recomputes a digest on read, so the disagreement was silent and permanent.
 */
function assertWellFormed(text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = text.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) {
        throw new NotCanonicalizableError('a lone Unicode surrogate has no canonical form');
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new NotCanonicalizableError('a lone Unicode surrogate has no canonical form');
    }
  }
}

/**
 * RFC 8785 canonical text for `value`.
 *
 * Object keys are sorted, arrays keep their order (an array is data, not a set), and
 * scalars are serialized by `JSON.stringify`, whose string and number forms are the
 * ones JCS specifies for the values this product uses.
 *
 * Input this cannot represent is REFUSED, never substituted. A lone surrogate and a
 * non-finite number both used to pass through — the first escaped by `JSON.stringify`,
 * the second turned into `null` — and each produced a digest over something that was
 * not the input. Python `rfc8785` raises on both; so does this. A serializer that
 * substitutes is the same class of defect as an encoder that substitutes U+FFFD.
 */
export function canonicalJson(value: JsonValue): string {
  if (typeof value === 'string') {
    assertWellFormed(value);
    return JSON.stringify(value);
  }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new NotCanonicalizableError('a non-finite number has no canonical form');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(object)
    .sort()
    .map((key) => {
      assertWellFormed(key);
      return `${JSON.stringify(key)}:${canonicalJson(object[key] as JsonValue)}`;
    })
    .join(',')}}`;
}
