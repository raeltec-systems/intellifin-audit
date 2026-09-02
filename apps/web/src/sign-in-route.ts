import { createHash } from 'node:crypto';

import {
  SESSION_COOKIE_NAMES,
  findSessionByToken,
  findUserIdByEmail,
  revokeSessionByToken,
  PostgresAuditUnitOfWork,
  type Telemetry,
} from '@intellifin/infrastructure';
import { recordSignInAttempt } from '@intellifin/application';

import { getRuntime } from './bootstrap';
import { correlationIdFrom } from './correlation';
import { handleSignOut, isSignOutPath } from './sign-out-route';

/**
 * The only public authentication surface (FR-1, FR-45).
 *
 * Better Auth performs the credential check; this wrapper owns two things it must not
 * be trusted to do for us:
 *
 *   1. **No user-existence disclosure.** Every unsuccessful sign-in — unknown address,
 *      wrong password, malformed body — is rewritten to one 401 with one sentence, so
 *      the caller learns that the attempt failed and nothing else. A rate-limited
 *      attempt keeps its 429 and gets its own sentence, because that outcome is about
 *      the caller's request rate and says nothing about any user.
 *   2. **No session without its event.** A successful sign-in appends `security.sign-in`
 *      before the cookie is handed over. If that append fails, the session row is
 *      deleted and the response carries no cookie: a session that exists unaudited
 *      would be exactly the gap FR-45 forbids.
 */

/**
 * The Better Auth endpoints this application actually serves.
 *
 * Better Auth mounts far more than the three below, and `/api/auth/**` is the ONE
 * publicly allowlisted surface in the whole application. Probing the mounted handler
 * (Story 1.5) found all of these live and reachable, none of them audited:
 *
 *   `revoke-session`, `revoke-sessions`, `revoke-other-sessions` — end sessions, which
 *       is the exact gap `handleSignOut` exists to close: a session ending with nothing
 *       in the chain;
 *   `change-password`, `change-email`, `update-user` — change identity, and a password
 *       change also silently revokes other sessions;
 *   `delete-user` — removes an account, orphaning every audit event that names it, which
 *       is why this story has no user deletion at all;
 *   `reset-password`, `send-verification-email`, `verify-email` — password reset and
 *       verification flows this product does not have and cannot send mail for.
 *
 * So this is an ALLOWLIST, not a denylist, for the same reason `route-access.ts` is: a
 * denylist is a list somebody has to remember to extend, and a dependency upgrade that
 * mounts a new endpoint would ship it publicly and unaudited. Anything not named here is
 * answered 404 — which is also what it looks like to a prober, disclosing nothing about
 * what the framework underneath does support.
 *
 * Adding one back means deciding how it is audited FIRST. That is the whole point.
 */
export const SERVED_AUTH_ENDPOINTS = [
  // The sign-in form posts here; the wrapper below audits every attempt.
  'sign-in/email',
  // The sign-out form posts here; `handleSignOut` revokes and audits in one transaction.
  'sign-out',
  // Read-only, and it returns only the caller's own session.
  'get-session',
] as const;

const SERVED = new Set<string>(SERVED_AUTH_ENDPOINTS);

/** The endpoint name under `/api/auth/`, or `null` when the path is not under it. */
export function authEndpointOf(pathname: string): string | null {
  const match = /^\/api\/auth\/(.+?)\/?$/.exec(pathname);
  return match?.[1] ?? null;
}

/** Whether this application serves that endpoint at all. */
export function isServedAuthEndpoint(pathname: string): boolean {
  const endpoint = authEndpointOf(pathname);
  return endpoint !== null && SERVED.has(endpoint);
}

/** The one thing a failed sign-in is ever told. */
export const SIGN_IN_FAILED_MESSAGE = 'Sign-in failed. Check your email address and password.';
/**
 * Said when Better Auth's rate limiter turned the attempt away. It is kept distinct
 * because "check your password" would be a lie, and it discloses nothing: the limit
 * counts requests from an address, not attempts against a user.
 */
export const SIGN_IN_RATE_LIMITED_MESSAGE = 'Too many sign-in attempts. Wait a moment and try again.';
/** Said when the attempt could not be recorded, which is not the caller's fault. */
export const SIGN_IN_UNAVAILABLE_MESSAGE = 'Sign-in is temporarily unavailable. Try again.';

const NO_STORE = { 'cache-control': 'no-store' } as const;

/** SHA-256 of the lower-cased address. The address itself never enters the chain. */
export function subjectHashOf(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}

/** `/api/auth/sign-in/email`, with or without a trailing slash. */
export function isEmailSignInPath(pathname: string): boolean {
  return /^\/api\/auth\/sign-in\/email\/?$/.test(pathname);
}

interface SignInBody {
  readonly email?: unknown;
}

interface SignInSuccess {
  readonly token?: unknown;
}

async function readEmail(request: Request): Promise<string | null> {
  try {
    const body = (await request.clone().json()) as SignInBody;
    return typeof body.email === 'string' && body.email.length > 0 ? body.email : null;
  } catch {
    return null;
  }
}

async function readToken(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as SignInSuccess;
    return typeof body.token === 'string' && body.token.length > 0 ? body.token : null;
  } catch {
    return null;
  }
}

/**
 * Turn Better Auth's refusal into ours.
 *
 * Non-disclosure only requires that a wrong password and an unknown address be
 * indistinguishable; it does not require pretending an outage is a wrong password.
 * A 5xx therefore answers 503, a 429 keeps its status, and only the 4xx credential
 * refusals collapse into the one generic 401.
 */
function failed(status: number): Response {
  if (status === 429) {
    return Response.json(
      { error: SIGN_IN_RATE_LIMITED_MESSAGE },
      { status: 429, headers: NO_STORE },
    );
  }
  if (status >= 500) return unavailable();
  return Response.json({ error: SIGN_IN_FAILED_MESSAGE }, { status: 401, headers: NO_STORE });
}

/**
 * Every session token a sign-in response could have issued.
 *
 * Better Auth returns the token in the body AND sets it as a cookie whose value is
 * `<token>.<signature>`; the `token` column holds the part before the dot. When the
 * body cannot be read the cookie is the only handle on the row that was just created,
 * so both are collected and all of them are revoked.
 */
export function issuedSessionTokens(response: Response, bodyToken: string | null): string[] {
  const tokens = new Set<string>();
  if (bodyToken) tokens.add(bodyToken);
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const separator = pair?.indexOf('=') ?? -1;
    if (!pair || separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    if (!SESSION_COOKIE_NAMES.some((cookieName) => name === cookieName)) continue;
    const raw = decodeURIComponent(pair.slice(separator + 1).trim());
    const value = raw.split('.')[0];
    if (value) tokens.add(value);
  }
  return [...tokens];
}

function unavailable(): Response {
  return Response.json(
    { error: SIGN_IN_UNAVAILABLE_MESSAGE },
    { status: 503, headers: NO_STORE },
  );
}

/**
 * Delete the session rows a refused sign-in issued.
 *
 * A failure here is NOT swallowed. It means an unaudited, live session survived the
 * request — the exact state this whole path exists to prevent — so it is captured
 * rather than discarded, and the caller still gets a refusal. Silently dropping the
 * error would leave the session live with nothing in the log stream to find it by.
 */
async function revokeIssued(
  runtime: { db: Parameters<typeof revokeSessionByToken>[0]; telemetry: Telemetry },
  tokens: readonly string[],
  correlationId: string,
): Promise<void> {
  for (const token of tokens) {
    try {
      await revokeSessionByToken(runtime.db, token);
    } catch (error) {
      runtime.telemetry.captureError('Sign-in session revoke failed', error, {
        outcome: 'failure',
        correlationId,
      });
    }
  }
}

/**
 * Handle one request to the mounted Better Auth handler, auditing sign-in attempts.
 * Every other authentication endpoint passes straight through.
 */
export async function handleAuthRequest(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);

  // Refused BEFORE the runtime is touched, so an unserved endpoint costs nothing and
  // cannot be used to probe whether the database is up.
  if (!isServedAuthEndpoint(pathname)) {
    return new Response(null, { status: 404, headers: NO_STORE });
  }

  // Sign-out is audited too, and it revokes the session in the same transaction as its
  // event rather than letting Better Auth commit the deletion on its own connection.
  if (request.method === 'POST' && isSignOutPath(pathname)) {
    return handleSignOut(request);
  }

  const runtime = await getRuntime();

  if (request.method !== 'POST' || !isEmailSignInPath(pathname)) {
    return runtime.auth.handler(request);
  }

  const correlationId = correlationIdFrom(request);
  const email = await readEmail(request);
  // An attempt with no address is still an attempt, and it still gets one answer.
  const subjectHash = subjectHashOf(email ?? '');
  const unitOfWork = new PostgresAuditUnitOfWork(runtime.db);

  const response = await runtime.auth.handler(request);

  if (!response.ok) {
    // Attribute the failure when the address matches a user, and to `unknown` when it
    // does not — the response is identical either way.
    let userId: string | null = null;
    try {
      userId = email ? await findUserIdByEmail(runtime.db, email) : null;
      await recordSignInAttempt(unitOfWork, {
        outcome: 'failure',
        userId: userId ?? undefined,
        subjectHash,
        correlationId,
      });
    } catch (error) {
      runtime.telemetry.captureError('Sign-in audit failed', error, {
        outcome: 'failure',
        statusCode: response.status,
        correlationId,
      });
      return unavailable();
    }
    runtime.telemetry.info('Sign-in refused', {
      outcome: 'failure',
      statusCode: response.status,
      correlationId,
    });
    return failed(response.status);
  }

  const token = await readToken(response);
  if (!token) {
    // A 2xx we cannot tie to a session row is not a sign-in we can audit. Better Auth
    // may already have written the row, and dropping the response does not remove it,
    // so revoke whatever this response issued before refusing.
    await revokeIssued(runtime, issuedSessionTokens(response, null), correlationId);
    runtime.telemetry.error('Sign-in could not be attributed', {
      outcome: 'failure',
      statusCode: response.status,
      correlationId,
    });
    return unavailable();
  }

  try {
    const session = await findSessionByToken(runtime.db, token);
    if (!session) throw new Error('Session row not found for the issued token');
    await recordSignInAttempt(unitOfWork, {
      outcome: 'success',
      userId: session.userId,
      subjectHash,
      sessionId: session.sessionId,
      correlationId,
    });
    runtime.telemetry.info('Sign-in recorded', {
      outcome: 'success',
      userId: session.userId,
      sessionId: session.sessionId,
      correlationId,
    });
    return response;
  } catch (error) {
    // Fail closed: undo the session rather than serve a cookie no event backs.
    await revokeIssued(runtime, issuedSessionTokens(response, token), correlationId);
    runtime.telemetry.captureError('Sign-in audit failed', error, {
      outcome: 'failure',
      correlationId,
    });
    return unavailable();
  }
}
