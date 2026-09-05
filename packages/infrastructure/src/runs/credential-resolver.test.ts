import { describe, expect, it } from 'vitest';
import { PopulationAcquisitionError } from '@intellifin/application';

import {
  ManifestCredentialResolver,
  parseCredentialTokens,
  resolvedCredential,
} from './credential-resolver.js';

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
    const credential = resolvedCredential('cred://a', 'SECRET-VALUE');
    expect(JSON.stringify(credential)).toBe('{"reference":"cred://a"}');
    expect(Object.keys(credential)).toEqual(['reference', 'authorize']);
    expect(Object.values(credential).some((value) => String(value).includes('SECRET-VALUE'))).toBe(false);
  });

  it('puts the token on the wire when asked, and only then', () => {
    const headers = new Map<string, string>();
    resolvedCredential('cred://a', 'SECRET-VALUE').authorize({ set: (name, value) => headers.set(name, value) });
    expect(headers.get('authorization')).toBe('Bearer SECRET-VALUE');
    expect(headers.size).toBe(1);
  });
});

describe('ManifestCredentialResolver', () => {
  const resolver = new ManifestCredentialResolver(new Map([['cred://a', 'SECRET-VALUE']]));

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
    expect((error as Error).message).not.toContain('SECRET-VALUE');
  });

  it('refuses an untrimmed reference and an impossible deadline', async () => {
    await expect(resolver.resolve(' cred://a', 1000)).rejects.toBeInstanceOf(PopulationAcquisitionError);
    await expect(resolver.resolve('cred://a', 0)).rejects.toBeInstanceOf(PopulationAcquisitionError);
    await expect(resolver.resolve('cred://a', Number.NaN)).rejects.toBeInstanceOf(PopulationAcquisitionError);
  });
});
