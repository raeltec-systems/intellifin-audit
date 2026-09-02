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
  /**
   * Active Runs and Results awaiting a decision. Nothing supplies them yet: counting
   * them means querying Runs and Results, which Epics 2 and 4 create. Until then the
   * sidebar shows no count rather than a fabricated zero.
   */
  readonly counts?: SidebarCounts;
  /** Unread notifications. Supplied by the Notifications surface (FR-28), Epic 4. */
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
    // `id` is how `ConfirmDialog` finds the page to mark `inert` while it is open.
    <div className="ls-app" id="ls-app">
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
          {/* `tabIndex={-1}`: without it the skip link moves the scroll position and
              leaves focus on the link, so the next Tab walks the navigation again. */}
          <main className="ls-main" id="content" tabIndex={-1}>
            <Breadcrumbs />
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
