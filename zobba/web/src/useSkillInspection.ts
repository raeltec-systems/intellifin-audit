import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessError } from './auth';

/** Current reads own their failures. Intentional cancellation releases that
 * ownership first, retaining the actual same-owner inner DOM while hidden. */
export function useSkillInspection<T>(owner: string, accessReady: boolean, revision: string,
  read: (signal: AbortSignal) => Promise<T>, onAccessFailure: (error?: AccessError) => void) {
  // Parent readiness is permission to start our read, not proof that a retained
  // projection is still authorized. Each activation must complete its own read.
  // Adjusting this component's state during render withdraws verification before
  // React can commit children for the new activation; an effect would be late.
  const [activation, setActivation] = useState({ owner, accessReady, generation: 0 });
  let currentActivation = activation;
  if (activation.owner !== owner || activation.accessReady !== accessReady) {
    currentActivation = { owner, accessReady, generation: activation.generation + 1 };
    setActivation(currentActivation);
  }
  const generation = currentActivation.generation;
  const [state, setState] = useState<{ owner: string; generation: number; value: T } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const focus = useRef<{ node: HTMLElement; start: number | null; end: number | null } | null>(null);
  const latest = useRef({ owner, accessReady, generation }); latest.current = { owner, accessReady, generation };
  const verified = accessReady && state?.owner === owner && state.generation === generation;
  const rememberFocus = useCallback(() => {
    const node = document.activeElement;
    if (node instanceof HTMLElement && panel.current?.contains(node)) focus.current = { node,
      start: node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement ? node.selectionStart : null,
      end: node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement ? node.selectionEnd : null };
  }, []);
  const cancel = useCallback(() => { const previous = request.current; request.current = null; previous?.abort(); }, []);
  const refresh = useCallback(async () => {
    const expected = latest.current;
    if (!expected.accessReady || expected.owner !== owner || expected.generation !== generation) return;
    cancel(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError('');
    const deadline = setTimeout(() => controller.abort(), 8000);
    try {
      const value = await read(controller.signal);
      if (request.current === controller && latest.current.owner === owner && latest.current.accessReady && latest.current.generation === expected.generation) setState({ owner, generation: expected.generation, value });
    } catch (reason) {
      if (request.current !== controller || latest.current.owner !== owner || latest.current.generation !== expected.generation) return;
      setState(null); setError('Current skill information is unavailable. Refresh to check it again.');
      if (reason instanceof AccessError && [401, 403, 404, 412].includes(reason.status)) onAccessFailure(reason);
    } finally { clearTimeout(deadline); if (request.current === controller) { request.current = null; setLoading(false); } }
  }, [cancel, owner, generation, read, onAccessFailure]);
  useEffect(() => {
    if (!accessReady) { rememberFocus(); cancel(); return; }
    void refresh();
    const wake = () => { if (document.hidden) { rememberFocus(); cancel(); } else void refresh(); };
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake);
    return () => { rememberFocus(); cancel(); clearInterval(timer); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
  }, [accessReady, revision, refresh, cancel, rememberFocus]);
  useLayoutEffect(() => {
    if (!verified) return;
    const saved = focus.current;
    if (saved?.node.isConnected && saved.node.getClientRects().length) {
      saved.node.focus({ preventScroll: true });
      if ((saved.node instanceof HTMLTextAreaElement || saved.node instanceof HTMLInputElement) && saved.start !== null && saved.end !== null) saved.node.setSelectionRange(saved.start, saved.end);
      focus.current = null;
    }
  }, [verified, state]);
  return { value: state?.owner === owner ? state.value : null, verified, error, loading, refresh, cancel, panel };
}
