/**
 * The four Procedure Templates, as build constants owned by this module (AD-2).
 *
 * They are DATA, not rows in a table, not configuration and not a seed script, for the
 * same reason `SUPPORTED_SCHEMA_MAX` is a build constant: an image ships a fixed set of
 * Template contracts, and a Template row an operator could edit would let a deployment
 * drift from the contract its own tests assert. Every default below is transcribed from
 * addendum §C ("Procedure Template Contracts") and is pinned to that file on disk by
 * `tests/unit/procedure-templates.test.ts`, which reads the addendum and requires each
 * stored string to appear verbatim in that Template's block. A value retyped into
 * TypeScript and asserted against a copy of itself proves only that the file agrees with
 * itself; the pin against the artifact on disk is what makes transcription a testable
 * claim.
 *
 * Where §C states nothing, the field is `null` rather than invented. §C gives a Schedule
 * default only for P-1 (`weekly`) and a Control statement only for P-1; putting a
 * plausible word where the contract is silent would put words in the product's mouth,
 * and a stored default that appears nowhere in the block could never be pinned.
 *
 * Each record also names, as data, its golden Population Source binding reference and
 * the version identifiers of its expected outcomes and confirmation script (AD-12,
 * AD-19). Those live under `fixtures/northstar/` as versioned product data; the Template
 * NAMES them and never reads them, and no Regression Run is built here. The pinning test
 * checks each reference against the fixture catalogue on disk, so pointing one at a name
 * that does not exist fails a test rather than a Run.
 */

/** The evaluation origin a condition is authored with. `HUMAN` arises only later, from a rejection. */
import type { TargetSystemKind } from '../registrations/target-system.js';
import type { InclusionRule } from './population-draft.js';
import type { ComplianceRule } from './compliance-draft.js';

export const CONDITION_ORIGINS = ['RULE', 'AGENT_JUDGED'] as const;
export type ConditionOrigin = (typeof CONDITION_ORIGINS)[number];

export function isConditionOrigin(value: unknown): value is ConditionOrigin {
  return typeof value === 'string' && (CONDITION_ORIGINS as readonly string[]).includes(value);
}

/**
 * One Compliance Rule condition, exactly as §C states it.
 *
 * The three outcome slots hold §C's own sentences, verbatim; `null` where §C gives the
 * condition no rule for that outcome. `applicability` is §C's words too ("all records",
 * "`found = true`"), not a compiled predicate — compilation is Story 2.4's PlanCompiler,
 * and nothing here derives a plan (AD-23).
 */
export interface TemplateCondition {
  readonly conditionId: string;
  readonly origin: ConditionOrigin;
  readonly applicability: string | null;
  readonly compliant: string | null;
  readonly exception: string | null;
  readonly unevaluated: string | null;
  /** Anything else §C pins to this condition — matching keys, boundaries, pair lists — verbatim. */
  readonly also: readonly string[];
  /** Structured default paired with this exact pinned prose. Text edits invalidate it. */
  readonly rule?: ComplianceRule;
}

export const PROCEDURE_TEMPLATE_IDS = ['P-1', 'P-2', 'P-3', 'P-4'] as const;
export type TemplateId = (typeof PROCEDURE_TEMPLATE_IDS)[number];

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (PROCEDURE_TEMPLATE_IDS as readonly string[]).includes(value);
}

export interface ProcedureTemplate {
  readonly id: TemplateId;
  readonly name: string;
  /** §C marks P-1 the hero; the flag is data so no surface has to hard-code the id. */
  readonly hero: boolean;
  readonly controlStatement: string | null;
  readonly objective: string;
  readonly populationSource: string;
  readonly inclusionRule: InclusionRule;
  readonly targetSystems: string;
  /**
   * The Target Systems this Template names, structured, for the Builder to OFFER by name.
   * The kinds drive the P-1 web/desktop coverage diagnostic. A registration is never minted
   * from these — an unavailable or ambiguous match is selected explicitly (FR-7).
   */
  readonly defaultTargets: readonly { readonly name: string; readonly kind: TargetSystemKind }[];
  readonly workItemCoverage: string;
  readonly auditInstructions: string | null;
  readonly conditions: readonly TemplateCondition[];
  readonly declaredAttributeLabels: Readonly<Record<string, string>> | null;
  readonly secondaryKey: string | null;
  readonly evidenceRequirements: string | null;
  readonly schedule: string | null;
  /** The Template-level Inconclusive rule, where §C states one. */
  readonly inconclusive: string | null;
  /** Anything else §C pins to the whole Template — escalation seeds, the P-1 variant — verbatim. */
  readonly also: readonly string[];
  /** The golden binding this Template names, an id in `fixtures/northstar/datasets/systems.json`. */
  readonly goldenBindingReference: string;
  /** The expected-outcomes fixture this Template names, an `expectation_id` under `fixtures/northstar/expectations/`. */
  readonly expectationsVersion: string;
  /** The confirmation-script fixture this Template names (AD-19). */
  readonly confirmationScriptVersion: string;
}

const P1_C1: TemplateCondition = {
  conditionId: 'C1',
  origin: 'RULE',
  applicability: 'all records',
  compliant: 'Compliant when `found = false` (proven absence) or `account_status = disabled`',
  exception: 'Exception when `account_status = active`',
  unevaluated: 'any other status → Unevaluated (unnamed value)',
  also: [],
  rule: { kind: 'predicate', predicate: { kind: 'any', expressions: [
    { kind: 'boolean', field: 'found', value: false },
    { kind: 'named-set', field: 'account_status', compliant: ['disabled'], exception: ['active'] },
  ] } },
};

const P1_C2: TemplateCondition = {
  conditionId: 'C2',
  origin: 'AGENT_JUDGED',
  applicability: '`found = true`',
  compliant: null,
  exception: 'Treat any account whose roles look privileged as an Exception even if disabled.',
  unevaluated: null,
  also: ['A found account with no C2 evaluation is a Gate failure.'],
};

const P1: ProcedureTemplate = {
  id: 'P-1',
  // Explicit mapping from the prose's termination_date to the registered field.
  inclusionRule: { schemaVersion: 1, all: [
    { column: 'employment_status', kind: 'text', operator: 'eq', value: 'Terminated' },
    { column: 'termination_effective_date', kind: 'within-period' },
  ] },
  name: 'Terminated Users Retaining Access',
  hero: true,
  controlStatement: 'Terminated employees must have their system access revoked.',
  objective:
    'Determine whether employees terminated in the period retain an active account in any Target System.',
  populationSource:
    'Leavers export (versioned file); inclusion rule `employment_status = Terminated and termination_date within period`, applied by the Adapter.',
  targetSystems:
    'LoanCore (web, agent-driven) and LedgerDesk (desktop, agent-driven). Execution order: all records in LoanCore, then all records in LedgerDesk (FR-20).',
  defaultTargets: [
    { name: 'LoanCore', kind: 'web' },
    { name: 'LedgerDesk', kind: 'desktop' },
  ],
  workItemCoverage: 'one Work Item per population record per Target System.',
  auditInstructions:
    'For each terminated employee, sign in to each Target System, search by employee ID, and if there is no ID match search by full name. Open the account record and note whether an account exists, its status, username, and assigned roles.',
  conditions: [P1_C1, P1_C2],
  declaredAttributeLabels: {
    account_status: 'Status',
    username: 'Username',
    roles: 'Roles',
    identity: 'Employee ID',
  },
  secondaryKey: 'full name',
  evidenceRequirements:
    'username, account_status, roles (each grounded), Structural Snapshot and platform screenshot of the account page bound to the read, source export row.',
  schedule: 'weekly',
  inconclusive:
    'any population record uninspected in any Target System, declared-count mismatch at file or inclusion level, missing required Evidence, contradictory corroboration, unproven absence, unresolved ambiguous match, unnamed value, or missing C2 evaluation.',
  also: [
    'a name-only match with two candidate rows lacking the employee ID (*choose candidate*); an account with status `Suspended` (*unnamed value*; expected terminal outcome Inconclusive with diagnostic); a search timeout exhausting retries (*retry or skip*)',
    'a 24-hour disablement-window rule (`disabled_time - termination_time <= 24h`, exactly 24 hours Compliant) is available as an alternative C1 when a Target System exposes `disabled_time`; the §D boundary case for P-1 targets this variant',
  ],
  goldenBindingReference: 'leavers-export-versioned',
  expectationsVersion: 'p-1-terminated-users',
  confirmationScriptVersion: 'confirmation-scripts',
};

const P2: ProcedureTemplate = {
  id: 'P-2',
  inclusionRule: { schemaVersion: 1, all: [{ column: 'status', kind: 'text', operator: 'eq', value: 'Active' }] },
  name: 'Segregation-of-Duties Conflicts',
  hero: false,
  controlStatement: null,
  objective:
    'Determine whether any active account contains an explicitly prohibited permission pair.',
  populationSource: 'AccessGate active accounts (Adapter).',
  targetSystems: 'AccessGate role detail (Adapter).',
  defaultTargets: [{ name: 'AccessGate', kind: 'api' }],
  workItemCoverage:
    'one adapter Work Item covering the whole population; per-record coverage is satisfied when every population account appears in the extraction with a grounded role list.',
  auditInstructions: null,
  conditions: [
    {
      conditionId: 'C1',
      origin: 'RULE',
      applicability: null,
      compliant: 'No prohibited pair exists for the account.',
      exception: 'At least one prohibited pair exists; report every pair.',
      unevaluated:
        'Unknown role, incomplete role expansion, duplicate conflicting policy entries, or incomplete account population.',
      also: [
        'Role name to the versioned RoleMatrix; expand roles to permissions before comparison.',
        '`CREATE_VENDOR` + `APPROVE_VENDOR`; `CREATE_PAYMENT` + `RELEASE_PAYMENT`; `CONFIGURE_LIMITS` + `APPROVE_LOAN`',
      ],
      rule: { kind: 'permission-pairs', rolesField: 'roles', prohibitedPairs: [
        ['CREATE_VENDOR', 'APPROVE_VENDOR'], ['CREATE_PAYMENT', 'RELEASE_PAYMENT'], ['CONFIGURE_LIMITS', 'APPROVE_LOAN'],
      ] },
    },
  ],
  declaredAttributeLabels: null,
  secondaryKey: null,
  evidenceRequirements: null,
  schedule: null,
  inconclusive: null,
  also: ['Reference Source: RoleMatrix.'],
  goldenBindingReference: 'accessgate-active-accounts',
  expectationsVersion: 'p-2-sod-conflicts',
  confirmationScriptVersion: 'confirmation-scripts',
};

const P3: ProcedureTemplate = {
  id: 'P-3',
  inclusionRule: { schemaVersion: 1, all: [
    { column: 'currency', kind: 'text', operator: 'eq', value: 'USD' },
    { column: 'amount', kind: 'decimal', operator: 'gte', value: '100000' },
    { column: 'processed_time', kind: 'within-period' },
  ] },
  name: 'High-Value Transactions Without Required Approval',
  hero: false,
  controlStatement: null,
  objective:
    'Determine whether processed high-value transactions had valid approval before processing.',
  populationSource: 'LedgerFlow processed transactions in USD ≥ 100,000 in the period (Adapter).',
  targetSystems: 'ApproveNow (Adapter).',
  defaultTargets: [{ name: 'ApproveNow', kind: 'api' }],
  workItemCoverage:
    'one adapter Work Item per extraction; per-record coverage is satisfied when every population transaction has a grounded approval lookup result (found or proven absent).',
  auditInstructions: null,
  conditions: [
    {
      conditionId: 'C1',
      origin: 'RULE',
      applicability: null,
      compliant:
        "A matching `APPROVED` decision exists before processing and the approver's limit is at least the transaction amount.",
      exception:
        'No approval, approval after processing, rejected approval, or insufficient approver limit.',
      unevaluated:
        'Duplicate or contradictory approval decisions, missing transaction time, missing approval limit, or incomplete population.',
      also: [
        'Exact transaction ID, with approval ID used as corroboration.',
        'USD 100,000 requires approval (inclusive); this is the PoC\'s exercised tolerance boundary (FR-9).',
      ],
      rule: { kind: 'approval', amountField: 'amount', currencyField: 'currency', decisionField: 'decision', decisionTimeField: 'decided_at', processedTimeField: 'processed_time', limitField: 'approver_limit', threshold: '100000', boundary: 'inclusive', tolerance: '0' },
    },
  ],
  declaredAttributeLabels: null,
  secondaryKey: null,
  evidenceRequirements: null,
  schedule: null,
  inconclusive: null,
  also: [],
  goldenBindingReference: 'ledgerflow-transactions',
  expectationsVersion: 'p-3-high-value-approvals',
  confirmationScriptVersion: 'confirmation-scripts',
};

const P4: ProcedureTemplate = {
  id: 'P-4',
  inclusionRule: { schemaVersion: 1, all: [] },
  name: 'Production Configuration Deviation',
  hero: false,
  controlStatement: null,
  objective:
    'Determine whether observed production parameters equal the approved baseline in effect at the observation time.',
  populationSource: 'ConfigRegistry baseline parameters (Adapter).',
  targetSystems: 'ProdConsole (web, agent-driven).',
  defaultTargets: [{ name: 'ProdConsole', kind: 'web' }],
  workItemCoverage:
    "one agent Work Item for the ProdConsole page read, owning one Observation per baseline parameter, each grounded in the page's Structural Snapshot with the parameter name as identity attribute.",
  auditInstructions: null,
  conditions: [
    {
      conditionId: 'C1',
      origin: 'RULE',
      applicability: null,
      compliant: 'Observed and approved normalized values are equal.',
      exception:
        'Value differs or an extra production parameter is explicitly prohibited by the baseline.',
      unevaluated:
        'Required parameter absent from the observation, multiple effective baselines apply, observation is stale, or extraction is partial.',
      also: [
        'Exact parameter name.',
        '`max_manual_approval_amount`, `mfa_required_for_admin`, `session_timeout_minutes`, and `production_debug_mode`',
      ],
      rule: { kind: 'baseline', parameterField: 'parameter', observedField: 'observed_value', observationTimeField: 'observation_time', tolerance: '0' },
    },
  ],
  declaredAttributeLabels: null,
  secondaryKey: null,
  evidenceRequirements: null,
  schedule: null,
  inconclusive: null,
  also: [],
  goldenBindingReference: 'configregistry-baseline',
  expectationsVersion: 'p-4-config-deviation',
  confirmationScriptVersion: 'confirmation-scripts',
};

/**
 * The four Template contracts, in §C's order. Frozen: an image ships exactly these, and
 * the pinning test fails when a default drifts from the addendum block it came from.
 */
export const PROCEDURE_TEMPLATES: readonly ProcedureTemplate[] = [P1, P2, P3, P4];

/** The hero Template (§C marks P-1). The list picker orders it first from this flag. */
export function heroProcedureTemplate(): ProcedureTemplate {
  const hero = PROCEDURE_TEMPLATES.find((template) => template.hero);
  if (!hero) throw new Error('no Procedure Template is marked the hero');
  return hero;
}

/** Look a Template up by id. Only a shipped id resolves; callers validate input first. */
export function findProcedureTemplate(id: TemplateId): ProcedureTemplate {
  const template = PROCEDURE_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`no Procedure Template ${id}`);
  return template;
}
