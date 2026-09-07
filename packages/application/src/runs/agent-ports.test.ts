import { describe, expect, it } from 'vitest';
import {
  AGENT_MODEL_CONTRACT_VERSION,
  AGENT_MODEL_ERROR_MESSAGES,
  AgentModelGatewayError,
  isAgentModelGatewayError,
  type AgentApprovedTool,
  type AgentEvaluationInput,
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

  it('supports an explicit post-capture evaluation turn without changing the action default', () => {
    const evaluation: AgentEvaluationInput = {
      observationId: 'observation-1',
      observation: { source: 'snapshot:final', text: '{"found":"true","roles":["LOAN_ADMIN"]}' },
      conditions: [{ conditionId: 'C2', text: 'Evaluate whether the captured role evidence is privileged.' }],
    };
    const request: AgentModelRequest = {
      schemaVersion: AGENT_MODEL_CONTRACT_VERSION,
      phase: 'evaluation',
      objective: 'Evaluate the supplied frozen Observation.',
      retrieved: [],
      tools: [],
      evaluation,
      timeoutMs: 1_000,
    };
    const response: AgentModelResponse = {
      schemaVersion: AGENT_MODEL_CONTRACT_VERSION,
      phase: 'evaluation',
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
      actions: [],
      agentProposals: [{
        observationId: evaluation.observationId,
        conditionId: 'C2',
        value: 'EXCEPTION',
        confidence: '0.80',
        rationale: 'The frozen role evidence is privileged.',
      }],
      uncertainty: { kind: 'none', rationale: null },
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    };
    expect(request.phase).toBe('evaluation');
    expect(request.evaluation?.conditions[0]?.conditionId).toBe('C2');
    expect(response.phase).toBe('evaluation');
    expect(response.agentProposals?.[0]?.observationId).toBe(evaluation.observationId);
    expect(response.actions).toEqual([]);
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
