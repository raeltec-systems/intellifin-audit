import { describe, expect, it } from 'vitest';
import {
  sha256HexOfBytes,
  utf8Bytes,
  verifyStoredArtifact,
  type AuditEventRecord,
  type AuditEventDraft,
  type EvidenceVerification,
  type RunRecord,
} from '@intellifin/domain';

import type {
  EvidenceIntegrityRecord,
  PackageSeal,
  SealedPackageContext,
} from './execution-ports.js';
import { recordSealedIntegrityFindings } from './seal-package.js';

const RUN: RunRecord = {
  runId: '01990000-0000-7000-8000-00000000e451',
  correlationId: '01990000-0000-7000-8000-00000000e452',
  procedureId: '01990000-0000-7000-8000-00000000e453',
  versionId: '01990000-0000-7000-8000-00000000e454',
  versionNumber: 1,
  procedureName: 'Integrity recording',
  period: { from: '2026-08-01', to: '2026-08-31' },
  state: 'INCONCLUSIVE',
  kind: 'STANDARD',
  initiatorId: 'auditor',
  sessionId: 'integrity-test',
  initiatedAt: '2026-09-01T00:00:00.000Z',
  authorizationRole: 'auditor',
  predecessorRunId: null,
  rerunReason: null,
  cancellation: null,
  requestToken: '01990000-0000-7000-8000-00000000e455',
};

const SEAL: PackageSeal = {
  runId: RUN.runId,
  state: 'SEALED',
  runState: 'INCONCLUSIVE',
  sealedAt: '2026-09-05T00:00:00.000Z',
  requiredTotal: 1,
  registered: 1,
  missingRequired: [],
  abandoned: [],
};

class FakeSealedContext implements SealedPackageContext {
  readonly run: RunRecord = RUN;
  readonly seal: PackageSeal = SEAL;
  readonly findings: EvidenceIntegrityRecord[] = [];
  readonly events: Array<AuditEventDraft & { readonly sequence: number }> = [];
  readonly timeline: number[] = [];
  private sequence = 0;

  readonly auditEvents = {
    append: async (draft: AuditEventDraft): Promise<AuditEventRecord> => {
      const sequence = ++this.sequence;
      this.events.push({ ...draft, sequence });
      return {
        ...draft,
        aggregateId: draft.aggregateId ?? 'platform',
        eventId: `01990000-0000-7000-8000-00000000e4${String(sequence).padStart(2, '0')}`,
        occurredAt: '2026-09-06T00:00:00.000Z',
        previousHash: '0'.repeat(64),
        eventHash: '0'.repeat(64),
        sequence,
      };
    },
  };

  async readSeal(): Promise<PackageSeal | null> {
    return this.seal;
  }

  async readRegisteredArtifacts() {
    return [];
  }

  async readIntegrityFindings(): Promise<readonly EvidenceIntegrityRecord[]> {
    return this.findings;
  }

  async recordIntegrityFindings(rows: readonly EvidenceIntegrityRecord[]): Promise<void> {
    this.findings.push(...rows);
  }

  async notifyTimeline(sequence: number): Promise<void> {
    this.timeline.push(sequence);
  }
}

function ids(): { next(): string } {
  let sequence = 0;
  return {
    next: () => `01990000-0000-7000-8000-00000000e4${String(++sequence).padStart(2, '0')}`,
  };
}

function mismatch(): EvidenceVerification {
  const expected = utf8Bytes('registered snapshot');
  return verifyStoredArtifact({
    evidenceId: '01990000-0000-7000-8000-00000000e456',
    objectKey: `structural-snapshot/${RUN.runId}/page`,
    expectedDigest: sha256HexOfBytes(expected),
    expectedSize: expected.byteLength,
    stored: {
      digest: sha256HexOfBytes(utf8Bytes('tampered snapshot')),
      size: utf8Bytes('tampered snapshot').byteLength,
    },
  });
}

describe('shared sealed integrity recording', () => {
  it('records a web inspector mismatch with source provenance and remains idempotent', async () => {
    const context = new FakeSealedContext();
    const verification = mismatch();
    expect(verification.finding).toBe('size-mismatch');

    const first = await recordSealedIntegrityFindings(context, [verification], {
      clock: { now: () => new Date('2026-09-06T00:00:00.000Z') },
      ids: ids(),
      source: 'web',
      actorId: 'evidence-inspector',
    });
    expect(first.recorded).toBe(1);
    expect(context.findings).toHaveLength(1);
    expect(context.findings[0]).toMatchObject({
      evidenceId: verification.evidenceId,
      objectKey: verification.objectKey,
      finding: 'size-mismatch',
      expectedDigest: verification.expectedDigest,
      observedDigest: verification.observedDigest,
      expectedSize: verification.expectedSize,
      observedSize: verification.observedSize,
    });
    expect(context.events).toHaveLength(1);
    expect(context.events[0]).toMatchObject({
      actor: { type: 'system', id: 'evidence-inspector' },
      eventType: 'failure.evidence-integrity',
      source: 'web',
      outcome: 'failure',
      payload: {
        evidenceId: verification.evidenceId,
        objectKey: verification.objectKey,
        registeredDigest: verification.expectedDigest,
        observedDigest: verification.observedDigest,
        stateChanged: false,
      },
    });
    expect(context.timeline).toEqual([1]);

    const second = await recordSealedIntegrityFindings(context, [verification], {
      clock: { now: () => new Date('2026-09-06T00:01:00.000Z') },
      ids: ids(),
      source: 'web',
      actorId: 'evidence-inspector',
    });
    expect(second.recorded).toBe(0);
    expect(context.findings).toHaveLength(1);
    expect(context.events).toHaveLength(1);
  });

  it('does not turn a successful verification into an integrity finding', async () => {
    const context = new FakeSealedContext();
    const bytes = utf8Bytes('unchanged');
    const verification = verifyStoredArtifact({
      evidenceId: '01990000-0000-7000-8000-00000000e457',
      objectKey: `structural-snapshot/${RUN.runId}/unchanged`,
      expectedDigest: sha256HexOfBytes(bytes),
      expectedSize: bytes.byteLength,
      stored: { digest: sha256HexOfBytes(bytes), size: bytes.byteLength },
    });
    expect(verification.finding).toBeNull();

    await expect(recordSealedIntegrityFindings(context, [verification], {
      clock: { now: () => new Date('2026-09-06T00:00:00.000Z') },
      ids: ids(),
    })).resolves.toEqual({ findings: [], recorded: 0 });
    expect(context.events).toEqual([]);
    expect(context.timeline).toEqual([]);
  });
});
