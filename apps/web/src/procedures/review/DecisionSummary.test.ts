import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  initialDraftCompliance,
  initialDraftEvidence,
  initialDraftPopulation,
  initialDraftSections,
  type FrozenPlanInputs,
  type VersionDecisionRecord,
} from '@intellifin/domain';

import { executablePlanInputs } from '../../../../../tests/fixtures/executable-plan';
import { DecisionBar } from './DecisionBar';
import { DecisionHistory } from './DecisionHistory';
import { DecisionSummary } from './DecisionSummary';
import { WhatChanged } from './WhatChanged';
import {
  AGENT_JUDGED_NOTE,
  CREDENTIAL_BY_NAME_SENTENCE,
  FIRST_VERSION_SENTENCE,
  NOT_SUBMITTED_COMPARISON_SENTENCE,
  NO_CONDITIONS_SENTENCE,
  NO_DECISIONS_SENTENCE,
  NO_SOURCE_SENTENCE,
  NO_SUBMISSION_RECORDED,
  NO_SYSTEMS_SENTENCE,
  READ_ONLY_ACCESS_SENTENCE,
  SUBMISSION_NOT_RECORDED,
  SUMMARY_LABELS,
  templateWords,
} from './review-words';

/**
 * The decision summary as it renders.
 *
 * `apps/web/src` renders with `renderToStaticMarkup` under `environment: 'node'`, so no
 * effect runs — every component here is a server component and that is the whole surface.
 */

function summary(inputs: FrozenPlanInputs): string {
  return renderToStaticMarkup(
    React.createElement(DecisionSummary, { inputs, headingId: 'summary' }),
  );
}

/** A P-1 version, whose Template criteria the shared audit reader CAN express. */
function p1(): FrozenPlanInputs {
  const base = executablePlanInputs();
  return {
    ...base,
    ...initialDraftPopulation('P-1'),
    ...initialDraftCompliance('P-1'),
    ...initialDraftEvidence('P-1'),
    templateId: 'P-1',
    sections: initialDraftSections('P-1'),
    sourceSnapshot: base.sourceSnapshot,
    period: base.period,
    scope: base.scope,
    targets: base.targets,
    instructions: base.instructions,
  };
}

describe('the summary states what an approver has to decide', () => {
  it('names the Procedure and its Template in words, not as a stored id', () => {
    const html = summary(p1());
    expect(html).toContain(SUMMARY_LABELS.procedureName);
    expect(html).toContain(templateWords('P-1'));
    // The stored id belongs under Technical details, not beside the Template's name.
    expect(html).not.toContain('>P-1<');
  });

  it('says every criterion in audit language where the shared reader can', () => {
    const html = summary(p1());
    expect(html).toContain('Acceptable:');
    expect(html).toContain('Exception:');
    // The compiler grammar never appears as the primary text of a criterion.
    expect(html).not.toContain('found = false');
  });

  it('says the certainty threshold beside the criteria it actually decides', () => {
    const inputs = p1();
    const html = summary(inputs);
    expect(html).toContain(AGENT_JUDGED_NOTE(inputs.agentJudgedThreshold));
  });

  it('states the access limits once, and names credentials by reference only', () => {
    const html = summary(p1());
    expect(html).toContain(READ_ONLY_ACCESS_SENTENCE);
    expect(html).toContain(CREDENTIAL_BY_NAME_SENTENCE);
    expect(html.split(READ_ONLY_ACCESS_SENTENCE).length - 1).toBe(1);
    expect(html).toContain('vault://synthetic/prod');
  });

  it('never renders a raw ISO instant or a registration identifier as text', () => {
    const inputs = p1();
    const html = summary(inputs);
    expect(html).not.toMatch(/>\d{4}-\d{2}-\d{2}T/);
    expect(html).not.toContain(`>${inputs.targets[0]!.registrationId}<`);
    expect(html).not.toContain(inputs.targets[0]!.digest);
  });
});

describe('an empty state says what would be here and refuses to imply a passed control', () => {
  it('says a version with no criterion could reach no finding', () => {
    const inputs = { ...p1(), complianceConditions: [] } as unknown as FrozenPlanInputs;
    expect(summary(inputs)).toContain(NO_CONDITIONS_SENTENCE);
  });

  it('says a version with no Target System has nowhere to look', () => {
    const inputs = { ...p1(), targets: [], instructions: [] } as unknown as FrozenPlanInputs;
    expect(summary(inputs)).toContain(NO_SYSTEMS_SENTENCE);
  });

  it('says a version with no Population Source has no list of records', () => {
    const inputs = { ...p1(), sourceSnapshot: null } as unknown as FrozenPlanInputs;
    expect(summary(inputs)).toContain(NO_SOURCE_SENTENCE);
  });
});

describe('what changed is never a claim the version cannot support', () => {
  function changed(props: Partial<Parameters<typeof WhatChanged>[0]> = {}): string {
    return renderToStaticMarkup(
      React.createElement(WhatChanged, {
        diff: [{ section: 'Objective', before: null, after: 'anything', changed: true }],
        baseline: null,
        templateId: 'P-4',
        headingId: 'changed',
        ...props,
      }),
    );
  }

  it('says a first version has nothing to compare, even though every section is flagged', () => {
    const html = changed();
    expect(html).toContain(FIRST_VERSION_SENTENCE);
    expect(html).not.toContain('Changed');
  });

  it('says an unsubmitted version has nothing frozen to compare, which is not the same', () => {
    expect(changed({ submitted: false })).toContain(NOT_SUBMITTED_COMPARISON_SENTENCE);
  });

  it('reads the arrow to a screen reader as a word, never as a symbol alone', () => {
    const html = changed({ baseline: { versionNumber: 2 } });
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('became');
  });
});

describe('the decision is in front of the person taking it', () => {
  const decision: VersionDecisionRecord = {
    schemaVersion: 1,
    actorId: 'manager-id',
    occurredAt: '2026-09-06T09:30:00.000Z',
    priorState: 'SUBMITTED',
    decision: 'approve',
    rationale: null,
    aggregateRevision: 'b'.repeat(64),
  };

  it('names the exact version, its author and who submitted it, and when', () => {
    const html = renderToStaticMarkup(
      React.createElement(DecisionBar, {
        versionNumber: 3,
        controlName: 'Terminated user access',
        state: 'SUBMITTED',
        authorId: 'author-id',
        submission: { actorId: 'author-id', occurredAt: '2026-09-05T08:00:00.000Z' },
        latest: null,
        names: new Map([['author-id', 'Dana Mwale']]),
        headingId: 'decision',
        status: React.createElement('p', null, 'Approval pending.'),
        actions: React.createElement('output', { 'data-actions': true }),
      }),
    );
    expect(html).toContain('Version 3 · Terminated user access');
    expect(html).toContain('Dana Mwale');
    expect(html).toContain('5 Sep 2026, 08:00:00 UTC');
    expect(html).toContain('Approval pending.');
    expect(html).toContain('data-actions');
    expect(html).not.toContain('author-id');
  });

  it('shows the saved decision once, or nothing at all before one is taken', () => {
    const withDecision = renderToStaticMarkup(
      React.createElement(DecisionBar, {
        versionNumber: 1,
        controlName: 'Control',
        state: 'ACTIVE',
        authorId: null,
        submission: null,
        latest: decision,
        names: new Map(),
        headingId: 'decision',
        status: null,
        actions: null,
      }),
    );
    expect(withDecision).toContain('data-saved-decision');
    expect(withDecision.split('data-saved-decision').length - 1).toBe(1);
    // An Active version with no submission record was not "not yet submitted": it has
    // been decided on. The bar says only what is true — no record names who sent it.
    expect(withDecision).toContain(SUBMISSION_NOT_RECORDED);
    expect(withDecision).not.toContain(NO_SUBMISSION_RECORDED);
    const without = renderToStaticMarkup(
      React.createElement(DecisionBar, {
        versionNumber: 1,
        controlName: 'Control',
        state: 'DRAFT',
        authorId: null,
        submission: null,
        latest: null,
        names: new Map(),
        headingId: 'decision',
        status: null,
        actions: null,
      }),
    );
    expect(without).not.toContain('data-saved-decision');
    expect(without).toContain(NO_SUBMISSION_RECORDED);
  });

  it('collapses the history and says how many decisions it holds', () => {
    const html = renderToStaticMarkup(
      React.createElement(DecisionHistory, { decisions: [decision], names: new Map() }),
    );
    // A native `<details>` works before hydration and with no JavaScript at all.
    expect(html.startsWith('<details')).toBe(true);
    expect(html).toContain('1 decision');
    expect(html).not.toContain('1 decisions');
  });

  it('says nothing has been decided yet, rather than rendering an empty list', () => {
    const html = renderToStaticMarkup(
      React.createElement(DecisionHistory, { decisions: [], names: new Map() }),
    );
    expect(html).toContain(NO_DECISIONS_SENTENCE);
    expect(html).toContain('0 decisions');
  });
});
