import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessError } from './auth';
import { SkillCatalog } from './SkillCatalog';
import { discardSkillCatalogActions, recoverSkillOrganisation } from './skills';
import type { Session } from './auth';
import { readAdminOrganisations } from './membership';
import type { OrganisationPage } from './membership';
import { applyMethodology, discardMethodologyAction, freezeMethodologyAction, recoverMethodologyAction, retainMethodologyAction, recoverMethodologyOrganisation, recoverMethodologyDraft, retainMethodologyDraft, discardMethodologyPending, methodologyCustodyFailure, methodologyAudience, methodologyFailure, methodologyRefused, parseSaveMethodology, readMethodology, newMethodologyRequirement, methodologyLineageHead, methodologyEditCommand, methodologyReviewCommand, inheritanceMode, inheritanceValue } from './methodology';
import type { InheritanceMode, MethodologyAction, MethodologyReceipt, MethodologySnapshot, SaveMethodology, MethodologyEditDraft, MethodologyRecallDraft } from './methodology';

interface Props { active: boolean; session: Session; accessReady: boolean; onAccessFailure: (error?: AccessError) => void; onClose: () => void }
type Version = MethodologySnapshot['versions'][number];
type Draft = MethodologyEditDraft;
const emptyContext = () => ({ audit_area: null, period_start: null, period_end: null });
const requirement = () => newMethodologyRequirement(crypto.randomUUID());
const dateTime = (value: number) => new Date(value * 1000).toLocaleString();
const textFields = { criteria: 'Criteria', populations: 'Population and sampling conventions', evidence_checks: 'Evidence checks', ratings: 'Rating vocabulary', review_rules: 'Review and issuance rules' } as const;
const referenceFields = { templates: 'Template versions', suitable_skills: 'Suitable skill versions' } as const;

export function MethodologyWorkspace({ active, session, accessReady, onAccessFailure, onClose }: Props) {
  const [organisations, setOrganisations] = useState<OrganisationPage | null>(null);
  const [organisation, setOrganisation] = useState<string | null>(() => recoverMethodologyOrganisation(session) ?? recoverSkillOrganisation(session));
  const [selectedOrganisation, setSelectedOrganisation] = useState<OrganisationPage['organisations'][number] | null>(null);
  const organisationCursor = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<MethodologySnapshot | null>(null);
  const [draft, updateDraft] = useState<Draft | null>(() => { const saved = recoverMethodologyDraft(organisation, session); return saved?.kind === 'edit' ? saved.body : null; });
  const [pending, setPending] = useState<MethodologyAction | null>(() => recoverMethodologyAction(session, organisation));
  const [receipt, setReceipt] = useState<MethodologyReceipt | null>(null);
  const [recallDraft, updateRecallDraft] = useState<MethodologyRecallDraft | null>(() => { const saved = recoverMethodologyDraft(organisation, session); return saved?.kind === 'recall' ? saved.body : null; });
  const recalling = recallDraft?.version, recallReason = recallDraft?.reason ?? '';
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const action = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);
  const focus = useRef<{ node: HTMLElement; start: number | null; end: number | null } | null>(null);
  const current = useRef({ accessReady, session, organisation });
  current.current = { accessReady, session, organisation };
  const owner = organisation ? methodologyAudience(session, organisation) : JSON.stringify([session.identity.id, session.csrf_token]);
  const liveOwner = useRef(owner); liveOwner.current = owner;
  // Retained DOM is not authority. Withhold every new activation before commit,
  // including an exact same-owner parent refresh or Settings re-entry.
  const [activation, setActivation] = useState({ owner, accessReady, generation: 0 });
  let currentActivation = activation;
  if (activation.owner !== owner || activation.accessReady !== accessReady) {
    currentActivation = { owner, accessReady, generation: activation.generation + 1 };
    setActivation(currentActivation);
  }
  const generation = currentActivation.generation;
  const latestActivation = useRef(currentActivation); latestActivation.current = currentActivation;
  const [verifiedGeneration, setVerifiedGeneration] = useState<number | null>(null);
  const visible = ready && accessReady && verifiedGeneration === generation;
  const cancelRead = useCallback(() => { const previous = request.current; request.current = null; previous?.abort(); }, []);
  const rememberFocus = useCallback(() => {
    const node = document.activeElement;
    if (node instanceof HTMLElement && panel.current?.contains(node)) focus.current = { node,
      start: node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement ? node.selectionStart : null,
      end: node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement ? node.selectionEnd : null };
  }, []);
  function setDraft(value: Draft | null) {
    if (!organisation || !retainMethodologyDraft(organisation, session, value ? { kind: 'edit', organisation_id: organisation, body: value } : null)) { setError(methodologyCustodyFailure); return false; }
    updateDraft(value); if (value) updateRecallDraft(null); return true;
  }
  function setRecallDraft(value: MethodologyRecallDraft | null) {
    if (!organisation || !retainMethodologyDraft(organisation, session, value ? { kind: 'recall', organisation_id: organisation, body: value } : null)) { setError(methodologyCustodyFailure); return false; }
    updateRecallDraft(value); if (value) updateDraft(null); return true;
  }
  const org = selectedOrganisation?.organisation_id === organisation ? selectedOrganisation : organisations?.organisations.find(item => item.organisation_id === organisation);
  const clearPrivate = useCallback(() => { if (current.current.organisation) discardMethodologyAction(current.current.organisation); updateDraft(null); setPending(null); setReceipt(null); updateRecallDraft(null); }, []);
  const fail = useCallback((reason: unknown, recovering = false, currentRead = false) => {
    const message = methodologyFailure(reason, recovering);
    setReady(false); setSnapshot(null);
    if (currentRead) setReadError(message);
    else setError(message);
    if (reason instanceof AccessError && [401, 403, 404, 412].includes(reason.status)) {
      clearPrivate();
      setError(''); setReadError(message);
      if (current.current.organisation) discardSkillCatalogActions(current.current.organisation);
      setOrganisations(null);
      setSelectedOrganisation(null); organisationCursor.current = null;
      if (reason.status === 403 || reason.status === 404) setOrganisation(null);
      if (reason.status !== 403 && reason.status !== 404) onAccessFailure(reason);
    }
  }, [clearPrivate, onAccessFailure]);
  const readFailure = useCallback((reason?: AccessError) => fail(reason, false, true), [fail]);
  const refresh = useCallback(async (after: string | null = organisationCursor.current, withdraw = true) => {
    if (!mounted.current || !current.current.accessReady || action.current) return;
    cancelRead();
    const controller = new AbortController(); request.current = controller;
    const expected = liveOwner.current, expectedGeneration = latestActivation.current.generation;
    if (withdraw) { rememberFocus(); setReady(false); }
    const deadline = setTimeout(() => controller.abort(), 8000);
    try {
      const selected = current.current.organisation;
      const [pageResult, methodResult] = await Promise.allSettled([
        readAdminOrganisations(current.current.session, controller.signal, after),
        selected ? readMethodology(selected, current.current.session, controller.signal) : Promise.resolve(null),
      ]);
      if (!mounted.current || request.current !== controller || liveOwner.current !== expected || !current.current.accessReady || latestActivation.current.generation !== expectedGeneration) return;
      // Methodology storage/response limits do not decide whether the current
      // Admin can inspect and restrict independently installed skill versions.
      // A definite selected-org denial also survives an unrelated list outage.
      if (methodResult.status === 'rejected' && methodResult.reason instanceof AccessError && [401, 403, 404, 412].includes(methodResult.reason.status)) throw methodResult.reason;
      if (pageResult.status === 'rejected') throw pageResult.reason;
      const page = pageResult.value;
      const data = methodResult.status === 'fulfilled' ? methodResult.value : null;
      organisationCursor.current = after;
      setOrganisations(page); setSnapshot(data); setVerifiedGeneration(expectedGeneration); setReady(true);
      if (methodResult.status === 'rejected') setReadError('Current methodology settings are unavailable. Installed skills have their own current access check below.');
      else setReadError('');
      const selectedMetadata = page.organisations.find(item => item.organisation_id === selected);
      if (selectedMetadata) setSelectedOrganisation(selectedMetadata);
    } catch (reason) { if (mounted.current && request.current === controller && liveOwner.current === expected && latestActivation.current.generation === expectedGeneration) fail(reason, false, true); }
    finally { clearTimeout(deadline); if (request.current === controller) request.current = null; }
  }, [fail, cancelRead, rememberFocus]);
  useLayoutEffect(() => { if (active) heading.current?.focus(); }, [active]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelRead(); action.current?.abort(); }; }, []);
  useEffect(() => {
    if (!accessReady) { rememberFocus(); cancelRead(); return; }
    void refresh();
    const wake = () => { if (!document.hidden) void refresh(undefined, false); else { rememberFocus(); cancelRead(); setReady(false); } };
    const timer = setInterval(() => { if (!document.hidden) void refresh(undefined, false); }, 15000);
    window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake);
    return () => { clearInterval(timer); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); rememberFocus(); cancelRead(); };
  }, [accessReady, organisation, owner, generation, refresh, cancelRead, rememberFocus]);
  useLayoutEffect(() => {
    if (!visible) return;
    const saved = focus.current;
    if (saved?.node.isConnected && saved.node.getClientRects().length) {
      saved.node.focus({ preventScroll: true });
      if ((saved.node instanceof HTMLTextAreaElement || saved.node instanceof HTMLInputElement) && saved.start !== null && saved.end !== null) saved.node.setSelectionRange(saved.start, saved.end);
      focus.current = null;
    }
  }, [visible, snapshot]);

  function select(id: string | null) {
    setSelectedOrganisation(id ? organisations?.organisations.find(item => item.organisation_id === id) ?? null : null);
    cancelRead(); clearPrivate(); setError(''); setReadError(''); setReady(false); setSnapshot(null); setOrganisation(id);
  }
  function edit(version?: Version, undo = false) {
    if (!snapshot) return;
    setReceipt(null); setError('');
    if (version) {
      try {
        const command = methodologyEditCommand(snapshot, version.id, undo, crypto.randomUUID());
        setDraft({ command, availableAt: '', baseline: JSON.stringify(methodologyLineageHead(snapshot.versions, version.id)!.command.definition) });
      } catch { setError('This methodology lineage could not be verified. Refresh the saved versions before editing.'); }
    } else setDraft({ availableAt: '', baseline: null, command: { key: crypto.randomUUID(), expected_revision: snapshot.revision, supersedes: null, undo_of: null,
      assignment: { kind: 'firm', client_id: null, engagement_id: null }, applicability: emptyContext(), activation: { mode: 'new_tasks', available_at: 0 },
      definition: { name: '', neutral_starter: false, default_context: emptyContext(), templates: [], requirements: [requirement()] },
      source: { kind: 'authored', reference: null, note: null } } });
  }
  function reviewLatest() {
    if (!draft || !snapshot || pending) return;
    try {
      const command = methodologyReviewCommand(snapshot, draft.command, crypto.randomUUID());
      if (setDraft({ ...draft, command })) setError('Latest settings revision selected. Review your retained edit and its impact, then Save.');
    } catch { setError('This methodology lineage could not be verified. Refresh the saved versions before editing.'); }
  }
  function change(update: (command: SaveMethodology) => void) {
    if (!draft || pending) return;
    const command = structuredClone(draft.command); update(command); setDraft({ ...draft, command });
  }
  async function apply(frozen: MethodologyAction) {
    if (!visible || action.current || !organisation) return;
    if (!retainMethodologyAction(frozen, session)) { setError(methodologyCustodyFailure); return; }
    const expected = owner, recovering = pending !== null, controller = new AbortController(); action.current = controller;
    cancelRead(); setPending(frozen); setWorking(true); setError(''); setReceipt(null);
    const deadline = setTimeout(() => controller.abort(), 8000);
    try {
      const confirmed = await applyMethodology(frozen, session, controller.signal);
      if (!mounted.current || liveOwner.current !== expected) return;
      discardMethodologyAction(organisation); setPending(null); updateDraft(null); updateRecallDraft(null);
      // Receipt custody is separate from the independent current settings read.
      setReceipt(confirmed);
    } catch (reason) {
      if (!mounted.current || liveOwner.current !== expected) return;
      if (methodologyRefused(reason, recovering)) { discardMethodologyPending(organisation, session); setPending(null); }
      fail(reason, recovering);
    } finally {
      clearTimeout(deadline);
      if (action.current === controller) { action.current = null; if (mounted.current) { setWorking(false); void refresh(); } }
    }
  }
  function save() {
    if (!draft || !organisation || !snapshot) return;
    try {
      const command = structuredClone(draft.command);
      command.activation.available_at = draft.availableAt ? Math.floor(new Date(draft.availableAt).getTime() / 1000) : Math.floor(Date.now() / 1000);
      void apply(freezeMethodologyAction({ kind: 'save', organisation_id: organisation, body: parseSaveMethodology(command) }));
    } catch { setError('Check the package name, requirement labels, version references and complete date ranges before saving.'); }
  }
  const command = draft?.command;
  const potentialChange = !!command && draft?.baseline !== JSON.stringify(command.definition);
  return <section ref={panel} className="methodology-workspace" aria-label="Methodology settings" hidden={!active}>
    <div className="methodology-heading"><div><p className="eyebrow">Settings</p><h1 ref={heading} tabIndex={-1}>Methodology and skills</h1></div><button type="button" className="quiet-button" onClick={onClose}>Return to workspace</button></div>
    <p className="scope-note">Admin saves firm requirements and templates. Configuration grants no access to client audit work or audit sign-off. Admin can explicitly install attributable skill versions below.</p>
    {!visible ? <p role="status">{readError || error || 'Checking current methodology access…'}</p> : null}
    {readError && visible ? <p className="notice" role="alert">{readError}</p> : null}
    {error && visible ? <p className="notice" role="alert">{error}</p> : null}
    <button type="button" className="text-button" disabled={!accessReady || working} onClick={() => void refresh()}>Refresh methodology access</button>
    <div hidden={!visible}>
      {!organisation ? <><h2>Your organisations</h2>{organisations?.organisations.length ? <ul className="engagement-list">{organisations.organisations.map(item => <li key={item.organisation_id}><button className="engagement-card" type="button" onClick={() => select(item.organisation_id)}><span>{item.organisation_name}</span><span>Manage methodology →</span></button></li>)}</ul> : <p>No current Admin organisations are available.</p>}
        {organisationCursor.current ? <button type="button" className="quiet-button" onClick={() => void refresh(null)}>First organisations</button> : null}
        {organisations?.next_cursor ? <button type="button" className="quiet-button" onClick={() => void refresh(organisations.next_cursor)}>More organisations</button> : null}</> : null}
      {organisation ? <div className="methodology-heading"><div><button type="button" className="text-button" disabled={working || !!pending} onClick={() => select(null)}>← Organisations</button><h2>{org?.organisation_name ?? organisation}</h2>{snapshot ? <p>Settings revision {snapshot.revision}</p> : null}</div>
        <button type="button" disabled={!snapshot || working || !!pending} onClick={() => edit()}>New methodology</button></div> : null}
      {organisation && snapshot ? <>
        {receipt ? <section className="notice" role="status"><strong>{receipt.kind === 'recall' ? 'Recall recorded.' : 'Methodology saved.'}</strong><p>Version {receipt.version_id} · revision {receipt.revision} · attributed to {receipt.actor_id}</p><p>{receipt.impact.affected_tasks} affected Tasks · {receipt.impact.pending_tasks} pending changes · {receipt.impact.retained_tasks} retained bindings.</p><ul>{receipt.impact.diff.map((line, index) => <li key={index}>{line}</li>)}</ul></section> : null}
        {pending ? <section className="notice" aria-label="Unconfirmed methodology request"><h3>{working ? 'Saving…' : 'Delivery unconfirmed'}</h3><p>The exact {pending.kind} request, dates and key are retained. Retry checks its original receipt.</p><button type="button" className="quiet-button" disabled={working} onClick={() => void apply(pending)}>Retry exact methodology request</button></section> : null}
        {command && draft ? <form className="methodology-editor" aria-label="Edit methodology" onSubmit={event => { event.preventDefault(); save(); }}>
          <fieldset disabled={working || !!pending}>
            <legend>{command.undo_of ? 'Undo as a successor' : command.supersedes ? 'Edit saved methodology' : 'New firm methodology'}</legend>
            {command.expected_revision !== snapshot.revision ? <section className="notice" aria-label="Changed methodology settings"><p>Settings changed while this draft was open. Review the saved versions and impact before selecting the latest revision for your retained edit.</p><button type="button" className="quiet-button" onClick={reviewLatest}>Use latest settings revision</button></section> : null}
            <label>Package name<input required maxLength={200} value={command.definition.name} onChange={event => change(c => { c.definition.name = event.target.value; })} /></label>
            <label className="methodology-check"><input type="checkbox" checked={command.definition.neutral_starter} onChange={event => change(c => { c.definition.neutral_starter = event.target.checked; c.source.kind = event.target.checked ? 'neutral_starter' : 'authored'; })} />Label as a neutral starter</label>
            <p className="scope-note">Neutral starters do not supply missing firm criteria. Missing context blocks dependent conclusions only.</p>
            {command.supersedes ? <p className="scope-note">A successor keeps this methodology’s assignment and business applicability. Use New methodology to author a separate configuration for a different scope or period.</p> : null}
            <fieldset disabled={!!command.supersedes}><legend>Assignment</legend><div className="methodology-grid"><label>Assignment scope<select value={command.assignment.kind} onChange={event => change(c => { c.assignment = { kind: event.target.value as SaveMethodology['assignment']['kind'], client_id: null, engagement_id: null }; })}><option value="firm">All firm engagements</option><option value="client">One client</option><option value="engagement">One engagement</option></select></label>
              {command.assignment.kind !== 'firm' ? <label>Client<select required value={command.assignment.client_id ?? ''} onChange={event => change(c => { c.assignment.client_id = event.target.value || null; c.assignment.engagement_id = null; })}><option value="">Choose a client</option>{[...new Map(snapshot.engagements.map(e => [e.client_id, e.client_name])).entries()].map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label> : null}
              {command.assignment.kind === 'engagement' ? <label>Engagement<select required value={command.assignment.engagement_id ?? ''} onChange={event => change(c => { c.assignment.engagement_id = event.target.value || null; })}><option value="">Choose an engagement</option>{snapshot.engagements.filter(e => e.client_id === command.assignment.client_id).map(e => <option value={e.engagement_id} key={e.engagement_id}>{e.engagement_name}</option>)}</select></label> : null}</div></fieldset>
            <fieldset disabled={!!command.supersedes}><legend>Business applicability</legend><p>The audit period governed by these requirements, independent of when you save or activate them.</p><div className="methodology-grid"><label>Applicable audit area<input maxLength={200} value={command.applicability.audit_area ?? ''} placeholder="All areas" onChange={event => change(c => { c.applicability.audit_area = event.target.value || null; })} /></label><label>Business period start<input type="date" value={command.applicability.period_start ?? ''} onChange={event => change(c => { c.applicability.period_start = event.target.value || null; })} /></label><label>Business period end<input type="date" value={command.applicability.period_end ?? ''} onChange={event => change(c => { c.applicability.period_end = event.target.value || null; })} /></label></div></fieldset>
            <fieldset><legend>Default Task context</legend><p>Used when a new Task does not supply its own area or period. Leaving these blank keeps missing context explicit.</p><div className="methodology-grid"><label>Default audit area<input maxLength={200} value={command.definition.default_context.audit_area ?? ''} onChange={event => change(c => { c.definition.default_context.audit_area = event.target.value || null; })} /></label><label>Default period start<input type="date" value={command.definition.default_context.period_start ?? ''} onChange={event => change(c => { c.definition.default_context.period_start = event.target.value || null; })} /></label><label>Default period end<input type="date" value={command.definition.default_context.period_end ?? ''} onChange={event => change(c => { c.definition.default_context.period_end = event.target.value || null; })} /></label></div></fieldset>
            <h3>Requirements</h3><p>Stable requirement identifiers support field-wise inheritance. Choose inherited values, supply values, or explicitly clear an optional field. Mandatory inherited rules remain required and cannot be cleared.</p>
            {command.definition.requirements.map((rule, index) => <details className="methodology-requirement" key={index} open><summary>{rule.label || `Requirement ${index + 1}`} · {rule.mandatory ? 'Required' : 'Optional'}</summary>
              <div className="methodology-grid"><label>Requirement identifier<input required maxLength={128} pattern="(?:[A-Za-z0-9_]|-)+" value={rule.id} onChange={event => change(c => { c.definition.requirements[index]!.id = event.target.value; })} /></label><label>Requirement label<input maxLength={200} value={rule.label ?? ''} onChange={event => change(c => { c.definition.requirements[index]!.label = event.target.value || null; })} /></label></div>
              <label className="methodology-check"><input type="checkbox" checked={rule.mandatory} onChange={event => change(c => { c.definition.requirements[index]!.mandatory = event.target.checked; })} />Mandatory requirement</label>
              {Object.entries(textFields).map(([key, label]) => { const field = key as keyof typeof textFields; const mode = inheritanceMode(rule[field]); return <div key={key}>
                <label>{label} behavior<select value={mode} onChange={event => change(c => { c.definition.requirements[index]![field] = inheritanceValue(event.target.value as InheritanceMode, rule[field], ''); })}><option value="inherit">Inherit applicable values</option><option value="value">Supply values</option><option value="clear">Clear optional values</option></select></label>
                <label>{label}<textarea aria-label={label} rows={2} disabled={mode === 'clear'} value={rule[field]?.join('\n') ?? ''} placeholder={mode === 'inherit' ? 'Type to supply values; one per line' : 'One value per line'} onChange={event => change(c => { c.definition.requirements[index]![field] = event.target.value.split('\n'); })} /></label>
              </div>; })}
              {Object.entries(referenceFields).map(([key, label]) => { const field = key as keyof typeof referenceFields; const mode = inheritanceMode(rule[field]); return <div key={key}>
                <label>{label} behavior<select value={mode} onChange={event => change(c => { c.definition.requirements[index]![field] = inheritanceValue(event.target.value as InheritanceMode, rule[field], { id: '', version: '' }); })}><option value="inherit">Inherit applicable versions</option><option value="value">Supply versions</option><option value="clear">Clear optional versions</option></select></label>
                <label>{label}<textarea aria-label={label} rows={2} disabled={mode === 'clear'} value={rule[field]?.map(v => `${v.id}@${v.version}`).join('\n') ?? ''} placeholder="One identifier@version per line" onChange={event => change(c => { c.definition.requirements[index]![field] = event.target.value.split('\n').map(line => { const split = line.indexOf('@'); return { id: split < 0 ? line : line.slice(0, split), version: split < 0 ? '' : line.slice(split + 1) }; }); })} /></label>
              </div>; })}
              <button type="button" className="text-button" onClick={() => change(c => { c.definition.requirements.splice(index, 1); })}>Remove requirement {index + 1}</button>
            </details>)}
            <button type="button" className="quiet-button" disabled={command.definition.requirements.length >= 100} onClick={() => change(c => { c.definition.requirements.push(requirement()); })}>Add requirement</button>
            <fieldset><legend>Authored templates</legend><p>Define each exact template version referenced by a requirement above. Saved content travels with the Task binding.</p>
              {command.definition.templates.map((template, templateIndex) => <section className="methodology-requirement" key={templateIndex} aria-label={`Template ${templateIndex + 1}`}>
                <div className="methodology-grid"><label>Template identifier<input required pattern="(?:[A-Za-z0-9_]|-)+" maxLength={128} value={template.id} onChange={event => change(c => { c.definition.templates[templateIndex]!.id = event.target.value; })} /></label><label>Template version<input required pattern="(?:[A-Za-z0-9_]|-)+" maxLength={128} value={template.version} onChange={event => change(c => { c.definition.templates[templateIndex]!.version = event.target.value; })} /></label><label>Template name<input required maxLength={200} value={template.name} onChange={event => change(c => { c.definition.templates[templateIndex]!.name = event.target.value; })} /></label></div>
                {template.sections.map((section, sectionIndex) => <fieldset key={sectionIndex}><legend>Section {sectionIndex + 1}</legend><label>Section identifier<input required pattern="(?:[A-Za-z0-9_]|-)+" maxLength={128} value={section.id} onChange={event => change(c => { c.definition.templates[templateIndex]!.sections[sectionIndex]!.id = event.target.value; })} /></label><label>Section title<input required maxLength={200} value={section.title} onChange={event => change(c => { c.definition.templates[templateIndex]!.sections[sectionIndex]!.title = event.target.value; })} /></label><label>Section content<textarea aria-label="Section content" required rows={4} value={section.content} onChange={event => change(c => { c.definition.templates[templateIndex]!.sections[sectionIndex]!.content = event.target.value; })} /></label><label className="methodology-check"><input type="checkbox" checked={section.required} onChange={event => change(c => { c.definition.templates[templateIndex]!.sections[sectionIndex]!.required = event.target.checked; })} />Required section</label><button type="button" className="text-button" onClick={() => change(c => { c.definition.templates[templateIndex]!.sections.splice(sectionIndex, 1); })}>Remove section {sectionIndex + 1}</button></fieldset>)}
                <div className="methodology-actions"><button type="button" className="quiet-button" disabled={template.sections.length >= 32} onClick={() => change(c => { c.definition.templates[templateIndex]!.sections.push({ id: crypto.randomUUID(), title: '', content: '', required: true }); })}>Add template section</button><button type="button" className="text-button" onClick={() => change(c => { c.definition.templates.splice(templateIndex, 1); })}>Remove template {templateIndex + 1}</button></div>
              </section>)}
              <button type="button" className="quiet-button" disabled={command.definition.templates.length >= 32} onClick={() => change(c => { c.definition.templates.push({ id: crypto.randomUUID(), version: 'v1', name: '', sections: [{ id: crypto.randomUUID(), title: '', content: '', required: true }] }); })}>Add template</button>
            </fieldset>
            <fieldset><legend>Source attribution</legend><label>Source kind<select value={command.source.kind} onChange={event => change(c => { c.source.kind = event.target.value as SaveMethodology['source']['kind']; })}><option value="authored">Authored configuration</option><option value="imported_proposal">Imported editable proposal</option><option value="neutral_starter">Neutral starter</option></select></label><label>Source reference<input maxLength={2000} value={command.source.reference ?? ''} onChange={event => change(c => { c.source.reference = event.target.value || null; })} /></label><label>Source note<textarea aria-label="Source note" rows={2} value={command.source.note ?? ''} onChange={event => change(c => { c.source.note = event.target.value || null; })} /></label></fieldset>
            <fieldset><legend>Availability and impact</legend><label>Available from<input type="datetime-local" value={draft.availableAt} onChange={event => setDraft({ ...draft, availableAt: event.target.value })} /></label><p>Leave blank for effective now. This is availability, separate from the business period above.</p><label>Apply change to<select value={command.activation.mode} onChange={event => change(c => { c.activation.mode = event.target.value as SaveMethodology['activation']['mode']; })}><option value="new_tasks">New Tasks only</option><option value="active_tasks">Also apply to active Tasks</option></select></label>
              <section className="methodology-impact" aria-label="Methodology impact preview"><h3>Impact preview</h3><p>{command.assignment.kind === 'firm' ? 'All firm engagements' : command.assignment.kind === 'client' ? 'Selected client' : 'Selected engagement'} · {draft.availableAt ? `available ${new Date(draft.availableAt).toLocaleString()}` : 'effective now'} · {command.activation.mode === 'new_tasks' ? 'new Tasks only' : 'also active Tasks'}.</p><p>{potentialChange ? 'Potentially material: requirements or their meaning may change.' : 'The definition is unchanged; assignment and timing are still checked.'} {command.definition.requirements.length} configured requirements.</p><p>{command.activation.mode === 'new_tasks' ? 'Existing Tasks retain their recorded binding. Affected work receives an update notice.' : 'Changes are staged at a safe boundary. Consumed activity keeps its original basis until reconciliation; affected draft dependencies need reconsideration.'}</p><p>Exact affected, pending and retained counts are recorded atomically with Save.</p></section>
            </fieldset>
            <div className="methodology-actions"><button type="submit">Save methodology</button><button type="button" className="quiet-button" onClick={() => { setDraft(null); setError(''); }}>Cancel edit</button></div>
          </fieldset>
        </form> : null}
        {recalling ? <form className="methodology-editor" aria-label="Recall methodology" onSubmit={event => { event.preventDefault(); if (recallDraft && recallReason.trim()) void apply(freezeMethodologyAction({ kind: 'recall', organisation_id: organisation, body: { key: recallDraft.key, expected_revision: recallDraft.expected_revision, version_id: recalling.id, reason: recallReason } })); }}><fieldset disabled={working || !!pending}><legend>Recall {recalling.command.definition.name}</legend><p>Recall blocks affected new use. Existing receipts and in-flight history keep their original basis.</p>{recallDraft && recallDraft.expected_revision !== snapshot.revision ? <section className="notice"><p>Settings changed while this recall was open. Review the current version before continuing.</p><button type="button" className="quiet-button" onClick={() => setRecallDraft({ ...recallDraft, expected_revision: snapshot.revision, key: crypto.randomUUID() })}>Use latest recall revision</button></section> : null}<label>Recall reason<textarea aria-label="Recall reason" required rows={3} value={recallReason} onChange={event => recallDraft && setRecallDraft({ ...recallDraft, reason: event.target.value })} /></label><button type="submit">Recall version</button><button type="button" className="quiet-button" onClick={() => setRecallDraft(null)}>Cancel recall</button></fieldset></form> : null}
        <section aria-label="Saved methodology versions"><h3>Saved versions</h3>{snapshot.versions.length === 0 ? <p>No firm methodology saved. New Tasks use an explicitly incomplete neutral basis.</p> : snapshot.versions.map(version => { const head = methodologyLineageHead(snapshot.versions, version.id); return <article className="methodology-version" key={version.id}><h4>{version.command.definition.name}{version.command.definition.neutral_starter ? ' · Neutral starter' : ''}{version.recalled ? ' · Recalled' : ''}</h4><p>Version {version.id} · revision {version.revision} · saved by {version.actor_id} on {dateTime(version.saved_at)}</p><p>{version.command.assignment.kind} assignment · available {dateTime(version.command.activation.available_at)} · {version.command.applicability.period_start ? `${version.command.applicability.period_start} to ${version.command.applicability.period_end}` : 'All business periods'}</p><details><summary>Inspect exact saved definition and source</summary><pre tabIndex={0}>{JSON.stringify(version.command, null, 2)}</pre></details><div className="methodology-actions"><button type="button" className="quiet-button" disabled={working || !!pending || !head || head.recalled} onClick={() => edit(version)}>{head && head.id !== version.id ? `Edit current version ${head.revision} for this lineage` : `Edit version ${version.revision}`}</button><button type="button" className="quiet-button" disabled={working || !!pending || !head} onClick={() => edit(version, true)}>Undo to version {version.revision}</button><button type="button" className="text-button" disabled={working || !!pending || version.recalled} onClick={() => { if (setRecallDraft({ version, reason: '', expected_revision: snapshot.revision, key: crypto.randomUUID() })) { setReceipt(null); setError(''); } }}>Recall version {version.revision}</button></div></article>; })}</section>
        {snapshot.impacts.length ? <details className="methodology-impacts"><summary>Recorded change impacts</summary>{snapshot.impacts.map(impact => <article key={impact.id}><h4>Version {impact.version_id}</h4><p>{impact.activation_mode === 'new_tasks' ? 'New Tasks only' : 'Also active Tasks'} · {impact.affected_tasks} affected · {impact.pending_tasks} pending · {impact.retained_tasks} retained</p><ul>{impact.diff.map((line, index) => <li key={index}>{line}</li>)}</ul></article>)}</details> : null}
      </> : null}
      {organisation ? <SkillCatalog key={`${owner}/skills`} organisation={organisation} session={session} accessReady={visible} onAccessFailure={readFailure} /> : null}
    </div>
  </section>;
}
