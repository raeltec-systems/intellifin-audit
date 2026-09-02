import {
  bindingDigest,
  canonicalJson,
  isDeclaredCountMechanism,
  isPopulationSourceKind,
  sensitiveFieldsAreDeclared,
  sha256Hex,
  type DeclaredCountMechanism,
  type JsonValue,
  type PopulationSourceKind,
} from '@intellifin/domain';

import type { AuditUnitOfWork } from '../audit/ports.js';
import type { UuidV7Generator } from '../audit/clock.js';
import { authorizeCommand } from '../identity/authorize.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import {
  isBindingStatus,
  type BindingRecord,
  type BindingStatus,
  type SourcesUnitOfWorkContext,
} from './ports.js';

/**
 * Registering and changing a Population Source binding (FR-6, FR-41, FR-45, AD-7, AD-8).
 *
 * The order is Story 1.6's, and it is the design:
 *
 *   1. authorize through {@link authorizeCommand}, which resolves the role afresh and
 *      audits the refusal itself, BEFORE any input is read;
 *   2. validate the input's shape;
 *   3. compute the digest and write it, appending the event in the SAME transaction.
 *
 * There is no step between 2 and 3 here, because there is nothing outward to ask. A
 * binding names a location; it does not hold a credential and this command contacts
 * nothing. That absence is deliberate — see `ports.ts`.
 *
 * Step 3's write and append share one transaction, because a binding that commits
 * without its event is exactly the unaudited configuration change FR-45 exists to
 * prevent.
 */

/**
 * The gated action.
 *
 * It is `administration.bindings.manage` and NOT `administration.sources.manage`. The
 * story spec names the latter, but the gating table in
 * `packages/domain/src/identity/roles.ts` is transcribed character for character from
 * EXPERIENCE.md's "Roles and Action Gating" and already carries
 * `administration.bindings.manage` — UX-DR39's "only the PoC Administrator manages
 * users, registrations, bindings, diagnostics". Adding a second action for the same
 * surface would put two names in a table whose completeness is itself asserted
 * (`roles.test.ts` checks all 24 actions against all 3 roles), so the contract wins over
 * the spec's paraphrase.
 */
export const MANAGE_BINDINGS_ACTION = 'administration.bindings.manage' as const;

/** Appended when a binding is created. */
export const BINDING_CREATED_EVENT = 'configuration.binding-created' as const;

/**
 * Appended when one of the FIVE digest-bearing fields moves.
 *
 * Epic 2 turns this event into a platform-authored draft for every Procedure Version
 * that froze the old digest. That is why a display-name edit does not produce one: it
 * would mint drafts for a change that alters nothing about the population contract.
 */
export const BINDING_CHANGED_EVENT = 'configuration.binding-changed' as const;

/**
 * Appended when a binding changes but NONE of the five move — a display name, a note, or
 * the retirement status.
 *
 * A rename and a retirement are both configuration changes (FR-45), and a retirement is
 * exactly the change an independent reviewer would ask about. They are audited under
 * their own event type, which Epic 2 does not read and therefore cannot mint a draft
 * from. Story 1.6 shipped without this and had to add it; it is here from the start.
 */
export const BINDING_ANNOTATED_EVENT = 'configuration.binding-annotated' as const;

/**
 * Bounds applied before anything else looks at a value. They are not cosmetic: an
 * unbounded schema is an unbounded row and an unbounded digest input.
 */
export const BINDING_LIMITS = {
  displayName: 200,
  location: 1000,
  fieldName: 200,
  schemaFields: 200,
  sensitiveFields: 200,
  note: 2000,
} as const;

/** What an administrator is told. One sentence each, naming the thing it protects. */
export const BINDING_REFUSALS = {
  NAME_REQUIRED: 'Enter a display name.',
  KIND_INVALID: 'Choose a binding kind.',
  LOCATION_REQUIRED: 'Enter where the population is found.',
  SCHEMA_REQUIRED: 'Enter at least one declared field name.',
  MECHANISM_INVALID: 'Choose how the expected record count is declared.',
  /**
   * FR-41. A mask over a field the schema does not declare masks nothing while reading,
   * in a list view, exactly like protection — so it is refused rather than stored and
   * quietly ignored.
   */
  SENSITIVE_NOT_DECLARED: 'A sensitive field must be one of the declared schema fields.',
  STATUS_INVALID: 'Choose a status.',
  TOO_LONG: 'That value is longer than this field allows.',
  UNKNOWN_BINDING: 'That binding no longer exists.',
  /**
   * A value with no canonical form — today, only an unpaired Unicode surrogate. It
   * cannot be stored: the driver would encode it with U+FFFD substitution, so the row
   * would hold something the digest was not taken over, permanently and silently. A
   * refusal, not a 500: it arrives through a Server Action, which any administrator can
   * post to by hand.
   */
  NOT_STORABLE: 'That value contains a character this system cannot store.',
  /**
   * Story 1.6's stale-row sentence, with the noun changed.
   *
   * The spec says "refused with the Story 1.6 sentence", and this is that sentence about
   * this object. UX-DR38 requires every guard sentence to name the object it protects,
   * and a binding surface that says "that registration changed" names the wrong one.
   */
  STALE_ROW: 'That binding changed since this page was loaded. Reload the page and try again.',
} as const;

export type BindingOutcome<TDetail> =
  | ({ readonly ok: true } & TDetail)
  | { readonly ok: false; readonly reason: string };

export interface BindingDependencies {
  /** Resolves the ACTOR's role for the authorization check. Read on every call (AD-7). */
  readonly roles: RoleRepository;
  readonly unitOfWork: AuditUnitOfWork<SourcesUnitOfWorkContext>;
  readonly ids: UuidV7Generator;
}

/** The five digest-bearing fields plus the three that are not. */
export interface BindingFields {
  readonly displayName: string;
  readonly kind: PopulationSourceKind;
  readonly location: string;
  readonly declaredSchema: readonly string[];
  readonly declaredCountMechanism: DeclaredCountMechanism;
  readonly sensitiveFields: readonly string[];
  readonly note: string;
  readonly status: BindingStatus;
}

export interface RegisterPopulationSourceInput extends BindingFields {
  readonly session: SessionSnapshot;
  readonly correlationId: string;
}

export interface ChangePopulationSourceInput extends RegisterPopulationSourceInput {
  readonly bindingId: string;
  /**
   * The version of the WHOLE row the surface rendered. Required, never optional.
   *
   * Optimistic concurrency, and it covers all ten of the row's fields rather than the
   * five the digest covers. Story 1.6 paid for that lesson: with the digest as the
   * token, `displayName`, `note` and `status` were exactly the fields it could not
   * protect, so one administrator retiring a binding and a second saving a note from an
   * older tab silently set the status back to `active` — a revert of the control that
   * stops a binding being used, by somebody who never saw the retirement.
   *
   * It is also about the EVENT: a stale tab that blind-overwrites produces a
   * `configuration.binding-changed` whose prior digest is a value the administrator
   * never saw, so the chain records a decision nobody made.
   */
  readonly expectedRowVersion: string;
}

export type RegisterPopulationSourceResult = BindingOutcome<{
  readonly bindingId: string;
  readonly digest: string;
  /** `true` when the binding declares no expected count and no Procedure can submit. */
  readonly declaresNoCount: boolean;
}>;

export type ChangePopulationSourceResult = BindingOutcome<{
  readonly bindingId: string;
  readonly digest: string;
  readonly priorDigest: string;
  /** `true` when one of the five moved and `configuration.binding-changed` was published. */
  readonly published: boolean;
  /** `true` when a display name, note or status moved and the change was audited. */
  readonly annotated: boolean;
  readonly declaresNoCount: boolean;
}>;

/**
 * A refusal raised from INSIDE the transaction, so the transaction rolls back.
 *
 * Returning it from the callback would COMMIT whatever had already been written. This is
 * the lesson Story 1.5 paid for and Story 1.6 repeated rather than assumed; so does this.
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

/** Trim, drop blanks, keep the order and the duplicates. */
function cleaned(values: readonly string[]): readonly string[] {
  return values.map((value) => value.trim()).filter((value) => value !== '');
}

/**
 * The declared schema as the domain module hashes it: trimmed, blank-free, deduplicated,
 * ORDER PRESERVED.
 *
 * The stored column must be this and not the list that was typed, or the row and the
 * digest disagree about duplicates: typing one field twice and later removing the
 * duplicate would change the stored array without moving the digest, and the change
 * command would then publish `binding-changed` with priorDigest === newDigest — an
 * immutable event asserting a transition that did not happen.
 */
function listOf(values: readonly string[]): readonly string[] {
  return [...new Set(cleaned(values))];
}

/** The sensitive fields as the domain module hashes them: the same, then sorted. */
function setOf(values: readonly string[]): readonly string[] {
  return [...listOf(values)].sort();
}

/**
 * Everything that can be decided without touching a database.
 *
 * The kind decides whether a location is required: a `manual-upload` binding names
 * nowhere, because the file arrives with the Run, and every other kind must name
 * somewhere or the binding points at nothing.
 */
export function validateBindingFields(fields: BindingFields): string | null {
  if (!isPopulationSourceKind(fields.kind)) return BINDING_REFUSALS.KIND_INVALID;
  if (!isDeclaredCountMechanism(fields.declaredCountMechanism)) {
    return BINDING_REFUSALS.MECHANISM_INVALID;
  }
  if (!isBindingStatus(fields.status)) return BINDING_REFUSALS.STATUS_INVALID;

  const displayName = fields.displayName.trim();
  if (displayName === '') return BINDING_REFUSALS.NAME_REQUIRED;
  if (displayName.length > BINDING_LIMITS.displayName) return BINDING_REFUSALS.TOO_LONG;
  if (fields.note.length > BINDING_LIMITS.note) return BINDING_REFUSALS.TOO_LONG;

  if (fields.kind !== 'manual-upload') {
    const location = fields.location.trim();
    if (location === '') return BINDING_REFUSALS.LOCATION_REQUIRED;
    if (location.length > BINDING_LIMITS.location) return BINDING_REFUSALS.TOO_LONG;
  }

  const schema = cleaned(fields.declaredSchema);
  if (schema.length === 0) return BINDING_REFUSALS.SCHEMA_REQUIRED;
  if (schema.length > BINDING_LIMITS.schemaFields) return BINDING_REFUSALS.TOO_LONG;
  if (schema.some((field) => field.length > BINDING_LIMITS.fieldName)) {
    return BINDING_REFUSALS.TOO_LONG;
  }

  const sensitive = cleaned(fields.sensitiveFields);
  if (sensitive.length > BINDING_LIMITS.sensitiveFields) return BINDING_REFUSALS.TOO_LONG;
  if (sensitive.some((field) => field.length > BINDING_LIMITS.fieldName)) {
    return BINDING_REFUSALS.TOO_LONG;
  }
  // FR-41: a mask over a field that does not exist masks nothing and reads as protection.
  if (
    !sensitiveFieldsAreDeclared({
      declaredSchema: fields.declaredSchema,
      sensitiveFields: fields.sensitiveFields,
    })
  ) {
    return BINDING_REFUSALS.SENSITIVE_NOT_DECLARED;
  }

  // Every string that will be hashed or stored, checked in one place. The canonicalizer
  // refuses what it cannot represent, and this turns that refusal into a sentence
  // instead of a framework 500 for the caller most likely to be probing.
  const storable = [
    fields.displayName,
    fields.location,
    fields.note,
    ...fields.declaredSchema,
    ...fields.sensitiveFields,
  ];
  try {
    for (const value of storable) canonicalJson(value);
  } catch {
    return BINDING_REFUSALS.NOT_STORABLE;
  }
  return null;
}

/** The stored shape, with the digest computed by the domain module and nowhere else. */
function toRecord(bindingId: string, fields: BindingFields): BindingRecord {
  const kind = fields.kind;
  // A manual upload names nowhere, so the location is cleared rather than carried: a
  // value typed before the kind was switched must not reach the row or the digest.
  const location = kind === 'manual-upload' ? '' : fields.location.trim();
  const declaredSchema = listOf(fields.declaredSchema);
  const sensitiveFields = setOf(fields.sensitiveFields);

  return {
    bindingId,
    displayName: fields.displayName.trim(),
    kind,
    location,
    declaredSchema,
    declaredCountMechanism: fields.declaredCountMechanism,
    sensitiveFields,
    note: fields.note.trim(),
    status: fields.status,
    digest: bindingDigest({
      kind,
      location,
      declaredSchema,
      declaredCountMechanism: fields.declaredCountMechanism,
      sensitiveFields,
    }),
  };
}

/**
 * A version token over the WHOLE row: every field a save would replace.
 *
 * Deliberately not the binding digest and deliberately not `updated_at`. The digest is a
 * frozen contract about the population and must not change when a note does; `now()` is
 * a transaction timestamp, which two concurrent transactions are not guaranteed to
 * disagree about. This is a hash of the values themselves, so it moves when — and only
 * when — something a save would replace has moved.
 *
 * The digest is NOT in the token, because it is derived from five of the fields that
 * are: including it would make the token no stronger and would couple it to the digest
 * function, which is the coupling Story 1.6's defect came from.
 *
 * It is not a security boundary and needs none: it is the same class of value as an
 * ETag. It uses the shared canonicalizer so that array order and unicode escaping cannot
 * make one caller compute a different token from the same row.
 */
export function bindingRowVersion(record: BindingRecord): string {
  return sha256Hex(
    canonicalJson({
      bindingId: record.bindingId,
      declaredCountMechanism: record.declaredCountMechanism,
      declaredSchema: [...record.declaredSchema],
      displayName: record.displayName,
      kind: record.kind,
      location: record.location,
      note: record.note,
      sensitiveFields: [...record.sensitiveFields],
      status: record.status,
    } as unknown as JsonValue),
  );
}

/** The five digest-bearing field names, for the audit payload. */
export const DIGEST_BEARING_BINDING_FIELDS = [
  'declaredCountMechanism',
  'declaredSchema',
  'kind',
  'location',
  'sensitiveFields',
] as const;

/**
 * The three fields the digest does NOT cover.
 *
 * Listed here rather than derived from "everything that is not one of the five" so that
 * a field added to `BindingRecord` by a later story is silently in neither list and
 * shows up as an unaudited write in review, instead of being folded into this event with
 * no thought about whether it belongs in the digest.
 */
export const NON_DIGEST_BINDING_FIELDS = ['displayName', 'note', 'status'] as const;

/** An ordered comparison. The declared schema is a list, so position is a difference. */
function sameOrdered(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** An unordered comparison, each side sorted ONCE. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

/** Which of the five moved. Empty means the digest cannot have moved. */
function changedDigestFields(before: BindingRecord, after: BindingRecord): readonly string[] {
  const changed: string[] = [];
  if (before.kind !== after.kind) changed.push('kind');
  if (before.location !== after.location) changed.push('location');
  if (!sameOrdered(before.declaredSchema, after.declaredSchema)) changed.push('declaredSchema');
  if (before.declaredCountMechanism !== after.declaredCountMechanism) {
    changed.push('declaredCountMechanism');
  }
  if (!sameSet(before.sensitiveFields, after.sensitiveFields)) changed.push('sensitiveFields');
  return changed;
}

/** Which of the three moved. Empty means nothing observable changed. */
function changedNonDigestFields(before: BindingRecord, after: BindingRecord): readonly string[] {
  const changed: string[] = [];
  if (before.displayName !== after.displayName) changed.push('displayName');
  if (before.note !== after.note) changed.push('note');
  if (before.status !== after.status) changed.push('status');
  return changed;
}

/** Register a new Population Source binding. One `configuration.binding-created` event. */
export async function registerPopulationSource(
  dependencies: BindingDependencies,
  input: RegisterPopulationSourceInput,
): Promise<RegisterPopulationSourceResult> {
  const { session, correlationId } = input;

  const decision = await authorizeCommand(
    { roles: dependencies.roles, unitOfWork: dependencies.unitOfWork },
    { session, action: MANAGE_BINDINGS_ACTION, correlationId },
  );
  if (!decision.allowed) return refuse(decision.reason);

  const invalid = validateBindingFields(input);
  if (invalid !== null) return refuse(invalid);

  const record = toRecord(dependencies.ids.next(), input);

  return dependencies.unitOfWork.execute(
    async ({ auditEvents, bindings }): Promise<RegisterPopulationSourceResult> => {
      await bindings.insertBinding(record);
      await auditEvents.append({
        actor: { type: 'human', id: session.userId },
        eventType: BINDING_CREATED_EVENT,
        source: 'web',
        outcome: 'success',
        sessionId: session.sessionId,
        correlationId,
        aggregateId: record.bindingId,
        payload: {
          bindingId: record.bindingId,
          displayName: record.displayName,
          kind: record.kind,
          declaredCountMechanism: record.declaredCountMechanism,
          priorDigest: null,
          newDigest: record.digest,
        },
      });
      return {
        ok: true,
        bindingId: record.bindingId,
        digest: record.digest,
        declaresNoCount: record.declaredCountMechanism === 'none',
      };
    },
  );
}

/**
 * Change an existing binding.
 *
 * A change to one of the five digest-bearing fields recomputes the digest and publishes
 * `configuration.binding-changed` in the same transaction. A change to the display name,
 * the note or the status publishes `configuration.binding-annotated` instead. A save that
 * moves nothing publishes nothing: an event per idle submit would fill the chain with
 * entries saying a person changed nothing.
 */
export async function changePopulationSource(
  dependencies: BindingDependencies,
  input: ChangePopulationSourceInput,
): Promise<ChangePopulationSourceResult> {
  const { session, correlationId, bindingId } = input;

  const decision = await authorizeCommand(
    { roles: dependencies.roles, unitOfWork: dependencies.unitOfWork },
    { session, action: MANAGE_BINDINGS_ACTION, correlationId },
  );
  if (!decision.allowed) return refuse(decision.reason);

  if (bindingId.trim() === '') return refuse(BINDING_REFUSALS.UNKNOWN_BINDING);
  const invalid = validateBindingFields(input);
  if (invalid !== null) return refuse(invalid);

  const next = toRecord(bindingId, input);

  try {
    return await dependencies.unitOfWork.execute(
      async ({ auditEvents, bindings }): Promise<ChangePopulationSourceResult> => {
        // Read inside the transaction. The prior digest the event names must be the one
        // the write actually replaced, not one read a moment earlier on another
        // connection.
        const before = await bindings.findBinding(bindingId);
        if (before === null) throw new CommandRefused(BINDING_REFUSALS.UNKNOWN_BINDING);
        if (bindingRowVersion(before) !== input.expectedRowVersion) {
          throw new CommandRefused(BINDING_REFUSALS.STALE_ROW);
        }

        const changed = changedDigestFields(before, next);
        const annotated = changedNonDigestFields(before, next);
        // Both directions, because each has a way of being wrong on its own. This one
        // catches a stored column that disagrees with what the digest hashed, which is
        // how Story 1.6's `RegistrationChanged` came to be publishable with
        // priorDigest === newDigest.
        if (changed.length > 0 && before.digest === next.digest) {
          throw new Error('a digest-bearing field changed without moving the digest');
        }
        // A save that moves nothing writes nothing. The UPDATE was unconditional,
        // so an idle submit still moved `updated_at` — a binding whose
        // "Last changed" said somebody changed it, with no event anywhere saying who
        // or what. The honest record of a change that did not happen is silence.
        if (changed.length > 0 || annotated.length > 0) {
          await bindings.updateBinding(next);
        }

        const declaresNoCount = next.declaredCountMechanism === 'none';

        if (changed.length === 0) {
          // The converse: a projection bug that moved the digest with none of the five
          // changed would otherwise pass silently and mint drafts over nothing.
          if (before.digest !== next.digest) {
            throw new Error('the digest moved without any of the five fields changing');
          }
          if (annotated.length > 0) {
            await auditEvents.append({
              actor: { type: 'human', id: session.userId },
              eventType: BINDING_ANNOTATED_EVENT,
              source: 'web',
              outcome: 'success',
              sessionId: session.sessionId,
              correlationId,
              aggregateId: bindingId,
              payload: {
                bindingId,
                displayName: next.displayName,
                kind: next.kind,
                digest: next.digest,
                changedFields: [...annotated],
              },
            });
          }
          return {
            ok: true,
            bindingId,
            digest: next.digest,
            priorDigest: before.digest,
            published: false,
            annotated: annotated.length > 0,
            declaresNoCount,
          };
        }

        await auditEvents.append({
          actor: { type: 'human', id: session.userId },
          eventType: BINDING_CHANGED_EVENT,
          source: 'web',
          outcome: 'success',
          sessionId: session.sessionId,
          correlationId,
          aggregateId: bindingId,
          payload: {
            bindingId,
            displayName: next.displayName,
            kind: next.kind,
            declaredCountMechanism: next.declaredCountMechanism,
            priorDigest: before.digest,
            newDigest: next.digest,
            changedFields: [...changed],
            // A save that moved a location AND the display name is one change; both
            // halves belong in the one event, or the rename is lost.
            annotatedFields: [...annotated],
          },
        });

        return {
          ok: true,
          bindingId,
          digest: next.digest,
          priorDigest: before.digest,
          published: true,
          annotated: annotated.length > 0,
          declaresNoCount,
        };
      },
    );
  } catch (error) {
    if (error instanceof CommandRefused) return refuse(error.refusal);
    throw error;
  }
}
