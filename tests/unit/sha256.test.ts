import { createHash, createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { Utf8EncodingError, hmacSha256Hex, sha256Bytes, sha256Hex, sha256HexOfBytes, utf8Bytes } from '@intellifin/domain';

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

/**
 * HMAC-SHA-256, checked against one that is not it (Story 3.7).
 *
 * The Exception fingerprint is keyed, and a keyed hash has one more place to get padding
 * wrong than a plain one: RFC 2104 zero-pads a key shorter than the 64-byte block and
 * REPLACES a longer one with its own digest. Those three key lengths are where a mistake
 * hides, so they are the ones exercised, alongside the published RFC 4231 vectors.
 */
describe('hmacSha256Hex', () => {
  const nodeHmac = (key: Uint8Array, message: Uint8Array): string =>
    createHmac('sha256', Buffer.from(key)).update(Buffer.from(message)).digest('hex');

  it.each([
    ['shorter than a block', 20],
    ['exactly a block', 64],
    ['longer than a block', 100],
    ['empty', 0],
  ])('agrees with node:crypto for a key %s', (_name, keyLength) => {
    const key = Uint8Array.from({ length: keyLength }, (_value, index) => (index * 7 + 3) & 0xff);
    for (const length of BOUNDARY_LENGTHS) {
      const message = Uint8Array.from({ length }, (_value, index) => (index * 11 + 5) & 0xff);
      expect(hmacSha256Hex(key, message), `key ${String(keyLength)} message ${String(length)}`).toBe(
        nodeHmac(key, message),
      );
    }
  });

  it('matches the published RFC 4231 vectors', () => {
    // Test case 1: a 20-byte 0x0b key over "Hi There".
    expect(hmacSha256Hex(new Uint8Array(20).fill(0x0b), utf8Bytes('Hi There'))).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
    // Test case 2: the key "Jefe" over "what do ya want for nothing?".
    expect(hmacSha256Hex(utf8Bytes('Jefe'), utf8Bytes('what do ya want for nothing?'))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
    // Test case 6: a 131-byte key, longer than one block, so the key is itself hashed.
    expect(
      hmacSha256Hex(
        new Uint8Array(131).fill(0xaa),
        utf8Bytes('Test Using Larger Than Block-Size Key - Hash Key First'),
      ),
    ).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });

  it('renders the same digest as the hex form it shares an implementation with', () => {
    for (const length of BOUNDARY_LENGTHS) {
      const input = Uint8Array.from({ length }, (_value, index) => index & 0xff);
      const raw = sha256Bytes(input);
      expect(raw).toHaveLength(32);
      expect([...raw].map((byte) => byte.toString(16).padStart(2, '0')).join('')).toBe(
        sha256HexOfBytes(input),
      );
    }
  });
});
