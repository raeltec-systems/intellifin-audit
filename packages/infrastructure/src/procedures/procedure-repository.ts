import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { planAuthoringDigest, planAuthoringInputs } from '@intellifin/application';

import { isUuidText } from '../db/identifier.js';

import type {
  PlanDerivationFields,
  ProcedureRecord,
  ProcedureRepository,
  ProcedureSummary,
  ProcedureVersionRecord,
  ProcedureVersionView,
  ProcedureWriter,
} from '@intellifin/application';
import {
  ExecutablePlanSchema,
  canonicalJson,
  type JsonValue,
  isProcedureVersionState,
  isTemplateId,
  isValidDraftSectionsPayload,
  isDraftPopulationFields,
  isDraftTargetFields,
  isDraftComplianceFields,
  isDraftEvidenceFields,
  targetBlockersFor,
  evidenceBlockersFor,
  type DraftPopulationFields,
  type DraftSection,
  type DraftTargetFields,
  type DraftComplianceFields,
  type DraftEvidenceFields,
  type ProcedureTargetSnapshot,
  type ProcedureVersionState,
  type TargetInstruction,
  type TemplateId,
} from '@intellifin/domain';

import type { Database, Transaction } from '../db/client.js';
import { procedure, procedureVersion } from '../db/schema.js';

/**
 * The Procedure read and write adapters (FR-4, FR-5, AD-2, AD-8).
 *
 * Nothing here decides what a section payload means: the domain module owns its type and
 * its validator, and a row whose payload fails the validator is read as NOTHING — the
 * same rule the binding repository applies to a kind outside its vocabulary. The CHECK
 * constraints make these rows unreachable through this application; the guards are for
 * the row a future migration, a restored dump or a psql session could leave behind.
 */

/** How many Procedures the surface renders. An unbounded SELECT is a query whose cost is set by the data. */
export const PROCEDURE_LIST_LIMIT = 200;

/** How many versions one Detail surface renders. */
export const VERSION_LIST_LIMIT = 100;

const PROCEDURE_SELECTION = {
  procedureId: procedure.procedureId,
  controlName: procedure.controlName,
  templateId: procedure.templateId,
  createdAt: procedure.createdAt,
  updatedAt: procedure.updatedAt,
} as const;

const VERSION_SELECTION = {
  versionId: procedureVersion.versionId,
  procedureId: procedureVersion.procedureId,
  versionNumber: procedureVersion.versionNumber,
  state: procedureVersion.state,
  controlName: procedureVersion.controlName,
  templateId: procedureVersion.templateId,
  sections: procedureVersion.sections,
  period: procedureVersion.period,
  scope: procedureVersion.scope,
  sourceSnapshot: procedureVersion.sourceSnapshot,
  inclusionRule: procedureVersion.inclusionRule,
  zeroRecordPass: procedureVersion.zeroRecordPass,
  allowVersionedDuplicates: procedureVersion.allowVersionedDuplicates,
  populationBlockers: procedureVersion.populationBlockers,
  targets: procedureVersion.targets,
  instructions: procedureVersion.instructions,
  complianceSchemaVersion: procedureVersion.complianceSchemaVersion,
  complianceCompilerVersion: procedureVersion.complianceCompilerVersion,
  complianceConditions: procedureVersion.complianceConditions,
  agentJudgedThreshold: procedureVersion.agentJudgedThreshold,
  evidenceSchemaVersion: procedureVersion.evidenceSchemaVersion,
  evidenceRequirements: procedureVersion.evidenceRequirements,
  schedule: procedureVersion.schedule,
  planCompilerVersion: procedureVersion.planCompilerVersion,
  derivationModel: procedureVersion.derivationModel,
  compiledPlan: procedureVersion.compiledPlan,
  planInputDigest: procedureVersion.planInputDigest,
  planStatus: procedureVersion.planStatus,
  planFailureReason: procedureVersion.planFailureReason,
  planDerivable: procedureVersion.planDerivable,
  planAttempts: procedureVersion.planAttempts,
  createdAt: procedureVersion.createdAt,
  updatedAt: procedureVersion.updatedAt,
} as const;

interface ProcedureSelectedRow {
  procedureId: string;
  controlName: string;
  templateId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface VersionSelectedRow extends DraftPopulationFields, DraftTargetFields, PlanDerivationFields {
  complianceSchemaVersion: number;
  complianceCompilerVersion: string;
  complianceConditions: unknown;
  agentJudgedThreshold: string;
  // `evidence_schema_version` is a plain `integer` column, so Drizzle's select type is
  // `number`, not the domain's literal `1` — the same reason `complianceSchemaVersion`
  // above is `number` rather than extending `DraftComplianceFields`. `isDraftEvidenceFields`
  // is what narrows it.
  evidenceSchemaVersion: number;
  evidenceRequirements: unknown;
  schedule: unknown;
  versionId: string;
  procedureId: string;
  versionNumber: number;
  state: string;
  controlName: string;
  templateId: string;
  sections: readonly DraftSection[];
  createdAt: Date;
  updatedAt: Date;
}

/** A vocabulary word outside its list is read as nothing, never as "some state". */
function toState(value: string): ProcedureVersionState | null {
  return isProcedureVersionState(value) ? value : null;
}

function toTemplateId(value: string): TemplateId | null {
  return isTemplateId(value) ? value : null;
}

function toSections(templateId: string, value: readonly DraftSection[]): readonly DraftSection[] | null {
  return isValidDraftSectionsPayload({ templateId, sections: value }) ? value : null;
}

function toVersionView(row: VersionSelectedRow): ProcedureVersionView | null {
  if (!validPlanMetadata(row)) return null;
  if (!isDraftPopulationFields(row) || !isDraftTargetFields(row) || !isDraftEvidenceFields(row)) return null;
  const state = toState(row.state);
  const templateId = toTemplateId(row.templateId);
  const sections = toSections(row.templateId, row.sections);
  if (state === null || templateId === null || sections === null || !isDraftComplianceFields(row, templateId)) return null;
  return {
    ...populationFields(row),
    ...targetFields(row),
    ...complianceFields(row),
    ...evidenceFields(row),
    ...readPlanFields(row),
    versionId: row.versionId,
    procedureId: row.procedureId,
    versionNumber: row.versionNumber,
    state,
    controlName: row.controlName,
    templateId,
    sections,
    // Derived, not stored: the Template names the required agent coverage and the
    // selection either covers it or does not.
    targetBlockers: targetBlockersFor(templateId, row.targets),
    // Derived, not stored: the upload/frequency pairing, surfaced on both the
    // Population Source section and this one.
    evidenceBlockers: evidenceBlockersFor(row.sourceSnapshot, row.schedule),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toVersionRecord(row: VersionSelectedRow): ProcedureVersionRecord | null {
  if (!validPlanMetadata(row)) return null;
  if (!isDraftPopulationFields(row) || !isDraftTargetFields(row) || !isDraftEvidenceFields(row)) return null;
  const state = toState(row.state);
  const templateId = toTemplateId(row.templateId);
  const sections = toSections(row.templateId, row.sections);
  if (state === null || templateId === null || sections === null || !isDraftComplianceFields(row, templateId)) return null;
  return {
    ...populationFields(row),
    ...targetFields(row),
    ...complianceFields(row),
    ...evidenceFields(row),
    ...readPlanFields(row),
    versionId: row.versionId,
    procedureId: row.procedureId,
    versionNumber: row.versionNumber,
    state,
    controlName: row.controlName,
    templateId,
    sections,
  };
}

function populationFields(row: DraftPopulationFields): DraftPopulationFields {
  return { period: row.period, scope: row.scope, sourceSnapshot: row.sourceSnapshot, inclusionRule: row.inclusionRule, zeroRecordPass: row.zeroRecordPass, allowVersionedDuplicates: row.allowVersionedDuplicates, populationBlockers: row.populationBlockers };
}

function targetFields(row: DraftTargetFields): DraftTargetFields {
  return { targets: row.targets, instructions: row.instructions };
}

function complianceFields(row: DraftComplianceFields): DraftComplianceFields {
  return {
    complianceSchemaVersion: row.complianceSchemaVersion,
    complianceCompilerVersion: row.complianceCompilerVersion,
    complianceConditions: row.complianceConditions,
    agentJudgedThreshold: row.agentJudgedThreshold,
  };
}

const modelIdentitySchema = z.strictObject({ provider: z.string().min(1).max(100), modelId: z.string().min(1).max(200), promptVersion: z.string().min(1).max(100) });
const planMetadataSchema = z.object({
  planCompilerVersion: z.string().min(1).max(64),
  derivationModel: modelIdentitySchema.nullable(),
  planInputDigest: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  planStatus: z.enum(['pending', 'succeeded', 'failed']),
  planFailureReason: z.string().min(1).max(1000).nullable(),
  planDerivable: z.boolean(),
  planAttempts: z.array(z.strictObject({
    attemptId: z.uuid(), inputDigest: z.string().regex(/^[0-9a-f]{64}$/),
    attemptedAt: z.iso.datetime(), outcome: z.enum(['started', 'success', 'failure', 'stale']), jobId: z.uuid().optional(), completedAt: z.iso.datetime().optional(), published: z.boolean().optional(),
    reason: z.string().min(1).max(1000).nullable(), model: modelIdentitySchema.nullable(),
  })),
});
function validPlanMetadata(row: PlanDerivationFields): boolean {
  return planMetadataSchema.safeParse(row).success;
}

function planFields(row: PlanDerivationFields): PlanDerivationFields {
  return {
    planCompilerVersion: row.planCompilerVersion,
    derivationModel: row.derivationModel,
    compiledPlan: row.compiledPlan,
    planInputDigest: row.planInputDigest,
    planStatus: row.planStatus,
    planFailureReason: row.planFailureReason,
    planDerivable: row.planDerivable,
    planAttempts: row.planAttempts,
  };
}

/** Invalid durable payload never becomes an executable/derivable result. */
function readPlanFields(row: VersionSelectedRow): PlanDerivationFields {
  const parsed = ExecutablePlanSchema.safeParse(row.compiledPlan);
  if (row.compiledPlan === null && !row.planDerivable) return planFields(row);
  // Called only after all authored fields and the state have passed their validators.
  const authored = row as ProcedureVersionRecord;
  if (parsed.success && row.planStatus === 'succeeded' && row.planDerivable &&
      parsed.data.compilerVersion === row.planCompilerVersion && row.planInputDigest === planAuthoringDigest(authored) &&
      canonicalJson(parsed.data.inputs as unknown as JsonValue) === canonicalJson(planAuthoringInputs(authored) as unknown as JsonValue)) {
    return { ...planFields(row), compiledPlan: parsed.data };
  }
  return { ...planFields(row), compiledPlan: null, planDerivable: false, planStatus: 'failed', planFailureReason: 'Stored executable plan does not satisfy its durable contract' };
}

function evidenceFields(row: DraftEvidenceFields): DraftEvidenceFields {
  return {
    evidenceSchemaVersion: row.evidenceSchemaVersion,
    evidenceRequirements: row.evidenceRequirements,
    schedule: row.schedule,
  };
}

/**
 * The ACTIVE version, or nothing.
 *
 * There is no fallback to the newest version, deliberately. The cell this feeds is
 * labelled "Active version" (UX-DR7), so answering it with a Draft states that a
 * Procedure has an Active version when it has none — the absent-reads-as-present
 * defect the card's own wording rule exists to prevent, and worse than the dash that
 * rule forbids, because "Active version: Draft" reads as a fact rather than a gap.
 * Story 2.1 writes only DRAFT, so this is `null` for every Procedure it creates and
 * the surface says "No active version" in words. A later story that wants "the newest
 * version whatever its state" wants a differently-named field, not this one.
 */
/** Reads Procedures and their versions for the surfaces. Outside any transaction. */
export class DrizzleProcedureRepository implements ProcedureRepository {
  constructor(
    private readonly db: Database,
    private readonly limit: number = PROCEDURE_LIST_LIMIT,
  ) {}

  async listProcedures(): Promise<readonly ProcedureSummary[]> {
    const procedureRows = await this.db
      .select(PROCEDURE_SELECTION)
      .from(procedure)
      .orderBy(desc(procedure.updatedAt), asc(procedure.procedureId))
      .limit(this.limit);

    const active = await this.activeSummaries(procedureRows.map((row) => row.procedureId));

    const summaries: ProcedureSummary[] = [];
    for (const row of procedureRows) {
      const templateId = toTemplateId(row.templateId);
      if (templateId === null) continue;
      const display = active.get(row.procedureId) ?? { state: null, versionNumber: null };
      summaries.push({
        procedureId: row.procedureId,
        controlName: row.controlName,
        templateId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        activeVersionState: display.state,
        activeVersionNumber: display.versionNumber,
      });
    }
    return summaries;
  }

  async findProcedure(procedureId: string): Promise<ProcedureSummary | null> {
    // A malformed id is absence, not a 500: PostgreSQL raises 22P02 comparing a `uuid`
    // column against text that is not one, and this id comes from a URL.
    if (!isUuidText(procedureId)) return null;
    const rows = await this.db
      .select(PROCEDURE_SELECTION)
      .from(procedure)
      .where(eq(procedure.procedureId, procedureId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const templateId = toTemplateId(row.templateId);
    if (templateId === null) return null;

    const display = (await this.activeSummaries([procedureId])).get(procedureId) ?? { state: null, versionNumber: null };

    return {
      procedureId: row.procedureId,
      controlName: row.controlName,
      templateId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      activeVersionState: display.state,
      activeVersionNumber: display.versionNumber,
    };
  }

  /** Only displayed metadata is selected; full plans/history never enter summary reads. */
  private async activeSummaries(procedureIds: readonly string[]): Promise<Map<string, { state: 'ACTIVE'; versionNumber: number }>> {
    if (procedureIds.length === 0) return new Map();
    const rows = await this.db.selectDistinctOn([procedureVersion.procedureId], {
      procedureId: procedureVersion.procedureId, state: procedureVersion.state, versionNumber: procedureVersion.versionNumber,
    }).from(procedureVersion)
      .where(and(inArray(procedureVersion.procedureId, [...procedureIds]), eq(procedureVersion.state, 'ACTIVE')))
      .orderBy(asc(procedureVersion.procedureId), desc(procedureVersion.versionNumber), desc(procedureVersion.versionId));
    const selected = new Set(procedureIds);
    const result = new Map<string, { state: 'ACTIVE'; versionNumber: number }>();
    for (const row of rows) {
      if (selected.has(row.procedureId) && row.state === 'ACTIVE' && Number.isSafeInteger(row.versionNumber) && row.versionNumber >= 1) {
        result.set(row.procedureId, { state: 'ACTIVE', versionNumber: row.versionNumber });
      }
    }
    return result;
  }

  async listVersions(procedureId: string): Promise<readonly ProcedureVersionView[]> {
    if (!isUuidText(procedureId)) return [];
    const rows = await this.db
      .select(VERSION_SELECTION)
      .from(procedureVersion)
      .where(eq(procedureVersion.procedureId, procedureId))
      .orderBy(asc(procedureVersion.versionNumber))
      .limit(VERSION_LIST_LIMIT);
    return rows
      .map(toVersionView)
      .filter((version): version is ProcedureVersionView => version !== null);
  }

  async findVersion(versionId: string): Promise<ProcedureVersionView | null> {
    if (!isUuidText(versionId)) return null;
    const rows = await this.db
      .select(VERSION_SELECTION)
      .from(procedureVersion)
      .where(eq(procedureVersion.versionId, versionId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return toVersionView(row);
  }
}

/**
 * The Procedure write, bound to ONE transaction (AD-8).
 *
 * It takes a {@link Transaction}, not a `Database`, and that is the guarantee: there is
 * no way to construct this writer outside a unit of work, so a Procedure cannot commit
 * while the `lifecycle.procedure-created` event that records it fails.
 */
export class DrizzleProcedureWriter implements ProcedureWriter {
  constructor(private readonly transaction: Transaction) {}

  async insertProcedure(record: ProcedureRecord): Promise<void> {
    await this.transaction.insert(procedure).values({
      procedureId: record.procedureId,
      controlName: record.controlName,
      templateId: record.templateId,
    });
  }

  async insertVersion(record: ProcedureVersionRecord): Promise<void> {
    await this.transaction.insert(procedureVersion).values({
      ...populationFields(record),
      ...complianceFields(record),
      ...evidenceFields(record),
      ...planFields(record),
      versionId: record.versionId,
      procedureId: record.procedureId,
      versionNumber: record.versionNumber,
      state: record.state,
      controlName: record.controlName,
      templateId: record.templateId,
      sections: [...record.sections],
      targets: [...record.targets],
      instructions: [...record.instructions],
    });
  }

  async findVersion(versionId: string): Promise<ProcedureVersionRecord | null> {
    if (!isUuidText(versionId)) return null;
    const rows = await this.transaction
      .select(VERSION_SELECTION)
      .from(procedureVersion)
      .where(eq(procedureVersion.versionId, versionId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return toVersionRecord(row);
  }

  async findVersionForUpdate(versionId: string): Promise<ProcedureVersionRecord | null> {
    if (!isUuidText(versionId)) return null;
    const rows = await this.transaction
      .select(VERSION_SELECTION)
      .from(procedureVersion)
      .where(eq(procedureVersion.versionId, versionId))
      // The row is about to be updated and its token is about to be checked. Locking it
      // makes a concurrent change queue instead of landing between this read and the
      // write — which is what makes the row-version guard a guard rather than a
      // suggestion.
      .for('update')
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return toVersionRecord(row);
  }

  async updateVersion(record: ProcedureVersionRecord): Promise<void> {
    await this.transaction
      .update(procedureVersion)
      .set({
        ...populationFields(record),
        ...complianceFields(record),
        ...evidenceFields(record),
      ...planFields(record),
        state: record.state,
        controlName: record.controlName,
        sections: [...record.sections],
        targets: [...record.targets],
        instructions: [...record.instructions],
        updatedAt: new Date(),
      })
      .where(eq(procedureVersion.versionId, record.versionId));
  }

  async maxVersionNumber(procedureId: string): Promise<number> {
    if (!isUuidText(procedureId)) return 0;
    const rows = await this.transaction
      .select({ versionNumber: procedureVersion.versionNumber })
      .from(procedureVersion)
      .where(eq(procedureVersion.procedureId, procedureId))
      .orderBy(desc(procedureVersion.versionNumber))
      .limit(1);
    return rows[0]?.versionNumber ?? 0;
  }
}
