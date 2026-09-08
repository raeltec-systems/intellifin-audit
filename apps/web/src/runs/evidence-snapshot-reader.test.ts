import { describe, expect, it } from 'vitest';

import { sha256HexOfBytes, utf8Bytes } from '@intellifin/domain';

import { readSnapshotCellWithGrant } from './evidence-snapshot-reader';
import type { EvidenceReadGrantCapability, EvidenceReadGrantRepository } from '@intellifin/application';

const RUN_ID = '01990000-0000-7000-8000-00000000e411';
const EVIDENCE_ID = '01990000-0000-7000-8000-00000000e412';
const GRANT_ID = '01990000-0000-7000-8000-00000000e413';
const ACTOR_ID = 'human-1';
const LOCATOR = '$.nodes[0].value';
const NOW = new Date('2026-09-07T00:00:00.000Z');

const BYTES = utf8Bytes(JSON.stringify({
  schemaVersion: 1,
  nodes: [{ group: 'record:0', role: 'datum', label: 'Employee ID', value: 'E-411', target: null }],
}));

function capability(overrides: Partial<EvidenceReadGrantCapability> = {}): EvidenceReadGrantCapability {
  return {
    grantId: GRANT_ID,
    runId: RUN_ID,
    evidenceId: EVIDENCE_ID,
    actorId: ACTOR_ID,
    locator: LOCATOR,
    signedUrl: 'https://objects.invalid/read?signature=opaque',
    signedUrlExpiresAt: '2026-09-07T00:05:00.000Z',
    mediaType: 'application/vnd.intellifin.web-tree+json',
    digest: sha256HexOfBytes(BYTES),
    size: BYTES.byteLength,
    ...overrides,
  };
}

function repository(value: EvidenceReadGrantCapability | null, accessed: boolean = true): {
  readonly repository: Pick<EvidenceReadGrantRepository, 'readForActor' | 'recordAccess'>;
  readonly access: string[];
} {
  const access: string[] = [];
  return {
    repository: {
      readForActor: async () => value,
      recordAccess: async ({ grantId }) => {
        access.push(grantId);
        return accessed;
      },
    },
    access,
  };
}

function environment(response: Response, options: { seen?: RequestInit } = {}) {
  return {
    now: () => NOW,
    fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
      options.seen = init;
      return response;
    },
  };
}

function responseWithBytes(init?: ResponseInit): Response {
  return new Response(BYTES.buffer as ArrayBuffer, init);
}

const input = {
  grantId: GRANT_ID,
  runId: RUN_ID,
  evidenceId: EVIDENCE_ID,
  actorId: ACTOR_ID,
  locator: LOCATOR,
  correlationId: 'correlation-1',
  maxGrantWaitMs: 0,
};

describe('server-side Evidence snapshot consumption', () => {
  it('uses an exact no-redirect fetch, verifies bytes, records access, and returns only a domain cell', async () => {
    const fake = repository(capability());
    const seen: { seen?: RequestInit } = {};
    const result = await readSnapshotCellWithGrant(
      fake.repository,
      input,
      environment(responseWithBytes({
        status: 200,
        headers: {
          'content-length': String(BYTES.byteLength),
          'content-type': 'application/vnd.intellifin.web-tree+json',
        },
      }), seen),
    );
    expect(result).toEqual({ cell: { value: 'E-411', label: 'Employee ID' }, failure: null });
    expect(fake.access).toEqual([GRANT_ID]);
    expect(seen.seen?.redirect).toBe('error');
    expect(JSON.stringify(result)).not.toContain('objects.invalid');
  });

  it.each([
    { name: 'wrong digest', capability: capability({ digest: 'b'.repeat(64) }), failure: 'download-digest-mismatch' as const },
    { name: 'wrong size', capability: capability({ size: BYTES.byteLength + 1 }), failure: 'download-size-mismatch' as const },
    { name: 'wrong actor binding', capability: capability({ actorId: 'other-human' }), failure: 'capability-mismatch' as const },
  ])('fails closed for $name without recording a successful access', async ({ capability: current, failure }) => {
    const fake = repository(current);
    const result = await readSnapshotCellWithGrant(
      fake.repository,
      input,
      environment(responseWithBytes({ status: 200, headers: { 'content-length': String(BYTES.byteLength) } })),
    );
    expect(result).toEqual({ cell: null, failure });
    expect(fake.access).toEqual([]);
  });

  it('routes a verified byte mismatch to the canonical integrity outcome seam with digests only', async () => {
    const fake = repository(capability({ digest: 'b'.repeat(64) }));
    const mismatches: unknown[] = [];
    const result = await readSnapshotCellWithGrant(
      fake.repository,
      input,
      {
        ...environment(responseWithBytes({
          status: 200,
          headers: { 'content-length': String(BYTES.byteLength) },
        })),
        reportIntegrityMismatch: async (mismatch) => { mismatches.push(mismatch); },
      },
    );
    expect(result).toEqual({ cell: null, failure: 'download-digest-mismatch' });
    expect(mismatches).toEqual([{
      runId: RUN_ID,
      evidenceId: EVIDENCE_ID,
      finding: 'digest-mismatch',
      expectedDigest: 'b'.repeat(64),
      observedDigest: sha256HexOfBytes(BYTES),
      expectedSize: BYTES.byteLength,
      observedSize: BYTES.byteLength,
    }]);
    expect(JSON.stringify(mismatches)).not.toContain('Employee ID');
    expect(fake.access).toEqual([]);
  });

  it('routes a confirmed object-store 404 to the canonical missing-object finding', async () => {
    const fake = repository(capability());
    const mismatches: unknown[] = [];
    const result = await readSnapshotCellWithGrant(
      fake.repository,
      input,
      {
        ...environment(new Response(null, { status: 404 })),
        reportIntegrityMismatch: async (mismatch) => { mismatches.push(mismatch); },
      },
    );
    expect(result).toEqual({ cell: null, failure: 'download-object-missing' });
    expect(mismatches).toEqual([{
      runId: RUN_ID,
      evidenceId: EVIDENCE_ID,
      finding: 'object-missing',
      expectedDigest: capability().digest,
      observedDigest: null,
      expectedSize: BYTES.byteLength,
      observedSize: null,
    }]);
    expect(fake.access).toEqual([]);
  });

  it('does not turn a transient storage 5xx into an integrity finding', async () => {
    const fake = repository(capability());
    const mismatches: unknown[] = [];
    const result = await readSnapshotCellWithGrant(
      fake.repository,
      input,
      {
        ...environment(new Response(null, { status: 503 })),
        reportIntegrityMismatch: async (mismatch) => { mismatches.push(mismatch); },
      },
    );
    expect(result).toEqual({ cell: null, failure: 'download-failed' });
    expect(mismatches).toEqual([]);
    expect(fake.access).toEqual([]);
  });

  it('rejects a response whose final URL differs, even when the body is valid', async () => {
    const fake = repository(capability());
    const response = responseWithBytes({ status: 200, headers: { 'content-length': String(BYTES.byteLength) } });
    Object.defineProperty(response, 'url', { value: 'https://objects.invalid/other', configurable: true });
    const result = await readSnapshotCellWithGrant(fake.repository, input, environment(response));
    expect(result).toEqual({ cell: null, failure: 'download-redirected' });
    expect(fake.access).toEqual([]);
  });

  it('does not render a cell when the access audit cannot be committed', async () => {
    const fake = repository(capability(), false);
    const result = await readSnapshotCellWithGrant(
      fake.repository,
      input,
      environment(responseWithBytes({ status: 200, headers: { 'content-length': String(BYTES.byteLength) } })),
    );
    expect(result).toEqual({ cell: null, failure: 'access-denied' });
  });
});
