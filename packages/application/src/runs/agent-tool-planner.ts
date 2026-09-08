import {
  adapterLookupColumn,
  adapterSearchKeys,
  canonicalJson,
  findProcedureTemplate,
  isPermittedReadAction,
  parseFrozenLocation,
  readStructuralSnapshot,
  webTreeValueLocator,
  withinFrozenOrigin,
  type ExecutablePlan,
  type JsonValue,
  type PermittedReadAction,
  type ProcedureTargetSnapshot,
  type SanitizedToolAction,
  type StoredSnapshot,
  type ToolActionParameter,
  type WebTreeDocument,
  type WebTreeNode,
} from '@intellifin/domain';
import type { AgentFieldSelection } from './agent-observation.js';
import type { PopulationRecord } from './execution-ports.js';
import type { AgentApprovedTool } from './agent-ports.js';

const P1_TEMPLATE = 'P-1' as const;
const MAX_TOOL_OPTIONS = 128;

/** A successful search action and the structural snapshot captured for that action. */
export interface AgentSearchEvidence {
  readonly parameters: readonly ToolActionParameter[];
  readonly snapshot: StoredSnapshot;
  /** Optional pre-search snapshot used to prove each parameter name/label binding. */
  readonly controlSnapshot?: StoredSnapshot;
  /** The root may retain this binding when it has it; it is never model supplied. */
  readonly lookupKey?: string;
}

/** Structural alias for callers that pass the sanitized action before projecting it. */
export type AgentSearchHistoryEntry = Pick<SanitizedToolAction, 'parameters'> & {
  readonly snapshot: StoredSnapshot;
  readonly controlSnapshot?: StoredSnapshot;
  readonly lookupKey?: string;
};

export interface AgentToolPlannerInput {
  readonly plan: ExecutablePlan;
  readonly target: ProcedureTargetSnapshot;
  readonly population: PopulationRecord;
  readonly snapshot: StoredSnapshot;
  /** The current page location, including a query if the browser has one. */
  readonly sourceLocation: string;
  /** Snapshots bound to successful, platform-recorded search actions. */
  readonly searches: readonly AgentSearchEvidence[];
}

/** One grounded candidate surfaced for a later human choice. Values stay in the frozen page. */
export interface AgentCandidateOption {
  readonly id: string;
  readonly label: string;
  readonly identityLocator: string | null;
}

/** The unique primary match and the frozen field locators root passes to observation code. */
export interface AgentFoundSelection {
  readonly identityLocator: string;
  readonly selections: readonly AgentFieldSelection[];
}

/** The exact loop seam: model-safe tools, gate parameters, grounded choice, and absence proof. */
export interface AgentToolPlannerResult {
  readonly tools: readonly AgentApprovedTool[];
  readonly parametersByToolId: Readonly<Record<string, readonly ToolActionParameter[]>>;
  readonly found: AgentFoundSelection | null;
  readonly candidates: readonly AgentCandidateOption[];
  readonly absenceReady: boolean;
}

interface LookupSpec {
  readonly key: string;
  readonly value: string;
  readonly label: string;
}

interface IndexedNode {
  readonly index: number;
  readonly node: WebTreeNode;
}

interface InternalOption {
  readonly tool: AgentApprovedTool;
  readonly parameters: readonly ToolActionParameter[];
}

interface CandidateBuild {
  readonly found: AgentFoundSelection | null;
  readonly candidates: readonly AgentCandidateOption[];
  readonly fatal: boolean;
}

function emptyResult(): AgentToolPlannerResult {
  return {
    tools: [],
    parametersByToolId: {},
    found: null,
    candidates: [],
    absenceReady: false,
  };
}

function exactStringRecordValue(population: PopulationRecord, key: string): string | null {
  const values = population.values;
  if (typeof values !== 'object' || values === null || Array.isArray(values) || !Object.hasOwn(values, key)) {
    return null;
  }
  const value = values[key];
  return typeof value === 'string' && value.length > 0 && value.trim().length > 0 ? value : null;
}

function sameFrozenTarget(plan: ExecutablePlan, target: ProcedureTargetSnapshot): boolean {
  if (!Array.isArray(plan.inputs.targets)) return false;
  const planned = plan.inputs.targets.find((candidate) => candidate.registrationId === target.registrationId);
  if (planned === undefined) return false;
  try {
    return (
      planned.displayName === target.displayName &&
      planned.digest === target.digest &&
      canonicalJson(planned.contract as unknown as JsonValue) ===
        canonicalJson(target.contract as unknown as JsonValue)
    );
  } catch {
    return false;
  }
}

function validWebTarget(target: ProcedureTargetSnapshot): boolean {
  return (
    target.contract.kind === 'web' &&
    Array.isArray(target.contract.allowed_origins) &&
    target.contract.allowed_origins.length > 0 &&
    target.contract.allowed_origins.every((origin) => parseFrozenLocation(origin) !== null) &&
    Array.isArray(target.contract.attribute_label_patterns) &&
    target.contract.attribute_label_patterns.every((label) => typeof label === 'string' && label.length > 0) &&
    Array.isArray(target.contract.permitted_actions) &&
    target.contract.permitted_actions.every(isPermittedReadAction)
  );
}

function targetAllows(target: ProcedureTargetSnapshot, action: PermittedReadAction): boolean {
  return target.contract.permitted_actions.includes(action);
}

function targetLabelAllowed(target: ProcedureTargetSnapshot, label: string): boolean {
  return target.contract.attribute_label_patterns.includes(label);
}

function safeLocation(raw: string): string | null {
  const parsed = parseFrozenLocation(raw);
  return parsed === null ? null : `${parsed.authority}${parsed.path}`;
}

function inTargetOrigins(target: ProcedureTargetSnapshot, location: string): boolean {
  return target.contract.allowed_origins.some((origin) => withinFrozenOrigin(origin, location));
}

function nodePath(index: number): string | null {
  return webTreeValueLocator(index);
}

function addOption(
  options: InternalOption[],
  action: PermittedReadAction,
  destination: string,
  locator: { readonly substrate: 'web_tree'; readonly path: string } | null,
  description: string,
  parameterNames: readonly string[],
  index: number,
  parameters: readonly ToolActionParameter[],
): boolean {
  const id = `agent-${action}-${String(index)}`;
  options.push({
    tool: {
      toolId: id,
      action,
      destination,
      locator,
      description,
      parameterNames,
    },
    parameters,
  });
  return options.length <= MAX_TOOL_OPTIONS;
}

function indexed(document: WebTreeDocument): readonly IndexedNode[] {
  return document.nodes.map((node, index) => ({ node, index }));
}

function dataNodes(document: WebTreeDocument, label: string, value: string): readonly IndexedNode[] {
  return indexed(document).filter(
    ({ node }) => node.role === 'datum' && node.label === label && typeof node.value === 'string' && node.value === value,
  );
}

/** Match all same-valued data cells so a drifted label cannot hide a duplicate identity. */
function identityValueNodes(document: WebTreeDocument, value: string): readonly IndexedNode[] {
  return indexed(document).filter(
    ({ node }) => node.role === 'datum' && typeof node.value === 'string' && node.value === value,
  );
}

function candidateLabel(
  document: WebTreeDocument,
  group: string,
  secondary: LookupSpec,
  identity: IndexedNode | undefined,
): string {
  const secondaryCell = indexed(document).find(
    ({ node }) => node.group === group && node.role === 'datum' && node.label === secondary.label,
  );
  if (secondaryCell !== undefined && typeof secondaryCell.node.value === 'string') {
    return secondaryCell.node.value;
  }
  if (identity !== undefined && typeof identity.node.value === 'string') return identity.node.value;
  return group;
}

function declaredFields(
  plan: ExecutablePlan,
  target: ProcedureTargetSnapshot,
): readonly { readonly attributeName: string; readonly label: string }[] {
  const labels = findProcedureTemplate(P1_TEMPLATE).declaredAttributeLabels;
  if (labels === null || !Array.isArray(plan.observations)) return [];
  const declared = new Set(plan.observations.map((observation) => observation.attributeName));
  return Object.entries(labels)
    .filter(([attributeName]) => attributeName !== 'identity' && attributeName !== 'found')
    .filter(([attributeName]) => declared.has(attributeName))
    .filter(([, label]) => targetLabelAllowed(target, label))
    .map(([attributeName, label]) => ({ attributeName, label }));
}

function buildCandidate(
  document: WebTreeDocument,
  plan: ExecutablePlan,
  target: ProcedureTargetSnapshot,
  primary: LookupSpec,
  secondary: LookupSpec,
): CandidateBuild {
  const primaryValues = identityValueNodes(document, primary.value);
  const groups = new Map<string, IndexedNode[]>();
  for (const match of primaryValues) {
    const list = groups.get(match.node.group) ?? [];
    list.push(match);
    groups.set(match.node.group, list);
  }
  if (primaryValues.length > 1 || groups.size > 1) {
    return {
      found: null,
      candidates: [...groups.entries()].map(([group, matches], index) => ({
        id: `candidate-${String(matches[0]?.index ?? index)}`,
        label: candidateLabel(document, group, secondary, matches[0]),
        identityLocator: nodePath(matches[0]?.index ?? -1),
      })),
      fatal: true,
    };
  }
  if (primaryValues.length === 1) {
    const identity = primaryValues[0]!;
    if (identity.node.label !== primary.label) return { found: null, candidates: [], fatal: true };
    const group = identity.node.group;
    const fields = declaredFields(plan, target);
    const selections: AgentFieldSelection[] = [];
    let fatal = false;
    for (const field of fields) {
      const cells = indexed(document).filter(
        ({ node }) => node.group === group && node.role === 'datum' && node.label === field.label,
      );
      const controls = document.nodes.some(
        (node) =>
          node.group === group &&
          (node.role === 'input' || node.role === 'button' || node.role === 'link') &&
          node.label === field.label,
      );
      if (cells.length > 1) {
        fatal = true;
      } else if (cells.length === 1) {
        const path = nodePath(cells[0]!.index);
        if (path !== null) selections.push({ attributeName: field.attributeName, locator: path });
      } else if (controls) {
        // A filter/status control never becomes an observation value. Keep it unselected.
      }
    }
    const identityLocator = nodePath(identity.index);
    if (identityLocator === null || fatal) return { found: null, candidates: [], fatal: true };
    return { found: { identityLocator, selections }, candidates: [], fatal: false };
  }

  const secondaryMatches = dataNodes(document, secondary.label, secondary.value);
  if (secondaryMatches.length === 0) return { found: null, candidates: [], fatal: false };
  const secondaryGroups = new Map<string, IndexedNode[]>();
  for (const match of secondaryMatches) {
    const list = secondaryGroups.get(match.node.group) ?? [];
    list.push(match);
    secondaryGroups.set(match.node.group, list);
  }
  if (secondaryMatches.length > 1 || secondaryGroups.size > 1) {
    return {
      found: null,
      candidates: [...secondaryGroups.entries()].map(([group, matches], index) => ({
        id: `candidate-${String(matches[0]?.index ?? index)}`,
        label: candidateLabel(document, group, secondary, matches[0]),
        identityLocator: null,
      })),
      fatal: true,
    };
  }
  const match = secondaryMatches[0]!;
  return {
    found: null,
    candidates: [{
      id: `candidate-${String(match.index)}`,
      label: candidateLabel(document, match.node.group, secondary, match),
      identityLocator: null,
    }],
    fatal: true,
  };
}

function searchKeysForEvidence(
  evidence: AgentSearchEvidence,
  lookups: readonly LookupSpec[],
): ReadonlySet<string> | null {
  if (!Array.isArray(evidence.parameters) || evidence.parameters.length === 0) return null;
  // The submitted control is grounded in its pre-search capture. The result may
  // render the same form again: those are two moments, not two ambiguous controls.
  // Older evidence without a pre-search capture still has its one recorded page;
  // an invalid supplied pre-search page must never fall back to a different page.
  const controlSnapshots = [evidence.controlSnapshot ?? evidence.snapshot];
  const controls = controlSnapshots.flatMap((snapshot) => {
    if (snapshot.substrate !== 'web_tree') return [];
    const parsed = readStructuralSnapshot(snapshot);
    if (!parsed.ok || parsed.substrate !== 'web_tree') return [];
    return parsed.document.nodes.filter((node) => node.role === 'input');
  });
  const keys = new Set<string>();
  for (const parameter of evidence.parameters) {
    const matches = lookups.filter((lookup) => lookup.value === parameter.value);
    if (matches.length !== 1) return null;
    const key = evidence.lookupKey ?? matches[0]!.key;
    const groundedControl = controls.filter(
      (control) =>
        control.target === parameter.name &&
        control.label === matches[0]!.label,
    );
    if (
      key !== matches[0]!.key ||
      groundedControl.length !== 1 ||
      keys.has(key)
    ) return null;
    keys.add(key);
  }
  return keys;
}

function completeZero(snapshot: StoredSnapshot): boolean {
  if (snapshot.substrate !== 'web_tree') return false;
  const parsed = readStructuralSnapshot(snapshot);
  return (
    parsed.ok &&
    parsed.substrate === 'web_tree' &&
    parsed.document.completion?.complete === true &&
    parsed.document.completion.returned === 0
  );
}

function addLinkOptions(
  options: InternalOption[],
  document: WebTreeDocument,
  target: ProcedureTargetSnapshot,
  primary: LookupSpec,
  secondary: LookupSpec,
): boolean {
  const identityGroups = new Set(
    identityValueNodes(document, primary.value)
      .filter(({ node }) => node.label === primary.label)
      .map(({ node }) => node.group),
  );
  const hasDeclaredIdentityDatum = indexed(document).some(
    ({ node }) =>
      node.role === 'datum' &&
      (node.label === primary.label || node.label === secondary.label),
  );
  const seen = new Set<string>();
  for (const [index, node] of document.nodes.entries()) {
    if (node.role !== 'link' || node.target === null || node.target.includes('?') || node.target.includes('#')) continue;
    const destination = safeLocation(node.target);
    if (destination === null || !inTargetOrigins(target, destination) || seen.has(destination)) continue;
    const recordLink =
      identityGroups.has(node.group) ||
      (identityGroups.size === 1 && pathCarriesExactKey(destination, primary.value));
    // A landing page has no grounded identity, so it cannot authorize an
    // open-record action. It may still publish a query-free, same-origin page
    // link for the model to select as navigation. The link target itself is
    // copied into the approved tool; the model cannot author a route or query.
    if (!recordLink && (hasDeclaredIdentityDatum || !targetAllows(target, 'navigate'))) continue;
    const action: PermittedReadAction | null = recordLink
      ? targetAllows(target, 'open-record')
        ? 'open-record'
        : targetAllows(target, 'navigate')
          ? 'navigate'
          : null
      : 'navigate';
    if (action === null) continue;
    const path = nodePath(index);
    if (path === null) continue;
    seen.add(destination);
    if (!addOption(
      options,
      action,
      destination,
      { substrate: 'web_tree', path },
      action === 'open-record' ? 'Open the approved linked record.' : 'Navigate to the approved linked page.',
      [],
      index,
      [],
    )) return false;
  }
  return true;
}

function pathCarriesExactKey(destination: string, value: string): boolean {
  const parsed = parseFrozenLocation(destination);
  if (parsed === null) return false;
  return parsed.path.split('/').some((segment) => {
    try {
      return decodeURIComponent(segment) === value;
    } catch {
      return false;
    }
  });
}

function addSearchOption(
  options: InternalOption[],
  document: WebTreeDocument,
  target: ProcedureTargetSnapshot,
  destination: string,
  next: LookupSpec | undefined,
): boolean {
  if (next === undefined || !targetAllows(target, 'search')) return true;
  const controls = indexed(document).filter(
    ({ node }) =>
      node.role === 'input' &&
      node.target !== null &&
      node.label === next.label &&
      targetLabelAllowed(target, node.label),
  );
  if (controls.length > 1) return false;
  const control = controls[0];
  if (control === undefined || control.node.target === null) return true;
  const path = nodePath(control.index);
  if (path === null) return true;
  return addOption(
    options,
    'search',
    destination,
    { substrate: 'web_tree', path },
    'Search with the approved population key.',
    [control.node.target],
    control.index,
    [{ name: control.node.target, value: next.value }],
  );
}

function addReadOptions(
  options: InternalOption[],
  target: ProcedureTargetSnapshot,
  destination: string,
  document: WebTreeDocument,
  found: AgentFoundSelection | null,
): boolean {
  if (found === null || !targetAllows(target, 'read-attribute')) return true;
  for (const selection of found.selections) {
    const match = /^\$\.nodes\[(0|[1-9][0-9]*)\]\.value$/u.exec(selection.locator);
    if (match === null) continue;
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || document.nodes[index] === undefined) continue;
    if (!addOption(
      options,
      'read-attribute',
      destination,
      { substrate: 'web_tree', path: selection.locator },
      'Read the approved field from the frozen page.',
      [],
      index,
      [],
    )) return false;
  }
  return true;
}

function addScreenshotOption(
  options: InternalOption[],
  target: ProcedureTargetSnapshot,
  destination: string,
): boolean {
  if (!targetAllows(target, 'capture-screenshot')) return true;
  return addOption(
    options,
    'capture-screenshot',
    destination,
    null,
    'Capture the approved page screenshot.',
    [],
    0,
    [],
  );
}

function output(
  options: readonly InternalOption[],
  found: AgentFoundSelection | null,
  candidates: readonly AgentCandidateOption[],
  absenceReady: boolean,
): AgentToolPlannerResult {
  const parametersByToolId: Record<string, readonly ToolActionParameter[]> = {};
  for (const entry of options) parametersByToolId[entry.tool.toolId] = entry.parameters;
  return {
    tools: options.map(({ tool }) => tool),
    parametersByToolId,
    found,
    candidates,
    absenceReady,
  };
}

/**
 * Build the next model choices from one current frozen web-tree snapshot.
 *
 * The model receives only `tools`; exact values are held in `parametersByToolId` for the
 * root's gate call. Observation values are never returned by this function: `found` contains
 * locators only, and the existing observation builder re-reads the selected snapshot bytes.
 */
export function planAgentTools(input: AgentToolPlannerInput): AgentToolPlannerResult {
  const plan = input.plan;
  if (plan.schemaVersion !== 1 || plan.compilerVersion !== '1' || plan.inputs.templateId !== P1_TEMPLATE) {
    return emptyResult();
  }
  if (!sameFrozenTarget(plan, input.target) || !validWebTarget(input.target)) return emptyResult();
  const template = findProcedureTemplate(P1_TEMPLATE);
  const labels = template.declaredAttributeLabels;
  const primaryKey = adapterLookupColumn(P1_TEMPLATE);
  const searchKeys = adapterSearchKeys(P1_TEMPLATE);
  const secondaryLabel = input.target.contract.secondary_key;
  if (
    labels === null ||
    primaryKey === null ||
    searchKeys === null ||
    searchKeys.length < 2 ||
    secondaryLabel === null ||
    secondaryLabel.length === 0
  ) return emptyResult();
  const identityLabel = labels.identity;
  if (
    typeof identityLabel !== 'string' ||
    !targetLabelAllowed(input.target, identityLabel) ||
    !targetLabelAllowed(input.target, secondaryLabel)
  ) return emptyResult();
  const primaryValue = exactStringRecordValue(input.population, primaryKey);
  const secondaryKey = searchKeys.find((key) => key !== primaryKey);
  if (primaryValue === null || secondaryKey === undefined) return emptyResult();
  const secondaryValue = exactStringRecordValue(input.population, secondaryKey);
  if (secondaryValue === null) return emptyResult();
  if (input.snapshot.substrate !== 'web_tree') return emptyResult();
  const parsed = readStructuralSnapshot(input.snapshot);
  if (!parsed.ok || parsed.substrate !== 'web_tree') return emptyResult();
  const destination = safeLocation(input.sourceLocation);
  if (destination === null || !inTargetOrigins(input.target, destination)) return emptyResult();
  if (!Array.isArray(input.searches)) return emptyResult();

  const primary: LookupSpec = { key: primaryKey, value: primaryValue, label: identityLabel };
  const secondary: LookupSpec = { key: secondaryKey, value: secondaryValue, label: secondaryLabel };
  const lookups = [primary, secondary] as const;
  const attempted = new Set<string>();
  const zeroByKey = new Set<string>();
  for (const evidence of input.searches) {
    if (evidence.snapshot.substrate !== 'web_tree') continue;
    const evidenceSnapshot = readStructuralSnapshot(evidence.snapshot);
    if (!evidenceSnapshot.ok || evidenceSnapshot.substrate !== 'web_tree') continue;
    const keys = searchKeysForEvidence(evidence, lookups);
    if (keys === null) continue;
    for (const key of keys) attempted.add(key);
    if (completeZero(evidence.snapshot)) for (const key of keys) zeroByKey.add(key);
  }
  const currentCompleteZero = completeZero(input.snapshot);
  const absenceReady = currentCompleteZero && lookups.every(({ key }) => zeroByKey.has(key));
  const next = attempted.has(primary.key) ? (attempted.has(secondary.key) ? undefined : secondary) : primary;

  const candidate = buildCandidate(parsed.document, plan, input.target, primary, secondary);
  // An ambiguous or malformed identity cannot be made safe by another model action. Stop
  // the proposal set and leave only opaque candidate choices for the human path.
  if (candidate.fatal) return output([], null, candidate.candidates, false);
  const options: InternalOption[] = [];
  if (!addLinkOptions(options, parsed.document, input.target, primary, secondary)) return emptyResult();
  if (!addSearchOption(options, parsed.document, input.target, destination, next)) return emptyResult();
  const found = candidate.found;
  if (!addReadOptions(options, input.target, destination, parsed.document, found)) return emptyResult();
  if (!addScreenshotOption(options, input.target, destination)) return emptyResult();
  return output(options, found, candidate.candidates, absenceReady);
}

/** The root projects this function's exact model tool list; kept as a named convenience. */
export const buildApprovedAgentToolPlan = planAgentTools;
