import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GATE_CHECKS } from '@intellifin/domain';

import {
  GATE_GROUPS,
  GATE_ROW_CONTRACTS,
  PER_OBSERVATION_CHECKS,
  gateGroupChecks,
  gateRowContract,
} from './gate-rows';

/**
 * The Gate checklist's prose, checked against the ADDENDUM and EXPERIENCE.md ON DISK.
 *
 * `GATE_ROW_CONTRACTS` claims to be a transcription of addendum §H's first two columns
 * and EXPERIENCE.md's two-group split. On its own that claim is pinned against nothing:
 * the module and a test can be retyped in one commit and agree with each other while both
 * disagree with the contract. This reads both artifacts and requires each cell character
 * for character — the same job `copy.test.ts` does for the sentences and
 * `tests/unit/gate-vocabulary.test.ts` does for the row ids.
 */

const PLANNING = '../../../../_bmad-output/planning-artifacts';
const addendum = readFileSync(
  fileURLToPath(new URL(`${PLANNING}/prds/prd-IntelliFin Audit-2026-08-31/addendum.md`, import.meta.url)),
  'utf8',
);
const experience = readFileSync(
  fileURLToPath(
    new URL(`${PLANNING}/ux-designs/ux-IntelliFin Audit-2026-09-01/EXPERIENCE.md`, import.meta.url),
  ),
  'utf8',
);

/** §H's table, first cell and second cell, in the addendum's own order. */
function addendumRows(): { check: string; rule: string }[] {
  const start = addendum.indexOf('## H. Normative Evidence Quality Gate');
  expect(start).toBeGreaterThan(0);
  const section = addendum.slice(start, addendum.indexOf('\n## ', start + 1));
  const rows: { check: string; rule: string }[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    const check = cells[1] ?? '';
    if (check === '' || check === 'Check' || /^-+$/.test(check)) continue;
    rows.push({ check, rule: cells[2] ?? '' });
  }
  return rows;
}

describe('the Gate checklist prose', () => {
  it('finds the section it is quoting', () => {
    expect(addendumRows()).toHaveLength(GATE_CHECKS.length);
  });

  it("reproduces every §H check name, in the addendum's order", () => {
    expect(GATE_CHECKS.map((check) => GATE_ROW_CONTRACTS[check].heading)).toEqual(
      addendumRows().map((row) => row.check),
    );
  });

  it('reproduces every §H PoC rule, character for character', () => {
    const rows = addendumRows();
    for (const [index, check] of GATE_CHECKS.entries()) {
      expect(GATE_ROW_CONTRACTS[check].rule, check).toBe(rows[index]!.rule);
    }
  });

  it("splits the rows the way EXPERIENCE.md's Gate checklist row does", () => {
    // "Per-Observation (update live during a Run, FR-20): required Evidence, identity
    // corroboration, Observation corroboration, search completeness, ambiguous match,
    // unnamed value, Target System freshness. Run-level (at end of execution): every
    // other §H row."
    const sentence = experience.slice(
      experience.indexOf('Per-Observation (update live during a Run'),
      experience.indexOf('Run-level (at end of execution)'),
    );
    expect(sentence).not.toBe('');
    const named = [
      'required Evidence',
      'identity corroboration',
      'Observation corroboration',
      'search completeness',
      'ambiguous match',
      'unnamed value',
      'Target System freshness',
    ];
    for (const phrase of named) expect(sentence, phrase).toContain(phrase);
    expect(named).toHaveLength(PER_OBSERVATION_CHECKS.length);
    expect([...gateGroupChecks('per-observation')].sort()).toEqual([...PER_OBSERVATION_CHECKS].sort());
    expect(gateGroupChecks('run-level')).toHaveLength(GATE_CHECKS.length - named.length);
    expect(GATE_GROUPS.map((group) => group.label)).toEqual([
      'Per-Observation checks',
      'Run-level checks',
    ]);
  });

  it('guards the lookup that a stored check name feeds', () => {
    // `Object.hasOwn`, eighth occurrence: the check name is read out of a database row
    // and a plain index on `'constructor'` answers with an inherited function.
    expect(gateRowContract('constructor')).toBeNull();
    expect(gateRowContract('toString')).toBeNull();
    expect(gateRowContract('__proto__')).toBeNull();
    expect(gateRowContract('not-a-check')).toBeNull();
    expect(gateRowContract('integrity')?.heading).toBe('Integrity');
  });
});
