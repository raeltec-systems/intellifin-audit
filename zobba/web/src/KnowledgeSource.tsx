import { useCallback, useState } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import type { Scope } from './engagements';
import { inspectEvidence, previewEvidence } from './evidence';
import type { Evidence, Preview } from './evidence';
import { useSkillInspection } from './useSkillInspection';

/** Destination access never authorizes this original. Both source requests use
 * its original scope and the current exact session, independently of knowledge. */
export function KnowledgeSource({ scope, evidenceId, version, sha256, session, accessReady, onAccessFailure, onSourceAccessFailure }: {
  scope: Scope; evidenceId: string; version: string; sha256: string; session: Session; accessReady: boolean;
  onAccessFailure: (error?: AccessError) => void; onSourceAccessFailure: (error: AccessError) => void;
}) {
  const [open, setOpen] = useState(false);
  const owner = JSON.stringify([session.identity.id, session.csrf_token, scope.organisation_id, scope.client_id, scope.engagement_id, evidenceId, version, sha256]);
  const read = useCallback(async (signal: AbortSignal): Promise<{ evidence: Evidence; preview: Preview }> => {
    const evidence = await inspectEvidence(scope, session, evidenceId, signal);
    if (evidence.version !== version || evidence.reservation.request.identity.sha256 !== sha256) throw new Error('Original identity changed');
    const preview = await previewEvidence(scope, session, evidenceId, signal);
    return { evidence, preview };
  }, [owner]);
  const denied = useCallback((reason?: AccessError) => {
    // Losing source access does not imply the separately authorized destination
    // vanished. Session replacement still withdraws the whole workspace.
    if (reason && [401, 412].includes(reason.status)) onAccessFailure(reason);
    else if (reason && [403, 404].includes(reason.status)) onSourceAccessFailure(reason);
  }, [onAccessFailure, onSourceAccessFailure]);
  const inspection = useSkillInspection(owner, accessReady && open, '', read, denied);
  return <section ref={inspection.panel} className="knowledge-source" aria-label={`Original source ${evidenceId}`}>
    <button type="button" className="text-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close original source' : 'Inspect original source'}</button>
    {open && !inspection.verified ? <p role="status">{inspection.error ? 'This original is currently unavailable or inaccessible. No source content is shown.' : 'Checking current access to this original…'}</p> : null}
    <div hidden={!open || !inspection.verified}>
      {inspection.value ? <><h5>{inspection.value.evidence.reservation.request.filename}</h5><dl>
        <div><dt>Source engagement</dt><dd>{scope.organisation_id} / {scope.client_id} / {scope.engagement_id}</dd></div>
        <div><dt>Registered original</dt><dd>{evidenceId}</dd></div><div><dt>Storage version</dt><dd>{version}</dd></div><div><dt>SHA-256</dt><dd>{sha256}</dd></div>
      </dl>{inspection.value.preview.kind === 'plain_text' ? <><p>{inspection.value.preview.truncated ? 'Bounded preview; this is not the whole original.' : 'Registered original text.'}</p><pre className="evidence-preview" tabIndex={0}>{inspection.value.preview.text}</pre></> : <p>This format has no supported inert text preview.</p>}</> : null}
    </div>
    {open ? <button type="button" className="text-button" disabled={!accessReady || inspection.loading} onClick={() => void inspection.refresh()}>Recheck source access</button> : null}
  </section>;
}
