/**
 * Default-deny route protection (FR-1).
 *
 * Every path is protected unless it matches the explicit public allowlist below. A
 * route added by a later story is therefore protected the moment it exists, without
 * anybody remembering to protect it — the opposite of an allowlist of protected
 * prefixes, where forgetting one leaves it open.
 *
 * This module is pure: no request object, no database, no framework. `middleware.ts`
 * runs it on the edge and `route-access.test.ts` runs it on the eight families.
 */

/**
 * The eight protected route families FR-1 names, with the paths each covers. They are
 * declared here so a test can assert every family is protected without any of the
 * routes existing yet — Story 1.3 builds none of them.
 */
export const PROTECTED_ROUTE_FAMILIES = [
  { family: 'procedure', examples: ['/procedures', '/procedures/PRC-1', '/api/procedures'] },
  { family: 'run', examples: ['/runs', '/runs/RUN-2437', '/api/runs/RUN-2437'] },
  { family: 'evidence', examples: ['/runs/RUN-2437/evidence', '/api/evidence/EV-1'] },
  { family: 'exception', examples: ['/runs/RUN-2437/exceptions/EX-1', '/api/exceptions/EX-1'] },
  { family: 'live-view', examples: ['/runs/RUN-2437/live', '/api/runs/RUN-2437/events'] },
  { family: 'replay', examples: ['/runs/RUN-2437/replay', '/api/runs/RUN-2437/replay'] },
  { family: 'review', examples: ['/review', '/review/RES-1', '/api/review/RES-1'] },
  {
    family: 'administration',
    examples: ['/administration', '/administration/users', '/api/administration/users'],
  },
] as const;

export type ProtectedRouteFamily = (typeof PROTECTED_ROUTE_FAMILIES)[number]['family'];

/**
 * Exact paths that are public. Kept separate from the prefixes so `/sign-in-secretly`
 * is not accidentally public because `/sign-in` is.
 */
export const PUBLIC_EXACT_PATHS = ['/sign-in', '/api/health'] as const;

/**
 * Public path prefixes. Only two: the authentication endpoints (they must be reachable
 * to sign in at all) and Next's own static output, which carries no product data.
 */
export const PUBLIC_PATH_PREFIXES = [
  '/api/auth/',
  '/_next/static/',
  '/_next/image',
] as const;

/** Root-level files a browser or crawler fetches before any session exists. */
export const PUBLIC_ROOT_FILES = ['/favicon.ico', '/robots.txt', '/sitemap.xml'] as const;

function normalize(pathname: string): string {
  // A trailing slash must not create a second, unlisted spelling of a public path,
  // and it must not create an unlisted spelling of a protected one either.
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

/** `true` only for a path on the allowlist. Everything else is protected. */
export function isPublicPath(pathname: string): boolean {
  const path = normalize(pathname);
  if ((PUBLIC_EXACT_PATHS as readonly string[]).includes(path)) return true;
  if ((PUBLIC_ROOT_FILES as readonly string[]).includes(path)) return true;
  // `/api/auth` itself, with or without a sub-path.
  if (path === '/api/auth') return true;
  return PUBLIC_PATH_PREFIXES.some((prefix) => `${path}/`.startsWith(prefix));
}

/** The complement, stated positively because that is how the middleware reads. */
export function isProtectedPath(pathname: string): boolean {
  return !isPublicPath(pathname);
}

/** An API path answers a refusal with a status code; a page answers with a redirect. */
export function isApiPath(pathname: string): boolean {
  const path = normalize(pathname);
  return path === '/api' || path.startsWith('/api/');
}

/** Where an unauthenticated page request is sent. */
export const SIGN_IN_PATH = '/sign-in';
