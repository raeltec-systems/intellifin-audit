import { canonicalJson, hasAgentDrivenTarget, withPlatformCaptured, isAgentDrivenKind, type PlatformDraftOrigin } from '@intellifin/domain';
import type { UuidV7Generator } from '../audit/clock.js';
import type { ProceduresUnitOfWorkContext, ProcedureVersionRecord } from './ports.js';
import { initialPlanDerivation, queuePlanDerivation } from './plan-state.js';

import type { ProcedureConfigurationChange } from './configuration-change-ports.js';
export type { ProcedureConfigurationChange, ProcedureChangeHandler } from './configuration-change-ports.js';
export function affectedBy(row: ProcedureVersionRecord, kind: 'registration' | 'source', id: string): boolean {
  return row.state === 'ACTIVE' && (kind === 'registration' ? row.targets.some(target => target.registrationId === id) : row.sourceSnapshot?.bindingId === id);
}
export async function copyActiveDraft(context: ProceduresUnitOfWorkContext, ids: UuidV7Generator, before: ProcedureVersionRecord, authorId: string | null, origin: PlatformDraftOrigin | null, changes: Partial<ProcedureVersionRecord> = {}, humanContext?: { sessionId: string; correlationId: string }): Promise<ProcedureVersionRecord> {
  if (before.state !== 'ACTIVE' || !before.authorship) throw new Error('An Active version with verified responsibility is required.');
  const versionId = ids.next();
  let draft: ProcedureVersionRecord = { ...before, ...changes, ...initialPlanDerivation(changes.derivationModel === undefined ? before.derivationModel : changes.derivationModel),
    versionId, versionNumber: await context.procedures.maxVersionNumber(before.procedureId) + 1, state: 'DRAFT', lifecycle: null,
    submittedReview: null, frozenReview: null, decisions: [], platformOrigin: origin,
    authorship: { createdBy: authorId ? { type: 'human', id: authorId } : { type: 'platform', id: 'configuration-change' },
      responsibleAuthorId: authorId ?? before.authorship.responsibleAuthorId, humanAuthorIds: authorId ? [authorId] : [] } };
  draft = await queuePlanDerivation(draft, context.derivationJobs);
  await context.procedures.insertVersion(draft);
  await context.auditEvents.append({ actor: authorId ? { type: 'human', id: authorId } : { type: 'system', id: 'configuration-change' },
    eventType: 'lifecycle.procedure-version-created', source: authorId ? 'web' : 'platform', outcome: 'success', sessionId: humanContext?.sessionId ?? 'platform-configuration', correlationId: humanContext?.correlationId ?? origin?.changeId ?? versionId,
    aggregateId: before.procedureId, payload: { versionId, originatingVersionId: before.versionId, changeId: origin?.changeId ?? null, changeKind: origin?.kind ?? null, requiresApproval: true } });
  return draft;
}
/** Idempotency is checked before membership discovery: historical replay cannot fan out anew. */
export async function mintPlatformDraft(context: ProceduresUnitOfWorkContext, ids: UuidV7Generator, change: ProcedureConfigurationChange): Promise<readonly string[]> {
  const writer = context.procedures;
  if (!writer.findChangeResult || !writer.recordChangeResult || !writer.listActiveVersions) throw new Error('Configuration change transaction is unavailable.');
  const existing = await writer.findChangeResult(change.changeId);
  if (existing !== null) return existing;
  const minted: string[] = [];
  const affected = change.kind === 'registration' ? { kind: change.kind, id: change.snapshot.registrationId } : change.kind === 'source' ? { kind: change.kind, id: change.snapshot.bindingId } : undefined;
  for (const before of await writer.listActiveVersions(affected)) {
    let changes: Partial<ProcedureVersionRecord>;
    if (change.kind === 'registration') {
      if (!affectedBy(before, change.kind, change.snapshot.registrationId)) continue;
      const targets = before.targets.map(target => target.registrationId === change.snapshot.registrationId ? change.snapshot : target);
      changes = { targets, evidenceRequirements: before.evidenceRequirements.map(requirement => withPlatformCaptured(requirement, hasAgentDrivenTarget(targets))), instructions: before.instructions.filter(instruction => targets.some(target => target.registrationId === instruction.registrationId && isAgentDrivenKind(target.contract.kind))) };
    } else if (change.kind === 'source') {
      if (!affectedBy(before, change.kind, change.snapshot.bindingId)) continue;
      changes = { sourceSnapshot: change.snapshot, populationBlockers: change.snapshot.contract.declared_count_mechanism === 'none' ? ['declared-count-missing'] : [] };
    } else {
      if (canonicalJson(before.derivationModel ? { ...before.derivationModel } : null) === canonicalJson(change.model ? { ...change.model } : null)) continue;
      changes = { derivationModel: change.model, configurationRevision: change.revision };
    }
    const origin: PlatformDraftOrigin = { changeId: change.changeId, originatingVersionId: before.versionId, kind: change.kind, description: 'snapshot' in change ? `${change.kind} change to ${change.snapshot.displayName}` : `${change.kind} change` };
    minted.push((await copyActiveDraft(context, ids, before, null, origin, changes)).versionId);
  }
  await writer.recordChangeResult(change.changeId, minted);
  return minted;
}
