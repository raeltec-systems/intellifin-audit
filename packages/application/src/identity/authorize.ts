import {
  authorizeAction,
  authorizeActionRole,
  type AuthorizationContext,
  type GatedAction,
  type Role,
} from '@intellifin/domain';

import type { AuditUnitOfWork } from '../audit/ports.js';
import type { RoleRepository, SessionSnapshot } from './ports.js';

/**
 * The one place an action is authorized (AD-7).
 *
 * It resolves the role afresh through the port, applies the pure domain policy, and
 * — on refusal — appends `security.denied` inside the audit unit of work before it
 * answers. A caller therefore cannot deny without auditing, because the denial and
 * its event are produced by the same call.
 */

export type AuthorizationResult =
  | { readonly allowed: true; readonly role: Role; readonly userId: string }
  | { readonly allowed: false; readonly reason: string; readonly role: Role | null };

export interface AuthorizeCommandDependencies {
  readonly roles: RoleRepository;
  readonly unitOfWork: AuditUnitOfWork;
}

export interface AuthorizeCommandInput {
  readonly session: SessionSnapshot;
  readonly action: GatedAction;
  readonly correlationId: string;
  readonly context?: AuthorizationContext;
}

export async function authorizeCommand(
  dependencies: AuthorizeCommandDependencies,
  input: AuthorizeCommandInput,
): Promise<AuthorizationResult> {
  return authorize(dependencies, input, false);
}

export async function authorizeCommandRole(dependencies: AuthorizeCommandDependencies, input: AuthorizeCommandInput): Promise<AuthorizationResult> {
  return authorize(dependencies, input, true);
}

async function authorize(dependencies: AuthorizeCommandDependencies, input: AuthorizeCommandInput, roleOnly: boolean): Promise<AuthorizationResult> {
  const { session, action, correlationId } = input;

  // Read on every call. A role cached anywhere — a cookie, a claim, a map — would
  // still authorize after the row behind it was deleted (AD-7).
  const role = await dependencies.roles.findRole(session.userId);

  // The session's identity is applied LAST and cannot be overridden. A caller that
  // could put its own `actorId` in the context would defeat the author-cannot-approve
  // rule by claiming to be somebody else; who is asking is established by the session
  // and by nothing a handler passes in.
  const decision = roleOnly ? authorizeActionRole(role, action) : authorizeAction(role, action, {
    ...input.context,
    actorId: session.userId,
  });

  if (decision.allowed) {
    return { allowed: true, role: role as Role, userId: session.userId };
  }

  await recordAuthorizationDenial(dependencies, input, role, decision.reason);

  return { allowed: false, reason: decision.reason, role };
}

/** Audit the actual policy result after a refused transaction rolls back; never re-decide it. */
export async function recordAuthorizationDenial(dependencies: AuthorizeCommandDependencies, input: AuthorizeCommandInput, role: Role | null, reason: string): Promise<void> {
  const { session, action, correlationId } = input;
  await dependencies.unitOfWork.execute(({ auditEvents }) =>
    auditEvents.append({
      actor: { type: 'human', id: session.userId },
      eventType: 'security.denied',
      source: 'web',
      outcome: 'denied',
      sessionId: session.sessionId,
      correlationId,
      payload: { action, role: role ?? null, reason },
    }),
  );

}
