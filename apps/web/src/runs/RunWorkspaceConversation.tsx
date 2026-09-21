'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { runConversationAnswerConsequence } from '@intellifin/application';
import type { RunConversationMessageRequest, RunConversationRead, RunConversationInspectionRead, RunConversationMessage, RunConversationQuestionContext } from '@intellifin/application';
import { RunConversation, RunConversationComposer, AnswerQuestionSource } from './RunConversation';
import { RunWorkspaceShell } from './RunWorkspaceShell';
import { readRunConversation, sendRunConversationMessage, confirmDeferredPauseProposal, confirmConversationResume, confirmConversationStop, confirmConversationAnswer, confirmConversationStrategy } from './run-conversation-actions';
import { UntrustedText } from './UntrustedText';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { RunControllerLease, RunControlReadProvider, type RunControlView } from './RunControllerLease';
import { useDesktopViewport, useLiveGate } from './LiveGate';

/** History is a bounded page. Refresh replaces authoritative content, including removals. */
export function RunWorkspaceConversation({ runId, initial, selectedSourceOrdinal, replyToWaitId, currentInspection, questionContext,
  header, progress, controls, currentDecision, workspace, controlRefreshKey = '' }: {
  readonly runId: string;
  readonly controlRefreshKey?: string;
  readonly initial: RunConversationRead;
  readonly selectedSourceOrdinal: number | null;
  readonly replyToWaitId: string | null;
  readonly currentInspection?: RunConversationInspectionRead;
  readonly questionContext?: RunConversationQuestionContext | null;
  readonly header: ReactNode;
  readonly progress: ReactNode;
  readonly controls: ReactNode;
  readonly currentDecision: ReactNode;
  readonly workspace: ReactNode;
}): React.JSX.Element {
  const router = useRouter();
  const desktop = useDesktopViewport();
  const gate = useLiveGate();
  const [control, setControl] = useState<RunControlView>(null);
  const ownsControl = control?.status === 'ready' && control.active && (!control.required || control.heldByYou);
  const [confirmation, setConfirmation] = useState<NonNullable<RunConversationMessage['command']> | null>(null);
  const [unknownConfirmation, setUnknownConfirmation] = useState(false);
  const commandOwned = (command: NonNullable<RunConversationMessage['command']>) => ownsControl &&
    control?.status === 'ready' && (!control.required || command.expectedControlEpoch === control.epoch);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirm = async () => {
    if (confirmation === null || confirming) return;
    const current = read?.messages.find(row => row.command?.commandId === confirmation.commandId);
    if (!unknownConfirmation && (current?.contentState !== 'available' || !current.command?.canConfirm || current.command.reason)) {
      setConfirmation(null); setError('The proposal is no longer available for confirmation. Read the current conversation.'); return;
    }
    if (!['stop', 'answer'].includes(confirmation.kind) && !unknownConfirmation && !commandOwned(confirmation)) {
      setConfirmationError('Confirm current Run control before confirming this command.'); return;
    }
    if (!desktop || gate.disabledReason !== null) {
      setConfirmationError(gate.disabledReason ?? 'Open on a desktop to confirm this command.');
      return;
    }
    setConfirming(true); setConfirmationError(null);
    try {
      const execute = confirmation.kind === 'strategy' ? confirmConversationStrategy : confirmation.kind === 'answer' ? confirmConversationAnswer : confirmation.kind === 'stop' ? confirmConversationStop : confirmation.kind === 'resume' ? confirmConversationResume : confirmDeferredPauseProposal;
      const result = await execute({ runId, commandId: confirmation.commandId });
      if (!result.ok) {
        if (confirmation.kind !== 'stop') setUnknownConfirmation(result.code === 'unavailable');
        setConfirmationError(result.reason); router.refresh(); return;
      }
      setUnknownConfirmation(false); setConfirmation(null); setBefore(null); setHistory(null); router.refresh();
    } catch {
      if (confirmation.kind !== 'stop') setUnknownConfirmation(true);
      setConfirmationError('The command could not be confirmed. Retry this same confirmation to recover its recorded outcome.');
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
  const currentAnswerQuestion = read?.status === 'ready' ? read.messages.find(row =>
    row.command?.commandId === confirmation?.commandId && row.contentState === 'available')?.command?.answerQuestion : undefined;
  useEffect(() => {
    if (confirmation === null) return;
    const proposal = read?.messages.find(row => row.command?.commandId === confirmation.commandId);
    if (unknownConfirmation || confirming) {
      if (proposal?.command && ['queued', 'applied', 'refused', 'superseded'].includes(proposal.command.state)) {
        setConfirmation(null); setUnknownConfirmation(false); setConfirmationError(null);
        setError(`Recorded command outcome: ${proposal.command.state}.`);
      }
      return;
    }
    if (initial.status !== 'ready' || (read?.status === 'ready' &&
      (proposal === undefined || proposal.contentState !== 'available' ||
        (proposal.command?.state !== 'interpreted' || !proposal.command.canConfirm || Boolean(proposal.command.reason))))) {
      setConfirmation(null); setConfirmationError(null);
      setError('The proposal is no longer available for confirmation. Read the current conversation.');
    }
  }, [confirmation, initial.status, read, unknownConfirmation, confirming]);
  useEffect(() => {
    if (confirmation !== null && !['stop', 'answer'].includes(confirmation.kind) && !unknownConfirmation &&
      control?.status !== 'checking' && !commandOwned(confirmation) && !confirming) {
      setConfirmation(null); setConfirmationError(null);
      setError('Run control is unavailable. Refresh control before confirming this command.');
    }
  }, [confirmation, control, ownsControl, confirming, unknownConfirmation]);
  const send = async (input: RunConversationMessageRequest) => {
    const receipt = await sendRunConversationMessage(input);
    if (receipt.ok) { setBefore(null); setHistory(null); router.refresh(); }
    return receipt;
  };
  const disabledReason = !desktop ? 'Open on a desktop to send messages. Conversation remains readable.'
    : initial.status !== 'ready' ? 'Conversation is unavailable. This development surface requires the synthetic conversation configuration.' : undefined;
  return <RunControlReadProvider value={{ read: control, publish: setControl }}><RunWorkspaceShell header={header} progress={progress}
    controls={<><RunControllerLease runId={runId} refreshKey={controlRefreshKey} />{controls}</>}
    currentDecision={currentDecision} workspace={workspace}
    conversation={<>
      <ConfirmDialog open={confirmation !== null} weight="routine" title={confirmation?.kind === 'strategy' ? 'Use the frozen Full name search?' : confirmation?.kind === 'answer' ? 'Confirm this answer?' : confirmation?.kind === 'stop' ? 'Stop this Run?' : confirmation?.kind === 'resume' ? 'Resume this Run?' : 'Pause after this inspection?'}
        consequence={confirmation?.kind === 'strategy' ? `Queue one Full name search for the recorded inspection. This uses only the frozen fallback after the recorded complete zero-match employee-ID search for this exact inspection attempt. The worker rechecks Run control, prerequisite evidence and attempt limits. Pause and Stop retain priority. Queued does not mean applied.` : confirmation?.kind === 'answer' ? `${runConversationAnswerConsequence(confirmation.answerOptionId ?? '')} Confirm before ${confirmation.answerAnchor?.deadline}. Answer only the recorded question with its chosen option.` : confirmation?.kind === 'stop' ? 'Cancellation cannot be undone. The worker finishes its current safe boundary. Collected evidence is retained and the partial Result is sealed.' : confirmation?.kind === 'resume'
          ? `Resume the pause opened at ${confirmation.resumeAnchor?.pausedAt}. Confirm before ${confirmation.resumeAnchor?.deadline}. Interrupted work restarts as a new attempt using the frozen plan and committed evidence.`
          : `Request a pause after ${confirmation?.targetLabel ?? 'the named inspection'} settles, including any recorded skip. Only this target inspection is named. An open question remains open; if no work remains, the Run finishes instead.`}
        confirmLabel={confirmation?.kind === 'strategy' ? 'Queue Full name search' : confirmation?.kind === 'answer' ? 'Confirm answer' : confirmation?.kind === 'stop' ? 'Stop Run' : confirmation?.kind === 'resume' ? 'Resume Run' : 'Pause after this inspection'} cancelLabel="Go back" busy={confirming} refusal={confirmationError}
        keepOpenOnGateClose={unknownConfirmation}
        disabledReason={confirmation !== null && !['stop', 'answer'].includes(confirmation.kind) && !unknownConfirmation && !commandOwned(confirmation)
          ? 'Checking current Run control before confirming.' : null}
        onCancel={() => { if (!confirming) setConfirmation(null); }} onConfirm={() => { void confirm(); }}>
        {confirmation?.kind === 'strategy' && confirmation.strategyAnchor && <>
          <UntrustedText field="Strategy inspection">{confirmation.targetLabel ?? ''}</UntrustedText>
          <p>Required committed evidence: {confirmation.strategyAnchor.prerequisiteEvidenceIds.map(id => <a key={id} href={`/runs/${runId}/evidence?evidence=${id}`}>Primary search evidence</a>)}</p>
          <p>Control epoch {confirmation.strategyAnchor.controlEpoch}. This selection cannot move to another inspection or restart.</p>
        </>}
        {confirmation?.kind === 'answer' && currentAnswerQuestion && <AnswerQuestionSource
          question={currentAnswerQuestion} optionId={confirmation.answerOptionId} expanded label="Recorded question and choice" />}
      </ConfirmDialog>
      {before !== null && <button type="button" onClick={() => { setBefore(null); setHistory(null); setError(null); }}>Return to latest messages</button>}
      <RunConversation onReviewCommand={command => {
        if (command.canConfirm && gate.disabledReason === null && (['stop', 'answer'].includes(command.kind) || commandOwned(command)) &&
          (command.kind === 'strategy' && command.strategyAnchor || command.kind === 'answer' || command.kind === 'stop' || (command.kind === 'pause-after-inspection' && command.targetLabel) || (command.kind === 'resume' && command.resumeAnchor))) {
          setUnknownConfirmation(false); setConfirmationError(null); setConfirmation(command);
        }
      }} runId={runId} messages={(read?.messages ?? []).map(message => message.command && !['stop', 'answer'].includes(message.command.kind) && !commandOwned(message.command)
        ? { ...message, command: { ...message.command, canConfirm: false } } : message)} olderBefore={read?.olderBefore ?? null}
        showComposer={false} loadingOlder={before !== null && history === null}
        readError={error ?? (read !== null && read.status !== 'ready' ? 'Conversation could not be read.' : null)}
        onReadOlder={async sequence => { setError(null); setBefore(sequence); }}
        recordLinksFor={message => message.sourceOrdinal === null ? [] : [{
          href: `/runs/${runId}/evidence?selected=${message.sourceOrdinal}`, label: 'Review related record',
        }]} />
    </>}
    composer={<RunConversationComposer runId={runId} selectedSourceOrdinal={selectedSourceOrdinal}
      replyToWaitId={replyToWaitId} currentInspection={currentInspection} questionContext={questionContext} strategyContext={initial.status === 'ready' ? initial.strategy : undefined} onSend={send} disabled={disabledReason !== undefined} disabledReason={disabledReason} />} /></RunControlReadProvider>;
}
