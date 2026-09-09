import { describe, expect, it } from 'vitest';

import {
  GATE_AFFECTED_LIMIT,
  GATE_CHECKS,
  GATE_DIAGNOSTICS,
  coverageFindings,
  populationFieldFindings,
  runGateChecks,
  runGateDecision,
  snapshotFreshness,
  tallyGateFindings,
  type GateCheckName,
  type GateCheckResult,
  type GateDiagnostic,
  type GateFindingTally,
  type PopulationGateRow,
  type RunGateFacts,
} from './gate.js';
import { POPULATION_CHECK_NAMES, type PopulationCheck } from './population.js';

/**
 * The Run-level §H Gate, row by row.
 *
 * `tests/unit/gate-vocabulary.test.ts` pins the vocabulary against the addendum ON DISK;
 * this file pins the DECISION. Every row is driven to `FAIL` from the fact that is supposed
 * to fail it and to `PASS` from a Run that has nothing wrong with it, so a row wired to the
 * wrong fact — or to none — is a failing test rather than a Gate that never fires.
 */

const PASSING_POPULATION: readonly PopulationCheck[] = POPULATION_CHECK_NAMES.map((name) => ({
  name,
  passed: true,
}));

/** A Run with nothing wrong with it: every §H row passes. */
function clean(overrides: Partial<RunGateFacts> = {}): RunGateFacts {
  return {
    populationChecks: PASSING_POPULATION,
    population: { rowsParsed: 3, included: 2, excluded: 1, indeterminate: 0, unexplained: [] },
    snapshot: {
      generatedAt: '2026-09-01T00:00:00.000Z',
      periodTo: '2026-08-31',
      initiatedAt: '2026-09-02T00:00:00.000Z',
    },
    findings: [],
    ...overrides,
  };
}

function row(results: readonly GateCheckResult[], check: GateCheckName): GateCheckResult {
  const found = results.find((result) => result.check === check);
  expect(found, `no ${check} row`).toBeDefined();
  return found!;
}

function finding(diagnostic: GateDiagnostic, total = 1): GateFindingTally {
  return { diagnostic, total, targetSystems: [], workItems: [], records: [] };
}

describe('runGateChecks', () => {
  it('evaluates every §H row, even the ones that found nothing', () => {
    const results = runGateChecks(clean());
    expect(results.map((result) => result.check)).toEqual([...GATE_CHECKS]);
    expect(results.every((result) => result.outcome === 'PASS')).toBe(true);
    expect(results.every((result) => result.diagnostics.length === 0)).toBe(true);
    expect(runGateDecision(results)).toEqual({ passed: true, state: 'COMPLETED', failed: [] });
  });

  it('drives every diagnostic onto its own row, and only that row', () => {
    // The mutation guard for the routing table: with any diagnostic mapped to the wrong
    // row, some row fails that should not, or the intended row passes.
    for (const diagnostic of GATE_DIAGNOSTICS) {
      const results = runGateChecks(clean({ findings: [finding(diagnostic)] }));
      const failing = results.filter((result) => result.outcome === 'FAIL');
      expect(failing.map((result) => result.check), diagnostic).toHaveLength(1);
      expect(failing[0]!.diagnostics).toEqual([diagnostic]);
    }
  });

  it('routes every failing population check onto a §H row', () => {
    for (const name of POPULATION_CHECK_NAMES) {
      const results = runGateChecks(
        clean({
          populationChecks: PASSING_POPULATION.map((check) =>
            check.name === name ? { name, passed: false } : check,
          ),
          // `complete-inclusion` is recorded as `indeterminate === 0`, so the state in
          // which the reconciler writes `false` is a state in which the counts carry an
          // indeterminate row. Both are supplied together because both are what really
          // happens; the row itself is decided by the counts (see the test below).
          ...(name === 'complete-inclusion'
            ? { population: { rowsParsed: 3, included: 2, excluded: 0, indeterminate: 1, unexplained: [] } }
            : {}),
        }),
      );
      expect(
        results.some((result) => result.outcome === 'FAIL'),
        `population check ${name} failed nothing`,
      ).toBe(true);
    }
  });

  it('counts ONE unaccounted row once, whatever the stored check also said', () => {
    // The recorded `complete-inclusion` boolean and the arithmetic below it say the same
    // thing, so routing the boolean AND recomputing the counts would report two unaccounted
    // rows where the population has one. `total` is exact and is what the Result shows.
    const population = { rowsParsed: 3, included: 2, excluded: 0, indeterminate: 1, unexplained: [] };
    const stored = runGateChecks(
      clean({
        population,
        populationChecks: PASSING_POPULATION.map((check) =>
          check.name === 'complete-inclusion' ? { name: check.name, passed: false } : check,
        ),
      }),
    );
    const reconciliation = row(stored, 'count-reconciliation-inclusion');
    expect(reconciliation.outcome).toBe('FAIL');
    expect(reconciliation.diagnostics).toEqual(['rows-unaccounted']);
    expect(reconciliation.affected.total).toBe(1);
    // And the Run is INCONCLUSIVE, which is the outcome an indeterminate row must reach
    // whether it is decided at acquisition or, as it now is, at the Run-level Gate.
    expect(runGateDecision(stored)).toMatchObject({
      passed: false,
      state: 'INCONCLUSIVE',
      failed: ['count-reconciliation-inclusion'],
    });
  });

  it('treats a Run with no population reconciliation as an acquisition that could not complete', () => {
    const results = runGateChecks(clean({ populationChecks: null, population: null, snapshot: null }));
    const acquisition = row(results, 'population-acquisition');
    expect(acquisition.outcome).toBe('FAIL');
    expect(acquisition.diagnostics).toEqual(['acquisition-incomplete']);
    // §H makes that RUN_FAILED, not INCONCLUSIVE: the Run concluded against nothing.
    expect(runGateDecision(results).state).toBe('RUN_FAILED');
  });

  it('counts rows that inclusion did not account for', () => {
    const results = runGateChecks(
      clean({ population: { rowsParsed: 5, included: 2, excluded: 1, indeterminate: 0, unexplained: [] } }),
    );
    const reconciliation = row(results, 'count-reconciliation-inclusion');
    expect(reconciliation.outcome).toBe('FAIL');
    expect(reconciliation.diagnostics).toEqual(['rows-unaccounted']);
    expect(reconciliation.affected.total).toBe(2);
  });

  it('names an exclusion carrying no reason', () => {
    const results = runGateChecks(
      clean({ population: { rowsParsed: 3, included: 2, excluded: 1, indeterminate: 0, unexplained: [3] } }),
    );
    const reconciliation = row(results, 'count-reconciliation-inclusion');
    expect(reconciliation.diagnostics).toEqual(['exclusion-reason-missing']);
    expect(reconciliation.affected.records).toEqual(['#3']);
  });

  it('lets RUN_FAILED outrank INCONCLUSIVE', () => {
    const results = runGateChecks(
      clean({ findings: [finding('record-uncovered'), finding('integrity-mismatch')] }),
    );
    const decision = runGateDecision(results);
    expect(decision.state).toBe('RUN_FAILED');
    expect(decision.failed).toEqual(['per-record-coverage', 'integrity']);
  });

  it('never lets a PASS carry a diagnostic, or a FAIL carry none', () => {
    const results = runGateChecks(clean({ findings: [finding('record-ambiguous')] }));
    for (const result of results) {
      expect(result.outcome === 'PASS').toBe(result.diagnostics.length === 0);
    }
  });

  it('keeps the exact total while bounding the identities it names', () => {
    const records = Array.from({ length: 200 }, (_, index) => `R-${String(index)}`);
    const results = runGateChecks(
      clean({
        findings: [
          { diagnostic: 'record-uncovered', total: 200, targetSystems: [], workItems: [], records },
        ],
      }),
    );
    const coverage = row(results, 'per-record-coverage');
    expect(coverage.affected.total).toBe(200);
    expect(coverage.affected.records).toHaveLength(GATE_AFFECTED_LIMIT);
  });
});

describe('snapshotFreshness', () => {
  const period = { periodTo: '2026-08-31', initiatedAt: '2026-09-02T00:00:00.000Z' };

  it('accepts a snapshot generated after the period and before Run initiation', () => {
    expect(snapshotFreshness({ ...period, generatedAt: '2026-09-01T00:00:00.000Z' })).toBeNull();
  });

  it('names a snapshot generated before the END of the effective period', () => {
    // Mid-period, not before the period: a snapshot taken on the last DAY still has to be
    // taken after the last MOMENT of it, or it cannot cover the period.
    expect(snapshotFreshness({ ...period, generatedAt: '2026-08-31T12:00:00.000Z' })).toBe(
      'snapshot-stale',
    );
  });

  it('names a snapshot generated after Run initiation', () => {
    expect(snapshotFreshness({ ...period, generatedAt: '2026-09-03T00:00:00.000Z' })).toBe(
      'snapshot-future-dated',
    );
  });

  it('names an absent or unreadable generation time rather than passing it', () => {
    expect(snapshotFreshness({ ...period, generatedAt: null })).toBe('snapshot-generation-unknown');
    expect(snapshotFreshness({ ...period, generatedAt: 'yesterday' })).toBe(
      'snapshot-generation-unknown',
    );
    // V8 rolls an impossible calendar date over rather than refusing it; this must not
    // become a snapshot silently dated two days later.
    expect(snapshotFreshness({ ...period, generatedAt: '2026-02-30T00:00:00.000Z' })).toBe(
      'snapshot-generation-unknown',
    );
  });

  it('makes an unknown generation time INCONCLUSIVE at the Gate', () => {
    const results = runGateChecks(
      clean({ snapshot: { generatedAt: null, periodTo: '2026-08-31', initiatedAt: '2026-09-02T00:00:00.000Z' } }),
    );
    expect(row(results, 'snapshot-freshness').diagnostics).toEqual(['snapshot-generation-unknown']);
    expect(runGateDecision(results).state).toBe('INCONCLUSIVE');
  });
});

describe('coverageFindings', () => {
  const observation = (key: string, coverage: 'COVERED' | 'UNINSPECTED' | 'AMBIGUOUS') => ({
    targetSystem: 'reg-api',
    populationRecordKey: key,
    coverage,
    workItemId: 'wi-1',
  });

  it('passes when every included record is COVERED for every required Target System', () => {
    expect(
      coverageFindings({
        requiredTargetSystems: ['reg-api'],
        includedRecordKeys: ['A', 'B'],
        observations: [observation('A', 'COVERED'), observation('B', 'COVERED')],
      }),
    ).toEqual([]);
  });

  it('names a record with no Observation at all', () => {
    const findings = coverageFindings({
      requiredTargetSystems: ['reg-api'],
      includedRecordKeys: ['A', 'B'],
      observations: [observation('A', 'COVERED')],
    });
    expect(findings).toEqual([
      { diagnostic: 'record-uncovered', targetSystem: 'reg-api', workItemId: null, record: 'B' },
    ]);
  });

  it('separates an uninspected record from an ambiguous one', () => {
    const findings = coverageFindings({
      requiredTargetSystems: ['reg-api'],
      includedRecordKeys: ['A', 'B'],
      observations: [observation('A', 'UNINSPECTED'), observation('B', 'AMBIGUOUS')],
    });
    expect(findings.map((entry) => entry.diagnostic)).toEqual([
      'record-uninspected',
      'record-ambiguous',
    ]);
  });

  it('does not collide two cells whose halves concatenate the same way', () => {
    // A record key is arbitrary text, so a concatenated key would make ("reg a","b") and
    // ("reg","a b") one cell — and the coverage matrix would report a record covered by an
    // Observation about a different one. Two parts, canonicalized, never a concatenation.
    const findings = coverageFindings({
      requiredTargetSystems: ['reg a'],
      includedRecordKeys: ['b'],
      observations: [{ targetSystem: 'reg', populationRecordKey: 'a b', coverage: 'COVERED', workItemId: 'wi-1' }],
    });
    expect(findings).toEqual([
      { diagnostic: 'record-uncovered', targetSystem: 'reg a', workItemId: null, record: 'b' },
    ]);
  });

  it('requires coverage from EVERY required Target System, not just one', () => {
    const findings = coverageFindings({
      requiredTargetSystems: ['reg-a', 'reg-b'],
      includedRecordKeys: ['A'],
      observations: [{ ...observation('A', 'COVERED'), targetSystem: 'reg-a' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetSystem: 'reg-b', record: 'A' });
  });
});

describe('populationFieldFindings', () => {
  const base = {
    templateId: 'P-2',
    declaredSchema: ['account_id', 'status'],
    allowVersionedDuplicates: false,
  };
  const rows = (values: readonly Record<string, string>[]): readonly PopulationGateRow[] =>
    values.map((entry, index) => ({
      ordinal: index + 1,
      values: entry,
      disposition: 'included' as const,
    }));

  const diagnostics = (result: readonly GateFindingTally[]): string[] =>
    result.map((entry) => entry.diagnostic);

  it('finds nothing in a well-formed population', () => {
    expect(
      populationFieldFindings({
        ...base,
        rows: rows([
          { account_id: 'AG-1', status: 'Active' },
          { account_id: 'AG-2', status: 'Active' },
        ]),
      }),
    ).toEqual([]);
  });

  it('names an empty mandatory identifier', () => {
    const found = populationFieldFindings({
      ...base,
      rows: rows([{ account_id: '', status: 'Active' }]),
    });
    expect(diagnostics(found)).toContain('mandatory-identifier-empty');
    expect(found.find((entry) => entry.diagnostic === 'mandatory-identifier-empty')?.records).toEqual([
      '#1',
    ]);
  });

  it('names a duplicate Source primary key, and honours the version opt-in', () => {
    const duplicated = rows([
      { account_id: 'AG-1', status: 'Active' },
      { account_id: 'AG-1', status: 'Disabled' },
    ]);
    const found = populationFieldFindings({ ...base, rows: duplicated });
    expect(diagnostics(found)).toEqual(['duplicate-primary-key']);
    expect(found[0]!.records).toEqual(['AG-1']);
    expect(
      populationFieldFindings({ ...base, allowVersionedDuplicates: true, rows: duplicated }),
    ).toEqual([]);
  });

  it('counts a duplicate the inclusion rule filtered out', () => {
    // §H says "No duplicate Source primary key", full stop: two Source rows claiming one
    // identity are two, whether or not inclusion kept both.
    const found = populationFieldFindings({
      ...base,
      rows: [
        { ordinal: 1, values: { account_id: 'AG-1', status: 'Active' }, disposition: 'included' },
        { ordinal: 2, values: { account_id: 'AG-1', status: 'Closed' }, disposition: 'excluded' },
      ],
    });
    expect(diagnostics(found)).toEqual(['duplicate-primary-key']);
  });

  it('names a field the binding never declared, and a declared field a row does not carry', () => {
    const found = populationFieldFindings({
      ...base,
      rows: rows([{ account_id: 'AG-1', surprise: 'x' }]),
    });
    // `status` is a declared Observation field AND a declared schema field, so the row that
    // does not carry it fails the mandatory-values row as well as the schema row. Two §H
    // rows about one defect is the addendum's own shape, not a double count.
    expect(diagnostics(found).sort()).toEqual([
      'mandatory-value-missing',
      'schema-field-missing',
      'schema-field-undeclared',
    ]);
    expect(found.find((entry) => entry.diagnostic === 'schema-field-missing')?.records).toEqual([
      'status',
    ]);
    expect(found.find((entry) => entry.diagnostic === 'schema-field-undeclared')?.records).toEqual([
      'surprise',
    ]);
  });

  it('names an unparseable timestamp in a declared evaluation field', () => {
    const found = populationFieldFindings({
      templateId: 'P-3',
      declaredSchema: ['transaction_id', 'amount', 'currency', 'processed_time'],
      allowVersionedDuplicates: false,
      rows: rows([
        {
          transaction_id: 'TX-1',
          amount: '10.00',
          currency: 'USD',
          processed_time: 'the fourteenth',
        },
      ]),
    });
    expect(diagnostics(found)).toContain('timestamp-unparseable');
    expect(found.find((entry) => entry.diagnostic === 'timestamp-unparseable')?.records).toEqual([
      'TX-1',
    ]);
  });

  it('names a missing mandatory evaluation value only for an INCLUDED record', () => {
    const shape = {
      templateId: 'P-3',
      declaredSchema: ['transaction_id', 'amount', 'currency', 'processed_time'],
      allowVersionedDuplicates: false,
    };
    const values = {
      transaction_id: 'TX-1', amount: '', currency: 'USD', processed_time: '2026-08-01T00:00:00Z',
    };
    expect(
      diagnostics(populationFieldFindings({ ...shape, rows: rows([values]) })),
    ).toContain('mandatory-value-missing');
    // An excluded row was excluded on a rule that already read what it needed.
    expect(
      diagnostics(
        populationFieldFindings({
          ...shape,
          rows: [{ ordinal: 1, values, disposition: 'excluded' }],
        }),
      ),
    ).not.toContain('mandatory-value-missing');
  });

  it('requires only the declared Observation fields the population itself declared', () => {
    // `COMPLIANCE_OBSERVATION_FIELDS['P-3']` is the union across the population AND the
    // approvals system: `decision` lives in the Target System. Requiring it of a population
    // row would fail a correct Run — the `required-evidence` trap one layer along.
    expect(
      populationFieldFindings({
        templateId: 'P-3',
        declaredSchema: ['transaction_id', 'amount', 'currency', 'processed_time'],
        allowVersionedDuplicates: false,
        rows: rows([
          {
            transaction_id: 'TX-1', amount: '10.00', currency: 'USD',
            processed_time: '2026-08-01T00:00:00Z',
          },
        ]),
      }),
    ).toEqual([]);
  });

  it('does not require an approved value for a valid prohibited P-4 baseline row', () => {
    const shape = {
      templateId: 'P-4',
      declaredSchema: ['parameter', 'approved_value', 'effective_time', 'disposition'],
      allowVersionedDuplicates: false,
    } as const;
    const prohibited = {
      parameter: 'legacy_direct_db_access',
      approved_value: '',
      effective_time: '2026-01-01T00:00:00Z',
      disposition: 'prohibited',
    };
    expect(populationFieldFindings({ ...shape, rows: rows([prohibited]) })).toEqual([]);

    // The exemption is specific to the exact prohibited disposition. An empty approved
    // value on an approved row, or beside a malformed disposition, remains a Gate failure.
    for (const disposition of ['approved', 'unsupported']) {
      const findings = populationFieldFindings({
        ...shape,
        rows: rows([{ ...prohibited, disposition }]),
      });
      expect(diagnostics(findings)).toContain('mandatory-value-missing');
    }

    // A missing column still fails the schema row even when the disposition is prohibited;
    // this only exempts the semantic empty cell, never a missing field.
    const missingColumn = { ...prohibited } as Record<string, string>;
    delete missingColumn.approved_value;
    expect(
      diagnostics(populationFieldFindings({ ...shape, rows: rows([missingColumn]) })),
    ).toContain('schema-field-missing');
  });

  it('judges nothing at all for a Template this build does not know', () => {
    expect(
      populationFieldFindings({
        templateId: 'P-99',
        declaredSchema: [],
        allowVersionedDuplicates: false,
        rows: rows([{ whatever: 'x' }]),
      }).map((entry) => entry.diagnostic),
      // No lookup column, no declared fields: only the schema rule can speak, and an empty
      // declared schema makes every field undeclared.
    ).toEqual(['schema-field-undeclared']);
  });
});

describe('tallyGateFindings', () => {
  it('keeps the exact total and a bounded, duplicate-free sample', () => {
    const findings = Array.from({ length: 100 }, (_, index) => ({
      diagnostic: 'record-uncovered' as const,
      targetSystem: 'reg-api',
      workItemId: 'wi-1',
      record: `R-${String(index)}`,
    }));
    const [tally] = tallyGateFindings(findings);
    expect(tally?.total).toBe(100);
    expect(tally?.records).toHaveLength(GATE_AFFECTED_LIMIT);
    // One system and one Work Item across a hundred findings is named once.
    expect(tally?.targetSystems).toEqual(['reg-api']);
    expect(tally?.workItems).toEqual(['wi-1']);
  });

  it('refuses a diagnostic the vocabulary does not name, at the one place findings enter', () => {
    // `isGateDiagnostic` is where an unroutable diagnostic is stopped, and it is stopped
    // HERE rather than at the router because this is the only place a finding is built
    // from something that is not a literal. `GATE_DIAGNOSTIC_ROW['constructor']` is an
    // inherited function, so a finding that got past this would key the row map by
    // something no §H row matches and vanish with the Gate reporting a clean pass.
    const tallies = tallyGateFindings([
      { diagnostic: 'constructor' as GateDiagnostic, targetSystem: null, workItemId: null, record: null },
      { diagnostic: 'toString' as GateDiagnostic, targetSystem: null, workItemId: null, record: null },
      { diagnostic: 'population-empty', targetSystem: null, workItemId: null, record: null },
    ]);
    expect(tallies.map((entry) => entry.diagnostic)).toEqual(['population-empty']);
  });

  it('returns tallies in vocabulary order, whatever order the findings arrive in', () => {
    const tallies = tallyGateFindings([
      { diagnostic: 'integrity-mismatch', targetSystem: null, workItemId: null, record: null },
      { diagnostic: 'population-empty', targetSystem: null, workItemId: null, record: null },
    ]);
    expect(tallies.map((entry) => entry.diagnostic)).toEqual([
      'population-empty',
      'integrity-mismatch',
    ]);
  });
});
