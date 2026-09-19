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
    return { ok: false, code: 'unavailable', reason: 'The message could not be confirmed. Retry the same message to recover its receipt.' };
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
