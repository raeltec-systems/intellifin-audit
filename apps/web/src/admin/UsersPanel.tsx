'use client';

import Link from 'next/link';
import { useId, useState } from 'react';

import type { ManagedUser } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { DataTable } from '../design/DataTable';
import { Timestamp } from '../design/Timestamp';
import { RoleControl } from './RoleControl';
import { UserForm } from './UserForm';
import { ROLE_OPTIONS, roleLabel } from './roles';
import {
  ADD_USER_SUMMARY,
  CHANGE_USER_SUMMARY,
  ONBOARDING_STEPS,
  ONBOARDING_TITLE,
  USERS_EMPTY_HEADLINE,
  USERS_EMPTY_SENTENCE,
  USER_FILTER_CLEAR,
  USER_FILTER_SUBMIT,
  USER_ROLE_FILTER_ANY,
  USER_ROLE_FILTER_LABEL,
  USER_ROLE_FILTER_NONE,
  USER_SEARCH_EMPTY_HEADLINE,
  USER_SEARCH_EMPTY_SENTENCE,
  USER_SEARCH_LABEL,
  changeUserLabel,
  userPageSentence,
} from './administration-words';
import {
  USER_FILTER_ROLE_NONE,
  isFiltered,
  pageCount,
  pageRange,
  usersHref,
  type UserDirectoryFilter,
} from './user-directory-query';
import type {
  AdministrationActionResult,
  CreateUserFields,
  SetRoleFields,
} from '../../app/administration/actions';

/**
 * The user directory (FR-2, FR-7; UI cleanup 2026-09-22, UX-38, UX-39, UX-40).
 *
 * The walkthrough met 72 accounts laid out over 7,601 pixels, every row carrying a role
 * select, a button and a column nobody could explain, with no way to find one person.
 * Three things changed and the guarantees underneath did not.
 *
 * **The list is first.** "Add a user" is a disclosure at the foot, beside the one block
 * that says how the person actually signs in; the surface a reader came to read is the
 * one they meet.
 *
 * **The search and the page are in the URL**, so a filtered directory can be shared and
 * the back button works. The filter is applied by the DATABASE — a filter over a bounded
 * page can only search the prefix somebody happened to fetch, and then reports "no
 * matches" about an account that is really there — and the total beside the page is an
 * exact `count(*)` rather than the length of the rows on screen.
 *
 * **A row's controls are behind one "Change" disclosure**, with the two guardrails
 * stated inside it rather than only when the command refuses.
 *
 * It owns ONE banner, cleared when the next mutation starts and keyed by a counter. Both
 * matter: a success left standing through the next attempt describes a change that is no
 * longer in front of the person, and a live region whose text does not change is not
 * re-announced, so two identical failures would be silent after the first.
 *
 * Nothing here holds a role in client state as authority — the select is a draft of a
 * request, and the server reads `user_role` again before it acts. Nothing here carries a
 * password or a session token either; `ManagedUser` has no field that could.
 */

export interface UsersPanelProps {
  /** One page of accounts, already filtered and ordered by the database. */
  readonly users: readonly ManagedUser[];
  /** The EXACT number of accounts matching the filter, never `users.length`. */
  readonly total: number;
  readonly filter: UserDirectoryFilter;
  /** The signed-in administrator, so their own row can refuse to change its own role. */
  readonly currentUserId: string;
  /**
   * The EXACT number of PoC Administrators in this deployment.
   *
   * It used to be counted from the rendered rows, which was right for an unpaged list and
   * is wrong the moment one page can hold fewer accounts than the deployment has: the
   * last administrator could sit on page three, and every row on page one would offer a
   * change the command then refuses. The command is still the control; this decides
   * whether the reason is stated before somebody is refused.
   */
  readonly administratorCount: number;
  readonly createUser: (fields: CreateUserFields) => Promise<AdministrationActionResult>;
  readonly setRole: (fields: SetRoleFields) => Promise<AdministrationActionResult>;
  /** Submits the filter and lands the browser on the matching GET URL. */
  readonly searchUsers: (form: FormData) => Promise<void>;
}

export function UsersPanel({
  users,
  total,
  filter,
  currentUserId,
  administratorCount,
  createUser,
  setRole,
  searchUsers,
}: UsersPanelProps): React.JSX.Element {
  const searchId = useId();
  const roleId = useId();
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

  const filtered = isFiltered(filter);
  const range = pageRange(filter, users.length);
  const pages = pageCount(total);

  return (
    <div className="ls-stack">
      {result === null ? null : (
        <Banner
          key={announcement}
          tone={result.ok ? 'success' : 'danger'}
          title={result.ok ? result.message : result.reason}
        />
      )}

      {/*
        `method="POST"` and a Server Action, landing on a GET URL: see
        `app/administration/users/actions.ts`. A Server Action form submits natively, so
        the search works with no JavaScript at all.
      */}
      <form className="ls-admin-filter" method="POST" action={searchUsers}>
        <div className="ls-dialog__field">
          <label htmlFor={searchId}>{USER_SEARCH_LABEL}</label>
          <input
            className="ls-input"
            id={searchId}
            name="q"
            type="search"
            autoComplete="off"
            defaultValue={filter.search}
          />
        </div>
        <div className="ls-dialog__field">
          <label htmlFor={roleId}>{USER_ROLE_FILTER_LABEL}</label>
          <select className="ls-select" id={roleId} name="role" defaultValue={filter.role ?? ''}>
            <option value="">{USER_ROLE_FILTER_ANY}</option>
            {ROLE_OPTIONS.filter((option) => option.value !== '').map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value={USER_FILTER_ROLE_NONE}>{USER_ROLE_FILTER_NONE}</option>
          </select>
        </div>
        <div className="ls-admin-filter__actions">
          <Button type="submit" variant="secondary" size="md">
            {USER_FILTER_SUBMIT}
          </Button>
          {filtered ? <Link href={usersHref({ search: '' })}>{USER_FILTER_CLEAR}</Link> : null}
        </div>
      </form>

      <section className="ls-stack">
        <h2>Users and roles</h2>
        <DataTable<ManagedUser>
          caption="Every account this search matches, and the role it holds right now."
          first={{ header: 'Name', label: (user) => user.name }}
          rowKey={(user) => user.userId}
          rows={users}
          columns={[
            { key: 'email', header: 'Email address', render: (user) => user.email },
            { key: 'role', header: 'Role', render: (user) => roleLabel(user.role) },
            {
              key: 'created',
              header: 'Created',
              render: (user) => <Timestamp value={user.createdAt} precision="minute" />,
            },
            {
              key: 'change',
              header: CHANGE_USER_SUMMARY,
              render: (user) => (
                <details className="ls-disclosure ls-row-change">
                  {/*
                    The visible word is "Change" and the accessible name names the
                    person, so a screen reader hearing the control out of the row's
                    context still knows whose it is. A visually hidden span rather than
                    `aria-label`: no ARIA at all is the `Digest` doctrine, and nothing a
                    role rule can silently drop.
                  */}
                  <summary>
                    {CHANGE_USER_SUMMARY}
                    <span className="ls-visually-hidden">{changeUserLabel(user.name)}</span>
                  </summary>
                  <div className="ls-disclosure__body">
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
                  </div>
                </details>
              ),
            },
          ]}
          empty={
            filtered
              ? { headline: USER_SEARCH_EMPTY_HEADLINE, sentence: USER_SEARCH_EMPTY_SENTENCE }
              : { headline: USERS_EMPTY_HEADLINE, sentence: USERS_EMPTY_SENTENCE }
          }
        />

        {/*
          The exact total beside the bounded page. `rows.length` here would say "25
          accounts" for a deployment holding hundreds, which is the one number on this
          page an operator has no other way to check.
        */}
        {users.length === 0 ? null : (
          <p className="ls-caption">{userPageSentence(range.from, range.to, total)}</p>
        )}

        {pages > 1 ? (
          <nav className="ls-admin-pages" aria-label="Directory pages">
            {filter.page > 1 ? (
              <Link href={usersHref({ ...filter, page: filter.page - 1 })} rel="prev">
                Previous
              </Link>
            ) : null}
            <span>
              Page {filter.page.toLocaleString('en-US')} of {pages.toLocaleString('en-US')}
            </span>
            {filter.page < pages ? (
              <Link href={usersHref({ ...filter, page: filter.page + 1 })} rel="next">
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>

      <details className="ls-disclosure">
        <summary>{ADD_USER_SUMMARY}</summary>
        <div className="ls-disclosure__body ls-stack">
          <section className="ls-stack">
            <h3>{ONBOARDING_TITLE}</h3>
            <ol className="ls-onboarding">
              {ONBOARDING_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
          <UserForm onSubmit={createUser} onResult={report} onStart={clear} />
        </div>
      </details>
    </div>
  );
}
