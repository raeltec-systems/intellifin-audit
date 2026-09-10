import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initialDraftSections } from '@intellifin/domain';
import type { ProcedureVersionView } from '@intellifin/application';

import { BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE } from '../design/copy';
import { BuilderSections } from './BuilderSections';

/**
 * What an auditor actually meets when the Builder opens.
 *
 * The owner rejected the previous Builder in these words: "i cant understand a single
 * word of whats happening here and what im expected to do... so many whistles and
 * bells..should be a few clicks". Two things had to become true, and both are structural
 * rather than a matter of taste, so both are asserted here rather than left to a reading:
 *
 *  - every step is titled with the question it answers, in the auditor's words, not with
 *    the name the domain uses for what it freezes; and
 *  - a step that is already answered starts CLOSED and still states what is in it, so
 *    the page opens as a short list rather than nine simultaneous forms.
 *
 * The browser suite proves the disclosure opens; this proves the markup it opens from.
 */

function draft(overrides: Partial<ProcedureVersionView> = {}): ProcedureVersionView {
  return {
    versionId: 'version',
    procedureId: 'procedure',
    versionNumber: 1,
    state: 'DRAFT',
    controlName: 'Terminated employee access',
    templateId: 'P-1',
    sections: initialDraftSections('P-1'),
    targetBlockers: ['targets-missing'],
    evidenceBlockers: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    period: null,
    scope: '',
    sourceSnapshot: null,
    inclusionRule: { schemaVersion: 1, all: [] },
    zeroRecordPass: false,
    allowVersionedDuplicates: false,
    targets: [],
    instructions: [],
    complianceConditions: [],
    evidenceRequirements: [],
    schedule: null,
    ...overrides,
  } as unknown as ProcedureVersionView;
}

const render = (view: ProcedureVersionView): string =>
  renderToStaticMarkup(
    React.createElement(BuilderSections, {
      draft: view,
      sections: view.sections,
      periodScope: React.createElement('p', null, 'period editor'),
      populationSource: React.createElement('p', null, 'source editor'),
      targetSystems: React.createElement('p', null, 'target editor'),
      auditInstructions: React.createElement('p', null, 'instruction editor'),
      complianceRule: React.createElement('p', null, 'rule editor'),
      evidenceRequirements: React.createElement('p', null, 'evidence editor'),
      schedule: React.createElement('p', null, 'schedule editor'),
    }),
  );

describe('the Builder an auditor opens', () => {
  it('titles each step with the question it answers, not the name of what it freezes', () => {
    const html = render(draft());
    for (const title of [
      'Records to test',
      'Systems to check',
      'Instructions for the agent',
      'What counts as a finding',
      'Evidence to capture',
      'How often it runs',
    ]) {
      expect(html, title).toContain(title);
    }
    // The domain's own names for the same sections stay in the payload and out of sight.
    for (const jargon of ['Population Source binding<', 'Compliance Rule conditions<']) {
      expect(html, jargon).not.toContain(jargon);
    }
  });

  it('reads Control and Objective once, together, under the pinned sentence', () => {
    const html = render(draft());
    expect(html.split(BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE)).toHaveLength(2);
    expect(html).toContain('What this procedure tests');
  });

  it('opens the unanswered steps and closes the answered ones', () => {
    const html = render(
      draft({
        period: { from: '2026-08-01', to: '2026-08-31' },
        scope: 'Employees terminated in August 2026.',
      }),
    );
    // An answered step is closed, and says what is in it without being opened.
    expect(html).toMatch(
      /<details class="ls-step" data-step="Period and scope" data-step-state="done"(?! open)/,
    );
    expect(html).toContain('1 Aug 2026 to 31 Aug 2026, UTC. Employees terminated in August 2026.');
    // An unanswered one is already open, with its editor on screen.
    expect(html).toContain('data-step="Population Source binding" data-step-state="todo" open');
    expect(html).toContain('source editor');
  });

  it('says how far through the steps somebody is', () => {
    expect(render(draft())).toMatch(/data-builder-progress[^>]*>1 of 7 answered\./);
  });
});
