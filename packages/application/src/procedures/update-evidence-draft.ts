import {
  EVIDENCE_DRAFT_MESSAGES,
  PERIOD_DERIVATION_RULES,
  hasAgentDrivenTarget,
  evidenceGroundingMessage,
  isDraftEvidenceFields,
  isEvidenceRequirement,
  validateDraftEvidenceEdit,
  withPlatformCaptured,
  type DraftEvidenceEdit,
  type DraftSchedule,
  type EvidenceRequirement,
  type JsonValue,
} from '@intellifin/domain';

import { authorizeCommand } from '../identity/authorize.js';
import type { SessionSnapshot } from '../identity/ports.js';
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
 * Specifying Evidence Requirements and setting the Schedule on a Draft (FR-9, FR-10,
 * AD-2, AD-7, AD-8).
 *
 * Two edits, one command, the same shape `updateTargetDraft` and `updatePopulationDraft`
 * established:
 *
 *   - `evidence-requirements` saves the typed, per-attribute requirements. The
 *     `platformCaptured` flag on each is RECOMPUTED here from the Draft's CURRENT Target
 *     System selection, never trusted from the caller — an agent-driven attribute is
 *     always grounded by a Structural Snapshot and always carries the screenshot,
 *     recorded rather than offered as a choice.
 *   - `schedule` saves the frequency and the fixed UTC start time; the period-derivation
 *     rule is computed here from the frequency, never accepted from the caller.
 *
 * Both guard the whole Draft row, both refuse a non-DRAFT and a stale token, both commit
 * their change with one `lifecycle.procedure-draft-changed` event, and neither ever
 * refuses on the upload/frequency pairing — that is a completeness blocker
 * (`evidenceBlockersFor`), computed on read, never a save-time refusal.
 */

export type { DraftEvidenceEdit } from '@intellifin/domain';

export interface UpdateEvidenceDraftInput {
  readonly session: SessionSnapshot;
  readonly correlationId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly expectedRowVersion: string;
  readonly edit: DraftEvidenceEdit;
}

export type UpdateEvidenceDraftResult = ProcedureOutcome<{
  readonly rowVersion: string;
  readonly changed: boolean;
}>;

class Refused extends Error {}

function requirementValues(requirements: readonly EvidenceRequirement[]): JsonValue {
  return requirements.map((requirement) => ({
    attributeName: requirement.attributeName,
    modelRead: requirement.modelRead,
    groundedBy: [...requirement.groundedBy],
    screenshot: requirement.screenshot,
    recordingSegment: requirement.recordingSegment,
    platformCaptured: requirement.platformCaptured,
  })) as unknown as JsonValue;
}

function scheduleValues(schedule: DraftSchedule | null): JsonValue {
  return schedule === null
    ? null
    : ({
        frequency: schedule.frequency,
        startTime: schedule.startTime,
        periodDerivationRule: schedule.periodDerivationRule,
      } as unknown as JsonValue);
}

export async function updateEvidenceDraft(
  dependencies: ProcedureDependencies,
  input: UpdateEvidenceDraftInput,
): Promise<UpdateEvidenceDraftResult> {
  const decision = await authorizeCommand(
    { roles: dependencies.roles, unitOfWork: dependencies.unitOfWork },
    { session: input.session, action: PROCEDURE_AUTHOR_ACTION, correlationId: input.correlationId },
  );
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  const validation = validateDraftEvidenceEdit(input.edit);
  if (!validation.ok) return validation;
  const edit = validation.edit;

  try {
    return await dependencies.unitOfWork.execute(async ({ procedures, auditEvents }) => {
      const before = await procedures.findVersionForUpdate(input.versionId);
      if (before === null || before.procedureId !== input.procedureId) {
        throw new Refused(PROCEDURE_REFUSALS.UNKNOWN_VERSION);
      }
      if (before.state !== 'DRAFT') throw new Refused(PROCEDURE_REFUSALS.NOT_A_DRAFT);
      if (procedureVersionRowVersion(before) !== input.expectedRowVersion) {
        throw new Refused(PROCEDURE_REFUSALS.STALE_ROW);
      }

      let after: ProcedureVersionRecord;
      if (edit.section === 'evidence-requirements') {
        const platformCaptured = hasAgentDrivenTarget(before.targets);
        const requirements: EvidenceRequirement[] = [];
        for (const entry of edit.requirements) {
          // Shape-validated already; recompute `platformCaptured` from the CURRENT
          // selection rather than trusting whatever the surface rendered.
          const requirement = withPlatformCaptured(entry, platformCaptured);
          if (!isEvidenceRequirement(requirement)) throw new Refused(evidenceGroundingMessage(entry.attributeName));
          requirements.push(requirement);
        }
        after = { ...before, evidenceRequirements: requirements };
      } else {
        const schedule: DraftSchedule = {
          frequency: edit.frequency,
          startTime: edit.startTime,
          periodDerivationRule: PERIOD_DERIVATION_RULES[edit.frequency],
        };
        after = { ...before, schedule };
      }

      if (!isDraftEvidenceFields(after)) throw new Refused(EVIDENCE_DRAFT_MESSAGES.SHAPE);
      const rowVersion = procedureVersionRowVersion(after);
      if (rowVersion === input.expectedRowVersion) return { ok: true, rowVersion, changed: false };

      await procedures.updateVersion(after);
      const project = (row: ProcedureVersionRecord): JsonValue =>
        (edit.section === 'evidence-requirements'
          ? { evidenceRequirements: requirementValues(row.evidenceRequirements) }
          : { schedule: scheduleValues(row.schedule) }) as unknown as JsonValue;
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
