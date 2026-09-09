import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  GATE_CHECKS,
  GATE_DIAGNOSTICS,
  GATE_DIAGNOSTIC_ROW,
  GATE_DIAGNOSTIC_STATE,
  OBSERVATION_CHECKS,
  POPULATION_CHECK_NAMES,
  POPULATION_CHECK_DIAGNOSTIC,
  RUN_STOP_CAUSES,
  RUN_STOP_STATES,
  runStopFor,
  preservesPartialEvidence,
} from '@intellifin/domain';

/**
 * The §H row vocabulary, checked against the ADDENDUM ON DISK.
 *
 * `GATE_CHECKS` is a transcription of a table somebody else wrote, and a transcription is
 * only worth anything if something compares it with its source. The alternative — a list
 * asserted against a copy of itself — is the defect this repository has already recorded
 * twice ("never assert a contract against a copy of itself"), and here the contract decides
 * whether an audit Run may conclude.
 *
 * The addendum's rows are prose headings, so the check is by shape: the table has exactly
 * as many rows as the vocabulary, in the same order, and each row's first cell maps onto
 * exactly one vocabulary entry.
 */

const ADDENDUM = fileURLToPath(
  new URL(
    '../../_bmad-output/planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/addendum.md',
    import.meta.url,
  ),
);

/** The §H table's first column, in the addendum's own order. */
function addendumRows(): { check: string; outcome: string }[] {
  const text = readFileSync(ADDENDUM, 'utf8');
  const start = text.indexOf('## H. Normative Evidence Quality Gate');
  expect(start).toBeGreaterThan(0);
  const section = text.slice(start, text.indexOf('\n## ', start + 1));
  const rows: { check: string; outcome: string }[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    const check = cells[1] ?? '';
    if (check === '' || check === 'Check' || /^-+$/.test(check)) continue;
    rows.push({ check, outcome: cells[3] ?? '' });
  }
  return rows;
}

/** The addendum's heading for each vocabulary entry, in vocabulary order. */
const HEADINGS: Readonly<Record<(typeof GATE_CHECKS)[number], string>> = {
  'workspace-access': 'Workspace and Target System access',
  'population-acquisition': 'Population acquisition',
  'count-reconciliation-file': 'Record-count reconciliation — file level',
  'count-reconciliation-inclusion': 'Record-count reconciliation — inclusion level',
  'empty-population': 'Empty population',
  'per-record-coverage': 'Per-record coverage',
  'identity-corroboration': 'Identity corroboration',
  'search-completeness': 'Search completeness (absence)',
  'required-evidence': 'Required Evidence',
  'observation-corroboration': 'Observation corroboration',
  'condition-completeness': 'Condition completeness',
  'extraction-completeness': 'Pagination / extraction completeness',
  schema: 'Schema',
  'mandatory-values': 'Mandatory values',
  'duplicate-primary-keys': 'Duplicate primary keys',
  'ambiguous-match': 'Ambiguous match',
  'unnamed-value': 'Unnamed value',
  'snapshot-freshness': 'Freshness — snapshot Sources',
  'observation-freshness': 'Freshness — Target System Observations',
  integrity: 'Integrity',
};

describe('the §H row vocabulary', () => {
  it('has exactly the addendum rows, in the addendum order', () => {
    const rows = addendumRows();
    expect(rows.map((row) => row.check)).toEqual(GATE_CHECKS.map((check) => HEADINGS[check]));
  });

  it('gives a row RUN_FAILED only where the addendum does', () => {
    const rows = addendumRows();
    for (const [index, check] of GATE_CHECKS.entries()) {
      const outcome = rows[index]!.outcome;
      const diagnostics = GATE_DIAGNOSTICS.filter(
        (diagnostic) => GATE_DIAGNOSTIC_ROW[diagnostic] === check,
      );
      expect(diagnostics.length).toBeGreaterThan(0);
      const producesRunFailed = diagnostics.some(
        (diagnostic) => GATE_DIAGNOSTIC_STATE[diagnostic] === 'RUN_FAILED',
      );
      // The addendum's "Failure outcome" cell names the states this row can produce.
      expect(producesRunFailed).toBe(outcome.includes('RUN_FAILED'));
      const producesInconclusive = diagnostics.some(
        (diagnostic) => GATE_DIAGNOSTIC_STATE[diagnostic] === 'INCONCLUSIVE',
      );
      expect(producesInconclusive).toBe(outcome.includes('INCONCLUSIVE'));
    }
  });

  it('routes every diagnostic to exactly one row and one state', () => {
    for (const diagnostic of GATE_DIAGNOSTICS) {
      expect(GATE_CHECKS).toContain(GATE_DIAGNOSTIC_ROW[diagnostic]);
      expect(['INCONCLUSIVE', 'RUN_FAILED']).toContain(GATE_DIAGNOSTIC_STATE[diagnostic]);
    }
    expect(new Set(GATE_DIAGNOSTICS).size).toBe(GATE_DIAGNOSTICS.length);
    expect(new Set(GATE_CHECKS).size).toBe(GATE_CHECKS.length);
  });

  it('gives every population check a §H row, and invents none', () => {
    // `POPULATION_CHECK_DIAGNOSTIC` is typed `Record<PopulationCheckName, …>`, so the
    // compiler already refuses a missing entry. This is the other direction: an entry for
    // a check the reconciler never records would be a row nothing can reach.
    expect(Object.keys(POPULATION_CHECK_DIAGNOSTIC).sort()).toEqual(
      [...POPULATION_CHECK_NAMES].sort(),
    );
    for (const name of POPULATION_CHECK_NAMES) {
      expect(GATE_DIAGNOSTICS).toContain(POPULATION_CHECK_DIAGNOSTIC[name]);
    }
  });

  it('covers every per-Observation check with a §H row of its own', () => {
    // The six rows Stories 3.4 and 3.6 decide per Observation are rolled up, never
    // re-judged. Each has to land on a row: a per-Observation check with nowhere to roll
    // up to is a finding the Run-level Gate would silently drop.
    const rolled = new Set(GATE_CHECKS as readonly string[]);
    for (const check of OBSERVATION_CHECKS) {
      const row = check === 'freshness' ? 'observation-freshness' : check;
      expect(rolled.has(row)).toBe(true);
    }
  });
});

describe('the limit mapping', () => {
  it('never produces CANCELED, from any cause', () => {
    // CANCELED is reserved for a person cancelling a Run (Story 3.10). A timeout that
    // produced it would put a Run nobody cancelled into the one state whose whole meaning
    // is that somebody did.
    for (const cause of RUN_STOP_CAUSES) {
      expect(RUN_STOP_STATES).toContain(runStopFor(cause).state);
      expect(runStopFor(cause).state).not.toBe('CANCELED');
      expect(preservesPartialEvidence(cause)).toBe(true);
    }
    expect(RUN_STOP_STATES).not.toContain('CANCELED');
  });

  it('maps every Run-level limit to INCONCLUSIVE and every failure to RUN_FAILED', () => {
    expect(runStopFor('run-step-execution-limit')).toEqual({
      cause: 'run-step-execution-limit', state: 'INCONCLUSIVE', securityEvent: false,
    });
    expect(runStopFor('run-time-limit').state).toBe('INCONCLUSIVE');
    expect(runStopFor('run-token-limit').state).toBe('INCONCLUSIVE');
    expect(runStopFor('session-step-failed').state).toBe('RUN_FAILED');
    expect(runStopFor('integrity-mismatch').state).toBe('RUN_FAILED');
  });

  it('requires a security event for a denied action and a scope violation, and only those', () => {
    const security = RUN_STOP_CAUSES.filter((cause) => runStopFor(cause).securityEvent);
    expect([...security]).toEqual(['action-denied', 'scope-violation']);
    for (const cause of security) expect(runStopFor(cause).state).toBe('RUN_FAILED');
  });

  it('fails closed on a cause it does not know, without claiming a denial', () => {
    // `Object.hasOwn`: a cause read out of a stored diagnostic is request-shaped input, and
    // `TABLE['constructor']` is an inherited function.
    const unknown = runStopFor('constructor' as never);
    expect(unknown.state).toBe('RUN_FAILED');
    expect(unknown.securityEvent).toBe(false);
  });
});
