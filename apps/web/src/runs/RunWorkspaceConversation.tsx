'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { RunConversationMessageRequest, RunConversationRead, RunConversationInspectionRead, RunConversationMessage } from '@intellifin/application';
import { RunConversation, RunConversationComposer } from './RunConversation';
import { RunWorkspaceShell } from './RunWorkspaceShell';
import { readRunConversation, sendRunConversationMessage, confirmDeferredPauseProposal } from './run-conversation-actions';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { useDesktopViewport, useLiveGate } from './LiveGate';

/** History is a bounded page. Refresh replaces authoritative content, including removals. */
export function RunWorkspaceConversation({ runId, initial, selectedSourceOrdinal, replyToWaitId, currentInspection,
  header, progress, controls, currentDecision, workspace }: {
  readonly runId: string;
  readonly initial: RunConversationRead;
  readonly selectedSourceOrdinal: number | null;
  readonly replyToWaitId: string | null;
  readonly currentInspection?: RunConversationInspectionRead;
  readonly header: ReactNode;
  readonly progress: ReactNode;
  readonly controls: ReactNode;
  readonly currentDecision: ReactNode;
  readonly workspace: ReactNode;
}): React.JSX.Element {
  const router = useRouter();
  const desktop = useDesktopViewport();
  const gate = useLiveGate();
  const [confirmation, setConfirmation] = useState<NonNullable<RunConversationMessage['command']> | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirm = async () => {
    if (confirmation === null || confirming) return;
    if (!desktop || gate.disabledReason !== null) {
      setConfirmationError(gate.disabledReason ?? 'Open on a desktop to confirm this pause.');
      return;
    }
    setConfirming(true); setConfirmationError(null);
    try {
      const result = await confirmDeferredPauseProposal({ runId, commandId: confirmation.commandId });
      if (!result.ok) { setConfirmationError(result.reason); router.refresh(); return; }
      setConfirmation(null); setBefore(null); setHistory(null); router.refresh();
    } catch {
      setConfirmationError('The pause could not be confirmed. Retry this same confirmation to recover its recorded outcome.');
    } finally { setConfirming(false); }
  };
  const [history, setHistory] = useState<RunConversationRead | null>(null);
  const [before, setBefore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // An invalidation also reauthorizes the displayed older page; stale/tombstoned text
  // is never retained by merging a client cache with a newer server response.
  useEffect(() => {
    if (before === null) return;
    let current = true;
    setHistory(null);
    void readRunConversation(runId, before).then(result => { if (current) setHistory(result); });
    return () => { current = false; };
  }, [runId, before, initial]);
  const read = initial.status !== 'ready' ? initial : before === null ? initial : history;
  useEffect(() => {
    if (confirmation === null) return;
    const proposal = read?.messages.find(row => row.command?.commandId === confirmation.commandId);
    if (initial.status !== 'ready' || (read?.status === 'ready' &&
      (proposal === undefined || proposal.contentState !== 'available'))) {
      setConfirmation(null); setConfirmationError(null);
      setError('The proposal is no longer available for confirmation. Read the current conversation.');
    }
  }, [confirmation, initial.status, read]);
  const send = async (input: RunConversationMessageRequest) => {
    const receipt = await sendRunConversationMessage(input);
    if (receipt.ok) { setBefore(null); setHistory(null); router.refresh(); }
    return receipt;
  };
  const disabledReason = !desktop ? 'Open on a desktop to send messages. Conversation remains readable.'
    : initial.status !== 'ready' ? 'Conversation is unavailable. This development surface requires the synthetic conversation configuration.' : undefined;
  return <RunWorkspaceShell header={header} progress={progress} controls={controls}
    currentDecision={currentDecision} workspace={workspace}
    conversation={<>
      <ConfirmDialog open={confirmation !== null} weight="routine" title="Pause after this inspection?"
        consequence={`Request a pause after ${confirmation?.targetLabel ?? 'the named inspection'} settles, including any recorded skip. Only this target inspection is named. An open question remains open; if no work remains, the Run finishes instead.`}
        confirmLabel="Pause after this inspection" cancelLabel="Go back" busy={confirming} refusal={confirmationError}
        onCancel={() => { if (!confirming) setConfirmation(null); }} onConfirm={() => { void confirm(); }} />
      {before !== null && <button type="button" onClick={() => { setBefore(null); setHistory(null); setError(null); }}>Return to latest messages</button>}
      <RunConversation onReviewCommand={command => {
        if (command.kind === 'pause-after-inspection' && command.canConfirm && command.targetLabel && gate.disabledReason === null) {
          setConfirmationError(null); setConfirmation(command);
        }
      }} runId={runId} messages={read?.messages ?? []} olderBefore={read?.olderBefore ?? null}
        showComposer={false} loadingOlder={before !== null && history === null}
        readError={error ?? (read !== null && read.status !== 'ready' ? 'Conversation could not be read.' : null)}
        onReadOlder={async sequence => { setError(null); setBefore(sequence); }}
        recordLinksFor={message => message.sourceOrdinal === null ? [] : [{
          href: `/runs/${runId}/evidence?selected=${message.sourceOrdinal}`, label: 'Review related record',
        }]} />
    </>}
    composer={<RunConversationComposer runId={runId} selectedSourceOrdinal={selectedSourceOrdinal}
      replyToWaitId={replyToWaitId} currentInspection={currentInspection} onSend={send} disabled={disabledReason !== undefined} disabledReason={disabledReason} />} />;
}
