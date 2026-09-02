import type { ReactNode } from 'react';

import type { Role } from '@intellifin/domain';

import { EnvironmentRibbon } from '../design/EnvironmentRibbon';
import { Sidebar, type SidebarCounts } from '../design/Sidebar';
import { Breadcrumbs } from './Breadcrumbs';
import { NotificationBell } from './NotificationBell';

interface AppShellProps {
  /**
   * The role the session holds right now, resolved on the server (AD-7). It reaches
   * the shell from `layout.tsx` and nowhere else — there is no control that sets it,
   * and nothing caches it between requests.
   */
  readonly role: Role | null;
  readonly counts?: SidebarCounts;
  readonly unreadNotifications?: number | undefined;
  readonly children: ReactNode;
}

/**
 * The Ledger Signal shell: ribbon, top bar, sidebar, content.
 *
 * One shell composed once, so no later surface reinvents the chrome and no later story
 * has to re-argue where the ribbon sits or whether Administration is visible. Every
 * surface in Epics 2 through 9 renders as this component's `children`.
 *
 * The skip link is first in the DOM so a keyboard reaches the content without walking
 * the whole nav on every page.
 */
export function AppShell({
  role,
  counts,
  unreadNotifications,
  children,
}: AppShellProps): React.JSX.Element {
  return (
    <div className="ls-app">
      <a className="ls-skip-link" href="#content">
        Skip to content
      </a>
      <EnvironmentRibbon />
      <div className="ls-shell">
        <Sidebar role={role} counts={counts} />
        <div className="ls-column">
          <div className="ls-topbar">
            <NotificationBell unread={unreadNotifications} />
          </div>
          <main className="ls-main" id="content">
            <Breadcrumbs />
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
