import {
  canonicalJson,
  compileComplianceDraft,
  sha256Hex,
  type ComplianceDraftInput,
  type DraftComplianceFields,
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

export type { ComplianceDraftInput } from '@intellifin/domain';

export interface UpdateComplianceDraftInput {
  readonly session: SessionSnapshot;
  readonly correlationId: string;
  readonly procedureId: string;
  readonly versionId: string;
  readonly expectedRowVersion: string;
  readonly edit: ComplianceDraftInput;
}

export type UpdateComplianceDraftResult = ProcedureOutcome<{
  readonly rowVersion: string;
  readonly changed: boolean;
}>;

class Refused extends Error {}

/** Authored text and expressions stay on the version, outside the immutable audit chain. */
function auditValues(row: DraftComplianceFields): JsonValue {
  return {
    schemaVersion: row.complianceSchemaVersion,
    compilerVersion: row.complianceCompilerVersion,
    agentJudgedThreshold: row.agentJudgedThreshold,
    conditions: row.complianceConditions.map((condition) => ({
      conditionId: condition.conditionId,
      textDigest: sha256Hex(condition.text),
      textLength: condition.text.length,
      applicabilityDigest: sha256Hex(condition.applicability),
      applicabilityLength: condition.applicability.length,
      // Neither the AST nor named values are copied into the chain.
      compilationDigest: sha256Hex(canonicalJson({
        applicabilityAst: condition.applicabilityAst,
        rule: condition.rule,
        comparison: condition.comparison,
      } as unknown as JsonValue)),
      status: condition.status,
    })),
  };
}

/** Compile with the locked version's compiler, then save the whole Draft atomically. */
export async function updateComplianceDraft(
  dependencies: ProcedureDependencies,
  input: UpdateComplianceDraftInput,
): Promise<UpdateComplianceDraftResult> {
  const decision = await authorizeCommand(
    { roles: dependencies.roles, unitOfWork: dependencies.unitOfWork },
    { session: input.session, action: PROCEDURE_AUTHOR_ACTION, correlationId: input.correlationId },
  );
  if (!decision.allowed) return { ok: false, reason: decision.reason };

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

      const compiled = compileComplianceDraft(before.templateId, input.edit, before.complianceCompilerVersion);
      if (!compiled.ok) throw new Refused(compiled.reason);
      const after = { ...before, ...compiled.value };
      const rowVersion = procedureVersionRowVersion(after);
      if (rowVersion === input.expectedRowVersion) return { ok: true, rowVersion, changed: false };

      await procedures.updateVersion(after);
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
          section: 'compliance-rule',
          prior: auditValues(before),
          current: auditValues(after),
        },
      });
      return { ok: true, rowVersion, changed: true };
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.message };
    throw error;
  }
}
