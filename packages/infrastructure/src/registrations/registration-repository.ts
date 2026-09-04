import { asc, eq, inArray } from 'drizzle-orm';

import { isUuidText } from '../db/identifier.js';

import type {
  ReferencingProcedureCounter,
  RegistrationConnectivity,
  RegistrationRecord,
  RegistrationRepository,
  RegistrationStatus,
  RegistrationWriter,
  TargetSystemRegistration,
  TargetSystemRegistrationReader,
} from '@intellifin/application';
import { isRegistrationStatus } from '@intellifin/application';
import {
  isPermittedReadAction,
  isTargetSystemKind,
  type PermittedReadAction,
  type TargetSystemKind,
} from '@intellifin/domain';

import type { Database, Transaction } from '../db/client.js';
import { targetSystemProbe, targetSystemRegistration } from '../db/schema.js';

/**
 * The registration read and write adapters (FR-8, AD-8, AD-10).
 *
 * Nothing here computes a digest. The column is written with the value the domain module
 * produced and read back as it was stored; recomputing it on read would be a second
 * implementation of the number a Procedure Version freezes.
 *
 * Nothing here contacts a Target System either. The connectivity column is a LEFT JOIN
 * onto rows the worker writes, so "the web never probes" is what the code can do rather
 * than what it happens to do.
 */

/**
 * How many registrations the surface renders.
 *
 * An unbounded `SELECT` is a query whose cost is set by the data rather than by the
 * code. The surface says when it truncated; paging is its own story.
 */
export const REGISTRATION_LIST_LIMIT = 200;

const SELECTION = {
  registrationId: targetSystemRegistration.registrationId,
  displayName: targetSystemRegistration.displayName,
  kind: targetSystemRegistration.kind,
  allowedOrigins: targetSystemRegistration.allowedOrigins,
  applicationIdentity: targetSystemRegistration.applicationIdentity,
  credentialRef: targetSystemRegistration.credentialRef,
  permittedActions: targetSystemRegistration.permittedActions,
  attributeLabelPatterns: targetSystemRegistration.attributeLabelPatterns,
  secondaryKey: targetSystemRegistration.secondaryKey,
  note: targetSystemRegistration.note,
  status: targetSystemRegistration.status,
  digest: targetSystemRegistration.digest,
  createdAt: targetSystemRegistration.createdAt,
  updatedAt: targetSystemRegistration.updatedAt,
} as const;

interface SelectedRow {
  registrationId: string;
  displayName: string;
  kind: string;
  allowedOrigins: string[];
  applicationIdentity: string;
  credentialRef: string;
  permittedActions: string[];
  attributeLabelPatterns: string[];
  secondaryKey: string;
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
 * `web` is not a safe default for an unrecognized kind, so the row is dropped from the
 * list instead — a registration nobody can interpret must not be shown as one that has
 * been interpreted.
 */
function toRegistration(
  row: SelectedRow,
  connectivity: RegistrationConnectivity,
): TargetSystemRegistration | null {
  if (!isTargetSystemKind(row.kind)) return null;
  if (!isRegistrationStatus(row.status)) return null;
  if (!row.permittedActions.every(isPermittedReadAction)) return null;
  return {
    registrationId: row.registrationId,
    displayName: row.displayName,
    kind: row.kind satisfies TargetSystemKind,
    allowedOrigins: row.allowedOrigins,
    applicationIdentity: row.applicationIdentity,
    credentialRef: row.credentialRef,
    permittedActions: row.permittedActions as readonly PermittedReadAction[],
    attributeLabelPatterns: row.attributeLabelPatterns,
    secondaryKey: row.secondaryKey,
    note: row.note,
    status: row.status satisfies RegistrationStatus,
    digest: row.digest,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    connectivity,
  };
}

const NEVER_PROBED: RegistrationConnectivity = { state: 'never-probed', observedAt: null };

function toConnectivity(
  probe: { state: string | null; observedAt: Date | null } | null,
): RegistrationConnectivity {
  if (probe === null || probe.state === null || probe.observedAt === null) return NEVER_PROBED;
  if (probe.state !== 'reachable' && probe.state !== 'unreachable') return NEVER_PROBED;
  return { state: probe.state, observedAt: probe.observedAt.toISOString() };
}

/** Reads registrations and the connectivity the worker last wrote. Never probes. */
export class DrizzleRegistrationRepository implements RegistrationRepository {
  constructor(
    private readonly db: Database,
    private readonly limit: number = REGISTRATION_LIST_LIMIT,
  ) {}

  /**
   * Every ACTIVE registration, unpaged, with only what a probe needs.
   *
   * NOT `listRegistrations`. That is the surface's read: it is capped at
   * `REGISTRATION_LIST_LIMIT` and it includes retired rows, because a person looking at
   * a page wants a page and wants to see what was retired. A sweep that borrowed it
   * inherited both. With 201 retired registrations ahead of them alphabetically, every
   * live system fell off the end of the page — the sweep probed nothing, exited 0, and
   * every one of them went on saying "Never probed" for ever.
   *
   * A background job and a screen want different reads. This is the job's.
   */
  async listActiveProbeTargets(): Promise<
    readonly {
      readonly registrationId: string;
      readonly displayName: string;
      readonly allowedOrigins: readonly string[];
    }[]
  > {
    const rows = await this.db
      .select({
        registrationId: targetSystemRegistration.registrationId,
        displayName: targetSystemRegistration.displayName,
        allowedOrigins: targetSystemRegistration.allowedOrigins,
      })
      .from(targetSystemRegistration)
      .where(eq(targetSystemRegistration.status, 'active'))
      .orderBy(asc(targetSystemRegistration.registrationId));
    return rows.map((row) => ({
      registrationId: row.registrationId,
      displayName: row.displayName,
      allowedOrigins: [...row.allowedOrigins],
    }));
  }

  async listRegistrations(): Promise<readonly TargetSystemRegistration[]> {
    const rows = await this.db
      .select({
        ...SELECTION,
        probeState: targetSystemProbe.state,
        probeObservedAt: targetSystemProbe.observedAt,
      })
      .from(targetSystemRegistration)
      .leftJoin(
        targetSystemProbe,
        eq(targetSystemProbe.registrationId, targetSystemRegistration.registrationId),
      )
      .orderBy(asc(targetSystemRegistration.displayName), asc(targetSystemRegistration.registrationId))
      .limit(this.limit);
    return rows
      .map((row) =>
        toRegistration(row, toConnectivity({ state: row.probeState, observedAt: row.probeObservedAt })),
      )
      .filter((registration): registration is TargetSystemRegistration => registration !== null);
  }

  /**
   * Every ACTIVE registration, for the Builder's Target System picker.
   *
   * Active-only and its own limit, NOT a filter over `listRegistrations`. Retired rows
   * cannot be newly selected — a Draft that names one keeps it as a retained snapshot, it
   * does not pick it fresh — and a filter over the surface read would silently drop live
   * systems past its 200-row cap. A screen and a picker want different reads.
   */
  async listActiveRegistrations(): Promise<readonly TargetSystemRegistration[]> {
    const rows = await this.db
      .select({
        ...SELECTION,
        probeState: targetSystemProbe.state,
        probeObservedAt: targetSystemProbe.observedAt,
      })
      .from(targetSystemRegistration)
      .leftJoin(
        targetSystemProbe,
        eq(targetSystemProbe.registrationId, targetSystemRegistration.registrationId),
      )
      .where(eq(targetSystemRegistration.status, 'active'))
      .orderBy(asc(targetSystemRegistration.displayName), asc(targetSystemRegistration.registrationId))
      .limit(this.limit);
    return rows
      .map((row) =>
        toRegistration(row, toConnectivity({ state: row.probeState, observedAt: row.probeObservedAt })),
      )
      .filter((registration): registration is TargetSystemRegistration => registration !== null);
  }

  async findRegistration(registrationId: string): Promise<TargetSystemRegistration | null> {
    // A malformed id is absence, not a 500: PostgreSQL raises 22P02 comparing a
    // `uuid` column against text that is not one, and this id comes from a URL.
    if (!isUuidText(registrationId)) return null;
    const rows = await this.db
      .select({
        ...SELECTION,
        probeState: targetSystemProbe.state,
        probeObservedAt: targetSystemProbe.observedAt,
      })
      .from(targetSystemRegistration)
      .leftJoin(
        targetSystemProbe,
        eq(targetSystemProbe.registrationId, targetSystemRegistration.registrationId),
      )
      .where(eq(targetSystemRegistration.registrationId, registrationId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return toRegistration(
      row,
      toConnectivity({ state: row.probeState, observedAt: row.probeObservedAt }),
    );
  }
}

/**
 * The registration write, bound to ONE transaction (FR-45, AD-8).
 *
 * It takes a {@link Transaction}, not a `Database`, and that is the guarantee: there is
 * no way to construct this writer outside a unit of work, so a registration cannot
 * commit while the `RegistrationChanged` event that records it fails.
 */
export class DrizzleRegistrationWriter implements RegistrationWriter {
  constructor(private readonly transaction: Transaction) {}

  async findRegistration(registrationId: string): Promise<RegistrationRecord | null> {
    // A malformed id is absence, not a 500: PostgreSQL raises 22P02 comparing a
    // `uuid` column against text that is not one, and this id comes from a URL.
    if (!isUuidText(registrationId)) return null;
    const rows = await this.transaction
      .select(SELECTION)
      .from(targetSystemRegistration)
      .where(eq(targetSystemRegistration.registrationId, registrationId))
      // The row is about to be updated and its digest is about to be named as the prior
      // value in an immutable event. Locking it makes a concurrent change queue instead
      // of landing between this read and the write.
      .for('update')
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const registration = toRegistration(row, NEVER_PROBED);
    if (registration === null) return null;
    const { createdAt: _createdAt, updatedAt: _updatedAt, connectivity: _connectivity, ...record } =
      registration;
    return record;
  }

  async insertRegistration(record: RegistrationRecord): Promise<void> {
    await this.transaction.insert(targetSystemRegistration).values({
      registrationId: record.registrationId,
      displayName: record.displayName,
      kind: record.kind,
      allowedOrigins: [...record.allowedOrigins],
      applicationIdentity: record.applicationIdentity,
      credentialRef: record.credentialRef,
      permittedActions: [...record.permittedActions],
      attributeLabelPatterns: [...record.attributeLabelPatterns],
      secondaryKey: record.secondaryKey,
      note: record.note,
      status: record.status,
      digest: record.digest,
    });
  }

  async updateRegistration(record: RegistrationRecord): Promise<void> {
    await this.transaction
      .update(targetSystemRegistration)
      .set({
        displayName: record.displayName,
        kind: record.kind,
        allowedOrigins: [...record.allowedOrigins],
        applicationIdentity: record.applicationIdentity,
        credentialRef: record.credentialRef,
        permittedActions: [...record.permittedActions],
        attributeLabelPatterns: [...record.attributeLabelPatterns],
        secondaryKey: record.secondaryKey,
        note: record.note,
        status: record.status,
        digest: record.digest,
        updatedAt: new Date(),
      })
      .where(eq(targetSystemRegistration.registrationId, record.registrationId));
  }
}

/**
 * The registration-owned read a Procedure command resolves a Target selection through
 * (AD-2, AD-8).
 *
 * It takes a {@link Transaction}, never a pool: the selection is resolved and the Draft is
 * written in one transaction, and the rows are held under a SHARE lock until it finishes so
 * a concurrent change to a registration cannot land between the read and the write. The
 * lock order is ascending id — deterministic, never the order the auditor selected — so two
 * saves locking overlapping sets queue instead of deadlocking, the same discipline
 * `DrizzleRoleWriter.lockHolders` uses.
 */
export class DrizzleTargetSystemRegistrationReader implements TargetSystemRegistrationReader {
  constructor(private readonly transaction: Transaction) {}

  async lockForSelection(registrationIds: readonly string[]): Promise<readonly RegistrationRecord[]> {
    // A malformed id is not a row; comparing a `uuid` column against non-uuid text raises
    // 22P02, and these ids arrive from request input.
    const ids = [...new Set(registrationIds.filter(isUuidText))];
    if (ids.length === 0) return [];
    const rows = await this.transaction
      .select(SELECTION)
      .from(targetSystemRegistration)
      .where(inArray(targetSystemRegistration.registrationId, ids))
      .orderBy(asc(targetSystemRegistration.registrationId))
      .for('share');
    return rows
      .map((row) => {
        const registration = toRegistration(row, NEVER_PROBED);
        if (registration === null) return null;
        const { createdAt: _c, updatedAt: _u, connectivity: _n, ...record } = registration;
        return record;
      })
      .filter((record): record is RegistrationRecord => record !== null);
  }
}

/**
 * How many Procedure Versions reference a registration: zero, until Epic 2 exists.
 *
 * It is an adapter rather than a literal `0` at the call site so that the surface is
 * already wired to a port. When Procedures arrive, one class is replaced and the
 * confirmation warning starts appearing without the surface being touched.
 */
export class NoProcedureReferences implements ReferencingProcedureCounter {
  async countReferencing(): Promise<number> {
    return 0;
  }
}
