import { CONTEXT_TEXT_LIMIT, utf8Bytes, canonicalJson, draftContext, isAgentDrivenKind, preparationBasis, sha256Hex, type JsonValue, type PreparationSectionId } from '@intellifin/domain';
import type { Clock } from '../audit/clock.js';
import { authorizeCommand } from '../identity/authorize.js';
import type { SessionSnapshot } from '../identity/ports.js';
import { PROCEDURE_AUTHOR_ACTION, PROCEDURE_REFUSALS, procedureVersionRowVersion, type ProcedureDependencies, type ProcedureOutcome } from './create-procedure.js';
import { planAuthoringDigest } from './plan-state.js';
import type { ProceduresUnitOfWorkContext, ProcedureVersionRecord } from './ports.js';
import { updateContextDraft } from './update-context-draft.js';
import { updatePopulationDraft } from './update-population-draft.js';
import { updateTargetDraft } from './update-target-draft.js';
import { AUTHORING_IDENTITY, AUTHORING_LIMITS, isAuthoringProgress, type AuthoringProgress, type AcceptAuthoringFields, type AuthoringDraftFields, type AuthoringProposal, type AuthoringRequestRecord, type AuthoringRevisionContext, type AuthoringSection, type AuthoringSuggestionView, type ProcedureAuthoringModel, type RejectAuthoringFields } from './authoring-ports.js';

type Actor = { readonly session: SessionSnapshot; readonly correlationId: string };
export interface AuthoringDependencies extends ProcedureDependencies { readonly clock: Clock; readonly model: ProcedureAuthoringModel | null }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const text = (v: unknown, limit: number) => typeof v === 'string' && v.length <= limit;
const digest = (v: unknown) => sha256Hex(canonicalJson(v as JsonValue));
const tokenUsage = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 10_000_000 ? v : null;
const storable = (v: unknown) => { try { canonicalJson(v as JsonValue); return true; } catch { return false; } };
export function isAuthoringSection(value: unknown): value is AuthoringSection {
  return object(value) && (value['kind'] === 'objective' || value['kind'] === 'scope' ? Object.keys(value).length === 1
    : value['kind'] === 'instructions' && Object.keys(value).length === 2 && uuid(value['registrationId']));
}
export function isAuthoringDraftFields(value: unknown): value is AuthoringDraftFields {
  return object(value) && Object.keys(value).length === (value['revision'] === undefined ? 8 : 9) && uuid(value['procedureId']) && uuid(value['versionId']) && uuid(value['requestId']) && hash(value['expectedRowVersion'])
    && isAuthoringSection(value['section']) && ['draft', 'improve', 'revise'].includes(String(value['mode'])) && text(value['notes'], AUTHORING_LIMITS.notes)
    && text(value['changes'], AUTHORING_LIMITS.changes) && (value['revision'] === undefined || (value['mode'] === 'revise'
      && typeof value['changes'] === 'string' && value['changes'].trim() !== '' && object(value['revision']) && Object.keys(value['revision']).length === 2
      && uuid(value['revision']['requestId']) && value['revision']['requestId'] !== value['requestId'] && text(value['revision']['draft'], AUTHORING_LIMITS.outputText))) && storable(value);
}
export function isAcceptAuthoringFields(value: unknown): value is AcceptAuthoringFields {
  return object(value) && Object.keys(value).length === 5 && uuid(value['procedureId']) && uuid(value['versionId']) && uuid(value['requestId']) && hash(value['expectedRowVersion'])
    && text(value['replacement'], AUTHORING_LIMITS.outputText) && typeof value['replacement'] === 'string' && value['replacement'].trim() !== '' && storable(value);
}
export function isRejectAuthoringFields(value: unknown): value is RejectAuthoringFields {
  return object(value) && Object.keys(value).length === 3 && uuid(value['procedureId']) && uuid(value['versionId']) && uuid(value['requestId']);
}
export function isAuthoringProposal(value: unknown, limit: number = AUTHORING_LIMITS.outputText): value is AuthoringProposal {
  if (!object(value) || Object.keys(value).length !== (value['explanation'] === undefined ? 2 : 3)
    || (value['explanation'] !== undefined && (typeof value['explanation'] !== 'string' || !value['explanation'].trim() || value['explanation'].length > 2000))
    || !Array.isArray(value['clarifications']) || value['clarifications'].length > 4
    || !value['clarifications'].every(v => typeof v === 'string' && v.trim() !== '' && v.length <= 1000) || !storable(value)) return false;
  // An unresolved question is not an applicable draft. The human can answer it in a new request.
  return value['proposedText'] === null ? value['clarifications'].length > 0
    : typeof value['proposedText'] === 'string' && value['proposedText'].trim() !== '' && value['proposedText'].length <= limit && value['clarifications'].length === 0;
}
const preparationSection = (s: AuthoringSection): PreparationSectionId => s.kind === 'objective' ? 'context' : s.kind === 'scope' ? 'scope' : 'instructions';
export function authoringCurrentText(row: ProcedureVersionRecord, s: AuthoringSection): string {
  return s.kind === 'objective' ? draftContext(row.sections).objective : s.kind === 'scope' ? row.scope : row.instructions.find(i => i.registrationId === s.registrationId)?.text ?? '';
}
/** Saved context only, omitting structured source locations and credential references.
 * User-authored prose is checked separately before it can leave the application. */
export function authoringContext(row: ProcedureVersionRecord): JsonValue {
  return { templateId: row.templateId, controlName: row.controlName, ...draftContext(row.sections), period: row.period, scope: row.scope,
    population: row.sourceSnapshot ? { name: row.sourceSnapshot.displayName, kind: row.sourceSnapshot.contract.kind, columns: row.sourceSnapshot.contract.declared_schema } : null,
    inclusionRule: row.inclusionRule, zeroRecordPass: row.zeroRecordPass, allowVersionedDuplicates: row.allowVersionedDuplicates,
    targets: row.targets.map(t => ({ id: t.registrationId, name: t.displayName, kind: t.contract.kind,
      permittedReadActions: t.contract.permitted_actions, attributeLabels: t.contract.attribute_label_patterns, secondaryKey: t.contract.secondary_key })),
    instructions: row.instructions, criteria: row.complianceConditions, confidenceThreshold: row.agentJudgedThreshold,
    evidence: row.evidenceRequirements, frequency: row.schedule,
    preparationCapabilities: {
      instructionPurpose: 'Read-only navigation and inspection within the selected system. The Template compiler owns matching, coverage and evaluation.',
      structuredChanges: 'The auditor selects scope, evidence, systems, criteria and frequency in their preparation sections before requesting matching instructions.',
      unsupported: ['Uploading or ingesting new documents', 'Selecting connections or accessing credentials', 'Writing to systems', 'Approving, activating or running a procedure', 'Automatic scheduled execution'],
    },
  } as unknown as JsonValue;
}
class Refused extends Error {}
function hasCredentialMaterial(value: unknown, references: readonly string[]): boolean {
  if (typeof value === 'string') return references.some(ref => ref.length > 0 && value.includes(ref))
    || /\b(?:vault|cred|credentials?):\/\/|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(value);
  if (Array.isArray(value)) return value.some(item => hasCredentialMaterial(item, references));
  return object(value) && Object.values(value).some(item => hasCredentialMaterial(item, references));
}
function fieldsOnly(input: AuthoringDraftFields): AuthoringDraftFields {
  return { procedureId: input.procedureId, versionId: input.versionId, expectedRowVersion: input.expectedRowVersion, requestId: input.requestId,
    section: input.section, mode: input.mode, notes: input.notes, changes: input.changes,
    ...(input.revision === undefined ? {} : { revision: input.revision }) };
}
function sameDraft(record: AuthoringRequestRecord, row: ProcedureVersionRecord, now: Date): boolean {
  return row.state === 'DRAFT' && record.authoringRevision === (row.sectionPreparation?.revision ?? 0)
    && record.decisionDigest === digest(row.decisions ?? [])
    && record.contextDigest === planAuthoringDigest(row) && record.sectionBasis === preparationBasis(row, preparationSection(record.section))
    && Date.parse(record.expiresAt) > now.getTime();
}
function view(record: AuthoringRequestRecord, row: ProcedureVersionRecord, now: Date): AuthoringSuggestionView {
  const uncertain = record.state === 'pending' && now.getTime() - Date.parse(record.createdAt) > AUTHORING_LIMITS.timeoutMs + 5000;
  return { requestId: record.requestId, section: record.section, currentText: record.currentText, proposedText: record.proposedText, clarifications: record.clarifications,
    ...(record.explanation === undefined ? {} : { explanation: record.explanation }),
    authoringRevision: record.authoringRevision, state: uncertain ? 'failed' : record.state, stale: !sameDraft(record, row, now),
    message: uncertain ? 'No response was confirmed. Your procedure is unchanged. Start a new request or keep writing manually.' : record.message };
}
async function ownedDraft(tx: ProceduresUnitOfWorkContext, input: { versionId: string; procedureId: string }): Promise<ProcedureVersionRecord> {
  const row = await tx.procedures.findVersionForUpdate(input.versionId);
  if (!row || row.procedureId !== input.procedureId) throw new Refused(PROCEDURE_REFUSALS.UNKNOWN_VERSION);
  return row;
}
function ownedRequest(record: AuthoringRequestRecord | null, input: Actor & RejectAuthoringFields): AuthoringRequestRecord {
  if (!record || record.actorId !== input.session.userId || record.versionId !== input.versionId || record.procedureId !== input.procedureId) throw new Refused('That writing suggestion is unavailable.');
  return record;
}
/** Follow-ups are grounded in this human's live proposal. Walk a bounded history in
 * the same locked transaction; a client cannot refer to another author's conversation. */
async function revisionContext(tx: ProceduresUnitOfWorkContext, row: ProcedureVersionRecord, input: AuthoringDraftFields & Actor, now: Date): Promise<AuthoringRevisionContext | undefined> {
  if (!input.revision) return undefined;
  const history: Array<AuthoringRevisionContext['history'][number]> = [];
  const visited = new Set<string>();
  let id: string | undefined = input.revision.requestId;
  while (id !== undefined && history.length < 4) {
    if (visited.has(id)) throw new Refused('This revision history is invalid. Start with the saved section.');
    visited.add(id);
    const previous = ownedRequest(await tx.authoringRequests!.find(id), input);
    if (previous.state !== 'ready' || digest(previous.section) !== digest(input.section) || !sameDraft(previous, row, now)) {
      throw new Refused('This proposal is stale or no longer available for revision. Start with the current saved section.');
    }
    history.unshift({ feedback: previous.revision?.feedback ?? '', proposedText: previous.proposedText, clarifications: previous.clarifications });
    id = previous.revision?.requestId;
  }
  return { draft: input.revision.draft, history };
}
async function audit(tx: ProceduresUnitOfWorkContext, input: Actor, record: AuthoringRequestRecord, decision: string): Promise<void> {
  await tx.auditEvents.append({ actor: { type: 'human', id: input.session.userId }, eventType: 'lifecycle.procedure-writing-assistance', source: 'web', outcome: record.state === 'failed' ? 'failure' : 'success',
    sessionId: input.session.sessionId, correlationId: input.correlationId, aggregateId: record.procedureId,
    payload: { requestId: record.requestId, versionId: record.versionId, section: record.section as unknown as JsonValue, decision,
      // Full provider identity is retained in the bounded request receipt. The
      // immutable chain forbids provider payloads; record only identity references.
      modelId: record.identity.modelId, promptVersion: record.identity.promptVersion,
      contextDigest: record.contextDigest, authoringRevision: record.authoringRevision, usage: record.usage as unknown as JsonValue, acceptedDigest: record.acceptedDigest,
      ...(record.revision === undefined ? {} : { parentRequestId: record.revision.requestId }) } });
}

export async function generateAuthoringSuggestion(deps: AuthoringDependencies, input: AuthoringDraftFields & Actor, onProgress?: (progress: AuthoringProgress) => Promise<void> | void): Promise<ProcedureOutcome<{ suggestion: AuthoringSuggestionView }>> {
  const auth = await authorizeCommand(deps, { session: input.session, action: PROCEDURE_AUTHOR_ACTION, correlationId: input.correlationId });
  if (!auth.allowed) return { ok: false, reason: auth.reason };
  const fields = fieldsOnly(input);
  if (!isAuthoringDraftFields(fields)) return { ok: false, reason: 'Enter valid notes within the writing limits.' };
  try {
    const prepared = await deps.unitOfWork.execute(async tx => {
      const row = await ownedDraft(tx, input), store = tx.authoringRequests;
      if (row.state !== 'DRAFT') throw new Refused(PROCEDURE_REFUSALS.NOT_A_DRAFT);
      if (!row.authorship) throw new Refused('The authorship of this draft could not be verified.');
      if (!store || !deps.model) throw new Refused('Writing assistance is not configured. You can write, edit and save manually.');
      const existing = await store.find(input.requestId);
      if (existing) {
        const record = ownedRequest(existing, input);
        if (record.requestDigest !== digest(fields)) throw new Refused('This request identifier was already used for different notes. Start a new request.');
        return { existing: view(record, row, deps.clock.now()) };
      }
      if (procedureVersionRowVersion(row) !== input.expectedRowVersion) throw new Refused(PROCEDURE_REFUSALS.STALE_ROW);
      const selectedSection = input.section;
      if (selectedSection.kind === 'instructions' && !row.targets.some(t => t.registrationId === selectedSection.registrationId && isAgentDrivenKind(t.contract.kind))) throw new Refused('Select an agent-driven system before preparing its instructions.');
      const now = deps.clock.now();
      if (await store.countSince(input.session.userId, new Date(now.getTime() - 60000).toISOString()) >= AUTHORING_LIMITS.perMinute
        || await store.countSince(input.session.userId, new Date(now.getTime() - 3600000).toISOString()) >= AUTHORING_LIMITS.perHour) throw new Refused('The writing request limit has been reached. Try later or keep writing manually.');
      const revision = await revisionContext(tx, row, input, now);
      const request = { section: input.section, mode: input.mode, context: authoringContext(row), currentText: authoringCurrentText(row, input.section), notes: input.notes, changes: input.changes,
        ...(revision === undefined ? {} : { revision }) };
      if (utf8Bytes(canonicalJson(request as unknown as JsonValue)).length > AUTHORING_LIMITS.contextBytes) throw new Refused('This procedure exceeds the writing context limit. Shorten the notes or continue manually.');
      // Refuse rather than silently redact a meaningful instruction. Manual saves
      // remain valid, including historical prose containing credential references.
      const credentialReferences = row.targets.map(target => target.contract.credential_ref);
      if (hasCredentialMaterial(request, credentialReferences)) throw new Refused('Writing help cannot receive credential values or references. Remove them from the notes or saved prose, or continue writing manually.');
      // Infrastructure knows its configured key. Check before retaining revision
      // content, not only immediately before the network request.
      try { deps.model.assertSafeInput?.(request); }
      catch { throw new Refused('Writing help cannot receive protected configuration. Remove it from the proposal and feedback, or continue writing manually.'); }
      const record: AuthoringRequestRecord = { requestId: input.requestId, procedureId: row.procedureId, versionId: row.versionId, actorId: input.session.userId,
        createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + AUTHORING_LIMITS.lifetimeMs).toISOString(), section: input.section, requestDigest: digest(fields),
        authoringRevision: row.sectionPreparation?.revision ?? 0, contextDigest: planAuthoringDigest(row), sectionBasis: preparationBasis(row, preparationSection(input.section)),
        decisionDigest: digest(row.decisions ?? []),
        currentText: request.currentText, state: 'pending', proposedText: null, clarifications: [], identity: AUTHORING_IDENTITY, usage: null, message: null, acceptedDigest: null,
        ...(input.revision === undefined ? {} : { revision: { ...input.revision, feedback: input.changes } }) };
      await store.insert(record); await audit(tx, input, record, 'requested');
      // References stay in server memory for output filtering, never in model context.
      return { record, request, credentialReferences };
    });
    if (prepared.existing !== undefined) return { ok: true, suggestion: prepared.existing };
    let complete: AuthoringRequestRecord = prepared.record;
    try {
      const response = await deps.model!.propose(prepared.request, onProgress ? async progress => {
        if (!isAuthoringProgress(progress) || hasCredentialMaterial(progress, prepared.credentialReferences)) throw new Error('Invalid partial authoring response');
        const allowed = await authorizeCommand(deps, { session: input.session, action: PROCEDURE_AUTHOR_ACTION, correlationId: input.correlationId });
        if (!allowed.allowed) throw new Error('Authoring permission changed');
        await onProgress(progress);
      } : undefined);
      complete = { ...complete, usage: { inputTokens: tokenUsage(response.usage?.inputTokens), outputTokens: tokenUsage(response.usage?.outputTokens) } };
      if (!isAuthoringProposal(response.proposal, input.section.kind === 'objective' ? CONTEXT_TEXT_LIMIT : AUTHORING_LIMITS.outputText)
        || response.proposal.clarifications.length > 1 || hasCredentialMaterial(response.proposal, prepared.credentialReferences)) throw new Error('Invalid authoring response');
      complete = { ...complete, ...response.proposal, state: 'ready' };
    } catch { complete = { ...complete, state: 'failed', message: 'Writing assistance could not produce a confirmed draft. Your procedure is unchanged. Try again or keep writing manually.' }; }
    const suggestion = await deps.unitOfWork.execute(async tx => {
      const row = await ownedDraft(tx, input), store = tx.authoringRequests!;
      const record = ownedRequest(await store.find(input.requestId), input);
      // Rejection while generation is pending wins. A late response cannot revive it.
      if (record.state !== 'pending') {
        if (record.state === 'rejected' && complete.usage !== null) {
          // Keep known provider usage without retaining the rejected response text or
          // changing the human's decision. There is no procedure write in this path.
          const accounted = { ...record, usage: complete.usage };
          await store.update(accounted); await audit(tx, input, accounted, 'responded-after-rejection');
          return view(accounted, row, deps.clock.now());
        }
        return view(record, row, deps.clock.now());
      }
      await store.update(complete); await audit(tx, input, complete, 'responded');
      return view(complete, row, deps.clock.now());
    });
    const finalAuth = await authorizeCommand(deps, { session: input.session, action: PROCEDURE_AUTHOR_ACTION, correlationId: input.correlationId });
    return finalAuth.allowed ? { ok: true, suggestion } : { ok: false, reason: finalAuth.reason };
  } catch (error) { if (error instanceof Refused) return { ok: false, reason: error.message }; throw error; }
}

export async function acceptAuthoringSuggestion(deps: AuthoringDependencies, input: AcceptAuthoringFields & Actor): Promise<ProcedureOutcome<{ rowVersion: string; alreadyApplied: boolean }>> {
  const auth = await authorizeCommand(deps, { session: input.session, action: PROCEDURE_AUTHOR_ACTION, correlationId: input.correlationId });
  if (!auth.allowed) return { ok: false, reason: auth.reason };
  const { session: _session, correlationId: _correlation, ...fields } = input;
  if (!isAcceptAuthoringFields(fields)) return { ok: false, reason: 'Choose a valid replacement within the section limit.' };
  try {
    return await deps.unitOfWork.execute(async tx => {
      const row = await ownedDraft(tx, input), store = tx.authoringRequests;
      if (row.state !== 'DRAFT') throw new Refused(PROCEDURE_REFUSALS.NOT_A_DRAFT);
      if (!row.authorship || !store) throw new Refused('The authorship of this draft could not be verified.');
      const record = ownedRequest(await store.find(input.requestId), input);
      if (input.replacement.length > (record.section.kind === 'objective' ? CONTEXT_TEXT_LIMIT : AUTHORING_LIMITS.outputText)) throw new Refused('Choose a valid replacement within the section limit.');
      if (record.state === 'accepted') {
        if (record.acceptedDigest !== digest(input.replacement)) throw new Refused('This suggestion was already accepted with different wording. Edit the saved section to make another change.');
        return { ok: true, rowVersion: procedureVersionRowVersion(row), alreadyApplied: true };
      }
      if (record.state !== 'ready' || record.proposedText === null || record.clarifications.length) throw new Refused('This suggestion has no confirmed replacement to accept.');
      if (!sameDraft(record, row, deps.clock.now())) throw new Refused('This suggestion is stale. Review the current saved section and request a new draft to reconcile the changes.');
      if (procedureVersionRowVersion(row) !== input.expectedRowVersion) throw new Refused(PROCEDURE_REFUSALS.STALE_ROW);
      // Reuse the authorised draft commands INSIDE this transaction. No second writer,
      // no second plan, and no platform-author exception for model-assisted prose.
      const within = { ...deps, roles: tx.authorizationRoles, unitOfWork: { execute: async <T,>(work: (context: ProceduresUnitOfWorkContext) => Promise<T>) => work(tx) } };
      const common = { session: input.session, correlationId: input.correlationId, procedureId: row.procedureId, versionId: row.versionId, expectedRowVersion: input.expectedRowVersion };
      const selectedSection = record.section;
      const instructionId = selectedSection.kind === 'instructions' ? selectedSection.registrationId : '';
      const instructions = row.instructions.some(i => i.registrationId === instructionId) ? row.instructions.map(i => i.registrationId === instructionId ? { ...i, text: input.replacement } : i) : [...row.instructions, { registrationId: instructionId, text: input.replacement }];
      const outcome = record.section.kind === 'objective' ? await updateContextDraft(within, { ...common, edit: { ...draftContext(row.sections), objective: input.replacement } })
        : record.section.kind === 'scope' ? await updatePopulationDraft(within, { ...common, edit: { section: 'scope-note', scope: input.replacement } })
        : await updateTargetDraft(within, { ...common, edit: { section: 'audit-instructions', instructions } });
      if (!outcome.ok) return outcome;
      // Accepting the same wording is still a human authoring decision. Existing
      // draft commands deliberately treat an unchanged save as a no-op, so record
      // this author without needlessly invalidating the unchanged executable plan.
      let rowVersion = outcome.rowVersion;
      if (!outcome.changed && !row.authorship.humanAuthorIds.includes(input.session.userId)) {
        const attributed = { ...row, authorship: { ...row.authorship, humanAuthorIds: [...row.authorship.humanAuthorIds, input.session.userId] } };
        await tx.procedures.updateVersion(attributed);
        rowVersion = procedureVersionRowVersion(attributed);
      }
      const accepted: AuthoringRequestRecord = { ...record, state: 'accepted', acceptedDigest: digest(input.replacement) };
      await store.update(accepted); await audit(tx, input, accepted, 'accepted');
      return { ok: true, rowVersion, alreadyApplied: false };
    });
  } catch (error) { if (error instanceof Refused) return { ok: false, reason: error.message }; throw error; }
}

export async function rejectAuthoringSuggestion(deps: AuthoringDependencies, input: RejectAuthoringFields & Actor): Promise<ProcedureOutcome<Record<never, never>>> {
  const auth = await authorizeCommand(deps, { session: input.session, action: PROCEDURE_AUTHOR_ACTION, correlationId: input.correlationId });
  if (!auth.allowed) return { ok: false, reason: auth.reason };
  const { session: _session, correlationId: _correlation, ...fields } = input;
  if (!isRejectAuthoringFields(fields)) return { ok: false, reason: 'Choose a valid writing suggestion.' };
  try {
    return await deps.unitOfWork.execute(async tx => {
      await ownedDraft(tx, input);
      if (!tx.authoringRequests) throw new Refused('Writing assistance is unavailable.');
      const record = ownedRequest(await tx.authoringRequests.find(input.requestId), input);
      if (record.state === 'accepted') throw new Refused('This suggestion was already accepted. Edit the saved section to change it.');
      if (record.state !== 'rejected') { const rejected = { ...record, state: 'rejected' as const }; await tx.authoringRequests.update(rejected); await audit(tx, input, rejected, 'rejected'); }
      return { ok: true };
    });
  } catch (error) { if (error instanceof Refused) return { ok: false, reason: error.message }; throw error; }
}
