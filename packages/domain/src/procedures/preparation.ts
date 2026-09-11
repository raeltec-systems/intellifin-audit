import { canonicalJson, type JsonValue } from '../canonical-json.js';
import { sha256Hex } from '../sha256.js';
import type { FrozenPlanInputs } from './executable-plan.js';

export const PREPARATION_SECTIONS = ['context', 'scope', 'evidence', 'instructions', 'assessment', 'frequency'] as const;
export type PreparationSectionId = typeof PREPARATION_SECTIONS[number];
export interface SectionReview { readonly actorId: string; readonly at: string; readonly basis: string; readonly revision: number }
export interface PreparedSection {
  readonly basis: string;
  readonly revision: number;
  readonly needsClarification: boolean;
  readonly review: SectionReview | null;
}
export interface SectionPreparation {
  readonly schemaVersion: 1;
  /** Moves on every saved authoring change, including an edit followed by a reversal. */
  readonly revision: number;
  readonly sections: Readonly<Record<PreparationSectionId, PreparedSection>>;
}
export type PreparationInputs = FrozenPlanInputs & { readonly sectionPreparation?: SectionPreparation | null };
/** Minimum saved content for a new acknowledgement, not plan or execution readiness. */
export function preparationReviewBlocker(row: PreparationInputs, id: PreparationSectionId): string | null {
  if (id === 'context' && !row.sections.some(s => s.heading === 'Objective' && s.content?.trim())) return 'Save the objective before reviewing this section.';
  if (id === 'scope' && (row.period === null || !row.scope.trim())) return 'Save the scope and dates before reviewing this section.';
  if (id === 'evidence' && (row.sourceSnapshot === null || row.targets.length === 0)) return 'Choose and save the population source and systems before reviewing this section.';
  if (id === 'instructions' && (row.targets.length === 0 || row.targets.some(target =>
    (target.contract.kind === 'web' || target.contract.kind === 'desktop') && !row.instructions.some(instruction => instruction.registrationId === target.registrationId && instruction.text.trim())))) return 'Save the test steps for each selected system before reviewing this section.';
  if (id === 'assessment' && row.complianceConditions.length === 0) return 'Save the assessment criteria before reviewing this section.';
  if (id === 'frequency' && row.schedule === null) return 'Save the frequency before reviewing this section.';
  return null;
}
export function isPreparationSectionId(value: unknown): value is PreparationSectionId {
  return typeof value === 'string' && (PREPARATION_SECTIONS as readonly string[]).includes(value);
}

/** Conservative, explicit dependencies. No semantic-equivalence claim is made. */
export function preparationBasis(row: FrozenPlanInputs, section: PreparationSectionId): string {
  const context = { templateId: row.templateId, controlName: row.controlName, context: row.sections.filter(s => ['Risk', 'Control', 'Objective', 'Criterion reference'].includes(s.heading)) };
  const scope = { period: row.period, scope: row.scope, source: row.sourceSnapshot, inclusion: row.inclusionRule,
    schedule: row.schedule, zero: row.zeroRecordPass, duplicates: row.allowVersionedDuplicates, targets: row.targets };
  const assessment = { conditions: row.complianceConditions, threshold: row.agentJudgedThreshold,
    schema: row.complianceSchemaVersion, compiler: row.complianceCompilerVersion };
  const evidence = { requirements: row.evidenceRequirements, schema: row.evidenceSchemaVersion };
  const projections = {
    context,
    scope: { context, scope },
    evidence: { context, scope, assessment, evidence, instructions: row.instructions },
    instructions: { context, scope, assessment, evidence, instructions: row.instructions },
    assessment: { context, scope, assessment, evidence, instructions: row.instructions },
    frequency: { schedule: row.schedule, sourceKind: row.sourceSnapshot?.contract.kind ?? null },
  };
  return sha256Hex(canonicalJson(projections[section] as unknown as JsonValue));
}

/** Called by the shared draft-save path, never by model generation or plan workers. */
export function refreshPreparation(row: PreparationInputs): SectionPreparation {
  const prior = row.sectionPreparation;
  const sections = Object.fromEntries(PREPARATION_SECTIONS.map(id => {
    const basis = preparationBasis(row, id), old = prior?.sections[id];
    return [id, old?.basis === basis ? old : { basis, revision: (old?.revision ?? 0) + 1,
      needsClarification: old?.needsClarification ?? false, review: null }];
  })) as unknown as SectionPreparation['sections'];
  return { schemaVersion: 1, revision: (prior?.revision ?? 0) + 1, sections };
}
export function sectionReview(row: PreparationInputs, id: PreparationSectionId): SectionReview | null {
  const section = row.sectionPreparation?.sections[id], review = section?.review;
  return section && !section.needsClarification && review?.basis === preparationBasis(row, id)
    && review.revision === section.revision ? review : null;
}
export function preparationStatus(row: PreparationInputs, id: PreparationSectionId): 'not-started' | 'drafting' | 'needs-clarification' | 'reviewed' {
  if (row.sectionPreparation?.sections[id].needsClarification) return 'needs-clarification';
  if (sectionReview(row, id)) return 'reviewed';
  const started = {
    context: row.sections.some(s => ['Risk', 'Control', 'Objective', 'Criterion reference'].includes(s.heading) && s.content?.trim()),
    scope: row.period !== null || row.scope.trim() !== '' || row.targets.length > 0,
    evidence: row.sourceSnapshot !== null || row.evidenceRequirements.length > 0,
    instructions: row.instructions.length > 0,
    assessment: row.complianceConditions.length > 0,
    frequency: row.schedule !== null,
  };
  return started[id] ? 'drafting' : 'not-started';
}

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const revision = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const digest = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
export function isSectionPreparation(value: unknown): value is SectionPreparation {
  if (!object(value) || !exact(value, ['schemaVersion', 'revision', 'sections']) || value['schemaVersion'] !== 1 || !revision(value['revision']) || !object(value['sections']) || !exact(value['sections'], PREPARATION_SECTIONS)) return false;
  return Object.values(value['sections']).every(s => {
    if (!object(s) || !exact(s, ['basis', 'revision', 'needsClarification', 'review']) || !digest(s['basis']) || !revision(s['revision']) || typeof s['needsClarification'] !== 'boolean') return false;
    const r = s['review'];
    return r === null || (object(r) && exact(r, ['actorId', 'at', 'basis', 'revision']) && typeof r['actorId'] === 'string' && r['actorId'].length > 0 && r['actorId'].length <= 200
      && typeof r['at'] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r['at']) && Number.isFinite(Date.parse(r['at']))
      && r['basis'] === s['basis'] && r['revision'] === s['revision'] && !s['needsClarification']);
  });
}
