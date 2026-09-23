import type { Metadata } from 'next';

import { DrizzleUserDirectory, USER_LIST_LIMIT } from '@intellifin/infrastructure';

import { AdministrationTabs } from '../../../src/admin/AdministrationTabs';
import { UsersPanel } from '../../../src/admin/UsersPanel';
import { ADMINISTRATION_AREAS } from '../../../src/admin/administration-words';
import {
  USER_PAGE_SIZE,
  readUserFilter,
} from '../../../src/admin/user-directory-query';
import { Banner } from '../../../src/design/Banner';
import { PageHeader } from '../../../src/design/PageHeader';
import { getRuntime } from '../../../src/bootstrap';
import { requireServerAction } from '../../../src/server-session';
import { createUserAction, setUserRoleAction, setUserRunControlTransferGrantAction } from '../actions';
import { searchUsersAction } from './actions';

export const metadata: Metadata = { title: 'Users · IntelliFin Audit' };

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * Administration — Users (FR-2, FR-7; UI cleanup 2026-09-22, UX-38, UX-41).
 *
 * This is the directory the landing used to be. It has its own route because the landing
 * is now the summary of all three areas, and because `/administration/users` is the path
 * package 1 already registered a breadcrumb label for.
 *
 * The sidebar removes Administration for everybody but a PoC Administrator, and that
 * removal is presentation: anybody can type the path. So the surface itself asks the
 * audited authorization path, which resolves the role fresh from `user_role`, applies the
 * pure domain policy, and appends the refusal to the audit chain before returning it.
 *
 * On refusal the page renders the reason and NOTHING else — no tabs, no counts, no user
 * list, no "you could ask an administrator for X" that discloses what X is.
 *
 * The check here protects THIS PAGE. The three Server Actions passed to `UsersPanel` are
 * separate POST endpoints that Next exposes by id, and each authorizes for itself before
 * it reads its input; see `../actions.ts` and `./actions.ts`. Passing them from inside
 * this branch is a convenience of composition, never the control.
 *
 * Three reads: one page of accounts, the exact total matching the filter, and the exact
 * number of administrators. The last used to be counted from the rendered rows, which
 * stopped being the deployment's number the moment the list gained pages.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const decision = await requireServerAction('administration.users.manage');

  if (!decision.allowed) {
    return (
      <div className="ls-stack">
        <h1>{ADMINISTRATION_AREAS['/administration/users'].title}</h1>
        <Banner tone="danger" title={decision.reason} />
      </div>
    );
  }

  const filter = readUserFilter(await searchParams);
  const runtime = await getRuntime();
  const directory = new DrizzleUserDirectory(runtime.db, USER_LIST_LIMIT);

  const [users, total, administratorCount] = await Promise.all([
    directory.pageUsers({
      search: filter.search,
      ...(filter.role === undefined ? {} : { role: filter.role }),
      limit: USER_PAGE_SIZE,
      offset: (filter.page - 1) * USER_PAGE_SIZE,
    }),
    directory.countUsers({
      search: filter.search,
      ...(filter.role === undefined ? {} : { role: filter.role }),
    }),
    directory.countUsers({ role: 'poc-administrator' }),
  ]);

  return (
    <div className="ls-stack">
      <PageHeader
        title={ADMINISTRATION_AREAS['/administration/users'].title}
        lede={ADMINISTRATION_AREAS['/administration/users'].purpose}
      />
      <AdministrationTabs current="/administration/users" />
      <UsersPanel
        users={users}
        total={total}
        filter={filter}
        currentUserId={decision.session.userId}
        administratorCount={administratorCount}
        createUser={createUserAction}
        setRole={setUserRoleAction}
        setTransferGrant={setUserRunControlTransferGrantAction}
        searchUsers={searchUsersAction}
      />
    </div>
  );
}
