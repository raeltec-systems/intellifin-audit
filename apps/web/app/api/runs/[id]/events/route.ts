import { DrizzleRunRepository, openRunTimelineStream } from '@intellifin/infrastructure';

import { getRuntime } from '../../../../../src/bootstrap';
import { denialResponse, requireAction } from '../../../../../src/require-role';
import { parseLiveCursor } from '../../../../../src/runs/live-status';

/** The live Timeline channel for one Run (Story 5.1, AD-17). Never cached, never static. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'cache-control': 'no-store' } as const;

/** `no-transform` and the buffering hint keep a proxy from holding frames back; the response is not cacheable. */
export const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const;

export const BAD_CURSOR = 'The cursor must be a non-negative integer.';

/**
 * `GET /api/runs/<id>/events[?after=<seq>]`
 *
 * Authorizes with the action that gates viewing a Run, BEFORE resolving the Run, so an
 * unauthenticated probe learns nothing from the difference between a Run that exists
 * and one that does not. Then replays the chain past the cursor and follows it live.
 * The contract is `docs/contracts/live-timeline-channel-v1.md`.
 */
export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  try {
    const decision = await requireAction(request, 'run.initiate');
    if (!decision.allowed) return denialResponse(decision);
    const { id } = await context.params;
    const runtime = await getRuntime();
    const run = await new DrizzleRunRepository(runtime.db).findRun(id);
    if (run === null) return new Response(null, { status: 404, headers: NO_STORE });
    const cursor = parseLiveCursor(new URL(request.url), request.headers.get('last-event-id'));
    if (cursor === null) return Response.json({ reason: BAD_CURSOR }, { status: 400, headers: NO_STORE });
    const stream = openRunTimelineStream(
      { sql: runtime.sql, db: runtime.db },
      { runId: run.runId, after: cursor, signal: request.signal },
    );
    return new Response(stream, { status: 200, headers: SSE_HEADERS });
  } catch {
    // Never echo a driver error to a caller. The session route says the same thing.
    return Response.json({ error: 'Live channel unavailable' }, { status: 503, headers: NO_STORE });
  }
}
