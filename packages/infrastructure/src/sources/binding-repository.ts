import { asc, eq } from 'drizzle-orm';

import { isUuidText } from '../db/identifier.js';

import type {
  BindingRecord,
  BindingRepository,
  BindingStatus,
  BindingWriter,
  PopulationSourceBinding,
  PopulationSourceReader,
} from '@intellifin/application';
import { isBindingStatus } from '@intellifin/application';
import {
  isDeclaredCountMechanism,
  isPopulationSourceKind,
  type DeclaredCountMechanism,
  type PopulationSourceKind,
} from '@intellifin/domain';

import type { Database, Transaction } from '../db/client.js';
import { populationSourceBinding } from '../db/schema.js';

/**
 * The Population Source binding read and write adapters (FR-6, FR-41, AD-8).
 *
 * Nothing here computes a digest. The column is written with the value the domain module
 * produced and read back as it was stored; recomputing it on read would be a second
 * implementation of the number a Procedure Version freezes.
 *
 * Nothing here acquires a population either. There is no file read, no HTTP call and no
 * upload handling in this file or anywhere under `apps/` — this story registers the
 * BINDING, and Epic 2's Adapters acquire against it.
 */

/**
 * How many bindings the surface renders.
 *
 * An unbounded `SELECT` is a query whose cost is set by the data rather than by the code.
 * The surface says when it truncated; paging is its own story.
 */
export const BINDING_LIST_LIMIT = 200;

const SELECTION = {
  bindingId: populationSourceBinding.bindingId,
  displayName: populationSourceBinding.displayName,
  kind: populationSourceBinding.kind,
  location: populationSourceBinding.location,
  declaredSchema: populationSourceBinding.declaredSchema,
  declaredCountMechanism: populationSourceBinding.declaredCountMechanism,
  sensitiveFields: populationSourceBinding.sensitiveFields,
  note: populationSourceBinding.note,
  status: populationSourceBinding.status,
  digest: populationSourceBinding.digest,
  createdAt: populationSourceBinding.createdAt,
  updatedAt: populationSourceBinding.updatedAt,
} as const;

interface SelectedRow {
  bindingId: string;
  displayName: string;
  kind: string;
  location: string;
  declaredSchema: string[];
  declaredCountMechanism: string;
  sensitiveFields: string[];
  note: string;
  status: string;
  digest: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A value outside the vocabulary is read as nothing, never as "some kind".
 *
 * The CHECK constraints make these unreachable through this application; they are here
 * for the row a future migration, a restored dump or a psql session could leave behind.
 * `versioned-file` is not a safe default for an unrecognized kind, and `cover-sheet` is
 * emphatically not a safe default for an unrecognized count mechanism — it would present
 * a binding no Procedure may submit against as one that may. The row is dropped from the
 * list instead: a binding nobody can interpret must not be shown as one that has been.
 */
function toBinding(row: SelectedRow): PopulationSourceBinding | null {
  if (!isPopulationSourceKind(row.kind)) return null;
  if (!isDeclaredCountMechanism(row.declaredCountMechanism)) return null;
  if (!isBindingStatus(row.status)) return null;
  return {
    bindingId: row.bindingId,
    displayName: row.displayName,
    kind: row.kind satisfies PopulationSourceKind,
    location: row.location,
    declaredSchema: row.declaredSchema,
    declaredCountMechanism: row.declaredCountMechanism satisfies DeclaredCountMechanism,
    sensitiveFields: row.sensitiveFields,
    note: row.note,
    status: row.status satisfies BindingStatus,
    digest: row.digest,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Reads bindings for the surface. Outside any transaction; it changes nothing. */
export class DrizzleBindingRepository implements BindingRepository {
  constructor(
    private readonly db: Database,
    private readonly limit: number = BINDING_LIST_LIMIT,
  ) {}

  async listBindings(): Promise<readonly PopulationSourceBinding[]> {
    const rows = await this.db
      .select(SELECTION)
      .from(populationSourceBinding)
      .orderBy(
        asc(populationSourceBinding.displayName),
        asc(populationSourceBinding.bindingId),
      )
      .limit(this.limit);
    return rows
      .map(toBinding)
      .filter((binding): binding is PopulationSourceBinding => binding !== null);
  }

  async listActiveBindings(): Promise<readonly PopulationSourceBinding[]> {
    const rows = await this.db.select(SELECTION).from(populationSourceBinding)
      .where(eq(populationSourceBinding.status, 'active'))
      .orderBy(asc(populationSourceBinding.displayName), asc(populationSourceBinding.bindingId))
      .limit(this.limit);
    return rows.map(toBinding).filter((binding): binding is PopulationSourceBinding => binding !== null);
  }

  async findBinding(bindingId: string): Promise<PopulationSourceBinding | null> {
    // A malformed id is absence, not a 500: PostgreSQL raises 22P02 comparing a
    // `uuid` column against text that is not one, and this id comes from a URL.
    if (!isUuidText(bindingId)) return null;
    const rows = await this.db
      .select(SELECTION)
      .from(populationSourceBinding)
      .where(eq(populationSourceBinding.bindingId, bindingId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return toBinding(row);
  }
}

/** Source-owned read: Procedures never imports or queries the source table. */
export class DrizzlePopulationSourceReader implements PopulationSourceReader {
  constructor(private readonly transaction: Transaction) {}
  async findBindingForShare(bindingId: string): Promise<BindingRecord | null> {
    if (!isUuidText(bindingId)) return null;
    const rows = await this.transaction.select(SELECTION).from(populationSourceBinding)
      .where(eq(populationSourceBinding.bindingId, bindingId)).for('share').limit(1);
    const row = rows[0];
    return row === undefined ? null : toBinding(row);
  }
}

/**
 * The binding write, bound to ONE transaction (FR-45, AD-8).
 *
 * It takes a {@link Transaction}, not a `Database`, and that is the guarantee: there is
 * no way to construct this writer outside a unit of work, so a binding cannot commit
 * while the `configuration.binding-changed` event that records it fails.
 */
export class DrizzleBindingWriter implements BindingWriter {
  constructor(private readonly transaction: Transaction) {}

  async findBinding(bindingId: string): Promise<BindingRecord | null> {
    // A malformed id is absence, not a 500: PostgreSQL raises 22P02 comparing a
    // `uuid` column against text that is not one, and this id comes from a URL.
    if (!isUuidText(bindingId)) return null;
    const rows = await this.transaction
      .select(SELECTION)
      .from(populationSourceBinding)
      .where(eq(populationSourceBinding.bindingId, bindingId))
      // The row is about to be updated and its digest is about to be named as the prior
      // value in an immutable event. Locking it makes a concurrent change queue instead
      // of landing between this read and the write — which is what makes the row-version
      // guard a guard rather than a suggestion.
      .for('update')
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const binding = toBinding(row);
    if (binding === null) return null;
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...record } = binding;
    return record;
  }

  async insertBinding(record: BindingRecord): Promise<void> {
    await this.transaction.insert(populationSourceBinding).values({
      bindingId: record.bindingId,
      displayName: record.displayName,
      kind: record.kind,
      location: record.location,
      declaredSchema: [...record.declaredSchema],
      declaredCountMechanism: record.declaredCountMechanism,
      sensitiveFields: [...record.sensitiveFields],
      note: record.note,
      status: record.status,
      digest: record.digest,
    });
  }

  async updateBinding(record: BindingRecord): Promise<void> {
    await this.transaction
      .update(populationSourceBinding)
      .set({
        displayName: record.displayName,
        kind: record.kind,
        location: record.location,
        declaredSchema: [...record.declaredSchema],
        declaredCountMechanism: record.declaredCountMechanism,
        sensitiveFields: [...record.sensitiveFields],
        note: record.note,
        status: record.status,
        digest: record.digest,
        updatedAt: new Date(),
      })
      .where(eq(populationSourceBinding.bindingId, record.bindingId));
  }
}
