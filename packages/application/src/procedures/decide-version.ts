import { authorizeAction, canTransition, diffReviewedDefinitions, rejectionRationale, type VersionDecision, type VersionDecisionRecord, type ProcedureVersionState, type ReviewedDefinition } from '@intellifin/domain';
import { authorizeCommandRole, recordAuthorizationDenial } from '../identity/authorize.js';
import type { SessionSnapshot } from '../identity/ports.js';
import { procedureVersionRowVersion, PROCEDURE_REFUSALS, type ProcedureDependencies, type ProcedureOutcome } from './create-procedure.js';
import type { ProcedureVersionRecord } from './ports.js';
import { UnverifiablePreviousVersion } from './ports.js';
import { submissionUnavailableReason } from './submission-guard.js';
import { planAuthoringInputs } from './plan-state.js';

export interface VersionTransitionInput {
  readonly session: SessionSnapshot;
  readonly correlationId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly expectedRowVersion: string;
  readonly rationale?: unknown;
}
class Refused extends Error {}
class PermissionRefused extends Refused {
  constructor(reason: string, readonly role: import('@intellifin/domain').Role | null) { super(reason); }
}
export function reviewedDefinition(row: ProcedureVersionRecord): ReviewedDefinition {
  if (row.frozenReview) return row.frozenReview.definition;
  return { schemaVersion: 1, inputs: planAuthoringInputs(row), compiledPlan: row.compiledPlan, modelConfiguration: row.derivationModel,
    toolConfiguration: { interpreterContract: 'executable-plan-v1', identityMatching: 'opaque-exact-strings', accessPolicy: 'frozen-registered-read-actions',
      actions: ['create-workspace', 'acquire-population', 'sign-in', 'extract-adapter', 'inspect-record', 'capture-observation', 'evaluate-conditions'] } };
}
export async function transitionVersion(dependencies: ProcedureDependencies, input: VersionTransitionInput, decision: VersionDecision): Promise<ProcedureOutcome<{ rowVersion: string; state: ProcedureVersionState }>> {
  const action = decision === 'edit' ? 'procedure.author' : decision === 'submit' ? 'procedure.version.submit' : decision === 'approve' ? 'procedure.version.approve' : 'procedure.version.reject';
  const permission = await authorizeCommandRole(dependencies, { session: input.session, correlationId: input.correlationId, action });
  if (!permission.allowed) return { ok: false, reason: permission.reason };
  const rationale = decision === 'reject' ? rejectionRationale(input.rationale) : { ok: true as const, value: null };
  if (!rationale.ok) return rationale;
  let trustedContext: { authorId?: string; humanAuthorIds?: readonly string[] } = {};
  try {
    return await dependencies.unitOfWork.execute(async ({ procedures, auditEvents, notifications, notificationRecipients, authorizationRoles }) => {
      const before = await procedures.findVersionForUpdate(input.versionId);
      if (!before || before.procedureId !== input.procedureId) throw new Refused(PROCEDURE_REFUSALS.UNKNOWN_VERSION);
      if (procedureVersionRowVersion(before) !== input.expectedRowVersion) throw new Refused(PROCEDURE_REFUSALS.STALE_ROW);
      trustedContext = before.authorship ? { authorId: before.authorship.responsibleAuthorId, humanAuthorIds: before.authorship.humanAuthorIds } : {};
      const lockedRole = await authorizationRoles.findRole(input.session.userId);
      const authorized = authorizeAction(lockedRole, action, { ...trustedContext, actorId: input.session.userId });
      if (!authorized.allowed) throw new PermissionRefused(authorized.reason, lockedRole);
      const state = ({ submit: 'SUBMITTED', approve: 'APPROVED', reject: 'REJECTED', edit: 'DRAFT' } as const)[decision];
      if (!canTransition(before.state, state)) throw new Refused('This Procedure Version cannot make that transition. Reload the page.');
      if (decision === 'submit') { const reason = submissionUnavailableReason(before); if (reason) throw new Refused(reason); }
      if (!before.authorship) throw new Refused('The responsible author of this Procedure Version could not be verified.');
      const record: VersionDecisionRecord = { schemaVersion: 1, actorId: input.session.userId, occurredAt: new Date().toISOString(), priorState: before.state, decision, rationale: rationale.value, aggregateRevision: input.expectedRowVersion };
      let after: ProcedureVersionRecord = { ...before, state, decisions: [...before.decisions ?? [], record] };
      if (decision === 'submit') {
        const definition = reviewedDefinition(before);
        if (!definition.compiledPlan || !procedures.findPreviousVersion) throw new Refused('The reviewed executable plan could not be verified.');
        const previous = await procedures.findPreviousVersion(before.procedureId, before.versionNumber);
        const priorDefinition = previous ? reviewedDefinition(previous) : null;
        after = { ...after, submittedReview: { schemaVersion: 1, versionId: before.versionId, baseline: previous ? { versionId: previous.versionId, versionNumber: previous.versionNumber, revision: procedureVersionRowVersion(previous) } : null, definition: { ...definition, compiledPlan: definition.compiledPlan }, diff: diffReviewedDefinitions(priorDefinition, definition) } };
      }
      if (decision === 'approve') {
        if (!before.submittedReview) throw new Refused('The submitted review snapshot could not be verified.');
        after = { ...after, frozenReview: { ...before.submittedReview, approval: record } };
      }
      if (decision === 'edit') after = { ...after, submittedReview: null };
      await procedures.updateVersion(after);
      await auditEvents.append({ actor: { type: 'human', id: input.session.userId }, eventType: 'lifecycle.procedure-version-decided', source: 'web', outcome: 'success', sessionId: input.session.sessionId, correlationId: input.correlationId, aggregateId: input.procedureId,
        payload: { versionId: before.versionId, decision, priorState: before.state, state, aggregateRevision: input.expectedRowVersion, occurredAt: record.occurredAt, rationale: record.rationale } });
      if (decision !== 'edit') {
        if (!notifications || !notificationRecipients) throw new Error('Procedure notification transaction is unavailable.');
        const recipients = decision === 'submit' ? await notificationRecipients.auditManagerIds() : [before.authorship.responsibleAuthorId];
        for (const recipientId of new Set(recipients)) await notifications.enqueue({ sendKey: `${before.versionId}:${input.expectedRowVersion}:${decision}:${recipientId}`, recipientId, procedureId: before.procedureId, versionId: before.versionId, procedureName: before.controlName, versionNumber: before.versionNumber, kind: decision === 'submit' ? 'submitted' : decision === 'approve' ? 'approved' : 'rejected' });
      }
      return { ok: true, rowVersion: procedureVersionRowVersion(after), state };
    });
  } catch (error) {
    if (error instanceof UnverifiablePreviousVersion) return { ok: false, reason: error.message };
    if (error instanceof PermissionRefused) await recordAuthorizationDenial(dependencies, { session: input.session, correlationId: input.correlationId, action }, error.role, error.message);
    if (error instanceof Refused) return { ok: false, reason: error.message };
    throw error;
  }
}
export function decideVersion(dependencies: ProcedureDependencies, input: VersionTransitionInput & { readonly decision: 'approve' | 'reject' }) { return transitionVersion(dependencies, input, input.decision); }
export function editRejectedVersion(dependencies: ProcedureDependencies, input: VersionTransitionInput) { return transitionVersion(dependencies, input, 'edit'); }
