import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';

import { isUuidText } from '../db/identifier.js';

import type {
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
import {
  auditRun,
  procedureVersion,
  runResult,
  targetSystemProbe,
  targetSystemRegistration,
} from '../db/schema.js';

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
  authenticationDestination: targetSystemRegistration.authenticationDestination,
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
  authenticationDestination: string | null;
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
    ...(row.authenticationDestination === null
      ? {}
      : { authenticationDestination: row.authenticationDestination }),
    note: row.note,
    status: row.status satisfies RegistrationStatus,
    digest: row.digest,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    connectivity,
  };
}

/**
 * The Run states a Run can no longer leave (`audit_run_state`, addendum §E).
 *
 * Only these count as audit activity: a Run still queued or running has observed
 * nothing yet, and listing one as the system's last activity would tell an operator a
 * test finished when it has not started.
 */
const TERMINAL_RUN_STATES = ['COMPLETED', 'INCONCLUSIVE', 'RUN_FAILED', 'CANCELED'] as const;

/** The one Run this system was last used by, as the Administration surface shows it. */
export interface RegistrationAuditActivity {
  readonly runId: string;
  /** The Procedure name the Run froze, so the surface names a control and not a UUID. */
  readonly procedureName: string;
  /** One of {@link TERMINAL_RUN_STATES}. */
  readonly state: string;
  readonly initiatedAt: string;
  /** When the Run stopped, from its sealed Result; null when no Result can be read. */
  readonly endedAt: string | null;
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
   * Active-only and unpaged, NOT a filter over `listRegistrations`. Retired rows
   * cannot be newly selected — a Draft that names one keeps it as a retained snapshot, it
   * does not pick it fresh — and a filter over the surface read would silently drop live
   * systems past its 200-row cap. The picker must offer every eligible registration.
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
      .orderBy(asc(targetSystemRegistration.displayName), asc(targetSystemRegistration.registrationId));
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

  /**
   * How many registrations there are, EXACTLY (UI cleanup 2026-09-22, UX-37).
   *
   * Not `(await listRegistrations()).length`: that read is capped at
   * `REGISTRATION_LIST_LIMIT`, so a summary built from it would say "200 systems" for
   * ever once a deployment passed two hundred — a number that is wrong in the one place
   * an operator goes to find out how much there is. A `count(*)` answers the question
   * that was asked.
   */
  async countRegistrations(): Promise<number> {
    const rows = await this.db.select({ total: count() }).from(targetSystemRegistration);
    return rows[0]?.total ?? 0;
  }

  /**
   * The most recent Run that FINISHED against this system (UI cleanup 2026-09-22, UX-44).
   *
   * The connectivity column answers "has a worker ever reached this address", and a
   * system that has served a whole completed audit still reads `never-probed` there,
   * because no probe sweep has run in this deployment. The walkthrough met that as "No
   * worker has observed this system yet" on a system a Run had just used — a statement
   * about the environment that the environment contradicts. These are two facts, so
   * there are two reads: this is the second.
   *
   * A registration id appears in the FROZEN `targets` of the Procedure Version a Run
   * executed, which is the only record that survives a later change to the registration
   * — `audit_run` names its version, the version froze which systems it would use, and
   * neither can be rewritten afterwards. Terminal Runs only: a Run still going has not
   * observed anything yet, and reporting it as activity would make a queued Run look
   * like a finished audit.
   *
   * One row, ordered by the Run's own identifier as the tiebreak, so the answer is
   * deterministic when two Runs share an instant. `endedAt` is the Result's seal — the
   * moment the Run stopped — and is null for a terminal Run whose Result cannot be read,
   * which the surface says rather than substituting the start time silently.
   */
  async lastAuditActivity(registrationId: string): Promise<RegistrationAuditActivity | null> {
    // A malformed id is absence, not a 500: PostgreSQL raises 22P02 comparing a `uuid`
    // column against text that is not one, and this id comes from a URL.
    if (!isUuidText(registrationId)) return null;
    const rows = await this.db
      .select({
        runId: auditRun.runId,
        procedureName: auditRun.procedureName,
        state: auditRun.state,
        initiatedAt: auditRun.initiatedAt,
        endedAt: runResult.sealedAt,
      })
      .from(auditRun)
      .innerJoin(procedureVersion, eq(procedureVersion.versionId, auditRun.versionId))
      .leftJoin(runResult, eq(runResult.runId, auditRun.runId))
      .where(
        and(
          inArray(auditRun.state, [...TERMINAL_RUN_STATES]),
          sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${procedureVersion.targets}) target WHERE target->>'registrationId' = ${registrationId})`,
        ),
      )
      .orderBy(desc(auditRun.initiatedAt), desc(auditRun.runId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      runId: row.runId,
      procedureName: row.procedureName,
      state: row.state,
      initiatedAt: row.initiatedAt.toISOString(),
      endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
    };
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
      authenticationDestination: record.authenticationDestination ?? null,
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
        authenticationDestination: record.authenticationDestination ?? null,
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
