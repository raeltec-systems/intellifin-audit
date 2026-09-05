import { initialPlanDerivation, queuePlanDerivation } from './plan-state.js';
import type { ModelIdentity } from './plan-ports.js';
import {
  CONTROL_NAME_LIMIT,
  canonicalJson,
  initialDraftSections,
  initialDraftPopulation,
  initialDraftTargets,
  initialDraftCompliance,
  initialDraftEvidence,
  isTemplateId,
  sha256Hex,
  type DraftSection,
  type JsonValue,
  type TemplateId,
} from '@intellifin/domain';

import type { UuidV7Generator } from '../audit/clock.js';
import type { AuditUnitOfWork } from '../audit/ports.js';
import { authorizeCommand } from '../identity/authorize.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import type {
  ProcedureRecord,
  ProcedureVersionRecord,
  ProceduresUnitOfWorkContext,
} from './ports.js';

/**
 * Creating a Procedure from a Template and renaming its Draft (Story 2.1).
 *
 * The order is Story 1.6's and 1.7's, because it is the design:
 *
 *   1. authorize through {@link authorizeCommand}, which resolves the role afresh and
 *      audits the refusal itself, BEFORE any input is read;
 *   2. validate the input's shape;
 *   3. write the Procedure row, the DRAFT version row and the audit event inside ONE
 *      transaction, or none of the three.
 *
 * `CommandRefused` is thrown from inside the unit of work, never returned from it: a
 * returned refusal commits whatever the statements before it had already written.
 * Story 1.5 paid for that lesson and every command since has repeated it deliberately.
 */

/** The gated action, already in the EXPERIENCE.md gating table (24 entries, closed). */
export const PROCEDURE_AUTHOR_ACTION = 'procedure.author' as const;

/** Appended when a Procedure and its first DRAFT version are created. */
export const PROCEDURE_CREATED_EVENT = 'lifecycle.procedure-created' as const;

/** Appended when the Draft's Control name moves. Sections change in stories 2.2-2.5. */
export const PROCEDURE_DRAFT_CHANGED_EVENT = 'lifecycle.procedure-draft-changed' as const;

/** Bounds applied before anything else looks at a value. */
export const PROCEDURE_LIMITS = {
  controlName: CONTROL_NAME_LIMIT,
} as const;

/** What an author is told. One sentence each, naming the thing it protects. */
export const PROCEDURE_REFUSALS = {
  TEMPLATE_REQUIRED: 'Choose a Template.',
  NAME_REQUIRED: 'Enter a Control name.',
  TOO_LONG: 'That value is longer than this field allows.',
  UNKNOWN_PROCEDURE: 'That procedure no longer exists.',
  UNKNOWN_VERSION: 'That version no longer exists.',
  /**
   * The one editable field is the Control name, on a DRAFT. This story renders every
   * other section read-only, so a save that tried to change one is refused rather than
   * silently ignored — a write that does not happen must not read as if it did.
   */
  NOT_A_DRAFT: 'Only a Draft can be edited.',
  /**
   * Story 1.6's stale-row sentence, with the noun changed. UX-DR38 requires every guard
   * sentence to name the object it protects.
   */
  STALE_ROW: 'That procedure changed since this page was loaded. Reload the page and try again.',
  /**
   * A value with no canonical form — a lone surrogate or a NUL. It cannot be stored: the
   * driver would substitute U+FFFD or raise 22021, so the row would permanently disagree
   * with itself. A refusal, not a 500: it arrives through a Server Action, which any
   * signed-in person can post to by hand.
   */
  NOT_STORABLE: 'That value contains a character this system cannot store.',
} as const;

export type ProcedureOutcome<TDetail> =
  | ({ readonly ok: true } & TDetail)
  | { readonly ok: false; readonly reason: string };

export interface ProcedureDependencies {
  /** Resolves the ACTOR's role for the authorization check. Read on every call (AD-7). */
  readonly roles: RoleRepository;
  readonly unitOfWork: AuditUnitOfWork<ProceduresUnitOfWorkContext>;
  readonly ids: UuidV7Generator;
  readonly derivationModel?: ModelIdentity | null;
}

export interface CreateProcedureInput {
  readonly session: SessionSnapshot;
  /** Which Template to pre-fill from. There is no default: the person chooses. */
  readonly templateId: unknown;
  readonly controlName: string;
  /** Where the command was invoked from, for the audit envelope. Defaults to `web`. */
  readonly source?: 'web' | 'platform';
  readonly correlationId: string;
}

export interface RenameProcedureDraftInput {
  readonly session: SessionSnapshot;
  readonly procedureId: string;
  readonly versionId: string;
  readonly controlName: string;
  /**
   * The version of the WHOLE version row the surface rendered. Optimistic concurrency,
   * exactly as `bindingRowVersion` — it covers every field a save would replace.
   */
  readonly expectedRowVersion: string;
  readonly correlationId: string;
}

export type CreateProcedureResult = ProcedureOutcome<{
  readonly procedureId: string;
  readonly versionId: string;
  readonly versionNumber: 1;
  readonly sections: readonly DraftSection[];
}>;

export type RenameProcedureDraftResult = ProcedureOutcome<{
  readonly versionId: string;
  readonly controlName: string;
  /** `false` when the save changed nothing, wrote nothing and appended nothing. */
  readonly changed: boolean;
  /**
   * The row-version token over the row AS THIS COMMAND LEFT IT. The surface adopts it
   * so its next save guards against the row as it now is, not as the page found it —
   * recomputing it anywhere else would be a second implementation of the token.
   */
  readonly rowVersion: string;
}>;;

/**
 * A refusal raised from INSIDE the transaction, so the transaction rolls back.
 *
 * Returning it from the callback would COMMIT whatever had already been written.
 */
class CommandRefused extends Error {
  override readonly name = 'CommandRefused';
  readonly refusal: string;

  constructor(refusal: string) {
    super(refusal);
    this.refusal = refusal;
  }
}

function refuse(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

/**
 * Trim, bound and prove storable, or say which rule the Control name broke.
 *
 * The storability check lives HERE and not at one call site. It was in the create path
 * only, so a rename carrying a NUL or a lone surrogate walked past it and threw a raw
 * `NotCanonicalizableError` from inside the transaction — a framework 500 where the
 * spec requires a sentence. Every path that stores a Control name goes through this
 * function, so this is the one place the check cannot be forgotten by the next caller.
 */
function validatedControlName(
  controlName: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly refusal: string } {
  const trimmed = controlName.trim();
  if (trimmed === '') return { ok: false, refusal: PROCEDURE_REFUSALS.NAME_REQUIRED };
  if (trimmed.length > PROCEDURE_LIMITS.controlName) {
    return { ok: false, refusal: PROCEDURE_REFUSALS.TOO_LONG };
  }
  try {
    canonicalJson(trimmed);
  } catch {
    return { ok: false, refusal: PROCEDURE_REFUSALS.NOT_STORABLE };
  }
  return { ok: true, value: trimmed };
}

/**
 * Everything a create can decide without touching a database.
 *
 * The Template id is validated FIRST — the form does not default it, so its absence is
 * the one refusal a person who submits without choosing must see. The Control name is
 * checked against the canonicalizer inside `validatedControlName`, so a lone surrogate
 * or a NUL is refused with a sentence instead of surfacing as a driver error — on the
 * rename path too, which is where that check used to be missing.
 */
export function validateCreateProcedureInput(
  input: Pick<CreateProcedureInput, 'templateId' | 'controlName'>,
): { readonly templateId: TemplateId; readonly controlName: string } | { readonly refusal: string } {
  if (!isTemplateId(input.templateId)) return { refusal: PROCEDURE_REFUSALS.TEMPLATE_REQUIRED };
  const name = validatedControlName(input.controlName);
  if (!name.ok) return { refusal: name.refusal };
  // `validatedControlName` has already proved the name storable.
  return { templateId: input.templateId, controlName: name.value };
}

/**
 * A version token over the WHOLE version row: every field a save would replace.
 *
 * The same design as `bindingRowVersion`: a hash of the values themselves, over the
 * shared canonicalizer, so it moves when — and only when — something a save would
 * replace has moved. It is not a security boundary; it is the same class of value as an
 * ETag.
 */
export function procedureVersionRowVersion(record: ProcedureVersionRecord): string {
  return sha256Hex(
    canonicalJson({
      lifecycle: record.lifecycle ?? null, platformOrigin: record.platformOrigin ?? null, configurationRevision: record.configurationRevision ?? null,
      controlName: record.controlName,
      procedureId: record.procedureId,
      sections: record.sections,
      state: record.state,
      templateId: record.templateId,
      versionId: record.versionId,
      versionNumber: record.versionNumber,
      authorship: record.authorship ?? null, decisions: record.decisions ?? [], frozenReview: record.frozenReview ?? null, submittedReview: record.submittedReview ?? null,
      period: record.period,
      scope: record.scope,
      sourceSnapshot: record.sourceSnapshot,
      inclusionRule: record.inclusionRule,
      zeroRecordPass: record.zeroRecordPass,
      allowVersionedDuplicates: record.allowVersionedDuplicates,
      populationBlockers: record.populationBlockers,
      // Target System selection and per-system Audit Instructions are saved fields, so a
      // stale tab that edited them must lose to a concurrent save exactly as one that
      // edited the population fields does.
      targets: record.targets,
      instructions: record.instructions,
      complianceSchemaVersion: record.complianceSchemaVersion,
      complianceCompilerVersion: record.complianceCompilerVersion,
      complianceConditions: record.complianceConditions,
      agentJudgedThreshold: record.agentJudgedThreshold,
      // Evidence Requirements and the Schedule are saved fields too (Story 2.5); a stale
      // tab that edited either must lose to a concurrent save exactly as every other
      // saved field does.
      evidenceSchemaVersion: record.evidenceSchemaVersion,
      evidenceRequirements: record.evidenceRequirements,
      schedule: record.schedule,
      planCompilerVersion: record.planCompilerVersion, derivationModel: record.derivationModel,
      compiledPlan: record.compiledPlan, planInputDigest: record.planInputDigest, planStatus: record.planStatus,
      planFailureReason: record.planFailureReason, planDerivable: record.planDerivable, planAttempts: record.planAttempts,
    } as unknown as JsonValue),
  );
}

/** The DRAFT sections creation writes: the Template pre-fill, compiled nowhere. */
function draftSectionsFor(templateId: TemplateId): readonly DraftSection[] {
  return initialDraftSections(templateId);
}

/** Create a Procedure and its first DRAFT version, with one `procedure-created` event. */
export async function createProcedure(
  dependencies: ProcedureDependencies,
  input: CreateProcedureInput,
): Promise<CreateProcedureResult> {
  const { session, correlationId } = input;

  const decision = await authorizeCommand(
    { roles: dependencies.roles, unitOfWork: dependencies.unitOfWork },
    { session, action: PROCEDURE_AUTHOR_ACTION, correlationId },
  );
  if (!decision.allowed) return refuse(decision.reason);

  const validated = validateCreateProcedureInput(input);
  if ('refusal' in validated) return refuse(validated.refusal);

  const procedureId = dependencies.ids.next();
  const versionId = dependencies.ids.next();
  const sections = draftSectionsFor(validated.templateId);

  const procedure: ProcedureRecord = {
    procedureId,
    controlName: validated.controlName,
    templateId: validated.templateId,
  };
  const version: ProcedureVersionRecord = {
    ...initialDraftPopulation(validated.templateId),
    ...initialDraftTargets(),
    ...initialDraftCompliance(validated.templateId),
    ...initialDraftEvidence(validated.templateId),
    ...initialPlanDerivation(dependencies.derivationModel ?? null),
    versionId,
    procedureId,
    versionNumber: 1,
    state: 'DRAFT',
    authorship: { createdBy: { type: 'human', id: session.userId }, responsibleAuthorId: session.userId, humanAuthorIds: [session.userId] },
    controlName: validated.controlName,
    templateId: validated.templateId,
    sections,
  };

  return dependencies.unitOfWork.execute(
    async ({ auditEvents, procedures, derivationJobs }): Promise<CreateProcedureResult> => {
      const published = await procedures.currentConfiguration?.();
      const configuredVersion = published ? { ...version, ...initialPlanDerivation(published.model), configurationRevision: published.revision } : version;
      await procedures.insertProcedure(procedure);
      await procedures.insertVersion(await queuePlanDerivation(configuredVersion, derivationJobs));
      await auditEvents.append({
        actor: { type: 'human', id: session.userId },
        eventType: PROCEDURE_CREATED_EVENT,
        source: input.source ?? 'web',
        outcome: 'success',
        sessionId: session.sessionId,
        correlationId,
        // The Procedure id, so the whole history of one Procedure is one chain.
        aggregateId: procedureId,
        payload: {
          controlName: validated.controlName,
          procedureId,
          templateId: validated.templateId,
          versionId,
          versionNumber: 1,
        },
      });
      return { ok: true, procedureId, versionId, versionNumber: 1, sections };
    },
  );
}

/**
 * Rename a Draft. The only mutation this story makes to an existing version.
 *
 * A save that changes nothing writes nothing and appends nothing; a save from a stale
 * tab is refused with the Story 1.6 sentence and nothing is written; the event and the
 * row commit together or neither happens.
 */
export async function renameProcedureDraft(
  dependencies: ProcedureDependencies,
  input: RenameProcedureDraftInput,
): Promise<RenameProcedureDraftResult> {
  const { session, correlationId } = input;

  const decision = await authorizeCommand(
    { roles: dependencies.roles, unitOfWork: dependencies.unitOfWork },
    { session, action: PROCEDURE_AUTHOR_ACTION, correlationId },
  );
  if (!decision.allowed) return refuse(decision.reason);

  const name = validatedControlName(input.controlName);
  if (!name.ok) return refuse(name.refusal);
  const controlName = name.value;

  try {
    return await dependencies.unitOfWork.execute(
      async ({ auditEvents, procedures, derivationJobs }): Promise<RenameProcedureDraftResult> => {
        // Read inside the transaction, under a row lock, so the token the guard checks
        // is the one the write actually replaces.
        const before = await procedures.findVersionForUpdate(input.versionId);
        if (before === null) throw new CommandRefused(PROCEDURE_REFUSALS.UNKNOWN_VERSION);
        if (before.procedureId !== input.procedureId) {
          throw new CommandRefused(PROCEDURE_REFUSALS.UNKNOWN_VERSION);
        }
        if (before.state !== 'DRAFT') throw new CommandRefused(PROCEDURE_REFUSALS.NOT_A_DRAFT);
        if (procedureVersionRowVersion(before) !== input.expectedRowVersion) {
          throw new CommandRefused(PROCEDURE_REFUSALS.STALE_ROW);
        }

        // The Control name is the one editable field; the sections and the state are
        // refused if a caller tried to change them, rather than silently dropped.
        let after: ProcedureVersionRecord = { ...before, controlName };
        if (procedureVersionRowVersion(after) === input.expectedRowVersion) {
          // An idle save. The honest record of a change that did not happen is silence.
          return {
            ok: true,
            versionId: before.versionId,
            controlName: before.controlName,
            changed: false,
            rowVersion: input.expectedRowVersion,
          };
        }

        after = await queuePlanDerivation(after, derivationJobs, input.session.userId);
        await procedures.updateVersion(after);
        await auditEvents.append({
          actor: { type: 'human', id: session.userId },
          eventType: PROCEDURE_DRAFT_CHANGED_EVENT,
          source: 'web',
          outcome: 'success',
          sessionId: session.sessionId,
          correlationId,
          aggregateId: input.procedureId,
          payload: {
            priorControlName: before.controlName,
            controlName,
            procedureId: input.procedureId,
            versionId: before.versionId,
            versionNumber: before.versionNumber,
          },
        });
        return {
          ok: true,
          versionId: after.versionId,
          controlName,
          changed: true,
          rowVersion: procedureVersionRowVersion(after),
        };
      },
    );
  } catch (error) {
    if (error instanceof CommandRefused) return refuse(error.refusal);
    throw error;
  }
}
