import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Session } from './auth';
import type { Scope } from './engagements';
import type { AssessmentFact } from './assessment';
import { blank as blankText, reasonLabel, verdictLabel } from './assessment';
import {
  MAX_RATIONALE_BYTES, MAX_REFERENCES, causeLabel, concernLabel, concerns, errorLabel, kindLabel, rationaleBytes, readHistory, reviewLabel, saveDisposition, verdicts,
} from './revision';
import type { Chain, ChainHistory, Disposition, DispositionCommand, DispositionResult } from './revision';

interface Props {
  chain: Chain;
  subject: string;
  taskId: string;
  /// The facts of this subject: their verified, readable sources are offered as references.
  facts: AssessmentFact[];
  /// The criterion's key (its lineage), named in the review's label.
  criterion: string;
  /// Without scope and session the history and the form are not offered.
  scope?: Scope;
  session?: Session;
}

const short = (value: string) => <abbr title={value}>{value.slice(0, 13)}</abbr>;
const newKey = () => crypto.randomUUID().replaceAll('-', '');
const disposedLabel = (d: Disposition) => `${kindLabel[d.kind]}${d.verdict ? ` · ${verdictLabel(d.verdict)}` : ''}${d.concern ? ` · about ${concernLabel[d.concern]}` : ''}`;

/// Story 24.3a: an evaluation's revision chain. The head's causes are closed
/// words derived by trusted code; a person's disposition is a separate record
/// that never changes the revision, and only a judgment can be replaced.
export function EvaluationReview({ chain, subject, taskId, facts, criterion, scope, session }: Props) {
  const [pages, setPages] = useState<ChainHistory[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const load = (after: string | null) => {
    if (!scope || !session) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setHistoryError('');
    readHistory(scope, taskId, chain.chain_id, after, session, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setPages(previous => after ? [...previous, page] : [page]);
      setLoading(false);
    }, () => {
      if (controller.signal.aborted) return;
      setHistoryError('The revision history could not be read now. Nothing is shown in its place.');
      setLoading(false);
    });
  };
  const entries = pages.flatMap(p => p.entries);
  const last = pages.at(-1);
  const factName = new Map(pages.flatMap(p => p.facts).map(f => [f.id, `${f.name} (${f.basis_id.slice(0, 13)})`]));
  const name = (id: string) => factName.get(id) ?? id.slice(0, 13);
  return <div className="evaluation-review" role="group" aria-label={`Review of ${criterion} for ${subject}`}>
    <p>
      <strong>Revision {chain.revision}</strong>{chain.causes.length ? <> · because {chain.causes.map(c => causeLabel[c]).join(', ')}</> : null}
      {' · '}<span className={`review review-${chain.review}`}>{reviewLabel[chain.review]}</span>
      {chain.earlier_accepted ? (chain.review === 'unreviewed' ? ' · an earlier revision was accepted; this one is not reviewed yet' : ' · an earlier revision was accepted') : ''}
    </p>
    {chain.revision !== '1' ? <p>Current verdict: {verdictLabel(chain.verdict)}{chain.reason ? ` · ${reasonLabel(chain.reason)}` : ''}</p> : null}
    {chain.effective_origin === 'human' ? <p className="human-verdict">A person's verdict: {verdictLabel(chain.effective_verdict)} · Zobba's judgment is kept as it was</p> : null}
    {chain.disposition ? <p className="context-note">{disposedLabel(chain.disposition)} by {chain.disposition.actor_label ?? 'a person'}: <span className="retained-text">{chain.disposition.rationale}</span></p> : null}
    {scope && session ? <>
      <button type="button" className="text-button" aria-expanded={open}
        onClick={() => { const next = !open; setOpen(next); if (next && !pages.length) load(null); }}>
        {open ? 'Hide revision history' : 'Show revision history'}
      </button>
      {open ? <div role="region" aria-label={`Revision history of ${criterion} for ${subject}`}>
        {historyError ? <p role="alert" className="form-error">{historyError}</p> : null}
        {last ? <p className="context-note">{last.total} {last.total === '1' ? 'revision' : 'revisions'} · showing {entries.length}</p> : null}
        <ol className="revision-history">{entries.map(e => <li key={e.id}>
          <p><strong>Revision {e.revision}</strong> · {short(e.id)} · {verdictLabel(e.verdict)}{e.reason ? ` · ${reasonLabel(e.reason)}` : ''} · {e.origin === 'deterministic' ? 'rule evaluated by the platform' : 'judgment proposed by Zobba'}</p>
          {e.causes.length ? <p>Because {e.causes.map(c => causeLabel[c]).join(', ')}</p> : <p>The first evaluation</p>}
          {e.changes.added.length || e.changes.removed.length || e.changes.replaced.length ? <p className="context-note">
            {e.changes.added.length ? `Added ${e.changes.added.map(name).join(', ')}. ` : ''}
            {e.changes.removed.length ? `Removed ${e.changes.removed.map(name).join(', ')}. ` : ''}
            {e.changes.replaced.length ? `Replaced ${e.changes.replaced.map(r => `${name(r.from)} with ${name(r.to)}`).join(', ')}.` : ''}
          </p> : null}
          {e.judgment ? <p><span className="retained-text">{e.judgment.rationale}</span></p> : null}
          {e.dispositions.length ? <ul aria-label={`Reviews of revision ${e.revision}`}>{e.dispositions.map(d => <li key={d.id}>{disposedLabel(d)} by {d.actor_label ?? 'a person'}: <span className="retained-text">{d.rationale}</span>{d.references.length ? ` · ${d.references.length} ${d.references.length === 1 ? 'reference' : 'references'}` : ''}</li>)}</ul> : null}
        </li>)}</ol>
        {loading ? <p className="context-note">Reading revisions…</p> : null}
        {last?.next_cursor ? <button type="button" className="text-button" aria-disabled={loading} onClick={() => { if (!loading) load(last.next_cursor); }}>Show more revisions</button> : null}
      </div> : null}
      <DispositionForm key={chain.head_id} chain={chain} taskId={taskId} facts={facts} scope={scope} session={session} />
    </> : null}
  </div>;
}

type Kind = DispositionCommand['kind'];

function DispositionForm({ chain, taskId, facts, scope, session }: { chain: Chain; taskId: string; facts: AssessmentFact[]; scope: Scope; session: Session }) {
  const id = useId();
  const replaceable = chain.origin === 'model_proposal';
  const [kind, setKind] = useState<Kind>('accepted');
  const [verdict, setVerdict] = useState<string>('not_met');
  const [concern, setConcern] = useState<string>('facts');
  const [rationale, setRationale] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<DispositionResult | null>(null);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  // Verified quotes the person may cite: each is checked again at save.
  const offered = useMemo(() => facts.flatMap(f => f.sources
    // A page alone is never verified at save, so it is never offered.
    .filter(s => s.readable && s.verification === 'verified' && s.locator && !s.locator.startsWith('page:') && s.quote)
    .map(s => ({ key: `${s.original_id}|${s.locator}|${s.quote}`, label: `${f.name} · ${s.location ?? s.locator} · “${s.quote}”`, reference: { original_id: s.original_id, locator: s.locator!, quote: s.quote! } })))
    .filter((item, index, all) => all.findIndex(o => o.key === item.key) === index), [facts]);
  const command: DispositionCommand = {
    key: '', kind,
    verdict: kind === 'replaced' ? verdict : null,
    concern: kind === 'needs_reconsideration' ? concern : null,
    rationale,
    references: offered.filter(o => chosen.includes(o.key)).map(o => o.reference),
  };
  // One request key per exact request: a retry of the same request reuses
  // it. While a request's delivery is uncertain its exact body keeps its
  // key, even after the person edits the text and restores it, so a request
  // that did commit is never saved a second time under a new key.
  const content = JSON.stringify(command);
  const uncertain = useRef<{ content: string; key: string } | null>(null);
  const key = useMemo(() => uncertain.current?.content === content ? uncertain.current.key : newKey(), [content]);
  const bytes = rationaleBytes(rationale);
  const blank = blankText.test(rationale);
  const over = bytes > MAX_RATIONALE_BYTES;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || blank || over) return;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setSaving(true);
    setFailed(false);
    const sent = { content, key };
    saveDisposition(scope, taskId, chain.head_id, { ...command, key }, session, c.signal).then(r => {
      if (c.signal.aborted) return;
      // A definite answer (saved or refused) ends the uncertainty.
      uncertain.current = null;
      setResult(r);
      setSaving(false);
    }, () => {
      if (c.signal.aborted) return;
      uncertain.current = sent;
      setFailed(true);
      setSaving(false);
    });
  };
  if (result?.ok) {
    return <p role="status" className="disposition-saved">Saved: {disposedLabel(result.disposition)}. The revision itself is unchanged.</p>;
  }
  return <form className="disposition-form" onSubmit={submit} aria-label={`Review revision ${chain.revision}`}>
    <fieldset>
      <legend>Your review of revision {chain.revision}</legend>
      <label><input type="radio" name={`${id}-kind`} value="accepted" checked={kind === 'accepted'} onChange={() => setKind('accepted')} /> Accept</label>
      {replaceable ? <label><input type="radio" name={`${id}-kind`} value="replaced" checked={kind === 'replaced'} onChange={() => setKind('replaced')} /> Replace Zobba's judgment with my verdict</label>
        : <p className="context-note" id={`${id}-rule`}>A rule verdict cannot be replaced: correct the facts or the criterion, or ask Zobba to reconsider.</p>}
      <label><input type="radio" name={`${id}-kind`} value="needs_reconsideration" checked={kind === 'needs_reconsideration'} onChange={() => setKind('needs_reconsideration')} /> Ask Zobba to reconsider</label>
    </fieldset>
    {kind === 'replaced' ? <><label htmlFor={`${id}-verdict`}>My verdict</label><select id={`${id}-verdict`} value={verdict} onChange={e => setVerdict(e.target.value)}>
      {verdicts.map(v => <option key={v} value={v}>{verdictLabel(v)}</option>)}
    </select></> : null}
    {kind === 'needs_reconsideration' ? <><label htmlFor={`${id}-concern`}>What to reconsider</label><select id={`${id}-concern`} value={concern} onChange={e => setConcern(e.target.value)}>
      {concerns.map(c => <option key={c} value={c}>{concernLabel[c]}</option>)}
    </select></> : null}
    <label htmlFor={`${id}-rationale`}>Your reasons</label>
    <textarea id={`${id}-rationale`} value={rationale} onChange={e => setRationale(e.target.value)} rows={3} aria-describedby={`${id}-bytes`} aria-invalid={over || undefined} />
    <p id={`${id}-bytes`} className={over ? 'form-error' : 'context-note'} aria-live="polite">{bytes.toLocaleString('en-GB')} of {MAX_RATIONALE_BYTES.toLocaleString('en-GB')} bytes</p>
    {offered.length ? <fieldset className="reference-chips">
      <legend>Evidence references (verified again when you save; at most {MAX_REFERENCES})</legend>
      {offered.map(o => <label key={o.key} className="reference-chip"><input type="checkbox" checked={chosen.includes(o.key)}
        disabled={!chosen.includes(o.key) && chosen.length >= MAX_REFERENCES}
        onChange={e => setChosen(previous => e.target.checked ? [...previous, o.key] : previous.filter(k => k !== o.key))} /> {o.label}</label>)}
    </fieldset> : null}
    {result && !result.ok ? <p role="alert" className="form-error">{errorLabel[result.error]}{result.index !== null ? ` (reference ${result.index + 1})` : ''}{result.head_id ? <> Newest revision: {short(result.head_id)}.</> : null}</p> : null}
    {failed ? <p role="alert" className="form-error">The disposition may not have been saved. Save again: the same request is not recorded twice.</p> : null}
    <button type="submit" aria-disabled={saving || blank || over}>{saving ? 'Saving…' : 'Save review'}</button>
  </form>;
}
