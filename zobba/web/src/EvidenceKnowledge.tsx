import { useCallback, useState } from 'react';
import type { AccessError, Session } from './auth';
import type { Scope } from './engagements';
import { inspectEvidence } from './evidence';
import type { Evidence } from './evidence';
import { knowledgeAudience, omissionLabels, readKnowledgeSourceStatus } from './knowledge';
import { useKnowledgeCommands } from './useKnowledgeCommands';
import { useSkillInspection } from './useSkillInspection';

export function EvidenceKnowledge({ evidence, scope, session, accessReady, onAccessFailure, onReturnToTask }: { evidence: Evidence; scope: Scope; session: Session; accessReady: boolean; onAccessFailure: (error?: AccessError) => void; onReturnToTask: () => void }) {
  const owner = `${knowledgeAudience(session, scope.organisation_id, scope)}/evidence/${evidence.reservation.id}`;
  const [start, setStart] = useState('0'), [end, setEnd] = useState(String(Math.min(evidence.reservation.request.identity.size, 16384)));
  const [notice, setNotice] = useState('');
  const read = useCallback(async (signal: AbortSignal) => { const [original, status] = await Promise.all([inspectEvidence(scope, session, evidence.reservation.id, signal), readKnowledgeSourceStatus(scope, evidence.reservation.id, session, signal)]); return { original, status }; }, [owner]);
  const inspection = useSkillInspection(owner, accessReady, evidence.version, read, onAccessFailure);
  const visible = inspection.verified && inspection.value?.original.version === evidence.version && inspection.value.original.reservation.request.identity.sha256 === evidence.reservation.request.identity.sha256;
  const mutation = useKnowledgeCommands(owner, scope, session, visible, onAccessFailure, receipt => { setNotice('event_id' in receipt ? `Capture checked · event ${receipt.event_id}. Inspect current Task knowledge for eligible results and coverage limitations.` : 'Capture checked.'); }, inspection.refresh);
  return <section ref={inspection.panel} className="evidence-knowledge" aria-label="Source working knowledge"><h4>Working knowledge from this original</h4>
    <p>Supported UTF-8 acquisitions automatically capture a bounded exact excerpt and distinguish your source assertions. Unsupported formats retain an extraction omission.</p>
    {!visible ? <p role="status">{inspection.error ? 'Current source access is unavailable.' : 'Checking this original’s current access…'}</p> : null}
    <div hidden={!visible}>
      {inspection.value ? <><p>Source correction revision {inspection.value.status.source_revision} · capture revision {inspection.value.status.capture_revision}.{inspection.value.status.replacement_id ? ` Declared replacement: ${inspection.value.status.replacement_id}. Both originals remain available under current source access.` : ''}</p>{inspection.value.status.omissions.length ? <ul aria-label="Source capture limitations">{inspection.value.status.omissions.map(omission => <li key={omission}>{omissionLabels[omission]}</li>)}</ul> : null}</> : null}
      {inspection.value?.status.correction_actor_id ? <p>Correction declared by {inspection.value.status.correction_actor_id}{inspection.value.status.correction_recorded_at !== null ? ` on ${new Date(inspection.value.status.correction_recorded_at * 1000).toLocaleString()}` : ''}: {inspection.value.status.correction_reason}</p> : null}
      <details><summary>Declare a replacement for this original</summary><p>Return to the conversation, select the existing Task accountable for this correction, then choose “Declare an original source correction” in its scoped working knowledge. Enter registered original ID <strong>{evidence.reservation.id}</strong> and the already registered replacement. This is available even when extraction produced no working knowledge. Both originals remain unchanged.</p><button type="button" className="quiet-button" onClick={onReturnToTask}>Return to Task source correction</button></details>
      <button type="button" className="quiet-button" disabled={mutation.working || !!mutation.pending} onClick={() => void mutation.apply({ kind: 'recover', scope, evidence_id: evidence.reservation.id, body: { key: crypto.randomUUID() } })}>Check or recover automatic source capture</button>
      <details><summary>Capture an exact source range</summary><p>Offsets refer to the original UTF-8 bytes, including any BOM and CRLF. Choose at most 16 KiB with both boundaries between complete characters. Display positions are not byte offsets.</p><form onSubmit={event => { event.preventDefault(); const byte_start = Number(start), byte_end = Number(end); if (!Number.isSafeInteger(byte_start) || !Number.isSafeInteger(byte_end) || byte_start < 0 || byte_end <= byte_start || byte_end - byte_start > 16384 || byte_end > evidence.reservation.request.identity.size) { mutation.setError('Choose a nonempty original byte range of at most 16384 bytes within the registered original.'); return; } void mutation.apply({ kind: 'excerpt', scope, body: { key: crypto.randomUUID(), evidence_id: evidence.reservation.id, byte_start, byte_end } }); }}>
        <label>Original byte start<input required type="number" min={0} step={1} value={start} onChange={event => setStart(event.target.value)} /></label><label>Original byte end (exclusive)<input required type="number" min={1} max={evidence.reservation.request.identity.size} step={1} value={end} onChange={event => setEnd(event.target.value)} /></label><button type="submit" disabled={mutation.working || !!mutation.pending}>Capture exact registered excerpt</button>
      </form></details>
      {mutation.pending ? <div className="notice"><p>Capture delivery is unconfirmed. The exact source and range are retained.</p><button type="button" disabled={mutation.working} onClick={() => void mutation.apply(mutation.pending!)}>Retry exact source capture</button></div> : null}
      {mutation.error ? <p role="alert">{mutation.error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    </div>
  </section>;
}
