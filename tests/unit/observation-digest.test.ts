import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  observationBatchDigest,
  observationCanonicalText,
  observationDigest,
  observationDigestEnvelope,
  type ObservationRecord,
} from '@intellifin/domain';

/**
 * The Observation digest against vectors this repository's TypeScript did not produce.
 *
 * `scripts/make-observation-digest-golden.py` writes them with Python `rfc8785` +
 * `hashlib.sha256`, and its envelopes are written out BY HAND, so three separate things
 * are checked against something other than themselves: the projection from a wire record
 * to its thirteen hashed keys, the RFC 8785 bytes, and the hash of those bytes.
 *
 * It lives here rather than in `packages/domain` for the reason
 * `tests/unit/binding-digest.test.ts` does: that package has no `@types/node`, so it
 * cannot read a fixture off disk — the compiler-enforced half of "no ambient environment
 * inward" (AD-11), which is not worth trading away for a file location.
 */

interface GoldenVector {
  readonly name: string;
  readonly record: ObservationRecord;
  readonly envelope: Record<string, unknown>;
  readonly canonicalText: string;
  readonly digest: string;
}

interface GoldenBatch {
  readonly name: string;
  readonly members: readonly string[];
  readonly digests: readonly string[];
  readonly canonicalText: string;
  readonly batchDigest: string;
}

const golden = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../fixtures/observation-digest-golden.json', import.meta.url)),
    'utf8',
  ),
) as {
  readonly producer: string;
  readonly vectors: readonly GoldenVector[];
  readonly batches: readonly GoldenBatch[];
};

const find = (name: string): GoldenVector => {
  const vector = golden.vectors.find((candidate) => candidate.name === name);
  if (vector === undefined) throw new Error(`the fixture no longer carries "${name}"`);
  return vector;
};

describe('the Observation digest against an independently produced vector', () => {
  it('was produced by something that is not TypeScript', () => {
    // If this ever reads "produced by @intellifin/domain", the fixture has stopped being
    // evidence and the vectors must be regenerated with the Python script.
    expect(golden.producer).toMatch(/^Python /);
    expect(golden.vectors.length).toBeGreaterThanOrEqual(6);
    expect(golden.batches.length).toBeGreaterThanOrEqual(3);
  });

  it.each(golden.vectors.map((vector) => [vector.name, vector] as const))(
    'projects, canonicalizes and hashes %s exactly as Python did',
    (_name, vector) => {
      expect(observationDigestEnvelope(vector.record)).toEqual(vector.envelope);
      expect(observationCanonicalText(vector.record)).toBe(vector.canonicalText);
      expect(observationDigest(vector.record)).toBe(vector.digest);
    },
  );

  it('gives every distinct record a distinct digest', () => {
    expect(new Set(golden.vectors.map((vector) => vector.digest)).size).toBe(golden.vectors.length);
  });

  it('moves when corroboration is set, which is why corroboration runs first', () => {
    // Corroboration is set by the Evidence Quality Gate AT registration (B.1), so it has
    // to be applied before the digest is taken. A seam that wrote it afterwards would
    // leave every row disagreeing with its own recorded digest.
    expect(find('found-after-corroboration').digest).not.toBe(find('found-grounded-identity').digest);
  });

  it('hashes the declared order of attributes, not a set of them', () => {
    expect(find('attribute-order-reversed').digest).not.toBe(find('attribute-order-is-hashed').digest);
  });

  it.each(golden.batches.map((batch) => [batch.name, batch] as const))(
    'hashes the %s batch of digests exactly as Python did',
    (_name, batch) => {
      expect(observationBatchDigest(batch.digests)).toBe(batch.batchDigest);
    },
  );

  it('gives a reordered batch a different batch digest', () => {
    const ordered = golden.batches.find((batch) => batch.name === 'three-in-order')!;
    const reordered = golden.batches.find((batch) => batch.name === 'three-reordered')!;
    expect(new Set(ordered.digests)).toEqual(new Set(reordered.digests));
    expect(ordered.batchDigest).not.toBe(reordered.batchDigest);
  });

  it('covers every wire field, so an edit to any of them is detectable', () => {
    // The point of the digest. Each mutation below is one field of the record; if any of
    // them left the digest unchanged, a row could be edited after registration and still
    // agree with what the chain recorded.
    const base = find('found-grounded-identity').record;
    const digest = observationDigest(base);
    const mutations: readonly ObservationRecord[] = [
      { ...base, observationId: '0f9a1a3d-2f2c-8a1b-9f0c-6b4e2d1c8a71' },
      { ...base, workItemId: '01990000-0000-7000-8000-00000000a002' },
      { ...base, populationRecordKey: 'AG-1004' },
      { ...base, targetSystem: 'other' },
      { ...base, found: 'ambiguous', identity: null, attributes: [] },
      { ...base, observedAt: '2026-09-05T00:00:01.000Z' },
      { ...base, stepExecutionId: '01990000-0000-7000-8000-00000000b002' },
      { ...base, captureMethod: 'agent' },
      { ...base, matchOrigin: 'human-matched' },
      { ...base, identity: { ...base.identity!, normalizedValue: 'AG-9999' } },
      {
        ...base,
        identity: {
          ...base.identity!,
          grounding: { ...base.identity!.grounding!, locator: '$.accounts[2].account_id' },
        },
      },
      { ...base, attributes: [] },
      { ...base, evidenceIds: [...base.evidenceIds, '01990000-0000-7000-8000-00000000c002'] },
    ];
    for (const mutated of mutations) expect(observationDigest(mutated)).not.toBe(digest);
    expect(mutations).toHaveLength(13);
  });

  it('ignores a property the wire schema does not name', () => {
    // The projection is written key by key rather than spread, so whatever a caller hung
    // off its object cannot enter a value the audit chain freezes.
    const base = find('found-grounded-identity').record;
    const extra = { ...base, attempts: 3, leaseUntil: 'later', revision: 7 } as ObservationRecord;
    expect(observationDigest(extra)).toBe(observationDigest(base));
  });
});
