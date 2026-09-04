import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveExecutablePlan, ExecutablePlanSchema, executablePlanModelInstructions } from '@intellifin/domain';
import { AnthropicModelGateway, OpenAIModelGateway, createModelGateway, loadConfig, modelIdentityFromConfig } from '@intellifin/infrastructure';
import { executablePlanInputs } from '../fixtures/executable-plan.js';

/** Real installed AI SDK + provider encoders/decoders; only HTTP transport is synthetic. */
const providers = [
  { provider: 'anthropic', modelId: 'claude-sonnet-4-5', endpoint: 'https://api.anthropic.com/v1/messages',
    gateway: (budget = 16000) => new AnthropicModelGateway('claude-sonnet-4-5', '1', 'synthetic-api-key', budget),
    response: (text: string) => ({ id: 'msg_synthetic', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } }),
  },
  { provider: 'openai', modelId: 'gpt-4.1', endpoint: 'https://api.openai.com/v1/responses',
    gateway: (budget = 16000) => new OpenAIModelGateway('gpt-4.1', '1', 'synthetic-api-key', budget),
    response: (text: string) => ({ id: 'resp_synthetic', object: 'response', created_at: 1_788_566_400, model: 'gpt-4.1', status: 'completed',
      output: [{ type: 'message', role: 'assistant', id: 'msg_synthetic', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } }),
  },
] as const;

afterEach(() => vi.unstubAllGlobals());

describe.each(providers)('$provider real SDK HTTP protocol', (provider) => {
  it('encodes original authored inputs and decodes a contract-valid provider candidate', async () => {
    const inputs = executablePlanInputs();
    const compiled = deriveExecutablePlan(inputs);
    if (!compiled.ok) throw new Error(compiled.reason);
    const requests: Request[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json(provider.response(JSON.stringify(compiled.plan)));
    });
    const gateway = provider.gateway();
    const result = await gateway.derive(inputs, '1');
    expect(ExecutablePlanSchema.safeParse(result).success).toBe(true);
    expect(result).toEqual(compiled.plan);
    expect(gateway.identity).toEqual({ provider: provider.provider, modelId: provider.modelId, promptVersion: '1' });
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.url).toBe(provider.endpoint);
    expect(request.method).toBe('POST');
    expect(request.headers.get('content-type')).toContain('application/json');
    const body = await request.json();
    expect(body.model).toBe(provider.modelId);
    expect(body.temperature).toBe(0);
    let prompt: string;
    if (provider.provider === 'anthropic') {
      expect(request.headers.get('x-api-key')).toBe('synthetic-api-key');
      expect(request.headers.get('anthropic-version')).toBeTruthy();
      expect(body.max_tokens).toBe(16000);
      expect(body.system).toEqual([{ type: 'text', text: executablePlanModelInstructions }]);
      expect(body.messages[0].role).toBe('user');
      prompt = body.messages[0].content[0].text;
    } else {
      expect(request.headers.get('authorization')).toBe('Bearer synthetic-api-key');
      expect(body.max_output_tokens).toBe(16000);
      expect(body.input.find((message: { role: string }) => message.role === 'system')?.content).toBe(executablePlanModelInstructions);
      prompt = body.input.find((message: { role: string }) => message.role === 'user').content[0].text;
    }
    expect(JSON.parse(prompt)).toEqual({ compilerVersion: '1', promptVersion: '1', authoredInputs: inputs });
    expect(prompt).not.toContain('synthetic-api-key');
    expect(Object.keys(JSON.parse(prompt))).not.toContain('compiledPlan');
  });

  it('preflights an otherwise valid large contract without HTTP and accepts an explicit larger budget', async () => {
    const original = executablePlanInputs();
    const input = { ...original, scope: 'a'.repeat(10000), instructions: [{ ...original.instructions[0]!, text: 'b'.repeat(10000) }] };
    const compiled = deriveExecutablePlan(input);
    if (!compiled.ok) throw new Error(compiled.reason);
    const fetch = vi.fn(async () => Response.json(provider.response(JSON.stringify(compiled.plan))));
    vi.stubGlobal('fetch', fetch);
    await expect(provider.gateway().derive(input, '1')).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('output budget') });
    expect(fetch).not.toHaveBeenCalled();
    const result = await provider.gateway(32768).derive(input, '1');
    expect(ExecutablePlanSchema.safeParse(result).success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('binds prompt identity and keeps API keys out of the web identity configuration', () => {
    const web = loadConfig({ DATABASE_URL: 'postgres://localhost/synthetic', SERVICE_NAME: 'web', MODEL_PROVIDER: provider.provider, MODEL_ID: provider.modelId });
    expect(modelIdentityFromConfig(web)?.promptVersion).toBe('1');
    expect(() => createModelGateway(web)).toThrow('Incomplete model configuration');
    expect(() => provider.provider === 'anthropic' ? new AnthropicModelGateway(provider.modelId, 'unsupported', 'synthetic-api-key') : new OpenAIModelGateway(provider.modelId, 'unsupported', 'synthetic-api-key')).toThrow(/prompt version/);
  });

  it('rejects a malformed provider envelope through the real SDK decoder', async () => {
    const fetch = vi.fn(async () => Response.json({ unexpected: 'not the provider response contract' }));
    vi.stubGlobal('fetch', fetch);
    await expect(provider.gateway().derive(executablePlanInputs(), '1')).rejects.toMatchObject({ retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('propagates an HTTP failure without SDK retries', async () => {
    const fetch = vi.fn(async () => Response.json({ error: { type: 'api_error', message: 'synthetic service failure', code: 'unavailable' } }, { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(provider.gateway().derive(executablePlanInputs(), '1')).rejects.toMatchObject({ retryable: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([{ status: 429, retryable: true }, { status: 401, retryable: false }])('classifies HTTP $status without disclosing response text', async ({ status, retryable }) => {
    const fetch = vi.fn(async () => Response.json({ error: { type: 'api_error', message: 'private-provider-response', code: 'synthetic' } }, { status }));
    vi.stubGlobal('fetch', fetch);
    await expect(provider.gateway().derive(executablePlanInputs(), '1')).rejects.toMatchObject({ retryable, message: expect.not.stringContaining('private-provider-response') });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('classifies invalid candidate JSON as nonretryable', async () => {
    vi.stubGlobal('fetch', async () => Response.json(provider.response('not valid JSON')));
    await expect(provider.gateway().derive(executablePlanInputs(), '1')).rejects.toMatchObject({ retryable: false });
  });
});
