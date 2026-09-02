import type { Metadata } from 'next';

import { DrizzleUserDirectory, USER_LIST_LIMIT } from '@intellifin/infrastructure';

import { UsersPanel } from '../../src/admin/UsersPanel';
import { Banner } from '../../src/design/Banner';
import { getRuntime } from '../../src/bootstrap';
import { requireServerAction } from '../../src/server-session';
import { createUserAction, setUserRoleAction } from './actions';

export const metadata: Metadata = { title: 'Administration · IntelliFin Audit' };

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * Administration — Users and roles.
 *
 * The sidebar removes this item for everybody but a PoC Administrator, and that removal
 * is presentation: anybody can type the path. So the surface itself asks the audited
 * authorization path, which resolves the role fresh from `user_role`, applies the pure
 * domain policy, and appends the refusal to the audit chain before returning it.
 *
 * On refusal the page renders the reason and NOTHING else — no headings, no counts, no
 * user list, no "you could ask an administrator for X" that discloses what X is.
 *
 * The check here protects THIS PAGE. The two Server Actions passed to `UsersPanel` are
 * separate POST endpoints that Next exposes by id, and each authorizes for itself before
 * it reads its input; see `actions.ts`. Passing them from inside this branch is a
 * convenience of composition, never the control.
 *
 * Target System registrations, Population Source bindings and diagnostics are Stories
 * 1.6, 1.7 and 9.2. This surface deliberately says nothing about them.
 */
export default async function AdministrationPage(): Promise<React.JSX.Element> {
  const decision = await requireServerAction('administration.users.manage');

  if (!decision.allowed) {
    return (
      <div className="ls-stack">
        <h1>Administration</h1>
        <Banner tone="danger" title={decision.reason} />
      </div>
    );
  }

  const runtime = await getRuntime();
  const users = await new DrizzleUserDirectory(runtime.db, USER_LIST_LIMIT).listUsers();

  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>Administration</h1>
        <p>
          Users and roles. Target System registrations, Population Source bindings and
          platform diagnostics are not part of this release.
        </p>
      </header>
      <UsersPanel
        users={users}
        currentUserId={decision.session.userId}
        limit={USER_LIST_LIMIT}
        createUser={createUserAction}
        setRole={setUserRoleAction}
      />
    </div>
  );
}
