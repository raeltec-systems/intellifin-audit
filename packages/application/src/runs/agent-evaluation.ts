import {
  OBSERVATION_LIMITS,
  isComplianceConfidence,
  type EvaluationValue,
} from '@intellifin/domain';
import type {
  ObservationEvaluationResult,
  ObservationEvaluationRow,
  ObservationEvaluationSubject,
} from './execution-ports.js';

/**
 * One model judgment offered to the registration transaction.
 *
 * The model is allowed to propose a value and explain it, but it never supplies Evidence
 * ids. Evidence belongs to the platform-captured Observation and is copied onto the
 * resulting evaluation by the deterministic domain evaluator. Keeping the proposal as a
 * sibling of the stored evaluation row also gives the persistence adapter a place to retain
 * the original value when a below-threshold proposal becomes an effective UNEVALUATED.
 */
export interface AgentJudgedProposal {
  readonly observationId: string;
  readonly conditionId: string;
  readonly value: EvaluationValue;
  /** A decimal string in [0, 1], compared with the frozen version threshold. */
  readonly confidence: string;
  /** Agent-generated text; it is untrusted at every rendering boundary. */
  readonly rationale: string;
}

/** A registration row that carries the immutable machine proposal beside its effective value. */
export interface AgentJudgedEvaluationRow extends ObservationEvaluationRow {
  readonly agentProposal: AgentJudgedProposal;
}

/**
 * Optional evaluation port used by an agent-driven producer.
 *
 * The existing `ObservationEvaluationPort` remains the default for adapter and legacy
 * callers. A separate method keeps those callers source-compatible while making it
 * impossible to accidentally discard a proposal when a batch opts into Agent-Judged C2.
 */
export interface AgentProposalEvaluationPort {
  evaluateWithAgentProposals(
    subjects: readonly ObservationEvaluationSubject[],
    proposals: readonly AgentJudgedProposal[],
  ): Promise<readonly ObservationEvaluationResult[]>;
}

const PROPOSAL_KEYS = ['observationId', 'conditionId', 'value', 'confidence', 'rationale'] as const;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === PROPOSAL_KEYS.length && PROPOSAL_KEYS.every((key) => Object.hasOwn(value, key));
}

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit;
}

/** Runtime validation at the application boundary, before Evidence or transaction writes. */
export function isAgentJudgedProposal(value: unknown): value is AgentJudgedProposal {
  if (!object(value) || !exactKeys(value)) return false;
  return (
    boundedText(value['observationId'], OBSERVATION_LIMITS.text) &&
    boundedText(value['conditionId'], OBSERVATION_LIMITS.text) &&
    typeof value['value'] === 'string' &&
    (['COMPLIANT', 'EXCEPTION', 'UNEVALUATED'] as readonly string[]).includes(value['value']) &&
    value['confidence'] !== '-0' &&
    isComplianceConfidence(value['confidence']) &&
    boundedText(value['rationale'], OBSERVATION_LIMITS.value)
  );
}

/** The composite key is kept in one helper so duplicate detection cannot drift. */
export function agentProposalKey(observationId: string, conditionId: string): string {
  return `${observationId}\u0000${conditionId}`;
}
