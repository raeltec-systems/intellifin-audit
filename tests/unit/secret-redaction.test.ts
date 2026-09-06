import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MIN_SCANNED_SECRET,
  REDACTED_CREDENTIAL,
  SecretTooShortError,
  bytesDiscloseCompiled,
  compileSecret,
  redactCompiled,
  secretTextForms,
  utf8Bytes,
} from '@intellifin/domain';

/**
 * Finding a credential in something the platform is about to keep forever (Story 4.3).
 *
 * The whole point of this module is the case nobody predicted, so the vectors below are
 * built by ENCODING the value with a different implementation from the one under test —
 * Node's own `Buffer`, `encodeURIComponent`, `JSON.stringify` and a hand-written HTML
 * escape — rather than by asking the module for its own forms and then looking for them.
 * A test that seeds the value where the implementation already looks is a contract
 * compared with a copy of itself.
 */

/** Unmistakably synthetic (NFR-13), and long enough to be scannable. */
const SECRET = 'synthetic-token-4f21-never-store-me';
const compiled = compileSecret(SECRET);
const bytes = (text: string): Uint8Array => utf8Bytes(text);

describe('what counts as a disclosure', () => {
  it('finds the raw value anywhere in the bytes', () => {
    expect(bytesDiscloseCompiled(bytes(SECRET), compiled)).toBe(true);
    expect(bytesDiscloseCompiled(bytes(`Authorization: Bearer ${SECRET}\r\n`), compiled)).toBe(true);
    expect(bytesDiscloseCompiled(bytes(`...${SECRET}`), compiled)).toBe(true);
    expect(bytesDiscloseCompiled(bytes(`${SECRET}...`), compiled)).toBe(true);
  });

  it('finds it inside binary that is not valid UTF-8 at all', () => {
    // A screenshot is not text. `decodePopulationUtf8` throws on the first malformed byte
    // sequence, which is why the scan is over BYTES and not over a decoded document — and
    // a token in PNG metadata is exactly the path nobody lists.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, ...bytes(SECRET), 0xc0, 0x80]);
    expect(bytesDiscloseCompiled(png, compiled)).toBe(true);
  });

  it('finds it percent-encoded, HTML-escaped and JSON-escaped', () => {
    const awkward = 'synthetic/token+4f21="never"&store<me>';
    const secret = compileSecret(awkward);
    expect(bytesDiscloseCompiled(bytes(`?t=${encodeURIComponent(awkward)}`), secret)).toBe(true);
    expect(bytesDiscloseCompiled(bytes(JSON.stringify({ echoed: awkward })), secret)).toBe(true);
    const html = awkward
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    expect(bytesDiscloseCompiled(bytes(`<p>${html}</p>`), secret)).toBe(true);
  });

  it('finds it base64-encoded at every byte alignment', () => {
    // Node's `Buffer`, not this module's own encoder: a value inside a `data:` URL, an
    // `Authorization: Basic` header or a serialized HAR begins at whatever offset the
    // bytes around it put it at, and only one of the three alignments is the easy one.
    for (const prefix of ['', 'a', 'bc', 'def', 'ghij']) {
      for (const suffix of ['', 'z', 'yz']) {
        const blob = Buffer.from(`${prefix}${SECRET}${suffix}`, 'utf8').toString('base64');
        expect(bytesDiscloseCompiled(bytes(blob), compiled)).toBe(true);
        const url = Buffer.from(`${prefix}${SECRET}${suffix}`, 'utf8').toString('base64url');
        expect(bytesDiscloseCompiled(bytes(url), compiled)).toBe(true);
      }
    }
  });

  it('does not fire on an artifact that merely looks like one', () => {
    // The negative half. Without it "refuses an artifact that discloses the credential"
    // is satisfied by a scanner that refuses everything, which would fail every Run.
    expect(bytesDiscloseCompiled(bytes(''), compiled)).toBe(false);
    expect(bytesDiscloseCompiled(bytes('account_id,status\nAG-1001,Disabled\n'), compiled)).toBe(false);
    expect(bytesDiscloseCompiled(bytes(SECRET.slice(1)), compiled)).toBe(false);
    expect(bytesDiscloseCompiled(bytes(SECRET.slice(0, -1)), compiled)).toBe(false);
    expect(bytesDiscloseCompiled(bytes(SECRET.toUpperCase()), compiled)).toBe(false);
    // Its SHA-256 is not the value: a digest of a credential is not a credential, and a
    // scanner that flagged one would refuse the Evidence integrity record of an artifact
    // that never held it.
    expect(bytesDiscloseCompiled(bytes(createHash('sha256').update(SECRET).digest('hex')), compiled)).toBe(false);
  });

  it('is not fooled by a value split across the whole artifact', () => {
    // Named rather than claimed away: this is a case the scan does NOT catch, and saying
    // so here is what stops a later reader believing detection is a proof of absence.
    const halves = `${SECRET.slice(0, 10)}\n<!-- -->\n${SECRET.slice(10)}`;
    expect(bytesDiscloseCompiled(bytes(halves), compiled)).toBe(false);
  });
});

describe('what redaction removes', () => {
  it('replaces every whole-value spelling, and says so in words', () => {
    const awkward = 'synthetic/token+4f21="never"&store<me>';
    const secret = compileSecret(awkward);
    const artifact = [
      `raw: ${awkward}`,
      `url: ?t=${encodeURIComponent(awkward)}`,
      `json: ${JSON.stringify(awkward)}`,
      `b64: ${Buffer.from(awkward, 'utf8').toString('base64')}`,
    ].join('\n');
    const redacted = redactCompiled(artifact, secret);
    expect(redacted).not.toContain(awkward);
    expect(redacted).not.toContain(encodeURIComponent(awkward));
    expect(redacted).not.toContain(Buffer.from(awkward, 'utf8').toString('base64'));
    // Written out in words rather than blanked. A gap is what a later reader takes for
    // "nothing was here", which is the defect class this codebase keeps finding.
    expect(redacted.split(REDACTED_CREDENTIAL)).toHaveLength(5);
    // And it carries no length information: a run of stars the length of the value tells
    // an attacker how long the value is.
    expect(REDACTED_CREDENTIAL).not.toContain('*');
  });

  it('leaves text that does not hold the value exactly as it was', () => {
    const artifact = 'http://localhost:4300/loancore/accounts/E-000105';
    expect(redactCompiled(artifact, compiled)).toBe(artifact);
  });

  it('leaves a redacted artifact undisclosed, which is the layering', () => {
    // Redaction is the producer's courtesy and the registration refusal is the wall. This
    // is the only place the two meet: what redaction removed, detection must not find.
    const redacted = redactCompiled(`before ${SECRET} after`, compiled);
    expect(bytesDiscloseCompiled(bytes(redacted), compiled)).toBe(false);
  });
});

describe('a value this build cannot contain is refused', () => {
  it('throws below the floor and accepts at it', () => {
    expect(() => compileSecret('x'.repeat(MIN_SCANNED_SECRET - 1))).toThrow(SecretTooShortError);
    expect(() => compileSecret('x'.repeat(MIN_SCANNED_SECRET))).not.toThrow();
    expect(() => compileSecret('')).toThrow(SecretTooShortError);
  });

  it('says nothing about the value it refused', () => {
    // The constructor takes NO argument, so there is nothing for the message to leak: an
    // error message is one of the places this story forbids a credential from reaching,
    // and the shape is what guarantees it rather than the wording.
    const thrown = ((): Error => {
      try {
        compileSecret('tiny-secret');
        throw new Error('compileSecret accepted a value it cannot scan for');
      } catch (error) {
        return error as Error;
      }
    })();
    expect(thrown).toBeInstanceOf(SecretTooShortError);
    expect(thrown.message).not.toContain('tiny-secret');
    expect(thrown.message).not.toContain('11');
    expect(thrown.message).toContain(String(MIN_SCANNED_SECRET));
    expect(SecretTooShortError.length).toBe(0);
  });
});

describe('the forms themselves', () => {
  it('are deduplicated and ordered longest first', () => {
    // A token spelled only in unreserved characters percent-, HTML- and JSON-encodes to
    // itself, so the list collapses to the raw value plus its two base64 spellings.
    const forms = secretTextForms('abcdefghijkl');
    expect(new Set(forms).size).toBe(forms.length);
    expect([...forms]).toEqual([...forms].sort((a, b) => b.length - a.length));
    expect(forms).toContain('abcdefghijkl');
    expect(forms).toContain(Buffer.from('abcdefghijkl', 'utf8').toString('base64'));
  });
});
