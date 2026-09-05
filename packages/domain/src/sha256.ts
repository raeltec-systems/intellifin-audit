/**
 * SHA-256 and UTF-8 encoding, in plain TypeScript, because `packages/domain` has no
 * dependencies at all — not even Node's.
 *
 * AD-2 puts the registration digest in the domain module and nowhere else, and AD-1
 * keeps this package free of every outward import. `@types/node` is deliberately absent
 * here (see CLAUDE.md: without it `process.env` does not typecheck, which is how the
 * "no ambient environment inward" rule is enforced by the compiler rather than only by
 * `pnpm boundaries`), so `node:crypto` is not reachable and adding it would trade a
 * compiler-enforced invariant for a convenience.
 *
 * A hand-written hash is only acceptable if it is checked against implementations that
 * are not this one, so it is checked against two:
 *
 *   - `tests/fixtures/registration-digest-golden.json`, produced by Python
 *     `rfc8785` + `hashlib.sha256`; and
 *   - `tests/unit/sha256.test.ts`, which runs it against Node's `node:crypto` over the
 *     block-boundary lengths (55, 56, 63, 64, 119, 120 bytes) where a padding mistake
 *     hides, plus multi-byte UTF-8 and the published NIST vectors.
 *
 * `computeAuditEventHash` in `packages/infrastructure` still uses `node:crypto`: it
 * hashes raw bytes with a previous-hash prefix and lives in a layer that may.
 */

/** The first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The first 32 bits of the fractional parts of the square roots of the first 8 primes. */
const INITIAL_STATE = Uint32Array.from([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/** Thrown when a string cannot be encoded as UTF-8, which means it is not canonicalizable. */
export class Utf8EncodingError extends Error {
  override readonly name = 'Utf8EncodingError';
}

/**
 * UTF-8 bytes for `text`.
 *
 * A lone surrogate — half of a pair, produced by slicing a string between them, or by a
 * `\uD800` that arrived from a JSON document — has no UTF-8 encoding at all. Node's
 * `TextEncoder` and browsers silently substitute U+FFFD for it; that substitution would
 * make two different inputs hash the same, so this refuses instead. Python's `rfc8785`
 * refuses as well, which is why the golden fixture and this function agree.
 */
export function utf8Bytes(text: string): Uint8Array {
  // Count before allocating: a number[] amplifies multi-megabyte Evidence into
  // hundreds of megabytes of temporary storage. Preserve strict surrogate checks.
  let size = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) size++;
    else if (code < 0x800) size += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const low = text.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new Utf8EncodingError('a lone high surrogate has no UTF-8 encoding');
      size += 4; index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Utf8EncodingError('a lone low surrogate has no UTF-8 encoding');
    else size += 3;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes[offset++] = code;
    } else if (code < 0x800) {
      bytes[offset++] = 0xc0 | (code >> 6); bytes[offset++] = 0x80 | (code & 0x3f);
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const low = text.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) {
        throw new Utf8EncodingError('a lone high surrogate has no UTF-8 encoding');
      }
      const point = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
      bytes[offset++] = 0xf0 | (point >> 18);
      bytes[offset++] = 0x80 | ((point >> 12) & 0x3f);
      bytes[offset++] = 0x80 | ((point >> 6) & 0x3f);
      bytes[offset++] = 0x80 | (point & 0x3f);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Utf8EncodingError('a lone low surrogate has no UTF-8 encoding');
    } else {
      bytes[offset++] = 0xe0 | (code >> 12); bytes[offset++] = 0x80 | ((code >> 6) & 0x3f); bytes[offset++] = 0x80 | (code & 0x3f);
    }
  }
  return bytes;
}

function rotateRight(value: number, amount: number): number {
  return ((value >>> amount) | (value << (32 - amount))) >>> 0;
}

/** Lower-case SHA-256 hex of the given bytes (FIPS 180-4). */
export function sha256HexOfBytes(input: Uint8Array): string {
  const bitLength = input.length * 8;
  // One 0x80 byte, then zeros, then the 64-bit big-endian bit length in the last 8.
  const paddedLength = (((input.length + 9 + 63) / 64) | 0) * 64;
  const message = new Uint8Array(paddedLength);
  message.set(input, 0);
  message[input.length] = 0x80;
  // Split rather than a single 32-bit write: an input over 512 MiB overflows 32 bits,
  // and a length silently truncated there produces a hash that is wrong and plausible.
  const view = new DataView(message.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const state = Uint32Array.from(INITIAL_STATE);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15] as number;
      const b = w[i - 2] as number;
      const s0 = (rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3)) >>> 0;
      const s1 = (rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10)) >>> 0;
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }

    let a = state[0] as number;
    let b = state[1] as number;
    let c = state[2] as number;
    let d = state[3] as number;
    let e = state[4] as number;
    let f = state[5] as number;
    let g = state[6] as number;
    let h = state[7] as number;

    for (let i = 0; i < 64; i += 1) {
      const S1 = (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const S0 = (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = ((state[0] as number) + a) >>> 0;
    state[1] = ((state[1] as number) + b) >>> 0;
    state[2] = ((state[2] as number) + c) >>> 0;
    state[3] = ((state[3] as number) + d) >>> 0;
    state[4] = ((state[4] as number) + e) >>> 0;
    state[5] = ((state[5] as number) + f) >>> 0;
    state[6] = ((state[6] as number) + g) >>> 0;
    state[7] = ((state[7] as number) + h) >>> 0;
  }

  let hex = '';
  for (const word of state) hex += word.toString(16).padStart(8, '0');
  return hex;
}

/** Lower-case SHA-256 hex of the UTF-8 bytes of `text`. */
export function sha256Hex(text: string): string {
  return sha256HexOfBytes(utf8Bytes(text));
}
