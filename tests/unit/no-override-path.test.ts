import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DENIAL_REASON,
  DENIAL_REASONS,
  GATED_ACTIONS,
  ROLES,
  authorizeAction,
  type GatedAction,
} from '@intellifin/domain';

/**
 * "No override path exists", proven over the whole action set (FR-2).
 *
 * Story 1.5 gives the PoC Administrator a real, privileged capability for the first
 * time: it can create accounts and grant roles, and it reaches an identity instance
 * that can create users at all. The obvious failure mode of that story is a quiet
 * widening — an escalation, an impersonation, a "just this one" exception somewhere in
 * the policy — and an example-based test cannot see it: it checks the cells somebody
 * thought to name.
 *
 * So this sweeps the ENTIRE gating table. Every action outside the `administration`
 * family is denied for `poc-administrator`, with the reason the UX contract states, and
 * the administration family is allowed for that role and for nobody else. A new action
 * added to `GATED_ACTIONS` is covered the moment it is added.
 */

const ADMINISTRATION_PREFIX = 'administration.';

const isAdministration = (action: GatedAction): boolean =>
  action.startsWith(ADMINISTRATION_PREFIX);

/** The gating table's stated copy for the two rows a PoC Administrator is refused. */
const EXPECTED_ADMIN_REASON: Readonly<Record<string, string>> = {
  'procedure.author': DENIAL_REASONS.ADMIN_CANNOT_AUTHOR,
  'procedure.version.submit': DENIAL_REASONS.ADMIN_CANNOT_AUTHOR,
  'run.initiate': DENIAL_REASONS.ADMIN_CANNOT_AUTHOR,
  'run.pause': DENIAL_REASONS.ADMIN_CANNOT_AUTHOR,
  'run.resume': DENIAL_REASONS.ADMIN_CANNOT_AUTHOR,
  'run.cancel': DENIAL_REASONS.ADMIN_CANNOT_AUTHOR,
  'escalation.answer': DENIAL_REASONS.ADMIN_CANNOT_AUTHOR,
  'run.flag': DENIAL_REASONS.ADMIN_CANNOT_AUTHOR,
  'evaluation.confirm': DENIAL_REASONS.ADMIN_CANNOT_ALTER,
  'evaluation.reject': DENIAL_REASONS.ADMIN_CANNOT_ALTER,
  'exception.assign': DENIAL_REASONS.ADMIN_CANNOT_ALTER,
  'exception.disposition': DENIAL_REASONS.ADMIN_CANNOT_ALTER,
  'result.annotate': DENIAL_REASONS.ADMIN_CANNOT_ALTER,
  'result.submit': DENIAL_REASONS.ADMIN_CANNOT_ALTER,
};

describe('a PoC Administrator has no override path', () => {
  const gated = GATED_ACTIONS.filter((action) => !isAdministration(action));

  it('covers every action in the vocabulary, with none skipped', () => {
    // Guards the sweep itself: a filter that silently matched everything would make
    // every assertion below vacuous.
    expect(gated.length).toBeGreaterThan(0);
    expect(gated.length).toBe(GATED_ACTIONS.length - 4);
    expect(GATED_ACTIONS.filter(isAdministration)).toEqual([
      'administration.users.manage',
      'administration.registrations.manage',
      'administration.bindings.manage',
      'administration.diagnostics.read',
    ]);
  });

  it.each(gated)('denies %s', (action) => {
    const decision = authorizeAction('poc-administrator', action);
    expect(decision.allowed).toBe(false);
    expect(decision).toEqual({
      allowed: false,
      reason: EXPECTED_ADMIN_REASON[action] ?? DEFAULT_DENIAL_REASON,
    });
  });

  it('is not widened by any authorization context a caller could supply', () => {
    // The only context the policy reads is `authorId`, and only for version approval.
    // A handler that passed extra context — or a hostile caller that got one through —
    // must not turn a denial into an allowance for any action.
    const contexts = [
      {},
      { actorId: 'admin-1' },
      { authorId: 'admin-1' },
      { actorId: 'admin-1', authorId: 'somebody-else' },
      { actorId: undefined, authorId: undefined },
    ];
    for (const action of gated) {
      for (const context of contexts) {
        expect(
          authorizeAction('poc-administrator', action, context).allowed,
          `${action} with ${JSON.stringify(context)}`,
        ).toBe(false);
      }
    }
  });

  it('holds the four administration actions and nothing else', () => {
    for (const action of GATED_ACTIONS) {
      expect(authorizeAction('poc-administrator', action).allowed).toBe(isAdministration(action));
    }
  });

  it('is the only role that holds them', () => {
    for (const action of GATED_ACTIONS.filter(isAdministration)) {
      for (const role of ROLES.filter((candidate) => candidate !== 'poc-administrator')) {
        expect(authorizeAction(role, action)).toEqual({
          allowed: false,
          reason: DEFAULT_DENIAL_REASON,
        });
      }
      expect(authorizeAction(null, action)).toEqual({
        allowed: false,
        reason: DEFAULT_DENIAL_REASON,
      });
    }
  });

  it('has no action name that is not in the vocabulary yet still allowed', () => {
    // Prototype pollution and near-miss spellings. `authorizeAction` looks the action up
    // with `Object.hasOwn`, so an inherited property cannot become a rule.
    for (const candidate of [
      'constructor',
      'toString',
      '__proto__',
      'administration',
      'administration.',
      'administrationXusers.manage',
      'Administration.users.manage',
      'procedure.author ',
    ]) {
      expect(
        authorizeAction('poc-administrator', candidate as GatedAction),
        candidate,
      ).toEqual({ allowed: false, reason: DEFAULT_DENIAL_REASON });
    }
  });
});
