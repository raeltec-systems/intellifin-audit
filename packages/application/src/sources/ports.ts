import type { DeclaredCountMechanism, PopulationSourceKind } from '@intellifin/domain';

import type { AuditUnitOfWorkContext } from '../audit/ports.js';

/**
 * The Population Source binding ports this layer owns (FR-6, FR-41, AD-1, AD-8).
 *
 * Every type here is a plain value: no Drizzle row, no HTTP client, no file handle and
 * no credential. That last one is the point of the story's "no credential here" rule —
 * a `read-only-api` binding NAMES a location and nothing more. The credential a Run uses
 * belongs to the Target System registration, which already proves it read-only, and a
 * credential field on this surface would be a second place a reference lives and a
 * second place the read-only proof would have to be repeated. There is nowhere in these
 * types to put one.
 *
 * Nothing here acquires a population either. Acquisition, parsing, upload handling and
 * snapshots belong to Epic 2 and the Adapters; this layer registers the BINDING.
 */

/** A binding's lifecycle state. There is no delete: retirement is a state. */
export const BINDING_STATUSES = ['active', 'retired'] as const;
export type BindingStatus = (typeof BINDING_STATUSES)[number];

export function isBindingStatus(value: unknown): value is BindingStatus {
  return typeof value === 'string' && (BINDING_STATUSES as readonly string[]).includes(value);
}

/** The five digest-bearing fields plus everything the surface shows. */
export interface PopulationSourceBinding {
  readonly bindingId: string;
  readonly displayName: string;
  readonly kind: PopulationSourceKind;
  /** Empty for a `manual-upload` binding, which names nowhere. */
  readonly location: string;
  /** Field names, IN ORDER: a schema is a positional declaration. */
  readonly declaredSchema: readonly string[];
  readonly declaredCountMechanism: DeclaredCountMechanism;
  /** A set, and always a subset of {@link PopulationSourceBinding.declaredSchema}. */
  readonly sensitiveFields: readonly string[];
  /** Not digest-bearing: an operator note changes nothing about the population contract. */
  readonly note: string;
  readonly status: BindingStatus;
  /** The binding digest, computed by the domain module and stored beside the row. */
  readonly digest: string;
  /** ISO 8601 UTC, as every boundary in this product uses. */
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Reads bindings for the surface. Outside any transaction; it changes nothing. */
export interface BindingRepository {
  listBindings(): Promise<readonly PopulationSourceBinding[]>;
  /** Filter active rows before applying the surface limit. */
  listActiveBindings(): Promise<readonly PopulationSourceBinding[]>;
  findBinding(bindingId: string): Promise<PopulationSourceBinding | null>;
}

/** Source-owned contract read, held stable until the caller's transaction finishes. */
export interface PopulationSourceReader {
  findBindingForShare(bindingId: string): Promise<BindingRecord | null>;
}

/** The digest-bearing fields plus the ones that are not, as one write. */
export interface BindingRecord {
  readonly bindingId: string;
  readonly displayName: string;
  readonly kind: PopulationSourceKind;
  readonly location: string;
  readonly declaredSchema: readonly string[];
  readonly declaredCountMechanism: DeclaredCountMechanism;
  readonly sensitiveFields: readonly string[];
  readonly note: string;
  readonly status: BindingStatus;
  readonly digest: string;
}

/**
 * Writes a binding INSIDE the caller's transaction (AD-8).
 *
 * It takes a transaction handle, never a pool, so a binding cannot commit while the
 * `configuration.binding-changed` event that records it fails. `findBinding` is here as
 * well as on {@link BindingRepository} for the same reason the registration writer has
 * its own read: the prior digest an event names must be read on the connection that
 * writes the new one, or a concurrent change lands in between and the chain records a
 * transition that never happened.
 */
export interface BindingWriter {
  findBinding(bindingId: string): Promise<BindingRecord | null>;
  insertBinding(record: BindingRecord): Promise<void>;
  updateBinding(record: BindingRecord): Promise<void>;
}

/**
 * The unit of work the binding commands need: the audit writer plus the binding writer,
 * bound to the SAME transaction.
 *
 * This is what makes "the change and its event commit together, or neither does" a
 * compile-time property. A command cannot reach a writer outside the transaction,
 * because there is no other writer to reach.
 */
export interface SourcesUnitOfWorkContext extends AuditUnitOfWorkContext {
  readonly procedureChanges?: import('../procedures/configuration-change-ports.js').ProcedureChangeHandler;
  readonly bindings: BindingWriter;
}
