import { describe, expect, it, vi } from 'vitest';
import type { ExecutablePlan } from '@intellifin/domain';
import { AgentModelGatewayError, type AgentModelGateway, type AgentModelResponse } from './agent-ports.js';
import { agentTurnReservation, executeAgentModelTurn } from './execute-agent-model-turn.js';
import type { AgentWorkCheckpoint, AgentWorkContext, AgentTurnRecord } from './agent-work-ports.js';
import { NO_CREDENTIALS } from './credential-guard.js';

function harness() {
  const checkpoint: AgentWorkCheckpoint = { revision: 1, status: 'EXECUTING', runStartedAt: '2026-09-07T00:00:00Z', leaseUntil: '2026-09-07T00:01:00Z', attemptId: 'attempt', workItemId: 'item', waitId: null, pendingWait: null, nextTurn: 1, tokens: 25, reservedTokens: 0, model: null, diagnostic: null };
  const response: AgentModelResponse = { schemaVersion: 1, route: 'anthropic', model: { provider: 'anthropic', modelId: 'test', promptVersion: '1', buildVersion: 'test', configuration: { responseFormat: 'agent-action-proposal-v1', maxOutputTokens: 100, maxActions: 1, temperature: 0 } }, actions: [], uncertainty: { kind: 'none', rationale: null }, usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } };
  const turns: AgentTurnRecord[] = []; const checkpoints: AgentWorkCheckpoint[] = [];
  const context = { saveTurn: async (t: AgentTurnRecord) => { turns.push(t); }, saveCheckpoint: async (c: AgentWorkCheckpoint) => { checkpoints.push(c); } } as unknown as AgentWorkContext;
  const gateway: AgentModelGateway = { identity: response.model, propose: vi.fn(async () => { expect(turns[0]?.status).toBe('RESERVED'); expect(checkpoints[0]!.reservedTokens).toBeGreaterThan(0); return response; }) };
  const input = { plan: { limits: { runTokens: 1000000 } } as ExecutablePlan, checkpoint, request: { schemaVersion: 1 as const, objective: 'Read approved evidence.', retrieved: [], tools: [], timeoutMs: 1000 }, gateway, guard: NO_CREDENTIALS, workItemId: 'item', stepExecutionId: 'step', snapshotEvidenceId: 'snapshot', commit: async (work: (c: AgentWorkContext) => Promise<void>) => { await work(context); return true; } };
  return { input, turns, checkpoints, response };
}

describe('durable agent token accounting', () => {
  it('reserves before I/O and records real usage after the response', async () => {
    const h = harness(); const out = await executeAgentModelTurn(h.input);
    expect(out.kind).toBe('completed'); expect(h.checkpoints.at(-1)).toMatchObject({ tokens: 43, reservedTokens: 0, nextTurn: 2, model: h.response.model });
    expect(h.turns.map(t => t.status)).toEqual(['RESERVED', 'COMPLETED']);
  });
  it('makes the token limit reachable without a paid call or invented Observation', async () => {
    const h = harness(); h.input.checkpoint = { ...h.input.checkpoint, tokens: 999999 };
    expect(await executeAgentModelTurn(h.input)).toEqual({ kind: 'limit' });
    expect(h.input.gateway.propose).not.toHaveBeenCalled(); expect(h.turns).toEqual([]);
  });
  it('keeps a reservation when transport failure leaves consumption unknown', async () => {
    const h = harness(); h.input.gateway.propose = async () => { throw new AgentModelGatewayError('unavailable'); };
    const reserve = agentTurnReservation(h.input.request, h.input.gateway);
    await executeAgentModelTurn(h.input);
    expect(h.checkpoints.at(-1)).toMatchObject({ tokens: 25, reservedTokens: reserve.total, diagnostic: 'model-unavailable' });
  });
  it('retains unknown primary consumption beside measured fallback usage', async () => {
    const h = harness(); h.input.gateway = { ...h.input.gateway, fallbackIdentity: h.response.model, propose: async () => ({ ...h.response, unaccountedProviderAttempts: 1 }) };
    const reserve = agentTurnReservation(h.input.request, h.input.gateway);
    await executeAgentModelTurn(h.input);
    expect(h.checkpoints.at(-1)).toMatchObject({ tokens: 43, reservedTokens: reserve.perAttempt });
  });
  it('does not call the model after losing the Run claim', async () => {
    const h = harness(); h.input.commit = async () => false;
    expect(await executeAgentModelTurn(h.input)).toEqual({ kind: 'lost' }); expect(h.input.gateway.propose).not.toHaveBeenCalled();
  });
  it('refuses secret-bearing model output but still accounts its tokens', async () => {
    const h = harness(); h.input.guard = { held: 1, redact: s => s, discloses: bytes => bytes.length > 200 };
    const out = await executeAgentModelTurn(h.input);
    expect(out.kind).toBe('failed'); expect(h.turns.at(-1)).toMatchObject({ status: 'FAILED', response: null });
    expect(h.checkpoints.at(-1)?.tokens).toBe(43);
  });
});
