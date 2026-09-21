'use client';
import { useEffect, useState } from 'react';
import type { WorkspacePreviewMetadata } from '@intellifin/application';
import { WorkspaceCaptureView } from './WorkspaceCaptureView';
import { startWorkspacePreviewPolling } from './workspace-preview-polling';

type Sample = { metadata: WorkspacePreviewMetadata; image: string | null };
export function matchingPreview(a: WorkspacePreviewMetadata, b: WorkspacePreviewMetadata, now: number): boolean {
  return a.runId === b.runId && a.runtimeId === b.runtimeId && a.workspaceRevision === b.workspaceRevision && a.privacyEpoch === b.privacyEpoch
    && a.mode === 'public' && b.mode === 'public'
    && a.capturedAt !== null && b.capturedAt !== null
    && ((a.sequence === b.sequence && a.capturedAt === b.capturedAt)
      || (b.sequence > a.sequence && b.capturedAt > a.capturedAt))
    && b.capturedAt <= now && b.captureCompletedAt !== null && b.captureCompletedAt >= b.capturedAt
    && a.capturedAt !== null && a.captureCompletedAt !== null && a.captureCompletedAt >= a.capturedAt
    && a.capturedAt <= now && a.capturedAt + 3000 > now && a.expiresAt > now && b.expiresAt > now;
}
/** Every decode is followed by fresh authority/epoch verification. A newer sample
 * in that same public epoch does not invalidate still-fresh decoded pixels; their
 * original capture time remains authoritative and is never relabelled. */
export function WorkspacePreview({ runId, enabled }: { readonly runId: string; readonly enabled: boolean }): React.JSX.Element {
  const [view, setView] = useState<{ url: string; capturedAt: number; checkedAt: number } | null>(null);
  const [status, setStatus] = useState('Near-live preview unavailable.');
  useEffect(() => {
    setView(null);
    if (!enabled) { setStatus('Near-live preview unavailable in this deployment.'); return; }
    let disposed = false, objectUrl: string | null = null, candidateUrl: string | null = null;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const clear = () => { if (expiry) clearTimeout(expiry); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; if (candidateUrl) URL.revokeObjectURL(candidateUrl); candidateUrl = null; setView(null); };
    const read = async (image: boolean): Promise<Sample | null> => {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/preview?image=${image ? '1' : '0'}`, {
        cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]),
      });
      if (!response.ok) return null;
      return await response.json() as Sample;
    };
    const poll = async () => {
      let pendingUrl: string | null = null;
      try {
        if (document.hidden) { clear(); setStatus('Near-live preview paused while this tab is hidden.'); return; }
        const sample = await read(true);
        if (disposed) return;
        if (!sample?.metadata || !sample.image || !matchingPreview(sample.metadata, sample.metadata, Date.now())) {
          clear(); setStatus(sample?.metadata?.mode === 'private' ? 'Private step — preview hidden.' : 'Near-live preview unavailable or stale.'); return;
        }
        if (sample.metadata.runId !== runId || sample.image.length > 699052) { clear(); return; }
        const binary = atob(sample.image); const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        pendingUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })); candidateUrl = pendingUrl; bytes.fill(0);
        const image = new Image(); image.src = pendingUrl;
        let decodeTimeout: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([image.decode(), new Promise<never>((_, reject) => { decodeTimeout = setTimeout(() => reject(new Error('Preview decode unavailable')), 1000); })]); }
        finally { if (decodeTimeout) clearTimeout(decodeTimeout); }
        const latest = await read(false);
        if (disposed || document.hidden || candidateUrl !== pendingUrl || !latest?.metadata || !matchingPreview(sample.metadata, latest.metadata, Date.now())) { clear(); return; }
        // Keep the preceding fresh frame while its replacement is decoded and
        // reauthorized. Withdraw immediately on refusal/private state or expiry.
        candidateUrl = null; clear(); objectUrl = pendingUrl; pendingUrl = null;
        setView({ url: objectUrl, capturedAt: sample.metadata.capturedAt!, checkedAt: Date.now() });
        setStatus('Near-live preview · synthetic workspace · not registered evidence.');
        expiry = setTimeout(() => { clear(); setStatus('Near-live preview stale.'); }, Math.max(0, Math.min(sample.metadata.capturedAt! + 3000, latest.metadata.expiresAt) - Date.now()));
      } catch { if (!disposed) { clear(); setStatus('Near-live preview unavailable.'); } }
      finally { if (pendingUrl !== null) { URL.revokeObjectURL(pendingUrl); if (candidateUrl === pendingUrl) candidateUrl = null; } }
    };
    const hide = () => { if (document.hidden) { clear(); setStatus('Near-live preview paused while this tab is hidden.'); } };
    document.addEventListener('visibilitychange', hide);
    const stopPolling = startWorkspacePreviewPolling(poll);
    return () => { disposed = true; controller.abort(); stopPolling(); clear(); document.removeEventListener('visibilitychange', hide); };
  }, [runId, enabled]);
  return <section aria-label="Near-live workspace preview">
    <p role="status" aria-live="polite">{status}</p>
    {view && <><p className="ls-caption">Sample started {new Date(view.capturedAt).toISOString()}. Connection checked {new Date(view.checkedAt).toISOString()}.</p>
      <WorkspaceCaptureView hasCapture><img className="ls-session__frame" src={view.url} alt="Near-live synthetic workspace sample" /></WorkspaceCaptureView></>}
  </section>;
}
