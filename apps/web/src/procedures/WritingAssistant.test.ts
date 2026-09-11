import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ProcedureVersionView } from '@intellifin/application';
import { draftContext, refreshPreparation } from '@intellifin/domain';
import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import {
  createWritingAssistantState, isWritingResponse, savedWritingText, writingDifference, writingSectionKey, writingSuggestionIsStale,
  PreparationAssistant, WritingAssistantPanel, WritingAssistantProvider, WritingTools, writingRevisionFor,
  type AuthoringDraftFields, type AuthoringSection, type AuthoringSuggestionView, type WritingAssistantActions,
} from './WritingAssistant';
import { BuilderSubmissionProvider } from './use-section';

function view(overrides: Partial<ProcedureVersionView> = {}): ProcedureVersionView {
  return {
    ...executablePlanInputs(), versionId: 'version', procedureId: 'procedure', versionNumber: 1, state: 'DRAFT',
    targetBlockers: [], evidenceBlockers: [], createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
    planCompilerVersion: '1', compiledPlan: null, planDerivable: false, planStatus: 'pending', planFailureReason: null,
    planInputDigest: null, derivationModel: null, planAttempts: [], ...overrides,
  };
}
const scope = { kind: 'scope' } as const;
const objective = { kind: 'objective' } as const;
function fields(section: AuthoringSection = scope, requestId = 'request-1'): AuthoringDraftFields {
  return { procedureId: 'procedure', versionId: 'version', expectedRowVersion: 'row-1', requestId,
    section, mode: 'draft', notes: 'Check all production parameters.', changes: '' };
}
function response(request: AuthoringDraftFields, draft: ProcedureVersionView = view(), overrides: Partial<AuthoringSuggestionView> = {}): AuthoringSuggestionView {
  return { requestId: request.requestId, section: request.section, authoringRevision: draft.sectionPreparation?.revision ?? 0,
    currentText: savedWritingText(draft, request.section), proposedText: 'Review all production parameters against the supplied baseline.',
    clarifications: [], state: 'ready', stale: false, message: null, ...overrides };
}

function ready() {
  const machine = createWritingAssistantState(), draft = view(), request = fields();
  machine.open(scope, 'draft', draft.scope);
  machine.edit('scope', 'notes', request.notes);
  machine.begin(request, draft);
  machine.receive(request, response(request, draft), draft);
  return { machine, draft, request };
}

describe('section writing request ownership', () => {
  it('keeps edited proposals and received responses within each saved section limit', () => {
    const machine = createWritingAssistantState();
    for (const [section, limit] of [[objective, 4000], [scope, 10000]] as const) {
      machine.open(section, 'draft', '');
      machine.edit(section.kind, 'proposal', 'x'.repeat(limit + 1));
      expect(machine.snapshot.sessions.get(section.kind)?.proposal).toHaveLength(limit);
      const request = fields(section);
      expect(isWritingResponse(response(request, view(), { proposedText: 'x'.repeat(limit) }), request)).toBe(true);
      expect(isWritingResponse(response(request, view(), { proposedText: 'x'.repeat(limit + 1) }), request)).toBe(false);
    }
  });
  it('keeps a late scope result with scope after the auditor switches to an objective', () => {
    const machine = createWritingAssistantState(), draft = view(), scopeRequest = fields(), objectiveRequest = fields(objective, 'objective-request');
    machine.open(scope, 'draft', draft.scope);
    expect(machine.begin(scopeRequest, draft)).toBe(true);
    expect(machine.begin({ ...scopeRequest, requestId: 'second-click' }, draft)).toBe(false);
    machine.open(objective, 'improve', savedWritingText(draft, objective));
    expect(machine.begin(objectiveRequest, draft)).toBe(true);
    machine.receive(scopeRequest, response(scopeRequest), draft);
    expect(machine.snapshot.selected).toBe('objective');
    expect(machine.snapshot.sessions.get('objective')?.suggestion).toBeNull();
    expect(machine.snapshot.sessions.get('objective')?.busy).toBe('generation');
    expect(machine.snapshot.sessions.get('scope')?.suggestion?.requestId).toBe(scopeRequest.requestId);
    expect(machine.snapshot.accepting).toBe(false);
    expect(machine.snapshot.acceptanceUnknown).toBe(false);
  });

  it('never attaches a mismatched section response and ignores superseded responses', () => {
    const { machine, draft, request } = ready();
    const newer = fields(scope, 'newer-request');
    machine.begin(newer, draft);
    machine.receive(request, response(request, draft, { proposedText: 'An old suggestion' }), draft);
    expect(machine.snapshot.sessions.get('scope')?.suggestion).toBeNull();
    machine.receive(newer, response(newer, draft, { section: objective }), draft);
    expect(machine.snapshot.sessions.get('scope')?.suggestion).toBeNull();
    expect(machine.snapshot.sessions.get('scope')?.generationUncertain).toBe(true);
    expect(machine.snapshot.sessions.get('scope')?.notice?.title).toContain('could not be read');
  });

  it('retries an uncertain generation with the identical original payload despite newer saved context', () => {
    const machine = createWritingAssistantState(), draft = view(), original = fields();
    machine.open(scope, 'draft', draft.scope);
    machine.edit('scope', 'notes', original.notes);
    machine.begin(original, draft);
    machine.fail(original);
    machine.edit('scope', 'notes', 'A changed idea');
    machine.open(scope, 'improve', 'A newer saved scope');
    const session = machine.snapshot.sessions.get('scope')!;
    expect(session.notes).toBe(original.notes);
    expect(session.request).toBe(original);
    expect(machine.begin({ ...original, expectedRowVersion: 'row-2' }, draft)).toBe(false);
    expect(machine.begin(original, { ...draft, scope: 'A newer saved scope' })).toBe(true);
    expect(machine.snapshot.sessions.get('scope')?.request).toBe(original);
    expect(machine.snapshot.sessions.get('scope')?.basisText).toBe(draft.scope);
    machine.receive(original, response(original), { ...draft, scope: 'A newer saved scope' });
    expect(machine.snapshot.sessions.get('scope')?.stale).toBe(true);
    expect(machine.beginAccept('scope')).toBe(false);
  });

  it('treats a pending server result as the same request to check again', () => {
    const machine = createWritingAssistantState(), draft = view(), request = fields();
    machine.open(scope, 'draft', draft.scope);
    machine.begin(request, draft);
    machine.receive(request, response(request, draft, { state: 'pending', proposedText: null }), draft);
    expect(machine.snapshot.sessions.get('scope')?.busy).toBeNull();
    expect(machine.begin(fields(scope, 'a-new-call'), draft)).toBe(false);
    expect(machine.begin(request, draft)).toBe(true);
    expect(machine.snapshot.accepting).toBe(false);
  });

  it('keeps provider failure separate from saved content and from pending acceptance', () => {
    const machine = createWritingAssistantState(), draft = view(), request = fields();
    machine.open(scope, 'draft', draft.scope);
    machine.begin(request, draft);
    machine.receive(request, response(request, draft, { state: 'failed', proposedText: null, message: 'Writing help is not configured.' }), draft);
    const session = machine.snapshot.sessions.get('scope')!;
    expect(session.proposal).toBe('');
    expect(session.notice?.title).toContain('not configured');
    expect(session.notice?.title).toContain('still edit and save');
    expect(machine.snapshot.accepting).toBe(false);
    expect(machine.beginAccept('scope')).toBe(false);
    expect(draft.scope).toBe('All production parameters');
  });

  it('refuses malformed or unbounded responses while preserving manual work', () => {
    const request = fields(), valid = response(request);
    expect(isWritingResponse(valid, request)).toBe(true);
    for (const invalid of [null, { ...valid, state: 'complete' }, { ...valid, authoringRevision: -1 },
      { ...valid, proposedText: 'x'.repeat(10_001) }, { ...valid, proposedText: { text: 'Nested output' } },
      { ...valid, clarifications: ['A question mixed into an applicable draft'] }, { ...valid, currentText: null }]) {
      expect(isWritingResponse(invalid, request)).toBe(false);
      const machine = createWritingAssistantState(), draft = view();
      machine.open(scope, 'draft', draft.scope);
      machine.begin(request, draft);
      machine.receive(request, invalid, draft);
      expect(machine.snapshot.sessions.get('scope')?.suggestion).toBeNull();
      expect(machine.snapshot.sessions.get('scope')?.busy).toBeNull();
      expect(machine.snapshot.accepting).toBe(false);
      expect(draft.scope).toBe('All production parameters');
    }
    expect(isWritingResponse({ ...valid, proposedText: null, clarifications: ['Which period should be tested?'] }, request)).toBe(true);
  });
});

describe('draft comparison and acceptance', () => {
  it('remembers the last instruction target when another preparation section is opened', () => {
    const machine = createWritingAssistantState();
    machine.open({ kind: 'instructions', registrationId: 'first-target' }, 'draft', '');
    machine.open({ kind: 'instructions', registrationId: 'second-target' }, 'draft', '');
    machine.open(scope, 'draft', '');
    expect(machine.snapshot.selected).toBe('scope');
    expect(machine.snapshot.lastInstructionTarget).toBe('second-target');
    expect(machine.snapshot.sessions.has('instructions:second-target')).toBe(true);
  });
  it('initializes improvement from the selected saved objective, scope or registered system', () => {
    const draft = view(), machine = createWritingAssistantState();
    const target = { kind: 'instructions' as const, registrationId: draft.targets[0]!.registrationId };
    expect(savedWritingText(draft, objective)).toBe(draftContext(draft.sections).objective);
    expect(savedWritingText(draft, scope)).toBe('All production parameters');
    expect(savedWritingText(draft, target)).toBe('Read all baseline parameters.');
    for (const section of [objective, scope, target]) {
      machine.open(section, 'improve', savedWritingText(draft, section));
      expect(machine.snapshot.sessions.get(writingSectionKey(section))?.notes).toBe(savedWritingText(draft, section));
    }
    expect(savedWritingText(draft, { kind: 'instructions', registrationId: 'another-system' })).toBe('');
  });

  it('does not invalidate a proposal for a worker update, but catches edits, reversals and submission', () => {
    const { machine, draft } = ready(), session = machine.snapshot.sessions.get('scope')!;
    expect(writingSuggestionIsStale(session, { ...draft, planFailureReason: 'A worker-only update', updatedAt: '2026-09-11T01:00:00.000Z' })).toBe(false);
    expect(writingSuggestionIsStale(session, { ...draft, scope: 'Only sampled parameters' })).toBe(true);
    const preparation = refreshPreparation(draft);
    expect(writingSuggestionIsStale(session, { ...draft, sectionPreparation: { ...preparation, revision: 2 } })).toBe(true);
    expect(writingSuggestionIsStale(session, { ...draft, state: 'SUBMITTED' })).toBe(true);
    expect(writingSuggestionIsStale({ ...session, suggestion: { ...session.suggestion!, stale: true } }, draft)).toBe(true);
    machine.observe({ ...draft, sectionPreparation: { ...preparation, revision: 2 } });
    machine.observe(draft); // An older refresh must not revive a request already observed as stale.
    expect(machine.snapshot.sessions.get('scope')?.stale).toBe(true);
    expect(machine.beginAccept('scope')).toBe(false);
  });

  it('edits a proposal without changing saved content, then registers only explicit acceptance as a save', () => {
    const { machine, draft } = ready();
    machine.editProposal('scope');
    machine.edit('scope', 'proposal', 'Inspect all production parameters.');
    expect(draft.scope).toBe('All production parameters');
    expect(machine.snapshot.accepting).toBe(false);
    expect(machine.beginAccept('scope')).toBe(true);
    expect(machine.beginAccept('scope')).toBe(false);
    expect(machine.snapshot.accepting).toBe(true);
    machine.edit('scope', 'proposal', 'An edit during saving');
    expect(machine.snapshot.sessions.get('scope')?.proposal).toBe('Inspect all production parameters.');
    machine.finishAccept('scope', 'accepted');
    expect(machine.snapshot.accepting).toBe(false);
    expect(machine.snapshot.sessions.get('scope')?.suggestion?.state).toBe('accepted');
    expect(machine.snapshot.sessions.get('scope')?.notice?.title).toContain('then mark it reviewed');
    expect(machine.beginAccept('scope')).toBe(false);
  });

  it('keeps an uncertain content acceptance blocked across section switches', () => {
    const { machine, draft } = ready();
    machine.beginAccept('scope');
    machine.finishAccept('scope', 'unknown');
    machine.open(objective, 'improve', savedWritingText(draft, objective));
    expect(machine.snapshot.acceptanceUnknown).toBe(true);
    expect(machine.beginAccept('scope')).toBe(false);
    expect(machine.begin(fields(objective), draft)).toBe(false);
    machine.reconcile('scope');
    expect(machine.snapshot.sessions.get('scope')?.suggestion?.state).toBe('ready');
  });

  it('keeps the original rough answer and sends the full edited proposal as revision context', () => {
    const { machine, draft, request } = ready();
    machine.edit('scope', 'proposal', 'Check every production parameter.');
    machine.askForChanges('scope');
    machine.edit('scope', 'changes', 'Keep every parameter in scope and use shorter sentences.');
    machine.open(objective, 'draft', savedWritingText(draft, objective));
    machine.open(scope, 'draft', draft.scope);
    const session = machine.snapshot.sessions.get('scope')!;
    expect(session.mode).toBe('revise');
    expect(session.notes).toBe('Check all production parameters.');
    expect(writingRevisionFor(session)).toEqual({ requestId: request.requestId, draft: 'Check every production parameter.' });
    const next = { ...fields(scope, 'revised-request'), mode: session.mode, notes: session.notes, changes: session.changes };
    expect(machine.begin(next, draft)).toBe(true);
    expect(machine.snapshot.sessions.get('scope')?.request).not.toBe(request);
    expect(machine.snapshot.sessions.get('scope')?.request?.changes).toContain('every parameter');
  });

  it('keeps an edited ten-thousand-character proposal intact for a revision', () => {
    const { machine, request } = ready();
    const proposal = 'p'.repeat(10_000);
    machine.edit('scope', 'proposal', proposal);
    machine.askForChanges('scope');
    const session = machine.snapshot.sessions.get('scope')!;
    expect(session.notes).toBe(request.notes);
    expect(writingRevisionFor(session)).toEqual({ requestId: request.requestId, draft: proposal });
  });

  it('retains at most four previous proposal and correction entries', () => {
    const machine = createWritingAssistantState(), draft = view();
    machine.open(scope, 'draft', draft.scope);
    let prior = fields(scope, 'request-0');
    machine.edit('scope', 'notes', prior.notes);
    machine.begin(prior, draft);
    machine.receive(prior, response(prior, draft, { explanation: 'First approach.' }), draft);
    for (let index = 1; index <= 5; index += 1) {
      machine.askForChanges('scope');
      machine.edit('scope', 'changes', `Keep the saved assignment; correction ${index}.`);
      const next = { ...fields(scope, `request-${index}`), mode: 'revise' as const, notes: machine.snapshot.sessions.get('scope')!.notes,
        changes: machine.snapshot.sessions.get('scope')!.changes, revision: writingRevisionFor(machine.snapshot.sessions.get('scope')!) };
      expect(machine.begin(next, draft)).toBe(true);
      machine.receive(next, response(next, draft, { proposedText: `Proposal ${index}` }), draft);
      prior = next;
    }
    const history = machine.snapshot.sessions.get('scope')!.history;
    expect(history).toHaveLength(4);
    expect(history[0]?.proposal).toBe('Proposal 1');
    expect(history.at(-1)?.feedback).toContain('correction 5');
  });

  it('allows reconciliation and rejection without applying any text', () => {
    const { machine, draft } = ready();
    const proposal = machine.snapshot.sessions.get('scope')!.proposal;
    machine.reconcile('scope');
    expect(machine.snapshot.sessions.get('scope')?.notes).toBe(proposal);
    expect(machine.snapshot.sessions.get('scope')?.request).toBeNull();
    expect(machine.snapshot.sessions.get('scope')?.suggestion).toBeNull();
    expect(draft.scope).toBe('All production parameters');
    const request = fields(scope, 'next-request');
    machine.begin(request, draft);
    machine.receive(request, response(request), draft);
    expect(machine.beginReject('scope')).toBe(true);
    expect(machine.snapshot.accepting).toBe(false);
    machine.finishReject('scope');
    expect(machine.snapshot.sessions.get('scope')?.suggestion?.state).toBe('rejected');
    expect(draft.scope).toBe('All production parameters');
  });

  it('bounds notes, feedback and proposal without silently shortening long improvement notes', () => {
    const machine = createWritingAssistantState();
    machine.open(scope, 'improve', 'x'.repeat(10_000));
    expect(machine.snapshot.sessions.get('scope')?.notes).toHaveLength(8_000);
    expect(machine.snapshot.sessions.get('scope')?.notice?.title).toContain('first 8,000');
    machine.edit('scope', 'notes', 'n'.repeat(8_001));
    machine.edit('scope', 'changes', 'c'.repeat(2_001));
    machine.edit('scope', 'proposal', 'p'.repeat(10_001));
    expect(machine.snapshot.sessions.get('scope')?.notes).toHaveLength(8_000);
    expect(machine.snapshot.sessions.get('scope')?.changes).toHaveLength(2_000);
    expect(machine.snapshot.sessions.get('scope')?.proposal).toHaveLength(10_000);
  });

  it('validates an optional explanation without allowing an unbounded provider narration', () => {
    const request = fields(), valid = response(request);
    expect(isWritingResponse({ ...valid, explanation: 'I kept the saved scope and added the requested comparison.' }, request)).toBe(true);
    expect(isWritingResponse({ ...valid, explanation: ' ' }, request)).toBe(false);
    expect(isWritingResponse({ ...valid, explanation: 'x'.repeat(2_001) }, request)).toBe(false);
  });

  it('makes a narrowing visible and preserves the exact two text versions', () => {
    const current = 'Check all terminated employees.\nPreserve the result.';
    const proposed = 'Check a representative sample of terminated employees.\nPreserve the result.';
    const diff = writingDifference(current, proposed);
    expect(diff.removed).toBe('all');
    expect(diff.added).toBe('a representative sample of');
    expect(diff.before + diff.removed + diff.after).toBe(current);
    expect(diff.before + diff.added + diff.after).toBe(proposed);
    expect(writingDifference('', 'New wording').added).toBe('New wording');
    expect(writingDifference('The same words.', 'The same words.').removed).toBe('');
  });
});

describe('additive writing help surface', () => {
  it('renders the existing editor and explicit entry points without generating, accepting or reviewing', () => {
    const actions: WritingAssistantActions = { generate: vi.fn(), accept: vi.fn(), reject: vi.fn() };
    const html = renderToStaticMarkup(React.createElement(BuilderSubmissionProvider, {
      children: React.createElement(WritingAssistantProvider, { draft: view(), rowVersion: 'row-1', onRowVersion: vi.fn(), actions,
        children: React.createElement(React.Fragment, null,
          React.createElement('textarea', { 'aria-label': 'Manual objective editor', defaultValue: 'My own words' }),
          React.createElement(WritingTools, { section: objective }), React.createElement(WritingAssistantPanel)),
      }),
    }));
    expect(html).toContain('Manual objective editor');
    expect(html).toContain('My own words');
    expect(html).toContain('Help Me Write');
    expect(html).toContain('Improve wording');
    expect(html).toContain('notes stay separate until you choose Use this draft');
    expect(html).not.toContain('Mark reviewed');
    expect(actions.generate).not.toHaveBeenCalled();
    expect(actions.accept).not.toHaveBeenCalled();
    expect(actions.reject).not.toHaveBeenCalled();
  });

  it('leaves the ordinary editor usable when writing help has no provider', () => {
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
      React.createElement('textarea', { 'aria-label': 'Manual editor', defaultValue: 'Editable procedure' }),
      React.createElement(WritingTools, { section: scope }), React.createElement(WritingAssistantPanel)));
    expect(html).toContain('Editable procedure');
    expect(html).not.toContain('Help Me Write');
  });

  it('renders saved preparation context and a section-specific lead question without requesting help', () => {
    const actions: WritingAssistantActions = { generate: vi.fn(), accept: vi.fn(), reject: vi.fn() };
    const html = renderToStaticMarkup(React.createElement(BuilderSubmissionProvider, {
      children: React.createElement(WritingAssistantProvider, { draft: view(), rowVersion: 'row-1', onRowVersion: vi.fn(), actions,
        children: React.createElement(PreparationAssistant, { step: 'instructions' }) }),
    }));
    expect(html).toContain('How should I locate each production parameter in ProdConsole and compare it with the approved baseline?');
    expect(html).toContain('Baseline');
    expect(html).toContain('Configuration baseline');
    expect(html).toContain('Selected systems');
    expect(html).not.toContain('Mark reviewed');
    expect(actions.generate).not.toHaveBeenCalled();
  });
});
