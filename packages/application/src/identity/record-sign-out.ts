import type { AuditUnitOfWork } from '../audit/ports.js';
import type { IdentityUnitOfWorkContext } from './ports.js';

/**
 * `security.sign-out` (FR-1, FR-45).
 *
 * The session row is deleted and the event is appended in ONE transaction, so a session
 * cannot end without the chain saying so, and the chain cannot claim a sign-out that did
 * not happen. It is the same rule `recordSignInAttempt` follows from the other side.
 *
 * Nothing here carries the session token, the cookie, or an address: the session is
 * named by its row id, which is what the audit envelope's `sessionId` already is.
 */

export const SIGN_OUT_EVENT = 'security.sign-out' as const;

export interface RecordSignOutInput {
  readonly userId: string;
  /** The provider's session-row id — never the token. */
  readonly sessionId: string;
  readonly correlationId: string;
}

export async function signOut(
  unitOfWork: AuditUnitOfWork<IdentityUnitOfWorkContext>,
  input: RecordSignOutInput,
): Promise<void> {
  await unitOfWork.execute(async ({ auditEvents, sessions }) => {
    await sessions.revokeSession(input.sessionId);
    await auditEvents.append({
      actor: { type: 'human', id: input.userId },
      eventType: SIGN_OUT_EVENT,
      source: 'web',
      outcome: 'success',
      sessionId: input.sessionId,
      correlationId: input.correlationId,
      payload: { method: 'user-initiated' },
    });
  });
}
