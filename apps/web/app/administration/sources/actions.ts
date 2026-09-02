'use server';

import { revalidatePath } from 'next/cache';

import {
  changePopulationSource,
  isBindingStatus,
  registerPopulationSource,
  type BindingDependencies,
  type BindingFields,
} from '@intellifin/application';
import { isDeclaredCountMechanism, isPopulationSourceKind } from '@intellifin/domain';
import {
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresSourcesUnitOfWork,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../../src/bootstrap';
import { currentCorrelationId, requireServerAction } from '../../../src/server-session';

/**
 * The Population Source binding mutations, as Server Actions (FR-6, FR-41, FR-45).
 *
 * **Each one authorizes first, before it reads its input.** A Server Action is not
 * protected by the page it was written beside: Next exposes it as its own POST endpoint
 * addressed by an id that appears in the client bundle, so reaching the page is not a
 * precondition for invoking it. The page's `requireServerAction` protects the page; this
 * file is the attacker's surface, and `actions.test.ts` asserts the refusals here.
 *
 * **The argument is untrusted.** `BindingFormFields` is TypeScript, which is to say a
 * comment as far as a hand-made POST is concerned. A body carrying `null`, a number or an
 * array of numbers would reach the command typed as a string and throw on the first
 * `.trim()`, answering a framework 500 to the caller most likely to be probing. Every
 * field is therefore checked for shape and bounded for length here, at the boundary.
 *
 * There is no credential anywhere in this file, and no file input: a binding names a
 * location, and acquiring a population against it belongs to Epic 2's Adapters.
 */

export type BindingActionResult =
  | { readonly ok: true; readonly message: string; readonly bindingId: string }
  | { readonly ok: false; readonly reason: string };

/** Said when the command threw. It never names a driver, a table or a host. */
const UNAVAILABLE = 'The change could not be saved. Nothing was changed.';

/** Said when the request was not the shape this action accepts. One sentence for all. */
const MALFORMED = 'That request was not valid. Nothing was changed.';

/** Ceilings applied before anything else looks at the value. */
const MAX = {
  displayName: 200,
  location: 1000,
  note: 2000,
  listItems: 200,
  listItem: 200,
  rowVersion: 64,
  /** A vocabulary word, not free text. All three are re-checked against a closed list. */
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
export interface BindingFormFields {
  readonly displayName: string;
  readonly kind: string;
  readonly location: string;
  readonly declaredSchema: readonly string[];
  readonly declaredCountMechanism: string;
  readonly sensitiveFields: readonly string[];
  readonly note: string;
  readonly status: string;
}

function isBindingFormFields(input: unknown): input is BindingFormFields {
  if (typeof input !== 'object' || input === null) return false;
  const fields = input as Record<string, unknown>;
  return (
    boundedString(fields['displayName'], MAX.displayName) &&
    boundedString(fields['kind'], MAX.vocabulary) &&
    boundedString(fields['location'], MAX.location) &&
    boundedList(fields['declaredSchema'], MAX.listItems, MAX.listItem) &&
    boundedString(fields['declaredCountMechanism'], MAX.vocabulary) &&
    boundedList(fields['sensitiveFields'], MAX.listItems, MAX.listItem) &&
    boundedString(fields['note'], MAX.note) &&
    boundedString(fields['status'], MAX.vocabulary)
  );
}

/**
 * Turn the posted strings into the command's types, or `null`.
 *
 * The vocabulary checks happen HERE as well as in the command. That is not duplication
 * for its own sake: the command's input type says `DeclaredCountMechanism`, and a posted
 * string would satisfy that type at compile time while carrying anything at run time.
 * This is where a string stops being one.
 */
function toBindingFields(fields: BindingFormFields): BindingFields | null {
  if (!isPopulationSourceKind(fields.kind)) return null;
  if (!isDeclaredCountMechanism(fields.declaredCountMechanism)) return null;
  if (!isBindingStatus(fields.status)) return null;
  return {
    displayName: fields.displayName,
    kind: fields.kind,
    location: fields.location,
    declaredSchema: fields.declaredSchema,
    declaredCountMechanism: fields.declaredCountMechanism,
    sensitiveFields: fields.sensitiveFields,
    note: fields.note,
    status: fields.status,
  };
}

async function dependencies(): Promise<BindingDependencies> {
  const runtime = await getRuntime();
  return {
    roles: new DrizzleRoleRepository(runtime.db),
    unitOfWork: new PostgresSourcesUnitOfWork(runtime.db),
    ids: new CryptoUuidV7Generator(),
  };
}

/** Report a failure and refuse. The person gets one sentence; the operator gets the error. */
async function unavailable(
  message: 'Register Population Source failed' | 'Change Population Source failed',
  error: unknown,
  correlationId: string,
): Promise<BindingActionResult> {
  try {
    const runtime = await getRuntime();
    runtime.telemetry.captureError(message, error, { outcome: 'failure', correlationId });
  } catch {
    // The runtime is what failed. `instrumentation.ts` reported that at boot.
  }
  return { ok: false, reason: UNAVAILABLE };
}

/** Register a Population Source binding. One `configuration.binding-created` event. */
export async function createBindingAction(
  fields: BindingFormFields,
): Promise<BindingActionResult> {
  const decision = await requireServerAction('administration.bindings.manage');
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  if (!isBindingFormFields(fields)) return { ok: false, reason: MALFORMED };
  const typed = toBindingFields(fields);
  if (typed === null) return { ok: false, reason: MALFORMED };

  const correlationId = await currentCorrelationId();

  try {
    const outcome = await registerPopulationSource(await dependencies(), {
      ...typed,
      session: decision.session,
      correlationId,
    });
    if (!outcome.ok) return outcome;

    revalidatePath('/administration/sources');
    return {
      ok: true,
      bindingId: outcome.bindingId,
      message: `Registered ${typed.displayName.trim()}. Its digest is ${outcome.digest}.`,
    };
  } catch (error) {
    return unavailable('Register Population Source failed', error, correlationId);
  }
}

export interface ChangeBindingFormFields extends BindingFormFields {
  readonly bindingId: string;
  /**
   * The version of the whole row the surface rendered. Optimistic concurrency; see the
   * command. It covers all ten fields and not the five the digest covers, because the
   * display name, the note and the status sit outside the digest and are therefore
   * exactly the fields a digest-shaped token could not protect.
   */
  readonly expectedRowVersion: string;
}

/**
 * Change a Population Source binding. A digest-bearing change publishes
 * `configuration.binding-changed` in the same transaction; a rename, a note or a
 * retirement publishes `configuration.binding-annotated`; a save that moves nothing
 * publishes nothing.
 */
export async function changeBindingAction(
  fields: ChangeBindingFormFields,
): Promise<BindingActionResult> {
  const decision = await requireServerAction('administration.bindings.manage');
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  if (!isBindingFormFields(fields)) return { ok: false, reason: MALFORMED };
  // Shape, not just length. This value reaches an audit payload, and payload strings are
  // not held to `SAFE_ID_PATTERN` the way `aggregateId` is — so without this an
  // administrator could write 64 arbitrary characters into the immutable chain,
  // presented in review as a binding id.
  if (!isUuid((fields as { bindingId?: unknown }).bindingId)) {
    return { ok: false, reason: MALFORMED };
  }
  if (!boundedString((fields as { expectedRowVersion?: unknown }).expectedRowVersion, MAX.rowVersion)) {
    return { ok: false, reason: MALFORMED };
  }
  const typed = toBindingFields(fields);
  if (typed === null) return { ok: false, reason: MALFORMED };

  const correlationId = await currentCorrelationId();

  try {
    const outcome = await changePopulationSource(await dependencies(), {
      ...typed,
      session: decision.session,
      correlationId,
      bindingId: fields.bindingId,
      expectedRowVersion: fields.expectedRowVersion,
    });
    if (!outcome.ok) return outcome;

    revalidatePath('/administration/sources');
    revalidatePath(`/administration/sources/${fields.bindingId}`);
    return {
      ok: true,
      bindingId: outcome.bindingId,
      message: outcome.published
        ? `Saved. The digest is now ${outcome.digest}, and the change is recorded in the audit chain.`
        : outcome.annotated
          ? 'Saved. The digest did not change, so no Procedure is affected. The change is recorded in the audit chain.'
          : 'Saved. Nothing changed.',
    };
  } catch (error) {
    return unavailable('Change Population Source failed', error, correlationId);
  }
}
