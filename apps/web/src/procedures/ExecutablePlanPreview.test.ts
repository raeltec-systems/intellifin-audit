import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProcedureVersionView } from '@intellifin/application';
import { deriveExecutablePlan } from '@intellifin/domain';
import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import { ExecutablePlanPreview } from './ExecutablePlanPreview';
import { RetryPlanDerivation } from './RetryPlanDerivation';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.stubGlobal('React', React);

function view(): ProcedureVersionView {
  const input = executablePlanInputs();
  const result = deriveExecutablePlan(input);
  if (!result.ok) throw new Error(result.reason);
  return { ...input, versionId: 'version', procedureId: 'procedure', versionNumber: 1, state: 'DRAFT', targetBlockers: [], evidenceBlockers: [], createdAt: '2026-09-04T00:00:00Z', updatedAt: '2026-09-04T00:00:00Z', planCompilerVersion: '1', compiledPlan: result.plan, planDerivable: true, planStatus: 'succeeded', planFailureReason: null, planInputDigest: 'digest', derivationModel: null, planAttempts: [{ attemptId: 'attempt', inputDigest: 'digest', attemptedAt: '2026-09-04T01:00:00Z', outcome: 'success', reason: null, model: null }] };
}
const render = (draft: ProcedureVersionView) => renderToStaticMarkup(React.createElement(ExecutablePlanPreview, { draft }));

describe('read-only executable plan preview', () => {
  it('offers recovery outside the read-only preview only for a failed Draft', () => {
    const recovery = (draft: ProcedureVersionView) => renderToStaticMarkup(React.createElement(RetryPlanDerivation, { draft, rowVersion: 'row', onRetry: async () => ({ ok: true as const, rowVersion: 'next' }) }));
    expect(recovery(view())).toBe('');
    expect(recovery({ ...view(), planStatus: 'failed', state: 'ACTIVE' })).toBe('');
    expect(recovery({ ...view(), planStatus: 'failed' })).toContain('Retry plan derivation');
    expect(render({ ...view(), planStatus: 'failed' })).not.toContain('<button');
  });
  it('keeps the displayed plan’s successful provenance after later failed or unrelated attempts', () => {
    const draft = view();
    const html = render({ ...draft, planAttempts: [draft.planAttempts[0]!,
      { ...draft.planAttempts[0]!, attemptId: 'failed', attemptedAt: '2026-09-04T02:00:00Z', outcome: 'failure', reason: 'unavailable', model: { provider: 'failed-provider', modelId: 'failed-model', promptVersion: 'v2' } },
      { ...draft.planAttempts[0]!, attemptId: 'other-digest', inputDigest: 'unrelated', attemptedAt: '2026-09-04T03:00:00Z' },
      { ...draft.planAttempts[0]!, attemptId: 'duplicate-success', attemptedAt: '2026-09-04T04:00:00Z' },
    ] });
    expect(html).toContain('2026-09-04T01:00:00Z');
    expect(html).not.toContain('2026-09-04T02:00:00Z');
    expect(html).not.toContain('2026-09-04T03:00:00Z');
    expect(html).not.toContain('2026-09-04T04:00:00Z');
    expect(html).not.toContain('failed-provider');
  });
  it('renders the stored execution meaning, provenance and timestamp without edit controls', () => {
    const html = render(view());
    for (const label of ['Session Steps', 'Ordered Plan Steps', 'Observations to capture', 'Evidence and grounding', 'Conditions', 'Credential references', 'Execution limits', 'Rule-Classified', 'Re-derived', '2026-09-04T01:00:00Z', 'No model was used', 'vault://synthetic/prod', 'Compiled applicability']) expect(html).toContain(label);
    expect(html).not.toMatch(/<(?:input|textarea|select|button|form)\b/);
  });
  it('hides stale plan details while re-deriving and states a failed attempt reason', () => {
    expect(render({ ...view(), planStatus: 'pending' })).toContain('Re-deriving');
    expect(render({ ...view(), planStatus: 'pending' })).not.toContain('vault://synthetic/prod');
    expect(render({ ...view(), planStatus: 'failed', compiledPlan: null, planFailureReason: 'Choose a Population Source.' })).toContain('Cannot derive: Choose a Population Source.');
  });
  it('renders model identity from the successful attempt and escapes authored text', () => {
    const draft = view();
    const html = render({ ...draft, planAttempts: [{ ...draft.planAttempts[0]!, model: { provider: 'configured-provider', modelId: 'configured-model', promptVersion: 'v1' } }], compiledPlan: { ...draft.compiledPlan!, inputs: { ...draft.compiledPlan!.inputs, instructions: [{ registrationId: draft.targets[0]!.registrationId, text: '<script>unsafe()</script>' }] } } });
    expect(html).toContain('configured-provider / configured-model');
    expect(html).toContain('Prompt version: v1');
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});

it('shows the publishing attempt when same-digest successes finish out of start order', () => {
  const draft = view();
  const html = render({ ...draft, planAttempts: [
    { ...draft.planAttempts[0]!, attemptId: 'started-first-finished-last', published: false, attemptedAt: '2026-09-04T01:00:00Z' },
    { ...draft.planAttempts[0]!, attemptId: 'publisher', published: true, attemptedAt: '2026-09-04T02:00:00Z' },
  ] });
  expect(html).toContain('2026-09-04T02:00:00Z');
  expect(html).not.toContain('2026-09-04T01:00:00Z');
});

it('shows the latest publisher when authoring returns to an earlier successful digest', () => {
  const draft = view();
  const html = render({ ...draft, planAttempts: [
    { ...draft.planAttempts[0]!, attemptId: 'old-A', published: false, completedAt: '2026-09-04T01:00:00Z' },
    { ...draft.planAttempts[0]!, attemptId: 'B', published: false, inputDigest: 'other', completedAt: '2026-09-04T02:00:00Z' },
    { ...draft.planAttempts[0]!, attemptId: 'new-A', published: true, completedAt: '2026-09-04T03:00:00Z' },
  ] });
  expect(html).toContain('2026-09-04T03:00:00Z');
  expect(html).not.toContain('2026-09-04T01:00:00Z');
});
