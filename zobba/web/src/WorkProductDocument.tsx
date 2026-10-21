import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { AccessError, Session } from './auth';
import type { Scope } from './engagements';
import { Citation } from './Citation';
import {
  AGENT_LABEL, MAX_BYTES, blockKindLabel, bytes, downloadExport, editBlocks, editErrorLabel, exportErrorLabel, formats, kindLabel,
  readSupport, readVersion, refusalLabel, requestExport, saveEdit, textProblem,
} from './work-product';
import type { DraftBlock, EditResult, WorkProductBlock, WorkProductExport, WorkProductSupport, WorkProductVersion } from './work-product';

interface Props {
  taskId: string;
  scope: Scope;
  session: Session;
  product: string;
  version: string;
  accessReady: boolean;
  onSourceAccessFailure: (error: AccessError) => void;
  onOpenVersion: (version: string) => void;
  onClose: () => void;
}

const short = (value: string) => <abbr title={value}>{value.slice(0, 12)}</abbr>;
const newKey = () => crypto.randomUUID().replaceAll('-', '');
const number = (value: string) => BigInt(value).toLocaleString('en-GB');
const plural = (value: string, one: string, many = `${one}s`) => `${number(value)} ${value === '1' ? one : many}`;

/// One exact version of a work product, by template section. Claims are
/// numbered; each shows whether it is current now, its platform coverage line
/// and its citations, and opens its support. A newer version is announced,
/// never swapped in. A person may edit the latest version into a new one.
export function WorkProductDocument({ taskId, scope, session, product, version, accessReady, onSourceAccessFailure, onOpenVersion, onClose }: Props) {
  const [view, setView] = useState<WorkProductVersion | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    readVersion(scope, taskId, product, version, session, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setView(value); setError('');
      requestAnimationFrame(() => heading.current?.focus());
    }, () => {
      if (!controller.signal.aborted) setError('This version could not be read now. Nothing is shown in its place.');
    });
    return () => controller.abort();
  }, [scope, taskId, product, version, session]);
  const titleId = useId();
  if (error) return <section className="work-product-document" aria-label="Work product"><p role="alert" className="form-error">{error}</p>
    <button type="button" className="text-button" onClick={onClose}>Close</button></section>;
  if (!view) return <section className="work-product-document" aria-label="Work product"><p role="status">Reading the work product…</p></section>;
  const latest = view.newer_version_id === null;
  return <article className="work-product-document" aria-labelledby={titleId}>
    <header className="work-product-header">
      <h5 id={titleId} ref={heading} tabIndex={-1}>{view.title}</h5>
      <p className="context-note">{kindLabel[view.kind]} · version {number(view.version)} · <span className="review-state">{view.review_state} — not reviewed</span> · {view.author_kind === 'agent' ? `drafted by ${AGENT_LABEL}` : `edited by ${view.author_label ?? 'a person'}`}</p>
      <p className="context-note">Template: {view.template} · source revision {short(view.id)} · sha256 {short(view.digest)}</p>
      <p className={view.refresh === '0' ? 'context-note' : 'needs-refresh'} role="status">{view.refresh === '0' ? 'Every claim is current.' : `${plural(view.refresh, 'claim needs', 'claims need')} refresh: the records it cites changed after this version was recorded.`}</p>
      {view.withheld !== '0' ? <p className="context-note">{plural(view.withheld, 'claim rests', 'claims rest')} on a quote you may not read now; its text is withheld for you and the claim is not stale.</p> : null}
      {view.newer_version_id ? <p className="newer-version" role="status">A newer version ({number(view.product.version)}) of this work product was recorded. This one is shown unchanged.{' '}
        <button type="button" className="text-button" onClick={() => onOpenVersion(view.newer_version_id!)}>Open version {number(view.product.version)}</button></p> : null}
      {saved ? <p role="status" className="disposition-saved">{saved}</p> : null}
      <div className="work-product-actions">
        {view.predecessor_id ? <button type="button" className="text-button" onClick={() => onOpenVersion(view.predecessor_id!)}>Open the previous version</button> : null}
        {latest && !editing ? <button type="button" className="text-button" onClick={() => { setEditing(true); setSaved(''); }}>Edit into a new version</button> : null}
        <button type="button" className="text-button" onClick={onClose}>Close</button>
      </div>
    </header>
    {editing ? <Editor view={view} taskId={taskId} scope={scope} session={session} product={product}
      onCancel={() => setEditing(false)}
      onSaved={next => { setEditing(false); setSaved(`Saved as version ${number(next.version)}. The earlier version is unchanged.`); onOpenVersion(next.id); }} />
      : <Body view={view} taskId={taskId} scope={scope} session={session} product={product} accessReady={accessReady} onSourceAccessFailure={onSourceAccessFailure} />}
    <Exports view={view} taskId={taskId} scope={scope} session={session} product={product} />
  </article>;
}

function Body({ view, taskId, scope, session, product, accessReady, onSourceAccessFailure }: {
  view: WorkProductVersion; taskId: string; scope: Scope; session: Session; product: string; accessReady: boolean; onSourceAccessFailure: (error: AccessError) => void;
}) {
  // The claim whose support is shown, and the control that opened it.
  const [selected, setSelected] = useState<string | null>(null);
  const openers = useRef(new Map<string, HTMLButtonElement>());
  const back = (block: string) => { setSelected(null); requestAnimationFrame(() => openers.current.get(block)?.focus()); };
  return <div className="work-product-body">
    {view.sections.map(s => <section key={s.id} className="work-product-section" aria-labelledby={`wps-${view.id}-${s.id}`}>
      <h6 id={`wps-${view.id}-${s.id}`}>{s.title}{s.required ? <span className="context-note"> · required</span> : null}</h6>
      {s.not_completed ? <p className="not-completed">{s.not_completed}</p> : null}
      {s.blocks.map(b => <BlockView key={b.id} block={b} scope={scope} accessReady={accessReady} onSourceAccessFailure={onSourceAccessFailure}
        selected={selected === b.id} opener={el => { if (el) openers.current.set(b.id, el); else openers.current.delete(b.id); }}
        onSupport={() => setSelected(selected === b.id ? null : b.id)}
        support={selected === b.id ? <Support taskId={taskId} scope={scope} session={session} product={product} version={view.id} block={b.id} onBack={() => back(b.id)} /> : null} />)}
    </section>)}
  </div>;
}

function BlockView({ block: b, scope, accessReady, onSourceAccessFailure, selected, opener, onSupport, support }: {
  block: WorkProductBlock; scope: Scope; accessReady: boolean; onSourceAccessFailure: (error: AccessError) => void;
  selected: boolean; opener: (el: HTMLButtonElement | null) => void; onSupport: () => void; support: React.ReactNode;
}) {
  const by = b.author_kind === 'human' ? <span className="context-note"> · written by {b.author_label ?? 'a person'}</span> : null;
  switch (b.kind) {
    case 'heading': return <p className="work-product-heading"><strong>{b.text}</strong>{by}</p>;
    case 'narrative': return <div className={b.label === 'judgment' ? 'work-product-judgment' : 'work-product-narrative'}>
      {b.label_words ? <p className="judgment-label">{b.label_words}</p> : null}
      <p className="retained-text">{b.text}{by}</p>
    </div>;
    case 'claim': {
      const c = b.claim!;
      const sources = c.assertions.flatMap(a => a.source ? [a.source] : []);
      return <div className={`work-product-claim${selected ? ' selected' : ''}${c.current ? '' : ' stale'}`} id={`claim-${b.id}`}>
        <p><span className="claim-number">[{c.number}]</span> <span className="retained-text">{b.text}</span>
          {sources.length ? <> <Citation scope={scope} sources={sources} accessReady={accessReady} onSourceAccessFailure={onSourceAccessFailure} /></> : null}{by}</p>
        <p className={c.current ? 'claim-current' : 'claim-refresh'}>{c.current ? 'Current: its records say what it says.' : `Needs refresh: ${c.refresh_words.join('; ')}.`}</p>
        {c.withheld ? <p className="context-note">A quote it rests on is withheld for you; the claim is not stale.</p> : null}
        {c.coverage ? <p className="coverage-line">{c.coverage}</p> : null}
        <button ref={opener} type="button" className="text-button" aria-expanded={selected} aria-controls={selected ? `support-${b.id}` : undefined} onClick={onSupport}>
          {selected ? `Hide support of claim ${c.number}` : `Show support of claim ${c.number}`}
        </button>
        {support}
      </div>;
    }
    case 'coverage': case 'exceptions': case 'limitations':
      return <div className={`work-product-platform work-product-${b.kind}`}>
        <p className="platform-label">{blockKindLabel[b.kind]}</p>
        {b.lines.length ? <ul>{b.lines.map((line, i) => <li key={i}>{line}</li>)}</ul> : <p className="context-note">Nothing to list.</p>}
      </div>;
    default: return null;
  }
}

function Support({ taskId, scope, session, product, version, block, onBack }: {
  taskId: string; scope: Scope; session: Session; product: string; version: string; block: string; onBack: () => void;
}) {
  const [support, setSupport] = useState<WorkProductSupport | null>(null);
  const [error, setError] = useState('');
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    readSupport(scope, taskId, product, version, block, session, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setSupport(value);
      requestAnimationFrame(() => region.current?.focus());
    }, () => {
      if (controller.signal.aborted) return;
      setError('The support of this claim could not be read now.');
      requestAnimationFrame(() => region.current?.focus());
    });
    return () => controller.abort();
  }, [scope, taskId, product, version, block, session]);
  useEffect(() => {
    // Escape returns to the claim, like Back to claim.
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && region.current?.contains(document.activeElement) && !event.defaultPrevented) { event.preventDefault(); onBack(); }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onBack]);
  return <div id={`support-${block}`} ref={region} tabIndex={-1} role="region" aria-label="Claim support" className="claim-support">
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    {support ? <>
      <p className="context-note">What each pinned record says now, in the platform's words.</p>
      <ol>{support.items.map((item, i) => <li key={i}>
        <span>{item.support}</span>
        <span className="context-note"> · {item.pinned.record_kind.replace('_', ' ')} {short(item.pinned.record_id)} · sha256 {short(item.pinned.record_digest)}</span>
        {item.pinned.withheld ? <span className="context-note"> · withheld for you</span> : null}
      </li>)}</ol>
    </> : error ? null : <p role="status">Reading the support…</p>}
    <button type="button" className="text-button" onClick={onBack}>Back to claim</button>
  </div>;
}

function Editor({ view, taskId, scope, session, product, onCancel, onSaved }: {
  view: WorkProductVersion; taskId: string; scope: Scope; session: Session; product: string; onCancel: () => void; onSaved: (version: WorkProductVersion) => void;
}) {
  const id = useId();
  const initial = useMemo<(DraftBlock & { block: WorkProductBlock; section: string })[]>(() => view.sections.flatMap(s => s.blocks.map(b => ({
    id: b.id, kind: b.kind, text: b.text, original: b.text, block: b, section: s.title,
  }))), [view]);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<EditResult | null>(null);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const focusAfter = useRef<string | null>(null);
  const first = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { requestAnimationFrame(() => first.current?.focus()); }, []);
  useEffect(() => {
    if (!focusAfter.current) return;
    const target = document.getElementById(focusAfter.current);
    focusAfter.current = null;
    target?.focus();
  });
  const body = editBlocks(draft);
  // One request key per exact edit; an uncertain request keeps its key.
  const content = JSON.stringify(body);
  const uncertain = useRef<{ content: string; key: string } | null>(null);
  const key = useMemo(() => uncertain.current?.content === content ? uncertain.current.key : newKey(), [content]);
  const problems = draft.map(b => b.text === null ? null : textProblem(b.kind, b.text));
  const unchanged = draft.length === initial.length && draft.every((b, i) => b.id === initial[i]!.id && b.text === b.original);
  const disabled = saving || unchanged || problems.some(p => p !== null);
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    focusAfter.current = `${id}-${draft[index]!.id}-${delta < 0 ? 'up' : 'down'}`;
    setDraft(d => { const next = [...d]; [next[index], next[target]] = [next[target]!, next[index]!]; return next; });
  };
  const remove = (index: number) => {
    const neighbour = draft[index + 1] ?? draft[index - 1];
    focusAfter.current = neighbour ? `${id}-${neighbour.id}-remove` : `${id}-cancel`;
    setDraft(d => d.filter((_, i) => i !== index));
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setSaving(true); setFailed(false); setResult(null);
    const sent = { content, key };
    saveEdit(scope, taskId, product, view.id, body, key, session, c.signal).then(r => {
      if (c.signal.aborted) return;
      uncertain.current = null;
      setSaving(false);
      if (r.ok) onSaved(r.version); else setResult(r);
    }, () => {
      if (c.signal.aborted) return;
      uncertain.current = sent;
      setFailed(true); setSaving(false);
    });
  };
  const refusedAt = (index: number) => result && !result.ok ? result.refusals.filter(r => r.block === index) : [];
  return <form className="work-product-editor" onSubmit={submit} aria-label={`Edit ${view.title}`}>
    <p className="context-note">Edit headings, narrative and claim sentences, or remove and reorder blocks. A claim keeps its records: its edited sentence is checked again and may state only figures its records hold. Narrative may not state figures. Saving records a new version; this one stays unchanged.</p>
    <ol className="editor-blocks">{draft.map((b, index) => {
      const writable = b.text !== null;
      const max = writable ? MAX_BYTES[b.kind as 'heading' | 'narrative' | 'claim'] : 0;
      const label = `${blockKindLabel[b.kind]}${b.block.label === 'judgment' ? ' (Zobba’s judgment)' : ''}${b.block.claim ? ` [${b.block.claim.number}]` : ''} in ${b.section}`;
      const fieldId = `${id}-${b.id}-text`;
      const problem = problems[index];
      const refused = refusedAt(index);
      return <li key={b.id} className="editor-block">
        {writable ? <>
          <label htmlFor={fieldId}>{label}</label>
          {b.kind === 'heading'
            ? <input id={fieldId} ref={index === 0 ? el => { first.current = el; } : undefined} type="text" value={b.text!} aria-describedby={`${fieldId}-bytes`} aria-invalid={problem || refused.length ? true : undefined}
              onChange={e => { const value = e.target.value; setDraft(d => d.map((x, i) => i === index ? { ...x, text: value } : x)); }} />
            : <textarea id={fieldId} ref={index === 0 ? el => { first.current = el; } : undefined} rows={b.kind === 'claim' ? 2 : 4} value={b.text!} aria-describedby={`${fieldId}-bytes`} aria-invalid={problem || refused.length ? true : undefined}
              onChange={e => { const value = e.target.value; setDraft(d => d.map((x, i) => i === index ? { ...x, text: value } : x)); }} />}
          <p id={`${fieldId}-bytes`} className={problem ? 'form-error' : 'context-note'} aria-live="polite">{problem ?? `${bytes(b.text!).toLocaleString('en-GB')} of ${max.toLocaleString('en-GB')} bytes`}</p>
        </> : <p className="editor-platform">{label} · written by the platform from its records</p>}
        {refused.map((r, i) => <p key={i} role="alert" className="form-error">Refused: {refusalLabel[r.reason]}{r.detail ? ` (${r.detail})` : ''}.</p>)}
        <div className="editor-controls" role="group" aria-label={`Arrange ${label}`}>
          <button type="button" id={`${id}-${b.id}-up`} className="text-button" disabled={index === 0} onClick={() => move(index, -1)}>Move up</button>
          <button type="button" id={`${id}-${b.id}-down`} className="text-button" disabled={index === draft.length - 1} onClick={() => move(index, 1)}>Move down</button>
          {b.kind !== 'limitations' ? <button type="button" id={`${id}-${b.id}-remove`} className="text-button" onClick={() => remove(index)}>Remove</button> : null}
        </div>
      </li>;
    })}</ol>
    {result && !result.ok ? <div role="alert" className="form-error">
      <p>{editErrorLabel[result.error] ?? editErrorLabel.work_product_refused}</p>
      {result.refusals.filter(r => r.block === null).map((r, i) => <p key={i}>{refusalLabel[r.reason]}{r.detail ? ` (${r.detail})` : ''}.</p>)}
    </div> : null}
    {failed ? <p role="alert" className="form-error">The edit may not have been saved. Save again: the same request is not recorded twice.</p> : null}
    <div className="work-product-actions">
      <button type="submit" aria-disabled={disabled}>{saving ? 'Saving…' : 'Save as a new version'}</button>
      <button type="button" id={`${id}-cancel`} className="text-button" onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

function Exports({ view, taskId, scope, session, product }: { view: WorkProductVersion; taskId: string; scope: Scope; session: Session; product: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [links, setLinks] = useState<{ record: WorkProductExport; url: string }[]>([]);
  const urls = useRef(new Set<string>());
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);
  const run = async (format: (typeof formats)[number]) => {
    setBusy(format); setMessage('');
    const controller = new AbortController();
    try {
      const made = await requestExport(scope, taskId, product, view.id, format, newKey(), session, controller.signal);
      if (!made.ok) { setMessage(exportErrorLabel[made.error] ?? exportErrorLabel.work_product_export_unavailable!); return; }
      const got = await downloadExport(scope, taskId, product, made.export, session, controller.signal);
      if (!got.ok) { setMessage(exportErrorLabel[got.error] ?? exportErrorLabel.work_product_export_unavailable!); return; }
      const url = URL.createObjectURL(got.blob);
      urls.current.add(url);
      setLinks(l => [...l, { record: made.export, url }]);
      setMessage(`The ${format.toUpperCase()} export of version ${number(view.version)} is ready.`);
    } catch {
      setMessage('The export could not be made or checked now. Nothing was downloaded; try again.');
    } finally { setBusy(null); }
  };
  const file = (record: WorkProductExport) => `${view.title.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'work-product'}-v${view.version}.${record.format}`;
  return <section className="work-product-exports" aria-label="Exports">
    <p className="context-note">An export is rendered by the platform from this exact version, with its source revision, citations, coverage and limitations. Quotes you may not read are withheld in it.</p>
    <div className="work-product-actions">{formats.map(f => <button key={f} type="button" disabled={busy !== null} onClick={() => void run(f)}>
      {busy === f ? `Exporting ${f.toUpperCase()}…` : `Export ${f.toUpperCase()}`}</button>)}</div>
    {message ? <p role="status">{message}</p> : null}
    {links.length ? <ul>{links.map(l => <li key={l.record.id}><a href={l.url} download={file(l.record)}>Download {file(l.record)}</a>
      <span className="context-note"> · sha256 {short(l.record.digest)}{l.record.refresh_count !== '0' ? ` · ${plural(l.record.refresh_count, 'claim')} marked needs refresh` : ''}</span></li>)}</ul> : null}
  </section>;
}
