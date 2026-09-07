import type { PermittedReadAction, ToolActionParameter } from '@intellifin/domain';

/** The version of the bounded model-to-agent proposal contract. */
export const AGENT_MODEL_CONTRACT_VERSION = 1 as const;

/** The only uncertainty states a model may report. Provider failures are errors, not uncertainty. */
export const AGENT_UNCERTAINTY_KINDS = ['none', 'ambiguous', 'insufficient-evidence'] as const;
export type AgentUncertaintyKind = (typeof AGENT_UNCERTAINTY_KINDS)[number];

/** The provider routes supported by this build. */
export const AGENT_MODEL_PROVIDERS = ['anthropic', 'openai'] as const;
export type AgentModelProvider = (typeof AGENT_MODEL_PROVIDERS)[number];

/** A locator resolved by the platform from a frozen web-tree snapshot. */
export interface AgentLocator {
  readonly substrate: 'web_tree';
  /** `$.nodes[<index>].value`; the platform, rather than the model, resolves the node. */
  readonly path: string;
}

/** A frozen interaction the model may select by opaque id. */
export interface AgentApprovedTool {
  /** Stable id allocated by the application for this proposal opportunity. */
  readonly toolId: string;
  /** The logical action vocabulary is the frozen domain vocabulary. */
  readonly action: PermittedReadAction;
  /** The destination has already been selected from the frozen scope. */
  readonly destination: string;
  /** A platform-resolved locator, or `null` for an action with no field locator. */
  readonly locator: AgentLocator | null;
  /** Trusted, frozen description of this interaction. */
  readonly description: string;
  /** Parameter names that this interaction may carry. Values remain gate-checked later. */
  readonly parameterNames: readonly string[];
}

/** Retrieved page or workspace content. It is data for the model and never an instruction. */
export interface AgentRetrievedContent {
  readonly source: string;
  readonly text: string;
}

/**
 * Host-neutral cancellation seam. An AbortSignal satisfies the required `aborted` member;
 * composition roots may additionally provide `subscribe` so the adapter can abort in-flight
 * provider work without importing a host type into application.
 */
export interface AgentCancellationSignal {
  readonly aborted: boolean;
  readonly subscribe?: (listener: () => void) => () => void;
}

/** Request supplied by the bounded loop for one model proposal turn. */
export interface AgentModelRequest {
  readonly schemaVersion: typeof AGENT_MODEL_CONTRACT_VERSION;
  readonly objective: string;
  readonly retrieved: readonly AgentRetrievedContent[];
  readonly tools: readonly AgentApprovedTool[];
  /** Per-provider call deadline. The loop owns the larger Run deadline. */
  readonly timeoutMs: number;
  readonly signal?: AgentCancellationSignal;
}

/** The fixed, non-secret configuration that is safe to persist with a Run. */
export interface AgentModelConfiguration {
  readonly responseFormat: 'agent-action-proposal-v1';
  readonly maxOutputTokens: number;
  readonly temperature: 0;
  readonly maxActions: number;
}

/** Provider/model/prompt/build identity. API keys and endpoints never cross this port. */
export interface AgentModelIdentity {
  readonly provider: AgentModelProvider;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly buildVersion: string;
  readonly configuration: AgentModelConfiguration;
}

/** One ordered proposal. Action, destination and locator are copied from the approved tool. */
export interface AgentActionProposal {
  readonly toolId: string;
  readonly action: PermittedReadAction;
  readonly destination: string;
  readonly locator: AgentLocator | null;
  readonly parameters: readonly ToolActionParameter[];
}

/** Model uncertainty is explicit and bounded; a rationale is untrusted model text. */
export type AgentUncertainty =
  | { readonly kind: 'none'; readonly rationale: null }
  | { readonly kind: 'ambiguous'; readonly rationale: string }
  | { readonly kind: 'insufficient-evidence'; readonly rationale: string };

/** Usage returned by the provider SDK, with all three counters required for accounting. */
export interface AgentTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

/** The sanitized result consumed by the bounded loop and persisted by its caller. */
export interface AgentModelResponse {
  readonly schemaVersion: typeof AGENT_MODEL_CONTRACT_VERSION;
  /** The route actually serving this response, including fallback responses. */
  readonly route: AgentModelProvider;
  readonly model: AgentModelIdentity;
  readonly actions: readonly AgentActionProposal[];
  readonly uncertainty: AgentUncertainty;
  readonly usage: AgentTokenUsage;
  /** Number of provider attempts whose token usage was unavailable to the gateway. */
  readonly unaccountedProviderAttempts?: number;
}

/** Fixed operational failures. No provider text or exception message crosses the port. */
export const AGENT_MODEL_ERROR_CODES = [
  'configuration',
  'invalid-request',
  'invalid-response',
  'unavailable',
  'timeout',
  'canceled',
  'provider-refused',
] as const;
export type AgentModelErrorCode = (typeof AGENT_MODEL_ERROR_CODES)[number];

export const AGENT_MODEL_ERROR_MESSAGES: Readonly<Record<AgentModelErrorCode, string>> = Object.freeze({
  configuration: 'The agent model is not configured for this build.',
  'invalid-request': 'The agent model request is outside the supported contract.',
  'invalid-response': 'The agent model returned an invalid action proposal.',
  unavailable: 'The agent model is temporarily unavailable.',
  timeout: 'The agent model did not respond before the step deadline.',
  canceled: 'The agent model request was canceled.',
  'provider-refused': 'The agent model provider refused the request.',
});

const RETRYABLE_AGENT_MODEL_ERRORS: ReadonlySet<AgentModelErrorCode> = new Set([
  'unavailable',
  'timeout',
]);

/** An operational error with a fixed message and no provider cause attached. */
export class AgentModelGatewayError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: AgentModelErrorCode,
    /** Usage is present when the provider returned a valid usage envelope before parsing failed. */
    readonly usage: AgentTokenUsage | null = null,
    /** Identity is present when an adapter was selected; transport/config failures may be null. */
    readonly identity: AgentModelIdentity | null = null,
    /** The route that produced the known usage or operational failure, when known. */
    readonly route: AgentModelProvider | null = identity?.provider ?? null,
    /** Provider attempts for which no usage envelope was available. */
    readonly unaccountedProviderAttempts = 0,
  ) {
    super(AGENT_MODEL_ERROR_MESSAGES[code]);
    this.name = 'AgentModelGatewayError';
    this.retryable = RETRYABLE_AGENT_MODEL_ERRORS.has(code);
  }
}

export function isAgentModelGatewayError(value: unknown): value is AgentModelGatewayError {
  return value instanceof AgentModelGatewayError;
}

/** Application-owned gateway; the existing plan-derivation ModelGateway is a different port. */
export interface AgentModelGateway {
  readonly identity: AgentModelIdentity;
  /** Identity of the configured fallback, if one exists. */
  readonly fallbackIdentity?: AgentModelIdentity | null;
  /** A caller may pass a host cancellation signal separately from the serialized request. */
  propose(request: AgentModelRequest, signal?: AgentCancellationSignal): Promise<AgentModelResponse>;
}
