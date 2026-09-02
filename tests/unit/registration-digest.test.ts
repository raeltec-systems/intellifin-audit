import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  registrationCanonicalText,
  registrationDigest,
  registrationDigestEnvelope,
  type RegistrationDigestInput,
} from '@intellifin/domain';

/**
 * The AD-2 digest against vectors this repository's TypeScript did not produce.
 *
 * `scripts/make-registration-digest-golden.py` writes them with Python `rfc8785` +
 * `hashlib.sha256`, and its envelopes are written out BY HAND, so three separate things
 * are checked against something other than themselves: the projection from a
 * registration to its six hashed keys, the RFC 8785 bytes, and the hash of those bytes.
 *
 * It lives here rather than in `packages/domain` for the same reason
 * `tests/unit/audit-event.test.ts` does: that package has no `@types/node`, so it cannot
 * read a fixture off disk — which is the compiler-enforced half of "no ambient
 * environment inward" (AD-11) and is not worth trading away for a file location.
 */

interface GoldenVector {
  readonly name: string;
  readonly input: RegistrationDigestInput;
  readonly envelope: Record<string, unknown>;
  readonly canonicalText: string;
  readonly digest: string;
}

const golden = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../fixtures/registration-digest-golden.json', import.meta.url)),
    'utf8',
  ),
) as { readonly producer: string; readonly vectors: readonly GoldenVector[] };

describe('the registration digest against an independently produced vector', () => {
  it('was produced by something that is not TypeScript', () => {
    // If this ever reads "produced by @intellifin/domain", the fixture has stopped being
    // evidence and the vectors must be regenerated with the Python script.
    expect(golden.producer).toMatch(/^Python /);
    expect(golden.vectors.length).toBeGreaterThanOrEqual(4);
  });

  it.each(golden.vectors.map((vector) => [vector.name, vector] as const))(
    'projects, canonicalizes and hashes %s exactly as Python did',
    (_name, vector) => {
      expect(registrationDigestEnvelope(vector.input)).toEqual(vector.envelope);
      expect(registrationCanonicalText(vector.input)).toBe(vector.canonicalText);
      expect(registrationDigest(vector.input)).toBe(vector.digest);
    },
  );

  it('gives every vector a distinct digest, so a passing comparison means something', () => {
    const digests = golden.vectors.map((vector) => vector.digest);
    expect(new Set(digests).size).toBe(digests.length);
  });
});
