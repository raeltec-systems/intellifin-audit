'use server';

import type { RunConversationAppendReceipt, RunConversationRead, RunConversationInspectionRead, RunConversationCommandReceipt } from '@intellifin/application';
import { getRuntime } from '../bootstrap';
import { requireServerAction } from '../server-session';

export async function sendRunConversationMessage(request: unknown): Promise<RunConversationAppendReceipt> {
  const decision = await requireServerAction('run.initiate');
  if (!decision.allowed) return { ok: false, code: 'denied', reason: decision.reason };
  try {
    return await (await getRuntime()).conversation.append({
      actorId: decision.session.userId, sessionId: decision.session.sessionId, request,
    });
  } catch {
    // Neither raw requests nor database/crypto causes may reach telemetry or the client.
    return { ok: false, code: 'unavailable', deliveryStatus: 'unknown', reason: 'The message could not be confirmed. Retry the same message to recover its receipt.' };
  }
}

export async function readRunConversation(runId: string, beforeSequence?: number): Promise<RunConversationRead> {
  const decision = await requireServerAction('run.initiate');
  if (!decision.allowed) return { status: 'denied', runId, messages: [], olderBefore: null, enabled: false, readAt: null, code: 'not-authorized' };
  try {
    return await (await getRuntime()).conversation.read({ runId, actorId: decision.session.userId, beforeSequence });
  } catch {
    return { status: 'unavailable', runId, messages: [], olderBefore: null, enabled: false, readAt: null, code: 'content-unavailable' };
  }
}

export async function readCurrentRunInspection(runId: string): Promise<RunConversationInspectionRead> {
  const decision = await requireServerAction('run.initiate');
  if (!decision.allowed) return { status: 'unavailable', reason: decision.reason };
  try {
    return await (await getRuntime()).conversation.readCurrentInspection({ runId, actorId: decision.session.userId });
  } catch {
    return { status: 'unavailable', reason: 'Current inspection could not be read. Reload before requesting a deferred pause.' };
  }
}

export async function confirmDeferredPauseProposal(request: unknown): Promise<RunConversationCommandReceipt> {
  const decision = await requireServerAction('run.pause');
  if (!decision.allowed) return { ok: false, code: 'denied', reason: decision.reason };
  try {
    return await (await getRuntime()).conversation.confirmDeferredPause({
      actorId: decision.session.userId, sessionId: decision.session.sessionId, request,
    });
  } catch {
    return { ok: false, code: 'unavailable', reason: 'The pause could not be confirmed. Retry the same confirmation to recover its recorded outcome.' };
  }
}

export async function confirmConversationResume(request: unknown): Promise<RunConversationCommandReceipt> {
  const decision = await requireServerAction('run.resume');
  if (!decision.allowed) return { ok: false, code: 'denied', reason: decision.reason };
  try {
    return await (await getRuntime()).conversation.confirmResume({
      actorId: decision.session.userId, sessionId: decision.session.sessionId, request,
    });
  } catch {
    return { ok: false, code: 'unavailable', reason: 'Resume could not be confirmed. Retry this same confirmation to recover its recorded outcome.' };
  }
}

export async function confirmConversationStop(request: unknown): Promise<RunConversationCommandReceipt> {
  const decision = await requireServerAction('run.cancel');
  if (!decision.allowed) return { ok: false, code: 'denied', reason: decision.reason };
  try {
    return await (await getRuntime()).conversation.confirmStop({
      actorId: decision.session.userId, sessionId: decision.session.sessionId, request,
    });
  } catch {
    return { ok: false, code: 'unavailable', reason: 'Stop could not be confirmed. Retry this same confirmation to recover its recorded outcome.' };
  }
}

export async function confirmConversationAnswer(request: unknown): Promise<RunConversationCommandReceipt> {
  const decision = await requireServerAction('escalation.answer');
  if (!decision.allowed) return { ok: false, code: 'denied', reason: decision.reason };
  try {
    return await (await getRuntime()).conversation.confirmAnswer({ actorId: decision.session.userId, sessionId: decision.session.sessionId, request });
  } catch {
    return { ok: false, code: 'unavailable', reason: 'The answer could not be confirmed. Retry this same proposal to recover its recorded outcome.' };
  }
}
