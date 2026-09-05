import type {
  PermittedReadAction,
  TargetSystemKind,
} from '@intellifin/domain';

import type { AuditUnitOfWorkContext } from '../audit/ports.js';

/**
 * The registration ports this layer owns (FR-8, AD-1, AD-2, AD-10).
 *
 * Every type here is a plain value. No Drizzle row, no HTTP client and — the one that
 * matters most — no secret. `CredentialCapabilityReport` has exactly two fields and
 * neither of them can hold one, so "the web process never holds a credential" is a
 * property of the type rather than a rule somebody has to remember.
 */

/**
 * What a capability check concluded about a credential reference.
 *
 * `unknown` is not a third outcome to be handled leniently: the command refuses it with
 * the same sentence as `write-capable`. A credential that cannot be proven read-only is
 * not a credential proven read-only, and from the auditor's position the two carry the
 * same risk.
 */
export type CredentialCapability = 'read-only' | 'write-capable' | 'unknown';

/**
 * The provider's whole answer.
 *
 * Two fields, and they are the complete shape on purpose. There is no `secret`, no
 * `value`, no `token` and no `raw`.
 *
 * That is a rule the CALL SITE keeps, not one the type enforces — and the difference
 * matters, because the comment here used to claim the opposite. TypeScript's
 * excess-property check fires only on a fresh object literal assigned directly to an
 * annotated type; a class declared `implements CredentialProvider` whose `describe`
 * has an inferred return type is checked for assignability alone, so it can return a
 * third field and compile. `refuseUnlessReadOnly` therefore DESTRUCTURES the two
 * fields it needs and never holds the report, and
 * `register-target-system.test.ts` drives it with a provider that returns a secret
 * anyway and asserts the secret reaches neither the chain nor the row.
 */
export interface CredentialCapabilityReport {
  /**
   * The opaque reference that was checked, echoed back — and the command DOES match it
   * against the reference it asked about. An answer about something else is treated as
   * `unknown` and refused: a provider that batches, caches by a normalized key, or
   * resolves an alias can otherwise prove a different credential read-only.
   */
  readonly credentialRef: string;
  readonly capability: CredentialCapability;
}

/**
 * Answers what a credential reference may do, and NEVER hands over the credential.
 *
 * An implementation that cannot reach whatever holds the credential returns
 * `capability: 'unknown'`; it may also reject, and the command treats a rejection the
 * same way. Both paths fail closed.
 */
export interface CredentialProvider {
  describe(credentialRef: string): Promise<CredentialCapabilityReport>;
}

/** A registration's lifecycle state. There is no delete: retirement is a state (FR-8). */
export const REGISTRATION_STATUSES = ['active', 'retired'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export function isRegistrationStatus(value: unknown): value is RegistrationStatus {
  return (
    typeof value === 'string' && (REGISTRATION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * What the worker last observed about a Target System (AD-10).
 *
 * `never-probed` is a real state and the only one this release can produce: there is
 * nothing to probe until the synthetic Northstar systems arrive in Story 1.8. The web
 * process reads this and never fills it in — a probe from the web would be an outbound
 * call from the process that must not make one.
 */
export type ConnectivityState = 'never-probed' | 'reachable' | 'unreachable';

export interface RegistrationConnectivity {
  readonly state: ConnectivityState;
  /** ISO 8601 UTC of the observation, or `null` when there has never been one. */
  readonly observedAt: string | null;
}

/** The six digest-bearing fields plus everything the surface shows. */
export interface TargetSystemRegistration {
  readonly registrationId: string;
  readonly displayName: string;
  readonly kind: TargetSystemKind;
  readonly allowedOrigins: readonly string[];
  /** Empty for every kind but `desktop`. */
  readonly applicationIdentity: string;
  /** Opaque. It is not a secret and cannot be resolved to one from this layer. */
  readonly credentialRef: string;
  readonly permittedActions: readonly PermittedReadAction[];
  readonly attributeLabelPatterns: readonly string[];
  /** The empty string means the system has no secondary key. */
  readonly secondaryKey: string;
  /** Not digest-bearing: an operator note changes nothing about what may be read. */
  readonly note: string;
  readonly status: RegistrationStatus;
  /** The AD-2 digest, computed by the domain module and stored beside the row. */
  readonly digest: string;
  /** ISO 8601 UTC, as every boundary in this product uses. */
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly connectivity: RegistrationConnectivity;
}

/** Reads registrations for the surface. Outside any transaction; it changes nothing. */
export interface RegistrationRepository {
  listRegistrations(): Promise<readonly TargetSystemRegistration[]>;
  /**
   * Every ACTIVE registration, for a surface that selects from them (the Builder).
   *
   * NOT a filter over `listRegistrations`: that read is capped at
   * `REGISTRATION_LIST_LIMIT` and includes retired rows, so filtering its result would
   * silently drop live systems past the cap — the same trap the probe sweep hit. A
   * selectable-systems read is active-only and unpaged; every eligible system is offered.
   */
  listActiveRegistrations(): Promise<readonly TargetSystemRegistration[]>;
  findRegistration(registrationId: string): Promise<TargetSystemRegistration | null>;
}

/** The digest-bearing fields plus the ones that are not, as one write. */
export interface RegistrationRecord {
  readonly registrationId: string;
  readonly displayName: string;
  readonly kind: TargetSystemKind;
  readonly allowedOrigins: readonly string[];
  readonly applicationIdentity: string;
  readonly credentialRef: string;
  readonly permittedActions: readonly PermittedReadAction[];
  readonly attributeLabelPatterns: readonly string[];
  readonly secondaryKey: string;
  readonly note: string;
  readonly status: RegistrationStatus;
  readonly digest: string;
}

/**
 * A registration-owned read that a Procedure command resolves a Target System selection
 * through (AD-2, AD-8).
 *
 * `procedures` must never read the registration table itself, exactly as it never reads
 * the Population Source table — it goes through this port the way it goes through
 * {@link PopulationSourceReader}. The read is under a SHARE lock and in a STABLE (sorted)
 * id order: a Draft can select several systems at once, and two concurrent saves locking
 * overlapping sets in different orders would deadlock, so the lock order is the id order
 * and never the order the auditor happened to select them in.
 */
export interface TargetSystemRegistrationReader {
  /**
   * The named registrations, each held under a shared lock until the caller's transaction
   * finishes, read in ascending id order. Ids that resolve to no row are simply absent
   * from the result; the command decides what a missing selection means.
   */
  lockForSelection(registrationIds: readonly string[]): Promise<readonly RegistrationRecord[]>;
}

/**
 * Writes a registration INSIDE the caller's transaction (AD-8).
 *
 * It takes a transaction handle, never a pool, so a registration cannot commit while
 * the `RegistrationChanged` event that records it fails. `findRegistration` is here as
 * well as on {@link RegistrationRepository} for the same reason the role writer has its
 * own read: the prior digest an event names must be read on the connection that writes
 * the new one, or a concurrent change lands in between and the chain records a
 * transition that never happened.
 */
export interface RegistrationWriter {
  findRegistration(registrationId: string): Promise<RegistrationRecord | null>;
  insertRegistration(record: RegistrationRecord): Promise<void>;
  updateRegistration(record: RegistrationRecord): Promise<void>;
}

/**
 * Bounds how long the application will wait for an outward call.
 *
 * It is a port because `packages/application` has no ambient host types — deliberately,
 * since that absence is what stops `process.env` typechecking here (AD-11) — so there is
 * no `setTimeout` to reach for and no clock to read. The command owns the POLICY (how
 * long is too long); infrastructure owns the MECHANISM.
 *
 * It is a required dependency rather than an optional wrapper so an implementer cannot
 * leave it out: without a deadline, a credential provider that never answers parks a
 * request handler with nothing in the log to say why.
 */
export interface DeadlinePort {
  /** Reject when `work` has not settled within `milliseconds`. */
  within<T>(work: Promise<T>, milliseconds: number): Promise<T>;
}

/** Distinct Procedures with Active versions referencing this registration/source identity. */
export interface ReferencingProcedureCounter {
  countReferencing(id: string, kind?: 'registration' | 'source'): Promise<number>;
}

/**
 * The unit of work the registration commands need: the audit writer plus the
 * registration writer, bound to the SAME transaction.
 *
 * This is what makes "the change and its event commit together, or neither does" a
 * compile-time property. A command cannot reach a writer outside the transaction,
 * because there is no other writer to reach.
 */
export interface RegistrationsUnitOfWorkContext extends AuditUnitOfWorkContext {
  readonly procedureChanges?: import('../procedures/configuration-change-ports.js').ProcedureChangeHandler;
  readonly registrations: RegistrationWriter;
}
