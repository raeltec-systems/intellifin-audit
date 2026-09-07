import { utf8Bytes, type ExecutablePlan } from '@intellifin/domain';
import { AgentModelGatewayError, type AgentModelGateway, type AgentModelRequest, type AgentModelResponse } from './agent-ports.js';
import type { AgentWorkCheckpoint, AgentWorkContext, AgentTurnRecord } from './agent-work-ports.js';
import type { CredentialGuard } from './credential-guard.js';

/** Reserve conservatively before provider I/O; unknown usage never becomes a measured zero. */
export function agentTurnReservation(request: AgentModelRequest, gateway: AgentModelGateway): { perAttempt: number; total: number } {
  // A UTF-8 byte is a conservative bound for one input token. The fixed allowance covers
  // the adapter's system prompt and provider framing. Output is explicitly capped by SDK.
  const inputBytes = utf8Bytes(JSON.stringify({ objective: request.objective, retrieved: request.retrieved, tools: request.tools })).length;
  const output = Math.max(gateway.identity.configuration.maxOutputTokens, gateway.fallbackIdentity?.configuration.maxOutputTokens ?? 0);
  const perAttempt = inputBytes + output + 8192;
  return { perAttempt, total: perAttempt * (gateway.fallbackIdentity == null ? 1 : 2) };
}

export type AgentTurnOutcome =
  | { kind: 'completed'; response: AgentModelResponse; checkpoint: AgentWorkCheckpoint }
  | { kind: 'failed'; diagnostic: string; checkpoint: AgentWorkCheckpoint }
  | { kind: 'limit' | 'lost' };

/** One durable model call. The outer work-item loop owns browser steps and Run transitions. */
export async function executeAgentModelTurn(input: {
  plan: ExecutablePlan;
  checkpoint: AgentWorkCheckpoint;
  request: AgentModelRequest;
  gateway: AgentModelGateway;
  guard: CredentialGuard;
  workItemId: string;
  stepExecutionId: string;
  snapshotEvidenceId: string;
  commit(work: (context: AgentWorkContext) => Promise<void>): Promise<boolean>;
}): Promise<AgentTurnOutcome> {
  const { checkpoint: prior } = input;
  const reserve = agentTurnReservation(input.request, input.gateway);
  if (prior.tokens + prior.reservedTokens + reserve.total > input.plan.limits.runTokens) return { kind: 'limit' };
  if (input.guard.discloses(utf8Bytes(JSON.stringify(input.request)))) return { kind: 'failed', diagnostic: 'credential-containment', checkpoint: prior };
  const turn: AgentTurnRecord = { sequence: prior.nextTurn, workItemId: input.workItemId, stepExecutionId: input.stepExecutionId,
    snapshotEvidenceId: input.snapshotEvidenceId, status: 'RESERVED', reservedTokens: reserve.total, response: null, diagnostic: null };
  const reserved: AgentWorkCheckpoint = { ...prior, nextTurn: prior.nextTurn + 1, reservedTokens: prior.reservedTokens + reserve.total };
  if (!await input.commit(async context => {
    await context.saveTurn(turn);
    await context.saveCheckpoint(reserved, 'RUNNING');
  })) return { kind: 'lost' };
  let response: AgentModelResponse;
  try { response = await input.gateway.propose(input.request); }
  catch (error) {
    const known = error instanceof AgentModelGatewayError ? error : new AgentModelGatewayError('unavailable');
    const next: AgentWorkCheckpoint = { ...reserved, tokens: prior.tokens + (known.usage?.totalTokens ?? 0),
      reservedTokens: prior.reservedTokens + (known.usage === null ? reserve.total : Math.min(reserve.total, reserve.perAttempt * known.unaccountedProviderAttempts)),
      model: known.identity ?? reserved.model, diagnostic: `model-${known.code}` };
    if (!await input.commit(async context => {
      await context.saveTurn({ ...turn, status: 'FAILED', diagnostic: next.diagnostic });
      await context.saveCheckpoint(next, 'RUNNING');
    })) return { kind: 'lost' };
    return { kind: 'failed', diagnostic: next.diagnostic!, checkpoint: next };
  }
  // Model output is also untrusted. A reflected secret never enters the turn ledger.
  const discloses = input.guard.discloses(utf8Bytes(JSON.stringify(response)));
  const next: AgentWorkCheckpoint = { ...reserved, tokens: prior.tokens + response.usage.totalTokens,
    reservedTokens: prior.reservedTokens + Math.min(reserve.total, reserve.perAttempt * (response.unaccountedProviderAttempts ?? 0)),
    model: response.model, diagnostic: discloses ? 'credential-containment' : null };
  if (!await input.commit(async context => {
    await context.saveTurn(discloses ? { ...turn, status: 'FAILED', diagnostic: 'credential-containment' } : { ...turn, status: 'COMPLETED', response });
    await context.saveCheckpoint(next, 'RUNNING');
  })) return { kind: 'lost' };
  return discloses ? { kind: 'failed', diagnostic: 'credential-containment', checkpoint: next } : { kind: 'completed', response, checkpoint: next };
}
