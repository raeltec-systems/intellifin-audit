import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { Utf8EncodingError, sha256Hex, sha256HexOfBytes, utf8Bytes } from '@intellifin/domain';

/**
 * The hand-written SHA-256 in `packages/domain`, checked against one that is not it.
 *
 * `packages/domain` has no dependencies — not even `@types/node`, which is what stops
 * `process.env` typechecking there (AD-11). So the AD-2 digest cannot use `node:crypto`
 * and the hash is implemented in plain TypeScript. That is only acceptable while it is
 * verified against implementations that are not this one; this file is the second such
 * check, alongside the Python-produced `tests/fixtures/registration-digest-golden.json`.
 *
 * The lengths are the ones a padding mistake survives: 55 and 56 straddle the point
 * where the length field no longer fits in the first block, 63/64/65 straddle the block
 * itself, and 119/120 straddle the second one.
 */

const BOUNDARY_LENGTHS = [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 121, 128, 1000];

function nodeHash(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('matches the published NIST vector for %j', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it.each(BOUNDARY_LENGTHS)('agrees with node:crypto at %i ASCII bytes', (length) => {
    const text = 'a'.repeat(length);
    expect(sha256Hex(text)).toBe(nodeHash(text));
  });

  it('agrees with node:crypto on multi-byte UTF-8', () => {
    for (const text of ['é', '金額', '🔎', 'N° de pièce', '𝄞x🔎', 'a'.repeat(53) + '🔎']) {
      expect(sha256Hex(text), text).toBe(nodeHash(text));
    }
  });

  it('agrees with node:crypto on a thousand pseudo-random strings', () => {
    // A fixed sequence, so a failure is reproducible. xorshift32, seeded.
    let state = 0x9e3779b9;
    const next = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    for (let count = 0; count < 1000; count += 1) {
      let text = '';
      const length = next() % 200;
      for (let index = 0; index < length; index += 1) {
        text += String.fromCodePoint(next() % 0x2000);
      }
      // Skip strings that landed a lone surrogate: those have no UTF-8 encoding at all
      // and the next case covers them.
      if (/[\uD800-\uDFFF]/.test(text)) continue;
      expect(sha256Hex(text), JSON.stringify(text)).toBe(nodeHash(text));
    }
  });

  it('hashes raw bytes identically to node:crypto', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_value, index) => (index * 37) % 256);
    expect(sha256HexOfBytes(bytes)).toBe(
      createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
    );
  });
});

describe('utf8Bytes', () => {
  it('encodes exactly as Buffer does', () => {
    for (const text of ['', 'abc', 'é', '金額', '🔎 locator', 'N° de pièce']) {
      expect([...utf8Bytes(text)], text).toEqual([...Buffer.from(text, 'utf8')]);
    }
  });

  /**
   * `TextEncoder` and `Buffer.from` both replace a lone surrogate with U+FFFD, so two
   * different strings would hash the same. That is a collision introduced by the
   * encoder, not by SHA-256, so this refuses instead — as Python's `rfc8785` does.
   */
  it('refuses a lone surrogate rather than substituting U+FFFD', () => {
    expect(() => utf8Bytes('\uD800')).toThrow(Utf8EncodingError);
    expect(() => utf8Bytes('a\uDC00b')).toThrow(Utf8EncodingError);
    expect(() => utf8Bytes('\uD83D')).toThrow(Utf8EncodingError);
    // A well-formed pair is fine.
    expect(() => utf8Bytes('🔎')).not.toThrow();
  });
});
