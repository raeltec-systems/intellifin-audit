import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import type { Engagement } from './engagements';
import { discardAcquisitionDraft, downloadEvidence, evidenceAudience, liveEvidenceAudience, inspectEvidence, listEvidence, listReservations,
  measureFile, previewEvidence, recoverAcquisitionDraft, reserveEvidence, safeFilename, saveAcquisitionDraft, uploadEvidence, verifyEvidenceAudience } from './evidence';
import { MAX_ORIGINAL_BYTES, parseReservationRequest, ReservationLimitError, trimEvidenceWhitespace } from './evidence';
import type { AcquisitionDraft, Evidence, EvidencePage, Preview, Reservation, ReservationPage, ReservationRequest } from './evidence';
import { EvidenceKnowledge } from './EvidenceKnowledge';

interface Props {
  engagement: Engagement;
  session: Session;
  accessReady: boolean;
  onAccessFailure: (error?: AccessError) => void;
  onProjectionUsable: (usable: boolean) => void;
  children: (onOpenTask: () => void) => ReactNode;
}
const emptySource = { system: '', account: '', source_version: '', selection: '', coverage: '' };
const sourceLabels = { system: 'Source system', account: 'Source account', source_version: 'Source version', selection: 'Query or selection', coverage: 'Known coverage' };
type PageKind = 'evidence' | 'reservations';
const firstPages = () => ({ evidence: [''], reservations: [''] });
function acquiredAt(seconds: number) { return new Date(seconds * 1000).toLocaleString(); }

export function EvidenceWorkspace({ engagement, session, accessReady, onAccessFailure, onProjectionUsable, children }: Props) {
  const audience = liveEvidenceAudience(session, engagement);
  const [binding, setBinding] = useState<{ owner: string; fingerprint: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState(audience);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<EvidencePage | null>(null);
  const [recoveries, setRecoveries] = useState<ReservationPage | null>(null);
  const [draft, setDraft] = useState<AcquisitionDraft | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState(emptySource);
  const [selected, setSelected] = useState<Evidence | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [positions, setPositions] = useState(firstPages);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const current = useRef({ audience, accessReady });
  current.current = { audience, accessReady };
  const request = useRef<AbortController | null>(null);
  const action = useRef<AbortController | null>(null);
  const urls = useRef(new Set<string>());
  const toggle = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const inspectionHeading = useRef<HTMLHeadingElement>(null);
  const registryHeading = useRef<HTMLHeadingElement>(null);
  const inspectionOpener = useRef<HTMLButtonElement | null>(null);
  const focusInspection = useRef(false);
  const usable = owner === audience && binding?.owner === audience && accessReady && ready;
  const revokeUrls = useCallback(() => { for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); }, []);
  const revealTask = useCallback(() => setOpen(false), []);
  const currentRequest = (controller: AbortController, expected: string) => !controller.signal.aborted && current.current.audience === expected && current.current.accessReady;
  async function publicationReady(controller: AbortController, expected: string): Promise<boolean> {
    // Routine session checks withdraw the surface without shortening a bounded
    // transfer. The operation's original 120-second deadline still applies.
    while (!controller.signal.aborted && current.current.audience === expected && !current.current.accessReady) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return currentRequest(controller, expected);
  }
  useLayoutEffect(() => { onProjectionUsable(!open || accessReady && (ready || !!error)); }, [open, accessReady, ready, error, onProjectionUsable]);
  useLayoutEffect(() => {
    if (!usable || !selected || !focusInspection.current) return;
    focusInspection.current = false;
    inspectionHeading.current?.focus({ preventScroll: true });
    inspectionHeading.current?.scrollIntoView({ block: 'nearest' });
  }, [usable, selected]);

  useEffect(() => {
    let active = true;
    void evidenceAudience(session, engagement).then(fingerprint => {
      if (!active || current.current.audience !== audience) return;
      setBinding({ owner: audience, fingerprint }); setDraft(recoverAcquisitionDraft(fingerprint));
    });
    return () => { active = false; };
  }, [audience]);

  useLayoutEffect(() => {
    if (owner === audience) return;
    request.current?.abort(); action.current?.abort(); revokeUrls(); discardAcquisitionDraft();
    setOwner(audience); setReady(false); setDraft(null); setFile(null); setSource(emptySource);
    setPage(null); setRecoveries(null); setSelected(null); setPreview(null); setWorking(false); setStatus(''); setError('');
    positionsRef.current = firstPages(); setPositions(positionsRef.current);
    focusInspection.current = false; inspectionOpener.current = null;
    if (fileInput.current) fileInput.current.value = '';
  }, [audience, owner, revokeUrls]);
  // An uncertain access outage can unmount the workspace. Retain its exact
  // fingerprint-bound retry; explicit logout/scope change or a newly verified
  // audience discards it, and a same-session reload can recover it.
  useEffect(() => () => { request.current?.abort(); action.current?.abort(); revokeUrls(); }, [revokeUrls]);
  useEffect(() => {
    if (accessReady) return;
    request.current?.abort(); revokeUrls(); setReady(false);
  }, [accessReady, revokeUrls]);

  const failure = useCallback((reason: unknown, unavailableMessage?: string) => {
    if (reason instanceof AccessError && [401, 403, 404, 412].includes(reason.status)) {
      discardAcquisitionDraft(); setDraft(null); setFile(null); setSource(emptySource); setSelected(null); setPreview(null);
      setReady(false); revokeUrls(); onAccessFailure(reason); return;
    }
    setError(reason instanceof ReservationLimitError ? 'You have 100 incomplete acquisitions in this engagement. Finish an existing reservation before starting another. Waiting alone does not free a place.'
      : reason instanceof AccessError && reason.status === 409 ? 'The original reservation differs from this request. Reselect the identical file to retry.'
      : reason instanceof AccessError && reason.status === 429 ? 'Evidence transfer capacity is busy. Retry the same reservation shortly.'
      : reason instanceof AccessError && reason.status === 413 ? 'Choose an original of 10 MiB or less.'
      : unavailableMessage ?? 'Evidence is unavailable or delivery could not be confirmed. The same reservation can be retried.');
  }, [onAccessFailure, revokeUrls]);

  async function actionFailure(reason: unknown, controller: AbortController, expected: string, provenance?: Evidence | null, registered = false) {
    if (action.current !== controller || current.current.audience !== expected) return;
    // A 503 may mean storage is unavailable or that current authority could not
    // be checked. Withdraw private projections until a separate current read
    // distinguishes those cases; exact same-session retry stays retained.
    setReady(false); revokeUrls(); setStatus('');
    if (reason instanceof AccessError && [401, 403, 404, 412].includes(reason.status)) { failure(reason); return; }
    const accessMessage = registered ? 'Evidence access is unavailable. Reconnect to verify current work.' : undefined;
    if (controller.signal.aborted) { failure(reason, accessMessage); return; }
    try {
      await verifyEvidenceAudience(session, engagement, controller.signal);
      if (!await publicationReady(controller, expected)) return;
      setReady(true);
      if (provenance) {
        setSelected(provenance); setPreview(null);
        if (registered) {
          setStatus('Original verified and registered.');
          setError('The original is registered, but the evidence lists could not be refreshed. Refresh evidence to update the lists.');
        } else { setError('The original is unavailable. Verified access still permits inspection of its registered provenance.'); }
      } else { failure(reason); }
    } catch (authorityError) {
      if (action.current === controller && current.current.audience === expected) failure(authorityError, accessMessage);
    }
  }

  const refresh = useCallback(async () => {
    if (!accessReady || owner !== audience || !open) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 15_000);
    setReady(false); setError('');
    try {
      const cursors = positionsRef.current;
      const [items, pending] = await Promise.all([listEvidence(engagement, session, controller.signal, cursors.evidence.at(-1) || undefined), listReservations(engagement, session, controller.signal, cursors.reservations.at(-1) || undefined)]);
      if (!await publicationReady(controller, audience)) return;
      setPage(items); setRecoveries(pending); setReady(true);
    } catch (reason) {
      if (request.current === controller && current.current.audience === audience && current.current.accessReady) failure(reason);
    } finally { clearTimeout(timer); }
  }, [accessReady, owner, audience, open, engagement, session, failure]);
  useEffect(() => { void refresh(); return () => { request.current?.abort(); }; }, [refresh]);
  useLayoutEffect(() => { if (open && accessReady) heading.current?.focus({ preventScroll: true }); }, [open, accessReady]);

  function close() {
    setOpen(false); revokeUrls();
    requestAnimationFrame(() => toggle.current?.focus({ preventScroll: true }));
  }
  async function acquire() {
    if (!usable || working || !file || !page?.storage_configured) return;
    if (file.size > MAX_ORIGINAL_BYTES) { setError('Choose an original of 10 MiB or less.'); setStatus(''); return; }
    const controller = new AbortController(); action.current = controller;
    const timer = setTimeout(() => controller.abort(), 120_000);
    setWorking(true); setError(''); setStatus('Measuring the selected original…');
    let confirmed: Evidence | null = null;
    try {
      const identity = await measureFile(file);
      if (!await publicationReady(controller, audience)) return;
      let pending = draft;
      if (pending && (pending.request.filename !== file.name || pending.request.identity.size !== identity.size || pending.request.identity.sha256 !== identity.sha256)) {
        setError('This file does not match the retained reservation. Reselect the identical original, including its filename.'); return;
      }
      if (!pending) {
        const assertions = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, trimEvidenceWhitespace(value) || null])) as ReservationRequest['source'];
        let canonical: ReservationRequest;
        try { canonical = parseReservationRequest({ key: crypto.randomUUID(), filename: file.name, identity, source: assertions }); }
        catch {
          const invalidSource = (Object.keys(sourceLabels) as (keyof typeof sourceLabels)[]).find(key => {
            const value = assertions[key]; return value !== null && (new TextEncoder().encode(value).length > 2000 || /[\u0000-\u001f\u007f-\u009f]/.test(value));
          });
          setError(invalidSource ? `${sourceLabels[invalidSource]} is too long or contains unsupported characters. Edit it before acquiring the original.` : 'The original filename is unsupported or too long. Rename the file before acquiring it.');
          setStatus(''); return;
        }
        pending = { audience: binding!.fingerprint, reservationId: null, request: canonical };
        try { saveAcquisitionDraft(pending); }
        catch { setError('Browser recovery storage is unavailable. Enable session storage to acquire evidence safely.'); setStatus(''); return; }
        setDraft(pending);
      }
      setStatus('Reserving the immutable original…');
      const reservation = await reserveEvidence(engagement, session, pending.request, controller.signal);
      if (!await publicationReady(controller, audience)) return;
      pending = { ...pending, reservationId: reservation.id }; saveAcquisitionDraft(pending); setDraft(pending);
      setStatus('Uploading and independently verifying the original…');
      const registered = await uploadEvidence(engagement, session, reservation.id, file, controller.signal);
      if (!await publicationReady(controller, audience)) return;
      confirmed = registered; focusInspection.current = true; inspectionOpener.current = null;
      setSelected(registered); setPreview(null); setStatus('Original verified and registered.');
      discardAcquisitionDraft(); setDraft(null); setFile(null); setSource(emptySource);
      if (fileInput.current) fileInput.current.value = '';
      // Registration can sort anywhere in the server's immutable ID order.
      // Re-read the bounded first page instead of prepending to a stale cursor.
      const [items, pendingPage] = await Promise.all([listEvidence(engagement, session, controller.signal), listReservations(engagement, session, controller.signal)]);
      if (!await publicationReady(controller, audience)) return;
      request.current?.abort(); setReady(true);
      positionsRef.current = firstPages(); setPositions(positionsRef.current);
      setPage(items); setRecoveries(pendingPage);
      setSelected(registered); setPreview(null); setStatus('Original verified and registered.');
    } catch (reason) {
      await actionFailure(reason, controller, audience, confirmed, confirmed !== null);
    } finally { clearTimeout(timer); if (action.current === controller) { action.current = null; setWorking(false); } }
  }
  function recover(reservation: Reservation) {
    if (!usable || working) return;
    const pending = { audience: binding!.fingerprint, request: reservation.request, reservationId: reservation.id };
    try { saveAcquisitionDraft(pending); setDraft(pending); setFile(null); setError(''); setStatus('Reservation recovered. Reselect the identical original to verify and finish.');
      if (fileInput.current) { fileInput.current.value = ''; fileInput.current.focus(); }
    } catch { setError('Browser recovery storage is unavailable. Enable session storage to acquire evidence safely.'); }
  }
  async function inspect(id: string, opener?: HTMLButtonElement) {
    if (!usable || working) return;
    const controller = new AbortController(); action.current = controller;
    const timer = setTimeout(() => controller.abort(), 120_000);
    setWorking(true); setSelected(null); setPreview(null); setError(''); setStatus('Inspecting current evidence…');
    focusInspection.current = true;
    if (opener) inspectionOpener.current = opener;
    let provenance: Evidence | null = null;
    try {
      const item = await inspectEvidence(engagement, session, id, controller.signal);
      if (!await publicationReady(controller, audience)) return;
      provenance = item; setSelected(item);
      if (!page?.storage_configured) { setStatus('Metadata verified. Original bytes are unavailable.'); return; }
      const content = await previewEvidence(engagement, session, id, controller.signal);
      if (await publicationReady(controller, audience)) { setPreview(content); setStatus(''); }
    } catch (reason) {
      await actionFailure(reason, controller, audience, provenance);
    } finally { clearTimeout(timer); if (action.current === controller) { action.current = null; setWorking(false); } }
  }
  function returnToList() {
    setSelected(null); setPreview(null); setStatus(''); focusInspection.current = false; revokeUrls();
    requestAnimationFrame(() => {
      const target = inspectionOpener.current?.isConnected ? inspectionOpener.current : registryHeading.current;
      target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'nearest' });
    });
  }
  async function download() {
    if (!usable || working || !selected || !page?.storage_configured) return;
    const controller = new AbortController(); action.current = controller;
    const timer = setTimeout(() => controller.abort(), 120_000);
    setWorking(true); setError(''); setStatus('Verifying the original for download…');
    try {
      const blob = await downloadEvidence(engagement, session, selected, controller.signal);
      if (!await publicationReady(controller, audience)) return;
      const url = URL.createObjectURL(blob); urls.current.add(url);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = safeFilename(selected.reservation.request.filename);
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 1000);
      setStatus('Verified original download started.');
    } catch (reason) {
      await actionFailure(reason, controller, audience);
    } finally { clearTimeout(timer); if (action.current === controller) { action.current = null; setWorking(false); } }
  }
  async function navigate(kind: PageKind, direction: 'more' | 'previous' | 'first') {
    const currentPath = positionsRef.current[kind];
    const next = kind === 'evidence' ? page?.next_cursor : recoveries?.next_cursor;
    if (!usable || working || direction === 'more' && !next || direction === 'previous' && currentPath.length < 2) return;
    // Retain at most 64 page starts; First remains available beyond that window.
    const path = direction === 'more' ? [...currentPath, next!].slice(-64) : direction === 'previous' ? currentPath.slice(0, -1) : [''];
    const cursor = path.at(-1) || undefined;
    const controller = new AbortController(); action.current = controller;
    const timer = setTimeout(() => controller.abort(), 15_000); setWorking(true);
    request.current?.abort();
    try {
      if (kind === 'evidence') {
        const next = await listEvidence(engagement, session, controller.signal, cursor);
        if (!await publicationReady(controller, audience)) return;
        setPage(next);
      } else {
        const next = await listReservations(engagement, session, controller.signal, cursor);
        if (!await publicationReady(controller, audience)) return;
        setRecoveries(next);
      }
      request.current?.abort(); setReady(true);
      positionsRef.current = { ...positionsRef.current, [kind]: path }; setPositions(positionsRef.current);
    } catch (reason) { await actionFailure(reason, controller, audience); }
    finally { clearTimeout(timer); if (action.current === controller) { action.current = null; setWorking(false); } }
  }

  return <div className={`evidence-composition${open ? ' evidence-open' : ''}`}>
    <div className="evidence-toolbar"><button ref={toggle} data-focus="open-evidence" className="quiet-button" type="button" aria-expanded={open} aria-controls="evidence-workspace" onClick={() => open ? close() : setOpen(true)}>Evidence</button><span>Immutable originals · distinct from work products</span></div>
    <div className="evidence-layout"><div className="continuing-conversation">{children(revealTask)}</div>
      <aside id="evidence-workspace" className="evidence-pane" aria-label="Engagement evidence" hidden={!open} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
        <header className="evidence-header"><h2 ref={heading} tabIndex={-1}>Evidence</h2><button type="button" className="text-button" onClick={close}>Return to conversation and Task</button></header>
        <p className="scope-note">{engagement.organisation_name} / {engagement.client_name} / {engagement.engagement_name}</p>
        {!usable ? <div role="status">{error || 'Checking current evidence access…'}<button type="button" className="text-button" onClick={() => void refresh()}>Retry evidence</button></div> : null}
        <div className="evidence-private" hidden={!usable}>
          <p className="field-help">Acquisition is a direct upload. Source details are your assertions; matching bytes do not prove truth, completeness or sufficiency.</p>
          {page && !page.storage_configured ? <p className="notice" role="status">Original acquisition and downloads are unavailable. Storage is not configured; registered metadata remains inspectable.</p> : null}
          <form className="evidence-acquisition" onSubmit={event => { event.preventDefault(); void acquire(); }}>
            <h3>{draft ? 'Finish reserved acquisition' : 'Acquire an original'}</h3>
            {draft ? <p className="notice">Retained reservation for <strong>{draft.request.filename}</strong>. Reselect the identical file to recover the same original.<span className="evidence-id">{draft.reservationId ?? 'Reservation acknowledgement pending'}</span></p> : null}
            {draft ? <details className="evidence-reserved-details"><summary>Reserved acquisition details</summary>
              <p className="field-help">Expected identity, not yet independently verified. These retained source assertions will not change on retry.</p>
              <dl><div><dt>Expected size</dt><dd>{draft.request.identity.size.toLocaleString()} bytes</dd></div><div><dt>Expected SHA-256</dt><dd>{draft.request.identity.sha256}</dd></div>
                {(Object.keys(sourceLabels) as (keyof typeof sourceLabels)[]).map(key => <div key={key}><dt>{sourceLabels[key]}</dt><dd>{draft.request.source[key] ?? 'Unknown'}</dd></div>)}</dl>
            </details> : null}
            <label className="membership-label">{draft ? 'Reselect identical original' : 'Original file (up to 10 MiB)'}<input ref={fileInput} type="file" disabled={working || !page?.storage_configured} onChange={event => { setFile(event.currentTarget.files?.[0] ?? null); setError(''); }} /></label>
            {!draft ? <details className="evidence-source"><summary>Source assertions (optional)</summary>{(Object.keys(sourceLabels) as (keyof typeof sourceLabels)[]).map(key => <label className="membership-label" key={key}>{sourceLabels[key]}<input value={source[key]} maxLength={2000} disabled={working} onChange={event => { const value = event.currentTarget.value; setSource(previous => ({ ...previous, [key]: value })); }} /></label>)}<p className="field-help">Blank fields remain unknown. This does not claim a live connector acquired the file.</p></details> : null}
            <div className="membership-actions"><button type="submit" disabled={!file || working || !page?.storage_configured}>{draft ? 'Retry same reservation' : 'Acquire and verify original'}</button>{draft ? <button className="quiet-button" type="button" disabled={working} onClick={() => { discardAcquisitionDraft(); setDraft(null); setFile(null); setSource(emptySource); if (fileInput.current) fileInput.current.value = ''; setStatus('Browser draft discarded. Durable custody remains available for explicit recovery.'); }}>Discard browser draft</button> : null}</div>
          </form>
          {status ? <p role="status" aria-live="polite">{status}</p> : null}{error ? <p className="composer-error" role="alert">{error}</p> : null}
          {recoveries && (recoveries.items.length > 0 || positions.reservations.at(-1)) ? <details className="evidence-recovery"><summary>Your incomplete reservations ({recoveries.items.length})</summary><p className="field-help">Incomplete originals are unavailable as evidence. Recover only with the identical file.</p>{recoveries.items.length ? <ul>{recoveries.items.map(item => <li key={item.id}><span>{item.request.filename}</span><button className="text-button" type="button" disabled={working} onClick={() => recover(item)}>Recover reservation</button></li>)}</ul> : <p>No incomplete reservations on this page. Return to an earlier page to continue.</p>}
            {positions.reservations.at(-1) ? <button className="text-button" type="button" disabled={working} onClick={() => void navigate('reservations', 'first')}>First incomplete reservations</button> : null}
            {positions.reservations.length > 1 ? <button className="text-button" type="button" disabled={working} onClick={() => void navigate('reservations', 'previous')}>Previous incomplete reservations</button> : null}
            {recoveries.next_cursor ? <button className="text-button" type="button" disabled={working} onClick={() => void navigate('reservations', 'more')}>More incomplete reservations</button> : null}</details> : null}
          <section className="evidence-registry" aria-labelledby="evidence-registry-title"><div className="membership-heading"><h3 ref={registryHeading} tabIndex={-1} id="evidence-registry-title">Registered originals</h3><button className="text-button" type="button" disabled={working} onClick={() => void refresh()}>Refresh evidence</button></div>
            {page?.items.length ? <ul>{page.items.map(item => <li key={item.reservation.id}><button className="evidence-open-item" data-evidence-id={item.reservation.id} type="button" disabled={working} onClick={event => void inspect(item.reservation.id, event.currentTarget)}><strong>{item.reservation.request.filename}</strong><span>{item.reservation.request.identity.size.toLocaleString()} bytes · Direct upload</span></button></li>)}</ul> : <p>No registered originals yet.</p>}
            {positions.evidence.at(-1) ? <button className="text-button" type="button" disabled={working} onClick={() => void navigate('evidence', 'first')}>First evidence page</button> : null}
            {positions.evidence.length > 1 ? <button className="text-button" type="button" disabled={working} onClick={() => void navigate('evidence', 'previous')}>Previous evidence</button> : null}
            {page?.next_cursor ? <button className="text-button" type="button" disabled={working} onClick={() => void navigate('evidence', 'more')}>More evidence</button> : null}
          </section>
          {selected ? <section className="evidence-inspection" aria-label="Evidence details"><h3 ref={inspectionHeading} tabIndex={-1}>{selected.reservation.request.filename}</h3><button className="text-button" type="button" disabled={working} onClick={returnToList}>Back to evidence list</button><dl>
            <div><dt>Acquisition</dt><dd>Direct upload by {selected.reservation.actor_id}</dd></div><div><dt>Verified acquisition completed</dt><dd>{acquiredAt(selected.registered_at)}</dd></div>
            <div><dt>Evidence identity</dt><dd>{selected.reservation.id}</dd></div><div><dt>Measured size</dt><dd>{selected.reservation.request.identity.size.toLocaleString()} bytes</dd></div>
            <div><dt>Measured SHA-256</dt><dd>{selected.reservation.request.identity.sha256}</dd></div><div><dt>Verified storage version</dt><dd>{selected.version}</dd></div>
            <div><dt>Reserved</dt><dd>{acquiredAt(selected.reservation.reserved_at)}</dd></div></dl>
            <h4>Attributed source assertions</h4><dl>{(Object.keys(sourceLabels) as (keyof typeof sourceLabels)[]).map(key => <div key={key}><dt>{sourceLabels[key]}</dt><dd>{selected.reservation.request.source[key] ?? 'Unknown'}</dd></div>)}</dl>
            <p className="field-help">Source version is asserted separately from the verified storage version. Byte identity establishes neither source truth nor completeness.</p>
            <EvidenceKnowledge key={`${audience}/${selected.reservation.id}`} evidence={selected} scope={engagement} session={session} accessReady={usable && open} onAccessFailure={onAccessFailure} onReturnToTask={close} />
            <button className="quiet-button" type="button" disabled={working || !page?.storage_configured} onClick={() => void download()}>Download verified original</button>
            {preview?.kind === 'plain_text' ? <><h4>Bounded plain-text preview</h4><p className="field-help">Up to 64 KiB and 100 lines. {preview.truncated ? 'Truncated; download the original for all bytes.' : 'Original text fits this preview.'}</p><pre className="evidence-preview" tabIndex={0}>{preview.text}</pre></> : preview?.kind === 'download_only' ? <p role="status">Download only. This original has no supported inert plain-text preview.</p> : <button className="text-button" type="button" disabled={working || !page?.storage_configured} onClick={() => void inspect(selected.reservation.id)}>Read bounded preview</button>}
          </section> : null}
        </div>
      </aside>
    </div>
  </div>;
}
