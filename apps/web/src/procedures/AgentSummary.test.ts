import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ProcedureVersionView } from '@intellifin/application';
import { READINESS_NOTHING_FOUND, READINESS_NO_GUARANTEE, deriveExecutablePlan } from '@intellifin/domain';

import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import { AgentSummary } from './AgentSummary';

/**
 * "What the agent will do" is derived from the frozen plan and nothing else, and the
 * readiness items beside it come from the domain's own sentences. These tests hold the
 * two claims that matter: the summary never states a step the plan does not carry, and
 * the caveat is rendered whether or not anything is listed — an empty list must never
 * read as a promise.
 */

function view(): ProcedureVersionView {
  const input = executablePlanInputs();
  const result = deriveExecutablePlan(input);
  if (!result.ok) throw new Error(result.reason);
  return {
    ...input,
    versionId: 'version', procedureId: 'procedure', versionNumber: 1, state: 'DRAFT',
    targetBlockers: [], evidenceBlockers: [],
    createdAt: '2026-09-04T00:00:00Z', updatedAt: '2026-09-04T00:00:00Z',
    planCompilerVersion: '1', compiledPlan: result.plan, planDerivable: true,
    planStatus: 'succeeded', planFailureReason: null, planInputDigest: 'digest',
    derivationModel: null, planAttempts: [],
  };
}

const render = (draft: ProcedureVersionView): string =>
  renderToStaticMarkup(React.createElement(AgentSummary, { draft, headingId: 'summary' }));

/** A plan with different frozen limits. The limits are `z.literal`s, so the cast is the
 *  only way to state a plan this build would refuse to derive — which is the point. */
const withLimits = (draft: ProcedureVersionView, limits: Record<string, number>): ProcedureVersionView =>
  ({ ...draft, compiledPlan: { ...draft.compiledPlan!, limits: { ...draft.compiledPlan!.limits, ...limits } } }) as unknown as ProcedureVersionView;

describe('what the agent will do', () => {
  it('names every Session Step the frozen plan carries, and none it does not', () => {
    const draft = view();
    const html = render(draft);
    for (const step of draft.compiledPlan!.sessionSteps) {
      expect(html, step.action).toContain(`data-agent-step="${step.action}"`);
    }
    // A step the plan does NOT carry is not summarised into existence.
    const actions = new Set(draft.compiledPlan!.sessionSteps.map((step) => step.action));
    for (const absent of ['sign-in', 'extract-adapter', 'create-workspace'] as const) {
      if (actions.has(absent)) continue;
      expect(html, absent).not.toContain(`data-agent-step="${absent}"`);
    }
  });

  it('reads the limits out of the plan rather than restating them', () => {
    const draft = view();
    const limits = draft.compiledPlan!.limits;
    const html = render(draft);
    // Grouped and said in words, because `10000` and `3600` are the frozen values and
    // not what a person is trying to find out. Formatted INDEPENDENTLY here: importing
    // the component's own formatter would compare it with a copy of itself.
    expect(html).toContain(limits.runStepExecutions.toLocaleString('en-US'));
    expect(html).toContain(limits.runTokens.toLocaleString('en-US'));
    expect(html).toContain(String(limits.retriesPerStep));
    expect(html).toContain('1 hour'); // limits.runTimeoutSeconds is 3600

    // And they are READ: a plan carrying different limits says different numbers.
    const other = render(withLimits(draft, { runStepExecutions: 42, runTimeoutSeconds: 90, runTokens: 7 }));
    expect(other).toContain('42 steps');
    expect(other).toContain('1 minute 30 seconds');
    expect(other).toContain('7 tokens');
    expect(other).not.toContain(limits.runStepExecutions.toLocaleString('en-US'));
  });

  it('says there is nothing to summarise rather than showing an empty plan', () => {
    const html = render({ ...view(), planStatus: 'pending', compiledPlan: null });
    expect(html).toContain('data-agent-summary-empty');
    expect(html).not.toContain('data-agent-step');
    // The readiness panel is still there: a Draft with no plan is exactly when its
    // items are worth reading.
    expect(html).toContain('data-readiness');
  });

  it('renders the caveat whether or not anything is listed', () => {
    const withItems = render({ ...view(), targets: [], sourceSnapshot: null });
    expect(withItems).toContain('data-readiness-item="targets-missing"');
    expect(withItems).toContain('data-readiness-item="source-not-bound"');
    expect(withItems).toContain(READINESS_NO_GUARANTEE.slice(0, 40));

    const clean = render(view());
    expect(clean).not.toContain('data-readiness-item="targets-missing"');
    expect(clean).toContain(READINESS_NO_GUARANTEE.slice(0, 40));
  });

  it('says so in words when readiness finds nothing', () => {
    // The fixture's own Draft decides which; both branches must be reachable prose, so
    // whichever this is, an empty panel never renders as blank.
    const html = render(view());
    const empty = html.includes('data-readiness-empty');
    expect(empty ? html.includes(READINESS_NOTHING_FOUND.slice(0, 40)) : html.includes('data-readiness-item')).toBe(true);
  });

  it('is read-only: the summary offers no control of its own', () => {
    expect(render(view())).not.toContain('<button');
  });
});
