'use client';

import { useState } from 'react';

import type { ManagedUser } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { DataTable } from '../design/DataTable';
import { RoleControl } from './RoleControl';
import { UserForm } from './UserForm';
import { roleLabel } from './roles';
import type {
  AdministrationActionResult,
  CreateUserFields,
  SetRoleFields,
} from '../../app/administration/actions';

/**
 * The Users and roles surface (FR-2, FR-7).
 *
 * It owns ONE banner. EXPERIENCE.md says the result of a mutating action shows as a
 * Banner on the surface the person is on, and a surface has one such place: a banner per
 * control would give a screen reader several live regions racing to announce the same
 * kind of thing.
 *
 * The list is a prop, rendered on the server and refreshed by `revalidatePath` after
 * every successful mutation. Nothing here holds a role in client state as authority — the
 * select is a draft of a request, and the server reads `user_role` again before it acts.
 * Nothing here carries a password or a session token either; `ManagedUser` has no field
 * that could.
 */

export interface UsersPanelProps {
  readonly users: readonly ManagedUser[];
  readonly createUser: (fields: CreateUserFields) => Promise<AdministrationActionResult>;
  readonly setRole: (fields: SetRoleFields) => Promise<AdministrationActionResult>;
}

export function UsersPanel({ users, createUser, setRole }: UsersPanelProps): React.JSX.Element {
  const [result, setResult] = useState<AdministrationActionResult | null>(null);

  return (
    <div className="ls-stack">
      {result === null ? null : (
        <Banner
          tone={result.ok ? 'success' : 'danger'}
          title={result.ok ? result.message : result.reason}
        />
      )}

      <UserForm onSubmit={createUser} onResult={setResult} />

      <section className="ls-stack">
        <h2>Users and roles</h2>
        <DataTable<ManagedUser>
          caption="Every account in this environment and the role it holds right now."
          first={{ header: 'Name', label: (user) => user.name }}
          rowKey={(user) => user.userId}
          rows={users}
          columns={[
            { key: 'email', header: 'Email address', render: (user) => user.email },
            { key: 'role', header: 'Role', render: (user) => roleLabel(user.role) },
            {
              key: 'change',
              header: 'Change role',
              render: (user) => (
                <RoleControl
                  key={`${user.userId}:${user.role ?? ''}`}
                  userId={user.userId}
                  userName={user.name}
                  currentRole={user.role}
                  onSubmit={setRole}
                  onResult={setResult}
                />
              ),
            },
          ]}
          empty={{
            headline: 'No accounts exist yet.',
            sentence:
              'Every account in this environment would be listed here with the role it holds. An empty list does not mean access is controlled; it means nobody can sign in.',
          }}
        />
      </section>
    </div>
  );
}
