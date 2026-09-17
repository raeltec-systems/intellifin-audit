import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// @ts-expect-error -- a plain ESM harness module with no declaration file.
import { disagreementsWithTruth } from '../../scripts/acceptance-truth.mjs';

/**
 * The deployed acceptance's central claim is that IntelliFin reached the RIGHT conclusion
 * about each synthetic leaver. These cases prove the comparison can fail: the aggregate
 * the harness also checks — six evaluations, one C1 Exception, three C2 Compliant — is
 * true of a build that flagged the wrong leaver, so it cannot carry the claim on its own.
 *
 * The oracle is read off disk, never imported by anything that executes a Run (AD-12).
 */
const TRUTH = JSON.parse(
  readFileSync('fixtures/northstar/expectations/p-1-live-acceptance.json', 'utf8'),
) as {
  expected_c1: Record<string, string>;
  expected_c2_with_canonical_policy: Record<string, string>;
};

interface Row { record: string; condition_id: string; value: string }

/** Exactly what a correct Run records, built from the oracle itself. */
function truthfulRows(): Row[] {
  return Object.keys(TRUTH.expected_c1).flatMap((record) => [
    { record, condition_id: 'C1', value: TRUTH.expected_c1[record]! },
    { record, condition_id: 'C2', value: TRUTH.expected_c2_with_canonical_policy[record]! },
  ]);
}

describe('the deployed acceptance against the predetermined truth', () => {
  it('has a truth file that names the leaver retaining access and the two disabled ones', () => {
    // Pinned so a later edit to the fixture cannot quietly turn the acceptance into a
    // comparison with nothing in it.
    expect(Object.keys(TRUTH.expected_c1).sort()).toEqual(['E-000102', 'E-000103', 'E-000105']);
    expect(TRUTH.expected_c1['E-000103']).toBe('EXCEPTION');
    expect(TRUTH.expected_c1['E-000102']).toBe('COMPLIANT');
    expect(TRUTH.expected_c1['E-000105']).toBe('COMPLIANT');
  });

  it('agrees with a Run that concluded exactly what is true', () => {
    expect(disagreementsWithTruth(TRUTH, truthfulRows())).toEqual([]);
  });

  it('refuses a Run that flagged the wrong leaver, although the totals are identical', () => {
    const rows = truthfulRows().map((row) =>
      row.condition_id !== 'C1' ? row
        : row.record === 'E-000103' ? { ...row, value: 'COMPLIANT' }
        : row.record === 'E-000102' ? { ...row, value: 'EXCEPTION' }
        : row);
    // The shape the aggregate check cannot see: still six rows, still one C1 Exception.
    expect(rows).toHaveLength(6);
    expect(rows.filter((row) => row.condition_id === 'C1' && row.value === 'EXCEPTION')).toHaveLength(1);
    const disagreements = disagreementsWithTruth(TRUTH, rows);
    expect(disagreements).toEqual([
      { record: 'E-000102', condition: 'C1', expected: 'COMPLIANT', concluded: 'EXCEPTION' },
      { record: 'E-000103', condition: 'C1', expected: 'EXCEPTION', concluded: 'COMPLIANT' },
    ]);
  });

  it('refuses a disabled leaver reported as an Exception', () => {
    const rows = truthfulRows().map((row) =>
      row.record === 'E-000105' && row.condition_id === 'C1' ? { ...row, value: 'EXCEPTION' } : row);
    expect(disagreementsWithTruth(TRUTH, rows)).toEqual([
      { record: 'E-000105', condition: 'C1', expected: 'COMPLIANT', concluded: 'EXCEPTION' },
    ]);
  });

  it('refuses a leaver retaining access reported as Compliant', () => {
    const rows = truthfulRows().map((row) =>
      row.record === 'E-000103' && row.condition_id === 'C1' ? { ...row, value: 'COMPLIANT' } : row);
    expect(disagreementsWithTruth(TRUTH, rows)).toEqual([
      { record: 'E-000103', condition: 'C1', expected: 'EXCEPTION', concluded: 'COMPLIANT' },
    ]);
  });

  it('refuses a record the Run reached no conclusion about', () => {
    const rows = truthfulRows().filter((row) => !(row.record === 'E-000102' && row.condition_id === 'C2'));
    expect(disagreementsWithTruth(TRUTH, rows)).toEqual([
      { record: 'E-000102', condition: 'C2', expected: 'COMPLIANT', concluded: null },
    ]);
  });

  it('refuses a Run that inspected a record the population does not contain', () => {
    const rows = [...truthfulRows(),
      { record: 'E-000999', condition_id: 'C1', value: 'COMPLIANT' },
      { record: 'E-000999', condition_id: 'C2', value: 'COMPLIANT' }];
    expect(disagreementsWithTruth(TRUTH, rows)[0]).toEqual({
      record: '(set)', expected: 'E-000102,E-000103,E-000105', concluded: 'E-000102,E-000103,E-000105,E-000999',
    });
  });

  it('refuses a Run that inspected fewer records than the population declares', () => {
    const rows = truthfulRows().filter((row) => row.record !== 'E-000105');
    const disagreements = disagreementsWithTruth(TRUTH, rows);
    expect(disagreements[0]?.record).toBe('(set)');
    expect(disagreements).toContainEqual({ record: 'E-000105', condition: 'C1', expected: 'COMPLIANT', concluded: null });
  });

  it('is not fooled by an inherited property name used as a record key', () => {
    const rows = [{ record: 'constructor', condition_id: 'C1', value: 'COMPLIANT' }];
    const disagreements = disagreementsWithTruth(TRUTH, rows);
    expect(disagreements[0]?.record).toBe('(set)');
    expect(disagreements).toHaveLength(1 + Object.keys(TRUTH.expected_c1).length * 2);
  });
});
