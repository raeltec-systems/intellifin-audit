import {
  isAgentDrivenKind,
  isDraftTargetFields,
  isProcedureTargetSnapshot,
  snapshotFromRegistration,
  sha256Hex,
  TARGET_DRAFT_MESSAGES,
  validateDraftTargetEdit,
  validateInstructionSelection,
  type DraftTargetEdit,
  type TargetSelectionInput,
  type JsonValue,
  type ProcedureTargetSnapshot,
  type TargetInstruction,
} from '@intellifin/domain';

import { authorizeCommand } from '../identity/authorize.js';
import type { SessionSnapshot } from '../identity/ports.js';
import type { RegistrationRecord } from '../registrations/ports.js';
import {
  PROCEDURE_AUTHOR_ACTION,
  PROCEDURE_DRAFT_CHANGED_EVENT,
  PROCEDURE_REFUSALS,
  procedureVersionRowVersion,
  type ProcedureDependencies,
  type ProcedureOutcome,
} from './create-procedure.js';
import type { ProcedureVersionRecord } from './ports.js';

/**
 * Selecting Target Systems and writing per-system Audit Instructions on a Draft (FR-7,
 * FR-8, AD-2, AD-7, AD-8).
 *
 * Two edits, one command, the same shape `updatePopulationDraft` established:
 *
 *   - `target-systems` saves the ordered, unique selection. A `bind` selection is
 *     resolved through the registration-owned reader under a shared lock, requires an
 *     ACTIVE row, and requires the digest the surface rendered to still match — otherwise
 *     the Draft would freeze a contract nobody saw. A `retain` selection keeps the saved
 *     snapshot verbatim, which is how a Draft holds a system after its registration
 *     changed or retired without ever refreshing it implicitly. Instructions for a
 *     now-unselected system are pruned, because an instruction is only ever for a selected
 *     agent-driven system.
 *   - `audit-instructions` saves the verbatim instructions. Each names a SELECTED,
 *     agent-driven system; an instruction for an unselected or API/file system is an
 *     orphan and is refused.
 *
 * Both guard the whole Draft row, both refuse a non-DRAFT and a stale token, both commit
 * their change with one `lifecycle.procedure-draft-changed` event, and neither the frozen
 * contract's credential reference nor anything else credential-shaped ever enters the
 * audit payload. The scope-widening check is advisory and lives in the Builder; it is
 * never consulted here, because FR-8 makes it advisory and it must never refuse a save.
 */

export type { DraftTargetEdit, TargetSelectionInput } from '@intellifin/domain';

export interface UpdateTargetDraftInput {
  readonly session: SessionSnapshot;
  readonly correlationId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly expectedRowVersion: string;
  readonly edit: DraftTargetEdit;
}

export type UpdateTargetDraftResult = ProcedureOutcome<{
  readonly rowVersion: string;
  readonly changed: boolean;
}>;

/** A refusal thrown from inside the unit of work, so the transaction rolls back. */
class Refused extends Error {}

/** Resolve the ordered selection into snapshots, refusing an ineligible or unseen one. */
async function resolveSelection(
  before: ProcedureVersionRecord,
  selections: readonly TargetSelectionInput[],
  locked: readonly RegistrationRecord[],
): Promise<readonly ProcedureTargetSnapshot[]> {
  const byId = new Map(locked.map((record) => [record.registrationId, record]));
  const targets: ProcedureTargetSnapshot[] = [];
  for (const selection of selections) {
    if (selection.mode === 'retain') {
      // Retain the saved snapshot verbatim — never re-resolve it, so a registration that
      // changed or retired after it was frozen keeps its original contract.
      const existing = before.targets.find(
        (target) => target.registrationId === selection.registrationId,
      );
      if (existing === undefined) throw new Refused(TARGET_DRAFT_MESSAGES.RETAIN_UNKNOWN);
      targets.push(existing);
    } else {
      const record = byId.get(selection.registrationId);
      if (record === undefined || record.status !== 'active') {
        throw new Refused(TARGET_DRAFT_MESSAGES.INELIGIBLE);
      }
      // The surface rendered a digest; if the registration moved since, the auditor never
      // saw what they would be freezing. Refuse rather than attach unseen data.
      if (record.digest !== selection.expectedDigest) {
        throw new Refused(TARGET_DRAFT_MESSAGES.UNSEEN);
      }
      const snapshot = snapshotFromRegistration(record);
      if (!isProcedureTargetSnapshot(snapshot)) throw new Refused(TARGET_DRAFT_MESSAGES.INVALID_SNAPSHOT);
      targets.push(snapshot);
    }
  }
  return targets;
}

/** Validate the verbatim instructions against the current selection. */
function resolveInstructions(
  before: ProcedureVersionRecord,
  raw: readonly { readonly registrationId: string; readonly text: string }[],
): readonly TargetInstruction[] {
  const reason = validateInstructionSelection(before.targets, raw);
  if (reason !== null) throw new Refused(reason);
  // Clearing is allowed only after shape, size, text and membership validation.
  return raw.filter((entry) => entry.text.trim() !== '');
}

/** The credential-free projection of the targets, for the audit payload. */
function targetValues(targets: readonly ProcedureTargetSnapshot[]): JsonValue {
  // The contract, and its `credential_ref`, is deliberately absent: the chain is immutable,
  // so anything credential-shaped that enters it can never be taken out again.
  return targets.map((target) => ({
    registrationId: target.registrationId,
    displayName: target.displayName,
    digest: target.digest,
    kind: target.contract.kind,
  })) as unknown as JsonValue;
}

function instructionValues(instructions: readonly TargetInstruction[]): JsonValue {
  return instructions.map((instruction) => ({
    registrationId: instruction.registrationId,
    // Instructions may themselves name credential references. Keep the verbatim text on
    // the version; an audit event identifies the change without copying it into the chain.
    textDigest: sha256Hex(instruction.text),
    textLength: instruction.text.length,
  })) as unknown as JsonValue;
}

export async function updateTargetDraft(
  dependencies: ProcedureDependencies,
  input: UpdateTargetDraftInput,
): Promise<UpdateTargetDraftResult> {
  const decision = await authorizeCommand(
    { roles: dependencies.roles, unitOfWork: dependencies.unitOfWork },
    { session: input.session, action: PROCEDURE_AUTHOR_ACTION, correlationId: input.correlationId },
  );
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  const validation = validateDraftTargetEdit(input.edit);
  if (!validation.ok) return validation;
  const edit = validation.edit;

  try {
    return await dependencies.unitOfWork.execute(async ({ procedures, targetRegistrations, auditEvents }) => {
      const before = await procedures.findVersionForUpdate(input.versionId);
      if (before === null || before.procedureId !== input.procedureId) {
        throw new Refused(PROCEDURE_REFUSALS.UNKNOWN_VERSION);
      }
      if (before.state !== 'DRAFT') throw new Refused(PROCEDURE_REFUSALS.NOT_A_DRAFT);
      if (procedureVersionRowVersion(before) !== input.expectedRowVersion) {
        throw new Refused(PROCEDURE_REFUSALS.STALE_ROW);
      }

      let after: ProcedureVersionRecord;
      if (edit.section === 'target-systems') {
        const bindIds = edit.selections
          .filter((selection): selection is Extract<TargetSelectionInput, { mode: 'bind' }> => selection.mode === 'bind')
          .map((selection) => selection.registrationId);
        const locked = await targetRegistrations.lockForSelection(bindIds);
        const targets = await resolveSelection(before, edit.selections, locked);
        // An instruction is only ever for a selected agent-driven system, so a target
        // that is no longer selected loses its instruction rather than orphaning it.
        const agentIds = new Set(
          targets
            .filter((target) => isAgentDrivenKind(target.contract.kind))
            .map((target) => target.registrationId),
        );
        const instructions = before.instructions.filter((instruction) =>
          agentIds.has(instruction.registrationId),
        );
        after = { ...before, targets, instructions };
      } else {
        after = { ...before, instructions: resolveInstructions(before, edit.instructions) };
      }

      if (!isDraftTargetFields(after)) throw new Refused(TARGET_DRAFT_MESSAGES.INVALID_SNAPSHOT);
      const rowVersion = procedureVersionRowVersion(after);
      if (rowVersion === input.expectedRowVersion) return { ok: true, rowVersion, changed: false };

      await procedures.updateVersion(after);
      const project = (row: ProcedureVersionRecord): JsonValue =>
        (edit.section === 'target-systems'
          ? { targets: targetValues(row.targets), instructions: instructionValues(row.instructions) }
          : { instructions: instructionValues(row.instructions) }) as unknown as JsonValue;
      await auditEvents.append({
        actor: { type: 'human', id: input.session.userId },
        eventType: PROCEDURE_DRAFT_CHANGED_EVENT,
        source: 'web',
        outcome: 'success',
        sessionId: input.session.sessionId,
        correlationId: input.correlationId,
        aggregateId: input.procedureId,
        payload: {
          procedureId: input.procedureId,
          versionId: input.versionId,
          versionNumber: before.versionNumber,
          section: edit.section,
          prior: project(before),
          current: project(after),
        },
      });
      return { ok: true, rowVersion, changed: true };
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.message };
    throw error;
  }
}
