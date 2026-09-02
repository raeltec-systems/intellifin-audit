'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { Role } from '@intellifin/domain';

import { BrandMark } from './BrandMark';
import { Icon } from './Icon';
import { countDescription, isActiveNavItem, navItemsFor } from './nav-rules';

export interface SidebarCounts {
  /**
   * Active Runs. Absent means "not counted"; a count is never guessed as zero, because
   * EXPERIENCE.md's cold-load rule is that no count is shown until it is loaded.
   * Nothing supplies these yet — counting active Runs means querying Runs, which Epic 2
   * creates, and counting the review queue means querying Results, which is Epic 4.
   */
  readonly runs?: number | undefined;
  /** Results awaiting a decision. */
  readonly review?: number | undefined;
}

interface SidebarProps {
  readonly role: Role | null;
  readonly counts?: SidebarCounts;
}

/** The `{spacing.sidebar}` navy rail. */
export function Sidebar({ role, counts }: SidebarProps): React.JSX.Element {
  const pathname = usePathname() ?? '/';
  const items = navItemsFor(role);

  return (
    <div className="ls-sidebar">
      <div className="ls-sidebar__mark">
        {/* The interlock mark, reverse variant — the one DESIGN.md puts on the sidebar. */}
        <BrandMark size={20} />
        <span className="ls-sidebar__wordmark">IntelliFin Audit</span>
      </div>
      <nav className="ls-sidebar__nav" aria-label="Main">
        {items.map((item) => {
          const active = isActiveNavItem(item.href, pathname);
          const raw = item.count ? counts?.[item.count] : undefined;
          // Nothing at all when the count is absent OR zero: "Runs 0" is noise beside
          // the word Runs, and the surface itself says an empty list is not a pass.
          const count = raw !== undefined && raw > 0 ? raw : null;
          return (
            <Link
              key={item.href}
              className="ls-nav-item"
              href={item.href}
              aria-current={active ? 'page' : undefined}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
              {count === null || item.count === undefined ? null : (
                <span className="ls-nav-item__count">
                  {count}
                  <span className="ls-visually-hidden">
                    {countDescription(item.count, count)}
                  </span>
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
