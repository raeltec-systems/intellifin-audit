'use server';

import { revalidatePath } from 'next/cache';

import {
  createProcedure,
  PROCEDURE_AUTHOR_ACTION,
  PROCEDURE_LIMITS,
  type ProcedureDependencies,
} from '@intellifin/application';
import {
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresProceduresUnitOfWork,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../../src/bootstrap';
import { currentCorrelationId, requireServerAction } from '../../../src/server-session';

/**
 * The New-procedure Server Action (FR-4, FR-5).
 *
 * **It authorizes first, before it reads its input.** A Server Action is not protected
 * by the page it was written beside: Next exposes it as its own POST endpoint addressed
 * by an id that appears in the client bundle, so reaching the page is not a precondition
 * for invoking it. `actions.test.ts` asserts the refusals here, not the page's.
 *
 * **The argument is untrusted.** `NewProcedureFormFields` is TypeScript, which is to
 * say a comment as far as a hand-made POST is concerned. Shape is checked here, at the
 * boundary, before the command is reached.
 */

export type NewProcedureActionResult =
  | { readonly ok: true; readonly procedureId: string; readonly versionId: string }
  | { readonly ok: false; readonly reason: string };

/** Said when the command threw. It never names a driver, a table or a host. */
const UNAVAILABLE = 'The Procedure could not be created. Nothing was changed.';

/** Said when the request was not the shape this action accepts. One sentence for all. */
const MALFORMED = 'That request was not valid. Nothing was changed.';

/** What the form posts. Both fields are strings; neither is optional. */
export interface NewProcedureFormFields {
  readonly templateId: string;
  readonly controlName: string;
}

function isNewProcedureFormFields(input: unknown): input is NewProcedureFormFields {
  if (typeof input !== 'object' || input === null) return false;
  const fields = input as Record<string, unknown>;
  // The Template id is a vocabulary word bounded like one — non-empty (an unchosen
  // select posts an empty string, which is a missing value, not a Template), and no
  // longer than any word the vocabulary could grow. WHICH Template it is remains the
  // domain's check: the command refuses a well-formed but unknown id, and there is
  // exactly one vocabulary check. The Control name is bounded by the domain's own
  // limit, so the boundary and the command cannot disagree.
  return (
    typeof fields['templateId'] === 'string' &&
    fields['templateId'].length > 0 &&
    fields['templateId'].length <= 8 &&
    typeof fields['controlName'] === 'string' &&
    fields['controlName'].length <= PROCEDURE_LIMITS.controlName
  );
}

async function dependencies(): Promise<ProcedureDependencies> {
  const runtime = await getRuntime();
  return {
    roles: new DrizzleRoleRepository(runtime.db),
    unitOfWork: new PostgresProceduresUnitOfWork(runtime.db),
    ids: new CryptoUuidV7Generator(),
    derivationModel: runtime.derivationModel,
  };
}

/** Report a failure and refuse. The person gets one sentence; the operator gets the error. */
async function unavailable(error: unknown, correlationId: string): Promise<NewProcedureActionResult> {
  try {
    const runtime = await getRuntime();
    runtime.telemetry.captureError('Create Procedure failed', error, {
      outcome: 'failure',
      correlationId,
    });
  } catch {
    // The runtime is what failed. `instrumentation.ts` reported that at boot.
  }
  return { ok: false, reason: UNAVAILABLE };
}

/** Create a Procedure and its first DRAFT version from the chosen Template. */
export async function createProcedureAction(
  fields: NewProcedureFormFields,
): Promise<NewProcedureActionResult> {
  // FIRST, before the input is read at all. The role is resolved fresh (AD-7) and the
  // refusal, if there is one, is audited by the authorization path itself.
  const decision = await requireServerAction(PROCEDURE_AUTHOR_ACTION);
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  if (!isNewProcedureFormFields(fields)) return { ok: false, reason: MALFORMED };

  const correlationId = await currentCorrelationId();

  try {
    const outcome = await createProcedure(await dependencies(), {
      // The command validates the id against the four shipped Templates; a string that
      // is well-formed but unknown is refused there, not here — there is exactly one
      // vocabulary check, and it is the domain's.
      templateId: fields.templateId,
      controlName: fields.controlName,
      session: decision.session,
      correlationId,
    });
    if (!outcome.ok) return { ok: false, reason: outcome.reason };

    revalidatePath('/procedures');
    return { ok: true, procedureId: outcome.procedureId, versionId: outcome.versionId };
  } catch (error) {
    return unavailable(error, correlationId);
  }
}
