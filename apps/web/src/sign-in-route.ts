import { createHash } from 'node:crypto';

import {
  findSessionByToken,
  findUserIdByEmail,
  revokeSessionByToken,
  PostgresAuditUnitOfWork,
} from '@intellifin/infrastructure';
import { recordSignInAttempt } from '@intellifin/application';

import { getRuntime } from './bootstrap';
import { correlationIdFrom } from './correlation';

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

function failed(status: number): Response {
  if (status === 429) {
    return Response.json(
      { error: SIGN_IN_RATE_LIMITED_MESSAGE },
      { status: 429, headers: NO_STORE },
    );
  }
  return Response.json({ error: SIGN_IN_FAILED_MESSAGE }, { status: 401, headers: NO_STORE });
}

function unavailable(): Response {
  return Response.json(
    { error: SIGN_IN_UNAVAILABLE_MESSAGE },
    { status: 503, headers: NO_STORE },
  );
}

/**
 * Handle one request to the mounted Better Auth handler, auditing sign-in attempts.
 * Every other authentication endpoint passes straight through.
 */
export async function handleAuthRequest(request: Request): Promise<Response> {
  const runtime = await getRuntime();
  const { pathname } = new URL(request.url);

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
      runtime.telemetry.captureError('Sign-in refused', error, {
        outcome: 'failure',
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
    // A 2xx we cannot tie to a session row is not a sign-in we can audit.
    runtime.telemetry.error('Sign-in refused', { outcome: 'failure', correlationId });
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
    await revokeSessionByToken(runtime.db, token).catch(() => undefined);
    runtime.telemetry.captureError('Sign-in refused', error, {
      outcome: 'failure',
      correlationId,
    });
    return unavailable();
  }
}
