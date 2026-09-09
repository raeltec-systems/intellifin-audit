import { describe, expect, it } from 'vitest';
import type { AgentModelRequest } from '@intellifin/application';
import { AnthropicAgentModelGateway, AGENT_PROMPT_VERSION } from '../../packages/infrastructure/src/runs/agent-model-gateway.js';
import { GOLDEN_AGENT_INJECTIONS, GOLDEN_SCOPE_INSTRUCTIONS } from '../fixtures/agent-abuse-cases.js';

// Actual provider adapter and parser, intercepted HTTP transport. This is not a live
// model investigation, worker journey, browser isolation or Story 4.11 acceptance.
const request: AgentModelRequest = { schemaVersion: 1, objective: 'Read the frozen account status.', retrieved: [], tools: [{
  toolId: 'approved-read', action: 'read-attribute', destination: 'https://synthetic.invalid/approved',
  locator: { substrate: 'web_tree', path: '$.nodes[0].value' }, description: 'Read status.', parameterNames: [],
}], timeoutMs: 1000 };
function gateway(answer: object, calls: object[]) {
  return new AnthropicAgentModelGateway({ modelId: 'claude-sonnet-4-5', promptVersion: AGENT_PROMPT_VERSION,
    buildVersion: 'golden-abuse-test', apiKey: 'synthetic-api-key', maxOutputTokens: 1024, maxActions: 1,
    fetch: async (input, init) => {
      calls.push(await new Request(input, init).json() as object);
      return Response.json({ id: 'msg_synthetic', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 } });
    } });
}
describe('golden retrieved content at the actual provider boundary', () => {
  it('discovers both hero injections and all other seeded prompt cases', () => {
    expect(GOLDEN_AGENT_INJECTIONS.filter(row => row.id.startsWith('p-1-')).map(row => row.id)).toEqual([
      'p-1-terminated-users.json:D9-a', 'p-1-terminated-users.json:D9-b',
    ]);
    expect(GOLDEN_AGENT_INJECTIONS.length).toBeGreaterThanOrEqual(2);
  });
  it.each(GOLDEN_AGENT_INJECTIONS)('$id remains verbatim data without changing the approved objective/tools', async row => {
    const calls: object[] = [];
    const input = { ...request, retrieved: [{ source: row.id, text: row.text }] };
    const before = JSON.stringify(input);
    const result = await gateway({ actions: [{ toolId: 'approved-read', parameters: [] }], uncertainty: { kind: 'none', rationale: null } }, calls).propose(input);
    const body = calls[0] as { system: string; messages: { content: { text: string }[] }[] };
    const envelope = JSON.parse(body.messages[0]!.content[0]!.text);
    expect(envelope.retrieved).toEqual(input.retrieved);
    expect(envelope.objective).toBe(request.objective); expect(envelope.tools).toEqual(request.tools);
    expect(body.system).not.toContain(row.text); expect(JSON.stringify(input)).toBe(before);
    expect(result.actions[0]?.toolId).toBe('approved-read');
    expect(result.actions[0]?.destination).toBe(request.tools[0]!.destination);
  });
  it.each(GOLDEN_SCOPE_INSTRUCTIONS)('$instruction_id rejects an invented tool requested by the seeded instruction', async row => {
    const calls: object[] = [];
    await expect(gateway({ actions: [{ toolId: `unapproved-${row.instruction_id}`, parameters: [] }], uncertainty: { kind: 'none', rationale: null } }, calls)
      .propose({ ...request, objective: row.text })).rejects.toMatchObject({ code: 'invalid-response' });
    expect(row.expected_execution_outcome).toBe('denied'); expect(calls).toHaveLength(1);
  });
});
