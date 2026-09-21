import { readRunControlLease } from '@intellifin/infrastructure';
import { getRuntime } from '../../../../../src/bootstrap';
import { denialResponse, requireAction } from '../../../../../src/require-role';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const headers = { 'cache-control': 'no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Independent reads cannot hold renewal/safety commands in Next's action queue. */
export async function GET(request: Request, context: { readonly params: Promise<{ readonly id: string }> }): Promise<Response> {
  try {
    const permission = await requireAction(request, 'run.resume');
    if (!permission.allowed) return denialResponse(permission);
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ status: 'missing' }, { status: 400, headers });
    const runtime = await getRuntime();
    const read = await readRunControlLease(runtime.db, {
      runId: id.toLowerCase(), actorId: permission.session.userId,
      requiredForUnenrolledRun: runtime.conversationEnabled,
    });
    return Response.json(read.status === 'ready' ? { ...read, actorId: permission.session.userId, transferEligible: read.transferEligible && runtime.conversationEnabled } : read, { status: read.status === 'denied' ? 403 : read.status === 'missing' ? 404 : 200, headers });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers });
  }
}
