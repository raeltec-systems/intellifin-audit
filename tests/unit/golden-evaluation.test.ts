import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_OBSERVATION_FIELDS,
  exceptionFingerprint,
  findProcedureTemplate,
  includePopulation,
  initialDraftCompliance,
  reduceComplianceEvaluations,
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
}): Promise<Outcome> {
  const template = findProcedureTemplate(input.templateId);
  const populationRows = read(input.populationFile)[input.populationKey] as Record<string, JsonValue>[];
  const classified = includePopulation(populationRows, template.inclusionRule, PERIOD);
  const records: PopulationRecord[] = classified
    .filter((row) => row.disposition === 'included')
    .map((row) => ({ ordinal: row.ordinal, values: row.values }));

  const extractionRows = read(input.targetFile)[input.targetKey] as unknown[];
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
  };
}

interface ExpectationCase {
  readonly case_id: string;
  readonly record_key: string | null;
  readonly expected_record_evaluation?: EvaluationValue | null;
  readonly expected_diagnostic?: string;
  readonly reported_pairs?: readonly (readonly string[])[];
}

function expectations(file: string): readonly ExpectationCase[] {
  const parsed = read(file);
  expect(parsed['is_data_not_code']).toContain('DATA (AD-12)');
  const cases = parsed['cases'] as ExpectationCase[];
  // A directory or key read that silently returned nothing would make every case vacuous.
  expect(cases.length).toBeGreaterThan(10);
  return cases;
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
