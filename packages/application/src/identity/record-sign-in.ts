import type { AuditUnitOfWork } from '../audit/ports.js';

/**
 * `security.sign-in`, appended to the `platform` chain for both outcomes (FR-1, FR-45).
 *
 * Success and failure take the same path on purpose: a second path is a second place
 * to forget the event. Nothing here carries a password, a token, a cookie or an email
 * address — `subjectHash` is the SHA-256 of the lower-cased address, which correlates
 * repeated attempts on one identity without storing it.
 *
 * An email address cannot be an `actor.id`: the audit vocabulary restricts that field
 * to `[A-Za-z0-9][A-Za-z0-9:._/-]{0,254}`, which excludes `@`. A failed attempt on an
 * address no user holds therefore records {@link UNKNOWN_ACTOR_ID}.
 */

export const UNKNOWN_ACTOR_ID = 'unknown';
/** Used when a sign-in fails before any session exists. */
export const ANONYMOUS_SESSION_ID = 'anonymous';

export interface RecordSignInInput {
  readonly outcome: 'success' | 'failure';
  /** The user the attempt resolved to, when the address matches one. */
  readonly userId?: string | undefined;
  /** SHA-256 hex of the lower-cased email address. Never the address itself. */
  readonly subjectHash: string;
  /** The established session's id on success; `anonymous` on failure. */
  readonly sessionId?: string | undefined;
  readonly correlationId: string;
}

export async function recordSignInAttempt(
  unitOfWork: AuditUnitOfWork,
  input: RecordSignInInput,
): Promise<void> {
  await unitOfWork.execute(({ auditEvents }) =>
    auditEvents.append({
      actor: { type: 'human', id: input.userId ?? UNKNOWN_ACTOR_ID },
      eventType: 'security.sign-in',
      source: 'web',
      outcome: input.outcome,
      sessionId: input.sessionId ?? ANONYMOUS_SESSION_ID,
      correlationId: input.correlationId,
      payload: { subjectHash: input.subjectHash, method: 'email-password' },
    }),
  );
}
