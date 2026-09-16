import type { ReactNode } from 'react';

import type { Role } from '@intellifin/domain';

import { EnvironmentRibbon } from '../design/EnvironmentRibbon';
import { Sidebar, type SidebarCounts } from '../design/Sidebar';
import { Breadcrumbs } from './Breadcrumbs';
import { BellLive } from './BellLive';
import { NotificationBell } from './NotificationBell';
import { SignedInAs } from './SignedInAs';
import { SignOutButton } from './SignOutButton';

interface AppShellProps {
  /**
   * The role the session holds right now, resolved on the server (AD-7). It reaches
   * the shell from `layout.tsx` and nowhere else — there is no control that sets it,
   * and nothing caches it between requests.
   */
  readonly role: Role | null;
  /**
   * Who is signed in, for the top bar's identity line. Absent when the identity could
   * not be resolved — the `degraded` arm, which keeps the shell and names nobody.
   *
   * `names` is `ActorNameReader`'s answer, not a name: an id with no row, or a name the
   * server could not read, comes back absent and `ActorName` then shows the id, which is
   * honest about what is known.
   */
  readonly signedIn?: {
    readonly userId: string;
    readonly names: ReadonlyMap<string, string>;
  };
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

/** One frozen empty map, so an unresolved identity allocates nothing per render. */
const EMPTY_NAMES: ReadonlyMap<string, string> = new Map();

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
  signedIn,
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
          {/*
            DESIGN.md specifies the top bar as the notification bell. Sign-out is added
            beside it because Epic 1 otherwise ships a product for a shared workstation
            with no way to end a session — see `sign-out-route.ts`. If the bar must stay
            bell-only, this one line and those two files are the whole of it.

            The identity line sits beside them for the same reason it sits beside Sign
            out on every product with a shared workstation: the control that ends a
            session has to say whose session it is ending, and every gated control on
            every page below is decided by the role printed here.
          */}
          <div className="ls-topbar">
            <SignedInAs
              userId={signedIn?.userId ?? null}
              names={signedIn?.names ?? EMPTY_NAMES}
              role={role}
            />
            <NotificationBell unread={unreadNotifications} />
            {unreadNotifications === undefined ? null : <BellLive />}
            <SignOutButton />
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
