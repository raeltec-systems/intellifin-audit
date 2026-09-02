/**
 * The application-owned role vocabulary and the action-gating policy (FR-1, FR-2, AD-7).
 *
 * This module is pure domain data. It never reads a database, a session, or an
 * identity provider: Better Auth establishes *who* is asking, this file decides
 * *what* they may do, and the two are deliberately unrelated. Keeping the policy
 * here is what makes it testable cell by cell without a framework.
 *
 * The denial strings are copied character-for-character from the "Roles and Action
 * Gating" table in the UX EXPERIENCE handoff, trailing full stop included. Changing
 * one here without changing it there is a defect; `roles.test.ts` is the guard.
 */

export const ROLES = ['auditor', 'audit-manager', 'poc-administrator'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Every action the gating table covers, named after the surface that will invoke it.
 * Story 1.3 builds none of those surfaces; it fixes the vocabulary they must use so
 * that a later story cannot quietly introduce an ungated one.
 */
export const GATED_ACTIONS = [
  // Row 1 — author, submit, and supervise.
  'procedure.author',
  'procedure.version.submit',
  'run.initiate',
  'run.pause',
  'run.resume',
  'run.cancel',
  'escalation.answer',
  'run.flag',
  // Row 2 — evaluations, Exceptions, and Result submission.
  'evaluation.confirm',
  'evaluation.reject',
  'exception.assign',
  'exception.disposition',
  'result.annotate',
  'result.submit',
  // Row 3 — Procedure Version approval.
  'procedure.version.approve',
  'procedure.version.reject',
  // Row 4 — Result approval and disagreement.
  'result.approve',
  'result.reject',
  'result.finalize',
  'result.disagreement.record',
  // Row 5 — export.
  'export.workpaper-bundle',
  // Row 6 — administration.
  'administration.users.manage',
  'administration.registrations.manage',
  'administration.bindings.manage',
  'administration.diagnostics.read',
] as const;
export type GatedAction = (typeof GATED_ACTIONS)[number];

export function isGatedAction(value: unknown): value is GatedAction {
  return typeof value === 'string' && (GATED_ACTIONS as readonly string[]).includes(value);
}

/**
 * The reason a cell the table leaves as a bare "—" gives. The table spells out five
 * strings and no more; inventing role-specific copy for the rest would put words in
 * the product's mouth, so every unspecified refusal says the same neutral sentence.
 */
export const DEFAULT_DENIAL_REASON = 'Your role does not permit this action.';

/** The five strings the table specifies, verbatim. */
export const DENIAL_REASONS = {
  ADMIN_CANNOT_AUTHOR: 'PoC Administrator cannot author Procedures or start Runs.',
  ADMIN_CANNOT_ALTER:
    'PoC Administrator cannot alter evaluations, Results, or reviews.',
  ONLY_MANAGER_APPROVES_VERSION: 'Only an Audit Manager can approve a Procedure Version.',
  AUTHOR_CANNOT_APPROVE: 'You cannot approve a version you authored.',
  ONLY_MANAGER_APPROVES_RESULT: 'Only an Audit Manager can approve a submitted Result.',
} as const;

/** Context a cell may need beyond the role. Absent fields simply do not constrain. */
export interface AuthorizationContext {
  /**
   * The person asking. Supplied by the session, never by a caller — see
   * `authorizeCommand`, which applies it last so nothing can override it.
   */
  readonly actorId?: string | undefined;
  /**
   * Author of the Procedure Version under approval. REQUIRED for
   * `procedure.version.approve`: omitting it denies, because the author rule cannot
   * be checked without it.
   */
  readonly authorId?: string | undefined;
}

export type AuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

const ALLOW: AuthorizationDecision = { allowed: true };

const deny = (reason: string): AuthorizationDecision => ({ allowed: false, reason });

/** One table row: which roles hold the action, and what each other role is told. */
interface ActionRule {
  readonly allowedRoles: readonly Role[];
  /** Reason per refused role; a role with no entry gets {@link DEFAULT_DENIAL_REASON}. */
  readonly reasons?: Partial<Record<Role, string>>;
}

const AUDITOR_AND_MANAGER: readonly Role[] = ['auditor', 'audit-manager'];
const MANAGER_ONLY: readonly Role[] = ['audit-manager'];
const ADMIN_ONLY: readonly Role[] = ['poc-administrator'];

/**
 * Row 1 of the table. FR-2 gives the Auditor these actions and gives the Audit
 * Manager everything an Auditor can do.
 */
const AUTHOR_AND_SUPERVISE: ActionRule = {
  allowedRoles: AUDITOR_AND_MANAGER,
  reasons: { 'poc-administrator': DENIAL_REASONS.ADMIN_CANNOT_AUTHOR },
};

/** Row 2 of the table. */
const EVALUATE_AND_SUBMIT: ActionRule = {
  allowedRoles: AUDITOR_AND_MANAGER,
  reasons: { 'poc-administrator': DENIAL_REASONS.ADMIN_CANNOT_ALTER },
};

/** Row 3 of the table. The author guard is applied separately, below. */
const APPROVE_VERSION: ActionRule = {
  allowedRoles: MANAGER_ONLY,
  reasons: { auditor: DENIAL_REASONS.ONLY_MANAGER_APPROVES_VERSION },
};

/** Row 4 of the table. */
const DECIDE_RESULT: ActionRule = {
  allowedRoles: MANAGER_ONLY,
  reasons: { auditor: DENIAL_REASONS.ONLY_MANAGER_APPROVES_RESULT },
};

/** Row 5 of the table: no specified copy for the refused cell. */
const EXPORT_BUNDLE: ActionRule = { allowedRoles: AUDITOR_AND_MANAGER };

/** Row 6 of the table: no specified copy for the refused cells. */
const ADMINISTER: ActionRule = { allowedRoles: ADMIN_ONLY };

const ACTION_RULES: Readonly<Record<GatedAction, ActionRule>> = {
  'procedure.author': AUTHOR_AND_SUPERVISE,
  'procedure.version.submit': AUTHOR_AND_SUPERVISE,
  'run.initiate': AUTHOR_AND_SUPERVISE,
  'run.pause': AUTHOR_AND_SUPERVISE,
  'run.resume': AUTHOR_AND_SUPERVISE,
  'run.cancel': AUTHOR_AND_SUPERVISE,
  'escalation.answer': AUTHOR_AND_SUPERVISE,
  'run.flag': AUTHOR_AND_SUPERVISE,

  'evaluation.confirm': EVALUATE_AND_SUBMIT,
  'evaluation.reject': EVALUATE_AND_SUBMIT,
  'exception.assign': EVALUATE_AND_SUBMIT,
  'exception.disposition': EVALUATE_AND_SUBMIT,
  'result.annotate': EVALUATE_AND_SUBMIT,
  'result.submit': EVALUATE_AND_SUBMIT,

  'procedure.version.approve': APPROVE_VERSION,
  'procedure.version.reject': APPROVE_VERSION,

  'result.approve': DECIDE_RESULT,
  'result.reject': DECIDE_RESULT,
  'result.finalize': DECIDE_RESULT,
  'result.disagreement.record': DECIDE_RESULT,

  'export.workpaper-bundle': EXPORT_BUNDLE,

  'administration.users.manage': ADMINISTER,
  'administration.registrations.manage': ADMINISTER,
  'administration.bindings.manage': ADMINISTER,
  'administration.diagnostics.read': ADMINISTER,
};

/**
 * The one action FR-2 restricts by identity rather than by role: "An Audit Manager
 * cannot approve a Procedure Version they authored." Rejecting a version one wrote
 * takes nothing away from anybody, and FR-2 names only approval, so the guard is
 * scoped to approval alone.
 *
 * A MISSING `authorId` denies. The rule cannot be honoured without knowing who wrote
 * the version, and a rule that cannot be checked must not be assumed satisfied: a
 * caller that simply omitted the author would otherwise self-approve. Supplying the
 * author is therefore part of asking for this action, not an optional refinement.
 */
function authorApprovingOwnVersion(
  action: GatedAction,
  context: AuthorizationContext,
): boolean {
  if (action !== 'procedure.version.approve') return false;
  const { actorId, authorId } = context;
  if (authorId === undefined) return true;
  return actorId !== undefined && actorId === authorId;
}

/**
 * Decide one action for one role.
 *
 * `role` is `null` for a signed-in person with no `user_role` row. That is not an
 * error state and never falls back to a default role: it holds no action at all
 * (AD-7 — role revocation must take effect, and an empty role table is the limit
 * case of a revoked one).
 */
export function authorizeAction(
  role: Role | null,
  action: GatedAction,
  context: AuthorizationContext = {},
): AuthorizationDecision {
  // `Object.hasOwn`, not a truthiness check: `ACTION_RULES['constructor']` and
  // `ACTION_RULES['toString']` inherit truthy values from Object.prototype, so a
  // plain lookup would sail past the guard and then throw on `rule.allowedRoles` —
  // a 500 where a denial belongs.
  if (!Object.hasOwn(ACTION_RULES, action)) return deny(DEFAULT_DENIAL_REASON);
  const rule = ACTION_RULES[action];
  if (role === null) return deny(DEFAULT_DENIAL_REASON);
  if (!rule.allowedRoles.includes(role)) {
    return deny(rule.reasons?.[role] ?? DEFAULT_DENIAL_REASON);
  }
  if (authorApprovingOwnVersion(action, context)) {
    return deny(DENIAL_REASONS.AUTHOR_CANNOT_APPROVE);
  }
  return ALLOW;
}
