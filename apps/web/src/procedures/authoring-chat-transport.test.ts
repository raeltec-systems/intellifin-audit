import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthoringDraftFields } from '@intellifin/application';
import { streamAuthoringSuggestion } from './authoring-chat-transport';
const fields: AuthoringDraftFields = { procedureId: 'procedure', versionId: 'version', requestId: 'request', expectedRowVersion: 'row', section: { kind: 'scope' }, mode: 'draft', notes: 'All records', changes: '' };
const progress = { explanation: 'Checking the population', proposedText: null, clarification: null };
const suggestion = { requestId: fields.requestId, section: fields.section, authoringRevision: 0, currentText: '', proposedText: 'Check all records.', clarifications: [], state: 'ready', stale: false, message: null };
const frame = (event: object) => new TextEncoder().encode(JSON.stringify({ requestId: fields.requestId, ...event }) + '\n');
afterEach(() => vi.unstubAllGlobals());
describe('authoring chat client transport', () => {
  it.each([400, 401, 403, 413, 429])('shows an actionable refusal for HTTP %s, without treating it as lost delivery', async status => {
    vi.stubGlobal('fetch', async () => new Response('PRIVATE_PROXY_BODY', { status }));
    const result = await streamAuthoringSuggestion(fields);
    expect(result).toMatchObject({ ok: false, reason: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROXY_BODY');
  });
  it('keeps HTTP 500 uncertain because a receipt might have committed', async () => {
    vi.stubGlobal('fetch', async () => new Response('PRIVATE_SERVER_BODY', { status: 500 }));
    await expect(streamAuthoringSuggestion(fields)).rejects.toThrow('Writing response unavailable');
  });
  it('returns a confirmed failed receipt so manual editing and a new request remain available', async () => {
    const failed = { ...suggestion, state: 'failed', proposedText: null, message: 'OpenAI could not authenticate writing assistance.' };
    vi.stubGlobal('fetch', async () => new Response(frame({ type: 'result', result: { ok: true, suggestion: failed } })));
    expect(await streamAuthoringSuggestion(fields)).toEqual({ ok: true, suggestion: failed });
  });
  it('shows only validated request-owned partials and waits for the authoritative result', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
      expect(init.credentials).toBe('same-origin'); expect(JSON.parse(String(init.body))).toEqual(fields);
      return new Response(new ReadableStream({ start(c) { stream = c; } }));
    }));
    const updates = vi.fn(); let completed = false;
    const pending = streamAuthoringSuggestion(fields, updates).then(value => { completed = true; return value; });
    await vi.waitFor(() => expect(stream).toBeDefined());
    const first = frame({ type: 'progress', progress });
    stream.enqueue(first.slice(0, 7)); stream.enqueue(first.slice(7));
    await vi.waitFor(() => expect(updates).toHaveBeenCalledWith(progress));
    expect(completed).toBe(false);
    stream.enqueue(frame({ type: 'result', result: { ok: true, suggestion } }));
    expect(await pending).toEqual({ ok: true, suggestion });
  });
  it.each([
    [{ type: 'progress', progress, requestId: 'another-request' }],
    [{ type: 'progress', progress: { ...progress, tool: 'activate' } }],
    [{ type: 'progress', progress: { ...progress, explanation: 'x'.repeat(2001) } }],
    [{ type: 'result', result: { ok: true, suggestion: { ...suggestion, section: { kind: 'objective' } } } }],
    [{ type: 'uncertain' }],
  ])('rejects malformed, unrelated or uncertain frames', async event => {
    vi.stubGlobal('fetch', async () => new Response(frame(event)));
    const updates = vi.fn();
    await expect(streamAuthoringSuggestion(fields, updates)).rejects.toThrow();
    expect(updates).not.toHaveBeenCalled();
  });
  it('never turns EOF after partial output into a suggestion and does not retry automatically', async () => {
    const fetcher = vi.fn(async () => new Response(frame({ type: 'progress', progress })));
    vi.stubGlobal('fetch', fetcher);
    const updates = vi.fn();
    await expect(streamAuthoringSuggestion(fields, updates)).rejects.toThrow('incomplete');
    expect(updates).toHaveBeenCalledWith(progress); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds oversized frames before presenting them', async () => {
    vi.stubGlobal('fetch', async () => new Response('x'.repeat(128 * 1024 + 1)));
    const updates = vi.fn();
    await expect(streamAuthoringSuggestion(fields, updates)).rejects.toThrow('limit');
    expect(updates).not.toHaveBeenCalled();
  });
});
