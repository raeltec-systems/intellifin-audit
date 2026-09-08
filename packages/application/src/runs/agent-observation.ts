import {
  adapterLookupColumn, adapterSearchKeys, groundedText, normalizeObservationValue, normalizeObservedAt,
  findProcedureTemplate, isTemplateId,
  observationIdFor, parseSnapshotLocator, readStructuralSnapshot, readSnapshotCell,
  OBSERVATION_SCHEMA_VERSION,
  type ExecutablePlan, type ObservationAttribute, type ProcedureTargetSnapshot,
  type StoredSnapshot,
} from '@intellifin/domain';
import type { PopulationRecord } from './execution-ports.js';
import type { ObservationBatchItem } from './register-observations.js';

/** Model choices name cells, never values. Only the platform reads the frozen bytes. */
export interface AgentFieldSelection {
  readonly attributeName: string;
  readonly locator: string;
}

/**
 * Build a found Observation from one captured document. Missing fields remain explicit
 * ungrounded attributes, so the existing required-evidence check cannot lose them. A
 * selected input/filter/status message is not an account or configuration data cell.
 *
 * The work-item stage must freeze/register the supplied snapshot before registration;
 * this pure builder cannot write Evidence or bypass corroboration/evaluation.
 */
export function buildFoundAgentObservation(input: {
  readonly plan: ExecutablePlan;
  readonly target: ProcedureTargetSnapshot;
  readonly population: PopulationRecord;
  readonly workItemId: string;
  readonly stepExecutionId: string;
  readonly snapshot: StoredSnapshot;
  readonly screenshotEvidenceId: string | null;
  readonly identityLocator: string;
  readonly selections: readonly AgentFieldSelection[];
  readonly observedAt: string;
}): ObservationBatchItem | null {
  if (input.plan.schemaVersion !== 1 || input.plan.compilerVersion !== '1') return null;
  const templateId = input.plan.inputs.templateId;
  if (!isTemplateId(templateId)) return null;
  // Compiler1's shipped label contract is immutable build data. A target must have
  // frozen that label; an unsupported custom mapping stays ungrounded, never guessed.
  const labels = findProcedureTemplate(templateId).declaredAttributeLabels;
  const instant = normalizeObservedAt(input.observedAt);
  if (instant === null) return null;
  const expectedLabel = (name: string): string | null => {
    const label = labels?.[name];
    return label !== undefined && input.target.contract.attribute_label_patterns.includes(label) ? label : null;
  };
  const column = adapterLookupColumn(input.plan.inputs.templateId);
  const searchKeys = adapterSearchKeys(input.plan.inputs.templateId);
  if (column === null || searchKeys === null || input.snapshot.substrate !== 'web_tree') return null;
  const key = input.population.values[column];
  if (typeof key !== 'string' || key === '') return null;
  const parsed = readStructuralSnapshot(input.snapshot);
  if (!parsed.ok || parsed.substrate !== 'web_tree') return null;
  const identityAddress = parseSnapshotLocator(input.identityLocator);
  if (identityAddress === null) return null;
  const identityCell = readSnapshotCell(parsed, identityAddress);
  const identityNode = parsed.document.nodes[identityAddress.index];
  if (identityCell === null || identityNode?.role !== 'datum' || identityCell.value !== key || identityCell.label !== expectedLabel('identity')) return null;
  // One exact key in a data group, never first-wins across duplicate candidate rows.
  const matchingGroups = new Set(parsed.document.nodes
    .filter(node => node.role === 'datum' && node.value === key)
    .map(node => node.group));
  if (matchingGroups.size !== 1) return null;
  const secondaryLabel = input.target.contract.secondary_key;
  if (secondaryLabel !== null) {
    const secondaryKey = searchKeys.find(name => name !== column);
    const expected = secondaryKey === undefined ? undefined : input.population.values[secondaryKey];
    const cells = parsed.document.nodes.filter(node => node.group === identityNode.group && node.role === 'datum' && node.label === secondaryLabel);
    if (typeof expected !== 'string' || cells.length !== 1 || cells[0]!.value !== expected) return null;
  }
  const ground = (name: string, valueType: string, path: string): ObservationAttribute | null => {
    const address = parseSnapshotLocator(path);
    if (address === null) return null;
    const node = parsed.document.nodes[address.index];
    const cell = readSnapshotCell(parsed, address);
    if (cell === null || node?.role !== 'datum' || node.group !== identityNode.group || cell.label !== expectedLabel(name === column ? 'identity' : name)) return null;
    return {
      name, originalValue: cell.value, normalizedValue: normalizeObservationValue(valueType, cell.value),
      grounding: { evidenceId: input.snapshot.evidenceId, locator: path, label: cell.label, extractedText: groundedText(cell.value) },
      corroboration: null,
    };
  };
  const identity = ground(column, 'text', input.identityLocator);
  if (identity === null) return null;
  const attributes: ObservationAttribute[] = [];
  for (const field of input.plan.observations) {
    if (field.attributeName === 'found' || field.attributeName === 'identity' || field.attributeName === column) continue;
    // The compiler lists a union of supported rule fields, including optional
    // variants and population-supplied values. It is not a capture obligation for
    // every target. Preserve this Template's declared fields and explicit evidence
    // requirements; unavailable fields in that set still fail as ungrounded below.
    if (labels?.[field.attributeName] === undefined &&
        !input.plan.inputs.evidenceRequirements?.some(requirement => requirement.attributeName === field.attributeName)) continue;
    const choices = input.selections.filter(selection => selection.attributeName === field.attributeName);
    const attribute = choices.length === 1 ? ground(field.attributeName, field.valueType, choices[0]!.locator) : null;
    // Every declared field stays represented. No guessed or model-authored fallback value.
    attributes.push(attribute ?? { name: field.attributeName, originalValue: null, normalizedValue: null, grounding: null, corroboration: null });
  }
  return {
    record: {
      schemaVersion: OBSERVATION_SCHEMA_VERSION,
      observationId: observationIdFor(input.workItemId, key),
      workItemId: input.workItemId, populationRecordKey: key, targetSystem: input.target.registrationId,
      found: 'true', observedAt: instant.observedAt, stepExecutionId: input.stepExecutionId,
      captureMethod: 'agent', matchOrigin: 'platform', identity, attributes,
      evidenceIds: [input.snapshot.evidenceId, ...(input.screenshotEvidenceId === null ? [] : [input.screenshotEvidenceId])],
    },
    observedAtSource: input.observedAt,
    absence: null,
    expectedQueryKeys: searchKeys.map(name => ({ key: name, value: typeof input.population.values[name] === 'string' ? input.population.values[name] as string : '' })),
  };
}

/** The one absence judge still decides coverage; this only supplies platform-recorded facts. */
export function buildAbsentAgentObservation(input: {
  readonly plan: ExecutablePlan;
  readonly target: ProcedureTargetSnapshot;
  readonly population: PopulationRecord;
  readonly workItemId: string;
  readonly stepExecutionId: string;
  readonly snapshot: StoredSnapshot;
  readonly queryKeys: readonly { key: string; value: string }[];
  readonly searchEvidenceIds: readonly string[];
  readonly screenshotEvidenceId: string | null;
  readonly observedAt: string;
}): ObservationBatchItem | null {
  if (input.plan.schemaVersion !== 1 || input.plan.compilerVersion !== '1' || input.plan.inputs.templateId !== 'P-1') return null;
  const parsed = readStructuralSnapshot(input.snapshot);
  // A failed capture or arbitrary empty page is no absence claim at all. Partial result
  // pages may carry an explicit zero count, but completeness remains false below.
  if (!parsed.ok || parsed.substrate !== 'web_tree' || parsed.document.completion?.returned !== 0) return null;
  const instant = normalizeObservedAt(input.observedAt);
  const column = adapterLookupColumn('P-1');
  const keys = adapterSearchKeys('P-1');
  if (instant === null || column === null || keys === null) return null;
  const recordKey = input.population.values[column];
  if (typeof recordKey !== 'string' || recordKey.length === 0) return null;
  return {
    record: {
      schemaVersion: OBSERVATION_SCHEMA_VERSION,
      observationId: observationIdFor(input.workItemId, recordKey), workItemId: input.workItemId,
      populationRecordKey: recordKey, targetSystem: input.target.registrationId,
      found: 'false', observedAt: instant.observedAt, stepExecutionId: input.stepExecutionId,
      captureMethod: 'agent', matchOrigin: 'platform', identity: null, attributes: [],
      evidenceIds: [...new Set([input.snapshot.evidenceId, ...input.searchEvidenceIds, ...(input.screenshotEvidenceId === null ? [] : [input.screenshotEvidenceId])])],
    },
    observedAtSource: input.observedAt,
    absence: { queryKeys: input.queryKeys, emptyResultEvidenceId: input.snapshot.evidenceId, extractionComplete: parsed.document.completion.complete },
    expectedQueryKeys: keys.map(key => ({ key, value: typeof input.population.values[key] === 'string' ? input.population.values[key] as string : '' })),
  };
}
