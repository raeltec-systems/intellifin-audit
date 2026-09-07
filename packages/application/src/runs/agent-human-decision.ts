import {
  adapterLookupColumn, adapterSearchKeys, canonicalJson, findProcedureTemplate, groundedText,
  hasIdentityGroundingSplit, isObservationRecord, normalizeObservationValue, normalizeObservedAt,
  observationIdFor, parseSnapshotLocator, withinFrozenOrigin, readSnapshotCell, readStructuralSnapshot, sha256HexOfBytes,
  type ExecutablePlan, type JsonValue, type ObservationAttribute, type ProcedureTargetSnapshot, type StoredSnapshot,
} from '@intellifin/domain';
import type { AgentWorkCheckpoint } from './agent-work-ports.js';
import { buildFoundAgentObservation } from './agent-observation.js';
import { planAgentTools } from './agent-tool-planner.js';
import type { AdapterEvidenceRecord, PopulationRecord, WorkItemRecord } from './execution-ports.js';
import type { ObservationBatchItem } from './register-observations.js';
import { ESCALATION_OPTION_IDS, FIXED_ESCALATION_OPTIONS, type RunWait } from './waits.js';

export interface AgentHumanDecisionInput {
  readonly runId: string;
  /** Already authorized and durably closed by answerEscalation; this helper grants no authority. */
  readonly wait: RunWait;
  readonly checkpoint: AgentWorkCheckpoint;
  /** Read from the immutable escalation-raised event, not the answer request. */
  readonly raised: { readonly runId: string; readonly waitId: string; readonly stepId: string; readonly supportingEvidenceIds: readonly string[] };
  readonly plan: ExecutablePlan;
  readonly target: ProcedureTargetSnapshot;
  readonly population: PopulationRecord;
  readonly workItem: WorkItemRecord;
  readonly stepExecutionId: string;
  readonly snapshot: StoredSnapshot;
  readonly snapshotEvidence: Pick<AdapterEvidenceRecord, 'evidenceId' | 'registrationId' | 'kind' | 'state' | 'digest'>;
  /** The capture binding's source location. */
  readonly sourceLocation: string;
  readonly observedAt: string;
  /** Only used for an unnamed-value acknowledgement; this record is retained, never changed. */
  readonly existingObservation?: ObservationBatchItem;
}
export type AgentHumanDecisionResult =
  | { readonly ok: true; readonly kind: 'register'; readonly item: ObservationBatchItem; readonly workItemState: 'OBSERVED' | 'UNINSPECTED' }
  | { readonly ok: true; readonly kind: 'retain-existing'; readonly observationId: string }
  | { readonly ok: false; readonly reason: 'wait-mismatch' | 'scope-mismatch' | 'evidence-mismatch' | 'invalid-answer' | 'existing-observation-required' };

function same(a: unknown, b: unknown): boolean {
  try { return canonicalJson(a as JsonValue) === canonicalJson(b as JsonValue); } catch { return false; }
}

/**
 * Consume only an authorized closed option id and the exact captured question evidence.
 * Human selection can resolve duplicate candidates; it cannot supply an identity or values.
 * The output still goes through registerObservations and its unchanged domain checks.
 */
export function applyAgentHumanDecision(input: AgentHumanDecisionInput): AgentHumanDecisionResult {
  const { wait, checkpoint, raised, workItem, target, snapshot, snapshotEvidence: evidence } = input;
  const refuse = (reason: Extract<AgentHumanDecisionResult, { ok: false }>['reason']): AgentHumanDecisionResult => ({ ok: false, reason });
  if (wait.runId !== input.runId || raised.runId !== input.runId || raised.waitId !== wait.waitId ||
      checkpoint.waitId !== wait.waitId || checkpoint.workItemId !== workItem.workItemId || checkpoint.status !== 'WAITING' ||
      checkpoint.pendingWait === null || checkpoint.pendingWait.kind !== wait.kind || !same(checkpoint.pendingWait.options, wait.options) ||
      wait.closureKind !== 'answer' || wait.closedAt === null || wait.actor === null || wait.actor.length === 0 ||
      !Number.isFinite(Date.parse(wait.closedAt)) || !Number.isFinite(Date.parse(wait.deadline)) || Date.parse(wait.closedAt) >= Date.parse(wait.deadline)) return refuse('wait-mismatch');
  const keyColumn = adapterLookupColumn('P-1'), searchKeys = adapterSearchKeys('P-1');
  const key = keyColumn === null ? null : input.population.values[keyColumn];
  if (input.plan.schemaVersion !== 1 || input.plan.compilerVersion !== '1' || input.plan.inputs.templateId !== 'P-1' || keyColumn === null || searchKeys === null || typeof key !== 'string' || key === '' ||
      target.contract.kind !== 'web' || !input.plan.inputs.targets.some(frozen => same(frozen, target)) || !target.contract.allowed_origins.some(origin => withinFrozenOrigin(origin, input.sourceLocation)) ||
      workItem.subjectKey !== key || workItem.registrationId !== target.registrationId || raised.stepId !== workItem.stepId ||
      !input.plan.targetSystems.some(system => system.registrationId === target.registrationId && system.planSteps.some(step => step.id === workItem.stepId && step.action === 'inspect-record'))) return refuse('scope-mismatch');
  if (evidence.state !== 'REGISTERED' || evidence.kind !== 'structural-snapshot' || evidence.evidenceId !== snapshot.evidenceId ||
      evidence.registrationId !== target.registrationId || !raised.supportingEvidenceIds.includes(snapshot.evidenceId) ||
      evidence.digest !== sha256HexOfBytes(snapshot.bytes)) return refuse('evidence-mismatch');
  const parsed = readStructuralSnapshot(snapshot), instant = normalizeObservedAt(input.observedAt);
  if (!parsed.ok || parsed.substrate !== 'web_tree' || instant === null) return refuse('evidence-mismatch');
  const planned = planAgentTools({ plan: input.plan, target, population: input.population, snapshot, sourceLocation: input.sourceLocation, searches: [] });
  // The planner also validates the exact frozen target and location. Requiring its
  // candidate vocabulary below binds every opaque id to THIS snapshot's node indices.
  const answer = wait.answerOptionId;
  if (answer === null || !wait.options.some(option => option.id === answer)) return refuse('invalid-answer');
  const expectedQueryKeys = searchKeys.map(name => ({ key: name, value: typeof input.population.values[name] === 'string' ? input.population.values[name] as string : '' }));
  const base = (found: 'true' | 'ambiguous', identity: ObservationAttribute | null, attributes: readonly ObservationAttribute[], human: boolean): ObservationBatchItem => ({
    record: { schemaVersion: 1, observationId: observationIdFor(workItem.workItemId, key), workItemId: workItem.workItemId,
      populationRecordKey: key, targetSystem: target.registrationId, found, observedAt: instant.observedAt,
      stepExecutionId: input.stepExecutionId, captureMethod: 'agent', matchOrigin: human ? 'human-matched' : 'platform', identity,
      attributes, evidenceIds: [snapshot.evidenceId] },
    observedAtSource: input.observedAt, absence: null, expectedQueryKeys,
  });
  const unresolved = (): AgentHumanDecisionResult => ({ ok: true, kind: 'register', item: base('ambiguous', null, [], false), workItemState: 'UNINSPECTED' });
  if (wait.kind === 'retry-or-skip') {
    if (!same(wait.options, FIXED_ESCALATION_OPTIONS['retry-or-skip']) || answer !== ESCALATION_OPTION_IDS.skip) return refuse('invalid-answer');
    return unresolved();
  }
  if (wait.kind === 'unnamed-value') {
    if (!same(wait.options, FIXED_ESCALATION_OPTIONS['unnamed-value']) || answer !== ESCALATION_OPTION_IDS.markUnevaluated) return refuse('invalid-answer');
    const previous = input.existingObservation;
    if (previous === undefined) {
      // The loop may have paused before registering the captured candidate. Continue with
      // that SAME platform reading; the shared evaluator still decides the unnamed value.
      if (planned.found === null) return refuse('existing-observation-required');
      const original = buildFoundAgentObservation({ plan: input.plan, target, population: input.population,
        workItemId: workItem.workItemId, stepExecutionId: input.stepExecutionId, snapshot,
        screenshotEvidenceId: null, identityLocator: planned.found.identityLocator,
        selections: planned.found.selections, observedAt: input.observedAt });
      return original === null ? refuse('existing-observation-required') : { ok: true, kind: 'register', item: original, workItemState: 'OBSERVED' };
    }
    if (!isObservationRecord(previous.record) || hasIdentityGroundingSplit(previous.record) ||
        previous.record.workItemId !== workItem.workItemId || previous.record.populationRecordKey !== key || previous.record.targetSystem !== target.registrationId ||
        !previous.record.evidenceIds.includes(snapshot.evidenceId) ||
        [previous.record.identity, ...previous.record.attributes].some(attribute => attribute?.grounding !== null && attribute?.grounding !== undefined && attribute.grounding.evidenceId !== snapshot.evidenceId)) return refuse('existing-observation-required');
    // No human answer is translated into an evaluation. The original machine/rule finding
    // stays registered; the loop simply acknowledges the durable wait and continues.
    return { ok: true, kind: 'retain-existing', observationId: previous.record.observationId };
  }
  if (wait.kind !== 'choose-candidate' || planned.candidates.length === 0) return refuse('invalid-answer');
  const candidateOptions = planned.candidates.map(candidate => ({ id: candidate.id, label: candidate.label }));
  // The final label is UI copy, but it must equal the persisted intent and does not pick a
  // candidate. Candidate labels/ids, unlike narration, come from the frozen planner.
  if (wait.options.length !== candidateOptions.length + 1 || !same(wait.options.slice(0, -1), candidateOptions) || wait.options.at(-1)?.id !== ESCALATION_OPTION_IDS.markAmbiguous) return refuse('invalid-answer');
  if (answer === ESCALATION_OPTION_IDS.markAmbiguous) return unresolved();
  const candidate = planned.candidates.find(option => option.id === answer);
  if (!candidate) return refuse('invalid-answer');
  // The identity CHECK is unchanged for human matches. A name-only candidate cannot be
  // upgraded into found=true merely because a human selected its opaque id.
  if (candidate.identityLocator === null) return unresolved();
  const address = parseSnapshotLocator(candidate.identityLocator);
  if (address === null) return refuse('evidence-mismatch');
  const identityNode = parsed.document.nodes[address.index], identityCell = readSnapshotCell(parsed, address);
  const labels = findProcedureTemplate('P-1').declaredAttributeLabels!;
  if (identityNode?.role !== 'datum' || identityCell === null || identityCell.label !== labels.identity || identityCell.value !== key) return unresolved();
  if (parsed.document.nodes.filter(node => node.group === identityNode.group && node.role === 'datum' && node.label === labels.identity).length !== 1) return unresolved();
  const secondaryLabel = target.contract.secondary_key, secondaryKey = searchKeys.find(name => name !== keyColumn);
  const secondary = parsed.document.nodes.filter(node => node.group === identityNode.group && node.role === 'datum' && node.label === secondaryLabel);
  if (secondaryLabel === null || secondaryKey === undefined || secondary.length !== 1 || secondary[0]!.value !== input.population.values[secondaryKey]) return unresolved();
  const ground = (name: string, valueType: string, index: number): ObservationAttribute | null => {
    const node = parsed.document.nodes[index], locator = `$.nodes[${index}].value`, cell = readSnapshotCell(parsed, { collection: 'nodes', index, field: 'value' });
    const label = labels[name === keyColumn ? 'identity' : name];
    if (!node || node.role !== 'datum' || node.group !== identityNode.group || !cell || cell.label !== label || !target.contract.attribute_label_patterns.includes(label ?? '')) return null;
    return { name, originalValue: cell.value, normalizedValue: normalizeObservationValue(valueType, cell.value), grounding: { evidenceId: snapshot.evidenceId, locator, label: cell.label, extractedText: groundedText(cell.value) }, corroboration: null };
  };
  const identity = ground(keyColumn, 'text', address.index);
  if (identity === null) return unresolved();
  const attributes = input.plan.observations.filter(field => !['found','identity',keyColumn].includes(field.attributeName)).map(field => {
    const matches = parsed.document.nodes.flatMap((node, index) => node.group === identityNode.group && node.role === 'datum' && node.label === labels[field.attributeName] ? [index] : []);
    return (matches.length === 1 ? ground(field.attributeName, field.valueType, matches[0]!) : null) ?? { name: field.attributeName, originalValue: null, normalizedValue: null, grounding: null, corroboration: null };
  });
  return { ok: true, kind: 'register', item: base('true', identity, attributes, true), workItemState: 'OBSERVED' };
}
