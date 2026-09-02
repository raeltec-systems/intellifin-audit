'use server';

import { revalidatePath } from 'next/cache';

import {
  changeTargetSystem,
  isRegistrationStatus,
  registerTargetSystem,
  type RegistrationDependencies,
  type RegistrationFields,
} from '@intellifin/application';
import { isPermittedReadAction, isTargetSystemKind } from '@intellifin/domain';
import {
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresRegistrationsUnitOfWork,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../../src/bootstrap';
import { currentCorrelationId, requireServerAction } from '../../../src/server-session';

/**
 * The Target System registration mutations, as Server Actions (FR-8, FR-45).
 *
 * **Each one authorizes first, before it reads its input.** A Server Action is not
 * protected by the page it was written beside: Next exposes it as its own POST endpoint
 * addressed by an id that appears in the client bundle, so reaching the page is not a
 * precondition for invoking it. The page's `requireServerAction` protects the page; this
 * file is the attacker's surface, and `actions.test.ts` asserts the refusals here.
 *
 * **The argument is untrusted.** `RegistrationFormFields` is TypeScript, which is to say
 * a comment as far as a hand-made POST is concerned. A body carrying `null`, a number or
 * an array of numbers would reach the command typed as a string and throw on the first
 * `.trim()`, answering a framework 500 to the caller most likely to be probing. Every
 * field is therefore checked for shape and bounded for length here, at the boundary.
 *
 * No credential value passes through this file. The only credential-related value it
 * handles is an opaque reference, and the capability check that decides whether it may
 * be used happens inside the command, through a port that cannot return a secret.
 */

export type RegistrationActionResult =
  | { readonly ok: true; readonly message: string; readonly registrationId: string }
  | { readonly ok: false; readonly reason: string };

/** Said when the command threw. It never names a driver, a table or a host. */
const UNAVAILABLE = 'The change could not be saved. Nothing was changed.';

/** Said when the request was not the shape this action accepts. One sentence for all. */
const MALFORMED = 'That request was not valid. Nothing was changed.';

/** Ceilings applied before anything else looks at the value. */
const MAX = {
  displayName: 200,
  credentialRef: 400,
  applicationIdentity: 400,
  secondaryKey: 200,
  note: 2000,
  listItems: 100,
  listItem: 400,
  registrationId: 64,
  digest: 64,
  /** A vocabulary word, not free text. Both are re-checked against the closed list. */
  vocabulary: 32,
} as const;

/** The id shape this application mints: a UUID v7 from `CryptoUuidV7Generator`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function boundedList(value: unknown, maxItems: number, maxItem: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((entry) => typeof entry === 'string' && entry.length <= maxItem)
  );
}

/** What a form posts. Every field is a string or a list of strings; nothing is optional. */
export interface RegistrationFormFields {
  readonly displayName: string;
  readonly kind: string;
  readonly allowedOrigins: readonly string[];
  readonly applicationIdentity: string;
  readonly credentialRef: string;
  readonly permittedActions: readonly string[];
  readonly attributeLabelPatterns: readonly string[];
  readonly secondaryKey: string;
  readonly note: string;
  readonly status: string;
}

function isRegistrationFormFields(input: unknown): input is RegistrationFormFields {
  if (typeof input !== 'object' || input === null) return false;
  const fields = input as Record<string, unknown>;
  return (
    boundedString(fields['displayName'], MAX.displayName) &&
    // Bounded, like every other field. This file's rule is "shape AND length", and
    // these two were shape only — harmless today, since the vocabulary check rejects
    // anything long, but the comment was not true of the code.
    boundedString(fields['kind'], MAX.vocabulary) &&
    boundedList(fields['allowedOrigins'], MAX.listItems, MAX.listItem) &&
    boundedString(fields['applicationIdentity'], MAX.applicationIdentity) &&
    boundedString(fields['credentialRef'], MAX.credentialRef) &&
    boundedList(fields['permittedActions'], MAX.listItems, MAX.listItem) &&
    boundedList(fields['attributeLabelPatterns'], MAX.listItems, MAX.listItem) &&
    boundedString(fields['secondaryKey'], MAX.secondaryKey) &&
    boundedString(fields['note'], MAX.note) &&
    boundedString(fields['status'], MAX.vocabulary)
  );
}

/**
 * Turn the posted strings into the command's types, or `null`.
 *
 * The vocabulary checks happen HERE as well as in the command. That is not duplication
 * for its own sake: the command's input type says `PermittedReadAction[]`, and a posted
 * array of arbitrary strings would satisfy that type at compile time while carrying
 * `create-record` at run time. This is where a string stops being one.
 */
function toRegistrationFields(fields: RegistrationFormFields): RegistrationFields | null {
  if (!isTargetSystemKind(fields.kind)) return null;
  if (!isRegistrationStatus(fields.status)) return null;
  if (!fields.permittedActions.every(isPermittedReadAction)) return null;
  return {
    displayName: fields.displayName,
    kind: fields.kind,
    allowedOrigins: fields.allowedOrigins,
    applicationIdentity: fields.applicationIdentity,
    credentialRef: fields.credentialRef,
    permittedActions: fields.permittedActions,
    attributeLabelPatterns: fields.attributeLabelPatterns,
    secondaryKey: fields.secondaryKey,
    note: fields.note,
    status: fields.status,
  };
}

async function dependencies(): Promise<RegistrationDependencies> {
  const runtime = await getRuntime();
  return {
    roles: new DrizzleRoleRepository(runtime.db),
    credentials: runtime.credentials,
    deadlines: runtime.deadlines,
    unitOfWork: new PostgresRegistrationsUnitOfWork(runtime.db),
    ids: new CryptoUuidV7Generator(),
  };
}

/** Report a failure and refuse. The person gets one sentence; the operator gets the error. */
async function unavailable(
  message: 'Register Target System failed' | 'Change Target System failed',
  error: unknown,
  correlationId: string,
): Promise<RegistrationActionResult> {
  try {
    const runtime = await getRuntime();
    runtime.telemetry.captureError(message, error, { outcome: 'failure', correlationId });
  } catch {
    // The runtime is what failed. `instrumentation.ts` reported that at boot.
  }
  return { ok: false, reason: UNAVAILABLE };
}

/** Register a Target System. One `configuration.registration-created` event. */
export async function createRegistrationAction(
  fields: RegistrationFormFields,
): Promise<RegistrationActionResult> {
  const decision = await requireServerAction('administration.registrations.manage');
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  if (!isRegistrationFormFields(fields)) return { ok: false, reason: MALFORMED };
  const typed = toRegistrationFields(fields);
  if (typed === null) return { ok: false, reason: MALFORMED };

  const correlationId = await currentCorrelationId();

  try {
    const outcome = await registerTargetSystem(await dependencies(), {
      ...typed,
      session: decision.session,
      correlationId,
    });
    if (!outcome.ok) return outcome;

    revalidatePath('/administration/registrations');
    return {
      ok: true,
      registrationId: outcome.registrationId,
      message: `Registered ${typed.displayName.trim()}. Its digest is ${outcome.digest}.`,
    };
  } catch (error) {
    return unavailable('Register Target System failed', error, correlationId);
  }
}

export interface ChangeRegistrationFormFields extends RegistrationFormFields {
  readonly registrationId: string;
  /**
   * The version of the whole row the surface rendered. Optimistic concurrency; see the
   * command. It was the digest, which covers six of the row's ten fields and therefore
   * could not protect a retirement from being silently reverted by a stale tab.
   */
  readonly expectedRowVersion: string;
}

/**
 * Change a Target System. A digest-bearing change publishes
 * `configuration.registration-changed` in the same transaction; anything else publishes
 * nothing.
 */
export async function changeRegistrationAction(
  fields: ChangeRegistrationFormFields,
): Promise<RegistrationActionResult> {
  const decision = await requireServerAction('administration.registrations.manage');
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  if (!isRegistrationFormFields(fields)) return { ok: false, reason: MALFORMED };
  // Shape, not just length. This value reaches an audit payload on the refusal path,
  // and payload strings are not held to `SAFE_ID_PATTERN` the way `aggregateId` is — so
  // without this an administrator could write 64 arbitrary characters into the
  // immutable chain, presented in review as a registration id.
  if (!isUuid((fields as { registrationId?: unknown }).registrationId)) {
    return { ok: false, reason: MALFORMED };
  }
  if (
    !boundedString((fields as { expectedRowVersion?: unknown }).expectedRowVersion, MAX.digest)
  ) {
    return { ok: false, reason: MALFORMED };
  }
  const typed = toRegistrationFields(fields);
  if (typed === null) return { ok: false, reason: MALFORMED };

  const correlationId = await currentCorrelationId();

  try {
    const outcome = await changeTargetSystem(await dependencies(), {
      ...typed,
      session: decision.session,
      correlationId,
      registrationId: fields.registrationId,
      expectedRowVersion: fields.expectedRowVersion,
    });
    if (!outcome.ok) return outcome;

    revalidatePath('/administration/registrations');
    revalidatePath(`/administration/registrations/${fields.registrationId}`);
    return {
      ok: true,
      registrationId: outcome.registrationId,
      message: outcome.published
        ? `Saved. The digest is now ${outcome.digest}, and the change is recorded in the audit chain.`
        : outcome.annotated
          ? 'Saved. The digest did not change, so no Procedure is affected. The change is recorded in the audit chain.'
          : 'Saved. Nothing changed.',
    };
  } catch (error) {
    return unavailable('Change Target System failed', error, correlationId);
  }
}
