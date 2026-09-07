/** The scheme+authority and path of a location, normalized for comparison. */
export interface FrozenLocation {
  /** `scheme://host[:port]`, lower-cased, with the scheme's own default port removed. */
  readonly authority: string;
  /** Always starts with `/`; never ends with one unless it is the root. */
  readonly path: string;
}

/** How long a destination may be before it is refused outright. */
const MAX_DESTINATION = 2048;

const ABSOLUTE_LOCATION = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?[^#]*)?(#.*)?$/;

function normalizedPath(raw: string): string | null {
  if (raw === '') return '/';
  if (!raw.startsWith('/')) return null;
  // Dot segments are REFUSED rather than resolved. An enforcement gate that normalized
  // `/loancore/../secret` would be doing the browser's job with the browser's rules, and
  // the two only have to disagree once. A location this platform chose to fetch never
  // needs one, and `%2e` is checked too because a browser decodes it before navigating.
  for (const segment of raw.split('/')) {
    const decoded = segment.replace(/%2e/gi, '.');
    if (decoded === '.' || decoded === '..') return null;
  }
  return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/**
 * A location this platform may act on, or `null`.
 *
 * Fail-closed on every doubt: only `http`/`https`, no credentials in the URL, no fragment,
 * no dot segment, no whitespace or control character, and a bound on the length. A
 * spelling this cannot read is denied rather than guessed at.
 */
export function parseFrozenLocation(raw: unknown): FrozenLocation | null {
  if (typeof raw !== 'string' || raw === '' || raw.length > MAX_DESTINATION) return null;
  // A URL a browser put on the wire holds no whitespace and no control character; one
  // that does was assembled by something that should not have been assembling one.
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return null;
  const match = ABSOLUTE_LOCATION.exec(raw);
  if (match === null) return null;
  const scheme = match[1]!.toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return null;
  // A fragment never goes on the wire; a location carrying one is not one this platform
  // chose. The browser interception strips it before asking, which is a different case.
  if (match[4] !== undefined) return null;
  const rawAuthority = match[2] ?? '';
  // `https://user:pass@host` — credentials in a URL, which the chain must never hold and
  // which no frozen origin may declare.
  if (rawAuthority === '' || rawAuthority.includes('@')) return null;
  let host = rawAuthority.toLowerCase();
  if (scheme === 'http' && host.endsWith(':80')) host = host.slice(0, -3);
  if (scheme === 'https' && host.endsWith(':443')) host = host.slice(0, -4);
  const path = normalizedPath(match[3] ?? '');
  if (path === null) return null;
  return { authority: `${scheme}://${host}`, path };
}

/**
 * `true` when `candidate` is the frozen origin or sits underneath it on a path boundary.
 *
 * ONE home for "stay inside the frozen origins". The adapter path, the Agent Workspace's
 * egress interception and this gate all reach it: `withinOrigin` in
 * `packages/infrastructure/src/runs/origin-policy.ts` is now a `URL`-shaped delegation to
 * this function, because `packages/application` and `packages/domain` have no `URL` and a
 * gate that could not ask the question would have needed a second copy of the answer.
 *
 * An allowed origin in this product is a base URL that MAY carry a path prefix
 * (`http://localhost:4300/loancore`), because one synthetic process serves every synthetic
 * Target System. So the comparison is authority AND path boundary: `/loancore-other` is
 * outside `/loancore`, and `/loancore/accounts` is inside it.
 */
export function withinFrozenOrigin(origin: unknown, candidate: unknown): boolean {
  const allowed = parseFrozenLocation(origin);
  const target = parseFrozenLocation(candidate);
  if (allowed === null || target === null) return false;
  if (allowed.authority !== target.authority) return false;
  if (allowed.path === '/') return true;
  return target.path === allowed.path || target.path.startsWith(`${allowed.path}/`);
}
