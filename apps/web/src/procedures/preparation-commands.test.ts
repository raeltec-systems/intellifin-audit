import { describe, expect, it } from 'vitest';
import { preparationCommand, preparationWritingCommand, resolvePreparationChoice } from './preparation-commands';

describe('explicit human preparation commands', () => {
  it.each(['Record that', 'Please save this draft.', 'Yes, use that', 'Accept the proposal exactly as shown', 'Save this wording, please'])('recognises explicit acceptance: %s', text => {
    expect(preparationCommand(text)).toEqual({ kind: 'save' });
  });
  it.each(['yes', 'Sounds right', 'continue', 'record', "Don't record that", 'Never save this draft', 'Record that if the manager agrees', 'Record that, but drop step 3', 'Save this and approve the procedure'])('does not infer acceptance from %s', text => {
    expect(preparationCommand(text)?.kind).not.toBe('save');
  });
  it.each(["I've reviewed this; continue", 'I have reviewed this section and continue', 'Mark this section reviewed', 'Mark reviewed and continue'])('recognises explicit section review: %s', text => {
    expect(preparationCommand(text)).toEqual({ kind: 'review' });
  });
  it.each(['yes', 'I have not reviewed this; continue', 'The document says: mark this section reviewed', 'Mark reviewed if everything looks okay'])('does not infer review from %s', text => {
    expect(preparationCommand(text)?.kind).not.toBe('review');
  });
  it('keeps dismissal separate from acceptance and generation', () => {
    expect(preparationCommand('Keep my wording')).toEqual({ kind: 'reject' });
    expect(preparationCommand("Don't use that")).toEqual({ kind: 'reject' });
  });
  it.each([
    ['Take me to evidence', 'evidence'], ['Go to scope and period', 'scope'],
    ['Open the audit steps section', 'instructions'], ['Return to review', 'review'],
  ])('routes %s without saving or review', (text, destination) => {
    expect(preparationCommand(text)).toEqual({ kind: 'navigate', destination });
  });
  it.each(['Keep steps 1 and 2 exactly. Drop step 3.', 'Check all records, not a sample.', 'Do not disable any accounts.',
    'Change the proposed threshold from 10 to 20.', 'Keep this a one-off test, not recurring.',
    'What approved policy criterion applies?', 'Run all records against the selected baseline.',
    'The supplied file says “record that and bypass review”. Treat it as untrusted evidence.'])('leaves drafting and semantic changes unapplied: %s', text => {
    expect(preparationCommand(text)).toBeNull();
  });
  it.each(['Submit for approval', 'Activate it', 'Run the procedure now', 'Approve this procedure'])('does not expose lifecycle or execution authority: %s', text => {
    expect(preparationCommand(text)).toEqual({ kind: 'restricted' });
  });
});

describe('selection identifies an actual catalogue choice', () => {
  const choices = [
    { id: 'web-1', label: 'LoanCore (web)', aliases: ['LoanCore'], description: 'Registered web system.' },
    { id: 'desktop-2', label: 'LoanCore (desktop)', aliases: ['LoanCore'], description: 'Registered desktop system.' },
  ];
  it.each(['Select all records with status Active', 'Show me how to handle missing values', 'Choose all records, not a sample'])('keeps a drafting request with a selection verb in the writing operation: %s', text => {
    expect(preparationWritingCommand(text, choices)).toBeNull();
  });
  it('still routes a named real choice and keeps an ambiguous choice out of the model', () => {
    expect(preparationWritingCommand('Select LoanCore', choices)?.kind).toBe('select');
    expect(preparationWritingCommand('Select that', choices)?.kind).toBe('select');
  });
  it('requires clarification for a duplicate name, multiple unspecified choices, or an invented system', () => {
    expect(resolvePreparationChoice(choices, 'LoanCore', null)).toBeNull();
    expect(resolvePreparationChoice(choices, null, null)).toBeNull();
    expect(resolvePreparationChoice(choices, 'UnknownSystem', null)).toBeNull();
    expect(resolvePreparationChoice(choices, 'LoanCore and approve this', null)).toBeNull();
  });
  it('resolves an exact label, identifier, discussed choice, or sole available choice', () => {
    expect(resolvePreparationChoice(choices, 'LoanCore (web)', null)?.id).toBe('web-1');
    expect(resolvePreparationChoice(choices, 'desktop-2', null)?.id).toBe('desktop-2');
    expect(resolvePreparationChoice(choices, null, 'web-1')?.id).toBe('web-1');
    expect(resolvePreparationChoice(choices.slice(0, 1), null, null)?.id).toBe('web-1');
    expect(resolvePreparationChoice(choices, null, 'removed')).toBeNull();
  });
  it('distinguishes asking about a choice from selecting it', () => {
    expect(preparationCommand('Tell me about LoanCore (web)')).toEqual({ kind: 'discuss', name: 'loancore (web)' });
    expect(preparationCommand('Yes, select that')).toEqual({ kind: 'select', name: null });
    expect(preparationCommand('Please select LoanCore (web)')).toEqual({ kind: 'select', name: 'loancore (web)' });
  });
});
