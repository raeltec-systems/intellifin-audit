import { utf8Bytes } from '../sha256.js';

/**
 * Finding a credential value in something this platform is about to keep forever
 * (Story 4.3, FR-20, AD-4).
 *
 * Story 4.2 put a secret inside a browser for the first time in this product's history,
 * and this platform captures what a Run sees. An artifact that carries a working
 * credential into immutable Evidence can never have it taken out again, so the question
 * "do these bytes contain the credential" has to have one answer, and it has to be
 * answerable over bytes nobody has parsed.
 *
 * Pure, and over BYTES rather than over a decoded document. `packages/domain` compiles
 * with `lib: ["ES2024"]` and no host types at all — the compiler-enforced half of AD-11 —
 * so there is no `TextDecoder` here, and there should not be: a screenshot is not text, and
 * `decodePopulationUtf8` throws on the first byte sequence that is not valid UTF-8. A byte
 * search reads a PNG, a PDF and a Structural Snapshot with one rule.
 *
 * **The needle is encoded, not the haystack decoded.** Percent-encoding, HTML escaping and
 * JSON string escaping are all the identity on `[A-Za-z0-9._~-]`, so for a token spelled in
 * those characters the raw form already covers them; where a token carries `+`, `/` or `=`
 * they differ and each form is searched for separately. Base64 is the one encoding that
 * transforms every character, and it is the one a credential most plausibly reaches an
 * artifact through — `Authorization: Basic`, a `data:` URL, a serialized HAR — so its three
 * alignments are searched for as well.
 *
 * **What this does NOT catch, named rather than claimed away.** A value the artifact
 * carries compressed, encrypted, split across a line break, re-cased, or encoded in a form
 * this module does not know is not found. Detection is a wall against the paths a capture
 * mechanism actually produces; it is not a proof of absence, and the platform's first
 * defence stays the credential having nowhere to live at all (`ResolvedCredential` has no
 * field holding a value).
 */

/**
 * What a redacted credential is written as.
 *
 * Said in words rather than left blank or starred out: an artifact with a gap in it reads
 * to a later reader as though nothing was there, which is the defect class this codebase
 * keeps finding (a dash that reads as "fine", an empty Gate checklist that reads as a
 * passed control). It carries no length information, deliberately — a run of asterisks the
 * length of the value tells an attacker how long the value is.
 */
export const REDACTED_CREDENTIAL = '[redacted credential]';

/**
 * The shortest value this build will scan for, in UTF-16 code units.
 *
 * A short "secret" matches ordinary text: scanning an artifact for a four-character value
 * would refuse the registration of almost anything, and lowering the bar to avoid that
 * would fail OPEN in the one guarantee this module exists to give. Twelve is generous
 * against any real audit credential and short enough that no synthetic one has to be
 * padded. A value below it is not scanned for and must therefore not be resolved at all —
 * the refusal lives at the one factory that makes a `ResolvedCredential`, so a credential
 * this build cannot contain is a credential it never presents.
 */
export const MIN_SCANNED_SECRET = 12;

const BASE64_STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Base64 without padding, over an explicit alphabet. No `btoa`: there are no host types. */
function base64(bytes: Uint8Array, alphabet: string): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += alphabet[a >> 2]!;
    out += alphabet[((a & 0x03) << 4) | ((b ?? 0) >> 4)]!;
    if (b === undefined) break;
    out += alphabet[((b & 0x0f) << 2) | ((c ?? 0) >> 6)]!;
    if (c === undefined) break;
    out += alphabet[c & 0x3f]!;
  }
  return out;
}

/**
 * The three base64 substrings a value produces, one per byte alignment.
 *
 * A value embedded in a larger base64 stream is encoded differently depending on whether it
 * begins at an offset that is 0, 1 or 2 modulo 3, and the characters at each end are shared
 * with the bytes around it. So each alignment is encoded with that many filler bytes in
 * front, the leading characters the filler touches are dropped, and the last character —
 * which the following bytes can change — is dropped too. What is left is a core that must
 * appear verbatim whenever the value appears at that alignment.
 */
function base64Cores(bytes: Uint8Array, alphabet: string): string[] {
  const cores: string[] = [];
  // Characters wholly or partly determined by k filler bytes: floor(8k/6) whole, plus the
  // one that straddles the boundary. k = 0 shares nothing, so nothing is dropped.
  const lead = [0, 2, 3];
  for (let k = 0; k < 3; k += 1) {
    const padded = new Uint8Array(k + bytes.length);
    padded.set(bytes, k);
    const encoded = base64(padded, alphabet);
    const core = encoded.slice(lead[k]!, encoded.length - 1);
    if (core.length > 0) cores.push(core);
  }
  return cores;
}

/** HTML text-node and attribute escaping, as every serializer applies it. */
function htmlEscaped(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The whole-value encodings a captured artifact can carry a credential in.
 *
 * Every one of these is a complete, self-contained spelling of the value, which is what
 * makes them safe to REPLACE. The phase-shifted base64 cores are deliberately not here:
 * they are fragments, and replacing a fragment inside a base64 stream would corrupt the
 * bytes around it while leaving the value recoverable from what remained.
 *
 * Longest first, so a form that contains another as a substring is replaced whole.
 */
export function secretTextForms(secret: string): readonly string[] {
  const bytes = utf8Bytes(secret);
  const forms = [
    secret,
    encodeURIComponent(secret),
    htmlEscaped(secret),
    // The inside of a JSON string: `\"`, `\\`, `\n`, `\uXXXX`. `slice` removes the quotes
    // JSON.stringify puts around it.
    JSON.stringify(secret).slice(1, -1),
    base64(bytes, BASE64_STANDARD),
    base64(bytes, BASE64_URL),
  ];
  return [...new Set(forms)].filter((form) => form.length > 0).sort((a, b) => b.length - a.length);
}

/**
 * Every byte sequence whose presence means the artifact discloses the value.
 *
 * The whole-value forms plus the base64 alignment cores. Detection is wider than redaction
 * on purpose: what may be REWRITTEN safely and what must be REFUSED are two different
 * questions, and the second one has no reason to be conservative.
 */
function secretByteForms(secret: string): readonly Uint8Array[] {
  const bytes = utf8Bytes(secret);
  const forms = new Set<string>(secretTextForms(secret));
  for (const core of base64Cores(bytes, BASE64_STANDARD)) forms.add(core);
  for (const core of base64Cores(bytes, BASE64_URL)) forms.add(core);
  return [...forms].map((form) => utf8Bytes(form));
}

/** Whether `haystack` contains `needle`, over bytes, with a first-byte skip. */
function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  const first = needle[0];
  if (first === undefined || needle.length > haystack.length) return false;
  const last = haystack.length - needle.length;
  for (let start = 0; start <= last; start += 1) {
    if (haystack[start] !== first) continue;
    let index = 1;
    while (index < needle.length && haystack[start + index] === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

/**
 * A value compiled once, so an artifact is not re-encoded for every scan.
 *
 * Built inside the closure that holds the credential, so the forms live exactly where the
 * value does and neither is a field of anything serializable.
 */
export interface CompiledSecret {
  readonly textForms: readonly string[];
  readonly byteForms: readonly Uint8Array[];
}

/**
 * Compile a value for redaction and detection.
 *
 * REFUSES a value shorter than {@link MIN_SCANNED_SECRET}: a credential this build cannot
 * scan for is a credential whose containment it cannot honour, and quietly returning a
 * scanner that never matches would fail open in the one guarantee that matters.
 */
export function compileSecret(secret: string): CompiledSecret {
  if (typeof secret !== 'string' || secret.length < MIN_SCANNED_SECRET) {
    throw new SecretTooShortError();
  }
  return { textForms: secretTextForms(secret), byteForms: secretByteForms(secret) };
}

export class SecretTooShortError extends Error {
  override readonly name = 'SecretTooShortError';
  constructor() {
    // No value, no length, no reference: the message is written into a log and an error
    // path, and an error message is one of the places this story forbids a credential from
    // reaching.
    super(`A credential shorter than ${MIN_SCANNED_SECRET} characters cannot be contained`);
  }
}

/** Replace every whole-value spelling of the secret in `text`. */
export function redactCompiled(text: string, secret: CompiledSecret): string {
  let out = text;
  for (const form of secret.textForms) {
    if (form.length === 0) continue;
    out = out.split(form).join(REDACTED_CREDENTIAL);
  }
  return out;
}

/** Whether these bytes disclose the secret in any form this build recognises. */
export function bytesDiscloseCompiled(bytes: Uint8Array, secret: CompiledSecret): boolean {
  for (const form of secret.byteForms) if (containsBytes(bytes, form)) return true;
  return false;
}
