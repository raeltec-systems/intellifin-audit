import { deriveExecutablePlan, diffReviewedDefinitions, type VersionDecisionRecord } from '@intellifin/domain';
import { initialPlanDerivation, planAuthoringDigest, reviewedDefinition, type ProcedureVersionRecord } from '@intellifin/application';
import { executablePlanInputs } from './executable-plan.js';
/** Frozen, self-consistent fixture. Callers insert it through the Procedure writer. */
export function activeRunVersion(procedureId: string, versionId: string, authorId: string, inputs = executablePlanInputs()): ProcedureVersionRecord {
  const plan = deriveExecutablePlan(inputs);
  if (!plan.ok) throw new Error(plan.reason);
  let row: ProcedureVersionRecord = { ...inputs, ...initialPlanDerivation(), procedureId, versionId, versionNumber: 1, state: 'ACTIVE', compiledPlan: plan.plan, planStatus: 'succeeded', planDerivable: true,
    authorship: { createdBy: { type: 'human', id: authorId }, responsibleAuthorId: authorId, humanAuthorIds: [authorId] },
    lifecycle: { requiresRegression: false, reason: 'first-version', priorActiveVersionId: null, activatedAt: '2026-01-01T12:00:00.000Z', handoverAt: null } };
  row = { ...row, planInputDigest: planAuthoringDigest(row) };
  const definition = { ...reviewedDefinition(row), compiledPlan: plan.plan };
  const approval: VersionDecisionRecord = { schemaVersion: 1, actorId: 'synthetic-manager', occurredAt: '2026-01-01T12:00:00.000Z', priorState: 'SUBMITTED', decision: 'approve', rationale: null, aggregateRevision: '1'.repeat(64) };
  const review = { schemaVersion: 1 as const, versionId, baseline: null, definition, diff: diffReviewedDefinitions(null, definition) };
  return { ...row, decisions: [approval], submittedReview: review, frozenReview: { ...review, approval } };
}
