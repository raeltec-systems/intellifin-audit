import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan.js';
import { loadConfig } from '../config.js';
import { createModelGateway, modelIdentityFromConfig } from './model-gateway.js';

const sdk = vi.hoisted(() => ({ generate: vi.fn(), anthropic: vi.fn(() => vi.fn(() => 'anthropic-model')), openai: vi.fn(() => vi.fn(() => 'openai-model')) }));
vi.mock('ai', () => ({ generateText: sdk.generate, APICallError: { isInstance: () => false } }));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: sdk.anthropic }));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: sdk.openai }));
const base = { DATABASE_URL: 'postgres://localhost/test', SERVICE_NAME: 'worker' };

describe('configured model adapters', () => {
  beforeEach(() => vi.clearAllMocks());
  it('uses no gateway or identity without model settings', () => {
    const config = loadConfig(base);
    expect(createModelGateway(config)).toBeNull();
    expect(modelIdentityFromConfig(config)).toBeNull();
  });
  it.each(['anthropic', 'openai'])('selects the %s SDK adapter with authored input and no telemetry', async (provider) => {
    const config = loadConfig({ ...base, MODEL_PROVIDER: provider, MODEL_ID: 'model-identity', MODEL_API_KEY: 'test-secret', MODEL_PROMPT_VERSION: '1' });
    const gateway = createModelGateway(config)!;
    sdk.generate.mockResolvedValue({ text: '{"schemaVersion":1}' });
    const input = executablePlanInputs();
    expect(await gateway.derive(input, '1')).toEqual({ schemaVersion: 1 });
    expect(gateway.identity).toEqual(modelIdentityFromConfig(config));
    const call = sdk.generate.mock.calls[0]![0];
    expect(JSON.parse(call.prompt)).toEqual({ compilerVersion: '1', promptVersion: '1', authoredInputs: input });
    expect(call.experimental_telemetry).toEqual({ isEnabled: false, recordInputs: false, recordOutputs: false });
    expect(call.system).toContain('untrusted');
    expect(JSON.stringify(call)).not.toContain('test-secret');
  });
  it('refuses non-JSON output instead of repairing provider text', async () => {
    const gateway = createModelGateway(loadConfig({ ...base, MODEL_PROVIDER: 'openai', MODEL_ID: 'm', MODEL_API_KEY: 'test-secret' }))!;
    sdk.generate.mockResolvedValue({ text: '```json\n{}\n```' });
    await expect(gateway.derive(executablePlanInputs(), '1')).rejects.toThrow();
  });
  it('rejects partial configuration without disclosing its key', () => {
    expect(() => loadConfig({ ...base, MODEL_API_KEY: 'private-value' })).toThrow(/MODEL_PROVIDER/);
    try { loadConfig({ ...base, MODEL_API_KEY: 'private-value' }); } catch (error) { expect(String(error)).not.toContain('private-value'); }
    expect(() => loadConfig({ ...base, MODEL_PROVIDER: 'openai' })).toThrow(/MODEL_ID/);
  });
});
