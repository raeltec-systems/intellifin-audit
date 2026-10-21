import { useEffect, useRef, useState } from 'react';
import type { AccessError, Session } from './auth';
import type { Scope } from './engagements';
import { WorkProductDocument } from './WorkProductDocument';
import { NOT_COMPLETED, SHELF_PAGE, kindLabel, readShelf } from './work-product';
import type { WorkProductShelf, WorkProductSummary } from './work-product';

interface Props {
  taskId: string;
  scope: Scope;
  session: Session;
  accessReady: boolean;
  onSourceAccessFailure: (error: AccessError) => void;
}

const number = (value: string) => BigInt(value).toLocaleString('en-GB');
const plural = (value: string, one: string, many = `${one}s`) => `${number(value)} ${value === '1' ? one : many}`;

/// Story 24.4: the Task's shelf of work products. Each shows its latest
/// version, its review state (Draft), the exact number of its claims needing
/// refresh and its required sections not completed. Opening one shows its
/// document; nothing on this shelf is a model's summary.
export function WorkProducts({ taskId, scope, session, accessReady, onSourceAccessFailure }: Props) {
  const [shelf, setShelf] = useState<WorkProductShelf | null>(null);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [open, setOpen] = useState<{ product: string; version: string } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const after = pages[pages.length - 1] ?? null;
  useEffect(() => {
    const controller = new AbortController();
    readShelf(scope, taskId, after, session, controller.signal).then(value => {
      if (!controller.signal.aborted) { setShelf(value); setError(''); }
    }, () => {
      if (!controller.signal.aborted) setError('The work products could not be read now. Nothing is shown in their place.');
    });
    return () => controller.abort();
  }, [scope, taskId, session, generation, after]);
  if (error) return <section className="work-products" aria-label="Work products"><h4>Work products</h4><p role="alert" className="form-error">{error}</p></section>;
  if (!shelf || shelf.total === '0') return null;
  const close = () => { setOpen(null); setGeneration(g => g + 1); requestAnimationFrame(() => opener.current?.focus()); };
  return <section className="work-products" aria-label="Work products">
    <h4>Work products</h4>
    <p className="context-note">Drafted by Zobba on the Task's bound template. Every claim was checked against its records before its version was recorded; a version never changes, and a claim whose records changed since says it needs refresh.</p>
    <p className="work-product-total">{plural(shelf.total, 'work product')}</p>
    {pages.length > 1 || shelf.next_cursor ? <nav className="exception-pages" aria-label="Work product pages">
      <button type="button" className="text-button" disabled={pages.length <= 1} onClick={() => setPages(p => p.slice(0, -1))}>Previous {SHELF_PAGE}</button>
      <button type="button" className="text-button" disabled={!shelf.next_cursor} onClick={() => { const next = shelf.next_cursor; if (next) setPages(p => [...p, next]); }}>Next {SHELF_PAGE}</button>
    </nav> : null}
    <ul className="work-product-shelf">{shelf.products.map(p => <ShelfItem key={p.id} product={p} open={open?.product === p.id}
      onOpen={button => { opener.current = button; setOpen({ product: p.id, version: p.version_id }); }} />)}</ul>
    {open ? <WorkProductDocument key={`${open.product}/${open.version}`} taskId={taskId} scope={scope} session={session} product={open.product} version={open.version}
      accessReady={accessReady} onSourceAccessFailure={onSourceAccessFailure}
      onOpenVersion={version => setOpen({ product: open.product, version })} onClose={close} /> : null}
  </section>;
}

function ShelfItem({ product: p, open, onOpen }: { product: WorkProductSummary; open: boolean; onOpen: (button: HTMLButtonElement) => void }) {
  return <li className="work-product-item">
    <p className="work-product-title"><strong>{p.title}</strong> · {kindLabel[p.kind]} · version {number(p.version)} · <span className="review-state">{p.review_state}</span></p>
    <p className="context-note">Template: {p.template}</p>
    <ul className="work-product-facts" aria-label={`About ${p.title}`}>
      <li>{plural(p.claims, 'checked claim')}</li>
      <li className={p.refresh === '0' ? undefined : 'needs-refresh'}>{p.refresh === '0' ? 'No claim needs refresh' : `${plural(p.refresh, 'claim needs', 'claims need')} refresh`}</li>
      {p.platform_refresh !== '0' ? <li className="needs-refresh">{plural(p.platform_refresh, 'coverage or exceptions block needs', 'coverage or exceptions blocks need')} refresh</li> : null}
      {p.missing_required.length ? <li>Required sections {NOT_COMPLETED.toLowerCase().replace(/\.$/, '')}: {p.missing_required.join(', ')}</li> : null}
      <li>Last {p.author_kind === 'human' ? 'edited by a person' : 'drafted by Zobba'}</li>
    </ul>
    <button type="button" className="text-button" aria-expanded={open} onClick={event => onOpen(event.currentTarget)}>{open ? 'Shown below' : `Open ${p.title}`}</button>
  </li>;
}

/// The engagement's shelf: every work product of the Tasks this viewer may
/// see now, an exact total, 50 per page. Opening one opens its Task, whose
/// panel shows the document.
export function EngagementShelf({ scope, session, accessReady, onOpenTask }: {
  scope: Scope; session: Session | null; accessReady: boolean; onOpenTask: (taskId: string, opener: HTMLElement) => void;
}) {
  const [shelf, setShelf] = useState<WorkProductShelf | null>(null);
  const [error, setError] = useState('');
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const after = pages[pages.length - 1] ?? null;
  useEffect(() => {
    if (!accessReady) return;
    const controller = new AbortController();
    readShelf(scope, null, after, session, controller.signal).then(value => {
      if (!controller.signal.aborted) { setShelf(value); setError(''); }
    }, () => {
      if (!controller.signal.aborted) { setShelf(null); setError('The work products could not be read now. Nothing is shown in their place.'); }
    });
    return () => controller.abort();
  }, [scope, session, accessReady, after]);
  return <section className="work-product-shelf" aria-labelledby="work-products-title"><h2 id="work-products-title">Work products</h2>
    {error ? <p role="alert">{error}</p> : !shelf || shelf.total === '0' ? <>
      <p>No work products yet.</p>
      <p className="shelf-description">Zobba drafts working papers on a Task's bound template; every claim is checked against its records before a version is recorded.</p>
    </> : <>
      <p className="shelf-description">{plural(shelf.total, 'work product')} · each a Draft until it is reviewed.</p>
      <ul className="work-product-shelf-list">{shelf.products.map(p => <li key={p.id}>
        <button type="button" className="task-list-open" onClick={event => onOpenTask(p.task_id, event.currentTarget)}>
          <span>{p.title}</span>
          <small>{kindLabel[p.kind]} · version {number(p.version)} · {p.review_state} · {p.refresh === '0' ? 'no claim needs refresh' : `${plural(p.refresh, 'claim needs', 'claims need')} refresh`}{p.platform_refresh !== '0' ? ` · ${plural(p.platform_refresh, 'platform block needs', 'platform blocks need')} refresh` : ''}{p.missing_required.length ? ` · ${plural(String(p.missing_required.length), 'required section')} not completed` : ''}</small>
          <span className="open-label">Open its Task</span>
        </button>
      </li>)}</ul>
      {pages.length > 1 || shelf.next_cursor ? <nav aria-label="Work product shelf pages">
        <button type="button" className="text-button" disabled={pages.length <= 1} onClick={() => setPages(p => p.slice(0, -1))}>Previous {SHELF_PAGE}</button>
        <button type="button" className="text-button" disabled={!shelf.next_cursor} onClick={() => { const next = shelf.next_cursor; if (next) setPages(p => [...p, next]); }}>Next {SHELF_PAGE}</button>
      </nav> : null}
    </>}
  </section>;
}
