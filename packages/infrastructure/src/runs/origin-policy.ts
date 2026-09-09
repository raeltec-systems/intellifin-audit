import { withinFrozenOrigin } from '@intellifin/domain';

/**
 * "Stay inside the frozen allowed origins", as ONE rule.
 *
 * It was private to `adapter-extraction-http.ts` until the Agent Workspace's egress
 * interception needed the same judgement (Story 4.1), and it moved again in Story 4.2:
 * the Tool Action gate has to ask the same question from `packages/application`, which
 * has no host types at all and therefore no `URL`. So the RULE now lives in
 * `packages/domain/src/runs/tool-action.ts` as a string comparison, and this file is the
 * `URL`-shaped door onto it for the two callers that already hold parsed URLs.
 *
 * Two copies would agree on every value anybody thought to try and diverge on the first
 * one nobody did — a trailing slash, a path that is a prefix of another path's name, a
 * URL carrying credentials — and each would look correct because each would be checked
 * only against itself. The same reason `canonical-json.ts` and `COLLECTION_ENVELOPE_KEYS`
 * each have exactly one home.
 *
 * An allowed origin in this product is a base URL that MAY carry a path prefix
 * (`http://localhost:4300/loancore`), because one synthetic process serves every synthetic
 * Target System. So the comparison is authority AND path boundary: `/loancore-other` is
 * outside `/loancore`, and `/loancore/accounts` is inside it.
 */

/**
 * `true` when `candidate` is the frozen origin or sits underneath it on a path boundary.
 *
 * `href` rather than the parts, because that is the value the domain rule parses and
 * `URL` has already normalized it — the default port dropped, the host lower-cased, dot
 * segments resolved — so the two agree on the spellings a browser actually produces.
 */
export function withinOrigin(origin: URL, candidate: URL): boolean {
  return withinFrozenOrigin(origin.href, candidate.href);
}
