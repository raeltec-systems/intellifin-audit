import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DENIAL_REASON,
  DENIAL_REASONS,
  GATED_ACTIONS,
  ROLES,
  authorizeAction,
  isGatedAction,
  isRole,
  type GatedAction,
  type Role,
} from './roles.js';

/**
 * The UX "Roles and Action Gating" table, enforced.
 *
 * This is the only place the table is checked, so it is checked exhaustively: every
 * role x every action, with the expected verbatim string on each refusal. A cell
 * missing from EXPECTED fails the completeness test below rather than passing by
 * omission.
 */

/** `true` means the cell is a tick; a string is the exact reason that cell gives. */
type Cell = true | string;

const AUTHOR_AND_SUPERVISE: Record<Role, Cell> = {
  auditor: true,
  'audit-manager': true,
  'poc-administrator': DENIAL_REASONS.ADMIN_CANNOT_AUTHOR,
};

const EVALUATE_AND_SUBMIT: Record<Role, Cell> = {
  auditor: true,
  'audit-manager': true,
  'poc-administrator': DENIAL_REASONS.ADMIN_CANNOT_ALTER,
};

const APPROVE_VERSION: Record<Role, Cell> = {
  auditor: DENIAL_REASONS.ONLY_MANAGER_APPROVES_VERSION,
  'audit-manager': true,
  'poc-administrator': DEFAULT_DENIAL_REASON,
};

const DECIDE_RESULT: Record<Role, Cell> = {
  auditor: DENIAL_REASONS.ONLY_MANAGER_APPROVES_RESULT,
  'audit-manager': true,
  'poc-administrator': DEFAULT_DENIAL_REASON,
};

const EXPORT_BUNDLE: Record<Role, Cell> = {
  auditor: true,
  'audit-manager': true,
  'poc-administrator': DEFAULT_DENIAL_REASON,
};

const ADMINISTER: Record<Role, Cell> = {
  auditor: DEFAULT_DENIAL_REASON,
  'audit-manager': DEFAULT_DENIAL_REASON,
  'poc-administrator': true,
};

const EXPECTED: Record<GatedAction, Record<Role, Cell>> = {
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

const CELLS = GATED_ACTIONS.flatMap((action) =>
  ROLES.map((role) => ({ action, role, expected: EXPECTED[action][role] })),
);

describe('the action-gating table', () => {
  it('covers every role and every gated action exactly once', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...GATED_ACTIONS].sort());
    expect(CELLS).toHaveLength(GATED_ACTIONS.length * ROLES.length);
  });

  it.each(CELLS)('$role -> $action', ({ role, action, expected }) => {
    const decision = authorizeAction(role, action);
    if (expected === true) {
      expect(decision).toEqual({ allowed: true });
      return;
    }
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe(expected);
  });

  it.each(
    CELLS.filter((cell) => cell.expected !== true),
  )('$role -> $action ends its reason with a full stop', ({ role, action }) => {
    const decision = authorizeAction(role, action);
    expect(decision.allowed === false && decision.reason.endsWith('.')).toBe(true);
  });
});

describe('the author-cannot-approve rule', () => {
  const AUTHOR = 'user_manager_1';

  it('denies an Audit Manager approving the version they authored', () => {
    const decision = authorizeAction('audit-manager', 'procedure.version.approve', {
      actorId: AUTHOR,
      authorId: AUTHOR,
    });
    expect(decision).toEqual({
      allowed: false,
      reason: 'You cannot approve a version you authored.',
    });
  });

  it('allows an Audit Manager approving somebody else’s version', () => {
    expect(
      authorizeAction('audit-manager', 'procedure.version.approve', {
        actorId: AUTHOR,
        authorId: 'user_auditor_1',
      }),
    ).toEqual({ allowed: true });
  });

  it('allows an Audit Manager rejecting the version they authored', () => {
    // FR-2 restricts approval only; refusing one's own version takes nothing away.
    expect(
      authorizeAction('audit-manager', 'procedure.version.reject', {
        actorId: AUTHOR,
        authorId: AUTHOR,
      }),
    ).toEqual({ allowed: true });
  });

  it('does not let a missing author identity turn a refusal into an approval', () => {
    expect(
      authorizeAction('auditor', 'procedure.version.approve', { actorId: AUTHOR, authorId: AUTHOR }),
    ).toEqual({
      allowed: false,
      reason: 'Only an Audit Manager can approve a Procedure Version.',
    });
  });
});

describe('a signed-in person with no role', () => {
  it.each(GATED_ACTIONS)('denies %s with the neutral reason', (action) => {
    expect(authorizeAction(null, action)).toEqual({
      allowed: false,
      reason: DEFAULT_DENIAL_REASON,
    });
  });

  it('never falls back to a default role', () => {
    const allowedForSomebody = GATED_ACTIONS.filter((action) =>
      ROLES.some((role) => authorizeAction(role, action).allowed),
    );
    expect(allowedForSomebody).toHaveLength(GATED_ACTIONS.length);
    expect(GATED_ACTIONS.filter((action) => authorizeAction(null, action).allowed)).toEqual([]);
  });
});

describe('the vocabularies', () => {
  it('holds exactly the three PoC roles', () => {
    expect([...ROLES]).toEqual(['auditor', 'audit-manager', 'poc-administrator']);
  });

  it('recognizes only its own members', () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    for (const value of ['Auditor', 'admin', '', null, 42]) expect(isRole(value)).toBe(false);
    for (const action of GATED_ACTIONS) expect(isGatedAction(action)).toBe(true);
    for (const value of ['procedure.delete', '', null]) expect(isGatedAction(value)).toBe(false);
  });

  it('denies an action outside the vocabulary rather than allowing it', () => {
    const decision = authorizeAction('audit-manager', 'not.an.action' as GatedAction);
    expect(decision).toEqual({ allowed: false, reason: DEFAULT_DENIAL_REASON });
  });
});
