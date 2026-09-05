import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_ARTIFACT_KINDS,
  EvidenceReservationError,
  REQUIRED_EVIDENCE_TEMPLATE_IDS,
  evidenceIdFor,
  evidenceIdempotencyKey,
  evidenceObjectKey,
  evidenceObjectKeys,
  isRequiredArtifact,
  isTerminalRunState,
  requiredEvidenceKinds,
  sealPackageDecision,
  verifyStoredArtifact,
  type EvidenceArtifactKind,
  type PackageArtifact,
} from './evidence.js';
import { RUN_STATES } from './run.js';

const RUN = '01a06fd8-0000-7000-8000-000000000001';

function artifact(overrides: Partial<PackageArtifact> = {}): PackageArtifact {
  return {
    evidenceId: '01a06fd8-0000-7000-8000-00000000000a',
    kind: 'population',
    objectKey: `population/${RUN}/raw`,
    required: true,
    state: 'REGISTERED',
    ...overrides,
  };
}

describe('the reservation name', () => {
  it('derives the same id and object keys for the same reservation, every time', () => {
    const reservation = { runId: RUN, kind: 'adapter-extraction' as const, scope: 'session-2' };
    expect(evidenceIdFor(reservation)).toBe(evidenceIdFor({ ...reservation }));
    expect(evidenceObjectKeys(reservation)).toEqual([`extraction/${RUN}/session-2`]);
    // A retried production after a crash re-derives, it does not allocate: this is the
    // whole of "the same reservation and object key are reused".
    expect(evidenceIdempotencyKey(reservation)).toBe(
      `evidence-v1:${RUN}:adapter-extraction:session-2`,
    );
  });

  it('gives two reservations of one Run different names', () => {
    const ids = new Set([
      evidenceIdFor({ runId: RUN, kind: 'population', scope: '' }),
      evidenceIdFor({ runId: RUN, kind: 'reference-source', scope: 'session-2' }),
      evidenceIdFor({ runId: RUN, kind: 'adapter-extraction', scope: 'session-2' }),
      evidenceIdFor({ runId: RUN, kind: 'adapter-extraction', scope: 'session-3' }),
    ]);
    expect(ids.size).toBe(4);
  });

  it('is a UUIDv8: a name, never a mint', () => {
    const id = evidenceIdFor({ runId: RUN, kind: 'population', scope: '' });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('keeps the object keys Stories 3.2 and 3.3 already wrote', () => {
    // An artifact frozen by an earlier build has to resolve to the same object. Renaming
    // a key here would leave every Run in flight reserving a second one beside the first.
    expect(evidenceObjectKeys({ runId: RUN, kind: 'population', scope: '' })).toEqual([
      `population/${RUN}/raw`,
      `population/${RUN}/acquisition-v1`,
    ]);
    expect(evidenceObjectKey({ runId: RUN, kind: 'reference-source', scope: 'session-2' })).toBe(
      `reference/${RUN}/session-2`,
    );
  });

  it('refuses a scope that is not usable as an object-key segment', () => {
    for (const scope of ['', '../escape', 'a/b', 'a'.repeat(65), 'x y']) {
      expect(() =>
        evidenceIdFor({ runId: RUN, kind: 'adapter-extraction', scope }),
      ).toThrow(EvidenceReservationError);
    }
    // The population is the ONE Run-level reservation, so a scope on it is a mistake too.
    expect(() => evidenceIdFor({ runId: RUN, kind: 'population', scope: 'session-1' })).toThrow(
      EvidenceReservationError,
    );
    expect(() =>
      evidenceIdFor({ runId: 'not a run', kind: 'population', scope: '' }),
    ).toThrow(EvidenceReservationError);
    expect(() =>
      evidenceIdFor({ runId: RUN, kind: 'nonsense' as EvidenceArtifactKind, scope: '' }),
    ).toThrow(EvidenceReservationError);
  });
});

describe('the required rule', () => {
  it('is written for every Template the compiler knows', () => {
    expect(REQUIRED_EVIDENCE_TEMPLATE_IDS).toEqual(['P-1', 'P-2', 'P-3', 'P-4']);
    for (const templateId of REQUIRED_EVIDENCE_TEMPLATE_IDS) {
      expect(requiredEvidenceKinds(templateId)).not.toBeNull();
    }
  });

  it('requires what the Run concluded FROM and not the extraction', () => {
    for (const templateId of REQUIRED_EVIDENCE_TEMPLATE_IDS) {
      expect(isRequiredArtifact(templateId, 'population')).toBe(true);
      expect(isRequiredArtifact(templateId, 'reference-source')).toBe(true);
      // A failed Work Item is already INCONCLUSIVE at the Run-level Gate. Saying it again
      // as an incomplete package would mean no INCONCLUSIVE Run could ever hold a complete
      // one, which drains the word of meaning.
      expect(isRequiredArtifact(templateId, 'adapter-extraction')).toBe(false);
    }
  });

  it('answers an unknown Template with nothing, and an inherited key with nothing', () => {
    expect(requiredEvidenceKinds('P-9')).toBeNull();
    // `Object.hasOwn`, fifth-and-counting: a template id read out of a frozen plan is
    // request-shaped input, and `REQUIRED_EVIDENCE_KINDS['constructor']` is a function.
    expect(requiredEvidenceKinds('constructor')).toBeNull();
    expect(isRequiredArtifact('toString', 'population')).toBe(false);
  });
});

describe('the sealable decision', () => {
  it('seals when every required artifact is registered', () => {
    const decision = sealPackageDecision([
      artifact(),
      artifact({ evidenceId: 'b', kind: 'reference-source', required: true }),
      artifact({ evidenceId: 'c', kind: 'adapter-extraction', required: false }),
    ]);
    expect(decision).toMatchObject({
      state: 'SEALED',
      missingRequired: [],
      abandoned: [],
      registered: 3,
      requiredTotal: 2,
    });
  });

  it('seals an empty package: a Run that froze nothing owes nothing', () => {
    expect(sealPackageDecision([])).toMatchObject({
      state: 'SEALED',
      requiredTotal: 0,
      registered: 0,
    });
  });

  it('abandons every open reservation and names it', () => {
    const decision = sealPackageDecision([
      artifact(),
      artifact({ evidenceId: 'b', kind: 'adapter-extraction', required: false, state: 'RESERVED' }),
    ]);
    expect(decision.abandoned.map((entry) => entry.evidenceId)).toEqual(['b']);
    // An abandoned reservation that was not required does not stop the seal — but it is
    // still listed, because a reservation is never silently dropped.
    expect(decision.state).toBe('SEALED');
  });

  it('judges completeness AFTER abandonment, not before', () => {
    // The order is the rule. Judged first, this package would seal on a reservation the
    // same transaction was about to abandon.
    const decision = sealPackageDecision([artifact({ state: 'RESERVED' })]);
    expect(decision.state).toBe('INCOMPLETE');
    expect(decision.missingRequired.map((entry) => entry.evidenceId)).toEqual([
      artifact().evidenceId,
    ]);
    expect(decision.abandoned.map((entry) => entry.evidenceId)).toEqual([artifact().evidenceId]);
    expect(decision.registered).toBe(0);
  });

  it('is INCOMPLETE when a required artifact was abandoned earlier', () => {
    const decision = sealPackageDecision([
      artifact({ kind: 'reference-source', state: 'ABANDONED' }),
    ]);
    expect(decision).toMatchObject({ state: 'INCOMPLETE', abandoned: [], requiredTotal: 1 });
    expect(decision.missingRequired).toHaveLength(1);
  });

  it('never mutates the artifacts it was given', () => {
    const rows = [artifact({ state: 'RESERVED' })];
    sealPackageDecision(rows);
    expect(rows[0]!.state).toBe('RESERVED');
  });
});

describe('terminal Run states', () => {
  it('names exactly the four states a Run stops at', () => {
    const terminal = RUN_STATES.filter((state) => isTerminalRunState(state));
    expect(terminal).toEqual(['COMPLETED', 'INCONCLUSIVE', 'RUN_FAILED', 'CANCELED']);
    expect(isTerminalRunState('RUNNING')).toBe(false);
    expect(isTerminalRunState('constructor')).toBe(false);
  });
});

describe('verifying a stored artifact', () => {
  const base = {
    evidenceId: 'e',
    objectKey: 'k',
    expectedDigest: 'a'.repeat(64),
    expectedSize: 12,
  };

  it('agrees when the store holds what registration recorded', () => {
    expect(
      verifyStoredArtifact({ ...base, stored: { size: 12, digest: 'a'.repeat(64) } }).finding,
    ).toBeNull();
  });

  it('reports a missing object as missing, not as a digest that matched nothing', () => {
    const verification = verifyStoredArtifact({ ...base, stored: null });
    expect(verification.finding).toBe('object-missing');
    expect(verification.observedDigest).toBeNull();
    expect(verification.observedSize).toBeNull();
  });

  it('reports size before digest', () => {
    expect(
      verifyStoredArtifact({ ...base, stored: { size: 13, digest: 'b'.repeat(64) } }).finding,
    ).toBe('size-mismatch');
  });

  it('reports a digest mismatch and carries both digests', () => {
    const verification = verifyStoredArtifact({
      ...base,
      stored: { size: 12, digest: 'b'.repeat(64) },
    });
    expect(verification.finding).toBe('digest-mismatch');
    expect(verification.expectedDigest).toBe('a'.repeat(64));
    expect(verification.observedDigest).toBe('b'.repeat(64));
  });

  it('verifies by digest alone where no size was ever recorded', () => {
    // The acquisition envelope. Inventing an expected size for it would put a number
    // nobody measured into an immutable chain.
    expect(
      verifyStoredArtifact({
        ...base,
        expectedSize: null,
        stored: { size: 999, digest: 'a'.repeat(64) },
      }).finding,
    ).toBeNull();
    expect(
      verifyStoredArtifact({
        ...base,
        expectedSize: null,
        stored: { size: 999, digest: 'b'.repeat(64) },
      }).finding,
    ).toBe('digest-mismatch');
  });
});

describe('the artifact vocabulary', () => {
  it('is closed', () => {
    expect(EVIDENCE_ARTIFACT_KINDS).toEqual([
      'population',
      'reference-source',
      'adapter-extraction',
    ]);
  });
});

describe('the reservation is where an unusable frozen step id is caught', () => {
  it('refuses before an object key is built, not after', () => {
    // A frozen step id comes from the compiler as `session-N`, so this is unreachable in
    // practice — and it is guarded because "unreachable" is a claim about code somewhere
    // else. The producers translate the throw into a CONTRACT failure, which is not
    // retried: the same bytes would produce the same refusal.
    expect(() => evidenceObjectKeys({ runId: RUN, kind: 'reference-source', scope: '../x' })).toThrow(
      EvidenceReservationError,
    );
    expect(() => evidenceIdempotencyKey({ runId: RUN, kind: 'reference-source', scope: '' })).toThrow(
      EvidenceReservationError,
    );
  });
});
