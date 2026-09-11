'use client';

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { draftContext } from '@intellifin/domain';
import type { AuthoringDraftFields, AuthoringSection, AuthoringSuggestionView, ProcedureVersionView } from '@intellifin/application';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';
import { UnknownSaveOutcome } from './UnknownSaveOutcome';
import { useSectionSubmissionStatus, useSubmissionGuard } from './use-section';
import './writing-assistant.css';

export type { AuthoringDraftFields, AuthoringSection, AuthoringSuggestionView } from '@intellifin/application';
export interface WritingAssistantActions {
  readonly generate: (fields: AuthoringDraftFields) => Promise<{ ok: true; suggestion: AuthoringSuggestionView } | { ok: false; reason: string }>;
  readonly accept: (fields: {
    procedureId: string; versionId: string; expectedRowVersion: string; requestId: string; replacement: string;
  }) => Promise<{ ok: true; rowVersion: string; alreadyApplied: boolean } | { ok: false; reason: string }>;
  readonly reject: (fields: { procedureId: string; versionId: string; requestId: string }) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

export const WRITING_LIMITS = { notes: 8_000, changes: 2_000, proposal: 10_000 } as const;
const GENERATION_UNCERTAIN = 'The writing response was lost. Retry to check the same request. You can still edit and save the procedure yourself.';
const GENERATION_FAILED = 'Writing help could not prepare a draft. You can still edit and save the procedure yourself.';
const STALE_SUGGESTION = 'The saved procedure changed after this request. This suggestion cannot be used. Start again from the current saved content.';

type Notice = { readonly tone: 'info' | 'success' | 'warning' | 'danger'; readonly title: string };
type WritingMode = AuthoringDraftFields['mode'];
export interface WritingSession {
  readonly section: AuthoringSection;
  readonly mode: WritingMode;
  readonly notes: string;
  readonly changes: string;
  readonly proposal: string;
  readonly editing: boolean;
  readonly askingForChanges: boolean;
  readonly request: AuthoringDraftFields | null;
  readonly basisRevision: number;
  readonly basisText: string;
  readonly suggestion: AuthoringSuggestionView | null;
  readonly busy: 'generation' | 'acceptance' | 'rejection' | null;
  readonly generationUncertain: boolean;
  readonly stale: boolean;
  readonly notice: Notice | null;
}
interface WritingSnapshot {
  readonly selected: string | null;
  readonly sessions: ReadonlyMap<string, WritingSession>;
  readonly accepting: boolean;
  readonly acceptanceUnknown: boolean;
}

export function writingSectionKey(section: AuthoringSection): string {
  return section.kind === 'instructions' ? `instructions:${section.registrationId}` : section.kind;
}

export function isWritingResponse(value: unknown, request: AuthoringDraftFields): value is AuthoringSuggestionView {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>, section = candidate['section'];
  if (section === null || typeof section !== 'object' || Array.isArray(section)) return false;
  const selected = section as Record<string, unknown>;
  if (selected['kind'] !== request.section.kind || (request.section.kind === 'instructions' && selected['registrationId'] !== request.section.registrationId)) return false;
  const text = candidate['proposedText'], questions = candidate['clarifications'];
  if (candidate['requestId'] !== request.requestId || typeof candidate['authoringRevision'] !== 'number'
    || !Number.isSafeInteger(candidate['authoringRevision']) || candidate['authoringRevision'] < 0
    || typeof candidate['currentText'] !== 'string' || typeof candidate['stale'] !== 'boolean'
    || (candidate['message'] !== null && typeof candidate['message'] !== 'string')
    || typeof candidate['state'] !== 'string' || !['pending', 'ready', 'failed', 'accepted', 'rejected'].includes(candidate['state'])
    || (text !== null && (typeof text !== 'string' || text.trim() === '' || text.length > WRITING_LIMITS.proposal))
    || !Array.isArray(questions) || questions.length > 4 || !questions.every(question => typeof question === 'string' && question.trim() !== '' && question.length <= 1_000)) return false;
  return candidate['state'] !== 'ready' || (text === null ? questions.length > 0 : questions.length === 0);
}

export function savedWritingText(draft: ProcedureVersionView, section: AuthoringSection): string {
  if (section.kind === 'objective') return draftContext(draft.sections).objective;
  if (section.kind === 'scope') return draft.scope;
  return draft.instructions.find(instruction => instruction.registrationId === section.registrationId)?.text ?? '';
}

function sectionLabel(draft: ProcedureVersionView, section: AuthoringSection): string {
  if (section.kind === 'objective') return 'Objective';
  if (section.kind === 'scope') return 'Scope note';
  const target = draft.targets.find(target => target.registrationId === section.registrationId);
  return target ? `Audit steps for ${target.displayName}` : 'Audit steps for a removed system';
}

/** Worker updates and section acknowledgements do not change the authored revision.
 * A revision change remains stale even when an auditor later restores the same words. */
export function writingSuggestionIsStale(session: WritingSession, draft: ProcedureVersionView): boolean {
  if (session.request === null) return false;
  const revision = draft.sectionPreparation?.revision ?? 0;
  const basis = session.suggestion?.authoringRevision ?? session.basisRevision;
  const basisText = session.suggestion?.currentText ?? session.basisText;
  return session.stale || session.suggestion?.stale === true || draft.state !== 'DRAFT'
    || revision !== basis || savedWritingText(draft, session.section) !== basisText;
}

/** One changed word range, with identical leading/trailing words retained verbatim.
 * This is a readable comparison, never a claim that prose has equivalent meaning. */
export function writingDifference(current: string, proposed: string) {
  const left = current.match(/\s+|\S+/g) ?? [], right = proposed.match(/\s+|\S+/g) ?? [];
  let start = 0, end = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  while (end < left.length - start && end < right.length - start && left[left.length - end - 1] === right[right.length - end - 1]) end += 1;
  return {
    before: left.slice(0, start).join(''), after: end === 0 ? '' : left.slice(left.length - end).join(''),
    removed: left.slice(start, left.length - end).join(''), added: right.slice(start, right.length - end).join(''),
  };
}

/** Request ownership is synchronous, so rapid clicks and late responses cannot move a
 * suggestion between sections. Only the explicit acceptance action writes content. */
export function createWritingAssistantState() {
  let snapshot: WritingSnapshot = { selected: null, sessions: new Map(), accepting: false, acceptanceUnknown: false };
  const put = (key: string, session: WritingSession) => {
    snapshot = { ...snapshot, sessions: new Map(snapshot.sessions).set(key, session) };
  };
  const update = (key: string, patch: Partial<WritingSession>) => {
    const session = snapshot.sessions.get(key);
    if (session) put(key, { ...session, ...patch });
  };
  const owns = (request: AuthoringDraftFields) => snapshot.sessions.get(writingSectionKey(request.section))?.request === request;
  return {
    get snapshot() { return snapshot; },
    observe(draft: ProcedureVersionView): boolean {
      let changed = false;
      for (const [key, session] of snapshot.sessions) {
        if (!session.stale && writingSuggestionIsStale(session, draft)) {
          update(key, { stale: true }); changed = true;
        }
      }
      return changed;
    },
    open(section: AuthoringSection, mode: 'draft' | 'improve', text: string) {
      const key = writingSectionKey(section), existing = snapshot.sessions.get(key);
      const lengthNotice: Notice | null = mode === 'improve' && text.length > WRITING_LIMITS.notes
        ? { tone: 'info', title: 'The first 8,000 characters are in your notes. The full saved section is still part of the context for writing help.' } : null;
      snapshot = { ...snapshot, selected: key };
      if (!existing) put(key, {
        section, mode, notes: mode === 'improve' ? text.slice(0, WRITING_LIMITS.notes) : '', changes: '', proposal: '',
        editing: false, askingForChanges: false, request: null, basisRevision: 0, basisText: '', suggestion: null,
        busy: null, generationUncertain: false, stale: false, notice: lengthNotice,
      });
      else if (mode === 'improve' && existing.busy === null && !existing.generationUncertain && existing.suggestion?.state !== 'pending') {
        update(key, { mode, notes: text.slice(0, WRITING_LIMITS.notes), changes: '', askingForChanges: false, notice: lengthNotice });
      }
    },
    edit(key: string, field: 'notes' | 'changes' | 'proposal', value: string) {
      const session = snapshot.sessions.get(key);
      if (!session || session.busy || session.generationUncertain || session.suggestion?.state === 'pending' || snapshot.acceptanceUnknown) return;
      update(key, { [field]: value.slice(0, WRITING_LIMITS[field]) });
    },
    editProposal(key: string) {
      const session = snapshot.sessions.get(key);
      if (session && !session.busy && !snapshot.acceptanceUnknown) update(key, { editing: true });
    },
    askForChanges(key: string) {
      const session = snapshot.sessions.get(key);
      if (!session || session.busy || session.askingForChanges || snapshot.acceptanceUnknown) return;
      const notes = session.proposal || session.notes;
      update(key, { askingForChanges: true, mode: 'revise', notes: notes.slice(0, WRITING_LIMITS.notes), changes: '',
        ...(notes.length > WRITING_LIMITS.notes ? { notice: { tone: 'info', title: 'The first 8,000 characters of the proposal are in your rough notes. Review them before asking for changes.' } as Notice } : {}) });
    },
    notice(key: string, notice: Notice) { update(key, { notice }); },
    reconcile(key: string) {
      const session = snapshot.sessions.get(key);
      if (!session || session.busy || snapshot.acceptanceUnknown) return;
      const text = session.proposal || session.notes;
      update(key, { notes: text.slice(0, WRITING_LIMITS.notes), mode: 'draft', changes: '', suggestion: null, request: null,
        proposal: '', editing: false, askingForChanges: false, generationUncertain: false, stale: false,
        notice: { tone: 'info', title: text.length > WRITING_LIMITS.notes
          ? 'The first 8,000 characters are in your rough notes. Review them before requesting a new draft.'
          : 'The suggestion is now in your rough notes. Review it, then request a new draft using the current saved procedure.' } });
    },
    begin(request: AuthoringDraftFields, draft: ProcedureVersionView): boolean {
      const key = writingSectionKey(request.section), session = snapshot.sessions.get(key);
      if (!session || session.busy || snapshot.accepting || snapshot.acceptanceUnknown) return false;
      // A retry must be the stored object, including its original token and notes.
      const retry = session.generationUncertain || session.suggestion?.state === 'pending';
      if (retry && session.request !== request) return false;
      update(key, { request, busy: 'generation', generationUncertain: false, notice: null,
        ...(retry ? {} : { basisRevision: draft.sectionPreparation?.revision ?? 0, basisText: savedWritingText(draft, request.section),
          suggestion: null, proposal: '', editing: false, askingForChanges: false, stale: false }) });
      return true;
    },
    receive(request: AuthoringDraftFields, suggestion: unknown, draft: ProcedureVersionView) {
      if (!owns(request)) return;
      const key = writingSectionKey(request.section);
      if (!isWritingResponse(suggestion, request)) {
        update(key, { busy: null, generationUncertain: true, notice: { tone: 'danger', title: 'The writing response could not be read for this section. Retry this request. Manual editing is still available.' } });
        return;
      }
      const session = { ...snapshot.sessions.get(key)!, suggestion, proposal: suggestion.proposedText ?? '', busy: null, generationUncertain: false };
      put(key, { ...session, stale: writingSuggestionIsStale(session, draft), notice: suggestion.state === 'failed'
        ? { tone: 'warning', title: `${suggestion.message || 'Writing help is unavailable.'} You can still edit and save the procedure yourself.` }
        : suggestion.message ? { tone: 'info', title: suggestion.message } : null });
    },
    fail(request: AuthoringDraftFields, reason?: string) {
      if (!owns(request)) return;
      update(writingSectionKey(request.section), { busy: null, generationUncertain: reason === undefined,
        notice: { tone: 'warning', title: reason === undefined ? GENERATION_UNCERTAIN : `${reason} You can still edit and save the procedure yourself.` } });
    },
    beginAccept(key: string): boolean {
      const session = snapshot.sessions.get(key);
      if (!session || session.busy || session.suggestion?.state !== 'ready' || session.stale || snapshot.accepting || snapshot.acceptanceUnknown) return false;
      snapshot = { ...snapshot, accepting: true };
      update(key, { busy: 'acceptance', notice: null });
      return true;
    },
    finishAccept(key: string, result: 'accepted' | 'failed' | 'unknown', reason?: string) {
      const session = snapshot.sessions.get(key);
      snapshot = { ...snapshot, accepting: false, acceptanceUnknown: result === 'unknown' || snapshot.acceptanceUnknown };
      update(key, { busy: null, ...(result === 'accepted' && session?.suggestion ? { suggestion: { ...session.suggestion, state: 'accepted' as const }, editing: false, askingForChanges: false } : {}),
        notice: result === 'unknown' ? null : { tone: result === 'accepted' ? 'success' : 'warning', title: result === 'accepted'
          ? 'Your draft is saved. Review the section, then mark it reviewed when you are satisfied.'
          : reason || 'This draft could not be saved. Check the saved procedure and try again.' } });
    },
    beginReject(key: string): boolean {
      const session = snapshot.sessions.get(key);
      if (!session?.request || session.busy || snapshot.acceptanceUnknown) return false;
      update(key, { busy: 'rejection', notice: null });
      return true;
    },
    finishReject(key: string, reason?: string) {
      const session = snapshot.sessions.get(key);
      update(key, { busy: null, ...(reason === undefined ? {
        suggestion: session?.suggestion ? { ...session.suggestion, state: 'rejected' as const } : null,
        generationUncertain: false, request: null, proposal: '', editing: false, askingForChanges: false,
      } : {}), notice: { tone: reason === undefined ? 'info' : 'warning', title: reason ?? 'Your saved wording is unchanged.' } });
    },
  };
}

interface WritingContextValue {
  readonly draft: ProcedureVersionView;
  readonly snapshot: WritingSnapshot;
  readonly guardReason: string | null;
  readonly open: (section: AuthoringSection, mode: 'draft' | 'improve') => void;
  readonly edit: (key: string, field: 'notes' | 'changes' | 'proposal', value: string) => void;
  readonly editProposal: (key: string) => void;
  readonly askForChanges: (key: string) => void;
  readonly reconcile: (key: string) => void;
  readonly generate: (key: string, retry?: boolean) => void;
  readonly accept: (key: string) => void;
  readonly reject: (key: string) => void;
  readonly focusRequest: number;
}
const WritingContext = createContext<WritingContextValue | null>(null);
export interface WritingAssistantProviderProps {
  readonly draft: ProcedureVersionView;
  readonly rowVersion: string;
  readonly onRowVersion: (token: string) => void;
  readonly children: ReactNode;
  readonly actions: WritingAssistantActions;
}

export function WritingAssistantProvider(props: WritingAssistantProviderProps): React.JSX.Element {
  return <WritingAssistantSession key={`${props.draft.procedureId}:${props.draft.versionId}`} {...props} />;
}

function WritingAssistantSession({ draft, rowVersion, onRowVersion, children, actions }: WritingAssistantProviderProps): React.JSX.Element {
  const [machine] = useState(createWritingAssistantState);
  const [snapshot, setSnapshot] = useState(machine.snapshot);
  const [focusRequest, setFocusRequest] = useState(0);
  const mounted = useRef(true);
  const latest = useRef({ draft, rowVersion, onRowVersion, actions });
  latest.current = { draft, rowVersion, onRowVersion, actions };
  const guard = useSubmissionGuard();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const publish = () => { if (mounted.current) setSnapshot(machine.snapshot); };
  useEffect(() => { if (machine.observe(draft)) publish(); }, [draft, machine]);
  // Generation owns no editor and does not block submission. A content acceptance does.
  useSectionSubmissionStatus('Writing suggestion', {
    status: () => ({ dirty: false, conflict: false, pending: machine.snapshot.accepting || machine.snapshot.acceptanceUnknown }),
  }, snapshot.accepting, snapshot.acceptanceUnknown);

  function canAct(key: string): boolean {
    const reason = latest.current.draft.state !== 'DRAFT' ? 'Only a Draft can use writing help.' : guard.check();
    if (reason) { machine.notice(key, { tone: 'warning', title: reason }); publish(); return false; }
    return true;
  }

  async function generate(key: string, retry = false): Promise<void> {
    const session = machine.snapshot.sessions.get(key);
    if (!session || !canAct(key)) return;
    const current = latest.current;
    const request = retry ? session.request : {
      procedureId: current.draft.procedureId, versionId: current.draft.versionId, expectedRowVersion: current.rowVersion,
      requestId: crypto.randomUUID(), section: session.section, mode: session.mode, notes: session.notes, changes: session.changes,
    };
    if (request === null || request.notes.trim() === '' || request.notes.length > WRITING_LIMITS.notes || request.changes.length > WRITING_LIMITS.changes) return;
    if (!machine.begin(request, current.draft)) return;
    publish();
    try {
      const outcome = await current.actions.generate(request);
      if (!mounted.current) return;
      if (outcome.ok) machine.receive(request, outcome.suggestion, latest.current.draft);
      else machine.fail(request, outcome.reason || GENERATION_FAILED);
    } catch { if (mounted.current) machine.fail(request); }
    finally { publish(); }
  }

  async function accept(key: string): Promise<void> {
    const session = machine.snapshot.sessions.get(key);
    if (!session || !canAct(key)) return;
    if (writingSuggestionIsStale(session, latest.current.draft)) {
      machine.notice(key, { tone: 'warning', title: STALE_SUGGESTION }); publish(); return;
    }
    if (!session.proposal.trim() || session.proposal.length > WRITING_LIMITS.proposal || !session.request || !machine.beginAccept(key)) return;
    publish();
    const current = latest.current;
    try {
      const outcome = await current.actions.accept({ procedureId: current.draft.procedureId, versionId: current.draft.versionId,
        expectedRowVersion: current.rowVersion, requestId: session.request.requestId, replacement: session.proposal });
      if (!mounted.current) return;
      machine.finishAccept(key, outcome.ok ? 'accepted' : 'failed', outcome.ok ? undefined : outcome.reason);
      if (outcome.ok) current.onRowVersion(outcome.rowVersion);
    } catch { if (mounted.current) machine.finishAccept(key, 'unknown'); }
    finally { publish(); }
  }

  async function reject(key: string): Promise<void> {
    const session = machine.snapshot.sessions.get(key);
    if (!session?.request || !machine.beginReject(key)) return;
    publish();
    const current = latest.current;
    try {
      const outcome = await current.actions.reject({ procedureId: current.draft.procedureId, versionId: current.draft.versionId, requestId: session.request.requestId });
      if (mounted.current) machine.finishReject(key, outcome.ok ? undefined : outcome.reason);
    } catch { if (mounted.current) machine.finishReject(key, 'The dismissal response was lost. Your saved wording was not changed by this action. Retry Keep my wording.'); }
    finally { publish(); }
  }

  return <WritingContext.Provider value={{ draft, snapshot, guardReason: guard.reason, focusRequest,
    open(section, mode) { machine.open(section, mode, savedWritingText(latest.current.draft, section)); publish(); setFocusRequest(count => count + 1); },
    edit(key, field, value) { machine.edit(key, field, value); publish(); },
    editProposal(key) { machine.editProposal(key); publish(); },
    askForChanges(key) { machine.askForChanges(key); publish(); },
    reconcile(key) { machine.reconcile(key); publish(); },
    generate(key, retry) { void generate(key, retry); }, accept(key) { void accept(key); }, reject(key) { void reject(key); },
  }}>{children}</WritingContext.Provider>;
}

export function WritingTools({ section }: { readonly section: AuthoringSection }): React.JSX.Element | null {
  const assistant = useContext(WritingContext);
  if (!assistant) return null;
  const reason = assistant.draft.state !== 'DRAFT' ? 'Only a Draft can use writing help.' : undefined;
  const improveReason = reason ?? (savedWritingText(assistant.draft, section).trim() === '' ? 'Save some wording in this section before asking to improve it.' : undefined);
  return <div role="group" className="ls-writing__tools ls-actions" aria-label={`Writing help for ${sectionLabel(assistant.draft, section)}`}>
    <Button type="button" onClick={() => assistant.open(section, 'draft')} disabledReason={reason}>Help Me Write</Button>
    <Button type="button" onClick={() => assistant.open(section, 'improve')} disabledReason={improveReason}>Improve wording</Button>
  </div>;
}

export function WritingAssistantPanel(): React.JSX.Element | null {
  const assistant = useContext(WritingContext), id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const focusRequest = assistant?.focusRequest ?? 0;
  useEffect(() => {
    if (focusRequest === 0 || !heading.current) return;
    // The existing section-help disclosure belongs to the reader until they ask for help.
    const disclosure = heading.current.closest('details');
    if (disclosure) disclosure.open = true;
    heading.current.focus();
  }, [focusRequest]);
  if (!assistant) return null;
  const { snapshot, draft } = assistant, key = snapshot.selected;
  const session = key === null ? undefined : snapshot.sessions.get(key);
  if (!session || key === null) return <div className="ls-writing ls-stack"><h3 className="ls-guided__help-title">Writing help</h3><p className="ls-caption">Choose Help Me Write beside an objective, scope note or audit step. Your notes stay separate until you choose Use this draft.</p></div>;

  const suggestion = session.suggestion, stale = writingSuggestionIsStale(session, draft);
  const pending = session.busy === 'generation', retry = session.generationUncertain || suggestion?.state === 'pending';
  const terminal = suggestion?.state === 'accepted' || suggestion?.state === 'rejected';
  const fieldsLocked = session.busy !== null || retry || snapshot.acceptanceUnknown;
  const commonReason = draft.state !== 'DRAFT' ? 'Only a Draft can use writing help.'
    : snapshot.acceptanceUnknown ? 'Reload to inspect the unknown save outcome before using writing help.'
    : session.busy !== null ? 'Wait for this writing request to finish.' : assistant.guardReason ?? undefined;
  const generateReason = commonReason ?? (session.notes.trim() === '' ? 'Add rough notes for this section first.'
    : session.askingForChanges && session.changes.trim() === '' ? 'Describe the changes you want first.' : undefined);
  const acceptReason = commonReason ?? (stale ? STALE_SUGGESTION : suggestion?.state !== 'ready' ? 'A prepared draft is needed before it can be used.'
    : !session.proposal.trim() ? 'The proposed replacement cannot be empty.'
    : session.proposal.length > WRITING_LIMITS.proposal ? 'Shorten the proposal to 10,000 characters before using it.' : undefined);
  const comparisonCurrent = savedWritingText(draft, session.section);
  const difference = writingDifference(comparisonCurrent, session.proposal);

  return <section className="ls-writing ls-stack" aria-labelledby={`${id}-heading`} data-writing-section={key}>
    <h3 className="ls-guided__help-title" id={`${id}-heading`} tabIndex={-1} ref={heading}>Writing help: {sectionLabel(draft, session.section)}</h3>
    <p className="ls-caption">{session.mode === 'improve' ? 'Improve the clarity of your saved wording. Check that the meaning and scope stay faithful.' : 'Describe the work in your own words. Writing help will use the saved procedure as context.'} Nothing is saved or marked reviewed when a suggestion is generated.</p>
    <UnknownSaveOutcome visible={snapshot.acceptanceUnknown} />
    {session.notice ? <Banner tone={session.notice.tone} title={session.notice.title} /> : null}
    {stale && !terminal ? <Banner tone="warning" title={STALE_SUGGESTION} /> : null}

    <div className="ls-dialog__field">
      <label htmlFor={`${id}-notes`}>Rough notes for {sectionLabel(draft, session.section)}</label>
      <textarea className="ls-input ls-writing__notes" id={`${id}-notes`} value={session.notes} maxLength={WRITING_LIMITS.notes}
        readOnly={fieldsLocked} aria-describedby={`${id}-notes-help`} onChange={event => assistant.edit(key, 'notes', event.target.value)} />
      <p className="ls-caption" id={`${id}-notes-help`}>These notes do not change the procedure. Up to 8,000 characters.{retry ? ' Retry uses the original notes and saved context.' : ''}</p>
    </div>

    {session.askingForChanges ? <div className="ls-dialog__field">
      <label htmlFor={`${id}-changes`}>What should change?</label>
      <textarea className="ls-input" id={`${id}-changes`} value={session.changes} maxLength={WRITING_LIMITS.changes} readOnly={fieldsLocked}
        aria-describedby={`${id}-changes-help`} onChange={event => assistant.edit(key, 'changes', event.target.value)} />
      <p className="ls-caption" id={`${id}-changes-help`}>Explain the wording to change or answer the open questions. Up to 2,000 characters.</p>
    </div> : null}

    {commonReason ? <p className="ls-caption" id={`${id}-guard`}>{commonReason}</p> : null}
    <div className="ls-actions">
      <Button type="button" variant="primary" busy={pending} disabledReason={generateReason} onClick={() => assistant.generate(key, retry)}>
        {pending ? 'Preparing a draft…' : retry ? 'Retry this request' : session.askingForChanges ? 'Prepare revised draft' : 'Prepare draft'}
      </Button>
      {stale && session.busy === null && !terminal ? <Button type="button" disabledReason={snapshot.acceptanceUnknown ? commonReason : undefined} onClick={() => assistant.reconcile(key)}>Start again with this suggestion</Button> : null}
    </div>
    {pending ? <Banner tone="info" title="Preparing this section. You can keep editing and saving the procedure while you wait." /> : null}
    {suggestion?.state === 'pending' && !pending ? <Banner tone="info" title="This request is still being prepared. Retry this request to check its result." /> : null}

    {suggestion && suggestion.clarifications.length > 0 && !terminal ? <div className="ls-writing__questions ls-stack">
      <h4 className="ls-guided__help-title">Questions to resolve</h4>
      <ul>{suggestion.clarifications.map((question, index) => <li key={index}>{question}</li>)}</ul>
      <p className="ls-caption">Answer these in your notes or ask for changes. Review remains a separate decision.</p>
    </div> : null}

    {suggestion?.proposedText !== null && suggestion?.proposedText !== undefined && !terminal ? <>
      <p className="ls-caption">Compare the saved content with the proposed replacement. Check quantities, scope, timing and criteria before accepting it.</p>
      <div className="ls-writing__comparison">
        <div className="ls-writing__version ls-stack"><h4 className="ls-guided__help-title">Current saved content</h4>
          <p className="ls-writing__text">{comparisonCurrent ? <>{difference.before}{difference.removed ? <del>{difference.removed}</del> : null}{difference.after}</> : 'No saved wording yet.'}</p>
        </div>
        <div className="ls-writing__version ls-stack"><h4 className="ls-guided__help-title">Proposed replacement — not applied</h4>
          {session.editing ? <div className="ls-dialog__field"><label htmlFor={`${id}-proposal`}>Edit proposed replacement</label>
            <textarea className="ls-input ls-writing__notes" id={`${id}-proposal`} value={session.proposal} maxLength={WRITING_LIMITS.proposal} readOnly={fieldsLocked}
              onChange={event => assistant.edit(key, 'proposal', event.target.value)} />
            <p className="ls-caption">Changes here stay in the proposal until you choose Use this draft.</p>
          </div> : <p className="ls-writing__text">{difference.before}{difference.added ? <ins>{difference.added}</ins> : null}{difference.after}</p>}
        </div>
      </div>
      {acceptReason ? <p className="ls-caption" id={`${id}-accept-reason`}>{acceptReason}</p> : null}
      <div className="ls-actions">
        <Button type="button" variant="primary" busy={session.busy === 'acceptance'} disabledReason={acceptReason} disabledReasonId={`${id}-accept-reason`} onClick={() => assistant.accept(key)}>{session.busy === 'acceptance' ? 'Saving draft…' : 'Use this draft'}</Button>
        <Button type="button" disabledReason={fieldsLocked ? commonReason ?? 'Retry this request before editing its result.' : undefined} onClick={() => assistant.editProposal(key)}>Edit</Button>
      </div>
    </> : null}

    {session.request && !terminal && !pending ? <div className="ls-actions">
      {suggestion?.state === 'ready' ? <Button type="button" disabledReason={fieldsLocked ? commonReason ?? 'Retry this request first.' : undefined} onClick={() => assistant.askForChanges(key)}>Ask for changes</Button> : null}
      <Button type="button" busy={session.busy === 'rejection'} disabledReason={session.busy !== null || snapshot.acceptanceUnknown ? commonReason : undefined} onClick={() => assistant.reject(key)}>Keep my wording</Button>
    </div> : null}
    {suggestion?.state === 'accepted' && session.notice === null ? <Banner tone="success" title="This suggestion was already saved. Review the current section before marking it reviewed." /> : null}
    {suggestion?.state === 'rejected' && session.notice === null ? <Banner tone="info" title="This suggestion was dismissed. Your saved wording is unchanged." /> : null}
  </section>;
}
