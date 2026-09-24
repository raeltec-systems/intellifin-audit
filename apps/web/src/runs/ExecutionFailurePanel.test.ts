import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RunStopFacts } from '@intellifin/infrastructure';

import { ExecutionFailurePanel } from './ResultSections';
import { ACCESS_WORDS, NO_RECORDED_REASON_SENTENCE, WORKSPACE_WORDS } from './stop-reason';

/**
 * The Result tab's execution-failure panel reads the SAME stop facts as the Runs list and
 * the Run header (owner walkthrough, 2026-09-16).
 *
 * The first version listed three checkpoints and there are seven, so a Run ended by the
 * workspace, the sign-in or the agent work checkpoint — the owner's two production Runs,
 * `workspace-missing` on the sign-in checkpoint — read "The Run failed before any Session
 * Step recorded a diagnostic": the honest sentence for a state that was not the case.
 */

const OLD_SENTENCE = 'The Run failed before any Session Step recorded a diagnostic.';

function facts(overrides: Partial<RunStopFacts> = {}): RunStopFacts {
  return {
    runId: '019823ab-0000-7000-8000-000000000001',
    state: 'RUN_FAILED',
    initiatedAt: '2026-09-16T08:04:47.000Z',
    period: { from: '2026-08-01', to: '2026-08-31' },
    stop: null,
    timedOutWait: null,
    snapshotGeneratedAt: null,
    gateChecks: 0,
    gateFailed: 0,
    outcomeRow: 'run-failed',
    ...overrides,
  };
}

const render = (props: React.ComponentProps<typeof ExecutionFailurePanel>): string =>
  renderToStaticMarkup(React.createElement(ExecutionFailurePanel, props));

describe('the execution failure panel', () => {
  it('names the stage that ended the Run and its reason in words, from the stop facts', () => {
    const html = render({
      steps: [],
      stop: facts({ stop: { stage: 'access', diagnostic: 'workspace-missing' } }),
      sealedAt: '2026-09-16T08:04:52.000Z',
    });
    expect(html).toContain(ACCESS_WORDS['workspace-missing']);
    expect(html).toContain('The Target System sign-in stage recorded the code');
    expect(html).toContain('<code class="ls-mono">workspace-missing</code>');
    expect(html).not.toContain(OLD_SENTENCE);
    expect(html).toContain('Concluded 2026-09-16T08:04:52.000Z.');
  });

  it('reads a workspace stop the same way, because the reader does', () => {
    const html = render({
      steps: [],
      stop: facts({ stop: { stage: 'workspace', diagnostic: 'workspace-refused' } }),
      sealedAt: null,
    });
    expect(html).toContain(WORKSPACE_WORDS['workspace-refused']);
    expect(html).not.toContain(OLD_SENTENCE);
  });

  it('says in words that nothing recorded a reason, rather than claiming a Session Step did not', () => {
    const html = render({ steps: [], stop: facts(), sealedAt: null });
    expect(html).toContain(NO_RECORDED_REASON_SENTENCE);
    expect(html).not.toContain(OLD_SENTENCE);
    expect(html).not.toContain('recorded the code');
  });

  it('keeps the per-step list with its attempts when Session Steps recorded diagnostics', () => {
    const html = render({
      steps: [{ name: 'Population Source acquisition', attempts: 4, diagnostic: 'population-transport-failed' }],
      stop: facts({ stop: { stage: 'population', diagnostic: 'population-transport-failed' } }),
      sealedAt: null,
    });
    expect(html).toContain('Population Source acquisition · 4 attempts');
    expect(html).toContain('<code class="ls-mono">population-transport-failed</code>');
    expect(html).not.toContain(OLD_SENTENCE);
  });

  // UI cleanup 2026-09-22, UX-02/UX-31. A step that failed on its first try said "1
  // attempts" — the noun literally appended to the count rather than agreeing with it,
  // the exact defect the walkthrough's "1 Observations"/"1 attempts" examples name.
  it('says "1 attempt", not "1 attempts", when a step failed on its first try', () => {
    const html = render({
      steps: [{ name: 'Target System sign-in', attempts: 1, diagnostic: 'workspace-egress-denied' }],
      stop: facts({ stop: { stage: 'access', diagnostic: 'workspace-egress-denied' } }),
      sealedAt: null,
    });
    expect(html).toContain('Target System sign-in · 1 attempt ·');
    expect(html).not.toContain('1 attempts');
  });

  it('keeps the old sentence only when it has no stop facts at all', () => {
    const html = render({ steps: [], stop: null, sealedAt: null });
    expect(html).toContain(OLD_SENTENCE);
  });
});
