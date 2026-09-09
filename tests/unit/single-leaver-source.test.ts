import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bindingDigest, bindingDigestEnvelope, initialDraftPopulation, reconcilePopulation, sha256HexOfBytes } from '@intellifin/domain';
import { HttpPopulationAcquisition } from '@intellifin/infrastructure/acquisition';
import { startCanonicalLeaverSource } from '../fixtures/single-leaver-source';

const canonicalPath = new URL('../../fixtures/northstar/datasets/leavers-export.json', import.meta.url);
const canonical = readFileSync(canonicalPath);
const dataset = JSON.parse(canonical.toString()) as { rows: Record<string, string>[] };

describe('independently declared canonical single-case source', () => {
  it.each(['E-000101', 'E-000102'])('acquires the exact canonical %s row through the production HTTP/cover adapter', async key => {
    const fixture = await startCanonicalLeaverSource(key);
    try {
      expect(fixture.row).toEqual(dataset.rows.find(row => row.employee_id === key));
      const contract = { kind: 'versioned-file' as const, location: fixture.location, declaredSchema: fixture.schema, sensitiveFields: [], declaredCountMechanism: 'cover-sheet' as const };
      const source = { bindingId: '0198ca8f-0510-7000-8000-000000000001', displayName: 'Canonical case', digest: bindingDigest(contract), contract: bindingDigestEnvelope(contract) };
      const acquired = await new HttpPopulationAcquisition().acquire(source, fixture.period, 5000);
      expect(acquired.declaration).toMatchObject({ count: 1, complete: true, sha256: fixture.cover.content_digest.value });
      expect(sha256HexOfBytes(acquired.bytes)).toBe(fixture.cover.content_digest.value);
      const result = reconcilePopulation({ ...acquired, source, period: fixture.period, rule: initialDraftPopulation('P-1').inclusionRule, zeroRecordPass: false, initiatedAt: new Date().toISOString() });
      expect(result.included).toBe(1); expect(result.indeterminate).toBe(0);
      expect(result.checks.every(row => row.passed)).toBe(true);
      expect(result.rows[0]!.values).toEqual(fixture.row);
      expect(readFileSync(canonicalPath)).toEqual(canonical);
    } finally { await fixture.close(); }
  });
  it('refuses selecting a canonical duplicate as if it were one unambiguous row', async () => {
    await expect(startCanonicalLeaverSource('E-000107')).rejects.toThrow('Single-case source requires exactly one canonical employee row');
  });
});
