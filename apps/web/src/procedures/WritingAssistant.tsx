'use client';

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CONTEXT_TEXT_LIMIT, draftContext, isAgentDrivenKind, type PreparationSectionId } from '@intellifin/domain';
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
export const writingProposalLimit = (section: AuthoringSection) => section.kind === 'objective' ? CONTEXT_TEXT_LIMIT : WRITING_LIMITS.proposal;
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
  /** The last four proposal/correction pairs stay local to the bounded session. */
  readonly history: readonly WritingHistoryEntry[];
  readonly busy: 'generation' | 'acceptance' | 'rejection' | null;
  readonly generationUncertain: boolean;
  readonly stale: boolean;
  readonly notice: Notice | null;
}
export interface WritingHistoryEntry {
  readonly requestId: string;
  readonly feedback: string;
  readonly proposal: string | null;
  readonly explanation?: string;
  readonly clarifications: readonly string[];
}
interface WritingSnapshot {
  readonly selected: string | null;
  readonly lastInstructionTarget: string | null;
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
  const text = candidate['proposedText'], questions = candidate['clarifications'], explanation = candidate['explanation'];
  if (candidate['requestId'] !== request.requestId || typeof candidate['authoringRevision'] !== 'number'
    || !Number.isSafeInteger(candidate['authoringRevision']) || candidate['authoringRevision'] < 0
    || typeof candidate['currentText'] !== 'string' || typeof candidate['stale'] !== 'boolean'
    || (candidate['message'] !== null && typeof candidate['message'] !== 'string')
    || (explanation !== undefined && (typeof explanation !== 'string' || explanation.trim() === '' || explanation.length > 2_000))
    || typeof candidate['state'] !== 'string' || !['pending', 'ready', 'failed', 'accepted', 'rejected'].includes(candidate['state'])
    || (text !== null && (typeof text !== 'string' || text.trim() === '' || text.length > writingProposalLimit(request.section)))
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

/** Build the only client-owned follow-up context. The server walks the referenced
 * receipt and supplies its bounded prior history; the client supplies the full current
 * working proposal and the latest human correction separately. */
export function writingRevisionFor(session: WritingSession): AuthoringDraftFields['revision'] | undefined {
  if (session.mode !== 'revise') return undefined;
  if (session.suggestion?.state === 'ready') return { requestId: session.suggestion.requestId, draft: session.proposal };
  // A failed attempt has no replacement to revise. Retry against the same complete
  // working proposal and original ready parent, not the initial rough notes alone.
  return !session.suggestion || session.suggestion.state === 'pending' || session.suggestion.state === 'failed'
    ? session.request?.revision : undefined;
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
  let snapshot: WritingSnapshot = { selected: null, lastInstructionTarget: null, sessions: new Map(), accepting: false, acceptanceUnknown: false };
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
      snapshot = { ...snapshot, selected: key, lastInstructionTarget: section.kind === 'instructions' ? section.registrationId : snapshot.lastInstructionTarget };
      if (!existing) put(key, {
        section, mode, notes: mode === 'improve' ? text.slice(0, WRITING_LIMITS.notes) : '', changes: '', proposal: '',
        editing: false, askingForChanges: false, request: null, basisRevision: 0, basisText: '', suggestion: null,
        history: [],
        busy: null, generationUncertain: false, stale: false, notice: lengthNotice,
      });
      else if (mode === 'improve' && existing.busy === null && !existing.generationUncertain && existing.suggestion?.state !== 'pending') {
        update(key, { mode, notes: text.slice(0, WRITING_LIMITS.notes), changes: '', askingForChanges: false, notice: lengthNotice });
      }
    },
    edit(key: string, field: 'notes' | 'changes' | 'proposal', value: string) {
      const session = snapshot.sessions.get(key);
      if (!session || session.busy || session.generationUncertain || session.suggestion?.state === 'pending' || snapshot.acceptanceUnknown) return;
      update(key, { [field]: value.slice(0, field === 'proposal' ? writingProposalLimit(session.section) : WRITING_LIMITS[field]) });
    },
    editProposal(key: string) {
      const session = snapshot.sessions.get(key);
      if (session && !session.busy && !snapshot.acceptanceUnknown) update(key, { editing: true });
    },
    askForChanges(key: string) {
      const session = snapshot.sessions.get(key);
      if (!session || session.busy || session.askingForChanges || snapshot.acceptanceUnknown) return;
      // Keep the original rough answer as notes. The complete proposal, including a
      // human edit up to 10,000 characters, is sent in revision.draft when the next
      // request is built. Truncating it into the 8,000-character notes field would
      // silently remove the very passage the auditor is correcting.
      update(key, { askingForChanges: true, mode: 'revise', changes: '' });
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
      const history = !retry && session.suggestion !== null
        ? [...session.history, {
          requestId: session.suggestion.requestId,
          feedback: session.changes,
          proposal: session.proposal || session.suggestion.proposedText,
          ...(session.suggestion.explanation === undefined ? {} : { explanation: session.suggestion.explanation }),
          clarifications: session.suggestion.clarifications,
        }].slice(-4)
        : session.history;
      update(key, { request, busy: 'generation', generationUncertain: false, notice: null,
        history,
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
      const prior = snapshot.sessions.get(key)!;
      const history = prior.history;
      const session = { ...prior, suggestion, proposal: suggestion.proposedText ?? '', busy: null, generationUncertain: false, history,
        ...(suggestion.state === 'ready' ? { changes: '' } : {}) };
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
  readonly open: (section: AuthoringSection, mode: 'draft' | 'improve', focus?: boolean) => void;
  readonly edit: (key: string, field: 'notes' | 'changes' | 'proposal', value: string) => void;
  readonly editProposal: (key: string) => void;
  readonly askForChanges: (key: string) => void;
  readonly reconcile: (key: string) => void;
  readonly generate: (key: string, retry?: boolean) => void;
  readonly accept: (key: string) => void;
  readonly reject: (key: string) => void;
  readonly focusRequest: number;
  readonly claimFocus: (key: string) => boolean;
}
const WritingContext = createContext<WritingContextValue | null>(null);
export interface WritingAssistantProviderProps {
  readonly draft: ProcedureVersionView;
  readonly rowVersion: string;
  readonly onRowVersion: (token: string) => void;
  readonly children: ReactNode;
  readonly actions: WritingAssistantActions;
  readonly onAccepted?: (section: AuthoringSection) => void;
}

export function WritingAssistantProvider(props: WritingAssistantProviderProps): React.JSX.Element {
  return <WritingAssistantSession key={`${props.draft.procedureId}:${props.draft.versionId}`} {...props} />;
}

function WritingAssistantSession({ draft, rowVersion, onRowVersion, children, actions, onAccepted }: WritingAssistantProviderProps): React.JSX.Element {
  const [machine] = useState(createWritingAssistantState);
  const [snapshot, setSnapshot] = useState(machine.snapshot);
  const [focusRequest, setFocusRequest] = useState(0);
  const requestedFocus = useRef<string | null>(null);
  const mounted = useRef(true);
  const latest = useRef({ draft, rowVersion, onRowVersion, actions, onAccepted });
  latest.current = { draft, rowVersion, onRowVersion, actions, onAccepted };
  const guard = useSubmissionGuard();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const publish = () => { if (mounted.current) setSnapshot(machine.snapshot); };
  useEffect(() => { if (machine.observe(draft)) publish(); }, [draft, machine]);
  // Generation owns no editor and does not block submission. A content acceptance does.
  useSectionSubmissionStatus('Writing suggestion', {
    status: () => ({ dirty: false, conflict: false, pending: machine.snapshot.accepting || machine.snapshot.acceptanceUnknown }),
  }, snapshot.accepting, snapshot.acceptanceUnknown);

  function canGenerate(key: string): boolean {
    const reason = latest.current.draft.state !== 'DRAFT' ? 'Only a Draft can use writing help.' : undefined;
    if (reason) { machine.notice(key, { tone: 'warning', title: reason }); publish(); return false; }
    return true;
  }

  function canAccept(key: string): boolean {
    const reason = latest.current.draft.state !== 'DRAFT' ? 'Only a Draft can use writing help.'
      : machine.snapshot.acceptanceUnknown ? 'Reload to inspect the unknown save outcome before using writing help.'
      : guard.check();
    if (reason) { machine.notice(key, { tone: 'warning', title: reason }); publish(); return false; }
    return true;
  }

  async function generate(key: string, retry = false): Promise<void> {
    const session = machine.snapshot.sessions.get(key);
    if (!session || !canGenerate(key)) return;
    const current = latest.current;
    const revision = writingRevisionFor(session);
    const request = retry ? session.request : {
      procedureId: current.draft.procedureId, versionId: current.draft.versionId, expectedRowVersion: current.rowVersion,
      requestId: crypto.randomUUID(), section: session.section, mode: session.mode, notes: session.notes, changes: session.changes,
      ...(revision === undefined ? {} : { revision }),
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
    if (!session || !canAccept(key)) return;
    if (writingSuggestionIsStale(session, latest.current.draft)) {
      machine.notice(key, { tone: 'warning', title: STALE_SUGGESTION }); publish(); return;
    }
    if (!session.proposal.trim() || session.proposal.length > writingProposalLimit(session.section) || !session.request || !machine.beginAccept(key)) return;
    publish();
    const current = latest.current;
    try {
      const outcome = await current.actions.accept({ procedureId: current.draft.procedureId, versionId: current.draft.versionId,
        expectedRowVersion: current.rowVersion, requestId: session.request.requestId, replacement: session.proposal });
      if (!mounted.current) return;
      machine.finishAccept(key, outcome.ok ? 'accepted' : 'failed', outcome.ok ? undefined : outcome.reason);
      if (outcome.ok) { current.onRowVersion(outcome.rowVersion); latest.current.onAccepted?.(session.section); }
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
    open(section, mode, focus = true) { machine.open(section, mode, savedWritingText(latest.current.draft, section)); publish(); if (focus) { requestedFocus.current = writingSectionKey(section); setFocusRequest(count => count + 1); } },
    claimFocus(key) { if (requestedFocus.current !== key) return false; requestedFocus.current = null; return true; },
    edit(key, field, value) { machine.edit(key, field, value); publish(); },
    editProposal(key) { machine.editProposal(key); publish(); },
    askForChanges(key) { machine.askForChanges(key); publish(); },
    reconcile(key) { machine.reconcile(key); publish(); },
    generate(key, retry) { void generate(key, retry); }, accept(key) { void accept(key); }, reject(key) { void reject(key); },
  }}><UnknownSaveOutcome visible={snapshot.acceptanceUnknown} />{children}</WritingContext.Provider>;
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

export interface WritingAssistantPanelProps {
  /** A central guided surface can pin the panel to its own section session. */
  readonly section?: AuthoringSection;
  /** Inline panels share the explicit-button focus request; automatic entry has none. */
  readonly inline?: boolean;
  /** The question is derived from the saved section and shown before the first answer. */
  readonly guidedQuestion?: string;
}

export function WritingAssistantPanel({ section, inline = false, guidedQuestion }: WritingAssistantPanelProps = {}): React.JSX.Element | null {
  const assistant = useContext(WritingContext), id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const focusRequest = assistant?.focusRequest ?? 0;
  const panelKey = section === undefined ? assistant?.snapshot.selected : writingSectionKey(section);
  useEffect(() => {
    if (focusRequest === 0 || !heading.current || !panelKey || !assistant?.claimFocus(panelKey)) return;
    // The existing section-help disclosure belongs to the reader until they ask for help.
    const disclosure = heading.current.closest('details');
    if (disclosure) disclosure.open = true;
    heading.current.focus();
  }, [focusRequest, panelKey]);
  if (!assistant) return null;
  const { snapshot, draft } = assistant;
  const key = section === undefined ? snapshot.selected : writingSectionKey(section);
  const session = key === null ? undefined : snapshot.sessions.get(key);
  const className = `ls-writing ls-stack${inline ? ' ls-writing--inline' : ''}`;
  const guided = guidedQuestion !== undefined;
  if (!session || key === null) return <section className={className} aria-labelledby={`${id}-heading`} data-writing-section={key ?? undefined}>
    <h3 className="ls-guided__help-title" id={`${id}-heading`} tabIndex={-1} ref={heading}>{guided ? 'Section assistant' : 'Writing help'}</h3>
    {guidedQuestion ? <p className="ls-writing__question" data-writing-question>{guidedQuestion}</p> : null}
    <p className="ls-caption">{guidedQuestion ? 'Give a rough answer. I’ll prepare a proposal for this section and ask you to check it before saving.' : 'Choose Help Me Write beside an objective, scope note or audit step. Your notes stay separate until you choose Use this draft.'}</p>
  </section>;

  const suggestion = session.suggestion, stale = writingSuggestionIsStale(session, draft);
  const pending = session.busy === 'generation', retry = session.generationUncertain || suggestion?.state === 'pending';
  const terminal = suggestion?.state === 'accepted' || suggestion?.state === 'rejected';
  const fieldsLocked = session.busy !== null || retry || snapshot.acceptanceUnknown;
  // Manual editor dirtiness must not prevent a request grounded in the last saved
  // context. It still blocks acceptance below through the full submission guard.
  const generationReason = draft.state !== 'DRAFT' ? 'Only a Draft can use writing help.'
    : snapshot.acceptanceUnknown ? 'Reload to inspect the unknown save outcome before using writing help.'
    : session.busy !== null ? 'Wait for this writing request to finish.' : undefined;
  const acceptanceReason = draft.state !== 'DRAFT' ? 'Only a Draft can use writing help.'
    : snapshot.acceptanceUnknown ? 'Reload to inspect the unknown save outcome before using writing help.'
    : session.busy !== null ? 'Wait for this writing request to finish.' : assistant.guardReason ?? undefined;
  const generateReason = generationReason ?? (session.askingForChanges ? (session.changes.trim() === '' ? 'Describe the changes you want first.' : undefined)
    : session.notes.trim() === '' ? 'Add a rough answer for this section first.' : undefined);
  const acceptReason = acceptanceReason ?? (stale ? STALE_SUGGESTION : suggestion?.state !== 'ready' ? 'A prepared draft is needed before it can be used.'
    : !session.proposal.trim() ? 'The proposed replacement cannot be empty.'
    : session.proposal.length > writingProposalLimit(session.section) ? `Shorten the proposal to ${writingProposalLimit(session.section).toLocaleString('en-US')} characters before using it.` : undefined);
  const comparisonCurrent = savedWritingText(draft, session.section);
  const difference = writingDifference(comparisonCurrent, session.proposal);
  const notesLabel = `Rough notes for ${sectionLabel(draft, session.section)}`;
  const notesReadOnly = fieldsLocked;

  if (guided) {
    const ready = suggestion?.state === 'ready';
    const hasReply = ready || session.history.length > 0 || pending || retry;
    const retryingCorrection = !ready && session.mode === 'revise' && session.request?.revision !== undefined;
    const correctionReason = generationReason ?? (session.changes.trim() === '' ? 'Add your reply first.' : undefined);
    const proposalTitle = session.section.kind === 'instructions' ? 'Proposed test steps — not saved' : 'Proposed wording — not saved';
    const send = <Button type="button" variant="primary" busy={pending}
      disabledReason={ready ? correctionReason : generateReason} onClick={() => assistant.generate(key, retry)}>
      {pending ? 'Preparing a response…' : retry ? 'Retry this request' : ready && suggestion.proposedText !== null ? 'Update draft' : retryingCorrection ? 'Retry reply' : 'Send answer'}
    </Button>;
    return <section className={`${className} ls-writing--dialogue`} aria-labelledby={`${id}-heading`} data-writing-section={key}>
      <h3 className="ls-guided__help-title" id={`${id}-heading`} tabIndex={-1} ref={heading}>Procedure assistant</h3>
      <div className="ls-writing__turn ls-writing__turn--assistant">
        <p className="ls-writing__question" data-writing-question>{guidedQuestion}</p>
        {!session.request ? <p className="ls-caption">Tell me in your own words. I’ll use the saved control and choices to develop a draft for you to check.</p> : null}
      </div>
      {hasReply || terminal ? <div className="ls-writing__turn ls-writing__turn--auditor"><h4>Your answer</h4><p>{session.request?.notes ?? session.notes}</p></div> : null}
      {session.history.length > 0 ? <ol className="ls-writing__conversation" aria-label="Earlier proposals and your corrections">
        {session.history.map(entry => <li key={entry.requestId} className="ls-stack">
          <div className="ls-writing__turn ls-writing__turn--assistant"><h4>Earlier response</h4>
            <p>{entry.proposal ?? entry.clarifications.join(' ')}</p>
          </div>
          {entry.feedback ? <div className="ls-writing__turn ls-writing__turn--auditor"><h4>Your correction</h4><p>{entry.feedback}</p></div> : null}
        </li>)}
      </ol> : null}
      {session.notice ? <Banner tone={session.notice.tone} title={session.notice.title} /> : null}
      {assistant.guardReason && !stale && !terminal ? <Banner tone="info" title="Using the last saved procedure as context. Save or reset manual changes before accepting a proposal." /> : null}
      {stale && !terminal ? <Banner tone="warning" title={STALE_SUGGESTION} /> : null}
      {pending ? <Banner tone="info" title="Preparing a response. You can still write, edit and save the procedure yourself." /> : null}
      {suggestion?.state === 'pending' && !pending ? <Banner tone="info" title="This request is still being prepared. Retry this request to check its result." /> : null}
      {ready ? <div className="ls-writing__turn ls-writing__turn--assistant ls-stack" data-current-assistant-response>
        {suggestion.explanation ? <p>{suggestion.explanation}</p> : null}
        {suggestion.proposedText === null ? <>
          <h4 className="ls-writing__proposal-question">{suggestion.clarifications[0]}</h4>
          {suggestion.clarifications.length > 1 ? <p className="ls-caption">Other questions from this earlier response: {suggestion.clarifications.slice(1).join(' ')}</p> : null}
        </> : <>
          <h4 className="ls-writing__proposal-question">{proposalTitle}</h4>
          {session.editing ? <div className="ls-dialog__field"><label htmlFor={`${id}-proposal`}>Edit proposed replacement</label>
            <textarea className="ls-input ls-writing__notes" id={`${id}-proposal`} value={session.proposal} maxLength={writingProposalLimit(session.section)} readOnly={fieldsLocked}
              onChange={event => assistant.edit(key, 'proposal', event.target.value)} />
          </div> : <p className="ls-writing__text">{session.proposal}</p>}
          <details className="ls-writing__comparison-disclosure" open>
            <summary>Compare with saved wording</summary>
            <div className="ls-writing__comparison">
              <div className="ls-writing__version"><h4>Current saved content</h4><p className="ls-writing__text">{comparisonCurrent ? <>{difference.before}{difference.removed ? <del>{difference.removed}</del> : null}{difference.after}</> : 'No saved wording yet.'}</p></div>
              <div className="ls-writing__version"><h4>Proposed changes</h4><p className="ls-writing__text">{difference.before}{difference.added ? <ins>{difference.added}</ins> : null}{difference.after}</p></div>
            </div>
          </details>
          <p><strong>Does this sound right?</strong> Check the steps, quantities, timing and criteria. Use this draft saves the wording; section review is a separate decision below.</p>
          {acceptReason ? <p className="ls-caption" id={`${id}-accept-reason`}>{acceptReason}</p> : null}
          <div className="ls-actions">
            <Button type="button" variant="primary" busy={session.busy === 'acceptance'} disabledReason={acceptReason} disabledReasonId={`${id}-accept-reason`} onClick={() => assistant.accept(key)}>Use this draft</Button>
            <Button type="button" disabledReason={fieldsLocked ? acceptanceReason ?? 'Retry this request first.' : undefined} onClick={() => assistant.editProposal(key)}>Edit</Button>
          </div>
        </>}
      </div> : null}
      {!terminal && !stale ? <div className="ls-writing__composer ls-stack">
        {ready ? <div className="ls-dialog__field">
          <label htmlFor={`${id}-changes`}>Your reply</label>
          <textarea className="ls-input ls-writing__notes" id={`${id}-changes`} value={session.changes} maxLength={WRITING_LIMITS.changes} readOnly={fieldsLocked}
            aria-describedby={`${id}-changes-help`} onChange={event => {
              assistant.askForChanges(key);
              assistant.edit(key, 'changes', event.target.value);
            }} />
          <p className="ls-caption" id={`${id}-changes-help`}>{suggestion.proposedText === null ? 'Answer the question in your own words.' : 'Tell me exactly what to keep, remove, add or change. I’ll revise the working draft, including your edits.'} Up to 2,000 characters.</p>
        </div> : !pending && !retry && !retryingCorrection ? <div className="ls-dialog__field">
          <label htmlFor={`${id}-notes`}>Your answer</label>
          <textarea className="ls-input ls-writing__notes" id={`${id}-notes`} value={session.notes} maxLength={WRITING_LIMITS.notes} readOnly={notesReadOnly}
            aria-describedby={`${id}-notes-help`} onChange={event => assistant.edit(key, 'notes', event.target.value)} />
          <p className="ls-caption" id={`${id}-notes-help`}>A rough answer is enough. Up to 8,000 characters. Nothing is saved or marked reviewed when you send it.</p>
        </div> : null}
        <div className="ls-actions">{send}</div>
      </div> : null}
      {stale && session.busy === null && !terminal ? <Button type="button" disabledReason={snapshot.acceptanceUnknown ? acceptanceReason : undefined} onClick={() => assistant.reconcile(key)}>Start again with this suggestion</Button> : null}
      {session.request && !terminal && !pending ? <Button type="button" busy={session.busy === 'rejection'} disabledReason={session.busy !== null || snapshot.acceptanceUnknown ? acceptanceReason : undefined} onClick={() => assistant.reject(key)}>Keep my wording</Button> : null}
      {terminal ? <>
        <div className="ls-writing__turn"><h4>Saved wording</h4><p>{comparisonCurrent || 'No wording saved yet.'}</p></div>
        <Button type="button" disabledReason={generationReason} onClick={() => assistant.reconcile(key)}>Continue refining</Button>
      </> : null}
    </section>;
  }

  return <section className={className} aria-labelledby={`${id}-heading`} data-writing-section={key}>
    <h3 className="ls-guided__help-title" id={`${id}-heading`} tabIndex={-1} ref={heading}>{session.section.kind === 'instructions' ? 'Test design assistant' : `Writing help: ${sectionLabel(draft, session.section)}`}</h3>
    {guidedQuestion ? <p className="ls-writing__question" data-writing-question>{guidedQuestion}</p> : null}
    <p className="ls-caption">{session.mode === 'improve' ? 'Improve the clarity of your saved wording. Check that the meaning and scope stay faithful.' : guided ? 'I’ll use the saved control, scope, systems, evidence and criteria. Give me a rough answer, then check my proposal and tell me what to keep or change.' : 'Describe the work in your own words. Writing help will use the saved procedure as context.'} Nothing is saved or marked reviewed when a suggestion is generated.</p>
    {assistant.guardReason && !stale && !terminal ? <Banner tone="info" title="Using the last saved procedure as context. Save or reset manual changes before accepting a proposal." /> : null}
    {session.notice ? <Banner tone={session.notice.tone} title={session.notice.title} /> : null}
    {stale && !terminal ? <Banner tone="warning" title={STALE_SUGGESTION} /> : null}

    <div className="ls-dialog__field">
      <label htmlFor={`${id}-notes`}>{notesLabel}</label>
      <textarea className="ls-input ls-writing__notes" id={`${id}-notes`} value={session.notes} maxLength={WRITING_LIMITS.notes}
        readOnly={notesReadOnly} aria-describedby={`${id}-notes-help`} onChange={event => assistant.edit(key, 'notes', event.target.value)} />
      <p className="ls-caption" id={`${id}-notes-help`}>{guided ? 'A rough answer is enough. The saved assignment is already in context. Up to 8,000 characters.' : 'These notes do not change the procedure. Up to 8,000 characters.'}{retry ? ' Retry uses the original notes and saved context.' : ''}</p>
    </div>

    {session.askingForChanges ? <div className="ls-dialog__field">
      <label htmlFor={`${id}-changes`}>What should change?</label>
      <textarea className="ls-input" id={`${id}-changes`} value={session.changes} maxLength={WRITING_LIMITS.changes} readOnly={fieldsLocked}
        aria-describedby={`${id}-changes-help`} onChange={event => assistant.edit(key, 'changes', event.target.value)} />
      <p className="ls-caption" id={`${id}-changes-help`}>{guided ? 'Say exactly what to keep, drop, add or change direction. Up to 2,000 characters.' : 'Explain the wording to change or answer the open questions. Up to 2,000 characters.'}</p>
    </div> : null}

    {generationReason ? <p className="ls-caption" id={`${id}-guard`}>{generationReason}</p> : null}
    <div className="ls-actions">
      <Button type="button" variant="primary" busy={pending} disabledReason={generateReason} onClick={() => assistant.generate(key, retry)}>
        {pending ? 'Preparing a draft…' : retry ? 'Retry this request' : session.askingForChanges ? 'Prepare revised draft' : 'Prepare draft'}
      </Button>
      {stale && session.busy === null && !terminal ? <Button type="button" disabledReason={snapshot.acceptanceUnknown ? acceptanceReason : undefined} onClick={() => assistant.reconcile(key)}>Start again with this suggestion</Button> : null}
    </div>
    {pending ? <Banner tone="info" title="Preparing this section. You can keep editing and saving the procedure while you wait." /> : null}
    {suggestion?.state === 'pending' && !pending ? <Banner tone="info" title="This request is still being prepared. Retry this request to check its result." /> : null}

    {suggestion && suggestion.clarifications.length > 0 && !terminal ? <div className="ls-writing__questions ls-stack">
      <h4 className="ls-guided__help-title">Questions to resolve</h4>
      <ul>{suggestion.clarifications.map((question, index) => <li key={index}>{question}</li>)}</ul>
      <p className="ls-caption">{guided ? 'Answer the question directly. The next response remains a proposal until you approve it.' : 'Answer these in your notes or ask for changes. Review remains a separate decision.'}</p>
    </div> : null}

    {session.history.length > 0 ? <details className="ls-writing__history">
      <summary>Previous proposals and corrections ({session.history.length})</summary>
      <ol>{session.history.slice(-4).map(entry => <li key={entry.requestId} className="ls-stack">
        {entry.feedback ? <p><strong>Correction:</strong> {entry.feedback}</p> : null}
        {entry.proposal ? <p><strong>Previous proposal:</strong> {entry.proposal}</p> : null}
        {entry.clarifications.length > 0 ? <p><strong>Open question:</strong> {entry.clarifications.join(' ')}</p> : null}
      </li>)}</ol>
    </details> : null}

    {suggestion?.proposedText !== null && suggestion?.proposedText !== undefined && !terminal ? <>
      {guided ? <h4 className="ls-writing__proposal-question">Does this sound right?</h4> : null}
      {suggestion.explanation ? <div className="ls-writing__explanation"><h4 className="ls-guided__help-title">Why this approach</h4><p>{suggestion.explanation}</p></div> : null}
      <p className="ls-caption">Compare the saved content with the proposed replacement. Check quantities, scope, timing and criteria before accepting it.</p>
      <div className="ls-writing__comparison">
        <div className="ls-writing__version ls-stack"><h4 className="ls-guided__help-title">Current saved content</h4>
          <p className="ls-writing__text">{comparisonCurrent ? <>{difference.before}{difference.removed ? <del>{difference.removed}</del> : null}{difference.after}</> : 'No saved wording yet.'}</p>
        </div>
        <div className="ls-writing__version ls-stack"><h4 className="ls-guided__help-title">Proposed replacement — not applied</h4>
          {session.editing ? <div className="ls-dialog__field"><label htmlFor={`${id}-proposal`}>Edit proposed replacement</label>
            <textarea className="ls-input ls-writing__notes" id={`${id}-proposal`} value={session.proposal} maxLength={writingProposalLimit(session.section)} readOnly={fieldsLocked}
              onChange={event => assistant.edit(key, 'proposal', event.target.value)} />
            <p className="ls-caption">Changes here stay in the proposal until you choose Use this draft.</p>
          </div> : <p className="ls-writing__text">{difference.before}{difference.added ? <ins>{difference.added}</ins> : null}{difference.after}</p>}
        </div>
      </div>
      {acceptReason ? <p className="ls-caption" id={`${id}-accept-reason`}>{acceptReason}</p> : null}
      <div className="ls-actions">
        <Button type="button" variant="primary" busy={session.busy === 'acceptance'} disabledReason={acceptReason} disabledReasonId={`${id}-accept-reason`} onClick={() => assistant.accept(key)}>{session.busy === 'acceptance' ? 'Saving draft…' : 'Use this draft'}</Button>
        <Button type="button" disabledReason={fieldsLocked ? acceptanceReason ?? 'Retry this request before editing its result.' : undefined} onClick={() => assistant.editProposal(key)}>Edit</Button>
      </div>
    </> : null}

    {session.request && !terminal && !pending ? <div className="ls-actions">
      {suggestion?.state === 'ready' ? <Button type="button" disabledReason={fieldsLocked ? acceptanceReason ?? 'Retry this request first.' : undefined} onClick={() => assistant.askForChanges(key)}>Ask for changes</Button> : null}
      <Button type="button" busy={session.busy === 'rejection'} disabledReason={session.busy !== null || snapshot.acceptanceUnknown ? acceptanceReason : undefined} onClick={() => assistant.reject(key)}>Keep my wording</Button>
    </div> : null}
    {suggestion?.state === 'accepted' && session.notice === null ? <Banner tone="success" title="This suggestion was already saved. Review the current section before marking it reviewed." /> : null}
    {suggestion?.state === 'rejected' && session.notice === null ? <Banner tone="info" title="This suggestion was dismissed. Your saved wording is unchanged." /> : null}
  </section>;
}

export type PreparationStep = PreparationSectionId | 'review';

function preparationKindLabel(kind: string): string {
  switch (kind) {
    case 'web': return 'web system';
    case 'desktop': return 'desktop system';
    case 'api': return 'API';
    case 'file': return 'file source';
    default: return kind;
  }
}

function preparationPeriodLabel(draft: ProcedureVersionView): string {
  if (draft.period === null) return 'Not saved yet';
  return `${draft.period.from} to ${draft.period.to}`;
}

function savedTemplateSection(draft: ProcedureVersionView, heading: 'Control' | 'Objective'): string {
  return draft.sections.find(section => section.heading === heading)?.content?.trim() || 'Not supplied by the selected Template';
}

/** Readable saved facts are context for the question, never a second editor. */
function PreparationContextSummary({ draft }: { readonly draft: ProcedureVersionView }): React.JSX.Element {
  const source = draft.sourceSnapshot;
  const targets = draft.targets.length === 0 ? 'None selected' : draft.targets.map(target => `${target.displayName} (${preparationKindLabel(target.contract.kind)})`).join(', ');
  const evidence = draft.evidenceRequirements.length === 0 ? 'No specific requirements saved' : draft.evidenceRequirements.map(entry => entry.attributeName).join(', ');
  const criteria = draft.complianceConditions.length === 0 ? 'No criteria saved' : `${draft.complianceConditions.length} saved ${draft.complianceConditions.length === 1 ? 'criterion' : 'criteria'}; agent-judged assessment uses the saved threshold.`;
  return <div className="ls-writing__context" role="group" aria-label="Saved assignment context">
    <dl>
      <div><dt>Control name</dt><dd>{draft.controlName}</dd></div>
      <div><dt>Control statement</dt><dd>{savedTemplateSection(draft, 'Control')}</dd></div>
      <div><dt>Objective</dt><dd>{savedTemplateSection(draft, 'Objective')}</dd></div>
      <div><dt>Period</dt><dd>{preparationPeriodLabel(draft)}</dd></div>
      <div><dt>Population source</dt><dd>{source ? `${source.displayName} (${preparationKindLabel(source.contract.kind)})` : 'Not selected'}</dd></div>
      <div><dt>Selected systems</dt><dd>{targets}</dd></div>
      <div><dt>Evidence to retain</dt><dd>{evidence}</dd></div>
      <div><dt>Assessment</dt><dd>{criteria}</dd></div>
    </dl>
  </div>;
}

function PreparationContextDisclosure({ draft }: { readonly draft: ProcedureVersionView }): React.JSX.Element {
  return <details className="ls-writing__context-disclosure">
    <summary>Saved assignment context</summary>
    <PreparationContextSummary draft={draft} />
  </details>;
}

function preparationQuestion(step: PreparationStep, draft: ProcedureVersionView, targetId: string | null): string {
  if (step === 'scope') {
    return `Which records do you want this test to cover? Describe the population in your own words, including any exclusions. ${draft.sourceSnapshot ? `You have already selected ${draft.sourceSnapshot.displayName}.` : 'We’ll choose the evidence source next.'}`;
  }
  if (step === 'instructions') {
    const target = draft.targets.find(entry => entry.registrationId === targetId);
    const name = target?.displayName ?? 'the selected system';
    if (draft.templateId === 'P-1') return `What do you want to establish about the leavers’ access in ${name}? Give me your intent and I’ll develop the test steps using the control and evidence you selected.`;
    if (draft.templateId === 'P-4') return `What do you want this check of ${name} to establish? I have the selected control and baseline criteria. Tell me your intent and I’ll propose the test steps.`;
    return `What do you want to establish about this control in ${name}? A rough description is enough. I’ll use the saved evidence and criteria to propose the test steps.`;
  }
  return 'Read the saved assignment and plan. What, if anything, should be clarified before you mark the whole procedure reviewed?';
}

export interface PreparationAssistantProps {
  readonly step: PreparationStep;
}

/**
 * The central guided surface used above Scope and Audit Steps editors. It opens only a
 * local session when its step becomes current; it never requests a model response on
 * entry and never writes a form. Context, Evidence, Assessment and Frequency retain
 * their manual paths, while Review is deliberately read-only.
 */
export function PreparationAssistant({ step }: PreparationAssistantProps): React.JSX.Element | null {
  const assistant = useContext(WritingContext);
  const draft = assistant?.draft;
  const openRef = useRef(assistant?.open);
  openRef.current = assistant?.open;
  const initialTarget = assistant?.snapshot.lastInstructionTarget ?? null;
  const [instructionTargetId, setInstructionTargetId] = useState<string | null>(initialTarget);
  const agentTargets = draft?.targets.filter(target => isAgentDrivenKind(target.contract.kind)) ?? [];
  const targetKey = agentTargets.map(target => target.registrationId).join('|');
  const selectedInstructionSession = assistant?.snapshot.selected?.startsWith('instructions:')
    ? assistant.snapshot.selected.slice('instructions:'.length) : null;
  const selectedInstructionKey = selectedInstructionSession !== null && agentTargets.some(target => target.registrationId === selectedInstructionSession)
    ? selectedInstructionSession : instructionTargetId;
  const versionId = draft?.versionId ?? '';

  useEffect(() => {
    if (step === 'scope') {
      if (assistant?.snapshot.selected !== 'scope') openRef.current?.({ kind: 'scope' }, 'draft', false);
      return;
    }
    if (step !== 'instructions') return;
    const fallback = agentTargets[0]?.registrationId ?? null;
    const chosen = selectedInstructionKey !== null && agentTargets.some(target => target.registrationId === selectedInstructionKey)
      ? selectedInstructionKey : fallback;
    if (chosen !== instructionTargetId) setInstructionTargetId(chosen);
    if (chosen !== null && assistant?.snapshot.selected !== `instructions:${chosen}`) openRef.current?.({ kind: 'instructions', registrationId: chosen }, 'draft', false);
  }, [step, targetKey, versionId, instructionTargetId, selectedInstructionKey, assistant?.snapshot.selected]);

  if (!assistant || !draft) return null;
  if (step === 'context') return assistant.snapshot.selected === 'objective'
    ? <WritingAssistantPanel section={{ kind: 'objective' }} inline guidedQuestion="What should this procedure establish that the selected objective does not yet capture?" />
    : <Button type="button" onClick={() => assistant.open({ kind: 'objective' }, 'draft')}>Adjust the objective with the assistant</Button>;
  if (step !== 'scope' && step !== 'instructions' && step !== 'review') return null;
  if (step === 'review') return <section className="ls-writing ls-writing--preparation ls-writing--review ls-stack" aria-labelledby="preparation-review-assistant-heading">
    <h3 className="ls-guided__help-title" id="preparation-review-assistant-heading">Review helper</h3>
    <p className="ls-writing__question" data-writing-question>{preparationQuestion(step, draft, null)}</p>
    <PreparationContextDisclosure draft={draft} />
    <p className="ls-caption">Resolve questions in the saved editors, then review the full plan before marking the procedure reviewed.</p>
  </section>;

  if (step === 'instructions' && agentTargets.length === 0) return <section className="ls-writing ls-writing--preparation ls-stack" aria-labelledby="instructions-assistant-heading">
    <h3 className="ls-guided__help-title" id="instructions-assistant-heading">Audit step assistant</h3>
    <Banner tone="info" title={draft.targets.length === 0 ? 'Choose the systems to inspect in Evidence to review, then return here to prepare the steps.' : 'This Template uses fixed comparison steps. Review the full plan in Review and submission; use Scope and period or Assessment criteria to change the assignment.'} />
    <PreparationContextDisclosure draft={draft} />
  </section>;

  const target = step === 'instructions' ? agentTargets.find(entry => entry.registrationId === selectedInstructionKey) ?? agentTargets[0] : undefined;
  const selectedTargetId = target?.registrationId ?? null;
  const guidedSection: AuthoringSection = step === 'scope' ? { kind: 'scope' } : { kind: 'instructions', registrationId: selectedTargetId! };
  return <div className="ls-writing--preparation">
    {step === 'instructions' ? <div className="ls-writing__target-switcher">
      <label htmlFor="writing-assistant-target">Target system for these steps</label>
      <select id="writing-assistant-target" value={selectedTargetId ?? ''} onChange={event => {
        const next = event.target.value;
        setInstructionTargetId(next);
        openRef.current?.({ kind: 'instructions', registrationId: next }, 'draft', false);
      }}>
        {agentTargets.map(entry => <option key={entry.registrationId} value={entry.registrationId}>{entry.displayName}</option>)}
      </select>
    </div> : null}
    <WritingAssistantPanel section={guidedSection} inline guidedQuestion={preparationQuestion(step, draft, selectedTargetId)} />
    <PreparationContextDisclosure draft={draft} />
  </div>;
}
