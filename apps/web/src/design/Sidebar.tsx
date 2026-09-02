'use client';

import { usePathname } from 'next/navigation';

import { authorizeAction, type Role } from '@intellifin/domain';

import { Icon, type IconName } from './Icon';

export interface SidebarCounts {
  /** Active Runs. Absent means "not loaded"; a count is never guessed as zero. */
  readonly runs?: number | undefined;
  /** Results awaiting a decision. */
  readonly review?: number | undefined;
}

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  readonly count?: 'runs' | 'review';
}

/**
 * EXPERIENCE.md → Information Architecture: "Sidebar areas: Overview · Procedures ·
 * Runs · Review · Administration, with counts on Runs (active) and Review (awaiting)."
 * Administration is listed here and filtered below; the order is the contract's.
 */
const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Overview', icon: 'layout-dashboard' },
  { href: '/procedures', label: 'Procedures', icon: 'file-text' },
  { href: '/runs', label: 'Runs', icon: 'play', count: 'runs' },
  { href: '/review', label: 'Review', icon: 'inbox', count: 'review' },
];

const ADMINISTRATION: NavItem = {
  href: '/administration',
  label: 'Administration',
  icon: 'settings',
};

/**
 * Whether the Administration item is shown.
 *
 * It asks the domain policy the same question the Administration route asks, rather
 * than testing `role === 'poc-administrator'` — a second copy of the rule that would
 * quietly disagree the first time the policy changes. Hiding the item is presentation
 * only: the route refuses a non-administrator on the server whether it is shown or not.
 */
export function showsAdministration(role: Role | null): boolean {
  return authorizeAction(role, 'administration.users.manage').allowed;
}

/**
 * Which sidebar item a path highlights. Run Detail, Exception Detail, Live View and
 * Replay keep Runs highlighted; the Builder, Procedure Detail and Version review keep
 * Procedures highlighted — which is what "the item whose href is a path prefix" means.
 * Overview is the exception: it is `/`, a prefix of everything, so it matches exactly.
 */
export function isActiveNavItem(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface SidebarProps {
  readonly role: Role | null;
  readonly counts?: SidebarCounts;
}

/** The `{spacing.sidebar}` navy rail. */
export function Sidebar({ role, counts }: SidebarProps): React.JSX.Element {
  const pathname = usePathname() ?? '/';
  const items = showsAdministration(role) ? [...NAV_ITEMS, ADMINISTRATION] : NAV_ITEMS;

  return (
    <div className="ls-sidebar">
      <div className="ls-sidebar__mark">
        {/* Gold appears here and nowhere else: the IntelliFin mark. */}
        <span className="ls-sidebar__mark-glyph" aria-hidden="true">
          ▮
        </span>
        <span className="ls-sidebar__wordmark">IntelliFin Audit</span>
      </div>
      <nav className="ls-sidebar__nav" aria-label="Main">
        {items.map((item) => {
          const active = isActiveNavItem(item.href, pathname);
          const count = item.count ? counts?.[item.count] : undefined;
          return (
            <a
              key={item.href}
              className="ls-nav-item"
              href={item.href}
              aria-current={active ? 'page' : undefined}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
              {count === undefined ? null : (
                <span className="ls-nav-item__count">
                  {count}
                  <span className="ls-visually-hidden">
                    {item.count === 'runs' ? ' active Runs' : ' awaiting your decision'}
                  </span>
                </span>
              )}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
