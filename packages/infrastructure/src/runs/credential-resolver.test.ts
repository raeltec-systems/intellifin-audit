import { describe, expect, it } from 'vitest';
import { PopulationAcquisitionError } from '@intellifin/application';
import {
  MIN_SCANNED_SECRET,
  REDACTED_CREDENTIAL,
  SecretTooShortError,
  utf8Bytes,
} from '@intellifin/domain';

import {
  ManifestCredentialResolver,
  parseCredentialTokens,
  resolvedCredential,
} from './credential-resolver.js';

/** Long enough to be scannable, and unmistakably synthetic (NFR-13). */
const SECRET = 'SECRET-VALUE-do-not-store-me';

describe('parseCredentialTokens', () => {
  it('reads a reference-to-token object', () => {
    expect([...parseCredentialTokens('{"cred://a":"token-a","cred://b":"token-b"}')!.entries()]).toEqual([
      ['cred://a', 'token-a'],
      ['cred://b', 'token-b'],
    ]);
  });

  it('is an empty manifest when nothing is declared', () => {
    expect(parseCredentialTokens('{}')?.size).toBe(0);
  });

  it('refuses the WHOLE manifest when two keys trim to the same reference', () => {
    // `{"prod":"real"," prod":"other"}` used to be last-one-wins, and registration input
    // is trimmed too, so a later entry silently replaced a credential nobody chose.
    // A deployment whose manifest is ambiguous has declared nothing.
    expect(parseCredentialTokens('{"cred://a":"one"," cred://a":"two"}')).toBeNull();
  });

  it('refuses anything that is not a flat object of non-empty strings', () => {
    expect(parseCredentialTokens('[]')).toBeNull();
    expect(parseCredentialTokens('null')).toBeNull();
    expect(parseCredentialTokens('not json')).toBeNull();
    expect(parseCredentialTokens('{"cred://a":1}')).toBeNull();
    expect(parseCredentialTokens('{"cred://a":""}')).toBeNull();
    expect(parseCredentialTokens('{"":"token"}')).toBeNull();
    expect(parseCredentialTokens(`{"cred://a":"${'x'.repeat(4097)}"}`)).toBeNull();
  });
});

describe('resolvedCredential', () => {
  it('has no field holding the token, so nothing can serialize it', () => {
    const credential = resolvedCredential('cred://a', SECRET);
    expect(JSON.stringify(credential)).toBe('{"reference":"cred://a"}');
    // Story 4.3 added `redact` and `discloses`. Both are METHODS, like `authorize`: the
    // value lives in the closure and there is still no field for a checkpoint, an audit
    // payload, a log line or an error message to pick it up from.
    expect(Object.keys(credential)).toEqual(['reference', 'authorize', 'redact', 'discloses']);
    expect(Object.values(credential).some((value) => String(value).includes(SECRET))).toBe(false);
  });

  it('puts the token on the wire when asked, and only then', () => {
    const headers = new Map<string, string>();
    resolvedCredential('cred://a', SECRET).authorize({ set: (name, value) => headers.set(name, value) });
    expect(headers.get('authorization')).toBe(`Bearer ${SECRET}`);
    expect(headers.size).toBe(1);
  });

  it('removes the value from text without ever returning it', () => {
    const credential = resolvedCredential('cred://a', SECRET);
    const redacted = credential.redact(`before ${SECRET} after`);
    expect(redacted).toBe(`before ${REDACTED_CREDENTIAL} after`);
    expect(redacted).not.toContain(SECRET);
    // Text with nothing to remove comes back unchanged, so a redaction cannot be mistaken
    // for evidence that something was there.
    expect(credential.redact('nothing to see')).toBe('nothing to see');
  });

  it('answers whether bytes disclose the value, in the encodings a capture produces', () => {
    const credential = resolvedCredential('cred://a', SECRET);
    const bytes = (text: string): Uint8Array => utf8Bytes(text);
    expect(credential.discloses(bytes(`{"echo":"Bearer ${SECRET}"}`))).toBe(true);
    // Base64, at every byte alignment: the value inside a `data:` URL, an
    // `Authorization: Basic` header or a serialized HAR is the path nobody predicts.
    for (const prefix of ['', 'a', 'bc']) {
      const blob = Buffer.from(`${prefix}${SECRET}tail`, 'utf8').toString('base64');
      expect(credential.discloses(bytes(blob))).toBe(true);
    }
    // And a near miss is not a disclosure: one character short is a different value.
    expect(credential.discloses(bytes(SECRET.slice(0, -1)))).toBe(false);
    expect(credential.discloses(bytes('an ordinary artifact'))).toBe(false);
  });

  it('refuses a token it could not scan an artifact for', () => {
    // A four-character "secret" matches ordinary text, so scanning for it would refuse
    // almost every artifact — and lowering the bar to avoid that would fail OPEN in the
    // one guarantee this exists to give. A credential this build cannot contain is a
    // credential it never presents.
    expect(() => resolvedCredential('cred://a', 'short')).toThrow(SecretTooShortError);
    expect(() => resolvedCredential('cred://a', 'x'.repeat(MIN_SCANNED_SECRET))).not.toThrow();
  });
});

describe('ManifestCredentialResolver', () => {
  const resolver = new ManifestCredentialResolver(new Map([['cred://a', SECRET]]));

  it('echoes the reference it was ASKED about', async () => {
    // A service that batched, cached by a normalized key or resolved an alias could
    // otherwise answer about a different credential, which proves nothing about this one.
    await expect(resolver.resolve('cred://a', 1000)).resolves.toMatchObject({ reference: 'cred://a' });
  });

  it('resolves nothing for an undeclared reference', async () => {
    await expect(resolver.resolve('cred://nobody-vouched-for-this', 1000)).rejects.toBeInstanceOf(
      PopulationAcquisitionError,
    );
    await expect(new ManifestCredentialResolver(new Map()).resolve('cred://a', 1000)).rejects.toBeInstanceOf(
      PopulationAcquisitionError,
    );
  });

  it('never names the reference or the manifest in its refusal', async () => {
    const error: unknown = await resolver.resolve('cred://a-typo', 1000).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('cred://a-typo');
    expect((error as Error).message).not.toContain(SECRET);
  });

  it('refuses an untrimmed reference and an impossible deadline', async () => {
    await expect(resolver.resolve(' cred://a', 1000)).rejects.toBeInstanceOf(PopulationAcquisitionError);
    await expect(resolver.resolve('cred://a', 0)).rejects.toBeInstanceOf(PopulationAcquisitionError);
    await expect(resolver.resolve('cred://a', Number.NaN)).rejects.toBeInstanceOf(PopulationAcquisitionError);
  });
});
