import { isRole, type Role } from '@intellifin/domain';

/**
 * What the user directory is filtered and paged by, read from and written to the URL
 * (UI cleanup 2026-09-22, UX-38).
 *
 * The filter lives in the query string rather than in client state, so a search can be
 * shared, bookmarked and reached by the back button, and so the page renders the right
 * rows before any JavaScript arrives. This module is the ONE place a query string becomes
 * a filter and a filter becomes a link: two spellings of "which page is this" is how a
 * pagination link ends up dropping the search somebody just typed.
 */

/** How many accounts one page of the directory holds. */
export const USER_PAGE_SIZE = 25;

/** The posted value that means "an account holding no role at all". */
export const USER_FILTER_ROLE_NONE = 'none';

export interface UserDirectoryFilter {
  /** What was typed, trimmed. The empty string is no search. */
  readonly search: string;
  /** A role, `'none'`, or absent for every account. */
  readonly role?: Role | typeof USER_FILTER_ROLE_NONE;
  /** 1-based. Out-of-range values read as page 1 rather than as an error. */
  readonly page: number;
}

/** The first value for a parameter, whichever way Next hands the query over. */
function first(value: string | readonly string[] | undefined): string {
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? (value[0] ?? '') : '';
}

/**
 * The filter a request asks for.
 *
 * Everything here is request input: a page that is not a number, a role nothing knows,
 * a search longer than anything a person types. Each is narrowed to something the read
 * can hold rather than refused — a search box that answers a typed URL with an error
 * teaches people not to edit the URL, and the read itself is bounded either way.
 */
export function readUserFilter(
  params: Record<string, string | string[] | undefined> = {},
): UserDirectoryFilter {
  const search = first(params['q']).trim().slice(0, 200);
  const role = first(params['role']);
  const page = Number.parseInt(first(params['page']), 10);
  return {
    search,
    ...(role === USER_FILTER_ROLE_NONE || isRole(role) ? { role } : {}),
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
  };
}

/** Whether anything is being filtered, which decides which empty state is true. */
export function isFiltered(filter: Pick<UserDirectoryFilter, 'search' | 'role'>): boolean {
  return filter.search !== '' || filter.role !== undefined;
}

/**
 * The link for a filter. Page 1 is written without `page`, so the ordinary URL is short
 * and two links to the same page are the same string.
 */
export function usersHref(
  filter: Partial<UserDirectoryFilter> & { readonly search?: string },
): string {
  const query = new URLSearchParams();
  const search = (filter.search ?? '').trim();
  if (search !== '') query.set('q', search);
  if (filter.role !== undefined) query.set('role', filter.role);
  if (filter.page !== undefined && filter.page > 1) query.set('page', String(filter.page));
  const rendered = query.toString();
  return rendered === '' ? '/administration/users' : `/administration/users?${rendered}`;
}

/** The rows this page covers, 1-based and inclusive, for the sentence beside the page. */
export function pageRange(
  filter: UserDirectoryFilter,
  rows: number,
): { readonly from: number; readonly to: number } {
  const from = (filter.page - 1) * USER_PAGE_SIZE + 1;
  return { from, to: from + Math.max(0, rows - 1) };
}

/** How many pages the exact total makes, at least one so "page 1 of 1" is sayable. */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / USER_PAGE_SIZE));
}
