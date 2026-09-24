'use client';
import { useEffect, useState } from 'react';
import type { WorkspacePreviewMetadata } from '@intellifin/application';
import { Timestamp } from '../design/Timestamp';
import { WorkspaceCaptureView } from './WorkspaceCaptureView';
import { startWorkspacePreviewPolling } from './workspace-preview-polling';
import {
  WORKSPACE_PREVIEW_ALT,
  WORKSPACE_PREVIEW_LABEL,
  WORKSPACE_PREVIEW_STATUS,
  type WorkspacePreviewStatus,
} from './workspace-words';

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
/**
 * When the shown picture was taken, and when the page last checked it (AW-060: capture
 * age and connection age are two facts, shown as two). Both are `<Timestamp>`s, so the
 * reader sees `21 Sep 2026, 12:24:45 UTC` and the exact instant stays in `dateTime`
 * (UI cleanup 2026-09-23, UX-24: the line used to print two raw ISO instants). The
 * capture time is marked, so a browser proof reads it from the attribute, not the words.
 */
export function PreviewSampleTimes({ capturedAt, checkedAt }: {
  readonly capturedAt: number;
  readonly checkedAt: number;
}): React.JSX.Element {
  return <p className="ls-caption">
    Screen taken <span data-preview-captured-at><Timestamp value={new Date(capturedAt)} /></span>.
    {' '}Connection checked <Timestamp value={new Date(checkedAt)} />.
  </p>;
}

/** Every decode is followed by fresh authority/epoch verification. A newer sample
 * in that same public epoch does not invalidate still-fresh decoded pixels; their
 * original capture time remains authoritative and is never relabelled.
 *
 * Its words come only from `WORKSPACE_PREVIEW_STATUS` (UX-24): the status is typed as
 * that table's values, so an inline sentence here does not compile. */
export function WorkspacePreview({ runId, enabled }: { readonly runId: string; readonly enabled: boolean }): React.JSX.Element {
  const [view, setView] = useState<{ url: string; capturedAt: number; checkedAt: number } | null>(null);
  const [status, setStatus] = useState<WorkspacePreviewStatus>(WORKSPACE_PREVIEW_STATUS.unavailable);
  useEffect(() => {
    setView(null);
    if (!enabled) { setStatus(WORKSPACE_PREVIEW_STATUS.off); return; }
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
        if (document.hidden) { clear(); setStatus(WORKSPACE_PREVIEW_STATUS.hidden); return; }
        const sample = await read(true);
        if (disposed) return;
        if (!sample?.metadata || !sample.image || !matchingPreview(sample.metadata, sample.metadata, Date.now())) {
          clear(); setStatus(sample?.metadata?.mode === 'private' ? WORKSPACE_PREVIEW_STATUS.private : WORKSPACE_PREVIEW_STATUS.noRecentScreen); return;
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
        setStatus(WORKSPACE_PREVIEW_STATUS.showing);
        expiry = setTimeout(() => { clear(); setStatus(WORKSPACE_PREVIEW_STATUS.outOfDate); }, Math.max(0, Math.min(sample.metadata.capturedAt! + 3000, latest.metadata.expiresAt) - Date.now()));
      } catch { if (!disposed) { clear(); setStatus(WORKSPACE_PREVIEW_STATUS.unavailable); } }
      finally { if (pendingUrl !== null) { URL.revokeObjectURL(pendingUrl); if (candidateUrl === pendingUrl) candidateUrl = null; } }
    };
    const hide = () => { if (document.hidden) { clear(); setStatus(WORKSPACE_PREVIEW_STATUS.hidden); } };
    document.addEventListener('visibilitychange', hide);
    const stopPolling = startWorkspacePreviewPolling(poll);
    return () => { disposed = true; controller.abort(); stopPolling(); clear(); document.removeEventListener('visibilitychange', hide); };
  }, [runId, enabled]);
  return <section className="workspace-preview" aria-label={WORKSPACE_PREVIEW_LABEL}>
    <p role="status" aria-live="polite">{status}</p>
    {view && <><PreviewSampleTimes capturedAt={view.capturedAt} checkedAt={view.checkedAt} />
      <WorkspaceCaptureView hasCapture><img className="ls-session__frame" src={view.url} alt={WORKSPACE_PREVIEW_ALT} /></WorkspaceCaptureView></>}
  </section>;
}
