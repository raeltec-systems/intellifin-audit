/**
 * "Stay inside the frozen allowed origins", as ONE rule.
 *
 * It was private to `adapter-extraction-http.ts` until the Agent Workspace's egress
 * interception needed the same judgement (Story 4.1). Both import it from here. Two copies
 * would agree on every value anybody thought to try and diverge on the first one nobody
 * did — a trailing slash, a path that is a prefix of another path's name, a URL carrying
 * credentials — and each would look correct because each would be checked only against
 * itself. The same reason `canonical-json.ts` and `COLLECTION_ENVELOPE_KEYS` each have
 * exactly one home.
 *
 * An allowed origin in this product is a base URL that MAY carry a path prefix
 * (`http://localhost:4300/loancore`), because one synthetic process serves every synthetic
 * Target System. So the comparison is authority AND path boundary: `/loancore-other` is
 * outside `/loancore`, and `/loancore/accounts` is inside it.
 */

/** `true` when `candidate` is the frozen origin or sits underneath it on a path boundary. */
export function withinOrigin(origin: URL, candidate: URL): boolean {
  if (candidate.origin !== origin.origin || candidate.protocol !== origin.protocol) return false;
  if (candidate.username !== '' || candidate.password !== '' || candidate.hash !== '') return false;
  const base = origin.pathname.replace(/\/$/, '');
  if (base === '') return true;
  return candidate.pathname === base || candidate.pathname.startsWith(`${base}/`);
}
