import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { WorkspacePreviewMetadata, WorkspacePreviewMetadataStore, WorkspacePreviewReadPort, WorkspacePreviewViewer } from '@intellifin/application';

const LIMIT = 512 * 1024;
const HEADERS = { 'cache-control': 'no-store, private', 'content-type': 'application/json', 'x-content-type-options': 'nosniff' };
const signature = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('hex');
export function samePreviewEpoch(a: WorkspacePreviewMetadata, b: WorkspacePreviewMetadata): boolean {
  return a.runId === b.runId && a.runtimeId === b.runtimeId && a.workspaceRevision === b.workspaceRevision && a.privacyEpoch === b.privacyEpoch;
}
/** Fixed loopback single owner. No caller-controlled URL, redirect, provider access or public listener. */
export async function startWorkspacePreviewBroker(options: {
  port: number; secret: string; store: WorkspacePreviewMetadataStore; frames: WorkspacePreviewReadPort;
}): Promise<() => Promise<void>> {
  let active = 0;
  const nonces = new Map<string, number>();
  const server = createServer(async (request, response) => {
    const reply = (status: number, value: unknown = { status: 'unavailable' }) => {
      response.writeHead(status, HEADERS); response.end(JSON.stringify(value));
    };
    if (request.method !== 'POST' || request.url !== '/preview' || active >= 32) { reply(503); return; }
    active++;
    let bytes: Uint8Array | null = null;
    try {
      let body = '';
      for await (const chunk of request) {
        body += String(chunk);
        if (Buffer.byteLength(body) > 2048) { reply(400); return; }
      }
      const supplied = request.headers['x-preview-signature'];
      if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(signature(options.secret, body)))) { reply(403); return; }
      const input = JSON.parse(body) as { runId?: unknown; actorId?: unknown; sessionId?: unknown; at?: unknown; nonce?: unknown; image?: unknown; identity?: WorkspacePreviewMetadata };
      if (typeof input.runId !== 'string' || typeof input.actorId !== 'string' || typeof input.sessionId !== 'string'
        || typeof input.at !== 'number' || Math.abs(Date.now() - input.at) > 3000 || typeof input.nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(input.nonce)
        || typeof input.image !== 'boolean') { reply(400); return; }
      for (const [nonce, until] of nonces) if (until < Date.now()) nonces.delete(nonce);
      if (nonces.has(input.nonce) || nonces.size >= 1024) { reply(503); return; }
      nonces.set(input.nonce, Date.now() + 6000);
      const viewer = { actorId: input.actorId, sessionId: input.sessionId };
      const current = await options.store.authorized(input.runId, viewer);
      if (!current || !input.identity || !samePreviewEpoch(current, input.identity)) { reply(404); return; }
      // Even status demand registers the viewer; a viewer never drives its own sampler.
      const frame = await options.frames.read(current, viewer);
      bytes = frame?.bytes ?? null;
      const latest = await options.store.authorized(input.runId, viewer);
      if (!latest || !frame || !samePreviewEpoch(current, latest) || !samePreviewEpoch(frame.metadata, latest)) { reply(409); return; }
      if (bytes && (frame.metadata.sequence !== latest.sequence || frame.metadata.capturedAt !== latest.capturedAt)) { reply(409); return; }
      if (bytes && bytes.byteLength > LIMIT) { reply(503); return; }
      if (!options.frames.current(latest)) { reply(409); return; }
      reply(200, { metadata: latest, image: input.image && latest.mode === 'public' && bytes ? Buffer.from(bytes).toString('base64') : null });
    } catch { if (!response.headersSent) reply(503); else response.end(); }
    finally { bytes?.fill(0); active--; }
  });
  server.requestTimeout = 3000; server.headersTimeout = 3000; server.timeout = 3000; server.maxConnections = 40;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', resolve); });
  return () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
}

/** The web side also rechecks durable authority after bytes arrive. */
export class WorkspacePreviewProxy {
  private active = 0;
  constructor(private readonly port: number, private readonly secret: string, private readonly store: WorkspacePreviewMetadataStore) {}
  async read(runId: string, viewer: WorkspacePreviewViewer, image: boolean): Promise<{ metadata: WorkspacePreviewMetadata; image: string | null } | null> {
    if (this.active >= 32) return null;
    this.active++;
    try {
      const before = await this.store.authorized(runId, viewer);
      if (!before) return null;
      const body = JSON.stringify({ runId, ...viewer, image, identity: before, at: Date.now(), nonce: randomUUID() });
      const response = await fetch(`http://127.0.0.1:${this.port}/preview`, { method: 'POST', body, redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(2500), headers: { 'content-type': 'application/json', 'x-preview-signature': signature(this.secret, body) } });
      if (!response.ok || !response.body) return null;
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
          if (size > 710000) { await reader.cancel(); return null; } chunks.push(part.value); }
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { metadata: WorkspacePreviewMetadata; image: string | null };
        const after = await this.store.authorized(runId, viewer);
        if (!after || !parsed.metadata || !samePreviewEpoch(before, after) || !samePreviewEpoch(parsed.metadata, after)) return null;
        if (parsed.image !== null && (typeof parsed.image !== 'string' || parsed.image.length > 699052 || !/^[A-Za-z0-9+/]*={0,2}$/.test(parsed.image))) return null;
        return { metadata: after, image: image && after.mode === 'public' && after.sequence === parsed.metadata.sequence && after.capturedAt === parsed.metadata.capturedAt ? parsed.image : null };
      } finally { for (const chunk of chunks) chunk.fill(0); reader.releaseLock(); }
    } catch { return null; }
    finally { this.active--; }
  }
}
