import {
  authorizeAction,
  isFlaggableRunState,
  RUN_FLAG_NOTE_MAX_LENGTH,
  RUN_FLAG_REFUSALS,
  sha256Hex,
  type Role,
  type RunFlag,
} from '@intellifin/domain';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import type { AuditUnitOfWork } from '../audit/ports.js';
import { authorizeCommandRole, recordAuthorizationDenial } from '../identity/authorize.js';
import type { RoleRepository, SessionSnapshot } from '../identity/ports.js';
import { createFlagNotification, runNotificationRecipients } from '../notifications/ports.js';
import type { RunFlagRepository } from './ports.js';

/**
 * `FlagRun`: an Auditor asks the Audit Managers to look at a Run (Story 5.5, FR-27, FR-28).
 *
 * **It changes nothing about the Run.** No state, no wait, no lease, no Evidence, no
 * dispatch job. That is enforced by the CONTEXT rather than by discipline: `RunFlagContext`
 * carries no Run-state writer and no Result seam at all, so a later branch cannot reach
 * one. The flag row, its notifications and `lifecycle.run-flagged` commit together.
 *
 * **The note is stored; only its digest and length are chained.** The audit chain is
 * immutable, so anything that enters it can never be taken out, and a note is free text a
 * person types — the reason Story 2.3's payloads identify Audit Instructions the same way.
 * The notification rows carry no note either: they name the Procedure and the Run, and the
 * text is read on the Run by somebody already authorized to open it.
 *
 * **There is no request token, and a repeated flag is a second flag.** Nothing in the
 * contract says a Run has at most one, two flags with different notes are two different
 * things a person said, and merging them under a derived id would silently lose the
 * second. A lost response is handled the way every other control on these surfaces handles
 * one — the surface blocks the retry and asks for a reload.
 */

export interface FlagRunDependencies {
  readonly roles: RoleRepository;
  /** Where a refusal's `security.denied` event is appended, after the refusal. */
  readonly unitOfWork: AuditUnitOfWork;
  readonly repository: RunFlagRepository;
  readonly ids: UuidV7Generator;
  readonly clock: Clock;
}

export type FlagRunOutcome =
  | { readonly ok: true; readonly flagId: string }
  | { readonly ok: false; readonly reason: string };

export const FLAG_REQUEST_MALFORMED =
  'Choose a Run that is still running, and a note of at most 500 characters.';

export const FLAGGED_EVENT = 'lifecycle.run-flagged';

class Revoked extends Error {
  constructor(readonly role: Role | null, reason: string) {
    super(reason);
  }
}

export async function flagRun(
  dependencies: FlagRunDependencies,
  input: { session: SessionSnapshot; request: unknown },
): Promise<FlagRunOutcome> {
  const correlationId = dependencies.ids.next();
  const authorization = { session: input.session, correlationId, action: 'run.flag' as const };
  const permission = await authorizeCommandRole(dependencies, authorization);
  if (!permission.allowed) return { ok: false, reason: permission.reason };
  const request = input.request;
  // Untrusted whatever its TypeScript type says: an exact key set, a Run id that is really
  // one, and a bounded note. The database refuses a longer or blank one as well.
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    Object.keys(request).length !== 2 ||
    !Object.hasOwn(request, 'runId') ||
    !Object.hasOwn(request, 'note') ||
    !('runId' in request) ||
    typeof request.runId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.runId) ||
    !('note' in request) ||
    (request.note !== null &&
      (typeof request.note !== 'string' || request.note.length > RUN_FLAG_NOTE_MAX_LENGTH))
  )
    return { ok: false, reason: FLAG_REQUEST_MALFORMED };
  const runId = request.runId.toLowerCase();
  // A blank note is ABSENCE, never an empty string: an empty note would read as one
  // somebody left blank rather than as one they chose not to write.
  const trimmed = typeof request.note === 'string' ? request.note.trim() : '';
  const note = trimmed.length === 0 ? null : trimmed;
  try {
    return await dependencies.repository.transaction(runId, async (context) => {
      const role = await context.authorizationRoles.findRole(input.session.userId);
      const locked = authorizeAction(role, 'run.flag');
      if (!locked.allowed) throw new Revoked(role, locked.reason);
      const run = context.run;
      if (run === null) return { ok: false, reason: RUN_FLAG_REFUSALS.UNKNOWN };
      // Every refusal here happens before this command writes anything, so returning one
      // commits an empty transaction. A refusal that could follow a write must be THROWN.
      if (!isFlaggableRunState(run.state)) return { ok: false, reason: RUN_FLAG_REFUSALS.NOT_FLAGGABLE };
      const flag: RunFlag = {
        flagId: dependencies.ids.next(),
        runId: run.runId,
        flaggedBy: input.session.userId,
        sessionId: input.session.sessionId,
        flaggedAt: dependencies.clock.now().toISOString(),
        note,
      };
      await context.insertFlag(flag);
      // FR-28's recipient rule, the same one an Escalation uses: the initiator — the
      // Procedure's author for a scheduled Run — and every current Audit Manager, read on
      // this transaction's connection so a role granted a moment ago is included and one
      // revoked a moment ago is not.
      for (const recipientId of runNotificationRecipients(run.initiatorId, await context.auditManagerIds())) {
        await context.enqueueNotification(createFlagNotification({
          recipientId,
          runId: run.runId,
          flagId: flag.flagId,
          procedureId: run.procedureId,
          versionId: run.versionId,
          procedureName: run.procedureName,
          versionNumber: run.versionNumber,
        }));
      }
      const stored = await context.auditEvents.append({
        actor: { type: 'human', id: flag.flaggedBy },
        eventType: FLAGGED_EVENT,
        source: 'web',
        outcome: 'success',
        aggregateId: run.runId,
        correlationId,
        sessionId: flag.sessionId,
        payload: {
          flagId: flag.flagId,
          state: run.state,
          flaggedAt: flag.flaggedAt,
          // The note itself never enters the chain. Its length and digest are enough to
          // prove afterwards that the stored text is the text that was flagged.
          noteLength: note === null ? 0 : note.length,
          noteDigest: note === null ? null : sha256Hex(note),
        },
      });
      await context.notifyTimeline(stored.sequence);
      return { ok: true, flagId: flag.flagId };
    });
  } catch (error) {
    if (error instanceof Revoked) {
      // The transaction rolled back, so nothing was flagged. The denial is appended in its
      // own unit of work, which must commit while nothing else did.
      await recordAuthorizationDenial(dependencies, authorization, error.role, error.message);
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}
