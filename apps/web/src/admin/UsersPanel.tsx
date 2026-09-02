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
 * That banner is cleared when the next mutation starts, and keyed by a counter. Both
 * matter. A success message left standing through the next attempt describes a change
 * that is no longer the one in front of the person; and a live region whose text does not
 * change is not re-announced, so two identical failures in a row would be silent to a
 * screen reader after the first. The key remounts the region, which announces again —
 * the same fix `sign-in-form.tsx` makes with its attempt counter.
 *
 * The list is a prop, rendered on the server and refreshed by `revalidatePath` after
 * every successful mutation. Nothing here holds a role in client state as authority — the
 * select is a draft of a request, and the server reads `user_role` again before it acts.
 * Nothing here carries a password or a session token either; `ManagedUser` has no field
 * that could.
 */

export interface UsersPanelProps {
  readonly users: readonly ManagedUser[];
  /** The signed-in administrator, so their own row can refuse to change its own role. */
  readonly currentUserId: string;
  /** How many rows the query would return at most. The surface says when it truncated. */
  readonly limit: number;
  readonly createUser: (fields: CreateUserFields) => Promise<AdministrationActionResult>;
  readonly setRole: (fields: SetRoleFields) => Promise<AdministrationActionResult>;
}

/** UTC, as everything in this product is. The date alone; the time adds nothing here. */
function createdOn(isoUtc: string): React.JSX.Element {
  return <time dateTime={isoUtc}>{isoUtc.slice(0, 10)}</time>;
}

export function UsersPanel({
  users,
  currentUserId,
  limit,
  createUser,
  setRole,
}: UsersPanelProps): React.JSX.Element {
  const [result, setResult] = useState<AdministrationActionResult | null>(null);
  /** Increments on every reported outcome, so an identical message re-announces. */
  const [announcement, setAnnouncement] = useState(0);

  function report(outcome: AdministrationActionResult): void {
    setResult(outcome);
    setAnnouncement((count) => count + 1);
  }

  /** A new mutation invalidates whatever the last one said. */
  function clear(): void {
    setResult(null);
  }

  const administratorCount = users.filter(
    (user) => user.role === 'poc-administrator',
  ).length;

  return (
    <div className="ls-stack">
      {result === null ? null : (
        <Banner
          key={announcement}
          tone={result.ok ? 'success' : 'danger'}
          title={result.ok ? result.message : result.reason}
        />
      )}

      <UserForm onSubmit={createUser} onResult={report} onStart={clear} />

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
            { key: 'created', header: 'Created (UTC)', render: (user) => createdOn(user.createdAt) },
            {
              key: 'change',
              header: 'Change role',
              render: (user) => (
                <RoleControl
                  key={`${user.userId}:${user.role ?? ''}`}
                  userId={user.userId}
                  userName={user.name}
                  currentRole={user.role}
                  isSelf={user.userId === currentUserId}
                  administratorCount={administratorCount}
                  onSubmit={setRole}
                  onResult={report}
                  onStart={clear}
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
        {users.length >= limit ? (
          <p className="ls-caption">
            Showing the first {limit} accounts, oldest first. This deployment has more;
            searching and paging them is not part of this release.
          </p>
        ) : null}
      </section>
    </div>
  );
}
