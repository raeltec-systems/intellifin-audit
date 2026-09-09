import { type CompiledComplianceCondition } from './compliance-draft.js';
import { type EvidenceRequirement } from './evidence-draft.js';
import { COMPLIANCE_OBSERVATION_FIELDS } from './plan-compiler.js';
import { type ProcedureSourceSnapshot } from './population-draft.js';
import { type DraftSectionHeading } from './procedure-version.js';
import { targetBlockersFor, type ProcedureTargetSnapshot } from './target-draft.js';
import { type TemplateId } from './templates.js';

/**
 * Readiness before paid execution (AD-2).
 *
 * A Run costs money and time: a browser session, a model, and a person's attention when
 * the agent stops to ask. This module answers one question over the Draft's frozen-shaped
 * authoring inputs — "what would make this Run produce nothing useful?" — and answers it
 * as ADVICE. It never refuses a save, it is never a submission blocker, and it is never
 * stored: it is a pure function of fields the row already carries, computed on read, the
 * same discipline `targetBlockersFor`, `populationBlockersFor` and `evidenceBlockersFor`
 * use.
 *
 * The vocabulary is CLOSED and the sentences live here rather than on a surface, for the
 * reason every other closed vocabulary in this package does: a sentence typed into a
 * component is pinned against nothing, and two surfaces showing one finding in two sets
 * of words is two findings to the person reading them.
 *
 * What it deliberately does NOT do is promise anything about runtime. Every item is
 * derived from what the auditor AUTHORED; nothing here has read a Target System, resolved
 * a credential, fetched a population or counted a row. A Draft with no readiness items
 * can still produce an Inconclusive Run — {@link READINESS_NO_GUARANTEE} is the sentence
 * that says so, and the surfaces render it beside the list rather than retyping it.
 */

/** The closed vocabulary. A new item needs a code here and a sentence in this module. */
export const PROCEDURE_READINESS_CODES = [
  'targets-missing',
  'unsupported-target-selected',
  'source-not-bound',
  'agent-judged-without-policy',
  'termination-time-precision-missing',
  'model-read-attribute',
] as const;
export type ProcedureReadinessCode = (typeof PROCEDURE_READINESS_CODES)[number];

export function isProcedureReadinessCode(value: unknown): value is ProcedureReadinessCode {
  return typeof value === 'string' && (PROCEDURE_READINESS_CODES as readonly string[]).includes(value);
}

/**
 * The standing caveat. Readiness reads the Draft, never a Target System: it cannot know
 * whether a credential still works, whether the export was regenerated, or whether the
 * population happens to be empty this period.
 */
export const READINESS_NO_GUARANTEE =
  'These checks read the Draft only. They never contact a Target System or a Population Source, so a Draft with nothing listed here can still produce an Inconclusive Run.';

/** Nothing listed. Said in words, because an empty list must never read as a passed control. */
export const READINESS_NOTHING_FOUND =
  'Nothing in this Draft looks likely to stop a Run before it produces Evidence.';

export interface ProcedureReadinessItem {
  readonly code: ProcedureReadinessCode;
  /** The Builder section that resolves it, spelled exactly as its heading reads. */
  readonly section: DraftSectionHeading;
  /** What is wrong and what to do about it. One sentence a person can act on. */
  readonly sentence: string;
  /** The named subject — a Target System, a condition, an attribute — or null when there is none. */
  readonly subject: string | null;
}

/** The authoring inputs readiness reads. Exactly the frozen-shaped fields, nothing operational. */
export interface ProcedureReadinessInputs {
  readonly templateId: TemplateId;
  readonly targets: readonly ProcedureTargetSnapshot[];
  readonly sourceSnapshot: ProcedureSourceSnapshot | null;
  readonly complianceConditions: readonly CompiledComplianceCondition[];
  readonly evidenceRequirements: readonly EvidenceRequirement[];
}

/**
 * The population column a `disablement-window` rule needs.
 *
 * The rule compares the moment an account was disabled with the moment employment ended,
 * so the source has to declare employment's end at the same precision. The P-1 leavers
 * export declares `termination_effective_date` — a DATE — and a date cannot answer "was
 * this within 24 hours"; a source declaring `termination_effective_time` can.
 */
export const TERMINATION_TIME_COLUMN = 'termination_effective_time';

/**
 * Advisory readiness items for one Draft, in a deterministic order: the code order above,
 * and within a code the authored order of its subjects.
 *
 * The list is not truncated. The Draft's own limits bound it — at most 32 Target Systems,
 * 32 conditions and 32 Evidence Requirements — and hiding a finding to keep a list short
 * is the failure this panel exists to prevent.
 */
export function procedureReadiness(inputs: ProcedureReadinessInputs): readonly ProcedureReadinessItem[] {
  const items: ProcedureReadinessItem[] = [];

  // 1. No Target System. `targetBlockersFor` owns that judgement; a second copy here
  //    would be a second answer to one question.
  if (targetBlockersFor(inputs.templateId, inputs.targets).includes('targets-missing')) {
    items.push({
      code: 'targets-missing',
      section: 'Target System selection',
      subject: null,
      sentence:
        'No Target System is selected, so a Run would read nothing and reach no conclusion. Choose at least one registered system in Target System selection.',
    });
  }

  // 2. A desktop system is registrable and selectable, and execution refuses it in this
  //    release. Naming it is the point: "unsupported" without a name is unactionable.
  for (const target of inputs.targets) {
    if (target.contract.kind !== 'desktop') continue;
    items.push({
      code: 'unsupported-target-selected',
      section: 'Target System selection',
      subject: target.displayName,
      sentence: `${target.displayName} is a desktop Target System, and this release cannot execute against one: a Run reaches it and stops with an unsupported-plan failure. Remove it in Target System selection, or wait for the desktop path.`,
    });
  }

  // 3. No Population Source. Naming who can register one is what makes this actionable to
  //    an Auditor, who cannot register one themselves.
  if (inputs.sourceSnapshot === null) {
    items.push({
      code: 'source-not-bound',
      section: 'Population Source binding',
      subject: null,
      sentence:
        'No Population Source is bound, so a Run has no records to audit and stops before it reads a Target System. Bind an active source in Population Source binding; if none is listed, ask a PoC Administrator to register one.',
    });
  }

  const declaredSchema = inputs.sourceSnapshot?.contract.declared_schema ?? null;
  const declaresRoles = COMPLIANCE_OBSERVATION_FIELDS[inputs.templateId]['roles'] === 'roles';

  for (const condition of inputs.complianceConditions) {
    // 4. An Agent-Judged condition over a roles field with no frozen policy. The agent has
    //    no list to apply, so every role it has not met stops the Run for a person.
    if (declaresRoles && condition.status === 'AGENT_JUDGED' && condition.policy === undefined) {
      items.push({
        code: 'agent-judged-without-policy',
        section: 'Compliance Rule conditions',
        subject: condition.conditionId,
        sentence: `Condition ${condition.conditionId} is Agent-Judged and this Template reads a Roles value, but no role-privilege policy is frozen with it. Without one the agent has no list of privileged roles to apply, and it stops to ask a person about every role it meets. Add a role-privilege policy in Compliance Rule conditions.`,
      });
    }
  }

  for (const condition of inputs.complianceConditions) {
    // 5. A disablement window over a source that declares only a date. Every record would
    //    be Unevaluated for want of a column nobody can supply at run time.
    if (
      condition.rule?.kind === 'disablement-window' &&
      declaredSchema !== null &&
      !declaredSchema.includes(TERMINATION_TIME_COLUMN)
    ) {
      items.push({
        code: 'termination-time-precision-missing',
        section: 'Compliance Rule conditions',
        subject: condition.conditionId,
        sentence: `Condition ${condition.conditionId} compares the disablement time with the termination time in hours, but the bound Population Source declares no \`${TERMINATION_TIME_COLUMN}\` column — only a date. Every record would be Unevaluated. Bind a source that declares it in Population Source binding, or use the account-status rule in Compliance Rule conditions.`,
      });
    }
  }

  // 6. A model-read attribute. Permitted, and recorded as such rather than pretended to be
  //    grounded — and worth knowing before paying for a Run whose only Evidence for that
  //    attribute is the agent's own reading.
  for (const requirement of inputs.evidenceRequirements) {
    if (!requirement.modelRead || requirement.groundedBy.length > 0) continue;
    items.push({
      code: 'model-read-attribute',
      section: 'Evidence Requirements',
      subject: requirement.attributeName,
      sentence: `${requirement.attributeName} is declared model-read with no grounding, so the agent's own reading is the only Evidence for it and nothing corroborates that reading. Ground it in a Structural Snapshot or a source file excerpt in Evidence Requirements if that is not what you intend.`,
    });
  }

  return items;
}
