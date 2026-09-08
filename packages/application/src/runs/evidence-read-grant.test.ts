import { describe, expect, it } from 'vitest';

import type { AuditEventRecord, JsonObject } from '@intellifin/domain';

import type { AuditEventWriter } from '../audit/ports.js';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import type { RoleRepository } from '../identity/ports.js';
import {
  EVIDENCE_READ_GRANT_MAX_TTL_MS,
  issueEvidenceReadGrant,
  parseEvidenceReadGrantRequest,
  requestEvidenceReadGrant,
  type EvidenceReadGrant,
  type EvidenceReadGrantCapability,
  type EvidenceReadGrantContext,
  type EvidenceReadGrantRepository,
  type RegisteredEvidenceForRead,
} from './evidence-read-grant.js';

const RUN_ID = '01990000-0000-7000-8000-00000000e401';
const EVIDENCE_ID = '01990000-0000-7000-8000-00000000e402';
const GRANT_ID = '01990000-0000-7000-8000-00000000e403';
const NOW = '2026-09-07T00:00:00.000Z';

function clock(now = NOW): Clock {
  return { now: () => new Date(now) };
}

function ids(next = GRANT_ID): UuidV7Generator {
  return { next: () => next };
}

function role(value: 'auditor' | 'audit-manager' | null = 'auditor'): RoleRepository {
  return { findRole: async () => value };
}

function registered(overrides: Partial<RegisteredEvidenceForRead> = {}): RegisteredEvidenceForRead {
  return {
    runId: RUN_ID,
    evidenceId: EVIDENCE_ID,
    state: 'REGISTERED',
    objectKey: `runs/${RUN_ID}/evidence/${EVIDENCE_ID}`,
    mediaType: 'application/vnd.intellifin.web-tree+json',
    digest: 'a'.repeat(64),
    size: 128,
    ...overrides,
  };
}

function grant(overrides: Partial<EvidenceReadGrant> = {}): EvidenceReadGrant {
  return {
    grantId: GRANT_ID,
    runId: RUN_ID,
    evidenceId: EVIDENCE_ID,
    locator: '$.nodes[0].value',
    actorId: 'human-1',
    sessionId: 'session-1',
    correlationId: 'correlation-1',
    requestedAt: NOW,
    expiresAt: new Date(Date.parse(NOW) + EVIDENCE_READ_GRANT_MAX_TTL_MS).toISOString(),
    status: 'pending',
    denialCode: null,
    capability: null,
    ...overrides,
  };
}

function repository(options: {
  readonly grant?: EvidenceReadGrant | null;
  readonly evidence?: RegisteredEvidenceForRead | null;
  readonly role?: RoleRepository;
} = {}): {
  readonly repository: EvidenceReadGrantRepository;
  readonly current: () => EvidenceReadGrant | null;
  readonly evidence: () => RegisteredEvidenceForRead | null;
  readonly events: JsonObject[];
  readonly signerKeys: string[];
} {
  let current = options.grant === undefined ? grant() : options.grant;
  let evidence = options.evidence === undefined ? registered() : options.evidence;
  const events: JsonObject[] = [];
  const signerKeys: string[] = [];
  const auditEvents: AuditEventWriter = {
    append: async (event) => {
      events.push(event.payload);
      return event as unknown as AuditEventRecord;
    },
  };
  const repository: EvidenceReadGrantRepository = {
    request: async () => {},
    transaction: async (_grantId, work) => {
      const context: EvidenceReadGrantContext = {
        get grant() { return current; },
        authorizationRoles: options.role ?? role(),
        auditEvents,
        readRegisteredEvidence: async () => evidence,
        issue: async (capability: EvidenceReadGrantCapability) => {
          if (current === null || current.status !== 'pending') return false;
          current = { ...current, status: 'issued', capability };
          return true;
        },
        deny: async (code) => {
          if (current === null || current.status !== 'pending') return { changed: false, code };
          current = { ...current, status: 'denied', denialCode: code };
          return { changed: true, code };
        },
      };
      return work(context);
    },
    readForActor: async () => null,
    recordAccess: async () => false,
  };
  // The signer is kept separate from the application worker in production. The fake's
  // key capture proves that only the internal object key, never the URL, reaches it.
  void signerKeys;
  return { repository, current: () => current, evidence: () => evidence, events, signerKeys };
}

describe('Evidence read grant contract', () => {
  it('accepts only the exact bounded request and gives it a five minute lifetime', async () => {
    expect(parseEvidenceReadGrantRequest({ runId: RUN_ID, evidenceId: EVIDENCE_ID, locator: '$.nodes[0].value' })).toEqual({
      runId: RUN_ID,
      evidenceId: EVIDENCE_ID,
      locator: '$.nodes[0].value',
    });
    expect(parseEvidenceReadGrantRequest({ runId: RUN_ID, evidenceId: EVIDENCE_ID, locator: '$.nodes[0].value', extra: 'forged' })).toEqual({ error: 'malformed' });

    const stored: { input?: Parameters<EvidenceReadGrantRepository['request']>[0] } = {};
    const fake = repository();
    const repositoryWithRequest: EvidenceReadGrantRepository = {
      ...fake.repository,
      request: async (input) => { stored.input = input; },
    };
    const result = await requestEvidenceReadGrant(
      { repository: repositoryWithRequest, ids: ids(), clock: clock() },
      {
        session: { userId: 'human-1', sessionId: 'session-1' },
        correlationId: 'correlation-1',
        request: { runId: RUN_ID, evidenceId: EVIDENCE_ID, locator: '$.nodes[0].value' },
      },
    );
    expect(result).toEqual({ ok: true, grantId: GRANT_ID, expiresAt: '2026-09-07T00:05:00.000Z' });
    expect(stored.input?.actorId).toBe('human-1');
    expect(stored.input?.locator).toBe('$.nodes[0].value');
    expect(Date.parse(stored.input?.expiresAt ?? '') - Date.parse(stored.input?.requestedAt ?? '')).toBe(EVIDENCE_READ_GRANT_MAX_TTL_MS);
  });

  it('rechecks role and registered binding, then audits only grant/run/evidence ids', async () => {
    const fake = repository();
    const result = await issueEvidenceReadGrant(
      {
        repository: fake.repository,
        clock: clock(),
        signer: {
          signGet: async ({ bucketKey, expiresAt }) => {
            fake.signerKeys.push(bucketKey);
            return { signedUrl: 'https://objects.invalid/read?signature=secret', signedUrlExpiresAt: expiresAt };
          },
        },
      },
      { schemaVersion: 1, grantId: GRANT_ID },
    );
    expect(result).toEqual({ status: 'issued', grantId: GRANT_ID });
    expect(fake.signerKeys).toEqual([`runs/${RUN_ID}/evidence/${EVIDENCE_ID}`]);
    expect(fake.events).toEqual([{ grantId: GRANT_ID, runId: RUN_ID, evidenceId: EVIDENCE_ID }]);
    expect(JSON.stringify(fake.events)).not.toContain('signature=secret');
  });

  it.each([
    { name: 'revoked role', options: { role: role(null) }, code: 'unauthorized' as const },
    { name: 'wrong run binding', options: { evidence: registered({ runId: '01990000-0000-7000-8000-00000000e499' }) }, code: 'scope-mismatch' as const },
    { name: 'reserved evidence', options: { evidence: registered({ state: 'RESERVED' }) }, code: 'evidence-not-registered' as const },
    { name: 'oversized evidence', options: { evidence: registered({ size: 4 * 1024 * 1024 + 1 }) }, code: 'invalid-evidence-metadata' as const },
  ])('denies $name without calling a signer', async ({ options, code }) => {
    const fake = repository(options);
    let signed = false;
    const result = await issueEvidenceReadGrant(
      { repository: fake.repository, clock: clock(), signer: { signGet: async () => { signed = true; return { signedUrl: 'https://objects.invalid', signedUrlExpiresAt: '2026-09-07T00:01:00.000Z' }; } } },
      { schemaVersion: 1, grantId: GRANT_ID },
    );
    expect(result).toEqual({ status: 'denied', grantId: GRANT_ID, code });
    expect(signed).toBe(false);
    expect(fake.current()?.denialCode).toBe(code);
    expect(fake.events).toEqual([{ grantId: GRANT_ID, runId: RUN_ID, evidenceId: EVIDENCE_ID, code }]);
  });

  it('rejects malformed or forged worker jobs before opening a grant transaction', async () => {
    const fake = repository();
    const transaction = fake.repository.transaction;
    let opened = false;
    const repositoryWithProbe: EvidenceReadGrantRepository = {
      ...fake.repository,
      transaction: async (...args) => { opened = true; return transaction(...args); },
    };
    expect(await issueEvidenceReadGrant({ repository: repositoryWithProbe, clock: clock(), signer: { signGet: async () => { throw new Error('not called'); } } }, null)).toEqual({ status: 'missing' });
    expect(await issueEvidenceReadGrant({ repository: repositoryWithProbe, clock: clock(), signer: { signGet: async () => { throw new Error('not called'); } } }, { schemaVersion: 1, grantId: GRANT_ID, extra: true })).toEqual({ status: 'missing' });
    expect(opened).toBe(false);
  });

  it('refuses a non-http capability scheme from the signer', async () => {
    const fake = repository();
    await expect(issueEvidenceReadGrant(
      {
        repository: fake.repository,
        clock: clock(),
        signer: {
          signGet: async () => ({
            signedUrl: 'file://objects.invalid/read',
            signedUrlExpiresAt: '2026-09-07T00:01:00.000Z',
          }),
        },
      },
      { schemaVersion: 1, grantId: GRANT_ID },
    )).rejects.toThrow('invalid capability');
    expect(fake.current()?.status).toBe('pending');
    expect(fake.events).toEqual([]);
  });

  it('consumes the queue and denies explicitly when object storage is unavailable', async () => {
    const fake = repository();
    await expect(issueEvidenceReadGrant(
      { repository: fake.repository, clock: clock(), signer: null },
      { schemaVersion: 1, grantId: GRANT_ID },
    )).resolves.toEqual({ status: 'denied', grantId: GRANT_ID, code: 'storage-unavailable' });
    expect(fake.current()?.denialCode).toBe('storage-unavailable');
    expect(fake.events).toEqual([{ grantId: GRANT_ID, runId: RUN_ID, evidenceId: EVIDENCE_ID, code: 'storage-unavailable' }]);
  });
});
