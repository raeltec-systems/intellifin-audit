import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Session } from './auth';
import type { Scope } from './engagements';
import type { AssessmentFact } from './assessment';
import { blank as blankText } from './assessment';
import {
  EXCEPTION_PAGE, MAX_RATIONALE_BYTES, MAX_REFERENCES, conclusionLabel, errorLabel, rationaleBytes, readException, readExceptions, saveExceptionDisposition, sourceLabel, statusLabel,
} from './exceptions';
import type { EffectiveSummary, ExceptionDetail, ExceptionDispositionCommand, ExceptionDispositionResult, ExceptionView, ExceptionsList } from './exceptions';

interface Props {
  taskId: string;
  scope: Scope;
  session: Session;
  /// The Task's facts: their verified, readable sources are offered as references.
  facts: AssessmentFact[];
  /// Criterion lineage roots by their key, for labels.
  criterionKeys: Map<string, string>;
}

const short = (value: string) => <abbr title={value}>{value.slice(0, 13)}</abbr>;
const newKey = () => crypto.randomUUID().replaceAll('-', '');
const number = (value: string) => BigInt(value).toLocaleString('en-GB');
const plural = (value: string, one: string, many = `${one}s`) => `${number(value)} ${value === '1' ? one : many}`;

/// Story 24.3b: the Task's exceptions and its effective summaries. Every not
/// met result is an occurrence of its exception, recorded by the platform;
/// the status is derived on every read and never stored. Only an Audit
/// manager or the Task's accountable person may close (with verified
/// evidence) or reopen an exception, and no closure ever drops a failing
/// count. There are no waivers.
export function Exceptions({ taskId, scope, session, facts, criterionKeys }: Props) {
  const [list, setList] = useState<ExceptionsList | null>(null);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  // The cursors of the pages before this one (the first page has none).
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const after = pages[pages.length - 1] ?? null;
  useEffect(() => {
    const controller = new AbortController();
    readExceptions(scope, taskId, after, session, controller.signal).then(value => {
      if (!controller.signal.aborted) { setList(value); setError(''); }
    }, () => {
      if (!controller.signal.aborted) setError('The exceptions could not be read now. Nothing is shown in their place.');
    });
    return () => controller.abort();
  }, [scope, taskId, session, generation, after]);
  if (error) return <section className="task-exceptions" aria-label="Exceptions"><h4>Exceptions</h4><p role="alert" className="form-error">{error}</p></section>;
  if (!list || (list.counts.total === '0' && !list.effective_summaries.length)) return null;
  const key = (root: string) => criterionKeys.get(root) ?? root.slice(0, 13);
  const c = list.counts;
  return <section className="task-exceptions" aria-label="Exceptions">
    <h4>Exceptions</h4>
    <p className="context-note">Every not met result is recorded by the platform as an occurrence of its exception, one exception per criterion and subject. Each status is derived from the records every time it is read; a closure never changes an occurrence or a verdict, and never lowers a failing count.</p>
    <ul className="exception-counts" aria-label="Exceptions by status">
      <li>{plural(c.total, 'exception')} over {plural(c.subjects, 'distinct subject')}</li>
      <li>Open: {number(c.open)}</li>
      <li>Resolved by evidence: {number(c.resolved_by_evidence)}</li>
      <li>Replaced by human judgment: {number(c.replaced_by_human_judgment)}</li>
      <li>Closed by disposition: {number(c.closed_by_disposition)}</li>
    </ul>
    {BigInt(list.exceptions.length) < BigInt(c.total) ? <p className="work-omitted">Page {pages.length}: {plural(String(list.exceptions.length), 'exception')} of {number(c.total)} are listed; the counts above are over every one of them.</p> : null}
    {pages.length > 1 || list.next_cursor ? <nav className="exception-pages" aria-label="Exception pages">
      <button type="button" className="text-button" disabled={pages.length <= 1} onClick={() => setPages(p => p.slice(0, -1))}>Previous {EXCEPTION_PAGE}</button>
      <button type="button" className="text-button" disabled={!list.next_cursor} onClick={() => { const next = list.next_cursor; if (next) setPages(p => [...p, next]); }}>Next {EXCEPTION_PAGE}</button>
    </nav> : null}
    {list.exceptions.length ? <div className="coverage-scroll" role="group" aria-label="Exception list" tabIndex={0}><table className="coverage-table exception-table">
      <caption>Exceptions by subject and criterion</caption>
      <thead><tr><th scope="col">Subject</th><th scope="col">Criterion</th><th scope="col">Status</th><th scope="col">Occurrences</th><th scope="col">Review</th></tr></thead>
      <tbody>{list.exceptions.map(e => <ExceptionRow key={e.id} exception={e} criterion={key(e.criterion_root)} taskId={taskId} scope={scope} session={session}
        facts={facts} mayClose={list.may_close} onSaved={() => setGeneration(g => g + 1)} />)}</tbody>
    </table></div> : null}
    {!list.may_close ? <p className="context-note">Only an Audit manager or the Task's accountable person may close or reopen an exception.</p> : null}
    {list.effective_summaries.length ? <>
      <h5>Effective summaries</h5>
      <p className="context-note">The coverage count again over the current revisions and people's dispositions, recounted by the database. Its denominators are the population's own.</p>
      {BigInt(list.effective_summaries.length) < BigInt(list.total_effective_summaries) ? <p className="work-omitted">{number((BigInt(list.total_effective_summaries) - BigInt(list.effective_summaries.length)).toString())} earlier effective summaries are not shown; the most recent {list.effective_summaries.length} are.</p> : null}
      <ul className="coverage-summaries">{list.effective_summaries.map(s => <EffectiveView key={s.id} summary={s} />)}</ul>
    </> : null}
  </section>;
}

function EffectiveView({ summary }: { summary: EffectiveSummary }) {
  const s = summary.summary;
  const at = (value: string) => summary.exact ? number(value) : `at least ${number(value)}`;
  const x = summary.exceptions;
  return <li>
    <p className="coverage-conclusion"><strong>Effective summary {short(summary.id)}</strong>{summary.supersedes ? <> · supersedes {short(summary.supersedes)}</> : null}: {conclusionLabel[summary.conclusion]}</p>
    {summary.conclusion !== s.conclusion ? <p className="context-note">An exception of these subjects is open, so this summary does not conclude that no exception exists (the coverage count alone found none).</p> : null}
    <ul aria-label={`Effective counts of ${summary.id.slice(0, 18)}`}>
      <li>Subjects with at least one exception: {at(s.failing_subjects)}</li>
      <li>Meeting every criterion that applies: {at(s.meets_every_applicable)}</li>
      <li>Unresolved: {at(s.unresolved_subjects)}</li>
      <li>No criterion applies: {at(s.not_applicable_to_any)}</li>
      <li>Failing criterion opportunities (not subjects): {at(s.failing_opportunities)}</li>
      <li>Exceptions: {number(x.total)} ({number(x.open)} open · {number(x.resolved_by_evidence)} resolved by evidence · {number(x.replaced_by_human_judgment)} replaced by human judgment · {number(x.closed_by_disposition)} closed by disposition) over {plural(x.subjects, 'distinct subject')}</li>
      {summary.exact ? null : <li>The total is not known: the population is incomplete.</li>}
    </ul>
    {summary.effective_limitations.length ? <ul aria-label="Effective summary limitations">{summary.effective_limitations.map(l => <li key={l.code}>{l.text}</li>)}</ul> : null}
  </li>;
}

function ExceptionRow({ exception, criterion, taskId, scope, session, facts, mayClose, onSaved }: {
  exception: ExceptionView; criterion: string; taskId: string; scope: Scope; session: Session; facts: AssessmentFact[]; mayClose: boolean; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ExceptionDetail | null>(null);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const load = (after: string | null = null) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError('');
    readException(scope, taskId, exception.id, after, session, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      // A later page adds its occurrences after the ones already shown.
      setDetail(previous => after && previous ? { ...value, occurrences: [...previous.occurrences, ...value.occurrences] } : value);
    }, () => {
      if (!controller.signal.aborted) setError('This exception could not be read now. Nothing is shown in its place.');
    });
  };
  const d = exception.disposition;
  return <tr>
    <th scope="row">{exception.subject}</th>
    <td>{criterion}</td>
    <td><span className={`exception-status exception-${exception.status}`}>{statusLabel[exception.status]}</span>
      <p className="context-note">{exception.status_words}</p>
      {d ? <p className="context-note">{d.kind === 'closed' ? 'Closed' : 'Reopened'} by {d.actor_label ?? 'a person'}: <span className="retained-text">{d.rationale}</span></p> : null}
    </td>
    <td>{number(exception.occurrences)} · first from {sourceLabel[exception.first_source_kind]}</td>
    <td>
      <button type="button" className="text-button" aria-expanded={open} onClick={() => { const next = !open; setOpen(next); if (next && !detail) load(); }}>
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open ? <div role="region" aria-label={`Exception ${criterion} for ${exception.subject}`}>
        {error ? <p role="alert" className="form-error">{error}</p> : null}
        {detail ? <>
          <ol className="exception-occurrences" aria-label="Occurrences">{detail.occurrences.map(o => <li key={o.seq}>
            Not met in {sourceLabel[o.source_kind]} {short(o.source_id)} · {o.origin === 'human' ? "a person's verdict" : o.origin === 'deterministic' ? 'rule evaluated by the platform' : 'judgment proposed by Zobba'}
          </li>)}</ol>
          {detail.next_cursor ? <p className="work-omitted">More occurrences are recorded than shown. <button type="button" className="text-button" onClick={() => load(detail.next_cursor)}>Show the next {50}</button></p> : null}
          {detail.dispositions.length ? <ul aria-label="Dispositions">{detail.dispositions.map(x => <li key={x.id}>
            {x.kind === 'closed' ? 'Closed' : 'Reopened'} by {x.actor_label ?? 'a person'}: <span className="retained-text">{x.rationale}</span>{x.references.length ? ` · ${plural(String(x.references.length), 'reference')}` : ''}
          </li>)}</ul> : null}
        </> : <p className="context-note">Reading the exception…</p>}
        {mayClose && exception.status !== 'closed_by_disposition'
          ? <DispositionForm key={`close/${exception.id}/${d?.id ?? ''}`} kind="closed" exception={exception} taskId={taskId} scope={scope} session={session} facts={facts} onSaved={() => { setDetail(null); onSaved(); }} />
          : null}
        {mayClose && exception.status === 'closed_by_disposition'
          ? <DispositionForm key={`reopen/${exception.id}/${d?.id ?? ''}`} kind="reopened" exception={exception} taskId={taskId} scope={scope} session={session} facts={facts} onSaved={() => { setDetail(null); onSaved(); }} />
          : null}
      </div> : null}
    </td>
  </tr>;
}

function DispositionForm({ kind, exception, taskId, scope, session, facts, onSaved }: {
  kind: 'closed' | 'reopened'; exception: ExceptionView; taskId: string; scope: Scope; session: Session; facts: AssessmentFact[]; onSaved: () => void;
}) {
  const id = useId();
  const [rationale, setRationale] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ExceptionDispositionResult | null>(null);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const offered = useMemo(() => facts.flatMap(f => f.sources
    .filter(s => s.readable && s.verification === 'verified' && s.locator && !s.locator.startsWith('page:') && s.quote)
    .map(s => ({ key: `${s.original_id}|${s.locator}|${s.quote}`, label: `${f.name} · ${s.location ?? s.locator} · “${s.quote}”`, reference: { original_id: s.original_id, locator: s.locator!, quote: s.quote! } })))
    .filter((item, index, all) => all.findIndex(o => o.key === item.key) === index), [facts]);
  const command: ExceptionDispositionCommand = {
    key: '', kind, rationale,
    references: offered.filter(o => chosen.includes(o.key)).map(o => o.reference),
  };
  // One request key per exact request; an uncertain request keeps its key.
  const content = JSON.stringify(command);
  const uncertain = useRef<{ content: string; key: string } | null>(null);
  const key = useMemo(() => uncertain.current?.content === content ? uncertain.current.key : newKey(), [content]);
  const bytes = rationaleBytes(rationale);
  const blank = blankText.test(rationale);
  const over = bytes > MAX_RATIONALE_BYTES;
  const noEvidence = kind === 'closed' && command.references.length === 0;
  const disabled = saving || blank || over || noEvidence;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setSaving(true);
    setFailed(false);
    const sent = { content, key };
    saveExceptionDisposition(scope, taskId, exception.id, { ...command, key }, session, c.signal).then(r => {
      if (c.signal.aborted) return;
      uncertain.current = null;
      setResult(r);
      setSaving(false);
      if (r.ok) onSaved();
    }, () => {
      if (c.signal.aborted) return;
      uncertain.current = sent;
      setFailed(true);
      setSaving(false);
    });
  };
  if (result?.ok) return <p role="status" className="disposition-saved">Saved: {kind === 'closed' ? 'closed' : 'reopened'}. Its occurrences and verdicts are unchanged.</p>;
  const action = kind === 'closed' ? 'Close' : 'Reopen';
  return <form className="disposition-form" onSubmit={submit} aria-label={`${action} exception ${exception.subject}`}>
    <label htmlFor={`${id}-rationale`}>{kind === 'closed' ? 'Why this exception is closed' : 'Why this exception is reopened'}</label>
    <textarea id={`${id}-rationale`} value={rationale} onChange={e => setRationale(e.target.value)} rows={3} aria-describedby={`${id}-bytes`} aria-invalid={over || undefined} />
    <p id={`${id}-bytes`} className={over ? 'form-error' : 'context-note'} aria-live="polite">{bytes.toLocaleString('en-GB')} of {MAX_RATIONALE_BYTES.toLocaleString('en-GB')} bytes</p>
    {offered.length ? <fieldset className="reference-chips">
      <legend>Evidence references (verified again when you save; {kind === 'closed' ? 'at least one, ' : ''}at most {MAX_REFERENCES})</legend>
      {offered.map(o => <label key={o.key} className="reference-chip"><input type="checkbox" checked={chosen.includes(o.key)}
        disabled={!chosen.includes(o.key) && chosen.length >= MAX_REFERENCES}
        onChange={e => setChosen(previous => e.target.checked ? [...previous, o.key] : previous.filter(k => k !== o.key))} /> {o.label}</label>)}
    </fieldset> : kind === 'closed' ? <p className="context-note">No verified evidence of this Task can be cited yet, so this exception cannot be closed.</p> : null}
    {noEvidence && offered.length ? <p className="context-note" id={`${id}-evidence`}>Choose at least one evidence reference to close the exception.</p> : null}
    {result && !result.ok ? <p role="alert" className="form-error">{errorLabel[result.error]}{result.index !== null ? ` (reference ${result.index + 1})` : ''}</p> : null}
    {failed ? <p role="alert" className="form-error">The disposition may not have been saved. Save again: the same request is not recorded twice.</p> : null}
    <button type="submit" aria-disabled={disabled} aria-describedby={noEvidence && offered.length ? `${id}-evidence` : undefined}>{saving ? 'Saving…' : `${action} exception`}</button>
  </form>;
}
