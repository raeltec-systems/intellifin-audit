import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspacePreviewMetadataStore, WorkspacePreviewReadPort } from '@intellifin/application';
const server = vi.hoisted(() => ({ handler: null as unknown as (request: unknown, response: unknown) => Promise<void> }));
vi.mock('node:http', () => ({ createServer: (handler: typeof server.handler) => {
  server.handler = handler;
  return { once: vi.fn(), listen: (_port: number, host: string, done: () => void) => { expect(host).toBe('127.0.0.1'); done(); }, close: vi.fn(), closeAllConnections: vi.fn() };
} }));
import { startWorkspacePreviewBroker } from './workspace-preview-transport.js';
const secret = 'test-only-synthetic-secret-32-characters';
const metadata = { runId: 'run', runtimeId: 'runtime', workspaceRevision: 1, privacyEpoch: 2, mode: 'public' as const, sequence: 3, capturedAt: 1000, captureCompletedAt: 1100, expiresAt: 5000 };
async function fixture() {
  const store: WorkspacePreviewMetadataStore = { claim: vi.fn(async () => 1), publish: vi.fn(async () => true), current: vi.fn(async () => true), authorized: vi.fn(async () => metadata) };
  const bytes = new Uint8Array([1, 2]);
  const frames: WorkspacePreviewReadPort = { current: vi.fn(() => true), read: vi.fn(async () => ({ metadata, bytes })) };
  await startWorkspacePreviewBroker({ port: 4311, secret, store, frames });
  const body = JSON.stringify({ runId: 'run', actorId: 'actor', sessionId: 'session', identity: metadata, image: true, at: Date.now(), nonce: '11111111-1111-4111-8111-111111111111' });
  const send = async (input = body, signed = true) => {
    let status = 0, output = '';
    const headers = { 'x-preview-signature': signed ? createHmac('sha256', secret).update(input).digest('hex') : '0'.repeat(64) };
    await server.handler({ method: 'POST', url: '/preview', headers, async *[Symbol.asyncIterator]() { yield Buffer.from(input); } },
      { writeHead: (code: number, values: object) => { status = code; expect(values).toMatchObject({ 'cache-control': 'no-store, private' }); }, end: (value: string) => { output = value; } });
    return { status, output };
  };
  return { store, frames, bytes, send, body };
}
describe('private broker authentication and synchronous publication fencing', () => {
  it('refuses unsigned input before touching authority or bytes, and refuses replayed signed input', async () => {
    const f = await fixture(); expect((await f.send(f.body, false)).status).toBe(403); expect(f.store.authorized).not.toHaveBeenCalled();
    expect((await f.send()).status).toBe(200); expect(f.bytes).toEqual(new Uint8Array(2));
    expect((await f.send()).status).toBe(503); expect(f.frames.read).toHaveBeenCalledOnce();
  });
  it('refuses a valid signature bound to an old runtime and never asks for pixels', async () => {
    const f = await fixture(); const input = JSON.parse(f.body); input.identity.runtimeId = 'old';
    expect((await f.send(JSON.stringify(input))).status).toBe(404); expect(f.frames.read).not.toHaveBeenCalled();
  });
  it('checks local privacy again synchronously after fresh durable authorization', async () => {
    const f = await fixture(); vi.mocked(f.frames.current).mockReturnValue(false);
    const response = await f.send(); expect(response.status).toBe(409); expect(response.output).not.toContain('AQI='); expect(f.bytes).toEqual(new Uint8Array(2));
  });
  it('projects source errors and expired requests to fixed unavailable output', async () => {
    const f = await fixture(); vi.mocked(f.store.authorized).mockRejectedValueOnce(new Error('secret target authentication text'));
    const response = await f.send(); expect(response.status).toBe(503); expect(response.output).toBe('{"status":"unavailable"}');
    const input = JSON.parse(f.body); input.at -= 5000; expect((await f.send(JSON.stringify(input))).status).toBe(400);
  });
});
