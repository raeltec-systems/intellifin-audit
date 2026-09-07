import { describe, expect, it } from 'vitest';
import {
  AGENT_MODEL_CONTRACT_VERSION,
  AGENT_MODEL_ERROR_MESSAGES,
  AgentModelGatewayError,
  isAgentModelGatewayError,
  type AgentApprovedTool,
  type AgentModelRequest,
  type AgentModelResponse,
} from './agent-ports.js';

const tool: AgentApprovedTool = {
  toolId: 'search-account',
  action: 'search',
  destination: 'https://loancore.synthetic.invalid/accounts',
  locator: { substrate: 'web_tree', path: '$.nodes[2].value' },
  description: 'Search the approved account form by the declared population key.',
  parameterNames: ['employee_id'],
};

describe('agent model port contract', () => {
  it('keeps action proposals tied to the frozen logical action and locator types', () => {
    const request: AgentModelRequest = {
      schemaVersion: AGENT_MODEL_CONTRACT_VERSION,
      objective: 'Find the account for the frozen population record.',
      retrieved: [{ source: 'web-tree', text: 'Account search form' }],
      tools: [tool],
      timeoutMs: 1_000,
    };
    const response: AgentModelResponse = {
      schemaVersion: AGENT_MODEL_CONTRACT_VERSION,
      route: 'anthropic',
      model: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        promptVersion: '1',
        buildVersion: 'test-build',
        configuration: {
          responseFormat: 'agent-action-proposal-v1',
          maxOutputTokens: 16_000,
          temperature: 0,
          maxActions: 32,
        },
      },
      actions: [{
        toolId: tool.toolId,
        action: tool.action,
        destination: tool.destination,
        locator: tool.locator,
        parameters: [{ name: 'employee_id', value: 'EMP-1' }],
      }],
      uncertainty: { kind: 'none', rationale: null },
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    };
    expect(request.tools[0]?.action).toBe('search');
    expect(response.actions[0]?.locator?.path).toBe('$.nodes[2].value');
    expect(response.actions[0]?.parameters[0]?.name).toBe('employee_id');
  });

  it('uses fixed sanitized messages for every operational failure', () => {
    const providerText = 'private provider response with a secret and URL';
    const error = new AgentModelGatewayError('unavailable');
    expect(error.message).toBe(AGENT_MODEL_ERROR_MESSAGES.unavailable);
    expect(error.message).not.toContain(providerText);
    expect(error.retryable).toBe(true);
    expect(isAgentModelGatewayError(error)).toBe(true);

    const invalid = new AgentModelGatewayError('invalid-response');
    expect(invalid.message).toBe(AGENT_MODEL_ERROR_MESSAGES['invalid-response']);
    expect(invalid.retryable).toBe(false);
  });
});
