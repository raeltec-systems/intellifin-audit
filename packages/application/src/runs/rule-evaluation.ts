import {
  adapterLookupColumn,
  evaluableTemplateId,
  evaluateObservationRecord,
  roleExpansionFrom,
  NO_ROLE_EXPANSION,
  type ExecutablePlan,
  type JsonValue,
  type ReferenceArtifact,
  type RoleExpansion,
} from '@intellifin/domain';
import type {
  ObservationEvaluationPort,
  ObservationEvaluationResult,
  ObservationEvaluationSubject,
  PopulationRecord,
} from './execution-ports.js';

/**
 * Story 3.7's seam, filled: the version's already-compiled conditions, evaluated over the
 * Observations exactly as they are being registered.
 *
 * The judging is entirely `packages/domain` — `evaluateComplianceRecord`, which Story 2.4
 * compiled and froze, reached through `evaluateObservationRecord`. This file is the
 * adapter between that function and the port `registerObservations` calls: it holds the
 * frozen plan, the frozen included population and the frozen Reference Source bytes the
 * producer already acquired, and hands each Observation the values, evidence facts and
 * reference data the rules may read.
 *
 * **It performs no I/O, and that is structural rather than remembered.** The only things
 * it can reach are the three frozen inputs it was constructed with. That matters twice, and
 * for the same reasons the corroboration seam does: evaluation runs INSIDE the registration
 * transaction, where a network call would hold PostgreSQL open across it; and the story's
 * own acceptance criterion is that repeating it over identical Observations under the same
 * version yields identical results.
 *
 * It is BUILT by the stage that holds those inputs rather than injected into it. A
 * composition root has no plan, no population and no Reference Source, so a seam it
 * supplied could only ever be `NO_EVALUATION` — which is exactly how an adapter Run would
 * come to register every Observation as unevaluated forever with nothing saying so.
 */

export interface RuleEvaluationInputs {
  /** The plan the Run froze. Its `inputs` carry the compiled conditions and the Template. */
  readonly plan: ExecutablePlan;
  /** The included population records, in source order, as Story 3.2 froze them. */
  readonly records: readonly PopulationRecord[];
  /** Every Reference Source artifact this Run froze, as bytes and media type. */
  readonly references: readonly ReferenceArtifact[];
}

/**
 * Index the included population by the Template's frozen lookup column.
 *
 * A key carried by more than one included record maps to `null`, never to one of them. A
 * duplicate primary key is an Evidence Quality Gate event and the two rows genuinely
 * disagree — P-3's TX-500008 is 210,000.00 in one row and 215,000.00 in the other — so
 * first-wins, last-wins and a union each answer a question the population cannot answer.
 * `null` makes the record ambiguous, which is Unevaluated.
 */
function indexPopulation(
  column: string,
  records: readonly PopulationRecord[],
): ReadonlyMap<string, Readonly<Record<string, JsonValue>> | null> {
  const byKey = new Map<string, Readonly<Record<string, JsonValue>> | null>();
  for (const record of records) {
    const key = Object.hasOwn(record.values, column) ? record.values[column] : undefined;
    if (typeof key !== 'string' || key === '') continue;
    byKey.set(key, byKey.has(key) ? null : record.values);
  }
  return byKey;
}

/**
 * Build the evaluation port over one Run's frozen inputs.
 *
 * A plan this build has no compiled rules for — an unknown Template, or one whose lookup
 * column is not declared — evaluates nothing at all rather than evaluating it wrongly. The
 * Observations still register, still carry their checks and still count towards coverage;
 * the Run-level Gate (Story 3.8) is where an absent evaluation becomes `INCONCLUSIVE`.
 */
export function ruleEvaluation(inputs: RuleEvaluationInputs): ObservationEvaluationPort {
  const templateId = evaluableTemplateId(inputs.plan.inputs.templateId);
  const column = templateId === null ? null : adapterLookupColumn(templateId);
  const population = column === null ? new Map<string, null>() : indexPopulation(column, inputs.records);
  // Parsed ONCE for the whole batch, not once per Observation: one adapter Work Item
  // registers an Observation per included population record and each of them expands the
  // same policy file.
  const roleExpansion: RoleExpansion =
    inputs.references.length === 0 ? NO_ROLE_EXPANSION : roleExpansionFrom(inputs.references);
  return {
    evaluate: (subjects: readonly ObservationEvaluationSubject[]) =>
      Promise.resolve(
        templateId === null
          ? // A Template this build has no compiled rules for is answered about, with
            // nothing judged. An EMPTY array would be a partial answer about a whole
            // batch, which `registerObservations` refuses — and refusing rolls the Work
            // Item and its Step Execution back, destroying a Run where §H only wanted to
            // degrade it. The Observations still register and the Run-level Gate's
            // condition-completeness row is what makes the Run INCONCLUSIVE.
            subjects.map(
              (subject): ObservationEvaluationResult => ({
                observationId: subject.record.observationId,
                evaluations: [],
              }),
            )
          : subjects.map((subject): ObservationEvaluationResult => {
              const key = subject.record.populationRecordKey;
              const { evaluations } = evaluateObservationRecord(
                templateId,
                inputs.plan.inputs,
                {
                  record: subject.record,
                  coverage: subject.coverage,
                  corroboration: subject.corroboration,
                  checks: subject.checks,
                  // A record key the included population does not carry at all is as
                  // unresolvable as one it carries twice.
                  populationValues: population.get(key) ?? null,
                },
                { roleExpansion },
              );
              return { observationId: subject.record.observationId, evaluations };
            }),
      ),
  };
}
