import type { PreparationSectionId } from '@intellifin/domain';

export type PreparationDestination = PreparationSectionId | 'review';
type SimpleCommand = 'save' | 'review' | 'reject' | 'clarify' | 'restricted';
export type PreparationCommand =
  | { [Kind in SimpleCommand]: { readonly kind: Kind } }[SimpleCommand]
  | { readonly kind: 'navigate'; readonly destination: PreparationDestination }
  | { readonly kind: 'select' | 'discuss'; readonly name: string | null };

export const PREPARATION_NAMES: Readonly<Record<PreparationDestination, string>> = {
  context: 'Risk, control and objective', scope: 'Scope and period', evidence: 'Evidence to review',
  instructions: 'Audit steps', assessment: 'Assessment criteria', frequency: 'Frequency and handling', review: 'Review and submission',
};

export function commandWords(value: string): string {
  return value.trim().toLocaleLowerCase('en-GB').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim();
}

const destinations: Readonly<Record<string, PreparationDestination>> = {
  context: 'context', control: 'context', objective: 'context', 'risk and control': 'context', 'risk, control and objective': 'context',
  scope: 'scope', period: 'scope', 'scope and period': 'scope', evidence: 'evidence', 'evidence to review': 'evidence',
  instructions: 'instructions', steps: 'instructions', 'audit steps': 'instructions',
  criteria: 'assessment', 'assessment criteria': 'assessment', assessment: 'assessment',
  frequency: 'frequency', 'frequency and handling': 'frequency', review: 'review', 'review and submission': 'review',
};

/** Only the human's submitted composer message is routed here. This is deliberately
 * full-message matching: an embedded instruction, condition or negation cannot grant
 * consent. Free-form revisions still go to the bounded writing operation. */
export function preparationCommand(message: string): PreparationCommand | null {
  // Punctuation is meaningful consent: “Record that?” asks a question. Keep this
  // check before catalogue/name normalization, which deliberately folds punctuation.
  if (/[?？؟]/u.test(message)) return null;
  if (message.length > 8_000) return { kind: 'clarify' };
  const text = commandWords(message).replace(/^(?:yes[,;]? |okay[,;]? |ok[,;]? )/, '').replace(/^please /, '').replace(/[,;]? please$/, '');
  if (/^(?:save|record|accept|use) (?:that|this|it|the proposal|this proposal|that proposal|this draft|that draft|the draft|this wording|that wording|these steps|the proposed wording)(?: (?:as is|as it is|exactly as shown))?$/.test(text)) return { kind: 'save' };
  if (/^(?:keep my wording|keep the saved wording|discard (?:this|that) draft|(?:don't|do not) use (?:this|that)(?: draft)?)$/.test(text)) return { kind: 'reject' };
  if (/^(?:(?:i have|i've) reviewed (?:this|it|this section)|mark (?:this section|the section|it) reviewed|mark reviewed)(?:[,;]? (?:and )?continue)?$/.test(text)) return { kind: 'review' };
  const navigation = /^(?:take me to|go to|open|show me|return to) (?:the )?(.+?)(?: section)?$/.exec(text);
  if (navigation && destinations[navigation[1]!]) return { kind: 'navigate', destination: destinations[navigation[1]!]! };
  const selection = /^(select|choose|tell me about|show me) (.+)$/.exec(text);
  if (selection) return { kind: selection[1] === 'select' || selection[1] === 'choose' ? 'select' : 'discuss',
    name: /^(?:that|this|that one|this one|it|the suggested (?:source|system|option))$/.test(selection[2]!) ? null : selection[2]! };
  if (/^submit(?: (?:it|this|that|this procedure|the procedure))?(?: for (?:manager )?(?:approval|review))?(?: now)?$/.test(text)
    || /^(?:activate|approve|run|execute)(?: (?:it|this|that|this procedure|the procedure|this run|the run))?(?: now)?$/.test(text)) return { kind: 'restricted' };
  if (/^(?:yes|yeah|yep|ok|okay|correct|sounds (?:good|right)|that's (?:right|correct)|continue|next|save|record|select|choose)$/.test(text)) return { kind: 'clarify' };
  return null;
}

export interface PreparationChoice {
  readonly id: string;
  readonly label: string;
  readonly aliases?: readonly string[];
  /** Non-secret catalogue facts, never a credential or source location. */
  readonly description: string;
}

export function resolvePreparationChoice(choices: readonly PreparationChoice[], name: string | null, focusedId: string | null): PreparationChoice | null {
  const matches = name === null
    ? focusedId === null ? choices : choices.filter(choice => choice.id === focusedId)
    : choices.filter(choice => [choice.label, choice.id, ...(choice.aliases ?? [])].some(label => commandWords(label) === commandWords(name)));
  return matches.length === 1 ? matches[0]! : null;
}

/** In a writing conversation, a selection verb can be audit prose. Only known
 * catalogue names leave drafting; an unspecified “select that” still clarifies. */
export function preparationWritingCommand(message: string, choices: readonly PreparationChoice[]): PreparationCommand | null {
  const command = preparationCommand(message);
  if (command && (command.kind === 'select' || command.kind === 'discuss') && command.name !== null
    && !choices.some(choice => resolvePreparationChoice([choice], command.name, null))) return null;
  return command;
}
