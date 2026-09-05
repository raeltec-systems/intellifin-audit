import { canonicalJson, sha256Hex, EXECUTABLE_PLAN_COMPILER_VERSION, type FrozenPlanInputs, type JsonValue } from '@intellifin/domain';
import type { ModelIdentity, PlanDerivationFields, PlanDerivationQueue } from './plan-ports.js';
import type { ProcedureVersionRecord } from './ports.js';

export function initialPlanDerivation(model: ModelIdentity | null = null): PlanDerivationFields {
  return { planCompilerVersion: EXECUTABLE_PLAN_COMPILER_VERSION, derivationModel: model, compiledPlan: null,
    planInputDigest: null, planStatus: 'pending', planFailureReason: null, planDerivable: false, planAttempts: [] };
}
/** An explicit projection prevents attempt timestamps and preview refreshes changing compiler inputs. */
export function planAuthoringInputs(row: ProcedureVersionRecord): FrozenPlanInputs {
  return {
    templateId: row.templateId, controlName: row.controlName, sections: row.sections,
    period: row.period, scope: row.scope, sourceSnapshot: row.sourceSnapshot, inclusionRule: row.inclusionRule,
    zeroRecordPass: row.zeroRecordPass, allowVersionedDuplicates: row.allowVersionedDuplicates,
    populationBlockers: row.populationBlockers, targets: row.targets, instructions: row.instructions,
    complianceSchemaVersion: row.complianceSchemaVersion, complianceCompilerVersion: row.complianceCompilerVersion,
    complianceConditions: row.complianceConditions, agentJudgedThreshold: row.agentJudgedThreshold,
    evidenceSchemaVersion: row.evidenceSchemaVersion, evidenceRequirements: row.evidenceRequirements, schedule: row.schedule,
  };
}
export function planAuthoringDigest(row: ProcedureVersionRecord): string {
  return sha256Hex(canonicalJson({ inputs: planAuthoringInputs(row), compilerVersion: row.planCompilerVersion,
    model: row.derivationModel } as unknown as JsonValue));
}
/** Called only after a save proved that authored values changed, inside its transaction. */
export async function queuePlanDerivation(row: ProcedureVersionRecord, queue: PlanDerivationQueue, authorId?: string): Promise<ProcedureVersionRecord> {
  const inputDigest = planAuthoringDigest(row);
  await queue.enqueue({ schemaVersion: 1, versionId: row.versionId, inputDigest });
  const authorship = row.authorship && authorId ? { ...row.authorship, humanAuthorIds: [...new Set([...row.authorship.humanAuthorIds, authorId])] } : row.authorship ?? null;
  return { ...row, authorship, compiledPlan: null, planDerivable: false, planStatus: 'pending', planFailureReason: null, planInputDigest: inputDigest };
}
