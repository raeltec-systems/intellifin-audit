import type { Evidence } from './evidence';

const sourceLabels = { system: 'Source system', account: 'Source account', source_version: 'Source version', selection: 'Query or selection', coverage: 'Known coverage' };
function acquiredAt(seconds: number) { return new Date(seconds * 1000).toLocaleString(); }

/** These immutable custody facts remain distinct from uploader assertions. */
export function EvidenceProvenance({ evidence }: { evidence: Evidence }) {
  const { reservation } = evidence, { request, scope } = reservation;
  return <div className="evidence-provenance">
    <dl>
      <div><dt>Acquisition status</dt><dd>Registered immutable original</dd></div>
      <div><dt>Acquisition</dt><dd>Direct upload by {reservation.actor_id}</dd></div>
      <div><dt>Verified acquisition completed</dt><dd>{acquiredAt(evidence.registered_at)}</dd></div>
      <div><dt>Source engagement</dt><dd>{scope.organisation_id} / {scope.client_id} / {scope.engagement_id}</dd></div>
      <div><dt>Evidence identity</dt><dd>{reservation.id}</dd></div>
      <div><dt>Measured size</dt><dd>{request.identity.size.toLocaleString()} bytes</dd></div>
      <div><dt>Measured SHA-256</dt><dd>{request.identity.sha256}</dd></div>
      <div><dt>Verified storage version</dt><dd>{evidence.version}</dd></div>
      <div><dt>Reserved</dt><dd>{acquiredAt(reservation.reserved_at)}</dd></div>
    </dl>
    <h4>Attributed source assertions</h4>
    <dl>
      <div><dt>Original filename</dt><dd>{request.filename}</dd></div>
      {(Object.keys(sourceLabels) as (keyof typeof sourceLabels)[]).map(key => <div key={key}><dt>{sourceLabels[key]}</dt><dd>{request.source[key] ?? 'Unknown'}</dd></div>)}
    </dl>
    <p className="field-help">The filename and source details are the acquisition actor’s assertions. Source version is asserted separately from the verified storage version. Byte identity establishes neither source truth nor completeness.</p>
  </div>;
}
