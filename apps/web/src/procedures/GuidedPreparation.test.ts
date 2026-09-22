import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ProcedureVersionView } from '@intellifin/application';
import { refreshPreparation, type PreparationSectionId } from '@intellifin/domain';

import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import { GuidedPreparation } from './GuidedPreparation';
import { CONDITION_NOT_IN_WORDS } from './condition-words';
import { BuilderSubmissionProvider } from './use-section';

function view(overrides: Partial<ProcedureVersionView> = {}): ProcedureVersionView {
  return {
    ...executablePlanInputs(),
    versionId: 'version', procedureId: 'procedure', versionNumber: 1, state: 'DRAFT',
    targetBlockers: [], evidenceBlockers: [],
    createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
    planCompilerVersion: '1', compiledPlan: null, planDerivable: false,
    planStatus: 'pending', planFailureReason: null, planInputDigest: null,
    derivationModel: null, planAttempts: [],
    ...overrides,
  };
}

const editor = (name: string) => React.createElement('input', { 'aria-label': `${name} editor`, defaultValue: `retained-${name}` });

function render(draft: ProcedureVersionView, onReview = vi.fn(), actorNames?: Readonly<Record<string, string>>): string {
  return renderToStaticMarkup(React.createElement(BuilderSubmissionProvider, {
    children: React.createElement(GuidedPreparation, {
      draft, rowVersion: 'row-1', onRowVersion: vi.fn(), onReview, actorNames,
      editors: {
        context: editor('context'), scope: editor('scope'), evidence: editor('evidence'),
        instructions: editor('instructions'), assessment: editor('assessment'), frequency: editor('frequency'),
      },
      review: React.createElement('div', { 'data-whole-procedure-review': true },
        React.createElement('p', null, 'The complete saved procedure and execution summary'),
        React.createElement('button', { type: 'button' }, 'Submit for approval')),
      help: React.createElement('p', null, 'Additional section help'),
    }),
  }));
}

function panel(html: string, section: PreparationSectionId | 'review'): { attributes: string; body: string } {
  const match = new RegExp(`<section([^>]*data-preparation-panel="${section}"[^>]*)>([\\s\\S]*?)</section>`).exec(html);
  if (match === null) throw new Error(`The ${section} panel is missing.`);
  return { attributes: match[1]!, body: match[2]! };
}

function reviewedContext(): ProcedureVersionView {
  const draft = view();
  const state = refreshPreparation(draft);
  const context = state.sections.context;
  return { ...draft, sectionPreparation: { ...state, sections: {
    ...state.sections,
    context: { ...context, review: { actorId: 'auditor-42', at: '2026-09-11T14:05:09.000Z', basis: context.basis, revision: context.revision } },
  } } };
}

describe('guided procedure preparation', () => {
  /**
   * UX-13: the criteria step says each condition in audit language, numbered by its own
   * id, with the compiled rule and its applicability under Technical details — never the
   * rule grammar (`found = false`, `account_status`) as the text a reader meets first.
   */
  it('says the criteria in audit language and keeps the compiled rule under Technical details', () => {
    const base = view();
    const [c1] = base.complianceConditions;
    const html = render(view({ templateId: 'P-1', complianceConditions: [
      { ...c1!, conditionId: 'C1', text: 'found = false or account_status in [Disabled] else [Active]' },
      { ...c1!, conditionId: 'C3', text: 'Observed and approved normalized values are equal.' },
    ] }));
    const assessment = panel(html, 'assessment').body;
    // Everything a reader meets without opening a disclosure.
    const ordinary = assessment.replace(/<details[\s\S]*?<\/details>/gu, '');
    expect(ordinary).toContain('Condition 1.');
    expect(ordinary).toContain('Acceptable: no record is found after every required search, or the account status is “Disabled”. Exception: the account status is “Active”. Any other account status needs review.');
    // Numbered by its OWN id: C3 is Condition 3 even as the second item, and prose the
    // simple reader cannot express is said as what it is.
    expect(ordinary).toContain('Condition 3.');
    expect(ordinary).toContain(CONDITION_NOT_IN_WORDS);
    expect(ordinary).not.toContain('found = false');
    expect(ordinary).not.toContain('account_status');
    expect(assessment).toContain('Technical details');
    expect(assessment).toContain('Compiled rule text');
  });

  /**
   * The frequency step was titled "Frequency and handling" and offered a frequency and a
   * time: half the title named an editor that is not there, and an auditor went looking
   * for the stop-and-ask controls. The handling is frozen by the compiler and shown by
   * the Schedule editor; the step's own words say what the step actually takes.
   */
  it('names the frequency step for what it takes, not for an editor it does not have', () => {
    const html = render(view());
    // The outline entry, the panel heading and the review-step link all read the one
    // title, so renaming it once renames it everywhere.
    expect(html).toContain('>Planned frequency</span>');
    expect(panel(html, 'frequency').body).toContain('>Planned frequency</h2>');
    expect(html).not.toContain('Frequency and handling');
    // The question no longer offers a stop-or-ask control. Those facts are frozen by the
    // compiler, and the Schedule editor shows them read-only (`handling-words.test.ts`).
    const step = panel(html, 'frequency');
    // UX-14 (2026-09-22): the question says it is a plan and that nothing runs by itself.
    expect(step.body).toContain('How often is this test meant to happen');
    expect(step.body).toContain('Nothing runs by itself yet.');
    expect(step.body).not.toContain('when should the agent stop or ask');
  });

  it('renders readable sections and native outline links before hydration', () => {
    const html = render(view());
    expect(panel(html, 'context').attributes).not.toContain('hidden');
    for (const section of ['scope', 'evidence', 'instructions', 'assessment', 'frequency'] as const) {
      expect(panel(html, section).attributes).not.toContain('hidden');
      expect(panel(html, section).body).toContain(`value="retained-${section}"`);
    }
    const current = [...html.matchAll(/<a[^>]*aria-current="step"[^>]*>/g)];
    expect(current).toHaveLength(1);
    expect(current[0]?.[0]).toContain('data-preparation-nav="context"');
    expect(html).toContain('aria-label="Procedure outline"');
    expect(html.match(/href="#[^"]+-panel-/g)).toHaveLength(13);
    expect(html).toContain('data-guided-ready="false"');
    expect(html).toContain('Additional section help');
  });

  it('waits for hydration before accepting any editor input or submission', () => {
    const html = render(view());
    const work = /<fieldset([^>]*aria-label="Procedure editing controls"[^>]*)>([\s\S]*)<\/fieldset>/.exec(html);
    expect(work).not.toBeNull();
    // A native disabled ancestor covers every editor and the Submit button. Merely
    // waiting to hide panels left their SSR controls editable before onChange existed:
    // hydration then restored saved text and the submission guard never saw the edit.
    expect(work![1]).toContain('disabled');
    for (const section of ['context', 'scope', 'evidence', 'instructions', 'assessment', 'frequency']) {
      expect(work![2]).toContain(`aria-label="${section} editor"`);
      expect(work![2]).toContain(`value="retained-${section}"`);
    }
    expect(work![2]).toContain('Submit for approval');
    expect(work![2]).toContain('Editing controls are loading.');
    expect(work![2]).not.toContain('aria-label="Procedure outline"');
    expect(html.indexOf('aria-label="Procedure outline"')).toBeLessThan(html.indexOf('<fieldset'));
  });

  it('keeps the whole-procedure review and submit control physically inside the final panel', () => {
    const html = render(view());
    const final = panel(html, 'review');
    expect(final.attributes).not.toContain('hidden');
    expect(final.body).toContain('The complete saved procedure and execution summary');
    expect(final.body).toContain('Submit for approval');
    expect(html.split('data-whole-procedure-review')).toHaveLength(2);
    for (const section of ['context', 'scope', 'evidence', 'instructions', 'assessment', 'frequency'] as const) {
      expect(panel(html, section).body).not.toContain('Submit for approval');
    }
  });

  it('never treats populated or generated content as auditor acceptance', () => {
    const onReview = vi.fn();
    const html = render(view(), onReview);
    expect(html).toContain('0 of 6 sections reviewed by auditor.');
    expect(html).toContain('data-preparation-status="drafting"');
    expect(html).not.toContain('data-preparation-status="reviewed"');
    expect(html).not.toContain('<time');
    expect(onReview).not.toHaveBeenCalled();
  });

  it('distinguishes an empty section from a saved draft in words', () => {
    const html = render(view({ instructions: [] }));
    expect(panel(html, 'instructions').body).toContain('Not started');
    expect(panel(html, 'context').body).toContain('Drafting');
  });

  it('shows only the saved auditor acknowledgement, including its exact time and revision', () => {
    const draft = reviewedContext();
    const html = render(draft);
    expect(html).toContain('1 of 6 sections reviewed by auditor.');
    const context = panel(html, 'context').body;
    expect(context).toContain('Reviewed by auditor');
    // UX-02 (2026-09-22): the shared `Timestamp` — readable text, the exact instant in the
    // attribute and the title. `Intl` spelled September "Sept" here, which the shared
    // formatter exists to stop.
    expect(context).toContain('<time dateTime="2026-09-11T14:05:09.000Z" title="2026-09-11T14:05:09.000Z">11 Sep 2026, 14:05:09 UTC</time>');
    expect(context).toContain('auditor-42');
    expect(context).toContain('Saved section revision');
    expect(context).toContain(draft.sectionPreparation!.sections.context.basis);
    expect(panel(html, 'scope').body).not.toContain('<time');
  });

  /**
   * The review record printed the auditor's user id (owner finding UX-11). A person is
   * named the way every Run surface names one: `ActorName` — the name when the server page
   * read one, and the id itself in monospace when it did not. Never blank.
   */
  it('names the auditor who reviewed a section, and prints the id only when no name is known', () => {
    const named = panel(render(reviewedContext(), vi.fn(), { 'auditor-42': 'Dana Auditor' }), 'context').body;
    expect(named).toContain('<dt>Auditor</dt><dd>Dana Auditor</dd>');
    expect(named).not.toContain('auditor-42');
    const unnamed = panel(render(reviewedContext()), 'context').body;
    expect(unnamed).toContain('<dt>Auditor</dt><dd><span class="ls-mono">auditor-42</span></dd>');
  });

  it('stops showing an acknowledgement when its saved content no longer matches', () => {
    const html = render({ ...reviewedContext(), controlName: 'A changed audit assignment' });
    expect(html).toContain('0 of 6 sections reviewed by auditor.');
    expect(panel(html, 'context').body).not.toContain('<time');
    expect(panel(html, 'context').body).toContain('Drafting');
  });

  it('requires an explicit return to drafting before an unresolved section can be reviewed', () => {
    const draft = view();
    const state = refreshPreparation(draft);
    const html = render({ ...draft, sectionPreparation: { ...state, sections: {
      ...state.sections, scope: { ...state.sections.scope, needsClarification: true },
    } } });
    const scope = panel(html, 'scope').body;
    expect(scope).toContain('Needs clarification');
    expect(scope).toContain('Resolve the open question before reviewing this section.');
    expect(scope).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Mark reviewed and continue<\/button>/);
    expect(scope).toMatch(/<button(?![^>]*aria-disabled)[^>]*>Continue drafting<\/button>/);
    expect(panel(html, 'context').body).toContain('Drafting');
  });
});
