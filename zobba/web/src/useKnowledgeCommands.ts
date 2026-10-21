import { useEffect, useRef, useState } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import type { Scope } from './engagements';
import { discardKnowledgeOwner, knowledgeCustodyFailure, knowledgeFailure, knowledgeRefused, knowledgeRequestDeadline, recoverKnowledge, retainKnowledge, submitKnowledge } from './knowledge';
import type { KnowledgeReceipt, KnowledgeRequest, PreferenceSnapshot } from './knowledge';

/** Captures the immutable request before I/O. Remount/recovery never submits it. */
export function useKnowledgeCommands(owner: string, scope: Scope | null, session: Session, ready: boolean,
  onAccessFailure: (error?: AccessError) => void, onSuccess: (receipt: KnowledgeReceipt | PreferenceSnapshot, request: KnowledgeRequest) => void,
  refresh: () => Promise<void>) {
  const [state, setState] = useState(() => ({ owner, pending: recoverKnowledge(owner, session).pending }));
  if (state.owner !== owner) setState({ owner, pending: recoverKnowledge(owner, session).pending });
  const pending = state.owner === owner ? state.pending : null;
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const action = useRef<AbortController | null>(null);
  const latest = useRef({ owner, ready }); latest.current = { owner, ready };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; action.current?.abort(); }; }, []);
  async function apply(request: KnowledgeRequest) {
    if (!ready || action.current || pending && JSON.stringify(pending) !== JSON.stringify(request)) return;
    if (!retainKnowledge(owner, session, scope, { pending: request })) { setError(knowledgeCustodyFailure); return; }
    const controller = new AbortController(); action.current = controller;
    setState({ owner, pending: structuredClone(request) }); setWorking(true); setError('');
    const deadline = setTimeout(() => controller.abort(), knowledgeRequestDeadline(request));
    try {
      const receipt = await submitKnowledge(request, session, controller.signal);
      if (!mounted.current || latest.current.owner !== owner) return;
      retainKnowledge(owner, session, scope, { pending: null }); setState({ owner, pending: null }); onSuccess(receipt, request);
    } catch (reason) {
      if (!mounted.current || latest.current.owner !== owner) return;
      if (knowledgeRefused(reason, pending !== null)) { retainKnowledge(owner, session, scope, { pending: null }); setState({ owner, pending: null }); }
      setError(knowledgeFailure(reason));
      if (reason instanceof AccessError && [401, 403, 404, 412].includes(reason.status)) { discardKnowledgeOwner(owner); onAccessFailure(reason); }
    } finally { clearTimeout(deadline); if (action.current === controller) { action.current = null; if (mounted.current) { setWorking(false); void refresh(); } } }
  }
  return { pending, working, error, setError, apply };
}
