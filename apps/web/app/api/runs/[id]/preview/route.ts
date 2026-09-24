import { getRuntime } from '../../../../../src/bootstrap';
import { requireAction } from '../../../../../src/require-role';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
export async function GET(request: Request, context: { readonly params: Promise<{ readonly id: string }> }): Promise<Response> {
  try {
    const decision = await requireAction(request, 'run.initiate');
    if (!decision.allowed) return Response.json({ status: 'unavailable' }, { status: 403, headers });
    const { id } = await context.params;
    const runtime = await getRuntime();
    const result = await runtime.workspacePreview?.read(id, { actorId: decision.session.userId, sessionId: decision.session.sessionId }, new URL(request.url).searchParams.get('image') === '1');
    return result ? Response.json(result, { headers }) : Response.json({ status: 'unavailable' }, { status: 503, headers });
  } catch { return Response.json({ status: 'unavailable' }, { status: 503, headers }); }
}
