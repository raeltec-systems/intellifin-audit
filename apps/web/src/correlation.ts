import { randomUUID } from 'node:crypto';

/**
 * One correlation chain per request (AD-10).
 *
 * The audit vocabulary restricts identifiers to
 * `[A-Za-z0-9][A-Za-z0-9:._/-]{0,254}`, so a caller-supplied header is accepted only
 * when it already fits. Anything else is replaced rather than sanitized: a header is
 * attacker-controlled, and a "cleaned" version of a hostile value is still their value.
 */
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,254}$/;

export const CORRELATION_HEADER = 'x-correlation-id';

export function correlationIdFrom(request: Request): string {
  const supplied = request.headers.get(CORRELATION_HEADER);
  if (supplied && SAFE_ID_PATTERN.test(supplied)) return supplied;
  return randomUUID();
}
