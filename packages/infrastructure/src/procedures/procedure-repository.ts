import { asc, desc, eq } from 'drizzle-orm';

import { isUuidText } from '../db/identifier.js';

import type {
  ProcedureRecord,
  ProcedureRepository,
  ProcedureSummary,
  ProcedureVersionRecord,
  ProcedureVersionView,
  ProcedureWriter,
} from '@intellifin/application';
import {
  isProcedureVersionState,
  isTemplateId,
  isValidDraftSectionsPayload,
  type DraftSection,
  type ProcedureVersionState,
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

interface VersionSelectedRow {
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
  const state = toState(row.state);
  const templateId = toTemplateId(row.templateId);
  const sections = toSections(row.templateId, row.sections);
  if (state === null || templateId === null || sections === null) return null;
  return {
    versionId: row.versionId,
    procedureId: row.procedureId,
    versionNumber: row.versionNumber,
    state,
    controlName: row.controlName,
    templateId,
    sections,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toVersionRecord(row: VersionSelectedRow): ProcedureVersionRecord | null {
  const state = toState(row.state);
  const templateId = toTemplateId(row.templateId);
  const sections = toSections(row.templateId, row.sections);
  if (state === null || templateId === null || sections === null) return null;
  return {
    versionId: row.versionId,
    procedureId: row.procedureId,
    versionNumber: row.versionNumber,
    state,
    controlName: row.controlName,
    templateId,
    sections,
  };
}

/**
 * The ACTIVE version when one exists, else the newest — the version a reader would act
 * on. A Procedure whose versions all fail the vocabulary guards is listed as having
 * none, which the surfaces word honestly ("No active version"); it is never shown as a
 * state nobody can interpret.
 */
function displayVersion(versions: readonly ProcedureVersionView[]): {
  state: ProcedureVersionState | null;
  versionNumber: number | null;
} {
  const active = versions.find((version) => version.state === 'ACTIVE');
  if (active) return { state: active.state, versionNumber: active.versionNumber };
  const newest = [...versions].sort((a, b) => b.versionNumber - a.versionNumber)[0];
  return newest === undefined
    ? { state: null, versionNumber: null }
    : { state: newest.state, versionNumber: newest.versionNumber };
}

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

    const versionRows = await this.db
      .select(VERSION_SELECTION)
      .from(procedureVersion)
      .orderBy(asc(procedureVersion.procedureId), asc(procedureVersion.versionNumber));

    const byProcedure = new Map<string, ProcedureVersionView[]>();
    for (const row of versionRows) {
      const view = toVersionView(row);
      if (view === null) continue;
      const list = byProcedure.get(row.procedureId) ?? [];
      list.push(view);
      byProcedure.set(row.procedureId, list);
    }

    const summaries: ProcedureSummary[] = [];
    for (const row of procedureRows) {
      const templateId = toTemplateId(row.templateId);
      if (templateId === null) continue;
      const versions = byProcedure.get(row.procedureId) ?? [];
      const display = displayVersion(versions);
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

    const versionRows = await this.db
      .select(VERSION_SELECTION)
      .from(procedureVersion)
      .where(eq(procedureVersion.procedureId, procedureId))
      .orderBy(asc(procedureVersion.versionNumber))
      .limit(VERSION_LIST_LIMIT);
    const versions = versionRows
      .map(toVersionView)
      .filter((version): version is ProcedureVersionView => version !== null);
    const display = displayVersion(versions);

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
      versionId: record.versionId,
      procedureId: record.procedureId,
      versionNumber: record.versionNumber,
      state: record.state,
      controlName: record.controlName,
      templateId: record.templateId,
      sections: [...record.sections],
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
        state: record.state,
        controlName: record.controlName,
        sections: [...record.sections],
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
