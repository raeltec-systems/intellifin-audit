'use client';

import { createContext, useContext, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AuthoringChat, ChatMessage } from './AuthoringChat';
import { Button } from '../design/Button';
import { Banner } from '../design/Banner';
import { useSubmissionGuard } from './use-section';
import { CHOICES_LISTED_BESIDE, clarifyCommandReply } from './assistant-words';
import { PREPARATION_NAMES, preparationCommand, preparationWritingCommand, resolvePreparationChoice, type PreparationChoice, type PreparationDestination } from './preparation-commands';

export interface PreparationActionResult { readonly ok: boolean; readonly message: string }
export interface PreparationChoices {
  readonly step: PreparationDestination;
  readonly surface: string;
  readonly basis: string;
  readonly active: boolean;
  readonly choices: readonly PreparationChoice[];
  readonly select: (id: string) => Promise<PreparationActionResult>;
  /**
   * `false` when the surface beside the chat already lists the choices as clickable rows
   * (the evidence-source chooser, UX-11), so the chat does not print the whole catalogue
   * a second time. Selection by name still works either way.
   */
  readonly listed?: boolean;
}
interface GuideCommands {
  readonly navigate: (step: PreparationDestination) => void;
  readonly review: (step: PreparationDestination) => Promise<PreparationActionResult>;
}
export interface PreparationActionThread {
  readonly key: string;
  readonly requestId: string | null;
}
export interface ActionTurn {
  readonly id: number;
  readonly step: PreparationDestination;
  readonly thread: PreparationActionThread | null;
  readonly message: string;
  readonly result: PreparationActionResult | null;
}

/** A result belongs to the proposal and target that received the command, never
 * to a later proposal that happens to occupy the same outline section. */
export function preparationActionTurns(turns: readonly ActionTurn[], step: PreparationDestination, thread: PreparationActionThread | null = null): readonly ActionTurn[] {
  return turns.filter(turn => turn.step === step && (thread === null ? turn.thread === null
    : turn.thread?.key === thread.key && turn.thread.requestId === thread.requestId));
}

export function createPreparationActionRegistry() {
  const choices = new Map<string, () => PreparationChoices>();
  const guides = new Map<string, () => GuideCommands>();
  const listeners = new Set<() => void>();
  let focused: { surface: string; basis: string; id: string } | null = null;
  return {
    choices, guides,
    get focused() { return focused; },
    set focused(value: typeof focused) { focused = value; },
    notify() {
      if (focused && ![...choices.values()].some(read => { const item = read(); return item.active && item.surface === focused!.surface && choiceBasis(item) === focused!.basis; })) focused = null;
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot() { return JSON.stringify([...choices.values()].map(read => { const { select: _select, ...facts } = read(); return facts; })); },
  };
}
const choiceBasis = (capability: PreparationChoices): string => `${capability.basis}:${JSON.stringify(capability.choices)}`;
type CommandHandling = 'handled' | 'busy' | 'unhandled';
type RunOptions = {
  readonly step: PreparationDestination;
  readonly surface?: string;
  readonly thread?: PreparationActionThread;
  readonly save?: () => Promise<PreparationActionResult>;
  readonly reject?: () => Promise<PreparationActionResult>;
  readonly hasProposal?: boolean;
};
interface ActionsContextValue {
  readonly registry: ReturnType<typeof createPreparationActionRegistry>;
  readonly turns: readonly ActionTurn[];
  readonly busy: boolean;
  readonly run: (message: string, options: RunOptions) => Promise<CommandHandling>;
}
const ActionsContext = createContext<ActionsContextValue | null>(null);
const noChange = (message: string): PreparationActionResult => ({ ok: false, message });

/** Human-command orchestration only. The model has no execution callback, and no
 * provider text is fed to run(). Every mutation delegates to an existing writer. */
export function PreparationActionsProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [registry] = useState(createPreparationActionRegistry);
  const [turns, setTurns] = useState<readonly ActionTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const gate = useRef(false), sequence = useRef(0);
  const guard = useSubmissionGuard();
  async function run(message: string, options: RunOptions): Promise<CommandHandling> {
    const choices = [...registry.choices.values()].map(read => read()).filter(item => item.active && item.step === options.step).flatMap(item => item.choices);
    const command = options.save ? preparationWritingCommand(message, choices) : preparationCommand(message);
    if (command === null) return 'unhandled';
    if (gate.current) return 'busy';
    gate.current = true; setBusy(true);
    const id = ++sequence.current;
    setTurns(prior => [...prior, { id, step: options.step, thread: options.thread ?? null, message, result: null }].slice(-12));
    let result: PreparationActionResult;
    try {
      const guide = [...registry.guides.values()][0]?.();
      if (command.kind === 'navigate') {
        registry.focused = null;
        if (guide) { guide.navigate(command.destination); result = { ok: true, message: `Opened ${PREPARATION_NAMES[command.destination]}. Your content and review status were not changed.` }; }
        else result = noChange('Section navigation is not available here. Use the procedure outline.');
      } else if (command.kind === 'clarify') result = noChange(clarifyCommandReply(options.hasProposal === true));
      else if (command.kind === 'restricted') result = noChange('Use Review and submission for the procedure approval process. This chat cannot approve, activate or execute a procedure.');
      else if (command.kind === 'save') result = options.save ? await options.save() : noChange('There is no completed writing proposal to save here. Use the section’s editor to prepare a change, or name the source or system you want me to select.');
      else if (command.kind === 'reject') result = options.reject ? await options.reject() : noChange('There is no writing proposal to discard here. Your saved content is unchanged.');
      else if (command.kind === 'review') {
        const reason = guard.check();
        result = options.hasProposal ? noChange('The proposal is still unsaved. Say “record that” or keep your saved wording before reviewing this section.')
          : reason ? noChange(reason) : guide ? await guide.review(options.step) : noChange('Section review is not available here.');
      } else {
        const available = [...registry.choices.values()].map(read => read()).filter(item => item.active && item.step === options.step);
        const capability = available.length === 1 ? available[0] : undefined;
        if (!capability || options.surface !== undefined && capability.surface !== options.surface) result = noChange('Choose records or systems in Evidence to review, then name the option you want. This question has no selectable catalogue option.');
        else {
          const basis = choiceBasis(capability);
          const focusId = registry.focused?.surface === capability.surface && registry.focused.basis === basis ? registry.focused.id : null;
          const choice = resolvePreparationChoice(capability.choices, command.name, focusId);
          if (!choice) result = noChange('Which option do you mean? Use one exact name from the list. If names repeat, use the full label or identifier. Nothing has been selected.');
          else if (command.kind === 'discuss') {
            registry.focused = { surface: capability.surface, basis, id: choice.id };
            result = { ok: true, message: `${choice.label}: ${choice.description} Say “yes, select that” to select this option. It has not been selected by this message.` };
          } else {
            const reason = guard.check();
            result = reason ? noChange(reason) : await capability.select(choice.id);
            if (result.ok) registry.focused = null;
          }
        }
      }
    } catch {
      // The writer owns unknown-outcome recovery. Never turn an exception into a
      // statement that a mutation either definitely succeeded or definitely failed.
      result = noChange('The action could not be confirmed. Check the saved section before trying again.');
    } finally { gate.current = false; setBusy(false); }
    setTurns(prior => prior.map(turn => turn.id === id ? { ...turn, result } : turn));
    return 'handled';
  }
  return <ActionsContext.Provider value={{ registry, turns, busy, run }}>{children}</ActionsContext.Provider>;
}

export function usePreparationActions() { return useContext(ActionsContext); }
export function usePreparationChoices(choices: PreparationChoices): void {
  const context = usePreparationActions(), id = useId(), latest = useRef(choices);
  latest.current = choices;
  const registry = context?.registry;
  useLayoutEffect(() => {
    if (!registry) return;
    registry.choices.set(id, () => latest.current); registry.notify();
    return () => { registry.choices.delete(id); registry.notify(); };
  }, [registry, id]);
  useLayoutEffect(() => { registry?.notify(); });
}
export function usePreparationGuide(guide: GuideCommands): void {
  const context = usePreparationActions(), id = useId(), latest = useRef(guide);
  latest.current = guide;
  useLayoutEffect(() => {
    const registry = context?.registry;
    if (!registry) return;
    registry.guides.set(id, () => latest.current);
    return () => { registry.guides.delete(id); };
  }, [context?.registry, id]);
}
export function PreparationActionMessages({ step, thread = null }: { readonly step: PreparationDestination; readonly thread?: PreparationActionThread | null }): React.JSX.Element {
  const context = usePreparationActions();
  return <>{preparationActionTurns(context?.turns ?? [], step, thread).map(turn => <div key={turn.id} data-preparation-action-turn>
    <ChatMessage from="auditor"><p>{turn.message}</p></ChatMessage>
    <ChatMessage from="assistant" pending={turn.result === null}><p role="status">{turn.result?.message ?? 'Applying your request… Complete any confirmation shown above.'}</p></ChatMessage>
  </div>)}</>;
}

export function PreparationActionFeedback({ step }: { readonly step: PreparationDestination }): React.JSX.Element | null {
  const turn = usePreparationActions()?.turns.at(-1);
  return turn?.result && turn.step !== step ? <Banner tone={turn.result.ok ? 'success' : 'warning'} title={turn.result.message} /> : null;
}

export function PreparationActionPanel({ step, question }: { readonly step: PreparationDestination; readonly question?: string }): React.JSX.Element | null {
  const context = usePreparationActions(), id = useId();
  const [message, setMessage] = useState(''), [notice, setNotice] = useState('');
  const registry = context?.registry;
  useSyncExternalStore(registry?.subscribe ?? (() => () => {}), registry?.snapshot ?? (() => ''), () => '');
  if (!context) return null;
  const available = [...context.registry.choices.values()].map(read => read()).filter(item => item.active && item.step === step);
  const capability = available.length === 1 ? available[0] : undefined;
  const send = async () => {
    if (!message.trim() || context.busy) return;
    const sent = message; setMessage(''); setNotice('');
    const handling = await context.run(sent, { step, ...(capability ? { surface: capability.surface } : {}) });
    if (handling === 'unhandled') {
      setNotice('I can select a named source or system, record your section review, or take you to another section. Use Scope or Audit steps to draft and refine wording with me.');
      setMessage(current => current === '' ? sent : current);
    }
    if (handling === 'busy') setMessage(current => current === '' ? sent : current);
    if (handling === 'handled') setMessage(current => current === sent ? '' : current);
  };
  const composer = <div className="ls-chat__composer">
    <label className="ls-visually-hidden" htmlFor={`${id}-message`}>Your instruction</label>
    <textarea className="ls-input ls-chat__input" id={`${id}-message`} placeholder="Message IntelliFin…" maxLength={2_000}
      value={message} readOnly={context.busy} onChange={event => setMessage(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); } }} />
    <div className="ls-chat__composer-footer"><p className="ls-caption">Name an option, ask to review this section, or tell me where to go.<br />Shift + Enter for a new line.</p>
      <Button type="button" variant="primary" busy={context.busy} disabledReason={message.trim() === '' ? 'Add your instruction first.' : undefined} onClick={() => { void send(); }}>Send message</Button></div>
  </div>;
  return <section className="ls-writing ls-writing--dialogue ls-stack" aria-labelledby={`${id}-heading`} data-preparation-action-panel={step}>
    <div className="ls-chat__header"><h3 id={`${id}-heading`}>Procedure assistant</h3><span className="ls-caption">{PREPARATION_NAMES[step]}</span></div>
    <AuthoringChat busy={context.busy} requestId={String(context.turns.at(-1)?.id ?? '')} composer={composer}>
      <ChatMessage from="assistant"><p>{question ?? 'Tell me which option to select, or say “I’ve reviewed this; continue” when the saved section is correct.'}</p>
        {capability && capability.choices.length > 0 && capability.listed === false ? <p className="ls-caption" data-choices-listed-beside>{CHOICES_LISTED_BESIDE}</p> : null}
        {capability && capability.choices.length > 0 && capability.listed !== false ? <details className="ls-disclosure" open><summary>Available choices</summary>
          <ul>{capability.choices.map(choice => <li key={choice.id}><strong>{choice.label}</strong> — {choice.description}</li>)}</ul>
          <p>Say “select” followed by the name. You can also ask “tell me about” an option first.</p></details> : null}
      </ChatMessage>
      <PreparationActionMessages step={step} />
      {notice ? <ChatMessage from="assistant"><p>{notice}</p></ChatMessage> : null}
    </AuthoringChat>
  </section>;
}
