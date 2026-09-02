import {
  isPermittedReadAction,
  isTargetSystemKind,
  registrationDigest,
  type PermittedReadAction,
  type TargetSystemKind,
} from '@intellifin/domain';

import type { AuditUnitOfWork } from '../audit/ports.js';
import type { UuidV7Generator } from '../audit/clock.js';
import { authorizeCommand } from '../identity/authorize.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import {
  isRegistrationStatus,
  type CredentialProvider,
  type RegistrationRecord,
  type RegistrationStatus,
  type RegistrationsUnitOfWorkContext,
} from './ports.js';

/**
 * Registering and changing a Target System (FR-8, FR-45, AD-2, AD-7, AD-8).
 *
 * The order is the design, and it is the one `manage-users.ts` established:
 *
 *   1. authorize through {@link authorizeCommand}, which resolves the role afresh and
 *      audits the refusal itself, BEFORE any input is read;
 *   2. validate the input's shape;
 *   3. prove the credential is read-only — and refuse, audibly, when it is not or
 *      cannot be proven;
 *   4. compute the digest and write it, appending the event in the SAME transaction.
 *
 * Step 3 sits outside the transaction because nothing has been written yet: its refusal
 * event must COMMIT while the registration must not exist, and those are opposite
 * requirements for one transaction. Step 4's write and append share one, because a
 * registration that commits without its event is exactly the unaudited configuration
 * change FR-45 exists to prevent.
 *
 * No secret is anywhere in this file, and none can be: {@link CredentialProvider}
 * answers with a two-field report and the reference the caller already had.
 */

export const MANAGE_REGISTRATIONS_ACTION = 'administration.registrations.manage' as const;

/** Appended when a registration is created. */
export const REGISTRATION_CREATED_EVENT = 'configuration.registration-created' as const;

/**
 * `RegistrationChanged` — appended when one of the SIX digest-bearing fields moves.
 *
 * Epic 2 turns this event into a platform-authored draft for every Procedure Version
 * that froze the old digest. That is why a display-name edit does not produce one: it
 * would mint drafts for a change that alters nothing about what the agent may touch.
 */
export const REGISTRATION_CHANGED_EVENT = 'configuration.registration-changed' as const;

/**
 * Appended when a registration changes but NONE of the six digest-bearing fields move —
 * a display name, a note, or the retirement status.
 *
 * The spec said such a change "publishes nothing". That was written about
 * `RegistrationChanged`, whose only consumer is Epic 2's draft minting, and taken
 * literally it left a real hole: renaming or RETIRING a registration wrote a row and
 * appended no event at all, so a configuration change reached the database with nothing
 * in the chain that says who made it. FR-45 records configuration activity, and a
 * retirement is exactly the change an independent reviewer would ask about. So the
 * change is audited under its own event type, which Epic 2 does not read and therefore
 * cannot mint a draft from.
 */
export const REGISTRATION_ANNOTATED_EVENT = 'configuration.registration-annotated' as const;

/** Appended when a save is refused because the credential is not proven read-only. */
export const REGISTRATION_REFUSED_EVENT = 'configuration.registration-refused' as const;

/**
 * Bounds applied before anything else looks at a value. They are not cosmetic: an
 * unbounded list of origins is an unbounded row and an unbounded digest input.
 */
export const REGISTRATION_LIMITS = {
  displayName: 200,
  credentialRef: 400,
  applicationIdentity: 400,
  origin: 400,
  origins: 50,
  labelPattern: 200,
  labelPatterns: 100,
  secondaryKey: 200,
  note: 2000,
} as const;

/**
 * What an administrator is told. The first string is normative: the Story 1.6 contract
 * names it verbatim, and `denial-strings`-style tests hold it to the character.
 */
export const REGISTRATION_REFUSALS = {
  /**
   * The same sentence for "reports write access" and for "cannot be checked". A story
   * that treats "unknown" as "safe" is how a write-capable credential reaches
   * production, and the two carry the same risk from the auditor's position.
   */
  CREDENTIAL_NOT_READ_ONLY: 'Audit credentials must be read-only.',
  NAME_REQUIRED: 'Enter a display name.',
  KIND_INVALID: 'Choose a system kind.',
  ORIGIN_REQUIRED: 'Enter at least one allowed origin.',
  IDENTITY_REQUIRED: 'Enter the application identity.',
  CREDENTIAL_REQUIRED: 'Enter a credential reference.',
  ACTIONS_REQUIRED: 'Choose at least one permitted read action.',
  ACTION_NOT_READ_ONLY: 'Only read actions can be permitted.',
  STATUS_INVALID: 'Choose a status.',
  TOO_LONG: 'That value is longer than this field allows.',
  UNKNOWN_REGISTRATION: 'That registration no longer exists.',
  STALE_DIGEST:
    'That registration changed since this page was loaded. Reload the page and try again.',
} as const;

export type RegistrationOutcome<TDetail> =
  | ({ readonly ok: true } & TDetail)
  | { readonly ok: false; readonly reason: string };

export interface RegistrationDependencies {
  /** Resolves the ACTOR's role for the authorization check. Read on every call (AD-7). */
  readonly roles: RoleRepository;
  readonly credentials: CredentialProvider;
  readonly unitOfWork: AuditUnitOfWork<RegistrationsUnitOfWorkContext>;
  readonly ids: UuidV7Generator;
}

/** The six digest-bearing fields plus the three that are not. */
export interface RegistrationFields {
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
}

export interface RegisterTargetSystemInput extends RegistrationFields {
  readonly session: SessionSnapshot;
  readonly correlationId: string;
}

export interface ChangeTargetSystemInput extends RegisterTargetSystemInput {
  readonly registrationId: string;
  /**
   * The digest the surface rendered.
   *
   * Optimistic concurrency, and it is about the event as much as the write: a stale tab
   * that blind-overwrites produces a `RegistrationChanged` whose prior digest is a value
   * the administrator never saw, so the chain records a decision nobody made — and, once
   * Epic 2 reads these events, mints drafts from it. `undefined` skips the check; every
   * caller in this application states one.
   */
  readonly expectedDigest?: string | undefined;
}

export type RegisterTargetSystemResult = RegistrationOutcome<{
  readonly registrationId: string;
  readonly digest: string;
}>;

export type ChangeTargetSystemResult = RegistrationOutcome<{
  readonly registrationId: string;
  readonly digest: string;
  readonly priorDigest: string;
  /** `true` when one of the six moved and `RegistrationChanged` was published. */
  readonly published: boolean;
  /** `true` when a display name, note or status moved and the change was audited. */
  readonly annotated: boolean;
}>;

/**
 * A refusal raised from INSIDE the transaction, so the transaction rolls back.
 *
 * Returning it from the callback would commit whatever had already been written. This
 * is the lesson Story 1.5 paid for; it is repeated here rather than assumed.
 */
class CommandRefused extends Error {
  override readonly name = 'CommandRefused';
  readonly refusal: string;

  constructor(refusal: string) {
    super(refusal);
    this.refusal = refusal;
  }
}

function refuse(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

/** Trim, drop blanks. The domain module sorts and deduplicates; this only tidies input. */
function cleaned(values: readonly string[]): readonly string[] {
  return values.map((value) => value.trim()).filter((value) => value !== '');
}

/**
 * Everything that can be decided without touching a database or a provider.
 *
 * The kind decides which locator is required: a `desktop` system has an application
 * identity and no origins, and every other kind has at least one origin. Requiring both
 * would make three of the four kinds unregisterable; requiring neither would let a
 * registration name no system at all.
 */
export function validateRegistrationFields(fields: RegistrationFields): string | null {
  if (!isTargetSystemKind(fields.kind)) return REGISTRATION_REFUSALS.KIND_INVALID;
  if (!isRegistrationStatus(fields.status)) return REGISTRATION_REFUSALS.STATUS_INVALID;

  const displayName = fields.displayName.trim();
  if (displayName === '') return REGISTRATION_REFUSALS.NAME_REQUIRED;
  if (displayName.length > REGISTRATION_LIMITS.displayName) return REGISTRATION_REFUSALS.TOO_LONG;
  if (fields.note.length > REGISTRATION_LIMITS.note) return REGISTRATION_REFUSALS.TOO_LONG;
  if (fields.secondaryKey.length > REGISTRATION_LIMITS.secondaryKey) {
    return REGISTRATION_REFUSALS.TOO_LONG;
  }

  const credentialRef = fields.credentialRef.trim();
  if (credentialRef === '') return REGISTRATION_REFUSALS.CREDENTIAL_REQUIRED;
  if (credentialRef.length > REGISTRATION_LIMITS.credentialRef) {
    return REGISTRATION_REFUSALS.TOO_LONG;
  }

  if (fields.kind === 'desktop') {
    const identity = fields.applicationIdentity.trim();
    if (identity === '') return REGISTRATION_REFUSALS.IDENTITY_REQUIRED;
    if (identity.length > REGISTRATION_LIMITS.applicationIdentity) {
      return REGISTRATION_REFUSALS.TOO_LONG;
    }
  } else {
    const origins = cleaned(fields.allowedOrigins);
    if (origins.length === 0) return REGISTRATION_REFUSALS.ORIGIN_REQUIRED;
    if (origins.length > REGISTRATION_LIMITS.origins) return REGISTRATION_REFUSALS.TOO_LONG;
    if (origins.some((origin) => origin.length > REGISTRATION_LIMITS.origin)) {
      return REGISTRATION_REFUSALS.TOO_LONG;
    }
  }

  const patterns = cleaned(fields.attributeLabelPatterns);
  if (patterns.length > REGISTRATION_LIMITS.labelPatterns) return REGISTRATION_REFUSALS.TOO_LONG;
  if (patterns.some((pattern) => pattern.length > REGISTRATION_LIMITS.labelPattern)) {
    return REGISTRATION_REFUSALS.TOO_LONG;
  }

  if (fields.permittedActions.length === 0) return REGISTRATION_REFUSALS.ACTIONS_REQUIRED;
  // The type already excludes a write action; this is the same rule for a value that
  // arrived as request input, where the type is a comment.
  if (!fields.permittedActions.every(isPermittedReadAction)) {
    return REGISTRATION_REFUSALS.ACTION_NOT_READ_ONLY;
  }
  return null;
}

/** The stored shape, with the digest computed by the domain module and nowhere else. */
function toRecord(registrationId: string, fields: RegistrationFields): RegistrationRecord {
  const kind = fields.kind;
  const allowedOrigins = kind === 'desktop' ? [] : cleaned(fields.allowedOrigins);
  const applicationIdentity = kind === 'desktop' ? fields.applicationIdentity.trim() : '';
  const credentialRef = fields.credentialRef.trim();
  const permittedActions = [...new Set(fields.permittedActions)].sort();
  const attributeLabelPatterns = cleaned(fields.attributeLabelPatterns);
  const secondaryKey = fields.secondaryKey.trim();

  return {
    registrationId,
    displayName: fields.displayName.trim(),
    kind,
    allowedOrigins,
    applicationIdentity,
    credentialRef,
    permittedActions,
    attributeLabelPatterns,
    secondaryKey,
    note: fields.note.trim(),
    status: fields.status,
    digest: registrationDigest({
      kind,
      allowedOrigins,
      applicationIdentity,
      credentialRef,
      permittedActions,
      attributeLabelPatterns,
      secondaryKey,
    }),
  };
}

/** The six digest-bearing field names, for the audit payload. */
export const DIGEST_BEARING_FIELDS = [
  'allowedOrigins',
  'applicationIdentity',
  'attributeLabelPatterns',
  'credentialRef',
  'kind',
  'permittedActions',
  'secondaryKey',
] as const;

/** Which of the six moved. Empty means the digest cannot have moved. */
function changedDigestFields(
  before: RegistrationRecord,
  after: RegistrationRecord,
): readonly string[] {
  const same = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
  const changed: string[] = [];
  if (before.kind !== after.kind) changed.push('kind');
  if (!same(before.allowedOrigins, after.allowedOrigins)) changed.push('allowedOrigins');
  if (before.applicationIdentity !== after.applicationIdentity) changed.push('applicationIdentity');
  if (before.credentialRef !== after.credentialRef) changed.push('credentialRef');
  if (!same(before.permittedActions, after.permittedActions)) changed.push('permittedActions');
  if (!same(before.attributeLabelPatterns, after.attributeLabelPatterns)) {
    changed.push('attributeLabelPatterns');
  }
  if (before.secondaryKey !== after.secondaryKey) changed.push('secondaryKey');
  return changed;
}

/**
 * The three fields the digest does NOT cover.
 *
 * They are listed here rather than derived from "everything that is not one of the six"
 * so that a field added to `RegistrationRecord` by a later story is silently in neither
 * list and shows up as an unaudited write in review, instead of being folded into this
 * event with no thought about whether it belongs in the digest.
 */
export const NON_DIGEST_FIELDS = ['displayName', 'note', 'status'] as const;

/** Which of the three moved. Empty means nothing observable changed. */
function changedNonDigestFields(
  before: RegistrationRecord,
  after: RegistrationRecord,
): readonly string[] {
  const changed: string[] = [];
  if (before.displayName !== after.displayName) changed.push('displayName');
  if (before.note !== after.note) changed.push('note');
  if (before.status !== after.status) changed.push('status');
  return changed;
}

/**
 * Prove the credential is read-only, and audit the refusal when it is not.
 *
 * A provider that throws is treated exactly as one that answers `unknown`. Anything
 * else would make "the check was unavailable" a different outcome from "the check said
 * it could not tell", and the command would then have a path where an unproven
 * credential is stored because a network call failed.
 */
async function refuseUnlessReadOnly(
  dependencies: RegistrationDependencies,
  input: {
    readonly session: SessionSnapshot;
    readonly correlationId: string;
    readonly registrationId: string | null;
    readonly kind: TargetSystemKind;
    readonly credentialRef: string;
  },
): Promise<string | null> {
  let capability: 'write-capable' | 'unknown' | 'read-only';
  try {
    const report = await dependencies.credentials.describe(input.credentialRef);
    capability =
      report.capability === 'read-only'
        ? 'read-only'
        : report.capability === 'write-capable'
          ? 'write-capable'
          : 'unknown';
  } catch {
    capability = 'unknown';
  }
  if (capability === 'read-only') return null;

  // Its own unit of work: this event must COMMIT while nothing is stored. It is
  // appended before the refusal is returned, so a refused attempt is in the chain
  // whether it came from the interface or from a hand-made POST.
  await dependencies.unitOfWork.execute(({ auditEvents }) =>
    auditEvents.append({
      actor: { type: 'human', id: input.session.userId },
      eventType: REGISTRATION_REFUSED_EVENT,
      source: 'web',
      outcome: 'denied',
      sessionId: input.session.sessionId,
      correlationId: input.correlationId,
      // The reference itself is deliberately absent: it is opaque, it is not needed to
      // understand the refusal, and the chain is immutable — anything credential-shaped
      // that enters it can never be taken out again.
      payload: {
        registrationId: input.registrationId,
        kind: input.kind,
        capability,
        reason: REGISTRATION_REFUSALS.CREDENTIAL_NOT_READ_ONLY,
      },
    }),
  );
  return REGISTRATION_REFUSALS.CREDENTIAL_NOT_READ_ONLY;
}

/** Register a new Target System. One `configuration.registration-created` event. */
export async function registerTargetSystem(
  dependencies: RegistrationDependencies,
  input: RegisterTargetSystemInput,
): Promise<RegisterTargetSystemResult> {
  const { session, correlationId } = input;

  const decision = await authorizeCommand(
    { roles: dependencies.roles, unitOfWork: dependencies.unitOfWork },
    { session, action: MANAGE_REGISTRATIONS_ACTION, correlationId },
  );
  if (!decision.allowed) return refuse(decision.reason);

  const invalid = validateRegistrationFields(input);
  if (invalid !== null) return refuse(invalid);

  const refusal = await refuseUnlessReadOnly(dependencies, {
    session,
    correlationId,
    registrationId: null,
    kind: input.kind,
    credentialRef: input.credentialRef.trim(),
  });
  if (refusal !== null) return refuse(refusal);

  const record = toRecord(dependencies.ids.next(), input);

  return dependencies.unitOfWork.execute(
    async ({ auditEvents, registrations }): Promise<RegisterTargetSystemResult> => {
      await registrations.insertRegistration(record);
      await auditEvents.append({
        actor: { type: 'human', id: session.userId },
        eventType: REGISTRATION_CREATED_EVENT,
        source: 'web',
        outcome: 'success',
        sessionId: session.sessionId,
        correlationId,
        aggregateId: record.registrationId,
        payload: {
          registrationId: record.registrationId,
          displayName: record.displayName,
          kind: record.kind,
          priorDigest: null,
          newDigest: record.digest,
        },
      });
      return { ok: true, registrationId: record.registrationId, digest: record.digest };
    },
  );
}

/**
 * Change an existing registration.
 *
 * A change to one of the six digest-bearing fields recomputes the digest and publishes
 * `RegistrationChanged` in the same transaction. A change to anything else — the
 * display name, the note, the status — publishes nothing, because the digest covers
 * exactly six fields and an event that claims a registration changed when nothing the
 * agent may touch has changed would mint a platform-authored draft for every Procedure
 * that references it.
 */
export async function changeTargetSystem(
  dependencies: RegistrationDependencies,
  input: ChangeTargetSystemInput,
): Promise<ChangeTargetSystemResult> {
  const { session, correlationId, registrationId } = input;

  const decision = await authorizeCommand(
    { roles: dependencies.roles, unitOfWork: dependencies.unitOfWork },
    { session, action: MANAGE_REGISTRATIONS_ACTION, correlationId },
  );
  if (!decision.allowed) return refuse(decision.reason);

  if (registrationId.trim() === '') return refuse(REGISTRATION_REFUSALS.UNKNOWN_REGISTRATION);
  const invalid = validateRegistrationFields(input);
  if (invalid !== null) return refuse(invalid);

  const refusal = await refuseUnlessReadOnly(dependencies, {
    session,
    correlationId,
    registrationId,
    kind: input.kind,
    credentialRef: input.credentialRef.trim(),
  });
  if (refusal !== null) return refuse(refusal);

  const next = toRecord(registrationId, input);

  try {
    return await dependencies.unitOfWork.execute(
      async ({ auditEvents, registrations }): Promise<ChangeTargetSystemResult> => {
        // Read inside the transaction. The prior digest the event names must be the one
        // the write actually replaced, not one read a moment earlier on another
        // connection.
        const before = await registrations.findRegistration(registrationId);
        if (before === null) throw new CommandRefused(REGISTRATION_REFUSALS.UNKNOWN_REGISTRATION);
        if (input.expectedDigest !== undefined && before.digest !== input.expectedDigest) {
          throw new CommandRefused(REGISTRATION_REFUSALS.STALE_DIGEST);
        }

        const changed = changedDigestFields(before, next);
        const annotated = changedNonDigestFields(before, next);
        await registrations.updateRegistration(next);

        if (changed.length === 0) {
          // The digest cannot have moved, so there is nothing for Epic 2 to mint a draft
          // from. Asserted rather than assumed: a projection bug that changed the digest
          // without changing one of the six would otherwise pass silently.
          if (before.digest !== next.digest) {
            throw new Error('the digest moved without any of the six fields changing');
          }
          // A rename or a retirement is still a configuration change (FR-45), so it is
          // audited under its own event type. A save that moved nothing at all appends
          // nothing: there is no change to record, and an event per idle submit would
          // fill the chain with entries that say a person changed nothing.
          if (annotated.length > 0) {
            await auditEvents.append({
              actor: { type: 'human', id: session.userId },
              eventType: REGISTRATION_ANNOTATED_EVENT,
              source: 'web',
              outcome: 'success',
              sessionId: session.sessionId,
              correlationId,
              aggregateId: registrationId,
              payload: {
                registrationId,
                displayName: next.displayName,
                kind: next.kind,
                digest: next.digest,
                changedFields: [...annotated],
              },
            });
          }
          return {
            ok: true,
            registrationId,
            digest: next.digest,
            priorDigest: before.digest,
            published: false,
            annotated: annotated.length > 0,
          };
        }

        await auditEvents.append({
          actor: { type: 'human', id: session.userId },
          eventType: REGISTRATION_CHANGED_EVENT,
          source: 'web',
          outcome: 'success',
          sessionId: session.sessionId,
          correlationId,
          aggregateId: registrationId,
          payload: {
            registrationId,
            displayName: next.displayName,
            kind: next.kind,
            priorDigest: before.digest,
            newDigest: next.digest,
            changedFields: [...changed],
            // A save that moved an origin AND the display name is one change; both
            // halves belong in the one event, or the rename is lost.
            annotatedFields: [...annotated],
          },
        });

        return {
          ok: true,
          registrationId,
          digest: next.digest,
          priorDigest: before.digest,
          published: true,
          annotated: annotated.length > 0,
        };
      },
    );
  } catch (error) {
    if (error instanceof CommandRefused) return refuse(error.refusal);
    throw error;
  }
}
