'use client';
import { useEffect, useState } from 'react';
import type { WorkspacePreviewMetadata } from '@intellifin/application';
import { WorkspaceCaptureView } from './WorkspaceCaptureView';
import { startWorkspacePreviewPolling } from './workspace-preview-polling';

type Sample = { metadata: WorkspacePreviewMetadata; image: string | null };
export function matchingPreview(a: WorkspacePreviewMetadata, b: WorkspacePreviewMetadata, now: number): boolean {
  return a.runId === b.runId && a.runtimeId === b.runtimeId && a.workspaceRevision === b.workspaceRevision && a.privacyEpoch === b.privacyEpoch
    && a.mode === 'public' && b.mode === 'public' && a.sequence === b.sequence && a.capturedAt === b.capturedAt
    && a.capturedAt !== null && a.captureCompletedAt !== null && a.captureCompletedAt >= a.capturedAt
    && a.capturedAt <= now && a.capturedAt + 3000 > now && a.expiresAt > now && b.expiresAt > now;
}
/** Preview bytes are ephemeral and never Evidence. Every decode is followed by a new authority/epoch read. */
export function WorkspacePreview({ runId, enabled }: { readonly runId: string; readonly enabled: boolean }): React.JSX.Element {
  const [view, setView] = useState<{ url: string; capturedAt: number; checkedAt: number } | null>(null);
  const [status, setStatus] = useState('Near-live preview unavailable.');
  useEffect(() => {
    setView(null);
    if (!enabled) { setStatus('Near-live preview unavailable in this deployment.'); return; }
    let disposed = false, objectUrl: string | null = null;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const clear = () => { if (expiry) clearTimeout(expiry); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; setView(null); };
    const read = async (image: boolean): Promise<Sample | null> => {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/preview?image=${image ? '1' : '0'}`, {
        cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]),
      });
      if (!response.ok) return null;
      return await response.json() as Sample;
    };
    const poll = async () => {
      clear();
      try {
        if (document.hidden) { setStatus('Near-live preview paused while this tab is hidden.'); return; }
        const sample = await read(true);
        if (disposed) return;
        if (!sample?.metadata || !sample.image || !matchingPreview(sample.metadata, sample.metadata, Date.now())) {
          setStatus(sample?.metadata?.mode === 'private' ? 'Private step — preview hidden.' : 'Near-live preview unavailable or stale.'); return;
        }
        if (sample.metadata.runId !== runId || sample.image.length > 699052) return;
        const binary = atob(sample.image); const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })); bytes.fill(0);
        const pendingUrl = objectUrl; const image = new Image(); image.src = pendingUrl;
        let decodeTimeout: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([image.decode(), new Promise<never>((_, reject) => { decodeTimeout = setTimeout(() => reject(new Error('Preview decode unavailable')), 1000); })]); }
        finally { if (decodeTimeout) clearTimeout(decodeTimeout); }
        const latest = await read(false);
        if (disposed || document.hidden || !latest?.metadata || !matchingPreview(sample.metadata, latest.metadata, Date.now())) { clear(); return; }
        setView({ url: pendingUrl, capturedAt: sample.metadata.capturedAt!, checkedAt: Date.now() });
        setStatus('Near-live preview · synthetic workspace · not registered evidence.');
        expiry = setTimeout(() => { clear(); setStatus('Near-live preview stale.'); }, Math.max(0, Math.min(sample.metadata.capturedAt! + 3000, latest.metadata.expiresAt) - Date.now()));
      } catch { if (!disposed) { clear(); setStatus('Near-live preview unavailable.'); } }
    };
    const hide = () => { if (document.hidden) { clear(); setStatus('Near-live preview paused while this tab is hidden.'); } };
    document.addEventListener('visibilitychange', hide);
    const stopPolling = startWorkspacePreviewPolling(poll);
    return () => { disposed = true; controller.abort(); stopPolling(); clear(); document.removeEventListener('visibilitychange', hide); };
  }, [runId, enabled]);
  return <div aria-label="Near-live workspace preview">
    <p role="status" aria-live="polite">{status}</p>
    {view && <><p className="ls-caption">Sample started {new Date(view.capturedAt).toISOString()}. Connection checked {new Date(view.checkedAt).toISOString()}.</p>
      <WorkspaceCaptureView hasCapture><img className="ls-session__frame" src={view.url} alt="Near-live synthetic workspace sample" /></WorkspaceCaptureView></>}
  </div>;
}
