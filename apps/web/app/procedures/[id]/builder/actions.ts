'use server';

import { revalidatePath } from 'next/cache';

import {
  PROCEDURE_AUTHOR_ACTION,
  PROCEDURE_LIMITS,
  renameProcedureDraft,
  retryPlanDerivation,
  updatePopulationDraft,
  updateTargetDraft,
  updateComplianceDraft,
  updateEvidenceDraft,
  type DraftPopulationEdit,
  type DraftTargetEdit,
  type UpdatePopulationDraftResult,
  type UpdateTargetDraftResult,
  type UpdateComplianceDraftResult,
  type UpdateEvidenceDraftResult,
  type ProcedureDependencies,
} from '@intellifin/application';
import { COMPLIANCE_LIMITS, TARGET_DRAFT_LIMITS, EVIDENCE_DRAFT_LIMITS, FREQUENCIES, GROUNDING_EVIDENCE_TYPES, type ComplianceDraftInput, type DraftEvidenceEdit } from '@intellifin/domain';
import {
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresProceduresUnitOfWork,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { currentCorrelationId, requireServerAction } from '../../../../src/server-session';

/**
 * The Builder's Server Action (FR-7, scoped to this story: the Control name).
 *
 * **It authorizes first, before it reads its input** — same rule, same reason as the
 * New-procedure action beside this folder: a Server Action is its own POST endpoint,
 * and reaching the Builder page is not a precondition for invoking it.
 *
 * **The argument is untrusted.** The row version, the procedure id and the version id
 * are strings from a POST body until this file says otherwise, and each is checked for
 * shape before the command is reached.
 */

export type RenameActionResult =
  | {
      readonly ok: true;
      readonly controlName: string;
      readonly rowVersion: string;
      readonly changed: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/** Said when the command threw. It never names a driver, a table or a host. */
const UNAVAILABLE = 'The change could not be saved. Nothing was changed.';

/** Said when the request was not the shape this action accepts. One sentence for all. */
const MALFORMED = 'That request was not valid. Nothing was changed.';

/** The id shape this application mints: a UUID v7 from `CryptoUuidV7Generator`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** What the Builder's one editable field posts. */
export interface RenameDraftFields {
  readonly procedureId: string;
  readonly versionId: string;
  readonly controlName: string;
  /**
   * The version of the whole version row the surface rendered. Optimistic concurrency,
   * exactly as `expectedRowVersion` on the binding change.
   */
  readonly expectedRowVersion: string;
}

function isRenameDraftFields(input: unknown): input is RenameDraftFields {
  if (typeof input !== 'object' || input === null) return false;
  const fields = input as Record<string, unknown>;
  return (
    isUuid(fields['procedureId']) &&
    isUuid(fields['versionId']) &&
    typeof fields['controlName'] === 'string' &&
    fields['controlName'].length <= PROCEDURE_LIMITS.controlName &&
    typeof fields['expectedRowVersion'] === 'string' &&
    fields['expectedRowVersion'].length <= 64
  );
}

async function dependencies(): Promise<ProcedureDependencies> {
  const runtime = await getRuntime();
  return {
    roles: new DrizzleRoleRepository(runtime.db),
    unitOfWork: new PostgresProceduresUnitOfWork(runtime.db),
    ids: new CryptoUuidV7Generator(),
  };
}

/** Report a failure and refuse. The person gets one sentence; the operator gets the error. */
async function unavailable(error: unknown, correlationId: string): Promise<RenameActionResult> {
  try {
    const runtime = await getRuntime();
    runtime.telemetry.captureError('Rename Procedure Draft failed', error, {
      outcome: 'failure',
      correlationId,
    });
  } catch {
    // The runtime is what failed. `instrumentation.ts` reported that at boot.
  }
  return { ok: false, reason: UNAVAILABLE };
}

/** Rename a Draft's Control name. One `lifecycle.procedure-draft-changed` event when it moves. */
export async function renameProcedureDraftAction(
  fields: RenameDraftFields,
): Promise<RenameActionResult> {
  // FIRST, before the input is read at all.
  const decision = await requireServerAction(PROCEDURE_AUTHOR_ACTION);
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  if (!isRenameDraftFields(fields)) return { ok: false, reason: MALFORMED };

  const correlationId = await currentCorrelationId();

  try {
    const outcome = await renameProcedureDraft(await dependencies(), {
      procedureId: fields.procedureId,
      versionId: fields.versionId,
      controlName: fields.controlName,
      expectedRowVersion: fields.expectedRowVersion,
      session: decision.session,
      correlationId,
    });
    if (!outcome.ok) return { ok: false, reason: outcome.reason };

    // The row changed, so the token the open tab holds is stale the moment this
    // commits. The command returns the token over the row as it left it, and the form
    // adopts it — this file recomputes nothing.
    revalidatePath(`/procedures/${fields.procedureId}`);
    revalidatePath(`/procedures/${fields.procedureId}/builder`);
    revalidatePath('/procedures');
    return {
      ok: true,
      controlName: outcome.controlName,
      rowVersion: outcome.rowVersion,
      changed: outcome.changed,
    };
  } catch (error) {
    return unavailable(error, correlationId);
  }
}

export interface PopulationDraftFields {
  readonly procedureId: string;
  readonly versionId: string;
  readonly expectedRowVersion: string;
  readonly edit: DraftPopulationEdit;
}

function isPopulationDraftFields(input: unknown): input is PopulationDraftFields {
  if (typeof input !== 'object' || input === null) return false;
  const f = input as Record<string, unknown>;
  if (!isUuid(f['procedureId']) || !isUuid(f['versionId']) || typeof f['expectedRowVersion'] !== 'string' || !/^[0-9a-f]{64}$/.test(f['expectedRowVersion']) || typeof f['edit'] !== 'object' || f['edit'] === null) return false;
  const edit = f['edit'] as Record<string, unknown>;
  if (edit['section'] === 'period-scope') return true; // The domain validates the values.
  if (edit['section'] !== 'population-source' || typeof edit['source'] !== 'object' || edit['source'] === null) return false;
  const source = edit['source'] as Record<string, unknown>;
  return source['mode'] === 'retain' || (source['mode'] === 'bind' && isUuid(source['bindingId']) && typeof source['expectedDigest'] === 'string' && /^[0-9a-f]{64}$/.test(source['expectedDigest']));
}

export async function updatePopulationDraftAction(fields: PopulationDraftFields): Promise<UpdatePopulationDraftResult> {
  const decision = await requireServerAction(PROCEDURE_AUTHOR_ACTION);
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  if (!isPopulationDraftFields(fields)) return { ok: false, reason: MALFORMED };
  const correlationId = await currentCorrelationId();
  try {
    const outcome = await updatePopulationDraft(await dependencies(), { ...fields, session: decision.session, correlationId });
    if (outcome.ok) {
      revalidatePath(`/procedures/${fields.procedureId}/builder`);
      revalidatePath(`/procedures/${fields.procedureId}`);
    }
    return outcome;
  } catch (error) {
    try {
      (await getRuntime()).telemetry.captureError('Update Population Draft failed', error, { outcome: 'failure', correlationId });
    } catch { /* Boot failures are already reported. */ }
    return { ok: false, reason: UNAVAILABLE };
  }
}

/** What the Builder's Target System and Audit Instruction editors post. */
export interface TargetDraftFields {
  readonly procedureId: string;
  readonly versionId: string;
  readonly expectedRowVersion: string;
  readonly edit: DraftTargetEdit;
}

/** The argument is untrusted whatever its type says; the shape is checked before the command. */
function isTargetDraftFields(input: unknown): input is TargetDraftFields {
  if (typeof input !== 'object' || input === null) return false;
  const f = input as Record<string, unknown>;
  if (!isUuid(f['procedureId']) || !isUuid(f['versionId']) || typeof f['expectedRowVersion'] !== 'string' || !/^[0-9a-f]{64}$/.test(f['expectedRowVersion'])) return false;
  if (typeof f['edit'] !== 'object' || f['edit'] === null) return false;
  const edit = f['edit'] as Record<string, unknown>;
  if (edit['section'] === 'target-systems') {
    if (!Array.isArray(edit['selections']) || edit['selections'].length > TARGET_DRAFT_LIMITS.targets) return false;
    return edit['selections'].every((selection: unknown) => {
      if (typeof selection !== 'object' || selection === null) return false;
      const entry = selection as Record<string, unknown>;
      if (!isUuid(entry['registrationId'])) return false;
      if (entry['mode'] === 'retain') return true;
      return entry['mode'] === 'bind' && typeof entry['expectedDigest'] === 'string' && /^[0-9a-f]{64}$/.test(entry['expectedDigest']);
    });
  }
  if (edit['section'] === 'audit-instructions') {
    if (!Array.isArray(edit['instructions']) || edit['instructions'].length > TARGET_DRAFT_LIMITS.targets) return false;
    return edit['instructions'].every((instruction: unknown) => {
      if (typeof instruction !== 'object' || instruction === null) return false;
      const entry = instruction as Record<string, unknown>;
      return isUuid(entry['registrationId']) && typeof entry['text'] === 'string' && entry['text'].length <= TARGET_DRAFT_LIMITS.instruction;
    });
  }
  return false;
}

export async function updateTargetDraftAction(fields: TargetDraftFields): Promise<UpdateTargetDraftResult> {
  const decision = await requireServerAction(PROCEDURE_AUTHOR_ACTION);
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  if (!isTargetDraftFields(fields)) return { ok: false, reason: MALFORMED };
  const correlationId = await currentCorrelationId();
  try {
    const outcome = await updateTargetDraft(await dependencies(), { ...fields, session: decision.session, correlationId });
    if (outcome.ok) {
      revalidatePath(`/procedures/${fields.procedureId}/builder`);
      revalidatePath(`/procedures/${fields.procedureId}`);
    }
    return outcome;
  } catch (error) {
    try {
      (await getRuntime()).telemetry.captureError('Update Target Draft failed', error, { outcome: 'failure', correlationId });
    } catch { /* Boot failures are already reported. */ }
    return { ok: false, reason: UNAVAILABLE };
  }
}

/** Only authored inputs cross the action boundary; the command derives all compilation. */
export interface ComplianceDraftFields {
  readonly procedureId: string;
  readonly versionId: string;
  readonly expectedRowVersion: string;
  readonly edit: ComplianceDraftInput;
}

function isComplianceDraftFields(input: unknown): input is ComplianceDraftFields {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const fields = input as Record<string, unknown>;
  if (Object.keys(fields).length !== 4 || !Object.hasOwn(fields, 'procedureId') || !Object.hasOwn(fields, 'versionId') ||
    !Object.hasOwn(fields, 'expectedRowVersion') || !Object.hasOwn(fields, 'edit') ||
    !isUuid(fields['procedureId']) || !isUuid(fields['versionId']) ||
    typeof fields['expectedRowVersion'] !== 'string' || !/^[0-9a-f]{64}$/.test(fields['expectedRowVersion']) ||
    typeof fields['edit'] !== 'object' || fields['edit'] === null || Array.isArray(fields['edit'])) return false;
  const edit = fields['edit'] as Record<string, unknown>;
  if (Object.keys(edit).length !== 2 || !Object.hasOwn(edit, 'conditions') || !Object.hasOwn(edit, 'confidenceThreshold') ||
    !Array.isArray(edit['conditions']) || edit['conditions'].length > COMPLIANCE_LIMITS.conditions || typeof edit['confidenceThreshold'] !== 'string') return false;
  return edit['conditions'].every((candidate: unknown) => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return false;
    const condition = candidate as Record<string, unknown>;
    if (Object.keys(condition).length !== 4 || !Object.hasOwn(condition, 'conditionId') || !Object.hasOwn(condition, 'text') ||
      !Object.hasOwn(condition, 'applicability') || !Object.hasOwn(condition, 'comparison') || typeof condition['conditionId'] !== 'string' ||
      typeof condition['text'] !== 'string' || typeof condition['applicability'] !== 'string') return false;
    if (condition['comparison'] === null) return true;
    if (typeof condition['comparison'] !== 'object' || Array.isArray(condition['comparison'])) return false;
    const comparison = condition['comparison'] as Record<string, unknown>;
    return Object.keys(comparison).length === 3 && Object.hasOwn(comparison, 'boundary') && Object.hasOwn(comparison, 'threshold') &&
      Object.hasOwn(comparison, 'tolerance') && (comparison['boundary'] === 'inclusive' || comparison['boundary'] === 'exclusive') &&
      typeof comparison['threshold'] === 'string' && typeof comparison['tolerance'] === 'string';
  });
}

/** Only authored inputs cross the action boundary; the command derives `platformCaptured`. */
export interface EvidenceDraftFields {
  readonly procedureId: string;
  readonly versionId: string;
  readonly expectedRowVersion: string;
  readonly edit: DraftEvidenceEdit;
}

function isEvidenceDraftFields(input: unknown): input is EvidenceDraftFields {
  if (typeof input !== 'object' || input === null) return false;
  const f = input as Record<string, unknown>;
  if (!isUuid(f['procedureId']) || !isUuid(f['versionId']) || typeof f['expectedRowVersion'] !== 'string' || !/^[0-9a-f]{64}$/.test(f['expectedRowVersion'])) {
    return false;
  }
  if (typeof f['edit'] !== 'object' || f['edit'] === null) return false;
  const edit = f['edit'] as Record<string, unknown>;
  if (edit['section'] === 'evidence-requirements') {
    if (!Array.isArray(edit['requirements']) || edit['requirements'].length > EVIDENCE_DRAFT_LIMITS.requirements) return false;
    return edit['requirements'].every((candidate: unknown) => {
      if (typeof candidate !== 'object' || candidate === null) return false;
      const requirement = candidate as Record<string, unknown>;
      if (
        typeof requirement['attributeName'] !== 'string' ||
        requirement['attributeName'].length > EVIDENCE_DRAFT_LIMITS.attributeName ||
        typeof requirement['modelRead'] !== 'boolean' ||
        typeof requirement['screenshot'] !== 'boolean' ||
        typeof requirement['recordingSegment'] !== 'boolean' ||
        !Array.isArray(requirement['groundedBy'])
      ) {
        return false;
      }
      return requirement['groundedBy'].every(
        (kind: unknown) => typeof kind === 'string' && (GROUNDING_EVIDENCE_TYPES as readonly string[]).includes(kind),
      );
    });
  }
  if (edit['section'] === 'schedule') {
    return (
      typeof edit['frequency'] === 'string' &&
      (FREQUENCIES as readonly string[]).includes(edit['frequency']) &&
      typeof edit['startTime'] === 'string' &&
      edit['startTime'].length <= 5
    );
  }
  return false;
}

export async function updateEvidenceDraftAction(fields: EvidenceDraftFields): Promise<UpdateEvidenceDraftResult> {
  const decision = await requireServerAction(PROCEDURE_AUTHOR_ACTION);
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  if (!isEvidenceDraftFields(fields)) return { ok: false, reason: MALFORMED };
  const correlationId = await currentCorrelationId();
  try {
    const outcome = await updateEvidenceDraft(await dependencies(), { ...fields, session: decision.session, correlationId });
    if (outcome.ok) {
      revalidatePath(`/procedures/${fields.procedureId}/builder`);
      revalidatePath(`/procedures/${fields.procedureId}`);
    }
    return outcome;
  } catch (error) {
    try {
      (await getRuntime()).telemetry.captureError('Update Evidence Draft failed', error, { outcome: 'failure', correlationId });
    } catch { /* Boot failures are already reported. */ }
    return { ok: false, reason: UNAVAILABLE };
  }
}

export async function updateComplianceDraftAction(fields: ComplianceDraftFields): Promise<UpdateComplianceDraftResult> {
  const decision = await requireServerAction(PROCEDURE_AUTHOR_ACTION);
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  if (!isComplianceDraftFields(fields)) return { ok: false, reason: MALFORMED };
  const correlationId = await currentCorrelationId();
  try {
    const outcome = await updateComplianceDraft(await dependencies(), {
      procedureId: fields.procedureId,
      versionId: fields.versionId,
      expectedRowVersion: fields.expectedRowVersion,
      edit: fields.edit,
      session: decision.session,
      correlationId,
    });
    if (outcome.ok) {
      revalidatePath(`/procedures/${fields.procedureId}/builder`);
      revalidatePath(`/procedures/${fields.procedureId}`);
    }
    return outcome;
  } catch (error) {
    try {
      (await getRuntime()).telemetry.captureError('Update Compliance Draft failed', error, { outcome: 'failure', correlationId });
    } catch { /* Boot failures are already reported. */ }
    return { ok: false, reason: UNAVAILABLE };
  }
}

/** Explicit retry preserves all frozen authoring/compiler/model fields. */
export async function retryPlanDerivationAction(fields: { readonly procedureId: string; readonly versionId: string; readonly expectedRowVersion: string }): Promise<{ readonly ok: true; readonly rowVersion: string } | { readonly ok: false; readonly reason: string }> {
  const decision = await requireServerAction(PROCEDURE_AUTHOR_ACTION);
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  if (typeof fields !== 'object' || fields === null || Object.keys(fields).length !== 3 || !isUuid(fields.procedureId) || !isUuid(fields.versionId) || typeof fields.expectedRowVersion !== 'string' || !/^[0-9a-f]{64}$/.test(fields.expectedRowVersion)) return { ok: false, reason: MALFORMED };
  const correlationId = await currentCorrelationId();
  // Inside the action's own try, like every sibling: an infrastructure fault must
  // answer the stated sentence, not a framework 500 (security review on #21).
  try {
    const outcome = await retryPlanDerivation(await dependencies(), { ...fields, session: decision.session, correlationId });
    if (outcome.ok) {
      revalidatePath(`/procedures/${fields.procedureId}/builder`);
      revalidatePath(`/procedures/${fields.procedureId}`);
    }
    return outcome;
  } catch (error) {
    try {
      (await getRuntime()).telemetry.captureError('Retry Plan Derivation failed', error, { outcome: 'failure', correlationId });
    } catch { /* Boot failures are already reported. */ }
    return { ok: false, reason: UNAVAILABLE };
  }
}
