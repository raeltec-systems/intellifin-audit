'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { RunConversationMessageRequest, RunConversationRead } from '@intellifin/application';
import { RunConversation, RunConversationComposer } from './RunConversation';
import { RunWorkspaceShell } from './RunWorkspaceShell';
import { readRunConversation, sendRunConversationMessage } from './run-conversation-actions';
import { useDesktopViewport } from './LiveGate';

/** History is a bounded page. Refresh replaces authoritative content, including removals. */
export function RunWorkspaceConversation({ runId, initial, selectedSourceOrdinal, replyToWaitId,
  header, progress, controls, currentDecision, workspace }: {
  readonly runId: string;
  readonly initial: RunConversationRead;
  readonly selectedSourceOrdinal: number | null;
  readonly replyToWaitId: string | null;
  readonly header: ReactNode;
  readonly progress: ReactNode;
  readonly controls: ReactNode;
  readonly currentDecision: ReactNode;
  readonly workspace: ReactNode;
}): React.JSX.Element {
  const router = useRouter();
  const desktop = useDesktopViewport();
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
      {before !== null && <button type="button" onClick={() => { setBefore(null); setHistory(null); setError(null); }}>Return to latest messages</button>}
      <RunConversation runId={runId} messages={read?.messages ?? []} olderBefore={read?.olderBefore ?? null}
        showComposer={false} loadingOlder={before !== null && history === null}
        readError={error ?? (read !== null && read.status !== 'ready' ? 'Conversation could not be read.' : null)}
        onReadOlder={async sequence => { setError(null); setBefore(sequence); }}
        recordLinksFor={message => message.sourceOrdinal === null ? [] : [{
          href: `/runs/${runId}/evidence?selected=${message.sourceOrdinal}`, label: 'Review related record',
        }]} />
    </>}
    composer={<RunConversationComposer runId={runId} selectedSourceOrdinal={selectedSourceOrdinal}
      replyToWaitId={replyToWaitId} onSend={send} disabled={disabledReason !== undefined} disabledReason={disabledReason} />} />;
}
