import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import { downloadEvidence, inspectEvidence, previewEvidence, safeFilename, verifyEvidenceAudience } from './evidence';
import type { Preview } from './evidence';
import type { EvidenceReference } from './EvidenceNavigation';
import { EvidenceProvenance } from './EvidenceProvenance';
import { useSkillInspection } from './useSkillInspection';

export interface EvidenceSourceInspectorProps extends EvidenceReference {
  session: Session;
  accessReady: boolean;
  onAccessFailure: (error?: AccessError) => void;
  onSourceAccessFailure: (error: AccessError) => void;
  onClose?: () => void;
}

/** Resolve the exact source using its own scope and current viewer. Knowledge
 * access never grants source access, including when opened in another library. */
export function EvidenceSourceInspector({ scope, evidenceId, version, sha256, session, accessReady, onAccessFailure, onSourceAccessFailure, onClose }: EvidenceSourceInspectorProps) {
  const [retry, setRetry] = useState(0);
  const owner = JSON.stringify([session.identity.id, session.csrf_token, scope.organisation_id, scope.client_id, scope.engagement_id, evidenceId, version, sha256, retry]);
  const [preview, setPreview] = useState<{ owner: string; value: Preview } | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const transfer = useRef<AbortController | null>(null);
  const publicationWaiters = useRef(new Set<() => void>());
  const urls = useRef(new Set<string>());
  const heading = useRef<HTMLHeadingElement>(null);
  const focusedInside = useRef(false);
  const previouslyVerified = useRef(false);
  const initialFocus = useRef(true);
  const callbacks = useRef({ onAccessFailure, onSourceAccessFailure }); callbacks.current = { onAccessFailure, onSourceAccessFailure };
  const revokeUrls = useCallback(() => { for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); }, []);
  const cancelTransfer = useCallback(() => { const previous = transfer.current; transfer.current = null; previous?.abort(); revokeUrls(); }, [revokeUrls]);
  const denied = useCallback((reason?: AccessError) => {
    cancelTransfer(); setSuspended(true); setPreview(null); setWorking(false);
    if (reason && [401, 412].includes(reason.status)) callbacks.current.onAccessFailure(reason);
    else if (reason && [403, 404].includes(reason.status)) callbacks.current.onSourceAccessFailure(reason);
  }, [cancelTransfer]);
  const read = useCallback(async (signal: AbortSignal) => {
    const evidence = await inspectEvidence(scope, session, evidenceId, signal);
    if (evidence.version !== version || evidence.reservation.request.identity.sha256 !== sha256) throw new Error('Original identity changed');
    return evidence;
  }, [owner]);
  const inspection = useSkillInspection(owner, accessReady, '', read, denied);
  const current = useRef({ owner, accessReady, verified: inspection.verified, verification: 0 });
  const verification = current.current.verification + (current.current.owner !== owner || current.current.accessReady !== accessReady || current.current.verified !== inspection.verified ? 1 : 0);
  current.current = { owner, accessReady, verified: inspection.verified, verification };
  const verified = inspection.verified && !suspended;
  const visiblePreview = verified && preview?.owner === owner ? preview.value : null;
  const ownsTransfer = (controller: AbortController) => transfer.current === controller && current.current.owner === owner;

  // Routine same-session readiness checks quarantine a bounded transfer instead
  // of restarting it. Its own current source read and a fresh audience check must
  // both finish before any buffered content or download can be published.
  async function publicationReady(controller: AbortController): Promise<boolean> {
    while (ownsTransfer(controller)) {
      controller.signal.throwIfAborted();
      if (current.current.accessReady && current.current.verified) {
        const expected = current.current.verification;
        await verifyEvidenceAudience(session, scope, controller.signal);
        if (!ownsTransfer(controller)) return false;
        controller.signal.throwIfAborted();
        if (current.current.accessReady && current.current.verified && current.current.verification === expected) return true;
        continue;
      }
      await new Promise<void>(resolve => {
        const wake = () => { publicationWaiters.current.delete(wake); controller.signal.removeEventListener('abort', wake); resolve(); };
        publicationWaiters.current.add(wake); controller.signal.addEventListener('abort', wake, { once: true });
        if (controller.signal.aborted) wake();
      });
    }
    return false;
  }
  useLayoutEffect(() => { for (const wake of publicationWaiters.current) wake(); }, [owner, accessReady, inspection.verified]);

  // Storage or integrity failure is not proof of current source authority. Hide
  // the private projection until a separate current scoped read succeeds.
  async function unavailable(reason: unknown, controller: AbortController) {
    if (!ownsTransfer(controller)) return;
    setSuspended(true); setPreview(null); revokeUrls();
    if (reason instanceof AccessError && [401, 403, 404, 412].includes(reason.status)) { denied(reason); return; }
    if (controller.signal.aborted) { setNotice('The original request timed out. Recheck source access to verify this original again.'); return; }
    setNotice('Checking current source access after the original became unavailable…');
    try {
      if (!await publicationReady(controller)) return;
      setSuspended(false);
      setNotice('The original is unavailable or could not be verified. Current access permits its registered provenance; no usable preview or download was produced. Recheck source access to retry.');
    } catch (authorityError) {
      if (!ownsTransfer(controller)) return;
      setNotice('Current source access could not be verified. No source content is shown. Recheck source access to try again.');
      if (authorityError instanceof AccessError && [401, 403, 404, 412].includes(authorityError.status)) denied(authorityError);
    }
  }

  async function loadPreview() {
    if (!inspection.verified || !inspection.value || !accessReady || transfer.current) return;
    const controller = new AbortController(); transfer.current = controller;
    const timeout = setTimeout(() => controller.abort(), 120_000);
    setWorking(true); setNotice('Reading a bounded preview of this exact original…');
    try {
      const value = await previewEvidence(scope, session, evidenceId, controller.signal);
      if (!await publicationReady(controller)) return;
      setPreview({ owner, value }); setNotice('');
    } catch (reason) { await unavailable(reason, controller); }
    finally { clearTimeout(timeout); if (transfer.current === controller) { transfer.current = null; setWorking(false); } }
  }

  async function download() {
    if (!verified || !inspection.value || transfer.current) return;
    const evidence = inspection.value;
    const controller = new AbortController(); transfer.current = controller;
    const timeout = setTimeout(() => controller.abort(), 120_000);
    setWorking(true); setNotice('Verifying the exact original for download…');
    try {
      const blob = await downloadEvidence(scope, session, evidence, controller.signal);
      if (!await publicationReady(controller)) return;
      const url = URL.createObjectURL(blob); urls.current.add(url);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = safeFilename(evidence.reservation.request.filename);
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 1000);
      setNotice('Verified original download started.');
    } catch (reason) { await unavailable(reason, controller); }
    finally { clearTimeout(timeout); if (transfer.current === controller) { transfer.current = null; setWorking(false); } }
  }

  useLayoutEffect(() => {
    setSuspended(false); setPreview(null); setNotice(''); setWorking(false);
    return cancelTransfer;
  }, [owner, cancelTransfer]);
  useEffect(() => {
    if (inspection.verified && !suspended && !preview && !transfer.current) void loadPreview();
  }, [inspection.verified, owner]);
  useLayoutEffect(() => { if (!verified) revokeUrls(); }, [verified, revokeUrls]);
  useLayoutEffect(() => {
    if (initialFocus.current && verified || previouslyVerified.current && !verified && focusedInside.current) {
      if (heading.current?.getClientRects().length) {
        heading.current.focus({ preventScroll: true });
        heading.current.scrollIntoView({ block: 'nearest' });
        initialFocus.current = false;
      }
    }
    previouslyVerified.current = verified;
  }, [accessReady, verified]);

  function recheck() {
    cancelTransfer(); setSuspended(true); setPreview(null); setNotice(''); setWorking(false); setRetry(value => value + 1);
  }

  return <section ref={inspection.panel} className="evidence-source-inspector" aria-label="Original source details"
    onFocusCapture={() => { focusedInside.current = true; }} onBlurCapture={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) focusedInside.current = false; }}>
    <h4 ref={heading} tabIndex={-1}>{verified && inspection.value ? inspection.value.reservation.request.filename : 'Original source'}</h4>
    {onClose ? <button type="button" className="text-button" onClick={onClose}>Back to knowledge source</button> : null}
    {!verified ? <p role="status">{suspended && notice || (inspection.error ? 'This original is currently unavailable or inaccessible. No source content is shown.' : 'Checking current access to this original…')}</p> : null}
    {verified && inspection.value ? <>
      <EvidenceProvenance evidence={inspection.value} />
      <button type="button" className="quiet-button" disabled={working} onClick={() => void download()}>Download verified original</button>
      {visiblePreview?.kind === 'plain_text' ? <><h4>Bounded plain-text preview</h4><p className="field-help">Up to 64 KiB and 100 lines. {visiblePreview.truncated ? 'Truncated; download the original for all bytes.' : 'Original text fits this preview.'}</p><pre className="evidence-preview" tabIndex={0}>{visiblePreview.text}</pre></> : visiblePreview?.kind === 'download_only' ? <p role="status">Download only. This original has no supported inert plain-text preview.</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </> : null}
    <button type="button" className="text-button" disabled={!accessReady || inspection.loading || working} onClick={recheck}>Recheck source access</button>
  </section>;
}
