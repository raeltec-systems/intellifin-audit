import { describe, expect, it } from 'vitest';
import { utf8Bytes, type ObservationRecord } from '@intellifin/domain';

import { snapshotCorroboration } from './snapshot-corroboration.js';

/**
 * The seam between the domain extractor and the port `registerObservations` calls.
 *
 * The judging itself is proved against Python-produced vectors in
 * `tests/unit/snapshot-extraction.test.ts`. What is proved here is the mapping: one
 * verdict per subject, the identity carried in its own slot, an unjudged attribute left
 * out of the list rather than reported as a verdict, and a port that reaches nothing but
 * the bytes it was handed.
 */

const EVIDENCE = '01920000-0000-7000-8000-00000000c001';
const OTHER_EVIDENCE = '01920000-0000-7000-8000-00000000c002';

const ACCOUNTS = JSON.stringify({
  complete: true,
  accounts: [{ account_id: 'AG-1001', roles: ['AP_CLERK'], status: 'Active' }],
});

function record(over: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    schemaVersion: 1,
    observationId: '0f9a1a3d-2f2c-8a1b-9f0c-6b4e2d1c8a70',
    workItemId: '01920000-0000-7000-8000-00000000a001',
    populationRecordKey: 'AG-1001',
    targetSystem: 'accessgate',
    found: 'true',
    observedAt: '2026-09-05T10:00:00.000Z',
    stepExecutionId: '01920000-0000-7000-8000-00000000b001',
    captureMethod: 'adapter',
    matchOrigin: 'platform',
    identity: {
      name: 'account_id',
      originalValue: 'AG-1001',
      normalizedValue: 'AG-1001',
      grounding: { evidenceId: EVIDENCE, locator: '$.accounts[0].account_id', label: 'account_id', extractedText: 'AG-1001' },
      corroboration: null,
    },
    attributes: [
      {
        name: 'roles',
        originalValue: ['AP_CLERK'],
        normalizedValue: ['AP_CLERK'],
        grounding: { evidenceId: EVIDENCE, locator: '$.accounts[0].roles', label: 'roles', extractedText: '["AP_CLERK"]' },
        corroboration: null,
      },
      {
        name: 'status',
        originalValue: 'Active',
        normalizedValue: 'Active',
        grounding: null,
        corroboration: null,
      },
    ],
    evidenceIds: [EVIDENCE],
    ...over,
  };
}

const json = { evidenceId: EVIDENCE, substrate: 'json' as const, bytes: utf8Bytes(ACCOUNTS) };

describe('snapshotCorroboration', () => {
  it('answers once per subject, in order, with the identity in its own slot', async () => {
    const port = snapshotCorroboration([json]);
    const subjects = [record(), record({ observationId: 'second', populationRecordKey: 'AG-1001' })];
    const verdicts = await port.corroborate(subjects);
    expect(verdicts.map((verdict) => verdict.observationId)).toEqual([
      subjects[0]!.observationId,
      'second',
    ]);
    expect(verdicts[0]).toMatchObject({ outcome: 'PASS', diagnostic: null, identity: 'matched' });
    // `status` has no grounding, so it has no verdict — not a `matched` one.
    expect(verdicts[0]!.attributes).toEqual([{ name: 'roles', corroboration: 'matched' }]);
  });

  it('fails a subject whose grounding names Evidence it was not given', async () => {
    const port = snapshotCorroboration([{ ...json, evidenceId: OTHER_EVIDENCE }]);
    const [verdict] = await port.corroborate([record()]);
    expect(verdict).toMatchObject({ outcome: 'FAIL', diagnostic: 'corroboration-unavailable' });
    // "Nothing could read it" is not "it read differently": no attribute is accused.
    expect(verdict!.identity).toBeNull();
    expect(verdict!.attributes).toEqual([]);
  });

  it('fails an agent substrate by name rather than passing it silently', async () => {
    const port = snapshotCorroboration([{ ...json, substrate: 'web_tree' }]);
    const [verdict] = await port.corroborate([record()]);
    expect(verdict).toMatchObject({ outcome: 'FAIL', diagnostic: 'corroboration-unsupported' });
  });

  it('contradicts a value the stored bytes do not hold', async () => {
    const port = snapshotCorroboration([json]);
    const [verdict] = await port.corroborate([
      record({
        attributes: [
          {
            name: 'roles',
            originalValue: ['PAYMENT_RELEASER'],
            normalizedValue: ['PAYMENT_RELEASER'],
            grounding: { evidenceId: EVIDENCE, locator: '$.accounts[0].roles', label: 'roles', extractedText: '["PAYMENT_RELEASER"]' },
            corroboration: null,
          },
        ],
      }),
    ]);
    expect(verdict).toMatchObject({ outcome: 'FAIL', diagnostic: 'corroboration-contradictory' });
    expect(verdict!.attributes).toEqual([{ name: 'roles', corroboration: 'contradictory' }]);
  });

  it('gives the same answer every time, which is what redelivery depends on', async () => {
    // Corroboration runs BEFORE the digest, so a verdict that could move between two reads
    // of the same bytes would make a redelivered batch look like tampering.
    const port = snapshotCorroboration([json]);
    const first = await port.corroborate([record()]);
    const again = await snapshotCorroboration([
      { evidenceId: EVIDENCE, substrate: 'json', bytes: utf8Bytes(ACCOUNTS) },
    ]).corroborate([record()]);
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
  });

  it('parses one snapshot once however many subjects name it', async () => {
    // Not a micro-optimisation: one Work Item registers an Observation per included
    // population record, each with several groundings into the SAME artifact, so parsing
    // per grounding would re-parse one extraction tens of thousands of times inside a
    // transaction.
    let reads = 0;
    const counted = {
      evidenceId: EVIDENCE,
      substrate: 'json' as const,
      get bytes() {
        reads += 1;
        return utf8Bytes(ACCOUNTS);
      },
    };
    const port = snapshotCorroboration([counted]);
    await port.corroborate([record(), record({ observationId: 'b' }), record({ observationId: 'c' })]);
    expect(reads).toBe(1);
  });
});
