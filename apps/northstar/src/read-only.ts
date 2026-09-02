import { READ_METHODS, isReadMethod, json, type NorthstarRequest, type NorthstarResponse } from './http.js';

/**
 * The read-only rule, in one place, applied once (FR-3).
 *
 * Every synthetic Northstar system is read-only AT THE SYSTEM LEVEL, so that FR-3 is
 * enforced by the system as well as by the registration's permitted-action allowlist. An
 * audit credential that has somehow been talked into attempting a write meets a refusal
 * from the thing it is writing to, not only from the thing that asked.
 *
 * Two decisions make this hold rather than merely be true today:
 *
 *   1. It runs BEFORE routing, in `handleRequest`, so it is not something a route can
 *      forget. A route added by a later story is read-only before it is written.
 *   2. It runs before routing for a second reason: a write to a path that does not exist
 *      must still be REFUSED, not 404'd. A 404 tells a Run "there is nothing here"; a
 *      405 tells it "this system does not accept that, and here is the rule". The
 *      difference is what a Run can record.
 *
 * The denial is JSON on every surface, including the two web ones. A refusal a Run must
 * be able to record is a refusal that should not need parsing out of a page.
 */

/** The verbatim sentence. `read-only.test.ts` and the browser suite hold it to the character. */
export const READ_ONLY_RULE =
  'FR-3: an audit credential may not write. Every Northstar synthetic system is read-only ' +
  'at the system level and refuses any method other than GET or HEAD.';

export const READ_ONLY_ERROR = 'read_only_system';

export function readOnlyDenial(request: NorthstarRequest): NorthstarResponse {
  const denial = json(405, {
    error: READ_ONLY_ERROR,
    rule: READ_ONLY_RULE,
    message: `This system is read-only. The method ${request.method} is refused.`,
    method: request.method,
    path: request.path,
    allowed: [...READ_METHODS],
  });
  return {
    ...denial,
    // RFC 9110 requires `Allow` on a 405. Without it the refusal is a status code with no
    // statement of what the system does accept.
    headers: { ...denial.headers, allow: READ_METHODS.join(', ') },
  };
}

/** `null` when the request may proceed to routing. */
export function enforceReadOnly(request: NorthstarRequest): NorthstarResponse | null {
  return isReadMethod(request.method) ? null : readOnlyDenial(request);
}
