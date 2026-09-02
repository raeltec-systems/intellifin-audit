import { authorizeAction, type Role } from '@intellifin/domain';

import type { IconName } from './icons';

/**
 * The sidebar's rules, as plain functions.
 *
 * They live beside `Sidebar.tsx` rather than inside it so they can be tested without a
 * DOM: the story's own constraint is that component behaviour is proven in the browser
 * Playwright provides, but "which item does this path highlight" is arithmetic on a
 * string and deserves a unit test that names every case.
 */

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  readonly count?: 'runs' | 'review';
}

/**
 * EXPERIENCE.md → Information Architecture: "Sidebar areas: Overview · Procedures ·
 * Runs · Review · Administration, with counts on Runs (active) and Review (awaiting)."
 * Administration is listed separately and added below; the order is the contract's.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Overview', icon: 'layout-dashboard' },
  { href: '/procedures', label: 'Procedures', icon: 'file-text' },
  { href: '/runs', label: 'Runs', icon: 'play', count: 'runs' },
  { href: '/review', label: 'Review', icon: 'inbox', count: 'review' },
];

export const ADMINISTRATION_ITEM: NavItem = {
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

/** The items one role sees, in order. */
export function navItemsFor(role: Role | null): readonly NavItem[] {
  return showsAdministration(role) ? [...NAV_ITEMS, ADMINISTRATION_ITEM] : NAV_ITEMS;
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

/** What a count means, read out, counted correctly at one. */
export function countDescription(kind: 'runs' | 'review', count: number): string {
  if (kind === 'runs') return ` active ${count === 1 ? 'Run' : 'Runs'}`;
  return ` ${count === 1 ? 'Result' : 'Results'} awaiting your decision`;
}
