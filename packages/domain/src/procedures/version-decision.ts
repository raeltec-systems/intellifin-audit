import { canonicalJson, type JsonValue } from '../canonical-json.js';
import type { ExecutablePlan, FrozenPlanInputs } from './executable-plan.js';
import type { ProcedureVersionState } from './procedure-version.js';

export type VersionDecision = 'submit' | 'approve' | 'reject' | 'edit';
export interface VersionDecisionRecord {
  readonly schemaVersion: 1;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly priorState: ProcedureVersionState;
  readonly decision: VersionDecision;
  readonly rationale: string | null;
  /** Whole-row revision reviewed by the actor, before this transition. */
  readonly aggregateRevision: string;
}
export interface VersionAuthorship {
  readonly createdBy: { readonly type: 'human' | 'platform'; readonly id: string };
  readonly responsibleAuthorId: string;
  readonly humanAuthorIds: readonly string[];
}
export interface ReviewedDefinition {
  readonly schemaVersion: 1;
  readonly inputs: FrozenPlanInputs;
  readonly compiledPlan: ExecutablePlan | null;
  readonly modelConfiguration: { readonly provider: string; readonly modelId: string; readonly promptVersion: string } | null;
  readonly toolConfiguration: {
    readonly interpreterContract: 'executable-plan-v1';
    readonly identityMatching: 'opaque-exact-strings';
    readonly accessPolicy: 'frozen-registered-read-actions';
    readonly actions: readonly ExecutablePlan['sessionSteps'][number]['action'][];
  };
}
export interface VersionSectionDiff {
  readonly section: string;
  readonly before: JsonValue;
  readonly after: JsonValue;
  readonly changed: boolean;
}
export interface SubmittedVersionReview {
  readonly schemaVersion: 1;
  readonly versionId: string;
  readonly baseline: { readonly versionId: string; readonly versionNumber: number; readonly revision: string } | null;
  readonly definition: ReviewedDefinition & { readonly compiledPlan: ExecutablePlan };
  readonly diff: readonly VersionSectionDiff[];
}
export interface FrozenVersionReview extends SubmittedVersionReview { readonly approval: VersionDecisionRecord }

export function rejectionRationale(value: unknown): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, reason: 'Enter a rationale for rejecting this Procedure Version.' };
  if (value.length > 4000) return { ok: false, reason: 'The rejection rationale must be at most 4000 characters.' };
  try { canonicalJson(value); } catch { return { ok: false, reason: 'That value contains a character this system cannot store.' }; }
  return { ok: true, value: value.trim() };
}

function sections(value: ReviewedDefinition): Readonly<Record<string, JsonValue>> {
  const i = value.inputs;
  return {
    Control: { name: i.controlName, templateId: i.templateId, definition: i.sections.find(s => s.heading === 'Control')?.content ?? null },
    Objective: i.sections.find(s => s.heading === 'Objective')?.content ?? null,
    'Period and scope': { period: i.period, scope: i.scope },
    'Population Source binding': { source: i.sourceSnapshot, inclusionRule: i.inclusionRule, zeroRecordPass: i.zeroRecordPass, allowVersionedDuplicates: i.allowVersionedDuplicates },
    'Target Systems': i.targets,
    'Audit Instructions': i.instructions,
    'Compliance Rule': { compilerVersion: i.complianceCompilerVersion, schemaVersion: i.complianceSchemaVersion, conditions: i.complianceConditions, confidenceThreshold: i.agentJudgedThreshold },
    'Evidence Requirements': i.evidenceRequirements,
    Schedule: i.schedule,
    'Executable plan': value.compiledPlan,
    'Model and tool configuration': { model: value.modelConfiguration, tools: value.toolConfiguration },
    Limits: value.compiledPlan?.limits ?? null,
  } as unknown as Readonly<Record<string, JsonValue>>;
}

/** First-version sections are all additions and therefore all expanded by the view. */
export function diffReviewedDefinitions(before: ReviewedDefinition | null, after: ReviewedDefinition): readonly VersionSectionDiff[] {
  const prior = before === null ? null : sections(before);
  return Object.entries(sections(after)).map(([section, value]) => ({
    section, before: prior?.[section] ?? null, after: value,
    changed: prior === null || canonicalJson(prior[section] ?? null) !== canonicalJson(value),
  }));
}

/** Validate the durable comparison without consulting a mutable predecessor. */
export function isConsistentVersionReview(review: SubmittedVersionReview, versionId: string): boolean {
  if (review.versionId !== versionId || review.baseline?.versionId === versionId) return false;
  const expected = diffReviewedDefinitions(null, review.definition);
  if (review.diff.length !== expected.length || new Set(review.diff.map(section => section.section)).size !== expected.length) return false;
  return expected.every(section => {
    const stored = review.diff.find(entry => entry.section === section.section);
    if (!stored || canonicalJson(stored.after) !== canonicalJson(section.after)) return false;
    if (review.baseline === null) return stored.before === null && stored.changed;
    return stored.changed === (canonicalJson(stored.before) !== canonicalJson(stored.after));
  });
}
