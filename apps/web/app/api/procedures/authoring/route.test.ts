import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), runtime: vi.fn(), generate: vi.fn() }));
vi.mock('../../../../src/require-role', () => ({ requireAction: mocks.authorize, denialResponse: (d: { status: number }) => new Response(null, { status: d.status }) }));
vi.mock('../../../../src/bootstrap', () => ({ getRuntime: mocks.runtime }));
vi.mock('@intellifin/application', async original => ({ ...await original<typeof import('@intellifin/application')>(), generateAuthoringSuggestion: mocks.generate }));
import { POST } from './route';

const fields = { procedureId: '018f0000-0000-7000-8000-000000000001', versionId: '018f0000-0000-7000-8000-000000000002', requestId: '018f0000-0000-7000-8000-000000000003', expectedRowVersion: 'a'.repeat(64), section: { kind: 'objective' }, mode: 'draft', notes: 'All records. Do not sample.', changes: '' };
const progress = { explanation: 'Inspect all records.', proposedText: null, clarification: null };
const session = { userId: 'trusted-auditor', sessionId: 'trusted-session' };
function request(body: unknown = fields, origin: string | null = 'https://audit.example', contentType = 'application/json') {
  return new Request('https://audit.example/api/procedures/authoring', { method: 'POST', headers: { 'content-type': contentType, ...(origin === null ? {} : { origin }) }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ allowed: true, session, role: 'auditor' });
  mocks.runtime.mockResolvedValue({ db: {}, authConfig: { baseUrl: 'https://audit.example' }, authoringModel: null });
  mocks.generate.mockResolvedValue({ ok: false, reason: 'Not configured' });
});
describe('authoring chat stream boundary', () => {
  it('authorizes before reading the body or runtime configuration', async () => {
    mocks.authorize.mockResolvedValue({ allowed: false, status: 401 });
    const incoming = request();
    Object.defineProperty(incoming, 'body', { get() { throw new Error('Must not read'); } });
    expect((await POST(incoming)).status).toBe(401);
    expect(mocks.runtime).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it.each([null, 'null', 'https://foreign.example'])('rejects a missing or foreign Origin (%s)', async origin => {
    const incoming = request(fields, origin);
    incoming.headers.set('host', 'foreign.example'); incoming.headers.set('x-forwarded-host', 'foreign.example');
    expect((await POST(incoming)).status).toBe(403);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it.each([
    [{ ...fields, actorId: 'forged-manager' }, 'application/json'],
    [{ ...fields, notes: 'x'.repeat(100_000) }, 'application/json'],
    [fields, 'text/plain'],
  ])('refuses untrusted extra fields, oversized bodies and non-JSON content', async (body, contentType) => {
    expect((await POST(request(body, 'https://audit.example', contentType as string))).status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('streams progress before completion using the actual resolved session', async () => {
    let finish!: (result: unknown) => void;
    mocks.generate.mockImplementation(async (_deps, input, emit) => {
      expect(input).toMatchObject({ ...fields, session });
      await emit(progress);
      return new Promise(resolve => { finish = resolve; });
    });
    const response = await POST(request()), reader = response.body!.getReader();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toEqual({ type: 'progress', progress, requestId: fields.requestId });
    finish({ ok: false, reason: 'A known refusal' });
    expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toMatchObject({ type: 'result', result: { ok: false } });
    expect((await reader.read()).done).toBe(true);
  });
  it('lets reserved work finish after disconnect and never logs or exposes an exception', async () => {
    let finish!: () => void, completed = false;
    mocks.generate.mockImplementation(async (_deps, _input, emit) => {
      await new Promise<void>(resolve => { finish = resolve; });
      await emit(progress); completed = true;
      throw new Error('PRIVATE_PROVIDER_BODY');
    });
    const response = await POST(request());
    await response.body!.cancel(); finish();
    await vi.waitFor(() => expect(completed).toBe(true));
    mocks.generate.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_BODY'));
    const text = await (await POST(request())).text();
    expect(text).toContain('uncertain'); expect(text).not.toContain('PRIVATE_PROVIDER_BODY');
  });
});
