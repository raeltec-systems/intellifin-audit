import { DrizzleRoleRepository } from '@intellifin/infrastructure';

import { getRuntime } from '../../../src/bootstrap';
import { requireSession } from '../../../src/require-role';

/** The signed-in person's identity and the role they hold right now. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'cache-control': 'no-store' } as const;

/**
 * `GET /api/session`
 *
 * 200 `{"userId":"...","role":"auditor"|null}` for a signed-in caller.
 * 401 with an empty body otherwise.
 *
 * The role is read from `user_role` on every call, so this endpoint reports the state
 * a command would be authorized against — not something the session token remembers.
 * `role: null` is a real answer: a signed-in person who holds no role holds no action.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const result = await requireSession(request);
    if (!result.authenticated) {
      return new Response(null, { status: 401, headers: NO_STORE });
    }

    const runtime = await getRuntime();
    const role = await new DrizzleRoleRepository(runtime.db).findRole(result.session.userId);

    return Response.json(
      { userId: result.session.userId, role },
      { status: 200, headers: NO_STORE },
    );
  } catch {
    // Never echo a driver error to a caller. The health route says the same thing.
    return Response.json(
      { error: 'Session unavailable' },
      { status: 503, headers: NO_STORE },
    );
  }
}
