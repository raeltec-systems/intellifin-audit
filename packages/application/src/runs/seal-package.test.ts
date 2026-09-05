import { describe, expect, it } from 'vitest';
import { sha256HexOfBytes, utf8Bytes, type PackageArtifact, type RunRecord } from '@intellifin/domain';
import {
  PackageSealError,
  sealIfTerminal,
  sealPackage,
  verifySealedPackage,
} from './seal-package.js';
import { freezeArtifact, reserveArtifact, verifyRegisteredArtifact } from './evidence-package.js';
import {
  PopulationAcquisitionError,
  type EvidenceIntegrityRecord,
  type EvidencePackageContext,
  type EvidenceStore,
  type PackageSeal,
  type RegisteredArtifact,
  type SealedPackageContext,
  type SealedPackageRepository,
} from './execution-ports.js';

const RUN: RunRecord = {
  runId: '01a06fd8-0000-7000-8000-000000000001',
  correlationId: '01a06fd8-0000-7000-8000-000000000002',
  procedureId: '01a06fd8-0000-7000-8000-000000000003',
  versionId: '01a06fd8-0000-7000-8000-000000000004',
  versionNumber: 1,
  procedureName: 'Segregation of duties',
  period: { from: '2026-08-01', to: '2026-08-31' },
  state: 'RUN_FAILED',
  kind: 'STANDARD',
  initiatorId: 'auditor',
  sessionId: 'session',
  initiatedAt: '2026-09-01T00:00:00.000Z',
  authorizationRole: 'auditor',
  requestToken: '01a06fd8-0000-7000-8000-000000000005',
};

const SEALED_AT = '2026-09-05T00:00:00.000Z';

interface Appended {
  readonly eventType: string;
  readonly outcome: string;
  readonly payload: Record<string, unknown>;
}

class FakePackage implements EvidencePackageContext {
  seal: PackageSeal | null = null;
  events: Appended[] = [];
  timeline: number[] = [];
  private sequence = 0;

  constructor(public artifacts: PackageArtifact[]) {}

  auditEvents = {
    append: async (draft: {
      eventType: string;
      outcome: string;
      payload: Record<string, unknown>;
    }) => {
      this.sequence += 1;
      this.events.push({
        eventType: draft.eventType,
        outcome: draft.outcome,
        payload: draft.payload,
      });
      return { sequence: this.sequence } as never;
    },
  } as EvidencePackageContext['auditEvents'];

  readPackageArtifacts = (): Promise<readonly PackageArtifact[]> =>
    Promise.resolve(this.artifacts);

  abandonArtifacts = (evidenceIds: readonly string[]): Promise<void> => {
    this.artifacts = this.artifacts.map((artifact) =>
      evidenceIds.includes(artifact.evidenceId) && artifact.state === 'RESERVED'
        ? { ...artifact, state: 'ABANDONED' }
        : artifact,
    );
    return Promise.resolve();
  };

  readSeal = (): Promise<PackageSeal | null> => Promise.resolve(this.seal);

  writeSeal = (seal: PackageSeal): Promise<void> => {
    this.seal ??= seal;
    return Promise.resolve();
  };

  notifyTimeline = (sequence: number): Promise<void> => {
    this.timeline.push(sequence);
    return Promise.resolve();
  };
}

function artifact(overrides: Partial<PackageArtifact> = {}): PackageArtifact {
  return {
    evidenceId: 'population-id',
    kind: 'population',
    objectKey: `population/${RUN.runId}/raw`,
    required: true,
    state: 'REGISTERED',
    ...overrides,
  };
}

/** An in-memory store with the same seams `S3EvidenceStore` gives, tamper included. */
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

const budget = (): number => 1000;

describe('reserving and freezing an artifact', () => {
  it('reuses one reservation and one object when the same artifact is produced twice', async () => {
    const store = memoryStore();
    const bytes = utf8Bytes('account_id\nAG-1001\n');
    const first = reserveArtifact({
      runId: RUN.runId,
      kind: 'adapter-extraction',
      scope: 'session-2',
      templateId: 'P-2',
    });
    const frozen = await freezeArtifact(
      store,
      { objectKey: first.objectKeys[0]!, registeredDigest: null, registeredSize: null },
      bytes,
      budget,
    );

    // The crash. A second production of the same artifact names the same reservation.
    const second = reserveArtifact({
      runId: RUN.runId,
      kind: 'adapter-extraction',
      scope: 'session-2',
      templateId: 'P-2',
    });
    expect(second.evidenceId).toBe(first.evidenceId);
    expect(second.objectKeys).toEqual(first.objectKeys);
    const again = await freezeArtifact(
      store,
      {
        objectKey: second.objectKeys[0]!,
        registeredDigest: frozen.digest,
        registeredSize: frozen.size,
      },
      bytes,
      budget,
    );
    expect(again).toEqual(frozen);
    // Exactly one object exists: `putIfAbsent` reconciled rather than writing a second.
    expect([...store.objects.keys()]).toEqual([first.objectKeys[0]]);
  });

  it('refuses bytes that disagree with what a previous attempt registered', async () => {
    const store = memoryStore();
    const key = `extraction/${RUN.runId}/session-2`;
    await freezeArtifact(
      store,
      { objectKey: key, registeredDigest: null, registeredSize: null },
      utf8Bytes('first'),
      budget,
    );
    // A resumed attempt fetched different bytes. The store keeps the first ones, so the
    // comparison against what was SENT fails and nothing is repaired or re-uploaded.
    await expect(
      freezeArtifact(
        store,
        { objectKey: key, registeredDigest: null, registeredSize: null },
        utf8Bytes('second'),
        budget,
      ),
    ).rejects.toBeInstanceOf(PopulationAcquisitionError);
    expect(store.objects.get(key)).toEqual(utf8Bytes('first'));
  });

  it('refuses an object the store lost between the write and the read-back', async () => {
    const objects = new Map<string, Uint8Array>();
    const store: EvidenceStore = {
      read: () => Promise.resolve(null),
      putIfAbsent: (key, bytes) => {
        objects.set(key, bytes);
        return Promise.resolve();
      },
    };
    await expect(
      freezeArtifact(
        store,
        { objectKey: 'k', registeredDigest: null, registeredSize: null },
        utf8Bytes('x'),
        budget,
      ),
    ).rejects.toBeInstanceOf(PopulationAcquisitionError);
  });

  it('re-verifies a registered artifact and sees a tampered object', async () => {
    const store = memoryStore();
    const bytes = utf8Bytes('frozen');
    store.objects.set('k', bytes);
    const digest = sha256HexOfBytes(bytes);
    expect(await verifyRegisteredArtifact(store, { objectKey: 'k', digest, size: 6 }, budget)).toBe(
      true,
    );
    store.objects.set('k', utf8Bytes('tampered'));
    expect(await verifyRegisteredArtifact(store, { objectKey: 'k', digest, size: 6 }, budget)).toBe(
      false,
    );
    // An artifact with no registered digest was never verified, so it verifies as nothing.
    expect(
      await verifyRegisteredArtifact(store, { objectKey: 'k', digest: null, size: null }, budget),
    ).toBe(false);
  });
});

describe('sealing the package', () => {
  it('seals, abandons every open reservation and records both on the seal', async () => {
    const context = new FakePackage([
      artifact(),
      artifact({ evidenceId: 'ref', kind: 'reference-source' }),
      artifact({
        evidenceId: 'extract',
        kind: 'adapter-extraction',
        objectKey: `extraction/${RUN.runId}/session-3`,
        required: false,
        state: 'RESERVED',
      }),
    ]);
    const seal = await sealPackage(context, {
      run: RUN,
      terminalState: 'INCONCLUSIVE',
      sealedAt: SEALED_AT,
    });

    expect(seal).toMatchObject({
      state: 'SEALED',
      runState: 'INCONCLUSIVE',
      requiredTotal: 2,
      registered: 2,
      missingRequired: [],
    });
    expect(seal.abandoned).toEqual([
      { evidenceId: 'extract', kind: 'adapter-extraction', objectKey: `extraction/${RUN.runId}/session-3` },
    ]);
    expect(context.artifacts.find((row) => row.evidenceId === 'extract')?.state).toBe('ABANDONED');
    // A registered artifact is preserved forever: sealing never touches one.
    expect(context.artifacts.filter((row) => row.state === 'REGISTERED')).toHaveLength(2);
  });

  it('does not seal as complete when a required artifact never registered', async () => {
    const context = new FakePackage([
      artifact({ state: 'RESERVED' }),
      artifact({
        evidenceId: 'ref',
        kind: 'reference-source',
        objectKey: `reference/${RUN.runId}/session-2`,
        state: 'ABANDONED',
      }),
    ]);
    const seal = await sealPackage(context, {
      run: RUN,
      terminalState: 'RUN_FAILED',
      sealedAt: SEALED_AT,
    });
    expect(seal.state).toBe('INCOMPLETE');
    expect(seal.missingRequired.map((entry) => entry.evidenceId).sort()).toEqual([
      'population-id',
      'ref',
    ]);
    // The gap is NAMED on the Result, not hidden behind a count.
    const payload = context.events[0]!.payload;
    expect(payload['seal']).toBe('INCOMPLETE');
    expect(payload['missingRequired']).toEqual([
      `population/${RUN.runId}/raw`,
      `reference/${RUN.runId}/session-2`,
    ]);
  });

  it('appends one event, notifies the Timeline, and names artifacts and never bytes', async () => {
    const context = new FakePackage([artifact()]);
    await sealPackage(context, { run: RUN, terminalState: 'COMPLETED', sealedAt: SEALED_AT });
    expect(context.events).toHaveLength(1);
    expect(context.events[0]!.eventType).toBe('lifecycle.evidence-package-sealed');
    expect(context.timeline).toEqual([1]);
    const keys = Object.keys(context.events[0]!.payload);
    for (const forbidden of ['bytes', 'evidence', 'credential', 'credentialRef', 'mediaType', 'location']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('is idempotent: the first seal wins and a second call writes nothing', async () => {
    const context = new FakePackage([artifact()]);
    const first = await sealPackage(context, {
      run: RUN,
      terminalState: 'RUN_FAILED',
      sealedAt: SEALED_AT,
    });
    const second = await sealPackage(context, {
      run: RUN,
      terminalState: 'COMPLETED',
      sealedAt: '2027-01-01T00:00:00.000Z',
    });
    expect(second).toEqual(first);
    expect(second.runState).toBe('RUN_FAILED');
    expect(context.events).toHaveLength(1);
  });

  it('refuses to seal at a state the Run has not stopped at', async () => {
    const context = new FakePackage([artifact()]);
    await expect(
      sealPackage(context, { run: RUN, terminalState: 'RUNNING', sealedAt: SEALED_AT }),
    ).rejects.toBeInstanceOf(PackageSealError);
    expect(context.seal).toBeNull();
  });

  it('seals on a terminal transition and stands down on every other one', async () => {
    const running = new FakePackage([artifact()]);
    await sealIfTerminal(running, RUN, 'RUNNING', SEALED_AT);
    expect(running.seal).toBeNull();
    const stopped = new FakePackage([artifact()]);
    await sealIfTerminal(stopped, RUN, 'CANCELED', SEALED_AT);
    expect(stopped.seal?.runState).toBe('CANCELED');
  });
});

class FakeSealed implements SealedPackageContext {
  run: RunRecord | null = { ...RUN, state: 'INCONCLUSIVE' };
  seal: PackageSeal | null = {
    runId: RUN.runId,
    state: 'SEALED',
    runState: 'INCONCLUSIVE',
    sealedAt: SEALED_AT,
    requiredTotal: 1,
    registered: 1,
    missingRequired: [],
    abandoned: [],
  };
  findings: EvidenceIntegrityRecord[] = [];
  events: Appended[] = [];
  timeline: number[] = [];
  private sequence = 0;

  constructor(public artifacts: RegisteredArtifact[]) {}

  auditEvents = {
    append: async (draft: {
      eventType: string;
      outcome: string;
      payload: Record<string, unknown>;
    }) => {
      this.sequence += 1;
      this.events.push({
        eventType: draft.eventType,
        outcome: draft.outcome,
        payload: draft.payload,
      });
      return { sequence: this.sequence } as never;
    },
  } as SealedPackageContext['auditEvents'];

  readSeal = (): Promise<PackageSeal | null> => Promise.resolve(this.seal);
  readRegisteredArtifacts = (): Promise<readonly RegisteredArtifact[]> =>
    Promise.resolve(this.artifacts);
  readIntegrityFindings = (): Promise<readonly EvidenceIntegrityRecord[]> =>
    Promise.resolve(this.findings);
  recordIntegrityFindings = (rows: readonly EvidenceIntegrityRecord[]): Promise<void> => {
    for (const row of rows) {
      if (
        !this.findings.some(
          (existing) =>
            existing.evidenceId === row.evidenceId &&
            existing.objectKey === row.objectKey &&
            existing.finding === row.finding,
        )
      ) {
        this.findings.push(row);
      }
    }
    return Promise.resolve();
  };
  notifyTimeline = (sequence: number): Promise<void> => {
    this.timeline.push(sequence);
    return Promise.resolve();
  };
}

function repositoryOf(context: SealedPackageContext): SealedPackageRepository {
  return { transaction: (_runId, work) => work(context) };
}

const IDS = (() => {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `01a06fd8-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;
    },
  };
})();
const CLOCK = { now: () => new Date('2026-09-06T00:00:00.000Z') };

describe('a mismatch found after the Run', () => {
  it('is an integrity event with no state change, and the bytes are untouched', async () => {
    const store = memoryStore();
    const bytes = utf8Bytes('frozen');
    store.objects.set('k', bytes);
    const context = new FakeSealed([
      { evidenceId: 'e1', kind: 'population', objectKey: 'k', digest: sha256HexOfBytes(bytes), size: bytes.length },
    ]);
    // Nothing wrong yet.
    expect(await verifySealedPackage({ repository: repositoryOf(context), store, clock: CLOCK, ids: IDS }, RUN.runId))
      .toMatchObject({ verified: 1, recorded: 0 });

    store.objects.set('k', utf8Bytes('tampered'));
    const result = await verifySealedPackage(
      { repository: repositoryOf(context), store, clock: CLOCK, ids: IDS },
      RUN.runId,
    );
    expect(result.recorded).toBe(1);
    expect(result.findings[0]).toMatchObject({ finding: 'size-mismatch', objectKey: 'k' });
    expect(context.events[0]!.eventType).toBe('failure.evidence-integrity');
    expect(context.events[0]!.outcome).toBe('failure');
    expect(context.events[0]!.payload['stateChanged']).toBe(false);
    // No state change: the seal and the Run are exactly as they were, and the bytes stay.
    expect(context.seal).toMatchObject({ state: 'SEALED', runState: 'INCONCLUSIVE' });
    expect(context.run?.state).toBe('INCONCLUSIVE');
    expect(store.objects.get('k')).toEqual(utf8Bytes('tampered'));
  });

  it('records one finding however many times it is verified', async () => {
    const store = memoryStore();
    const context = new FakeSealed([
      { evidenceId: 'e1', kind: 'population', objectKey: 'gone', digest: 'a'.repeat(64), size: 1 },
    ]);
    const deps = { repository: repositoryOf(context), store, clock: CLOCK, ids: IDS };
    expect((await verifySealedPackage(deps, RUN.runId)).recorded).toBe(1);
    expect((await verifySealedPackage(deps, RUN.runId)).recorded).toBe(0);
    expect(context.findings).toHaveLength(1);
    expect(context.findings[0]!.finding).toBe('object-missing');
    expect(context.events).toHaveLength(1);
  });

  it('refuses a Run that has not stopped, because during a Run the same fact is RUN_FAILED', async () => {
    const store = memoryStore();
    const context = new FakeSealed([]);
    context.run = { ...RUN, state: 'RUNNING' };
    await expect(
      verifySealedPackage({ repository: repositoryOf(context), store, clock: CLOCK, ids: IDS }, RUN.runId),
    ).rejects.toBeInstanceOf(PackageSealError);
  });

  it('refuses a Run whose package was never sealed', async () => {
    const store = memoryStore();
    const context = new FakeSealed([]);
    context.seal = null;
    await expect(
      verifySealedPackage({ repository: repositoryOf(context), store, clock: CLOCK, ids: IDS }, RUN.runId),
    ).rejects.toBeInstanceOf(PackageSealError);
  });

  it('verifies an artifact with no recorded size by digest alone', async () => {
    const store = memoryStore();
    const bytes = utf8Bytes('envelope');
    store.objects.set('env', bytes);
    const context = new FakeSealed([
      { evidenceId: 'e1', kind: 'population', objectKey: 'env', digest: sha256HexOfBytes(bytes), size: null },
    ]);
    const deps = { repository: repositoryOf(context), store, clock: CLOCK, ids: IDS };
    expect((await verifySealedPackage(deps, RUN.runId)).recorded).toBe(0);
    store.objects.set('env', utf8Bytes('envelopf'));
    const result = await verifySealedPackage(deps, RUN.runId);
    expect(result.findings[0]).toMatchObject({ finding: 'digest-mismatch', expectedSize: null });
  });
});

describe('two objects under one reservation', () => {
  it('records a finding for each, because the unique key is the OBJECT', async () => {
    // The population reservation addresses the raw bytes AND the acquisition envelope.
    const store = memoryStore();
    const context = new FakeSealed([
      { evidenceId: 'pop', kind: 'population', objectKey: 'raw', digest: 'a'.repeat(64), size: 4 },
      { evidenceId: 'pop', kind: 'population', objectKey: 'envelope', digest: 'b'.repeat(64), size: null },
    ]);
    const result = await verifySealedPackage(
      { repository: repositoryOf(context), store, clock: CLOCK, ids: IDS },
      RUN.runId,
    );
    expect(result.recorded).toBe(2);
    expect(context.findings.map((entry) => entry.objectKey).sort()).toEqual(['envelope', 'raw']);
  });
});

describe('an unreadable store', () => {
  it('is reported to the caller, never written into the chain as a finding', async () => {
    const context = new FakeSealed([
      { evidenceId: 'e1', kind: 'population', objectKey: 'k', digest: 'a'.repeat(64), size: 1 },
    ]);
    const store: EvidenceStore = {
      read: () => Promise.reject(new PopulationAcquisitionError('transport')),
      putIfAbsent: () => Promise.resolve(),
    };
    await expect(
      verifySealedPackage({ repository: repositoryOf(context), store, clock: CLOCK, ids: IDS }, RUN.runId),
    ).rejects.toBeInstanceOf(PopulationAcquisitionError);
    // An outage is not tampering: nothing was recorded and nothing was appended.
    expect(context.findings).toEqual([]);
    expect(context.events).toEqual([]);
  });
});
