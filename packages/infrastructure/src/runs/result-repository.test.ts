import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { OBSERVATION_LIMITS, POPULATION_LIMITS } from '@intellifin/domain';

import { GATE_OBSERVATION_LIMIT } from './result-repository.js';

/**
 * The per-record coverage matrix must be able to READ every Observation of a Run.
 *
 * `readGateObservations` was capped at `POPULATION_LIMITS.rows`, which is correct for
 * `readPopulationRows` — acquisition caps `population_row` at exactly that — and wrong here,
 * because the matrix `coverageFindings` decides is RECORDS × REQUIRED TARGET SYSTEMS. Sixty
 * thousand records across two Target Systems is a hundred and twenty thousand Observations
 * and twenty thousand were silently dropped; a dropped `COVERED` cell reads as MISSING
 * coverage, so a fully covered Run sealed `INCONCLUSIVE` and published coverage counts that
 * were simply wrong.
 *
 * The ceiling is checked against two facts that are NOT `result-repository.ts`, because a
 * constant asserted against a copy of its own definition proves only that it equals itself:
 *
 *  - `OBSERVATION_LIMITS.batch`, the domain's own cap on one Work Item's registration batch;
 *  - the `<= 32` in generation 9's `procedure_version_targets_shape` CHECK, read off disk —
 *    the layer no command, migration or psql session can route around, and therefore the
 *    real bound on how many Work Items one Run can have.
 */

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** The most Target Systems one Procedure Version may select, per the database itself. */
function maxTargetsFromTheMigration(): number {
  const sql = readFileSync(`${MIGRATIONS}/0009_long_mysterio.sql`, 'utf8');
  const match =
    /"procedure_version_targets_shape"[^;]*jsonb_array_length\([^)]*\)\s*<=\s*(\d+)/.exec(sql);
  expect(match, 'generation 9 must still declare the targets CHECK').not.toBeNull();
  return Number.parseInt(match![1] as string, 10);
}

describe('the Gate observation read', () => {
  it('can hold every Observation a Run is able to register', () => {
    const targets = maxTargetsFromTheMigration();
    expect(targets).toBeGreaterThan(1);
    // One Work Item per selected Target System, at most one Observation per included
    // population record. This is what a full Run of the largest permitted shape produces,
    // and the read must not be smaller than it.
    expect(GATE_OBSERVATION_LIMIT).toBeGreaterThanOrEqual(OBSERVATION_LIMITS.batch * targets);
  });

  it('is not the population ROW cap, which is a bound on a different thing', () => {
    // `POPULATION_LIMITS.rows` bounds `population_row` and binds nowhere here. Written as
    // the coverage read's ceiling it truncated the matrix at one Target System's worth.
    expect(GATE_OBSERVATION_LIMIT).toBeGreaterThan(POPULATION_LIMITS.rows);
  });
});
