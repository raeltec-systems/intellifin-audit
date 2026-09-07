import {
  adapterLookupColumn,
  adapterSearchKeys,
  canonicalJson,
  declaredCountMatches,
  groundedText,
  normalizeObservationValue,
  normalizeObservedAt,
  observationIdFor,
  OBSERVATION_LIMITS,
  OBSERVATION_SCHEMA_VERSION,
  parseFrozenLocation,
  parseSnapshotLocator,
  readSnapshotCell,
  readStructuralSnapshot,
  withinFrozenOrigin,
  type ExecutablePlan,
  type JsonValue,
  type ObservationAttribute,
  type ObservationRecord,
  type ProcedureTargetSnapshot,
  type SnapshotCell,
  type StoredSnapshot,
  type WebTreeNode,
} from '@intellifin/domain';
import type {
  AgentActionProposal,
  AgentApprovedTool,
  AgentLocator,
} from './agent-ports.js';
import type { PopulationRecord, WorkItemRecord } from './execution-ports.js';
import type { ObservationBatchItem } from './register-observations.js';

import { PROD_CONSOLE_LABELS } from './prodconsole-labels.js';
export { PROD_CONSOLE_LABELS } from './prodconsole-labels.js';

type ProdConsoleLabel = (typeof PROD_CONSOLE_LABELS)[keyof typeof PROD_CONSOLE_LABELS];

const REQUIRED_LABELS: readonly ProdConsoleLabel[] = [
  PROD_CONSOLE_LABELS.parameter,
  PROD_CONSOLE_LABELS.value,
  PROD_CONSOLE_LABELS.snapshotIdentifier,
  PROD_CONSOLE_LABELS.expectedParameterCount,
];

/** One closed failure category returned by the pure planner/selector. */
export type ProdConsoleDiagnostic =
  | 'unsupported-plan'
  | 'target-contract'
  | 'snapshot-unreadable'
  | 'model-action-not-approved'
  | 'model-action-duplicate'
  | 'model-action-parameters'
  | 'model-action-locator'
  | 'model-action-cell'
  | 'baseline-parameter-invalid'
  | 'parameter-missing'
  | 'parameter-duplicate'
  | 'parameter-extra'
  | 'metadata-missing'
  | 'metadata-duplicate'
  | 'metadata-invalid'
  | 'observation-time-missing'
  | 'count-mismatch';

/** Input to the P-4 tool planner. No fixture or current registration is consulted. */
export interface ProdConsoleToolPlannerInput {
  readonly plan: ExecutablePlan;
  readonly target: ProcedureTargetSnapshot;
  readonly snapshot: StoredSnapshot;
  /** Current page location; it is normalized into the approved tool destination. */
  readonly sourceLocation: string;
}

/** One approved read grounded in one indexed node of the frozen web tree. */
export interface ProdConsoleApprovedRead {
  readonly tool: AgentApprovedTool;
  readonly index: number;
  readonly group: string;
  readonly label: ProdConsoleLabel;
  /** The platform read of this locator from the exact stored snapshot. */
  readonly cell: SnapshotCell;
}

/** Tools and the exact snapshot they are allowed to read. */
export interface ProdConsoleToolPlannerResult {
  readonly snapshot: StoredSnapshot;
  readonly sourceLocation: string;
  readonly tools: readonly AgentApprovedTool[];
  readonly reads: readonly ProdConsoleApprovedRead[];
  /** Count of all Parameter datum nodes in the stored page, before model selection. */
  readonly pageParameterCount: number;
}

/**
 * A model proposal after it has been matched to an approved tool.
 *
 * The value is deliberately absent. The only value later consumed by the batch builder
 * is read from `snapshot` at `tool.locator`; a model cannot author an Observation value.
 */
export interface ProdConsoleSelectedRead {
  readonly proposal: AgentActionProposal;
  readonly tool: AgentApprovedTool;
  readonly index: number;
  readonly group: string;
  readonly label: ProdConsoleLabel;
  readonly cell: SnapshotCell;
}

/** The result of validating one genuine model action list. */
export interface ProdConsoleProposalSelection {
  readonly accepted: boolean;
  readonly reads: readonly ProdConsoleSelectedRead[];
  readonly diagnostics: readonly ProdConsoleDiagnostic[];
}

/** A raw baseline row retained so a duplicate key can never silently become first-wins. */
export interface ProdConsoleBaselineIndex {
  /** Distinct valid parameter keys in population order. */
  readonly parameterKeys: readonly string[];
  /** Every source row for each key, including duplicate effective rows. */
  readonly rowsByParameter: ReadonlyMap<string, readonly PopulationRecord[]>;
  /** A unique source row, or null when the key is duplicated. */
  readonly uniqueRowByParameter: ReadonlyMap<string, PopulationRecord | null>;
  readonly duplicateParameters: readonly string[];
  /** Rows with no usable `parameter` key; no key is invented for them. */
  readonly unkeyedRows: number;
  /** Rows carrying a key but missing/invalid baseline columns. They remain indexed. */
  readonly malformedRows: number;
}

/** Metadata read from the page by model-selected locators. */
export interface ProdConsoleMetadata {
  readonly snapshotIdentifier: string | null;
  readonly snapshotIdentifierLocator: string | null;
  readonly expectedParameterCount: number | null;
  readonly expectedParameterCountLocator: string | null;
  /** Optional: only available when the frozen Target System permits this label. */
  readonly snapshotTakenAt: string | null;
  readonly snapshotTakenAtLocator: string | null;
}

/** The count is a claim from the page, kept separate from the observations it is compared with. */
export interface ProdConsoleCountReconciliation {
  readonly declared: number | null;
  readonly registeredObservations: number;
  readonly matches: boolean | null;
  readonly pageParameterCount: number;
}

/** One P-4 Work Item's complete pure output, ready for the shared registration seam. */
export interface ProdConsoleObservationBatch {
  readonly items: readonly ObservationBatchItem[];
  readonly baseline: ProdConsoleBaselineIndex;
  readonly metadata: ProdConsoleMetadata;
  readonly count: ProdConsoleCountReconciliation;
  readonly selectedParameterCount: number;
  readonly missingParameters: readonly string[];
  readonly duplicateParameters: readonly string[];
  readonly extraParameters: readonly string[];
  readonly diagnostics: readonly ProdConsoleDiagnostic[];
  readonly proposal: ProdConsoleProposalSelection;
}

/** Inputs needed to build the page Work Item's Observation batch. */
export interface ProdConsoleObservationBatchInput {
  readonly plan: ExecutablePlan;
  readonly target: ProcedureTargetSnapshot;
  readonly population: readonly PopulationRecord[];
  readonly workItemId: string;
  readonly stepExecutionId: string;
  readonly snapshot: StoredSnapshot;
  readonly screenshotEvidenceId: string | null;
  /** The platform capture clock. It is retained as the Observation source time. */
  readonly observedAt: string;
  readonly planner: ProdConsoleToolPlannerResult;
  /** The model's action proposals. Values in a proposal are never trusted. */
  readonly proposals: readonly AgentActionProposal[];
}

/** Inputs for materializing the one page-level Work Item. */
export interface ProdConsoleWorkItemInput {
  readonly workItemId: string;
  readonly stepId: string;
  readonly ordinal: number;
  readonly target: ProcedureTargetSnapshot;
  readonly observations: number;
  readonly evidenceId?: string | null;
  readonly state?: WorkItemRecord['state'];
  readonly attempts?: number;
  readonly cycles?: number;
  readonly diagnostic?: string | null;
  /** Existing durable row, if this is a redelivery/update. */
  readonly existing?: WorkItemRecord;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validText(value: unknown, limit = OBSERVATION_LIMITS.text): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameTarget(plan: ExecutablePlan, target: ProcedureTargetSnapshot): boolean {
  const planned = plan.inputs.targets.find((candidate) => candidate.registrationId === target.registrationId);
  if (planned === undefined) return false;
  try {
    return planned.displayName === target.displayName &&
      planned.digest === target.digest &&
      canonicalJson(planned.contract as unknown as JsonValue) === canonicalJson(target.contract as unknown as JsonValue);
  } catch {
    return false;
  }
}

function frozenLabels(target: ProcedureTargetSnapshot): readonly ProdConsoleLabel[] | null {
  const labels = target.contract.attribute_label_patterns;
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== 'string')) return null;
  if (!REQUIRED_LABELS.every((label) => labels.includes(label))) return null;
  return labels.filter((label): label is ProdConsoleLabel =>
    (Object.values(PROD_CONSOLE_LABELS) as readonly string[]).includes(label),
  );
}

function validP4Input(
  plan: ExecutablePlan,
  target: ProcedureTargetSnapshot,
  snapshot: StoredSnapshot,
  sourceLocation: string,
): { readonly labels: readonly ProdConsoleLabel[]; readonly destination: string; readonly lookupColumn: string } | null {
  if (
    plan.schemaVersion !== 1 ||
    plan.compilerVersion !== '1' ||
    plan.inputs.templateId !== 'P-4' ||
    adapterLookupColumn(plan.inputs.templateId) !== 'parameter' ||
    adapterSearchKeys(plan.inputs.templateId)?.length !== 1 ||
    !sameTarget(plan, target) ||
    target.contract.kind !== 'web' ||
    !target.contract.permitted_actions.includes('read-attribute') ||
    !target.contract.permitted_actions.includes('read-metadata') ||
    snapshot.substrate !== 'web_tree' ||
    !validText(snapshot.evidenceId)
  ) return null;
  const labels = frozenLabels(target);
  const lookupColumn = adapterLookupColumn(plan.inputs.templateId);
  const parsedLocation = parseFrozenLocation(sourceLocation);
  if (lookupColumn === null || labels === null || parsedLocation === null || !target.contract.allowed_origins.some((origin) => withinFrozenOrigin(origin, sourceLocation))) return null;
  const destination = `${parsedLocation.authority}${parsedLocation.path}`;
  return { labels, destination, lookupColumn };
}

function labelForNode(node: WebTreeNode, labels: readonly ProdConsoleLabel[]): ProdConsoleLabel | null {
  if (node.role !== 'datum' || !labels.includes(node.label as ProdConsoleLabel)) return null;
  const label = node.label as ProdConsoleLabel;
  return (Object.values(PROD_CONSOLE_LABELS) as readonly string[]).includes(label) ? label : null;
}

function actionForLabel(label: ProdConsoleLabel): 'read-attribute' | 'read-metadata' {
  return label === PROD_CONSOLE_LABELS.parameter || label === PROD_CONSOLE_LABELS.value
    ? 'read-attribute'
    : 'read-metadata';
}

function descriptionForLabel(label: ProdConsoleLabel): string {
  switch (label) {
    case PROD_CONSOLE_LABELS.parameter:
      return 'Read the approved ProdConsole parameter field.';
    case PROD_CONSOLE_LABELS.value:
      return 'Read the approved ProdConsole value field.';
    case PROD_CONSOLE_LABELS.snapshotIdentifier:
      return 'Read the approved ProdConsole snapshot identifier.';
    case PROD_CONSOLE_LABELS.expectedParameterCount:
      return 'Read the approved ProdConsole expected parameter count.';
    case PROD_CONSOLE_LABELS.snapshotTakenAt:
      return 'Read the approved ProdConsole snapshot time.';
  }
}

function webTreePath(index: number): string {
  return `$.nodes[${String(index)}].value`;
}

/**
 * Offer only frozen, target-labelled datum locators from the stored page.
 *
 * The model sees opaque tool ids and chooses among these locators. It never receives a
 * value-bearing parameter in a tool and it cannot add a tool for Description or any other
 * page text the registration did not authorize.
 */
export function planProdConsoleTools(
  input: ProdConsoleToolPlannerInput,
): ProdConsoleToolPlannerResult | null {
  const valid = validP4Input(input.plan, input.target, input.snapshot, input.sourceLocation);
  if (valid === null) return null;
  const parsed = readStructuralSnapshot(input.snapshot);
  if (!parsed.ok || parsed.substrate !== 'web_tree') return null;
  const tools: AgentApprovedTool[] = [];
  const reads: ProdConsoleApprovedRead[] = [];
  let pageParameterCount = 0;
  for (const [index, node] of parsed.document.nodes.entries()) {
    if (node.role === 'datum' && node.label === PROD_CONSOLE_LABELS.parameter) pageParameterCount += 1;
    const label = labelForNode(node, valid.labels);
    if (label === null) continue;
    const action = actionForLabel(label);
    const tool: AgentApprovedTool = {
      toolId: `prodconsole-${action}-${String(index)}`,
      action,
      destination: valid.destination,
      locator: { substrate: 'web_tree', path: webTreePath(index) },
      description: descriptionForLabel(label),
      parameterNames: [],
    };
    tools.push(tool);
    const cell = readSnapshotCell(parsed, { collection: 'nodes', index, field: 'value' });
    if (cell === null || cell.label !== label) continue;
    reads.push({ tool, index, group: node.group, label, cell });
  }
  return {
    snapshot: input.snapshot,
    sourceLocation: valid.destination,
    tools,
    reads,
    pageParameterCount,
  };
}

function proposalShape(value: unknown): value is AgentActionProposal {
  if (!isObject(value) || !exactKeys(value, ['toolId', 'action', 'destination', 'locator', 'parameters'])) return false;
  if (!validText(value['toolId'])) return false;
  if (!validText(value['action'])) return false;
  if (!validText(value['destination'])) return false;
  const locator = value['locator'];
  if (!isObject(locator) || !exactKeys(locator, ['substrate', 'path']) || locator['substrate'] !== 'web_tree' || !validText(locator['path'])) return false;
  return Array.isArray(value['parameters']) && value['parameters'].length === 0;
}

function sameLocator(left: AgentLocator | null, right: AgentLocator | null): boolean {
  return left !== null && right !== null && left.substrate === right.substrate && left.path === right.path;
}

/**
 * Validate model-selected locators against the planner's exact tool list and snapshot.
 * Any malformed or unapproved action rejects the whole proposal turn, so a caller cannot
 * combine genuine reads with one forged value/locator and still register a partial batch.
 */
export function selectProdConsoleReads(input: {
  readonly planner: ProdConsoleToolPlannerResult;
  readonly proposals: readonly AgentActionProposal[];
}): ProdConsoleProposalSelection {
  const byTool = new Map(input.planner.tools.map((tool) => [tool.toolId, tool]));
  const byPath = new Map(input.planner.reads.map((read) => [read.tool.locator?.path ?? '', read]));
  const parsed = readStructuralSnapshot(input.planner.snapshot);
  if (!parsed.ok || parsed.substrate !== 'web_tree') {
    return { accepted: false, reads: [], diagnostics: ['snapshot-unreadable'] };
  }
  const reads: ProdConsoleSelectedRead[] = [];
  const seenTools = new Set<string>();
  const diagnostics: ProdConsoleDiagnostic[] = [];
  for (const proposal of input.proposals) {
    if (!proposalShape(proposal)) {
      diagnostics.push('model-action-locator');
      continue;
    }
    const tool = byTool.get(proposal.toolId);
    if (tool === undefined) {
      diagnostics.push('model-action-not-approved');
      continue;
    }
    if (seenTools.has(tool.toolId)) {
      diagnostics.push('model-action-duplicate');
      continue;
    }
    seenTools.add(tool.toolId);
    if (proposal.action !== tool.action || proposal.destination !== tool.destination) {
      diagnostics.push('model-action-not-approved');
      continue;
    }
    if (proposal.parameters.length !== 0) {
      diagnostics.push('model-action-parameters');
      continue;
    }
    if (!sameLocator(proposal.locator, tool.locator)) {
      diagnostics.push('model-action-locator');
      continue;
    }
    const read = byPath.get(tool.locator?.path ?? '');
    const locator = parseSnapshotLocator(tool.locator?.path);
    const cell = locator === null ? null : readSnapshotCell(parsed, locator);
    const node = locator === null ? undefined : parsed.document.nodes[locator.index];
    if (
      read === undefined ||
      cell === null ||
      node === undefined ||
      node.role !== 'datum' ||
      node.group !== read.group ||
      cell.label !== read.label ||
      tool.action !== actionForLabel(read.label) ||
      !sameLocator(proposal.locator, { substrate: 'web_tree', path: webTreePath(read.index) })
    ) {
      diagnostics.push('model-action-cell');
      continue;
    }
    reads.push({ proposal, tool, index: read.index, group: read.group, label: read.label, cell });
  }
  return {
    accepted: diagnostics.length === 0,
    reads: diagnostics.length === 0 ? reads : [],
    diagnostics: [...new Set(diagnostics)],
  };
}

function baselineIndex(population: readonly PopulationRecord[], lookupColumn: string): ProdConsoleBaselineIndex {
  const rowsByParameter = new Map<string, PopulationRecord[]>();
  let unkeyedRows = 0;
  let malformedRows = 0;
  for (const row of population) {
    const parameter = row.values[lookupColumn];
    if (typeof parameter !== 'string' || parameter.length === 0 || parameter.length > OBSERVATION_LIMITS.text) {
      unkeyedRows += 1;
      continue;
    }
    const existing = rowsByParameter.get(parameter);
    if (existing === undefined) rowsByParameter.set(parameter, [row]);
    else existing.push(row);
    const approved = row.values['approved_value'];
    const effective = row.values['effective_time'];
    const disposition = row.values['disposition'];
    if (
      typeof approved !== 'string' ||
      typeof effective !== 'string' ||
      (disposition !== 'approved' && disposition !== 'prohibited')
    ) malformedRows += 1;
  }
  const readonlyRows = new Map<string, readonly PopulationRecord[]>();
  const unique = new Map<string, PopulationRecord | null>();
  const duplicateParameters: string[] = [];
  for (const [parameter, rows] of rowsByParameter) {
    readonlyRows.set(parameter, [...rows]);
    if (rows.length === 1) unique.set(parameter, rows[0]!);
    else {
      unique.set(parameter, null);
      duplicateParameters.push(parameter);
    }
  }
  return {
    parameterKeys: [...rowsByParameter.keys()],
    rowsByParameter: readonlyRows,
    uniqueRowByParameter: unique,
    duplicateParameters,
    unkeyedRows,
    malformedRows,
  };
}

function validCount(value: JsonValue): number | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function metadataCell(
  selection: ProdConsoleProposalSelection,
  label: ProdConsoleLabel,
): readonly ProdConsoleSelectedRead[] {
  return selection.reads.filter((read) => read.label === label);
}

function oneMetadata(
  selection: ProdConsoleProposalSelection,
  label: ProdConsoleLabel,
  planner: ProdConsoleToolPlannerResult,
): ProdConsoleSelectedRead | null {
  const page = planner.reads.filter((read) => read.label === label);
  const matches = metadataCell(selection, label);
  // A page-level metadata label is a singleton contract. Selecting one of two identical
  // labels would be first-wins data loss, even if the model happened to choose the first
  // node, so duplicates remain unknown.
  return page.length === 1 && matches.length === 1 ? matches[0]! : null;
}

function metadataFrom(selection: ProdConsoleProposalSelection, planner: ProdConsoleToolPlannerResult): {
  readonly metadata: ProdConsoleMetadata;
  readonly diagnostics: readonly ProdConsoleDiagnostic[];
} {
  const diagnostics: ProdConsoleDiagnostic[] = [];
  const identifierReads = metadataCell(selection, PROD_CONSOLE_LABELS.snapshotIdentifier);
  const countReads = metadataCell(selection, PROD_CONSOLE_LABELS.expectedParameterCount);
  const timeReads = metadataCell(selection, PROD_CONSOLE_LABELS.snapshotTakenAt);
  const identifierPageReads = planner.reads.filter((read) => read.label === PROD_CONSOLE_LABELS.snapshotIdentifier);
  const countPageReads = planner.reads.filter((read) => read.label === PROD_CONSOLE_LABELS.expectedParameterCount);
  const timePageReads = planner.reads.filter((read) => read.label === PROD_CONSOLE_LABELS.snapshotTakenAt);
  if (identifierPageReads.length !== 1 || identifierReads.length === 0) diagnostics.push('metadata-missing');
  if (identifierPageReads.length > 1 || identifierReads.length > 1) diagnostics.push('metadata-duplicate');
  if (countPageReads.length !== 1 || countReads.length === 0) diagnostics.push('metadata-missing');
  if (countPageReads.length > 1 || countReads.length > 1) diagnostics.push('metadata-duplicate');
  if (timePageReads.length > 1 || timeReads.length > 1) diagnostics.push('metadata-duplicate');
  const identifier = oneMetadata(selection, PROD_CONSOLE_LABELS.snapshotIdentifier, planner);
  const count = oneMetadata(selection, PROD_CONSOLE_LABELS.expectedParameterCount, planner);
  const time = oneMetadata(selection, PROD_CONSOLE_LABELS.snapshotTakenAt, planner);
  const snapshotIdentifier = identifier !== null && typeof identifier.cell.value === 'string' && identifier.cell.value.length > 0
    ? identifier.cell.value
    : null;
  if (identifier !== null && snapshotIdentifier === null) diagnostics.push('metadata-invalid');
  const expectedParameterCount = count === null ? null : validCount(count.cell.value);
  if (count !== null && expectedParameterCount === null) diagnostics.push('metadata-invalid');
  const snapshotTakenAt = time !== null && typeof time.cell.value === 'string' && normalizeObservedAt(time.cell.value) !== null
    ? time.cell.value
    : null;
  if (time !== null && snapshotTakenAt === null) diagnostics.push('metadata-invalid');
  return {
    metadata: {
      snapshotIdentifier,
      snapshotIdentifierLocator: snapshotIdentifier === null ? null : identifier!.tool.locator!.path,
      expectedParameterCount,
      expectedParameterCountLocator: expectedParameterCount === null ? null : count!.tool.locator!.path,
      snapshotTakenAt,
      snapshotTakenAtLocator: snapshotTakenAt === null ? null : time!.tool.locator!.path,
    },
    diagnostics,
  };
}

function groundedAttribute(
  name: string,
  valueType: string,
  evidenceId: string,
  locator: string,
  cell: SnapshotCell | null,
): ObservationAttribute {
  if (cell === null) {
    return { name, originalValue: null, normalizedValue: null, grounding: null, corroboration: null };
  }
  return {
    name,
    originalValue: cell.value,
    normalizedValue: normalizeObservationValue(valueType, cell.value),
    grounding: {
      evidenceId,
      locator,
      label: cell.label,
      extractedText: groundedText(cell.value),
    },
    corroboration: null,
  };
}

function emptyAttribute(name: string): ObservationAttribute {
  return { name, originalValue: null, normalizedValue: null, grounding: null, corroboration: null };
}

function actionForLabelRead(
  reads: readonly ProdConsoleSelectedRead[],
  label: ProdConsoleLabel,
  group: string,
): readonly ProdConsoleSelectedRead[] {
  return reads.filter((read) => read.label === label && read.group === group);
}

function makeObservation(input: {
  readonly workItemId: string;
  readonly stepExecutionId: string;
  readonly targetSystem: string;
  readonly lookupColumn: string;
  readonly snapshot: StoredSnapshot;
  readonly screenshotEvidenceId: string | null;
  readonly observedAt: { readonly observedAt: string; readonly source: string };
  readonly parameter: string;
  readonly candidate: ProdConsoleSelectedRead | null;
  readonly candidates: readonly ProdConsoleSelectedRead[];
  readonly pageDuplicate: boolean;
  readonly reads: readonly ProdConsoleSelectedRead[];
  readonly observationTime: ProdConsoleSelectedRead | null;
}): ObservationBatchItem {
  const found = input.pageDuplicate || input.candidates.length > 1
    ? 'ambiguous'
    : input.candidates.length === 1
      ? 'true'
      : 'false';
  const identity = input.candidate === null || found !== 'true'
    ? null
    : groundedAttribute(input.lookupColumn, 'text', input.snapshot.evidenceId, input.candidate.tool.locator!.path, input.candidate.cell);
  const values = input.candidate === null || found !== 'true'
    ? []
    : actionForLabelRead(input.reads, PROD_CONSOLE_LABELS.value, input.candidate.group);
  const value = values.length === 1 ? values[0]! : null;
  const observationTimeCell = input.observationTime;
  const attributes: ObservationAttribute[] = [
    value === null
      ? emptyAttribute('observed_value')
      : groundedAttribute('observed_value', 'text', input.snapshot.evidenceId, value.tool.locator!.path, value.cell),
    observationTimeCell === null
      ? emptyAttribute('observation_time')
      : groundedAttribute('observation_time', 'time', input.snapshot.evidenceId, observationTimeCell.tool.locator!.path, observationTimeCell.cell),
  ];
  const evidenceIds = input.screenshotEvidenceId === null
    ? [input.snapshot.evidenceId]
    : [input.snapshot.evidenceId, input.screenshotEvidenceId];
  const record: ObservationRecord = {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    observationId: observationIdFor(input.workItemId, input.parameter),
    workItemId: input.workItemId,
    populationRecordKey: input.parameter,
    targetSystem: input.targetSystem,
    found,
    observedAt: input.observedAt.observedAt,
    stepExecutionId: input.stepExecutionId,
    captureMethod: 'agent',
    matchOrigin: 'platform',
    identity,
    attributes,
    evidenceIds,
  };
  return {
    record,
    observedAtSource: input.observedAt.source,
    absence: null,
    expectedQueryKeys: [{ key: input.lookupColumn, value: input.parameter }],
  };
}

/**
 * Build the one P-4 batch. The baseline is indexed first; each distinct usable key gets
 * exactly one item even when the page is missing it. Every target value is read from the
 * stored snapshot at a model-approved locator. No branch reads a model-authored value or
 * imports a fixture. The caller passes the returned items to `registerObservations` and
 * the returned `baseline` index to the existing rule-evaluation/shared Gate loop.
 */
export function buildProdConsoleObservationBatch(
  input: ProdConsoleObservationBatchInput,
): ProdConsoleObservationBatch | null {
  const valid = validP4Input(input.plan, input.target, input.snapshot, input.planner.sourceLocation);
  if (valid === null || input.planner.snapshot.evidenceId !== input.snapshot.evidenceId || !sameBytes(input.planner.snapshot.bytes, input.snapshot.bytes)) return null;
  const canonicalPlanner = planProdConsoleTools({
    plan: input.plan,
    target: input.target,
    snapshot: input.snapshot,
    sourceLocation: input.planner.sourceLocation,
  });
  if (canonicalPlanner === null) return null;
  try {
    if (canonicalJson(canonicalPlanner.tools as unknown as JsonValue) !== canonicalJson(input.planner.tools as unknown as JsonValue)) return null;
    if (canonicalJson(canonicalPlanner.reads as unknown as JsonValue) !== canonicalJson(input.planner.reads as unknown as JsonValue)) return null;
  } catch {
    return null;
  }
  if (input.screenshotEvidenceId !== null && !validText(input.screenshotEvidenceId)) return null;
  const observedAt = normalizeObservedAt(input.observedAt);
  if (observedAt === null || input.workItemId.length === 0 || input.stepExecutionId.length === 0) return null;
  const baseline = baselineIndex(input.population, valid.lookupColumn);
  const proposal = selectProdConsoleReads({ planner: input.planner, proposals: input.proposals });
  if (!proposal.accepted) return null;
  const metadataResult = metadataFrom(proposal, input.planner);
  const metadata = metadataResult.metadata;
  const diagnostics: ProdConsoleDiagnostic[] = [...metadataResult.diagnostics];
  if (baseline.unkeyedRows > 0 || baseline.malformedRows > 0) diagnostics.push('baseline-parameter-invalid');
  const parameterReads = proposal.reads.filter((read) => read.label === PROD_CONSOLE_LABELS.parameter);
  const pageParameterReads = input.planner.reads.filter((read) => read.label === PROD_CONSOLE_LABELS.parameter);
  const byParameter = new Map<string, ProdConsoleSelectedRead[]>();
  const pageByParameter = new Map<string, ProdConsoleApprovedRead[]>();
  const extraParameters: string[] = [];
  for (const read of pageParameterReads) {
    if (typeof read.cell.value !== 'string' || read.cell.value.length === 0) continue;
    const parameter = read.cell.value;
    const existing = pageByParameter.get(parameter);
    if (existing === undefined) pageByParameter.set(parameter, [read]);
    else existing.push(read);
    if (!baseline.rowsByParameter.has(parameter)) extraParameters.push(parameter);
  }
  for (const read of parameterReads) {
    if (typeof read.cell.value !== 'string' || read.cell.value.length === 0) continue;
    const parameter = read.cell.value;
    const existing = byParameter.get(parameter);
    if (existing === undefined) byParameter.set(parameter, [read]);
    else existing.push(read);
  }
  const duplicateParameters = [...new Set([
    ...[...pageByParameter.entries()].filter(([, reads]) => reads.length > 1).map(([parameter]) => parameter),
    ...[...byParameter.entries()].filter(([, reads]) => reads.length > 1).map(([parameter]) => parameter),
  ])];
  const missingParameters = baseline.parameterKeys.filter((parameter) => !byParameter.has(parameter));
  if (missingParameters.length > 0) diagnostics.push('parameter-missing');
  if (duplicateParameters.length > 0) diagnostics.push('parameter-duplicate');
  if (extraParameters.length > 0) diagnostics.push('parameter-extra');
  const observationTime = oneMetadata(proposal, PROD_CONSOLE_LABELS.snapshotTakenAt, input.planner);
  if (observationTime === null) diagnostics.push('observation-time-missing');
  const items: ObservationBatchItem[] = [];
  for (const parameter of baseline.parameterKeys) {
    const candidates = byParameter.get(parameter) ?? [];
    const pageCandidates = pageByParameter.get(parameter) ?? [];
    const candidate = candidates.length === 1 && pageCandidates.length === 1 ? candidates[0]! : null;
    items.push(makeObservation({
      workItemId: input.workItemId,
      stepExecutionId: input.stepExecutionId,
      targetSystem: input.target.registrationId,
      lookupColumn: valid.lookupColumn,
      snapshot: input.snapshot,
      screenshotEvidenceId: input.screenshotEvidenceId,
      observedAt: { observedAt: observedAt.observedAt, source: input.observedAt },
      parameter,
      candidate,
      candidates,
      pageDuplicate: pageCandidates.length > 1,
      reads: proposal.reads,
      observationTime,
    }));
  }
  const count: ProdConsoleCountReconciliation = {
    declared: metadata.expectedParameterCount,
    registeredObservations: items.length,
    matches: metadata.expectedParameterCount === null ? null : declaredCountMatches(metadata.expectedParameterCount, items.length),
    pageParameterCount: input.planner.pageParameterCount,
  };
  if (count.matches === false || count.matches === null) diagnostics.push('count-mismatch');
  return {
    items,
    baseline,
    metadata,
    count,
    selectedParameterCount: parameterReads.length,
    missingParameters,
    duplicateParameters,
    extraParameters: [...new Set(extraParameters)],
    diagnostics: [...new Set(diagnostics)],
    proposal,
  };
}

/** Alias using the shorter name used by the agent Work Item composition root. */
export const buildProdConsoleObservations = buildProdConsoleObservationBatch;

/**
 * Materialize the single page-level Work Item. IDs and operational counters come from the
 * caller's durable claim; this function does not mint identity or infer attempts.
 */
export function buildProdConsoleWorkItem(input: ProdConsoleWorkItemInput): WorkItemRecord | null {
  if (
    !validText(input.workItemId) ||
    !validText(input.stepId) ||
    !Number.isSafeInteger(input.ordinal) ||
    input.ordinal < 1 ||
    !Number.isSafeInteger(input.observations) ||
    input.observations < 0 ||
    input.target.contract.kind !== 'web' ||
    input.existing !== undefined && input.existing.workItemId !== input.workItemId
  ) return null;
  return {
    workItemId: input.workItemId,
    subjectKey: null,
    stepId: input.stepId,
    ordinal: input.ordinal,
    registrationId: input.target.registrationId,
    displayName: input.target.displayName,
    state: input.state ?? input.existing?.state ?? 'OBSERVED',
    attempts: input.attempts ?? input.existing?.attempts ?? 0,
    cycles: input.cycles ?? input.existing?.cycles ?? 0,
    diagnostic: input.diagnostic ?? input.existing?.diagnostic ?? null,
    evidenceId: input.evidenceId ?? input.existing?.evidenceId ?? null,
    observations: input.observations,
  };
}
