import { FRAME_LOCATOR, FRAME_MEDIA_TYPE, requestEvidenceReadGrant } from '@intellifin/application';
import {
  CryptoUuidV7Generator,
  DrizzleRunDetailRepository,
  DrizzleRunRepository,
  PostgresEvidenceReadGrantRepository,
  SystemClock,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../../../../../src/bootstrap';
import { correlationIdFrom } from '../../../../../../src/correlation';
import { denialResponse, requireAction } from '../../../../../../src/require-role';
import { readFrameWithGrant, type EvidenceFrameReadFailure } from '../../../../../../src/runs/evidence-frame-reader';

/** A frame is read through a worker-signed grant on every request. Never static. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'cache-control': 'no-store' } as const;

/**
 * A frame's URL names one registered artifact whose bytes can never change (its digest is
 * the `ETag`), so a browser may keep it for the grant's own lifetime and revalidate with
 * `If-None-Match`, which answers 304 under a FRESH role check and without a grant. It is
 * `private`: the role is the viewer's, not a cache's.
 */
export const FRAME_CACHE_CONTROL = 'private, max-age=300';

/** How long the route waits for the worker to sign the grant before answering 503. */
export const FRAME_GRANT_WAIT_MS = 5_000;

/**
 * What each read failure answers. A grant the worker has not signed yet is a retryable
 * 503; a role lost between the request and the download is 403; every disagreement
 * between the store and the registered metadata is 502, because the bytes are not what
 * the Run registered and the route must not serve them as though they were.
 */
export const FRAME_FAILURE_STATUS: Readonly<Record<EvidenceFrameReadFailure, number>> = {
  'grant-unavailable': 503,
  'access-denied': 403,
  'frame-locator-mismatch': 500,
  'capability-mismatch': 502,
  'download-failed': 502,
  'download-object-missing': 502,
  'download-redirected': 502,
  'download-media-type-mismatch': 502,
  'download-too-large': 502,
  'download-size-mismatch': 502,
  'download-digest-mismatch': 502,
};

/**
 * `GET /api/runs/<id>/frames/<evidenceId>` — one registered screenshot, as `image/png`.
 *
 * Authorizes with the action that gates viewing a Run, BEFORE resolving the Run or the
 * artifact, so a probe learns nothing from the difference between a Run that exists and
 * one that does not. The artifact must be a REGISTERED screenshot of this Run bound to the
 * Tool Action that captured it (`readFrame`); anything else is a 404. The bytes reach the
 * browser only through a worker-signed, actor-bound grant consumed on this server: no
 * object-store URL is ever in the response. The contract is
 * `docs/contracts/live-view-v1.md`.
 */
export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string; readonly evidenceId: string }> },
): Promise<Response> {
  try {
    const decision = await requireAction(request, 'run.initiate');
    if (!decision.allowed) return denialResponse(decision);
    const { id, evidenceId } = await context.params;
    const runtime = await getRuntime();
    const run = await new DrizzleRunRepository(runtime.db).findRun(id);
    if (run === null) return new Response(null, { status: 404, headers: NO_STORE });
    const frame = await new DrizzleRunDetailRepository(runtime.db).readFrame(run.runId, evidenceId.toLowerCase());
    if (frame === null) return new Response(null, { status: 404, headers: NO_STORE });
    const etag = `"${frame.digest}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { etag, 'cache-control': FRAME_CACHE_CONTROL } });
    }

    const grants = new PostgresEvidenceReadGrantRepository(runtime.db);
    const correlationId = correlationIdFrom(request);
    const requested = await requestEvidenceReadGrant(
      { repository: grants, ids: new CryptoUuidV7Generator(), clock: new SystemClock() },
      { session: decision.session, correlationId, request: { runId: run.runId, evidenceId: frame.evidenceId, locator: FRAME_LOCATOR } },
    );
    if (!requested.ok) return Response.json({ reason: requested.reason }, { status: 400, headers: NO_STORE });
    const read = await readFrameWithGrant(
      grants,
      {
        grantId: requested.grantId,
        runId: run.runId,
        evidenceId: frame.evidenceId,
        actorId: decision.session.userId,
        locator: FRAME_LOCATOR,
        correlationId,
        maxGrantWaitMs: FRAME_GRANT_WAIT_MS,
      },
      { reportIntegrityMismatch: (mismatch) => grants.reportIntegrityMismatch(mismatch) },
    );
    if (read.frame === null) {
      const status = FRAME_FAILURE_STATUS[read.failure];
      return Response.json(
        { reason: read.failure },
        { status, headers: status === 503 ? { ...NO_STORE, 'retry-after': '2' } : NO_STORE },
      );
    }
    // A fresh, exactly sized buffer: the verified bytes and nothing around them.
    const body = read.frame.bytes.slice().buffer as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': FRAME_MEDIA_TYPE,
        'content-length': String(read.frame.size),
        etag,
        'cache-control': FRAME_CACHE_CONTROL,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    // Never echo a driver error to a caller. The events route says the same thing.
    return Response.json({ error: 'Frame unavailable' }, { status: 503, headers: NO_STORE });
  }
}
