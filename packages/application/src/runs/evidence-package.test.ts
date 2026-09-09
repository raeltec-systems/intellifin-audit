import { describe, expect, it } from 'vitest';

import { adapterEvidenceRecord, registerEvidence, reserveArtifact } from './evidence-package.js';
import type { AdapterEvidenceRecord } from './execution-ports.js';

/**
 * `registerEvidence`: the one way an Evidence record becomes `REGISTERED`, and therefore
 * the one place FR-31's capture provenance is stamped (owner decision, 2026-09-06).
 *
 * Three call sites in `execute-adapter-steps.ts` each used to spread
 * `{ ...evidence, state: 'REGISTERED' }` by hand. A fourth written later would have
 * registered an artifact with no capture method and no capture time and nothing would
 * have said so — which is exactly how the field came to be derived from the kind on the
 * way to a screen in the first place.
 */

const RUN = '01a06fd8-0000-7000-8000-000000000001';

function reserved(): AdapterEvidenceRecord {
  return adapterEvidenceRecord(
    reserveArtifact({ runId: RUN, kind: 'adapter-extraction', scope: 'step-1', templateId: 'P-2' }),
    'accessgate',
    undefined,
  );
}

describe('registering one Evidence record', () => {
  it('stamps the measured capture provenance, and says the instant was measured', () => {
    const record = reserved();
    expect(record).toMatchObject({
      state: 'RESERVED',
      capturedAt: null,
      captureMethod: null,
      captureTimeSource: null,
    });
    const registered = registerEvidence(
      record,
      { digest: 'a'.repeat(64), size: 12 },
      { mediaType: 'application/json', capturedAt: '2026-09-06T09:00:00.000Z', method: 'adapter' },
    );
    expect(registered).toMatchObject({
      state: 'REGISTERED',
      digest: 'a'.repeat(64),
      size: 12,
      mediaType: 'application/json',
      capturedAt: '2026-09-06T09:00:00.000Z',
      captureMethod: 'adapter',
      // `registration`, never `step-execution`: this instant WAS measured, inside the
      // transaction that wrote REGISTERED. The other value is what generation 32
      // backfilled onto rows whose instant could only be recovered.
      captureTimeSource: 'registration',
    });
  });

  it('never moves the instant of an artifact a previous attempt already registered', () => {
    // Re-verifying bytes is not re-capturing them. A redelivery that moved the time
    // forward would make an artifact look younger than the Run that froze it, and two
    // reads of one Run would disagree about when its Evidence was captured.
    const first = registerEvidence(
      reserved(),
      { digest: 'a'.repeat(64), size: 12 },
      { capturedAt: '2026-09-06T09:00:00.000Z', method: 'adapter' },
    );
    const again = registerEvidence(
      first,
      { digest: 'a'.repeat(64), size: 12 },
      { capturedAt: '2026-09-06T11:00:00.000Z', method: 'agent' },
    );
    expect(again).toMatchObject({
      capturedAt: '2026-09-06T09:00:00.000Z',
      captureMethod: 'adapter',
      captureTimeSource: 'registration',
    });
  });

  it('carries a prior registration’s provenance through a fresh reservation of the same artifact', () => {
    // A resumed attempt re-derives its reservation rather than minting a second object
    // (Story 3.5), so the record it starts from must inherit what the attempt that really
    // captured the bytes recorded — not start blank and be stamped with the resume time.
    const prior = registerEvidence(
      reserved(),
      { digest: 'a'.repeat(64), size: 12 },
      { capturedAt: '2026-09-06T09:00:00.000Z', method: 'adapter' },
    );
    const resumed = adapterEvidenceRecord(
      reserveArtifact({ runId: RUN, kind: 'adapter-extraction', scope: 'step-1', templateId: 'P-2' }),
      'accessgate',
      prior,
    );
    expect(resumed).toMatchObject({
      state: 'REGISTERED',
      capturedAt: '2026-09-06T09:00:00.000Z',
      captureMethod: 'adapter',
      captureTimeSource: 'registration',
    });
  });

  it('leaves the media type alone when the caller names none', () => {
    // The extraction path sets it before freezing; the Reference Source path passes it
    // here. A registration that blanked it would lose the substrate the grounding
    // inspector decides on.
    const record = { ...reserved(), mediaType: 'text/csv' };
    expect(
      registerEvidence(record, { digest: 'b'.repeat(64), size: 4 }, {
        capturedAt: '2026-09-06T09:00:00.000Z',
        method: 'adapter',
      }).mediaType,
    ).toBe('text/csv');
  });
});
