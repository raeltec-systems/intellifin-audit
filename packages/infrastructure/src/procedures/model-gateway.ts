import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { APICallError, generateText, type LanguageModel } from 'ai';
import type { ModelGateway, ModelIdentity } from '@intellifin/application';
import { ModelGatewayError } from '@intellifin/application';
import { deriveExecutablePlan, executablePlanModelInstructions, type FrozenPlanInputs } from '@intellifin/domain';
import type { AppConfig } from '../config.js';
import { DEFAULT_MODEL_OUTPUT_TOKENS, MAX_CONFIGURED_MODEL_OUTPUT_TOKENS, SUPPORTED_MODEL_PROMPT_VERSION } from './model-policy.js';

/** No provider response, prompt, or exception is logged or stored by this adapter. */
abstract class SdkModelGateway implements ModelGateway {
  constructor(readonly identity: ModelIdentity, private readonly model: LanguageModel, private readonly maxOutputTokens: number) {
    if (identity.promptVersion !== SUPPORTED_MODEL_PROMPT_VERSION) throw new ModelGatewayError('The configured model prompt version is not supported by this build.', false);
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1024 || maxOutputTokens > MAX_CONFIGURED_MODEL_OUTPUT_TOKENS) throw new ModelGatewayError('The configured model output budget is outside the supported range.', false);
  }

  async derive(input: FrozenPlanInputs, compilerVersion: string): Promise<unknown> {
    // Size the entire durable contract before a paid request. UTF-8 bytes bound
    // byte-tokenizer output conservatively; reserve additional formatting capacity.
    // This candidate is used only for sizing, never supplied to the provider.
    const sized = deriveExecutablePlan(input, compilerVersion);
    if (!sized.ok) throw new ModelGatewayError('The authored inputs cannot produce an executable plan.', false);
    if (new TextEncoder().encode(JSON.stringify(sized.plan)).length + 1024 > this.maxOutputTokens) {
      throw new ModelGatewayError('The full plan exceeds the configured model output budget. Shorten authored text or configure a larger output budget supported by the selected model.', false);
    }
    try {
      const result = await generateText({
        model: this.model,
        system: executablePlanModelInstructions,
        prompt: JSON.stringify({ compilerVersion, promptVersion: this.identity.promptVersion, authoredInputs: input }),
        temperature: 0,
        maxOutputTokens: this.maxOutputTokens,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(120_000),
        experimental_telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
      });
      // JSON only; markdown fences and extra text are failures, never repaired silently.
      if (result.text.length > 1_000_000) throw new ModelGatewayError('The model response exceeds the executable plan size limit.', false);
      return JSON.parse(result.text) as unknown;
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      const retryable = APICallError.isInstance(error) ? error.isRetryable :
        error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      throw new ModelGatewayError(retryable ? 'The configured model is temporarily unavailable. Retry derivation after the service recovers.' : 'The configured model could not return a valid executable plan response.', retryable);
    }
  }
}

export class AnthropicModelGateway extends SdkModelGateway {
  constructor(modelId: string, promptVersion: string, apiKey: string, maxOutputTokens = DEFAULT_MODEL_OUTPUT_TOKENS) {
    if (!apiKey.trim()) throw new ModelGatewayError('The configured model API key is missing.', false);
    super({ provider: 'anthropic', modelId, promptVersion }, createAnthropic({ apiKey })(modelId), maxOutputTokens);
  }
}

export class OpenAIModelGateway extends SdkModelGateway {
  constructor(modelId: string, promptVersion: string, apiKey: string, maxOutputTokens = DEFAULT_MODEL_OUTPUT_TOKENS) {
    if (!apiKey.trim()) throw new ModelGatewayError('The configured model API key is missing.', false);
    super({ provider: 'openai', modelId, promptVersion }, createOpenAI({ apiKey })(modelId), maxOutputTokens);
  }
}

/** Called by composition roots with validated config, never ambient environment. */
export function modelIdentityFromConfig(config: AppConfig): ModelIdentity | null {
  if (config.MODEL_PROVIDER === undefined) return null;
  if (!config.MODEL_ID) throw new Error('Incomplete model configuration');
  if (config.MODEL_PROMPT_VERSION !== SUPPORTED_MODEL_PROMPT_VERSION) throw new ModelGatewayError('The configured model prompt version is not supported by this build.', false);
  return { provider: config.MODEL_PROVIDER, modelId: config.MODEL_ID, promptVersion: config.MODEL_PROMPT_VERSION };
}

/** Called by composition roots with validated config, never ambient environment. */
export function createModelGateway(config: AppConfig): ModelGateway | null {
  if (config.MODEL_PROVIDER === undefined) return null;
  if (!config.MODEL_ID || !config.MODEL_API_KEY) throw new Error('Incomplete model configuration');
  return config.MODEL_PROVIDER === 'anthropic'
    ? new AnthropicModelGateway(config.MODEL_ID, config.MODEL_PROMPT_VERSION, config.MODEL_API_KEY, config.MODEL_MAX_OUTPUT_TOKENS)
    : new OpenAIModelGateway(config.MODEL_ID, config.MODEL_PROMPT_VERSION, config.MODEL_API_KEY, config.MODEL_MAX_OUTPUT_TOKENS);
}
