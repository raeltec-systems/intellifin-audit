import type { JsonValue } from '../canonical-json.js';
import { COMPLIANCE_OBSERVATION_FIELDS } from '../procedures/plan-compiler.js';
import { isTemplateId, type TemplateId } from '../procedures/templates.js';
import { coverageFindings, GATE_AFFECTED_LIMIT, type CoverageObservation, type GateCheckName } from './gate.js';
import type { EvaluationConfirmation, EvaluationOrigin, EvaluationValue } from './observation.js';
import type { SystemOutcome } from './outcome.js';

/**
 * The published Result of one Run (Story 3.9).
 *
 * Pure. No I/O, no clock, no host types. It says WHAT a Run concluded and what it looked
 * at; `outcome.ts` says which addendum §E.1 row decided, and
 * `packages/application/src/runs/complete-run.ts` is the one transactional command that
 * computes both exactly once, in the transaction that completes the Run.
 *
 * Everything here is an EXACT total beside a bounded sample of identities. A Run over a
 * hundred thousand records has to be able to commit its own conclusion, and this document
 * is stored on the Result row and read onto a screen — the same discipline
 * `GATE_AFFECTED_LIMIT` imposes on the Gate's rows, for the same reason.
 *
 * There is no field here for a byte of Evidence, a credential reference or a captured page.
 * The control-specific fields are attribute VALUES the Template itself names, which is the
 * one place a captured value legitimately appears: §C says P-2 reports every prohibited
 * pair found and P-3 reports the approval decision and the approver limit, and a Result
 * that omitted them would be a conclusion an auditor cannot check.
 */

/** How many identities one list on the Result names. Exact totals sit beside them. */
export const RESULT_SAMPLE_LIMIT = GATE_AFFECTED_LIMIT;

/**
 * The control-specific fields each Template's Result reports (addendum §C).
 *
 * Transcribed from the §C block's own Compliant/Exception sentences: P-1 turns on
 * `account_status` and names `username` and `roles` as declared attributes, P-2 reports
 * the roles behind every prohibited pair, P-3 reports "the approval decision and the
 * approver limit", and P-4 compares the observed value with the approved baseline.
 *
 * Every name here is one the Template DECLARES (`COMPLIANCE_OBSERVATION_FIELDS`), which
 * `tests/unit/outcome-rules.test.ts` asserts: a field a Template does not declare is a
 * field no Observation carries and no rule reads, so reporting it would print an empty
 * cell forever.
 */
export const TEMPLATE_RESULT_FIELDS: Readonly<Record<TemplateId, readonly string[]>> = {
  'P-1': ['account_status', 'username', 'roles'],
  'P-2': ['roles'],
  'P-3': ['decision', 'approver_limit'],
  'P-4': ['observed_value', 'approved_value'],
};

/** The Template's control-specific field names, or none for a Template nobody declared. */
export function templateResultFields(templateId: string): readonly string[] {
  return isTemplateId(templateId) ? TEMPLATE_RESULT_FIELDS[templateId] : [];
}

/** The population of record, as the Result reports it. */
export interface RunResultPopulation {
  readonly rowsParsed: number;
  readonly included: number;
  readonly excluded: number;
  readonly indeterminate: number;
}

const NO_POPULATION: RunResultPopulation = {
  rowsParsed: 0,
  included: 0,
  excluded: 0,
  indeterminate: 0,
};

/**
 * One exclusion reason, with the exact number of rows excluded for it.
 *
 * §H requires that every exclusion carries a reason; this is where the reasons are
 * published. The reason text is the inclusion rule's own sentence, verbatim.
 */
export interface RunResultExclusion {
  readonly reason: string;
  readonly total: number;
  /** Bounded sample of the excluded rows, by ordinal (`#3`) or record key. */
  readonly records: readonly string[];
}

/**
 * Inspected and uninspected records for one Target System.
 *
 * `inspected` is the number of included population records whose Observation for this
 * system is `COVERED`. Everything else is uninspected: an `UNINSPECTED` absence, an
 * `AMBIGUOUS` match, and a record with no Observation at all — the last of which is the
 * one this count must never silently drop, because a record whose key the extraction
 * could not use is exactly the record an auditor needs to hear about.
 */
export interface RunResultCoverage {
  readonly targetSystem: string;
  readonly inspected: number;
  readonly uninspected: number;
  /** Bounded sample of the uninspected records, in included order. */
  readonly records: readonly string[];
}

/**
 * Per-condition counts, by origin and confirmation state (§B.1).
 *
 * One entry per `(conditionId, origin, confirmation, value)` the Run produced. Epic 3
 * produces `RULE` with a `null` confirmation only; the shape carries the other two origins
 * and the three confirmation states because §B.1 does, and a Result that could not report
 * an Agent-Judged count would need a schema change to grow one.
 */
export interface RunResultConditionCount {
  readonly conditionId: string;
  readonly origin: EvaluationOrigin;
  readonly confirmation: EvaluationConfirmation | null;
  readonly value: EvaluationValue;
  readonly total: number;
}

/**
 * One record the Result names: an Exception, or a record left Unevaluated.
 *
 * `fields` carries the Template's control-specific values for that record — the §C fields
 * — and `diagnostics` carries the compiled rules' own reasons, which for P-2 is where
 * "report every prohibited pair" lives. Both are read from what was stored, never
 * re-derived.
 */
export interface RunResultFinding {
  readonly populationRecordKey: string;
  readonly targetSystem: string;
  readonly value: Extract<EvaluationValue, 'EXCEPTION' | 'UNEVALUATED'>;
  readonly conditionIds: readonly string[];
  readonly diagnostics: readonly string[];
  readonly fields: Readonly<Record<string, JsonValue>>;
}

/** An exact total beside a bounded sample of the records behind it. */
export interface RunResultFindings {
  readonly total: number;
  readonly records: readonly RunResultFinding[];
}

/** What the Evidence package sealed with, as the Result names it (Story 3.5). */
export interface RunResultEvidence {
  readonly state: 'SEALED' | 'INCOMPLETE';
  readonly requiredTotal: number;
  readonly registered: number;
  readonly missingRequired: number;
  readonly abandoned: number;
}

/** The addendum §H verdict this Result reports, read from the Gate rows, never re-judged. */
export interface RunResultGate {
  readonly passed: boolean;
  readonly checks: number;
  readonly failed: readonly GateCheckName[];
}

export interface RunResultPublication {
  readonly templateId: string | null;
  readonly controlName: string | null;
  /**
   * The version's stored scope statement, VERBATIM.
   *
   * It is the auditor's own sentence about what the Run covered. Rewording it, truncating
   * it or generating a replacement would put the platform's words where a human's belong.
   * `null` means this build could not read the frozen plan — which is a different
   * statement from an empty scope, and the Result says which.
   */
  readonly scope: string | null;
  readonly period: { readonly from: string; readonly to: string };
  readonly population: RunResultPopulation;
  readonly exclusions: readonly RunResultExclusion[];
  readonly coverage: readonly RunResultCoverage[];
  readonly conditions: readonly RunResultConditionCount[];
  readonly exceptions: RunResultFindings;
  readonly unevaluated: RunResultFindings;
  /** The §C field names behind `RunResultFinding.fields`, so a reader knows the columns. */
  readonly controlFields: readonly string[];
  readonly gate: RunResultGate;
  readonly evidence: RunResultEvidence;
  readonly statement: string;
}

/**
 * The sentence each outcome publishes.
 *
 * A closed table, because a Result's own summary is not the place for a generated
 * paragraph: the auditor's sentence is the SCOPE, published verbatim above, and this one
 * says only what the platform concluded.
 */
export const RESULT_STATEMENTS: Readonly<Record<SystemOutcome, string>> = {
  CANCELED: 'The Run was canceled before it concluded.',
  RUN_FAILED: 'The Run could not complete, so it concluded nothing.',
  INCONCLUSIVE: 'The Evidence does not support a conclusion.',
  PENDING_CONFIRMATION: 'An Agent-Judged evaluation is waiting for a human decision.',
  CONTROL_FAILURE: 'At least one record failed a condition of this control.',
  PASS: 'Every condition on every inspected record is Compliant.',
};

/**
 * Said out loud whenever the population of record is empty.
 *
 * A zero-record Pass is a real outcome the version had to opt into, and the one thing it
 * must never look like is a Pass over records somebody inspected. "Every count is 0" is
 * arithmetic nobody reads; this is the sentence.
 */
export const NO_RECORD_INSPECTED = 'No record was inspected.';

export function resultStatement(outcome: SystemOutcome, population: RunResultPopulation): string {
  // `Object.hasOwn`: the outcome can be read back out of a stored row, and a plain index
  // on `'constructor'` returns an inherited function rather than nothing. Seventh time.
  const sentence = Object.hasOwn(RESULT_STATEMENTS, outcome) ? RESULT_STATEMENTS[outcome] : '';
  return population.included === 0 ? `${sentence} ${NO_RECORD_INSPECTED}` : sentence;
}

export interface RunResultInput {
  readonly outcome: SystemOutcome;
  readonly templateId: string | null;
  readonly controlName: string | null;
  readonly scope: string | null;
  readonly period: { readonly from: string; readonly to: string };
  readonly population: RunResultPopulation | null;
  readonly exclusions: readonly RunResultExclusion[];
  /** The Target Systems this Run had to cover, from the FROZEN plan's classification. */
  readonly requiredTargetSystems: readonly string[];
  /** The matching key of every INCLUDED population record, in source order. */
  readonly includedRecordKeys: readonly string[];
  readonly observations: readonly CoverageObservation[];
  readonly conditions: readonly RunResultConditionCount[];
  readonly exceptions: RunResultFindings;
  readonly unevaluated: RunResultFindings;
  readonly gate: RunResultGate;
  readonly evidence: RunResultEvidence;
}

/**
 * Project one Run's stored facts into the published Result.
 *
 * The coverage matrix is `coverageFindings` — the SAME function the Run-level Gate's
 * per-record coverage row is decided by, not a second walk over the same pairs. Two
 * implementations of one matrix agree on every case anybody thinks to try and diverge on
 * the first one nobody does, and here the divergence would be a Result that disagrees with
 * the Gate it reports.
 *
 * Excluded, uninspected and Unevaluated records are never counted Compliant, and there is
 * nothing here that could: the Compliant count is read from the stored per-condition
 * evaluations, and Story 3.4's composite foreign key already makes an uninspected or
 * contradicted record's `COMPLIANT` unstorable.
 */
export function publishRunResult(input: RunResultInput): RunResultPublication {
  const population = input.population ?? NO_POPULATION;
  const findings = coverageFindings({
    requiredTargetSystems: input.requiredTargetSystems,
    includedRecordKeys: input.includedRecordKeys,
    observations: input.observations,
  });
  const coverage = input.requiredTargetSystems.map((targetSystem): RunResultCoverage => {
    const uncovered = findings.filter((finding) => finding.targetSystem === targetSystem);
    return {
      targetSystem,
      inspected: input.includedRecordKeys.length - uncovered.length,
      uninspected: uncovered.length,
      // Deduplicated, exactly as the Gate's own `affected` lists are: a population that
      // carries one key twice produces two findings for the one cell, and naming the
      // record twice would read as two records. The COUNTS stay over rows, so
      // `inspected + uninspected` is `population.included` and an auditor can check it.
      records: [
        ...new Set(
          uncovered
            .map((finding) => finding.record)
            .filter((record): record is string => record !== null),
        ),
      ].slice(0, RESULT_SAMPLE_LIMIT),
    };
  });
  const fields = templateResultFields(input.templateId ?? '');
  const project = (entry: RunResultFindings): RunResultFindings => ({
    total: entry.total,
    records: entry.records.slice(0, RESULT_SAMPLE_LIMIT).map((finding) => ({
      ...finding,
      // Only the §C fields, and only where the Observation carried one. A Result that
      // published every attribute would publish the seeded prompt-like strings beside the
      // outcome they must never influence.
      fields: Object.fromEntries(
        fields
          .filter((name) => Object.hasOwn(finding.fields, name))
          .map((name) => [name, finding.fields[name] as JsonValue]),
      ),
    })),
  });
  return {
    templateId: input.templateId,
    controlName: input.controlName,
    scope: input.scope,
    period: { from: input.period.from, to: input.period.to },
    population,
    exclusions: input.exclusions.map((entry) => ({
      reason: entry.reason,
      total: entry.total,
      records: entry.records.slice(0, RESULT_SAMPLE_LIMIT),
    })),
    coverage,
    conditions: input.conditions,
    exceptions: project(input.exceptions),
    unevaluated: project(input.unevaluated),
    controlFields: fields,
    gate: input.gate,
    evidence: input.evidence,
    statement: resultStatement(input.outcome, population),
  };
}

/** Every Observation field a Template declares. Exported so the §C field list is checkable. */
export function declaredObservationFields(templateId: string): readonly string[] {
  return isTemplateId(templateId) ? Object.keys(COMPLIANCE_OBSERVATION_FIELDS[templateId]) : [];
}

/**
 * Whether a stored `publication` document is one this build can read.
 *
 * `run_result.publication` is `jsonb` and its CHECK says only that it is an object, so a
 * row written by an older build, by a fixture or by a psql session can hold a shape this
 * build's fields do not exist in — and a surface that reached into it would answer a
 * framework 500 for the whole Run. It is request-shaped input, exactly as the Evidence
 * seal's lists are.
 *
 * STRUCTURAL, not a re-derivation: it checks that the document has the members a reader
 * projects, never that the counts agree with anything. "The Result is internally
 * consistent" is a claim about what PUBLISHED it, and `publishRunResult` is where that
 * lives.
 */
export function isRunResultPublication(value: unknown): value is RunResultPublication {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  const population = document['population'];
  const period = document['period'];
  const gate = document['gate'];
  const evidence = document['evidence'];
  const counts = (entry: unknown, keys: readonly string[]): boolean =>
    typeof entry === 'object' &&
    entry !== null &&
    keys.every((key) => typeof (entry as Record<string, unknown>)[key] === 'number');
  const findings = (entry: unknown): boolean =>
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as { total?: unknown }).total === 'number' &&
    Array.isArray((entry as { records?: unknown }).records);
  return (
    typeof document['statement'] === 'string' &&
    counts(population, ['rowsParsed', 'included', 'excluded', 'indeterminate']) &&
    typeof period === 'object' &&
    period !== null &&
    typeof (period as { from?: unknown }).from === 'string' &&
    typeof (period as { to?: unknown }).to === 'string' &&
    Array.isArray(document['exclusions']) &&
    Array.isArray(document['coverage']) &&
    Array.isArray(document['conditions']) &&
    Array.isArray(document['controlFields']) &&
    findings(document['exceptions']) &&
    findings(document['unevaluated']) &&
    typeof gate === 'object' &&
    gate !== null &&
    typeof (gate as { passed?: unknown }).passed === 'boolean' &&
    typeof evidence === 'object' &&
    evidence !== null &&
    typeof (evidence as { state?: unknown }).state === 'string'
  );
}
