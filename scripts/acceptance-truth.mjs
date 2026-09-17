/**
 * The comparison at the centre of the deployed acceptance: what IntelliFin concluded about
 * each synthetic leaver, against the predetermined truth about that leaver.
 *
 * It lives in its own module because it is the one assertion that decides whether the PoC
 * is demonstrated, and `verify-deployed-loancore.mjs` refuses to load without a live
 * database and an explicit authorization — so nothing inside that file can be tested.
 * `tests/unit/acceptance-truth.test.ts` proves this catches a swapped conclusion; an
 * aggregate count of Exceptions does not, because a build that flagged the wrong leaver
 * still produces exactly one.
 *
 * Pure: rows in, disagreements out. It reads no file and holds no state, so the harness
 * stays the only thing that decides WHERE the truth comes from (off disk, never imported
 * by anything that executes a Run — AD-12).
 */

/**
 * @param {{ expected_c1: Record<string,string>, expected_c2_with_canonical_policy: Record<string,string> }} truth
 * @param {ReadonlyArray<{ record: string, condition_id: string, value: string }>} rows
 * @returns {Array<{ record: string, condition?: string, expected: string|null, concluded: string|null }>}
 */
export function disagreementsWithTruth(truth, rows) {
  const expectedRecords = Object.keys(truth.expected_c1).sort();
  const byRecord = new Map();
  for (const row of rows) {
    // The record key arrives from a database row, so it is a lookup key a plain object
    // would resolve against `Object.prototype`.
    if (!byRecord.has(row.record)) byRecord.set(row.record, new Map());
    byRecord.get(row.record).set(row.condition_id, row.value);
  }
  const seen = [...byRecord.keys()].sort();
  const disagreements = [];
  if (seen.length !== expectedRecords.length || seen.some((key, index) => key !== expectedRecords[index])) {
    disagreements.push({ record: '(set)', expected: expectedRecords.join(','), concluded: seen.join(',') });
  }
  for (const record of expectedRecords) {
    const got = byRecord.get(record) ?? new Map();
    const wanted = [
      ['C1', truth.expected_c1[record]],
      ['C2', truth.expected_c2_with_canonical_policy[record]],
    ];
    for (const [condition, expected] of wanted) {
      // `undefined` is a disagreement: a record with no conclusion at all is not a record
      // the platform agreed about.
      const concluded = got.has(condition) ? got.get(condition) : null;
      if (concluded !== expected) disagreements.push({ record, condition, expected, concluded });
    }
  }
  return disagreements;
}
