import {
  adapterLookupColumn,
  agentJudgedNeedsProposal,
  complianceFieldMappings,
  evaluableTemplateId,
  evaluateComplianceRecord,
  evaluateObservationRecord,
  NO_ROLE_EXPANSION,
  observationEvidenceFacts,
  observationRuleValues,
  roleExpansionFrom,
  type ExecutablePlan,
  type JsonValue,
  type ObservationRecord,
  type ReferenceArtifact,
  type RoleExpansion,
  type AgentJudgedEvaluationProposal,
} from '@intellifin/domain';
import type {
  ObservationEvaluationResult,
  ObservationEvaluationSubject,
  PopulationRecord,
} from './execution-ports.js';
import type { AgentJudgedProposal, AgentProposalEvaluationPort } from './agent-evaluation.js';

/**
 * The frozen inputs available to an agent-aware evaluation stage.
 *
 * The model proposal is deliberately not part of this object. It arrives through the
 * port method for one registration batch; the plan, included population and Reference
 * Source bytes are the Run inputs captured by the stage that constructs this adapter.
 */
export interface AgentRuleEvaluationInputs {
  /** The Procedure Version plan frozen for this Run. */
  readonly plan: ExecutablePlan;
  /** The included population records frozen for this Run, in source order. */
  readonly records: readonly PopulationRecord[];
  /** The Reference Source artifacts frozen for this Run. */
  readonly references: readonly ReferenceArtifact[];
}

interface AgentRuleEvaluationContext {
  readonly templateId: ReturnType<typeof evaluableTemplateId>;
  readonly population: ReadonlyMap<string, Readonly<Record<string, JsonValue>> | null>;
  readonly roleExpansion: RoleExpansion;
}

function indexPopulation(
  column: string,
  records: readonly PopulationRecord[],
): ReadonlyMap<string, Readonly<Record<string, JsonValue>> | null> {
  const byKey = new Map<string, Readonly<Record<string, JsonValue>> | null>();
  for (const record of records) {
    const key = Object.hasOwn(record.values, column) ? record.values[column] : undefined;
    if (typeof key !== 'string' || key === '') continue;
    // A duplicate key is ambiguous. Keep it as null so the domain evaluator cannot
    // accidentally choose first-wins or last-wins data for a deterministic conclusion.
    byKey.set(key, byKey.has(key) ? null : record.values);
  }
  return byKey;
}

function proposalsByObservation(
  proposals: readonly AgentJudgedProposal[],
): ReadonlyMap<string, ReadonlyMap<string, AgentJudgedEvaluationProposal>> {
  const grouped = new Map<string, Map<string, AgentJudgedEvaluationProposal>>();
  for (const proposal of proposals) {
    const conditions = grouped.get(proposal.observationId) ?? new Map();
    conditions.set(proposal.conditionId, {
      conditionId: proposal.conditionId,
      value: proposal.value,
      confidence: proposal.confidence,
      rationale: proposal.rationale,
    });
    grouped.set(proposal.observationId, conditions);
  }
  return grouped;
}

function proposalRecord(
  proposals: ReadonlyMap<string, AgentJudgedEvaluationProposal> | undefined,
): Readonly<Record<string, AgentJudgedEvaluationProposal>> {
  // `Object.fromEntries` creates a fresh ordinary record for each subject. The domain
  // evaluator only reads this object, so a proposal cannot mutate another subject's input.
  return Object.fromEntries(proposals === undefined ? [] : proposals.entries());
}

function contextFor(inputs: AgentRuleEvaluationInputs): AgentRuleEvaluationContext {
  const templateId = evaluableTemplateId(inputs.plan.inputs.templateId);
  const column = templateId === null ? null : adapterLookupColumn(templateId);
  return {
    templateId,
    population: column === null ? new Map<string, null>() : indexPopulation(column, inputs.records),
    roleExpansion: inputs.references.length === 0 ? NO_ROLE_EXPANSION : roleExpansionFrom(inputs.references),
  };
}

/**
 * Return the Agent-Judged conditions whose frozen applicability predicate is TRUE for
 * one final Observation.
 *
 * The model request must not infer applicability from condition prose or from the model's
 * own answer. This projection runs the domain compiler's existing deterministic evaluator
 * with valid evidence facts solely to read its `applicable` field; evidence quality does
 * not alter a predicate's applicability. A null/false predicate is withheld, while the
 * registration path still receives the complete frozen Agent-Judged subset and enforces
 * the final result against the same evaluator.
 */
export function applicableAgentConditionIds(
  inputs: AgentRuleEvaluationInputs,
  record: ObservationRecord,
): readonly string[] {
  const context = contextFor(inputs);
  if (context.templateId === null) return [];
  const populationValues = context.population.get(record.populationRecordKey) ?? null;
  const subject = {
    record,
    coverage: 'COVERED' as const,
    corroboration: 'MATCHED' as const,
    checks: [],
    populationValues,
  };
  const evaluation = evaluateComplianceRecord(
    context.templateId,
    inputs.plan.inputs,
    {
      values: observationRuleValues(context.templateId, record, populationValues, complianceFieldMappings(inputs.plan.inputs)),
      evidence: observationEvidenceFacts(subject),
      roleMatrix: context.roleExpansion,
    },
  );
  // A frozen policy can decide a row without the model (unreadable roles, an unnamed
  // role); the shared predicate excludes those so no proposal is asked for and, in the
  // registrar, none is accepted.
  return evaluation.conditions
    .filter(agentJudgedNeedsProposal)
    .map((condition) => condition.conditionId);
}

/**
 * Build an agent-aware evaluation port over one Run's frozen plan and evidence inputs.
 *
 * This is the proposal-bearing counterpart to `ruleEvaluation`. It uses exactly the same
 * `evaluateObservationRecord` engine: applicability and all Rule-Classified conditions
 * come from the frozen compiler, while a proposal supplies only the value, confidence and
 * rationale for an already-frozen `AGENT_JUDGED` condition. No model, fixture, expectation
 * file or network service is reachable from the returned port.
 */
export function agentRuleEvaluation(
  inputs: AgentRuleEvaluationInputs,
): AgentProposalEvaluationPort {
  const { templateId, population, roleExpansion } = contextFor(inputs);

  return {
    evaluateWithAgentProposals: async (
      subjects: readonly ObservationEvaluationSubject[],
      proposals: readonly AgentJudgedProposal[],
    ): Promise<readonly ObservationEvaluationResult[]> => {
      // Registration validates the proposal wire shape, condition membership and duplicate
      // tuples before this port is called. Grouping here is only the transport projection
      // into the domain evaluator's per-record map; it does not validate or reinterpret a
      // model answer.
      const byObservation = proposalsByObservation(proposals);
      if (templateId === null) {
        return subjects.map((subject) => ({
          observationId: subject.record.observationId,
          evaluations: [],
        }));
      }
      return subjects.map((subject) => {
        const { evaluations } = evaluateObservationRecord(
          templateId,
          inputs.plan.inputs,
          {
            record: subject.record,
            coverage: subject.coverage,
            corroboration: subject.corroboration,
            checks: subject.checks,
            // A missing or duplicate included population key is intentionally null.
            populationValues: population.get(subject.record.populationRecordKey) ?? null,
          },
          { roleExpansion },
          proposalRecord(byObservation.get(subject.record.observationId)),
        );
        return { observationId: subject.record.observationId, evaluations };
      });
    },
  };
}
