import { useEffect, useRef, useState } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import type { SaveMethodology } from './methodology';
import { MAX_PROPOSAL_DOCUMENT_BYTES, citationsFor, proposalCommand, proposeMethodology, readProposals, validDocument, validLabel, validProfileId } from './proposal';
import type { MethodologyProposal, ProposalCitation, ProposalRequest } from './proposal';

interface Props { organisation: string; session: Session; expectedRevision: string; disabled: boolean; onOpen: (command: SaveMethodology) => void }

const fieldNames = { criteria: 'Criteria', populations: 'Populations and sampling', evidence_checks: 'Evidence checks', ratings: 'Ratings', review_rules: 'Review and issuance rules' } as const;
/** Every recorded failure reason, in words. */
const reasons: Record<string, string> = {
  no_verified_requirements: 'No requirement in the answer could be found in the document, so nothing was proposed.',
  proposal_invalid: 'The answer did not form a valid methodology, so nothing was proposed.',
  proposal_too_large: 'The drafted proposal was too large to record, so nothing was proposed. Try a shorter document.',
  model_malformed: 'The model answer was not in the required form, so nothing was proposed.',
  model_refused: 'The model declined to answer, so nothing was proposed.',
  model_incomplete: 'The model answer was cut off, so nothing was proposed.',
  model_cancelled: 'The model request was cancelled, so nothing was proposed.',
  model_unavailable: 'The model service was unavailable, so nothing was proposed.',
  model_provider_error: 'The model service reported an error, so nothing was proposed.',
  model_timeout: 'The model did not answer in time, so nothing was proposed.',
  model_rate_limited: 'The model service was busy (rate limited), so nothing was proposed.',
  model_capacity: 'The model service had no capacity, so nothing was proposed.',
  model_transport_error: 'The connection to the model service failed, so nothing was proposed.',
  model_access_denied: 'The model service refused access for this profile, so nothing was proposed.',
  model_identity_mismatch: 'The model service answered as a different model, so nothing was proposed.',
  model_redirect_refused: 'The model service tried to redirect the request, which is refused, so nothing was proposed.',
  model_unqualified: 'The profile is not qualified for this use, so nothing was proposed.',
  model_unsupported: 'The profile does not support this request, so nothing was proposed.',
  model_fenced: 'The request was no longer authorised when it was sent, so nothing was proposed.',
  model_conflict: 'The model request conflicted with another request, so nothing was proposed.',
};
const reasonText = (reason: string | null) => reasons[reason ?? ''] ?? 'The model request ended without a proposal.';

/** A refusal the server definitely returned, in words. */
function refusal(error: unknown): string | null {
  if (!(error instanceof AccessError)) return null;
  switch (error.status) {
    case 400: return 'The request was refused as invalid. Check the document, file name and profile ID.';
    case 403: return 'You are not permitted to draft methodology proposals for this organisation.';
    case 409: return 'This request key was already used for a different document or profile. Choose the document again to make a new request.';
    case 413: return 'The document is larger than 200,000 bytes.';
    case 429: return 'Too many proposals are being drafted. Wait, then retry the same request.';
    default: return null;
  }
}

function Cite({ citations }: { citations: ProposalCitation[] }) {
  if (!citations.length) return null;
  // The byte range is part of the text, so keyboard and screen-reader users get it too.
  return <>{citations.map((c, i) => <q className="proposal-cite" key={i}>line {c.location.line}, bytes {c.location.start}–{c.location.end}: {c.quote}</q>)}</>;
}

/** Draft from a document: an editable, cited proposal that nothing applies. */
export function MethodologyProposal({ organisation, session, expectedRevision, disabled, onOpen }: Props) {
  const [profile, setProfile] = useState('');
  const [request, setRequest] = useState<ProposalRequest | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState<MethodologyProposal[]>([]);
  const [listError, setListError] = useState('');
  const [shown, setShown] = useState<MethodologyProposal | null>(null);
  const control = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setListError('');
    readProposals(organisation, session, abort.signal).then(setProposals).catch(() => {
      if (!abort.signal.aborted) { setProposals([]); setListError('Recent proposals could not be loaded.'); }
    });
    return () => abort.abort();
  }, [organisation, session]);
  useEffect(() => () => control.current?.abort(), []);

  async function choose(file: File | undefined) {
    setError(''); setShown(null);
    if (!file) { setRequest(null); return; }
    const media_type = file.type === 'text/markdown' || /\.(md|markdown)$/i.test(file.name) ? 'text/markdown' : file.type === 'text/plain' || /\.txt$/i.test(file.name) ? 'text/plain' : null;
    if (!media_type) { setRequest(null); setError('Only plain text or Markdown documents can be verified here. Convert other formats to text first.'); return; }
    if (file.size > MAX_PROPOSAL_DOCUMENT_BYTES) { setRequest(null); setError('The document is larger than 200,000 bytes.'); return; }
    if (!validLabel(file.name)) { setRequest(null); setError('The file name must be 1–200 characters with no control characters. Rename the file and choose it again.'); return; }
    // The exact bytes, decoded strictly: invalid UTF-8 is refused, never
    // repaired, and a byte order mark is kept as it is.
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new Uint8Array(await file.arrayBuffer()));
    } catch { setRequest(null); setError('The document is not valid UTF-8 text.'); return; }
    if (!validDocument(text)) { setRequest(null); setError('The document must contain text and no control characters other than tabs and line breaks.'); return; }
    // A new document is a new request; the key is kept for an exact retry.
    setRequest({ key: crypto.randomUUID(), profile_id: profile, filename: file.name, media_type, text });
  }
  async function submit() {
    if (!request || !profile) return;
    if (!validProfileId(profile)) { setError('The profile ID uses only letters, digits, hyphens and underscores (at most 128).'); return; }
    const exact = { ...request, profile_id: request.profile_id || profile };
    setRequest(exact); setWorking(true); setError('');
    control.current?.abort();
    const abort = new AbortController(); control.current = abort;
    try {
      const proposal = await proposeMethodology(organisation, exact, session, abort.signal);
      setShown(proposal);
      setProposals(current => [proposal, ...current.filter(p => p.id !== proposal.id)].slice(0, 20));
    } catch (reason) {
      if (abort.signal.aborted) return;
      const refused = refusal(reason);
      setError(refused ?? 'The proposal request was not confirmed. Retry sends the same request key; an already recorded request is never sent again.');
    } finally { if (control.current === abort) setWorking(false); }
  }

  async function refresh(id: string) {
    const abort = new AbortController();
    try {
      const current = await readProposals(organisation, session, abort.signal);
      setListError(''); setProposals(current);
      const found = current.find(item => item.id === id);
      if (found) setShown(found);
    } catch { setListError('Recent proposals could not be loaded.'); }
  }

  const p = shown;
  return <section className="methodology-proposal" aria-label="Draft from a methodology document">
    <h3>Draft from a methodology document</h3>
    <p className="scope-note">Zobba drafts an editable proposal from your document. Every proposed value cites the document; values whose quote is not found are left out. Nothing changes until you review the proposal in the editor and Save it.</p>
    <fieldset disabled={disabled || working}>
      <label>Methodology document (text or Markdown)<input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={event => void choose(event.target.files?.[0])} /></label>
      <label>Model profile ID<input value={profile} maxLength={128} pattern="[A-Za-z0-9_-]+" onChange={event => { setProfile(event.target.value); if (request) setRequest({ ...request, profile_id: event.target.value, key: crypto.randomUUID() }); }} /></label>
      <button type="button" disabled={!request || !profile} onClick={() => void submit()}>{working ? 'Drafting…' : error ? 'Retry exact proposal request' : 'Draft proposal'}</button>
    </fieldset>
    {error ? <p className="notice" role="alert">{error}</p> : null}
    {p ? <article className="proposal-result" aria-label="Methodology proposal">
      <h4>{p.definition?.name ?? p.disclosure.filename}</h4>
      <p>{p.disclosure.filename} · SHA-256 {p.disclosure.document_sha256.slice(0, 12)}… · profile {p.disclosure.profile_id} revision {p.disclosure.profile_revision} ({p.disclosure.model})</p>
      {p.status === 'in_progress' ? <p className="notice" role="status">Zobba is still drafting this proposal. Check again shortly; the document is not sent again. <button type="button" className="text-button" onClick={() => void refresh(p.id)}>Check again</button></p> : null}
      {p.status === 'uncertain' ? <p className="notice" role="status">The document was possibly sent and no result was recorded. It is not sent again under this request.</p> : null}
      {p.status === 'failed' ? <p className="notice" role="status">No proposal: {reasonText(p.reason)}</p> : null}
      {p.definition ? <>
        <p className="scope-note">Proposal only — not saved. Source: {p.source?.reference}</p>
        {p.definition.requirements.map((r, index) => <section className="methodology-requirement" key={r.id} aria-label={`Proposed requirement ${r.id}`}>
          <h5>{r.id} · {r.label}{r.mandatory ? ' · Mandatory' : ''}</h5>
          <p><Cite citations={citationsFor(p, `requirements[${index}].label`)} /> <Cite citations={citationsFor(p, `requirements[${index}].mandatory`)} /></p>
          {(Object.keys(fieldNames) as (keyof typeof fieldNames)[]).map(name => r[name]?.length ? <div key={name}><strong>{fieldNames[name]}</strong><ul>{r[name]!.map((value, item) => <li key={item}>{value} <Cite citations={citationsFor(p, `requirements[${index}].${name}[${item}]`)} /></li>)}</ul></div> : null)}
        </section>)}
        {p.missing_criteria.length ? <section aria-label="Missing criteria"><h5>Missing criteria</h5><p>These requirements have no criteria in the document. Add them before Save, or Zobba will record a criteria gap.</p><ul>{p.missing_criteria.map(id => <li key={id}>{id}</li>)}</ul></section> : null}
        {p.conflicts.length ? <section aria-label="Interpretation conflicts"><h5>Interpretation conflicts</h5><ul>{p.conflicts.map((c, i) => <li key={i}>{c.text} <q className="proposal-cite">line {c.location.line}, bytes {c.location.start}–{c.location.end}: {c.quote}</q></li>)}</ul></section> : null}
        <p className="scope-note">A verified quote shows that the text exists in the document, not that the proposed value is right. Review every value before Save.</p>
        {p.unverified.length ? <details><summary>{p.unverified.length} proposed values were left out (quote not found, too short, ambiguous or over a limit)</summary><ul>{p.unverified.map((field, i) => <li key={i}>{field}</li>)}</ul></details> : null}
        <button type="button" disabled={disabled} onClick={() => onOpen(proposalCommand(p, expectedRevision, crypto.randomUUID()))}>Review in editor</button>
      </> : null}
    </article> : null}
    {listError ? <p className="notice" role="alert">{listError}</p> : null}
    {proposals.length ? <details><summary>Recent proposals</summary><ul>{proposals.map(item => <li key={item.id}><button type="button" className="text-button" onClick={() => setShown(item)}>{item.disclosure.filename} · {item.status === 'in_progress' ? 'in progress' : item.status}</button></li>)}</ul></details> : null}
  </section>;
}
