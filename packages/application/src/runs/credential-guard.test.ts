import { describe, expect, it } from 'vitest';
import {
  bytesDiscloseCompiled,
  compileSecret,
  redactCompiled,
  utf8Bytes,
} from '@intellifin/domain';

import { NO_CREDENTIALS, guardedCredentials } from './credential-guard.js';
import { freezeArtifact } from './evidence-package.js';
import {
  PopulationAcquisitionError,
  type CredentialResolver,
  type EvidenceStore,
  type ResolvedCredential,
} from './execution-ports.js';

/** Two unmistakably synthetic values (NFR-13), long enough to be scannable. */
const FIRST = 'synthetic-first-token-never-store-me';
const SECOND = 'synthetic-second-token-never-store-me';

/** The same shape the infrastructure factory builds: methods, never a field. */
function credential(reference: string, token: string): ResolvedCredential {
  const secret = compileSecret(token);
  return {
    reference,
    authorize: (headers) => headers.set('authorization', `Bearer ${token}`),
    enter: (field) => field.set(token),
    redact: (text) => redactCompiled(text, secret),
    discloses: (bytes) => bytesDiscloseCompiled(bytes, secret),
  };
}

function manifest(entries: Record<string, string>): CredentialResolver {
  return {
    resolve: (reference) => {
      const token = entries[reference];
      if (token === undefined) return Promise.reject(new PopulationAcquisitionError('contract'));
      return Promise.resolve(credential(reference, token));
    },
  };
}

function memoryStore(): EvidenceStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    read: (key) => Promise.resolve(objects.get(key) ?? null),
    putIfAbsent: (key, bytes) => {
      if (!objects.has(key)) objects.set(key, bytes);
      return Promise.resolve();
    },
  };
}

const budget = (): number => 5_000;

/**
 * Base64, hand-written here rather than taken from the module under test.
 *
 * `packages/application` compiles with `lib: ["ES2024"]` and no host types at all — the
 * compiler-enforced half of AD-11 — so there is no `Buffer` and no `btoa`. Asking the
 * domain for its own encoding and then looking for it would be a contract compared with a
 * copy of itself; this is a second implementation, and the two have to agree.
 */
function base64(text: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = utf8Bytes(text);
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index]! << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    const width = Math.min(3, bytes.length - index) + 1;
    for (let piece = 0; piece < width; piece += 1) {
      out += alphabet[(chunk >> (18 - piece * 6)) & 0x3f]!;
    }
  }
  return out;
}

describe('the guard a stage carries', () => {
  it('holds every credential resolved through it, and none it was not asked for', async () => {
    const { credentials, guard } = guardedCredentials(
      manifest({ 'cred://one': FIRST, 'cred://two': SECOND }),
    );
    expect(guard.held).toBe(0);
    expect(guard.discloses(utf8Bytes(FIRST))).toBe(false);

    await credentials.resolve('cred://one', 1000);
    expect(guard.held).toBe(1);
    expect(guard.discloses(utf8Bytes(FIRST))).toBe(true);
    // The second one has not been presented, so the guard says nothing about it. A guard
    // that answered for credentials this stage never used would be scanning for values
    // nothing resolved — the opposite of just in time.
    expect(guard.discloses(utf8Bytes(SECOND))).toBe(false);

    await credentials.resolve('cred://two', 1000);
    expect(guard.discloses(utf8Bytes(SECOND))).toBe(true);
    expect(guard.redact(`a ${FIRST} b ${SECOND} c`)).not.toContain(FIRST);
    expect(guard.redact(`a ${FIRST} b ${SECOND} c`)).not.toContain(SECOND);
  });

  it('holds nothing when a resolution failed', async () => {
    const { credentials, guard } = guardedCredentials(manifest({ 'cred://one': FIRST }));
    await expect(credentials.resolve('cred://nobody', 1000)).rejects.toBeInstanceOf(
      PopulationAcquisitionError,
    );
    expect(guard.held).toBe(0);
  });

  it('NO_CREDENTIALS says nothing was scanned for, explicitly', () => {
    expect(NO_CREDENTIALS.held).toBe(0);
    expect(NO_CREDENTIALS.discloses(utf8Bytes(FIRST))).toBe(false);
    expect(NO_CREDENTIALS.redact(FIRST)).toBe(FIRST);
  });

  it('serializes to its references and never to a value', async () => {
    const { credentials, guard } = guardedCredentials(manifest({ 'cred://one': FIRST }));
    await credentials.resolve('cred://one', 1000);
    // The containment is by SHAPE: a guard holds resolved credentials, and a resolved
    // credential has no field holding its value, so there is nothing here for a checkpoint,
    // an audit payload, a queue job or a log field to pick up.
    expect(JSON.stringify(guard)).not.toContain(FIRST);
    expect(JSON.stringify({ guard })).not.toContain(FIRST);
  });
});

describe('the registration wall', () => {
  it('REFUSES an artifact that discloses a credential, and stores nothing', async () => {
    const { credentials, guard } = guardedCredentials(manifest({ 'cred://one': FIRST }));
    await credentials.resolve('cred://one', 1000);
    const store = memoryStore();
    // The path nobody predicted: the Target System echoed the header back at us. These
    // bytes are exactly what it served, and they may not be kept.
    const echoed = utf8Bytes(`{"you_sent":"Bearer ${FIRST}","rows":[]}`);
    await expect(
      freezeArtifact(store, { objectKey: 'k', registeredDigest: null, registeredSize: null }, echoed, budget, guard),
    ).rejects.toMatchObject({ code: 'credential' });
    // Nothing is stored — literally, not nearly. The scan runs BEFORE the upload, because
    // the object store is immutable by design and an artifact that reached it could not be
    // taken back out.
    expect([...store.objects.keys()]).toEqual([]);
  });

  it('refuses it base64-encoded too, which is how a capture would carry it', async () => {
    const { credentials, guard } = guardedCredentials(manifest({ 'cred://one': FIRST }));
    await credentials.resolve('cred://one', 1000);
    const store = memoryStore();
    const blob = utf8Bytes(`data:image/png;base64,${base64(`xx${FIRST}yy`)}`);
    await expect(
      freezeArtifact(store, { objectKey: 'k', registeredDigest: null, registeredSize: null }, blob, budget, guard),
    ).rejects.toMatchObject({ code: 'credential' });
    expect(store.objects.size).toBe(0);
  });

  it('registers an ordinary artifact unchanged, and never rewrites one', async () => {
    const { credentials, guard } = guardedCredentials(manifest({ 'cred://one': FIRST }));
    await credentials.resolve('cred://one', 1000);
    const store = memoryStore();
    const bytes = utf8Bytes('account_id,status\nAG-1001,Disabled\n');
    const frozen = await freezeArtifact(
      store,
      { objectKey: 'k', registeredDigest: null, registeredSize: null },
      bytes,
      budget,
      guard,
    );
    expect(frozen.size).toBe(bytes.length);
    // The wall REFUSES; it never redacts. Bytes a Target System served are Evidence, and
    // rewriting them to make them acceptable would falsify what a system answered.
    expect(store.objects.get('k')).toEqual(bytes);
  });

  it('is off only when a stage explicitly says it presented nothing', async () => {
    const store = memoryStore();
    const echoed = utf8Bytes(`Bearer ${FIRST}`);
    await expect(
      freezeArtifact(
        store,
        { objectKey: 'k', registeredDigest: null, registeredSize: null },
        echoed,
        budget,
        NO_CREDENTIALS,
      ),
    ).resolves.toMatchObject({ size: echoed.length });
    // Which is the honest answer for the population stage: it runs BEFORE the sign-in and
    // before any extraction, so at the moment its bytes are frozen the Run has resolved
    // nothing to scan for.
    expect(store.objects.size).toBe(1);
  });
});
