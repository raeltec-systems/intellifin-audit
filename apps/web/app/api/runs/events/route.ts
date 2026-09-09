import { openRunTimelineStream } from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { denialResponse, requireAction } from '../../../../src/require-role';
import { SSE_HEADERS } from '../[id]/events/route';

/** The live Timeline channel for every Run: the Runs list's and the badge's wake-up (Story 5.1, AD-17). */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'cache-control': 'no-store' } as const;

/**
 * `GET /api/runs/events`
 *
 * Forwards every Run's committed Timeline events, each read from the chain, with no
 * cursor and no replay guarantee: a list refreshes whole. Same gate as the list page.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const decision = await requireAction(request, 'run.initiate');
    if (!decision.allowed) return denialResponse(decision);
    const runtime = await getRuntime();
    const stream = openRunTimelineStream(
      { sql: runtime.sql, db: runtime.db },
      { runId: null, after: 0, signal: request.signal },
    );
    return new Response(stream, { status: 200, headers: SSE_HEADERS });
  } catch {
    return Response.json({ error: 'Live channel unavailable' }, { status: 503, headers: NO_STORE });
  }
}
