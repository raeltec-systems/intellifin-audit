import { generateAuthoringSuggestion, isAuthoringDraftFields, PROCEDURE_AUTHOR_ACTION } from '@intellifin/application';
import { CryptoUuidV7Generator, DrizzleRoleRepository, PostgresProceduresUnitOfWork } from '@intellifin/infrastructure';
import { getRuntime } from '../../../../src/bootstrap';
import { correlationIdFrom } from '../../../../src/correlation';
import { denialResponse, requireAction } from '../../../../src/require-role';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store, no-transform', 'content-type': 'application/x-ndjson', 'x-accel-buffering': 'no' };

async function readInput(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json' || !request.body) throw new Error('Invalid input');
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Input timed out')), 10_000); });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 96 * 1024) throw new Error('Input too large');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}

/** Only display delivery changes here. The same reserved request, final validation,
 * audit receipt and independent acceptance command remain authoritative. */
export async function POST(request: Request): Promise<Response> {
  const app = await getRuntime();
  // Cookie-authenticated custom routes do not inherit Server Action CSRF checks.
  // Never derive the trusted origin from Host or proxy headers supplied by a caller.
  if (request.headers.get('origin') !== new URL(app.authConfig.baseUrl).origin) {
    return Response.json({ reason: 'Open writing help from this application.' }, { status: 403, headers });
  }
  // Reject foreign requests before an authorization refusal can append an audit event.
  const decision = await requireAction(request, PROCEDURE_AUTHOR_ACTION);
  if (!decision.allowed) return denialResponse(decision);
  let fields: unknown;
  try { fields = await readInput(request); } catch { return Response.json({ reason: 'That writing request was not valid.' }, { status: 400, headers }); }
  if (!isAuthoringDraftFields(fields)) return Response.json({ reason: 'That writing request was not valid.' }, { status: 400, headers });
  const input = fields, encoder = new TextEncoder();
  const correlationId = correlationIdFrom(request);
  let connected = true, progressCount = 0, failureReported = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: object) => {
        if (!connected) return;
        try { controller.enqueue(encoder.encode(JSON.stringify({ ...event, requestId: input.requestId }) + '\n')); }
        catch { connected = false; }
      };
      // A disconnected browser stops receiving chunks; bounded provider work still
      // completes the receipt so a retry of this exact request can recover it.
      void (async () => {
        try {
          const result = await generateAuthoringSuggestion({
            roles: new DrizzleRoleRepository(app.db), unitOfWork: new PostgresProceduresUnitOfWork(app.db),
            ids: new CryptoUuidV7Generator(), clock: { now: () => new Date() }, model: app.authoringModel,
            observeFailure: (stage, error) => {
              failureReported = true;
              app.telemetry.captureError('Writing assistance failed', error, {
                correlationId, aggregateId: input.procedureId, operation: stage, outcome: 'failure',
              });
            },
          }, { ...input, session: decision.session, correlationId }, progress => {
            if (++progressCount <= 128) send({ type: 'progress', progress });
          });
          send({ type: 'result', result });
        } catch (error) {
          if (!failureReported) app.telemetry.captureError('Writing assistance failed', error, {
            correlationId, aggregateId: input.procedureId, operation: 'delivery', outcome: 'failure',
          });
          send({ type: 'uncertain' });
        }
        finally { if (connected) { connected = false; controller.close(); } }
      })();
    },
    cancel() { connected = false; },
  });
  return new Response(stream, { headers });
}
