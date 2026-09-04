import {
  findProcedureTemplate,
  isConditionOrigin,
  isTemplateId,
  type ConditionOrigin,
  type ProcedureTemplate,
  type TemplateCondition,
  type TemplateId,
} from './templates.js';

/**
 * The Procedure Version state machine and the Draft section payload (addendum §E).
 *
 * The state vocabulary is §E's, whole: `DRAFT → SUBMITTED → APPROVED | REJECTED`;
 * `REJECTED → DRAFT` on edit; `APPROVED → ACTIVE`; `ACTIVE → RETIRED`. The permitted
 * transitions live here as data from the first commit, with `DRAFT → SUBMITTED` and the
 * rest unreachable until their own stories build them — a state machine that grows one
 * arrow per story ends up with no machine at all, and a vocabulary that ships half
 * spelled invites a future state spelled to fit whatever the first caller typed.
 *
 * This story only ever WRITES `DRAFT`. Nothing here moves a state; the commands in the
 * application layer write the state a story owns.
 */

export const PROCEDURE_VERSION_STATES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'ACTIVE',
  'RETIRED',
] as const;

export type ProcedureVersionState = (typeof PROCEDURE_VERSION_STATES)[number];

export function isProcedureVersionState(value: unknown): value is ProcedureVersionState {
  return (
    typeof value === 'string' && (PROCEDURE_VERSION_STATES as readonly string[]).includes(value)
  );
}

/**
 * The permitted transitions, as data (§E).
 *
 * `APPROVED → ACTIVE` is §E's "immediately, or after the FR-15 regression Run where
 * required" — the trigger differs by story, the edge does not. Only `ACTIVE` versions
 * run or schedule; nothing here enforces that yet, because nothing here runs.
 */
export const PROCEDURE_VERSION_TRANSITIONS: Readonly<
  Record<ProcedureVersionState, readonly ProcedureVersionState[]>
> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['ACTIVE'],
  REJECTED: ['DRAFT'],
  ACTIVE: ['RETIRED'],
  RETIRED: [],
};

/** Is `to` reachable from `from` by one permitted edge? Terminal states transition to nothing. */
export function canTransition(from: ProcedureVersionState, to: ProcedureVersionState): boolean {
  return PROCEDURE_VERSION_TRANSITIONS[from].includes(to);
}

/**
 * One pre-filled Builder section.
 *
 * The payload is authored by the Template and never compiled here: `compiled` is false
 * wherever §C's condition is the sentence the auditor will edit, and the PlanCompiler
 * that compiles C1 is Story 2.6's (AD-23). `declaredCountKnown` is FR-6's surfaced
 * absence — the domain knows only what the Template names, and a binding that declares
 * no count blocks submission in a later story.
 */
export interface DraftSection {
  readonly heading: DraftSectionHeading;
  /** §C's sentence, verbatim, or `null` where §C gives the section nothing. */
  readonly content: string | null;
  /** False everywhere in this story: compilation is Story 2.6's PlanCompiler (AD-23). */
  readonly compiled: boolean;
}

/**
 * The Builder's section headings, in the order EXPERIENCE.md and §C present them.
 *
 * The headings are the contract the later editor stories slot into: 2.2 owns Period and
 * scope and the Population Source binding, 2.3 the Audit Instructions, 2.4 the
 * Compliance Rule conditions, 2.5 Evidence Requirements, Target System selection and the
 * Schedule. Each story promotes its part of the `jsonb` payload to typed columns as it
 * authors the section.
 */
export const DRAFT_SECTION_HEADINGS = [
  'Control',
  'Objective',
  'Period and scope',
  'Population Source binding',
  'Target System selection',
  'Audit Instructions',
  'Compliance Rule conditions',
  'Evidence Requirements',
  'Schedule',
] as const;

export type DraftSectionHeading = (typeof DRAFT_SECTION_HEADINGS)[number];

export function isDraftSectionHeading(value: unknown): value is DraftSectionHeading {
  return (
    typeof value === 'string' && (DRAFT_SECTION_HEADINGS as readonly string[]).includes(value)
  );
}

/**
 * The Builder sections `initialDraftSections` fills from a Template.
 *
 * `Control` and `Objective` are the pair §C gives every Template at least an objective
 * for; the rest are §C's own section vocabulary.
 */
const SECTION_CONTENT: Readonly<Record<DraftSectionHeading, (template: ProcedureTemplate) => string | null>> = {
  Control: (template) => template.controlStatement,
  Objective: (template) => template.objective,
  'Period and scope': () => null,
  'Population Source binding': (template) => template.populationSource,
  'Target System selection': (template) => template.targetSystems,
  'Audit Instructions': (template) => template.auditInstructions,
  'Compliance Rule conditions': (template) => conditionsText(template.conditions),
  'Evidence Requirements': (template) => template.evidenceRequirements,
  Schedule: (template) => template.schedule,
};

/** The conditions as §C writes them: one line per condition, applicability first. */
function conditionsText(conditions: readonly TemplateCondition[]): string | null {
  if (conditions.length === 0) return null;
  return conditions
    .map((condition) => {
      const applicability = condition.applicability === null ? '' : `applicability: ${condition.applicability}; `;
      const outcomes = [
        condition.compliant === null ? null : `Compliant — ${condition.compliant}`,
        condition.exception === null ? null : `Exception — ${condition.exception}`,
        condition.unevaluated === null ? null : `Unevaluated — ${condition.unevaluated}`,
      ].filter((sentence): sentence is string => sentence !== null);
      return `condition ${condition.conditionId} (${condition.origin}): ${applicability}${outcomes.join('; ')}`;
    })
    .join('\n');
}

/**
 * The Draft sections a Template pre-fills, in Builder order.
 *
 * Only a shipped Template id produces sections; callers validate the id before this.
 */
export function initialDraftSections(templateId: TemplateId): readonly DraftSection[] {
  const template = findProcedureTemplate(templateId);
  return DRAFT_SECTION_HEADINGS.map((heading) => ({
    heading,
    content: SECTION_CONTENT[heading](template),
    compiled: false,
  }));
}

/**
 * The stored Draft section payload, as the command and the validator agree on it.
 *
 * This is the type of the `sections` `jsonb` column: headings in Builder order, each
 * with §C's text or an explicit `null` where §C gives the Template nothing for that
 * section. It is never read untyped — this validator is the one reader.
 */
export interface DraftSectionsPayload {
  readonly templateId: TemplateId;
  readonly sections: readonly DraftSection[];
}

/**
 * Validate the stored section payload.
 *
 * Structural, not a re-derivation: it requires the Template id, every heading exactly
 * once IN Builder order, `compiled` false, and content a string or an explicit `null`.
 * It does NOT require the content to equal the Template pre-fill — the moment Story 2.2
 * makes a section editable, the draft must be allowed to hold what the auditor saved,
 * and a validator that compared against the Template would reject an honest edit while
 * accepting a Template that had drifted. The claim "the pre-fill equals the Template
 * record" is about what CREATION writes, and it is tested, not enforced here.
 *
 * An editor story that makes a section compilable extends this validator when it ships;
 * until then `compiled: true` is refused, because nothing in this story can produce it.
 */
export function isValidDraftSectionsPayload(value: unknown): value is DraftSectionsPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  if (!isTemplateId(payload['templateId'])) return false;
  if (!Array.isArray(payload['sections'])) return false;
  const sections = payload['sections'];
  if (sections.length !== DRAFT_SECTION_HEADINGS.length) return false;

  return DRAFT_SECTION_HEADINGS.every((heading, index) => {
    const section = sections[index];
    if (typeof section !== 'object' || section === null) return false;
    const entry = section as Record<string, unknown>;
    if (entry['heading'] !== heading) return false;
    if (entry['compiled'] !== false) return false;
    const content = entry['content'];
    return content === null || typeof content === 'string';
  });
}

/**
 * The one editable field in this story, bounded at the Server Action boundary.
 *
 * A Control name is a heading an auditor reads on every surface that lists or opens the
 * Procedure, so it is capped at a length a card can render; the addendum's Control
 * sentences all sit far below it.
 */
export const CONTROL_NAME_LIMIT = 200;

export { isConditionOrigin, isTemplateId };
export type { ConditionOrigin, ProcedureTemplate, TemplateCondition, TemplateId };
