import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  bindingCanonicalText,
  bindingDigest,
  bindingDigestEnvelope,
  type BindingDigestInput,
} from '@intellifin/domain';

/**
 * The Population Source binding digest against vectors this repository's TypeScript did
 * not produce.
 *
 * `scripts/make-binding-digest-golden.py` writes them with Python `rfc8785` +
 * `hashlib.sha256`, and its envelopes are written out BY HAND, so three separate things
 * are checked against something other than themselves: the projection from a binding to
 * its five hashed keys, the RFC 8785 bytes, and the hash of those bytes.
 *
 * It lives here rather than in `packages/domain` for the same reason
 * `tests/unit/registration-digest.test.ts` does: that package has no `@types/node`, so it
 * cannot read a fixture off disk — the compiler-enforced half of "no ambient environment
 * inward" (AD-11), which is not worth trading away for a file location.
 */

interface GoldenVector {
  readonly name: string;
  readonly input: BindingDigestInput;
  readonly envelope: Record<string, unknown>;
  readonly canonicalText: string;
  readonly digest: string;
}

const golden = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../fixtures/binding-digest-golden.json', import.meta.url)),
    'utf8',
  ),
) as { readonly producer: string; readonly vectors: readonly GoldenVector[] };

describe('the binding digest against an independently produced vector', () => {
  it('was produced by something that is not TypeScript', () => {
    // If this ever reads "produced by @intellifin/domain", the fixture has stopped being
    // evidence and the vectors must be regenerated with the Python script.
    expect(golden.producer).toMatch(/^Python /);
    expect(golden.vectors.length).toBeGreaterThanOrEqual(5);
  });

  it.each(golden.vectors.map((vector) => [vector.name, vector] as const))(
    'projects, canonicalizes and hashes %s exactly as Python did',
    (_name, vector) => {
      expect(bindingDigestEnvelope(vector.input)).toEqual(vector.envelope);
      expect(bindingCanonicalText(vector.input)).toBe(vector.canonicalText);
      expect(bindingDigest(vector.input)).toBe(vector.digest);
    },
  );

  it('gives every distinct envelope a distinct digest', () => {
    // Two vectors deliberately share one: the set-vs-list pair, which differs only in
    // the order the sensitive fields were typed and must therefore agree. Grouping by
    // envelope rather than asserting all-distinct keeps that pair meaningful while still
    // proving that different contracts freeze different numbers.
    const byEnvelope = new Map<string, string>();
    for (const vector of golden.vectors) {
      const key = JSON.stringify(vector.envelope);
      const seen = byEnvelope.get(key);
      if (seen === undefined) byEnvelope.set(key, vector.digest);
      else expect(seen).toBe(vector.digest);
    }
    expect(new Set(golden.vectors.map((vector) => vector.digest)).size).toBe(byEnvelope.size);
  });

  it('holds the pair that must agree and the pair that must not', () => {
    // Named explicitly, because the grouping above would still pass if the generator
    // stopped producing either vector.
    const find = (name: string): GoldenVector => {
      const vector = golden.vectors.find((candidate) => candidate.name === name);
      if (vector === undefined) throw new Error(`the fixture no longer carries "${name}"`);
      return vector;
    };
    expect(find('sensitive-fields-order-irrelevant').digest).toBe(
      find('versioned-file-cover-sheet').digest,
    );
    expect(find('schema-order-reversed').digest).not.toBe(
      find('versioned-file-cover-sheet').digest,
    );
  });
});
