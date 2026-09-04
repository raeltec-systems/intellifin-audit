import type { DraftSection, ProcedureVersionState, TemplateId } from '@intellifin/domain';

import type { AuditUnitOfWorkContext } from '../audit/ports.js';

/**
 * The Procedure ports this layer owns (FR-4..FR-12, AD-1, AD-2).
 *
 * Every type here is a plain value: no Drizzle row, no JSON string, no framework type.
 * The Draft section payload crosses this seam as the domain's own validated shape, never
 * as an opaque `jsonb` blob — the column is `jsonb`, but nothing outside the domain
 * decides what it means.
 */

/** A Procedure, as the Procedures surface lists it. */
export interface ProcedureSummary {
  readonly procedureId: string;
  readonly controlName: string;
  readonly templateId: TemplateId;
  /** ISO 8601 UTC, as every boundary in this product uses. */
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * The state of the version a reader would act on: the ACTIVE one when one exists,
   * else the newest version whatever its state. `null` only when the Procedure has no
   * version at all, which creation makes unreachable — the invariant is asserted by the
   * one writer that could break it.
   */
  readonly activeVersionState: ProcedureVersionState | null;
  /** Version number of that version, or `null` when there is no version. */
  readonly activeVersionNumber: number | null;
}

/** A Procedure Version, as the Detail and Builder surfaces render it. */
export interface ProcedureVersionView {
  readonly versionId: string;
  readonly procedureId: string;
  readonly versionNumber: number;
  readonly state: ProcedureVersionState;
  readonly controlName: string;
  readonly templateId: TemplateId;
  /** The Template pre-fill and any edit a later story saves, validated by the domain. */
  readonly sections: readonly DraftSection[];
  /** ISO 8601 UTC. */
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Reads Procedures and their versions for the surfaces. Outside any transaction. */
export interface ProcedureRepository {
  listProcedures(): Promise<readonly ProcedureSummary[]>;
  findProcedure(procedureId: string): Promise<ProcedureSummary | null>;
  listVersions(procedureId: string): Promise<readonly ProcedureVersionView[]>;
  findVersion(versionId: string): Promise<ProcedureVersionView | null>;
}

/** The full version row as one write, including the payload the domain validates. */
export interface ProcedureVersionRecord {
  readonly versionId: string;
  readonly procedureId: string;
  readonly versionNumber: number;
  readonly state: ProcedureVersionState;
  readonly controlName: string;
  readonly templateId: TemplateId;
  readonly sections: readonly DraftSection[];
}

/**
 * Writes a Procedure and its versions INSIDE the caller's transaction (AD-8).
 *
 * It takes a transaction handle, never a pool, so a Procedure cannot commit while the
 * `lifecycle.procedure-created` event that records it fails. `findVersion` is here as
 * well as on {@link ProcedureRepository} for the same reason the binding writer has its
 * own read: the row version an edit is checked against must be read on the connection
 * that writes, or a concurrent change lands between the read and the write and the
 * stale-tab guard is a suggestion.
 */
export interface ProcedureWriter {
  insertProcedure(record: ProcedureRecord): Promise<void>;
  insertVersion(record: ProcedureVersionRecord): Promise<void>;
  findVersion(versionId: string): Promise<ProcedureVersionRecord | null>;
  updateVersion(record: ProcedureVersionRecord): Promise<void>;
  /** Locks the version row for the read that precedes a guarded update. */
  findVersionForUpdate(versionId: string): Promise<ProcedureVersionRecord | null>;
  /** The highest version number a Procedure has, or 0 when it has none. */
  maxVersionNumber(procedureId: string): Promise<number>;
}

/** The Procedure row as one write. */
export interface ProcedureRecord {
  readonly procedureId: string;
  readonly controlName: string;
  readonly templateId: TemplateId;
}

/**
 * The unit of work the Procedure commands need: the audit writer plus the Procedure
 * writer, bound to the SAME transaction.
 *
 * Creation writes the Procedure row, the DRAFT version row and the audit event in one
 * transaction through this context — all three commit or none does. There is no other
 * writer to reach, which is what makes that a compile-time property rather than a rule
 * somebody has to remember.
 */
export interface ProceduresUnitOfWorkContext extends AuditUnitOfWorkContext {
  readonly procedures: ProcedureWriter;
}
