import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_OBSERVATION_FIELDS,
  POPULATION_CHECK_NAMES,
  RULE_DOES_NOT_NAME_VALUE,
  coverageFindings,
  exceptionFingerprint,
  findProcedureTemplate,
  includePopulation,
  initialDraftCompliance,
  populationFieldFindings,
  reduceComplianceEvaluations,
  runGateChecks,
  runGateDecision,
  systemOutcome,
  tallyGateFindings,
  utf8Bytes,
  type EvaluationValue,
  type ExecutablePlan,
  type JsonValue,
  type PopulationRow,
  type ProcedureTargetSnapshot,
  type RaisedException,
  type RunRecord,
  type TemplateId,
} from '@intellifin/domain';
import {
  OBSERVATION_CHECK_DIAGNOSTIC,
  buildAdapterObservations,
  parseExtractionRows,
  registerObservations,
  ruleEvaluation,
  snapshotCorroboration,
  type EvidenceState,
  type ExceptionFingerprinter,
  type ObservationCheckRow,
  type ObservationEvaluationRow,
  type ObservationRegistrationContext,
  type PopulationRecord,
  type RegisteredObservation,
  type StoredObservation,
} from '@intellifin/application';

/**
 * The golden populations, evaluated (Story 3.7).
 *
 * This is where the epic becomes checkable against expected outcomes rather than against
 * itself. The expectation files under `fixtures/northstar/expectations/` are DATA (AD-12):
 * runtime code may never import them, and this test reads them exactly as it reads the
 * datasets — off disk, as the contract they are.
 *
 * The pipeline exercised here is the production one, from the frozen inclusion rule
 * through `buildAdapterObservations`, `snapshotCorroboration`, `ruleEvaluation` and the one
 * transactional `registerObservations`. Only three things are stood in for: the HTTP
 * fetch (the served bytes are rebuilt from the same datasets the service reads, in the
 * same closed envelope), the object store (the corroboration seam is handed the bytes
 * directly, exactly as the stage hands it the bytes `freezeArtifact` returned) and
 * PostgreSQL (an in-memory context with the same insert semantics). What is NOT stood in
 * for is anything that decides an outcome.
 *
 * **If a case here disagrees with the implementation, the implementation is wrong.** The
 * expectations are frozen and the compiled rules are frozen; a disagreement is a finding.
 */

const PERIOD = { from: '2026-08-01', to: '2026-08-31' } as const;
const WORK_ITEM = '01920000-0000-7000-8000-00000000a001';
const STEP_EXECUTION = '01920000-0000-7000-8000-00000000b001';
const EVIDENCE = '01920000-0000-7000-8000-00000000c001';
const RUN_STARTED_AT = '2026-09-05T09:00:00.000Z';
const OBSERVED_AT = '2026-09-05T10:00:00.000Z';
const REGISTERED_AT = '2026-09-05T11:00:00.000Z';

const FINGERPRINT_KEY = 'golden-evaluation-fingerprint-key-000';
const FINGERPRINTER: ExceptionFingerprinter = {
  keyId: 'k-golden',
  fingerprint: (envelope) => exceptionFingerprint(utf8Bytes(FINGERPRINT_KEY), envelope),
};

function run(procedureId: string): RunRecord {
  return {
    runId: '01920000-0000-7000-8000-000000000001',
    correlationId: '01920000-0000-7000-8000-000000000002',
    procedureId,
    versionId: '01920000-0000-7000-8000-000000000004',
    versionNumber: 1,
    procedureName: 'Golden',
    period: { ...PERIOD },
    state: 'RUNNING',
    kind: 'STANDARD',
    initiatorId: 'auditor',
    sessionId: 'session',
    initiatedAt: '2026-09-01T00:00:00.000Z',
    authorizationRole: 'auditor',
    predecessorRunId: null,
    rerunReason: null,
    cancellation: null,
    requestToken: '01920000-0000-7000-8000-000000000005',
  };
}

/** The frozen plan, as far as this stage reads one: its Template and its compiled rules. */
function plan(templateId: TemplateId): ExecutablePlan {
  return {
    schemaVersion: 1,
    compilerVersion: '1',
    inputs: { templateId, ...initialDraftCompliance(templateId) },
    sessionSteps: [],
    targetSystems: [],
    observations: Object.entries(COMPLIANCE_OBSERVATION_FIELDS[templateId]).map(
      ([attributeName, valueType]) => ({ attributeName, valueType }),
    ),
    credentialReferences: [],
    limits: {
      retriesPerStep: 3, stepTimeoutSeconds: 120, runStepExecutions: 10000,
      runTimeoutSeconds: 3600, runTokens: 1000000,
    },
  } as unknown as ExecutablePlan;
}

const TARGET = { registrationId: 'northstar-target', displayName: 'Northstar' } as unknown as ProcedureTargetSnapshot;

function read(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/**
 * The CLOSED v1 collection envelope the Northstar service actually serves.
 *
 * A fixture that dropped a key the service really sends is how the closed envelope, once
 * written twice, judged every real extraction incomplete while every suite stayed green.
 * `complete` and `returned` are what make an absence a finding rather than a gap, so a
 * fabricated envelope here would decide P-3 case D2-a rather than observe it.
 */
function served(collection: string, items: readonly unknown[]): Uint8Array {
  return utf8Bytes(
    JSON.stringify({
      synthetic: { marker: 'SYNTHETIC-NORTHSTAR-FIXTURE' },
      schema_version: 1,
      representation: 'population-rows-v1',
      source: collection,
      title: collection,
      generation: '2026-09-01.1',
      generated_at: '2026-09-01T00:00:00.000Z',
      effective_period: { from: '2026-01-01', to: '2026-12-31' },
      schema: [],
      complete: true,
      returned: items.length,
      declared_count_endpoint: `/${collection}/count`,
      [collection]: items,
    }),
  );
}

/** The in-memory stand-in for the one registration transaction. Same insert semantics. */
class Context implements ObservationRegistrationContext {
  observations: RegisteredObservation[] = [];
  checks: ObservationCheckRow[] = [];
  evaluations: ObservationEvaluationRow[] = [];
  exceptions: RaisedException[] = [];
  events: { payload: Record<string, unknown> }[] = [];
  private sequence = 0;

  auditEvents = {
    append: async (draft: { payload: Record<string, unknown> }) => {
      this.sequence += 1;
      this.events.push({ payload: draft.payload });
      return { sequence: this.sequence } as never;
    },
  };

  readObservations = async (): Promise<readonly StoredObservation[]> => [];
  readEvidenceStates = async (ids: readonly string[]): Promise<readonly EvidenceState[]> =>
    ids.map((evidenceId) => ({ evidenceId, state: 'REGISTERED' as const }));
  saveObservations = async (rows: readonly RegisteredObservation[]) => {
    this.observations.push(...rows);
  };
  saveObservationChecks = async (rows: readonly ObservationCheckRow[]) => {
    this.checks.push(...rows);
  };
  saveObservationEvaluations = async (rows: readonly ObservationEvaluationRow[]) => {
    this.evaluations.push(...rows);
  };
  saveExceptions = async (rows: readonly RaisedException[]) => {
    this.exceptions.push(...rows);
  };
  notifyTimeline = async () => undefined;
}

interface Outcome {
  /** The reduced §B evaluation of each record, by population record key. */
  readonly verdicts: ReadonlyMap<string, EvaluationValue>;
  /** Every diagnostic recorded for a record, joined, by population record key. */
  readonly diagnostics: ReadonlyMap<string, string>;
  /** Every population row's disposition, in source order, so an absence can be explained. */
  readonly classified: readonly PopulationRow[];
  readonly context: Context;
  /** The declared schema of the population dataset, for the §H field rows. */
  readonly declaredSchema: readonly string[];
  readonly templateId: TemplateId;
}

/**
 * Run one golden population through the production pipeline and reduce it per record.
 *
 * `collection` is the population dataset's own key; `targetCollection` is the Target
 * System's, and for P-2 they are the same system read twice, which is exactly why its
 * duplicate account resolves to an ambiguous match.
 */
async function evaluate(input: {
  readonly templateId: TemplateId;
  readonly populationFile: string;
  readonly populationKey: string;
  readonly targetFile: string;
  readonly targetKey: string;
  readonly references: readonly { bytes: Uint8Array; mediaType: string }[];
  /**
   * The rows to bind, when the dataset does not publish exactly one population under
   * `populationKey`. `coredirectory-accounts.json` publishes two, and its extraction
   * endpoint lists both — which is the shape an identity store has and the shape P-2's
   * `must-appear` coverage rule is written for.
   */
  readonly populationRows?: readonly Record<string, JsonValue>[];
  readonly targetRows?: readonly unknown[];
}): Promise<Outcome> {
  const template = findProcedureTemplate(input.templateId);
  const dataset = read(input.populationFile);
  const declaredSchema = dataset['declared_schema'] as string[];
  const populationRows =
    input.populationRows ?? (dataset[input.populationKey] as Record<string, JsonValue>[]);
  const classified = includePopulation([...populationRows], template.inclusionRule, PERIOD);
  const records: PopulationRecord[] = classified
    .filter((row) => row.disposition === 'included')
    .map((row) => ({ ordinal: row.ordinal, values: row.values }));

  const extractionRows =
    input.targetRows ?? (read(input.targetFile)[input.targetKey] as unknown[]);
  const bytes = served(input.targetKey, extractionRows);
  const parsed = parseExtractionRows({ bytes, mediaType: 'application/json', location: 'https://synthetic.invalid' });
  const frozen = plan(input.templateId);
  const built = buildAdapterObservations({
    plan: frozen,
    target: TARGET,
    workItemId: WORK_ITEM,
    stepExecutionId: STEP_EXECUTION,
    evidenceId: EVIDENCE,
    collection: parsed.collection,
    rows: parsed.rows,
    records,
    observedAt: OBSERVED_AT,
    complete: parsed.complete,
  });

  const context = new Context();
  await registerObservations(
    context,
    {
      run: run(`procedure-${input.templateId}`),
      workItemId: WORK_ITEM,
      stepExecutionId: STEP_EXECUTION,
      targetSystem: TARGET.registrationId,
      templateId: input.templateId,
      runStartedAt: RUN_STARTED_AT,
      registeredAt: REGISTERED_AT,
      items: built.items,
    },
    {
      // The bytes the stage froze, judged by the one deterministic extractor.
      corroboration: snapshotCorroboration([{ evidenceId: EVIDENCE, substrate: 'json', bytes }]),
      evaluation: ruleEvaluation({ plan: frozen, records, references: input.references }),
      exceptions: FINGERPRINTER,
    },
  );

  const keyOf = new Map(
    context.observations.map((row) => [row.record.observationId, row.record.populationRecordKey]),
  );
  const values = new Map<string, EvaluationValue[]>();
  const reasons = new Map<string, string[]>();
  for (const row of context.evaluations) {
    const key = keyOf.get(row.observationId)!;
    values.set(key, [...(values.get(key) ?? []), row.evaluation.value]);
    if (row.evaluation.diagnostic !== null) {
      reasons.set(key, [...(reasons.get(key) ?? []), row.evaluation.diagnostic]);
    }
  }
  return {
    // The one reduction, the compiler's: Exception, then Unevaluated, then Compliant.
    verdicts: new Map([...values].map(([key, list]) => [key, reduceComplianceEvaluations(list)])),
    diagnostics: new Map([...reasons].map(([key, list]) => [key, list.join(' | ')])),
    classified,
    context,
    declaredSchema,
    templateId: input.templateId,
  };
}

/**
 * The terminal outcome one golden population reaches, through the real Gate and the real
 * §E.1 table.
 *
 * The Gate is run over what THIS pipeline produced — the coverage matrix from its own
 * Observations, and §H's population-field rows over its own classified rows — rather than
 * over a verdict typed beside it. The population reconciliation's own checks are supplied
 * as passing, because the datasets reconcile exactly: what makes these Runs Inconclusive
 * is what the golden data seeds, and a check failed by hand here would prove nothing.
 */
function terminalOutcome(outcome: Outcome): { readonly outcome: string; readonly failed: readonly string[] } {
  const included = outcome.classified.filter((row) => row.disposition === 'included');
  const unnamed = [...outcome.context.evaluations].filter((row) =>
    row.evaluation.diagnostic?.includes(RULE_DOES_NOT_NAME_VALUE) === true,
  );
  const results = runGateChecks({
    populationChecks: POPULATION_CHECK_NAMES.map((name) => ({ name, passed: true })),
    population: {
      rowsParsed: outcome.classified.length,
      included: included.length,
      excluded: outcome.classified.filter((row) => row.disposition === 'excluded').length,
      indeterminate: outcome.classified.filter((row) => row.disposition === 'indeterminate').length,
      unexplained: [],
    },
    snapshot: null,
    findings: [
      ...populationFieldFindings({
        templateId: outcome.templateId,
        declaredSchema: outcome.declaredSchema,
        allowVersionedDuplicates: false,
        rows: outcome.classified,
      }),
      ...tallyGateFindings(
        coverageFindings({
          requiredTargetSystems: [TARGET.registrationId],
          includedRecordKeys: outcome.context.observations.map(
            (row) => row.record.populationRecordKey,
          ),
          observations: outcome.context.observations.map((row) => ({
            targetSystem: row.record.targetSystem,
            populationRecordKey: row.record.populationRecordKey,
            coverage: row.coverage,
            workItemId: row.record.workItemId,
          })),
        }),
      ),
      // The six per-Observation rows, rolled up through the SAME table the command uses.
      ...tallyGateFindings(
        outcome.context.checks
          .filter((row) => row.outcome === 'FAIL')
          .map((row) => ({
            diagnostic: OBSERVATION_CHECK_DIAGNOSTIC[row.check],
            targetSystem: null,
            workItemId: null,
            record: row.observationId,
          })),
      ),
      ...(unnamed.length === 0
        ? []
        : [{ diagnostic: 'unnamed-value' as const, total: unnamed.length, targetSystems: [], workItems: [], records: [] }]),
    ],
  });
  const gate = runGateDecision(results);
  const values = [...outcome.context.evaluations].map((row) => row.evaluation.value);
  const decided = systemOutcome({
    runState: gate.state,
    gatePassed: gate.passed,
    // Epic 3 produces evaluations of origin RULE only: nothing is ever pending.
    pending: 0,
    unevaluated: values.filter((value) => value === 'UNEVALUATED').length,
    exceptions: outcome.context.exceptions.length,
  });
  return { outcome: decided.outcome, failed: gate.failed };
}

/** The addendum §E.1 outcome name each expectation file uses. */
const EXPECTED_OUTCOMES: Readonly<Record<string, string>> = {
  Pass: 'PASS',
  'Control Failure': 'CONTROL_FAILURE',
  Inconclusive: 'INCONCLUSIVE',
  'Run Failed': 'RUN_FAILED',
};

interface ExpectationCase {
  readonly case_id: string;
  readonly record_key: string | null;
  readonly expected_record_evaluation?: EvaluationValue | null;
  readonly expected_diagnostic?: string;
  readonly reported_pairs?: readonly (readonly string[])[];
}

function expectations(file: string, minimum = 11): readonly ExpectationCase[] {
  const parsed = read(file);
  expect(parsed['is_data_not_code']).toContain('DATA (AD-12)');
  const cases = parsed['cases'] as ExpectationCase[];
  // A directory or key read that silently returned nothing would make every case vacuous.
  expect(cases.length).toBeGreaterThanOrEqual(minimum);
  return cases;
}

/** The whole-population terminal outcome the expectation file names, read off disk. */
function expectedTerminalOutcome(file: string): string {
  const declared = (read(file)['run_expectation'] as { terminal_outcome: string }).terminal_outcome;
  expect(Object.hasOwn(EXPECTED_OUTCOMES, declared)).toBe(true);
  return EXPECTED_OUTCOMES[declared]!;
}

/** Cases that name a record. The rest describe configuration states, not rows. */
function perRecord(cases: readonly ExpectationCase[]): readonly ExpectationCase[] {
  return cases.filter((entry) => entry.record_key !== null);
}

describe('golden populations, evaluated', () => {
  it('P-2 Segregation-of-Duties matches every per-record expectation', async () => {
    const outcome = await evaluate({
      templateId: 'P-2',
      populationFile: 'fixtures/northstar/datasets/accessgate-accounts.json',
      populationKey: 'accounts',
      targetFile: 'fixtures/northstar/datasets/accessgate-accounts.json',
      targetKey: 'accounts',
      references: [
        {
          // The REAL served RoleMatrix, `entry` ordinal and all. A flattened
          // `role,permission` file unions AMBIGUOUS_DUAL into a prohibited pair and turns
          // case D5-c from Unevaluated into an Exception.
          bytes: new Uint8Array(readFileSync('fixtures/northstar/generated/role-matrix.csv')),
          mediaType: 'text/csv',
        },
      ],
    });

    const cases = perRecord(expectations('fixtures/northstar/expectations/p-2-sod-conflicts.json'));
    expect(cases).toHaveLength(11);
    for (const entry of cases) {
      const key = entry.record_key!;
      const verdict = outcome.verdicts.get(key);
      expect(verdict, `${entry.case_id} (${key})`).toBe(entry.expected_record_evaluation);
      if (entry.expected_diagnostic !== undefined) {
        expect(outcome.diagnostics.get(key) ?? '', `${entry.case_id} diagnostic`).toContain(
          entry.expected_diagnostic,
        );
      }
      for (const pair of entry.reported_pairs ?? []) {
        expect(outcome.diagnostics.get(key) ?? '', `${entry.case_id} pair`).toContain(
          `prohibited permission pair ${pair[0]!} + ${pair[1]!}`,
        );
      }
    }

    // The whole population, tallied. Every account is judged and none is missing.
    const tally = { COMPLIANT: 0, EXCEPTION: 0, UNEVALUATED: 0 };
    for (const value of outcome.verdicts.values()) tally[value] += 1;
    expect(tally).toEqual({ COMPLIANT: 4, EXCEPTION: 3, UNEVALUATED: 4 });
    // One Exception per failing record, and no others.
    expect(outcome.context.exceptions.map((raised) => raised.populationRecordKey).sort()).toEqual([
      'AG-1003', 'AG-1004', 'AG-1005',
    ]);

    // Story 3.9: the whole population, through the real Gate and the real §E.1 table, seals
    // at the terminal outcome the EXPECTATION FILE names. Three Exceptions are present and
    // the outcome is NOT Control Failure, because the Gate row sits above it: AG-1007 is
    // duplicated in the Source and its match is ambiguous, and AG-1006 carries a role the
    // RoleMatrix does not declare. A Pass reached by counting Exceptions alone is exactly
    // what the order of the table prevents.
    const sealed = terminalOutcome(outcome);
    expect(sealed.outcome).toBe(
      expectedTerminalOutcome('fixtures/northstar/expectations/p-2-sod-conflicts.json'),
    );
    expect(sealed.outcome).toBe('INCONCLUSIVE');
    expect([...sealed.failed].sort()).toEqual([
      'ambiguous-match', 'duplicate-primary-keys', 'per-record-coverage', 'unnamed-value',
    ]);
  });

  it('P-3 High-Value Transactions matches every per-record expectation', async () => {
    const outcome = await evaluate({
      templateId: 'P-3',
      populationFile: 'fixtures/northstar/datasets/ledgerflow-transactions.json',
      populationKey: 'transactions',
      targetFile: 'fixtures/northstar/datasets/approvenow-approvals.json',
      targetKey: 'approvals',
      references: [],
    });

    const cases = perRecord(expectations('fixtures/northstar/expectations/p-3-high-value-approvals.json'));
    expect(cases).toHaveLength(13);
    for (const entry of cases) {
      const key = entry.record_key!;
      const verdict = outcome.verdicts.get(key);
      if (entry.expected_record_evaluation === null || entry.expected_record_evaluation === undefined) {
        // TX-500010 (one cent under) and TX-500011 (not USD) are OUTSIDE the population.
        // Their correct treatment is absence, so nothing evaluated them at all.
        expect(verdict, `${entry.case_id} (${key}) must not be evaluated`).toBeUndefined();
        continue;
      }
      if (verdict === undefined) {
        // TX-500007 carries no processed_time, so the frozen inclusion rule cannot place
        // it in or out of the Period: Story 3.2 marks the row INDETERMINATE, it never
        // reaches an Observation, and the population Gate is what makes the Run
        // Inconclusive. "Never evaluated" is the honest reading of `UNEVALUATED` here, and
        // the assertion below pins that this is the ONLY case reached this way.
        expect(entry.record_key, `${entry.case_id} is unevaluated only by indeterminacy`).toBe('TX-500007');
        expect(entry.expected_record_evaluation).toBe('UNEVALUATED');
        // Said out loud, so this branch cannot quietly absorb a record that simply went
        // missing: the row IS in the dataset and the inclusion rule marked it
        // indeterminate for the reason the expectation gives.
        const row = outcome.classified.find((candidate) => candidate.values['transaction_id'] === key)!;
        expect(row.disposition).toBe('indeterminate');
        expect(row.reasons).toContain('Invalid date: processed_time');
        continue;
      }
      expect(verdict, `${entry.case_id} (${key})`).toBe(entry.expected_record_evaluation);
    }

    const tally = { COMPLIANT: 0, EXCEPTION: 0, UNEVALUATED: 0 };
    for (const value of outcome.verdicts.values()) tally[value] += 1;
    expect(tally).toEqual({ COMPLIANT: 3, EXCEPTION: 4, UNEVALUATED: 2 });
    expect(outcome.context.exceptions.map((raised) => raised.populationRecordKey).sort()).toEqual([
      'TX-500003', 'TX-500004', 'TX-500005', 'TX-500006',
    ]);

    // Story 3.9: four Exceptions, and still Inconclusive — TX-500007 carries no processed
    // time, TX-500008 is duplicated in the Source, and TX-500009's approval decisions
    // contradict each other. The expectation file names the outcome; the §E.1 order is
    // what makes the Gate row win over the four Control Failures underneath it.
    const sealed = terminalOutcome(outcome);
    expect(sealed.outcome).toBe(
      expectedTerminalOutcome('fixtures/northstar/expectations/p-3-high-value-approvals.json'),
    );
    expect(sealed.outcome).toBe('INCONCLUSIVE');
    expect(sealed.failed.length).toBeGreaterThan(0);
  });

  it('is checked against the real datasets, not a copy of them', () => {
    // The two traps this story exists to survive, asserted against the fixtures on disk so
    // that removing either from the DATA fails here rather than silently making the
    // implementation look right.
    const accounts = read('fixtures/northstar/datasets/accessgate-accounts.json')['accounts'] as
      { account_id: string; roles: string[] }[];
    const duplicated = accounts.filter((row) => row.account_id === 'AG-1007');
    expect(duplicated).toHaveLength(2);
    expect(duplicated[0]!.roles).not.toEqual(duplicated[1]!.roles);

    const matrix = readFileSync('fixtures/northstar/generated/role-matrix.csv', 'utf8');
    const ambiguous = matrix
      .split('\n')
      .filter((line) => line.includes('AMBIGUOUS_DUAL'))
      .map((line) => line.split(',')[0]);
    expect(new Set(ambiguous).size).toBe(2);

    const transactions = read('fixtures/northstar/datasets/ledgerflow-transactions.json')['transactions'] as
      { transaction_id: string; amount: string }[];
    expect(transactions.filter((row) => row.transaction_id === 'TX-500008')).toHaveLength(2);
    // The inclusive boundary the P-3 rule turns on.
    expect(transactions.find((row) => row.transaction_id === 'TX-500001')!.amount).toBe('100000.00');
  });
});

/* ------------------------------------------------- the clean source (Pass, Failure) --- */

interface CleanPopulation {
  readonly population_id: string;
  readonly accounts: readonly Record<string, JsonValue>[];
}

const CLEAN_DATASET = 'fixtures/northstar/datasets/coredirectory-accounts.json';

/** Every account of both published populations: what `/coredirectory/accounts` serves. */
function cleanExtraction(): readonly Record<string, JsonValue>[] {
  return (read(CLEAN_DATASET)['populations'] as CleanPopulation[]).flatMap(
    (group) => group.accounts,
  );
}

function cleanPopulation(populationId: string): readonly Record<string, JsonValue>[] {
  const group = (read(CLEAN_DATASET)['populations'] as CleanPopulation[]).find(
    (candidate) => candidate.population_id === populationId,
  );
  expect(group, `${populationId} is not published by ${CLEAN_DATASET}`).toBeDefined();
  return group!.accounts;
}

const ROLE_MATRIX = [
  {
    // The REAL served bytes, entry ordinals and all — the same Reference Source the
    // golden P-2 Run freezes. A second copy would be a second source of truth for one
    // expansion, and the two would agree on every role anybody thought to try.
    bytes: new Uint8Array(readFileSync('fixtures/northstar/generated/role-matrix.csv')),
    mediaType: 'text/csv',
  },
];

/**
 * The two outcomes no golden population can produce, and why they need their own source.
 *
 * `accessgate-accounts.json` lists AG-1007 twice and `ledgerflow-transactions.json`
 * carries a transaction with no processed time. §H counts duplicate Source primary keys
 * over EVERY parsed row and counts every row the inclusion rule could not place, so both
 * read the SOURCE rather than the included set: no scope and no inclusion rule escapes
 * either, and a failed §H row is Inconclusive. That is the golden datasets working as
 * designed — a dataset that seeds every failure mode at once cannot also be the dataset
 * that demonstrates success.
 *
 * `coredirectory-accounts.json` seeds exactly one thing, in one of its two populations,
 * so the two Runs below differ by a single role on a single account. Everything else —
 * schema, period, cover-sheet generation, extraction endpoint, Reference Source — is the
 * same, which is what makes the difference in outcome attributable.
 *
 * This is the one-second half of the proof. `tests/e2e/clean-source.spec.ts` runs both
 * Procedures through the real worker, against the real synthetic service, a real
 * PostgreSQL and a real object store, and asserts what each Run actually STORED against
 * these same expectation files.
 */
describe('the clean source, evaluated', () => {
  it('reaches Pass when no record carries a prohibited pair', async () => {
    const outcome = await evaluate({
      templateId: 'P-2',
      populationFile: CLEAN_DATASET,
      populationKey: 'populations',
      populationRows: cleanPopulation('coredirectory-accounts-compliant'),
      targetFile: CLEAN_DATASET,
      targetKey: 'accounts',
      targetRows: cleanExtraction(),
      references: ROLE_MATRIX,
    });

    const file = 'fixtures/northstar/expectations/clean-pass.json';
    const cases = perRecord(expectations(file, 4));
    expect(cases).toHaveLength(4);
    for (const entry of cases) {
      expect(outcome.verdicts.get(entry.record_key!), `${entry.case_id} (${entry.record_key!})`)
        .toBe(entry.expected_record_evaluation);
    }
    const tally = { COMPLIANT: 0, EXCEPTION: 0, UNEVALUATED: 0 };
    for (const value of outcome.verdicts.values()) tally[value] += 1;
    expect(tally).toEqual({ COMPLIANT: 4, EXCEPTION: 0, UNEVALUATED: 0 });
    expect(outcome.context.exceptions).toEqual([]);

    const sealed = terminalOutcome(outcome);
    // The failing set is asserted EMPTY, and it is asserted before the outcome: a Pass
    // reached by weakening a §H row is not a Pass, and this is the assertion that says so.
    expect([...sealed.failed]).toEqual([]);
    expect(sealed.outcome).toBe(expectedTerminalOutcome(file));
    expect(sealed.outcome).toBe('PASS');
  });

  it('reaches Control Failure on one record, with the Gate still passing', async () => {
    const outcome = await evaluate({
      templateId: 'P-2',
      populationFile: CLEAN_DATASET,
      populationKey: 'populations',
      populationRows: cleanPopulation('coredirectory-accounts-conflict'),
      targetFile: CLEAN_DATASET,
      targetKey: 'accounts',
      targetRows: cleanExtraction(),
      references: ROLE_MATRIX,
    });

    const file = 'fixtures/northstar/expectations/clean-control-failure.json';
    const cases = perRecord(expectations(file, 4));
    expect(cases).toHaveLength(4);
    for (const entry of cases) {
      const key = entry.record_key!;
      expect(outcome.verdicts.get(key), `${entry.case_id} (${key})`).toBe(
        entry.expected_record_evaluation,
      );
      for (const pair of entry.reported_pairs ?? []) {
        expect(outcome.diagnostics.get(key) ?? '', `${entry.case_id} pair`).toContain(
          `prohibited permission pair ${pair[0]!} + ${pair[1]!}`,
        );
      }
    }
    const tally = { COMPLIANT: 0, EXCEPTION: 0, UNEVALUATED: 0 };
    for (const value of outcome.verdicts.values()) tally[value] += 1;
    expect(tally).toEqual({ COMPLIANT: 3, EXCEPTION: 1, UNEVALUATED: 0 });
    expect(outcome.context.exceptions.map((raised) => raised.populationRecordKey)).toEqual([
      'CD-3103',
    ]);

    const sealed = terminalOutcome(outcome);
    // §E.1 row 3 sits ABOVE row 6, so a Control Failure is only reachable through a
    // PASSING Gate. The golden P-2 Run proves that ordering from the Inconclusive side —
    // three real Exceptions, still Inconclusive — and this proves it from the other.
    expect([...sealed.failed]).toEqual([]);
    expect(sealed.outcome).toBe(expectedTerminalOutcome(file));
    expect(sealed.outcome).toBe('CONTROL_FAILURE');
  });

  it('differs from the Pass population by exactly one role on one account', () => {
    // Asserted against the DATA on disk. If the two populations ever diverge in any other
    // way, the pair of outcomes above stops being attributable to the conflict.
    const compliant = cleanPopulation('coredirectory-accounts-compliant');
    const conflict = cleanPopulation('coredirectory-accounts-conflict');
    expect(compliant).toHaveLength(4);
    expect(conflict).toHaveLength(4);
    const shapeOf = (rows: readonly Record<string, JsonValue>[]): string[] =>
      rows.map((row) => JSON.stringify([row['status'], row['disabled_time'], row['roles']]));
    // Row for row, the two populations hold the same status, the same empty disabled_time
    // and the same role lists — except the third, where VENDOR_APPROVER is added.
    expect(shapeOf(compliant).map((entry, index) => entry === shapeOf(conflict)[index])).toEqual([
      true, false, false, true,
    ]);
    expect(compliant[2]!['roles']).toEqual(['VENDOR_MAINTAINER']);
    expect(conflict[2]!['roles']).toEqual(['VENDOR_MAINTAINER', 'VENDOR_APPROVER']);
    // The extraction lists every account of both, which is what `must-appear` needs.
    const extraction = new Set(cleanExtraction().map((row) => String(row['account_id'])));
    for (const row of [...compliant, ...conflict]) {
      expect(extraction.has(String(row['account_id'])), String(row['account_id'])).toBe(true);
    }
  });
});
