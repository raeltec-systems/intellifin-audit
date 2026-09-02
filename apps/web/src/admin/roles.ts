import { ROLES, type Role } from '@intellifin/domain';

/**
 * How the interface writes the three roles, and the option list every role control
 * offers.
 *
 * The vocabulary itself comes from `@intellifin/domain`, so a role added there appears
 * here without anybody remembering to add it — and a role removed there stops being
 * offerable. Only the labels are ours: `poc-administrator` is a stored value, "PoC
 * Administrator" is what a person reads.
 */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  auditor: 'Auditor',
  'audit-manager': 'Audit Manager',
  'poc-administrator': 'PoC Administrator',
};

export function roleLabel(role: Role | null): string {
  return role === null ? NO_ROLE_LABEL : ROLE_LABELS[role];
}

/** What an account with no `user_role` row shows. It is a state, never a default role. */
export const NO_ROLE_LABEL = 'No role';

export interface RoleOption {
  /** The posted value. The empty string means "no role", which a `<select>` cannot post as null. */
  readonly value: string;
  readonly label: string;
}

/** The options a role control offers, with revocation last. */
export const ROLE_OPTIONS: readonly RoleOption[] = [
  ...ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
  { value: '', label: NO_ROLE_LABEL },
];

/** The options the create form offers. Creating an account without a role is not one. */
export const ASSIGNABLE_ROLE_OPTIONS: readonly RoleOption[] = ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));
