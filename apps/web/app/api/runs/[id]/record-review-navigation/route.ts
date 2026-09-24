import { RECORD_REVIEW_FILTERS } from '@intellifin/application';
import { getRuntime } from '../../../../../src/bootstrap';
import { denialResponse, requireAction } from '../../../../../src/require-role';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store' };

/** POST-first navigation works before hydration and reauthorizes before accepting input. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const app = await getRuntime();
  if (request.headers.get('origin') !== new URL(app.authConfig.baseUrl).origin) return new Response(null, { status: 403, headers });
  const permission = await requireAction(request, 'run.initiate');
  if (!permission.allowed) return denialResponse(permission);
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded' || !request.body) {
    return new Response(null, { status: 400, headers });
  }
  const reader = request.body.getReader();
  let body = '';
  const decoder = new TextDecoder('utf8', { fatal: true });
  try {
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) return new Response(null, { status: 413, headers });
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch { return new Response(null, { status: 400, headers }); }
  finally { void reader.cancel().catch(() => {}); }
  const form = new URLSearchParams(body), query = new URLSearchParams();
  const search = (form.get('search') ?? '').trim(), filter = form.get('filter') ?? 'all';
  if (search.length > 120 || /[\u0000-\u001f\u007f]/u.test(search) || !(RECORD_REVIEW_FILTERS as readonly string[]).includes(filter)) {
    return new Response(null, { status: 400, headers });
  }
  if (search) query.set('search', search);
  if (filter !== 'all') query.set('filter', filter);
  if (form.get('pageSize') === '50') query.set('pageSize', '50');
  return new Response(null, { status: 303, headers: { ...headers,
    location: `/runs/${encodeURIComponent(id)}/evidence${query.size ? `?${query}` : ''}`,
  } });
}
