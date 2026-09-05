import { describe, expect, it } from 'vitest';
import { PopulationAcquisitionError, type ResolvedCredential } from '@intellifin/application';
import {
  registrationDigest,
  registrationDigestEnvelope,
  type ProcedureTargetSnapshot,
  type TargetSystemKind,
} from '@intellifin/domain';

import {
  HttpAdapterExtraction,
  serviceIndexEndpoints,
  targetOrigin,
  withinOrigin,
} from './adapter-extraction-http.js';

const TOKEN = 'SECRET-TOKEN-do-not-store-me';

function target(kind: TargetSystemKind, origin: string): ProcedureTargetSnapshot {
  const fields = {
    kind,
    allowedOrigins: [origin],
    applicationIdentity: '',
    credentialRef: 'cred://synthetic/read-only',
    permittedActions: ['list-records', 'read-attribute'] as const,
    attributeLabelPatterns: ['account_id'],
    secondaryKey: '',
  };
  return {
    registrationId: 'reg-1',
    displayName: 'AccessGate',
    digest: registrationDigest(fields),
    contract: registrationDigestEnvelope(fields),
  };
}

const credential: ResolvedCredential = {
  reference: 'cred://synthetic/read-only',
  authorize: (headers) => headers.set('authorization', `Bearer ${TOKEN}`),
};

/** `Response.url` is read-only, so a stub carries the URL the adapter compares. */
function respond(body: string, contentType: string, url: string, status = 200): Response {
  const response = new Response(body, { status, headers: { 'content-type': contentType } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

describe('targetOrigin', () => {
  it('reads the first frozen allowed origin', () => {
    expect(targetOrigin(target('api', 'https://synthetic.invalid/accessgate')).href).toBe(
      'https://synthetic.invalid/accessgate',
    );
  });

  it('refuses a link-local, unspecified, credential-bearing or non-http origin', () => {
    for (const origin of [
      'http://169.254.169.254/latest',
      'http://0.0.0.0/x',
      'https://user:pass@synthetic.invalid/x',
      'ftp://synthetic.invalid/x',
      'https://synthetic.invalid/x#fragment',
    ]) {
      expect(() => targetOrigin(target('api', origin))).toThrow(PopulationAcquisitionError);
    }
  });
});

describe('withinOrigin', () => {
  const origin = new URL('https://synthetic.invalid/accessgate');
  it('accepts the origin itself and a path underneath it', () => {
    expect(withinOrigin(origin, new URL('https://synthetic.invalid/accessgate'))).toBe(true);
    expect(withinOrigin(origin, new URL('https://synthetic.invalid/accessgate/accounts'))).toBe(true);
  });
  it('refuses a sibling that merely shares a prefix, and another host', () => {
    expect(withinOrigin(origin, new URL('https://synthetic.invalid/accessgate-other'))).toBe(false);
    expect(withinOrigin(origin, new URL('https://elsewhere.invalid/accessgate/accounts'))).toBe(false);
    expect(withinOrigin(origin, new URL('http://synthetic.invalid/accessgate/accounts'))).toBe(false);
  });
});

describe('serviceIndexEndpoints', () => {
  const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
  it('recognizes the closed read-only index shape', () => {
    expect(
      serviceIndexEndpoints(
        bytes({ service: 'AccessGate', synthetic: true, access: 'read-only', endpoints: ['/accessgate/accounts'] }),
        'application/json',
      ),
    ).toEqual(['/accessgate/accounts']);
  });

  it('does not mistake a collection response for an index', () => {
    expect(serviceIndexEndpoints(bytes({ accounts: [], complete: true }), 'application/json')).toBeNull();
    // An extra key means it is not the closed shape, so it is not followed.
    expect(
      serviceIndexEndpoints(
        bytes({ service: 'x', synthetic: true, access: 'read-only', endpoints: ['/a'], extra: 1 }),
        'application/json',
      ),
    ).toBeNull();
    expect(serviceIndexEndpoints(bytes({ service: 'x', synthetic: true, access: 'write', endpoints: ['/a'] }), 'application/json')).toBeNull();
    expect(serviceIndexEndpoints(bytes({ accounts: [] }), 'text/csv')).toBeNull();
  });
});

describe('HttpAdapterExtraction', () => {
  it('reads a versioned-file Target System as bytes, with no credential', async () => {
    const seen: RequestInit[] = [];
    const adapter = new HttpAdapterExtraction({
      fetch: (async (_url: URL, init: RequestInit) => {
        seen.push(init);
        return respond('entry,role,permission\n1,A,B\n', 'text/csv; charset=utf-8', 'https://synthetic.invalid/role-matrix.csv');
      }) as unknown as typeof globalThis.fetch,
    });
    const artifact = await adapter.acquireReference(
      target('versioned-file', 'https://synthetic.invalid/role-matrix.csv'),
      5000,
    );
    expect(new TextDecoder().decode(artifact.bytes)).toBe('entry,role,permission\n1,A,B\n');
    expect(artifact.mediaType).toBe('text/csv');
    expect(artifact.location).toBe('https://synthetic.invalid/role-matrix.csv');
    const headers = new Headers(seen[0]!.headers);
    expect(headers.get('authorization')).toBeNull();
    expect(seen[0]!.method).toBe('GET');
    expect(seen[0]!.redirect).toBe('error');
  });

  it('sends the credential on the wire, and returns nothing that carries it', async () => {
    let sent: string | null = null;
    const adapter = new HttpAdapterExtraction({
      fetch: (async (_url: URL, init: RequestInit) => {
        sent = new Headers(init.headers).get('authorization');
        return respond('{"accounts":[]}', 'application/json', 'https://synthetic.invalid/accessgate/accounts');
      }) as unknown as typeof globalThis.fetch,
    });
    const artifact = await adapter.extract(
      target('api', 'https://synthetic.invalid/accessgate/accounts'),
      credential,
      5000,
    );
    expect(sent).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(artifact)).not.toContain(TOKEN);
    expect(artifact.location).not.toContain(TOKEN);
  });

  it('follows one read-only service index hop, and only inside the frozen origin', async () => {
    const visited: string[] = [];
    const adapter = new HttpAdapterExtraction({
      fetch: (async (url: URL) => {
        visited.push(url.href);
        if (url.href === 'https://synthetic.invalid/accessgate') {
          return respond(
            JSON.stringify({ service: 'AccessGate', synthetic: true, access: 'read-only', endpoints: ['/accessgate/accounts'] }),
            'application/json',
            url.href,
          );
        }
        return respond('{"accounts":[]}', 'application/json', url.href);
      }) as unknown as typeof globalThis.fetch,
    });
    const artifact = await adapter.extract(target('api', 'https://synthetic.invalid/accessgate'), credential, 5000);
    expect(visited).toEqual([
      'https://synthetic.invalid/accessgate',
      'https://synthetic.invalid/accessgate/accounts',
    ]);
    expect(new TextDecoder().decode(artifact.bytes)).toBe('{"accounts":[]}');
  });

  it('refuses an index entry that leaves the frozen origin, and a second index hop', async () => {
    const outside = new HttpAdapterExtraction({
      fetch: (async (url: URL) =>
        respond(
          JSON.stringify({ service: 'x', synthetic: true, access: 'read-only', endpoints: ['https://elsewhere.invalid/steal'] }),
          'application/json',
          url.href,
        )) as unknown as typeof globalThis.fetch,
    });
    await expect(outside.extract(target('api', 'https://synthetic.invalid/accessgate'), credential, 5000)).rejects.toBeInstanceOf(
      PopulationAcquisitionError,
    );

    const looping = new HttpAdapterExtraction({
      fetch: (async (url: URL) =>
        respond(
          JSON.stringify({ service: 'x', synthetic: true, access: 'read-only', endpoints: ['/accessgate/accounts'] }),
          'application/json',
          url.href,
        )) as unknown as typeof globalThis.fetch,
    });
    await expect(looping.extract(target('api', 'https://synthetic.invalid/accessgate'), credential, 5000)).rejects.toBeInstanceOf(
      PopulationAcquisitionError,
    );
  });

  it('refuses a credential that answers about a different reference', async () => {
    const adapter = new HttpAdapterExtraction({
      fetch: (async () => respond('{"accounts":[]}', 'application/json', 'x')) as unknown as typeof globalThis.fetch,
    });
    await expect(
      adapter.extract(target('api', 'https://synthetic.invalid/accessgate/accounts'), { ...credential, reference: 'cred://other' }, 5000),
    ).rejects.toBeInstanceOf(PopulationAcquisitionError);
  });

  it('refuses a kind it is not for, a redirect, and a body over the cap', async () => {
    const adapter = new HttpAdapterExtraction({
      fetch: (async () => respond('{"accounts":[]}', 'application/json', 'https://synthetic.invalid/x')) as unknown as typeof globalThis.fetch,
      maxBytes: 8,
    });
    await expect(adapter.acquireReference(target('api', 'https://synthetic.invalid/x'), 5000)).rejects.toBeInstanceOf(
      PopulationAcquisitionError,
    );
    await expect(adapter.extract(target('versioned-file', 'https://synthetic.invalid/x'), credential, 5000)).rejects.toBeInstanceOf(
      PopulationAcquisitionError,
    );
    // Over the cap: the body is longer than eight bytes.
    await expect(
      adapter.extract(target('api', 'https://synthetic.invalid/x'), credential, 5000),
    ).rejects.toBeInstanceOf(PopulationAcquisitionError);

    const redirecting = new HttpAdapterExtraction({
      fetch: (async () => respond('', 'application/json', 'https://synthetic.invalid/x', 302)) as unknown as typeof globalThis.fetch,
    });
    await expect(
      redirecting.acquireReference(target('versioned-file', 'https://synthetic.invalid/x'), 5000),
    ).rejects.toBeInstanceOf(PopulationAcquisitionError);
  });

  it('maps an unreachable target to a transport failure, not a contract failure', async () => {
    const adapter = new HttpAdapterExtraction({
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof globalThis.fetch,
    });
    await expect(
      adapter.extract(target('api', 'https://synthetic.invalid/x'), credential, 5000),
    ).rejects.toMatchObject({ code: 'transport' });
  });
});
