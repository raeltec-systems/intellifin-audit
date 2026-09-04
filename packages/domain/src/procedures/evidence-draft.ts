import { complianceObject as object, complianceExactKeys as exact, isComplianceText } from './compliance-draft.js';
import { isAgentDrivenKind, type ProcedureTargetSnapshot } from './target-draft.js';
import { POPULATION_DRAFT_MESSAGES, type ProcedureSourceSnapshot } from './population-draft.js';
import { findProcedureTemplate, type TemplateId } from './templates.js';

/**
 * Evidence Requirements and the Schedule for a Draft Procedure Version (FR-9, FR-10,
 * AD-2).
 *
 * Evidence Requirements are typed, per declared attribute: every attribute value must be
 * grounded in a Structural Snapshot or a source file excerpt, never in a screenshot or a
 * recording segment alone; an attribute can instead be declared model-read, which is
 * recorded as such and exempts it from deterministic grounding rather than pretending it
 * is grounded. For an agent-driven Target System (web or desktop, `isAgentDrivenKind`
 * from `target-draft.js` — never a second copy of that vocabulary) Structural Snapshot
 * and screenshot are platform-captured: the command records that flag from the Draft's
 * CURRENT Target System selection at the moment Evidence Requirements are saved, and it
 * is never a choice the auditor is offered.
 *
 * The Schedule is a frequency with a fixed UTC start time; the period-derivation rule is
 * RECORDED per frequency, never executed here — a scheduled Run derives its own period
 * later and records how (Design Notes).
 *
 * The one cross-section invariant this story adds is the upload/frequency pairing: a
 * `manual-upload` Population Source binding (Story 2.2's `population-draft.js` binding
 * kind, read here and never duplicated) is valid only with a `once` Schedule. It is a
 * completeness blocker, exactly like `populationBlockersFor` and `targetBlockersFor` —
 * saveable, surfaced, never silently accepted, and never a save-time refusal.
 */

export const EVIDENCE_TYPES = [
  'attribute-value',
  'structural-snapshot',
  'screenshot',
  'source-file-excerpt',
  'recording-segment',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export function isEvidenceType(value: unknown): value is EvidenceType {
  return typeof value === 'string' && (EVIDENCE_TYPES as readonly string[]).includes(value);
}

/** The only two evidence types that ground an attribute value. */
export const GROUNDING_EVIDENCE_TYPES = ['structural-snapshot', 'source-file-excerpt'] as const;
export type GroundingEvidenceType = (typeof GROUNDING_EVIDENCE_TYPES)[number];
export function isGroundingEvidenceType(value: unknown): value is GroundingEvidenceType {
  return typeof value === 'string' && (GROUNDING_EVIDENCE_TYPES as readonly string[]).includes(value);
}

export const EVIDENCE_DRAFT_LIMITS = { requirements: 32, attributeName: 200 } as const;

export const EVIDENCE_DRAFT_MESSAGES = {
  ATTRIBUTE: 'Enter a non-blank, storable attribute name of no more than 200 characters for every Evidence Requirement.',
  DUPLICATE: 'An attribute can appear only once in Evidence Requirements.',
  TOO_MANY: 'Evidence Requirements supports at most 32 attributes.',
  SHAPE: 'Enter valid Evidence Requirements: a grounding source, a model-read declaration, or both, for every attribute.',
  GROUNDING:
    'Ground every attribute value in a Structural Snapshot or a source file excerpt, or declare it model-read. A screenshot or a recording segment alone never grounds an attribute value.',
  FREQUENCY: 'Choose a supported Schedule frequency: once, daily, weekly or monthly.',
  START: 'Enter a fixed UTC Schedule start time as HH:MM.',
  /** `population-draft.js`'s own sentence, reused rather than duplicated. */
  UPLOAD_FREQUENCY_BLOCKER: POPULATION_DRAFT_MESSAGES.MANUAL_UPLOAD,
} as const;

/** Untrusted evidence-requirement input, before the command decides `platformCaptured`. */
export interface EvidenceRequirementInput {
  readonly attributeName: string;
  readonly modelRead: boolean;
  readonly groundedBy: readonly GroundingEvidenceType[];
  readonly screenshot: boolean;
  readonly recordingSegment: boolean;
}

export interface EvidenceRequirement extends EvidenceRequirementInput {
  /**
   * Recorded by the command from the Draft's CURRENT Target System selection at the
   * moment this is saved — never a choice offered to the auditor. `true` when at least
   * one selected Target System is agent-driven: Structural Snapshot and screenshot are
   * captured by the platform at execution for such a system (capture itself happens at
   * execution, a later epic), so grounding by Structural Snapshot and the screenshot
   * flag are forced on rather than asked for.
   */
  readonly platformCaptured: boolean;
}

export const FREQUENCIES = ['once', 'daily', 'weekly', 'monthly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export function isFrequency(value: unknown): value is Frequency {
  return typeof value === 'string' && (FREQUENCIES as readonly string[]).includes(value);
}

/**
 * The period-derivation rule per frequency (Design Notes): `once` keeps the explicit
 * Period from Story 2.2, the rest name the previous calendar unit. RECORDED on the
 * version; a scheduled Run's own period derivation, and `handover_at`, are later epics.
 */
export const PERIOD_DERIVATION_RULES = {
  once: 'explicit-period',
  daily: 'previous-calendar-day',
  weekly: 'previous-monday-sunday',
  monthly: 'previous-calendar-month',
} as const satisfies Readonly<Record<Frequency, string>>;

const START_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export interface DraftSchedule {
  readonly frequency: Frequency;
  /** Fixed UTC time of day, `HH:MM`, 24-hour. */
  readonly startTime: string;
  /** `PERIOD_DERIVATION_RULES[frequency]` — the command computes it, never the caller. */
  readonly periodDerivationRule: (typeof PERIOD_DERIVATION_RULES)[Frequency];
}

export function isDraftSchedule(value: unknown): value is DraftSchedule {
  if (!object(value) || !exact(value, ['frequency', 'startTime', 'periodDerivationRule'])) return false;
  if (!isFrequency(value['frequency'])) return false;
  if (typeof value['startTime'] !== 'string' || !START_TIME.test(value['startTime'])) return false;
  return value['periodDerivationRule'] === PERIOD_DERIVATION_RULES[value['frequency']];
}

export type EvidenceBlocker = 'upload-frequency-mismatch';

/**
 * The one cross-section completeness diagnostic this story adds. Pure, derived, never
 * stored — the same discipline `targetBlockersFor` and `populationBlockersFor` use — and
 * never a refusal by itself.
 */
export function evidenceBlockersFor(
  sourceSnapshot: { readonly contract: Pick<ProcedureSourceSnapshot['contract'], 'kind'> } | null,
  schedule: DraftSchedule | null,
): readonly EvidenceBlocker[] {
  return sourceSnapshot !== null &&
    sourceSnapshot.contract.kind === 'manual-upload' &&
    schedule !== null &&
    schedule.frequency !== 'once'
    ? ['upload-frequency-mismatch']
    : [];
}

export interface DraftEvidenceFields {
  readonly evidenceSchemaVersion: 1;
  readonly evidenceRequirements: readonly EvidenceRequirement[];
  readonly schedule: DraftSchedule | null;
}

export function isEvidenceAttributeName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    value.length <= EVIDENCE_DRAFT_LIMITS.attributeName &&
    isComplianceText(value, EVIDENCE_DRAFT_LIMITS.attributeName)
  );
}

function isGroundedByArray(value: unknown): value is readonly GroundingEvidenceType[] {
  if (!Array.isArray(value) || !value.every(isGroundingEvidenceType)) return false;
  return new Set(value).size === value.length;
}

/** Untrusted evidence-requirement input, shape-checked before the command decides `platformCaptured`. */
export function isEvidenceRequirementInput(value: unknown): value is EvidenceRequirementInput {
  if (!object(value) || !exact(value, ['attributeName', 'modelRead', 'groundedBy', 'screenshot', 'recordingSegment'])) {
    return false;
  }
  if (!isEvidenceAttributeName(value['attributeName'])) return false;
  if (typeof value['modelRead'] !== 'boolean') return false;
  if (typeof value['screenshot'] !== 'boolean') return false;
  if (typeof value['recordingSegment'] !== 'boolean') return false;
  return isGroundedByArray(value['groundedBy']);
}

/** `true` when `value` is one well-formed, storable, correctly grounded Evidence Requirement. */
export function isEvidenceRequirement(value: unknown): value is EvidenceRequirement {
  if (
    !object(value) ||
    !exact(value, ['attributeName', 'modelRead', 'groundedBy', 'screenshot', 'recordingSegment', 'platformCaptured'])
  ) {
    return false;
  }
  if (!isEvidenceAttributeName(value['attributeName'])) return false;
  if (typeof value['modelRead'] !== 'boolean') return false;
  if (typeof value['screenshot'] !== 'boolean') return false;
  if (typeof value['recordingSegment'] !== 'boolean') return false;
  if (typeof value['platformCaptured'] !== 'boolean') return false;
  if (!isGroundedByArray(value['groundedBy'])) return false;
  const groundedBy = value['groundedBy'] as readonly GroundingEvidenceType[];
  // The grounding rule: an attribute value is grounded by a Structural Snapshot or a
  // source file excerpt, or is declared model-read. A screenshot or a recording segment
  // alone never grounds it.
  if (!value['modelRead'] && groundedBy.length === 0) return false;
  // Platform-captured is recorded, not chosen: an agent-driven attribute is always
  // grounded by a Structural Snapshot and always carries the screenshot.
  if (value['platformCaptured'] && (!groundedBy.includes('structural-snapshot') || !value['screenshot'])) {
    return false;
  }
  return true;
}

export function isDraftEvidenceFields(value: unknown): value is DraftEvidenceFields {
  if (!object(value)) return false;
  if (value['evidenceSchemaVersion'] !== 1) return false;
  if (!Array.isArray(value['evidenceRequirements']) || value['evidenceRequirements'].length > EVIDENCE_DRAFT_LIMITS.requirements) {
    return false;
  }
  if (!value['evidenceRequirements'].every(isEvidenceRequirement)) return false;
  const seen = new Set<string>();
  for (const requirement of value['evidenceRequirements'] as readonly EvidenceRequirement[]) {
    const key = requirement.attributeName.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
  }
  if (value['schedule'] !== null && !isDraftSchedule(value['schedule'])) return false;
  return true;
}

/** `true` when the Draft's current Target System selection includes an agent-driven system. */
export function hasAgentDrivenTarget(targets: readonly ProcedureTargetSnapshot[]): boolean {
  return targets.some((target) => isAgentDrivenKind(target.contract.kind));
}

/**
 * Apply the platform-captured flag recorded from the CURRENT Target System selection.
 * Never trusts a caller-supplied flag: the auditor cannot choose it, and re-saving after
 * the selection changes must re-derive it.
 */
export function withPlatformCaptured(input: EvidenceRequirementInput, platformCaptured: boolean): EvidenceRequirement {
  const groundedBy: readonly GroundingEvidenceType[] =
    platformCaptured && !input.groundedBy.includes('structural-snapshot')
      ? [...input.groundedBy, 'structural-snapshot' as const]
      : input.groundedBy;
  return {
    ...input,
    groundedBy,
    screenshot: platformCaptured ? true : input.screenshot,
    platformCaptured,
  };
}

export type DraftEvidenceEdit =
  | { readonly section: 'evidence-requirements'; readonly requirements: readonly EvidenceRequirementInput[] }
  | { readonly section: 'schedule'; readonly frequency: Frequency; readonly startTime: string };

export function evidenceGroundingMessage(attributeName: string): string {
  return `Attribute "${attributeName}": ${EVIDENCE_DRAFT_MESSAGES.GROUNDING}`;
}

/** Parse untrusted authoring values after authorization, before taking row locks. */
export function validateDraftEvidenceEdit(
  value: unknown,
): { readonly ok: true; readonly edit: DraftEvidenceEdit } | { readonly ok: false; readonly reason: string } {
  const refuse = (reason: string) => ({ ok: false, reason }) as const;
  if (!object(value)) return refuse(EVIDENCE_DRAFT_MESSAGES.SHAPE);
  if (value['section'] === 'evidence-requirements') {
    if (
      !exact(value, ['section', 'requirements']) ||
      !Array.isArray(value['requirements']) ||
      value['requirements'].length > EVIDENCE_DRAFT_LIMITS.requirements
    ) {
      return refuse(EVIDENCE_DRAFT_MESSAGES.TOO_MANY);
    }
    const seen = new Set<string>();
    for (const entry of value['requirements']) {
      if (!isEvidenceRequirementInput(entry)) return refuse(EVIDENCE_DRAFT_MESSAGES.ATTRIBUTE);
      const key = entry.attributeName.trim().toLowerCase();
      if (seen.has(key)) return refuse(EVIDENCE_DRAFT_MESSAGES.DUPLICATE);
      seen.add(key);
      // Grounding depends on the locked version's current targets. The command
      // checks the invariant after deriving mandatory platform capture.
    }
  } else if (value['section'] === 'schedule') {
    if (!exact(value, ['section', 'frequency', 'startTime'])) return refuse(EVIDENCE_DRAFT_MESSAGES.FREQUENCY);
    if (!isFrequency(value['frequency'])) return refuse(EVIDENCE_DRAFT_MESSAGES.FREQUENCY);
    if (typeof value['startTime'] !== 'string' || !START_TIME.test(value['startTime'])) {
      return refuse(EVIDENCE_DRAFT_MESSAGES.START);
    }
  } else {
    return refuse(EVIDENCE_DRAFT_MESSAGES.SHAPE);
  }
  return { ok: true, edit: value as unknown as DraftEvidenceEdit };
}

/** The Draft's Evidence Requirements state at creation: the Template's structured defaults. */
export function initialDraftEvidence(templateId: TemplateId): DraftEvidenceFields {
  const template = findProcedureTemplate(templateId);
  // A new Draft has no bound Target Systems. Template suggestions are not a
  // persisted selection; target authoring derives capture when systems are bound.
  const platformCaptured = false;
  return {
    evidenceSchemaVersion: 1,
    evidenceRequirements: template.evidenceDefaults.map((input) => withPlatformCaptured(input, platformCaptured)),
    schedule: template.scheduleDefault,
  };
}
