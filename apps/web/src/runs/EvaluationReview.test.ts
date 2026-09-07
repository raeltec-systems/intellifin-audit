import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./evaluation-review-actions', () => ({
  confirmEvaluationAction: vi.fn(),
  rejectEvaluationAction: vi.fn(),
}));

import type { RunEvaluationRow, RunResultRow } from '@intellifin/infrastructure';

import { EvaluationReview } from './EvaluationReview';

const RUN_ID = '019823ab-0000-7000-8000-000000000001';
const OBSERVATION_ID = '019823ab-0000-7000-8000-000000000002';

function result(overrides: Partial<Pick<RunResultRow, 'outcome' | 'sealed' | 'version'>> = {}): Pick<RunResultRow, 'outcome' | 'sealed' | 'version'> {
  return { outcome: 'PENDING_CONFIRMATION', sealed: false, version: 1, ...overrides };
}

function evaluation(overrides: Partial<RunEvaluationRow> = {}): RunEvaluationRow {
  return {
    observationId: OBSERVATION_ID,
    conditionId: 'C2',
    origin: 'AGENT_JUDGED',
    value: 'EXCEPTION',
    confirmation: 'pending',
    confidence: '0.91',
    rationale: 'Agent rationale is retained here.',
    diagnostic: null,
    machineProposal: {
      value: 'EXCEPTION',
      confidence: '0.91',
      rationale: 'Agent rationale is retained here.',
    },
    reviewDecision: null,
    ...overrides,
  };
}

function render(props: Partial<React.ComponentProps<typeof EvaluationReview>> = {}): string {
  return renderToStaticMarkup(
    React.createElement(EvaluationReview, {
      runId: RUN_ID,
      result: result(),
      evaluations: [evaluation()],
      reviewRevision: 4,
      pendingCount: 1,
      ...props,
    }),
  );
}

describe('Evaluation review surface', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the exact pending count from the server projection and preserves the original proposal', () => {
    const html = render({ pendingCount: 3 });
    expect(html).toContain('3 Agent-Judged evaluations await confirmation');
    expect(html).toContain('Original Agent-Judged proposal');
    expect(html).toContain('Exception');
    expect(html).toContain('0.91');
    expect(html).toContain('Untrusted source content — AGENT-GENERATED evaluation rationale.');
    expect(html).toContain('Agent rationale is retained here.');
    expect(html).toContain('Submission is unavailable while the Result is unsealed.');
    expect(html).toContain('Confirm evaluation');
    expect(html).toContain('Reject evaluation');
  });

  it('escapes an agent rationale rather than allowing it to become markup or a control', () => {
    const html = render({ evaluations: [evaluation({ machineProposal: {
      value: 'COMPLIANT', confidence: '0.80', rationale: '<script>submit()</script>',
    }, rationale: '<script>submit()</script>' })] });
    expect(html).toContain('&lt;script&gt;submit()&lt;/script&gt;');
    expect(html).not.toContain('<script>submit()</script>');
    expect(html).not.toContain('>submit()<');
  });

  it('keeps below-threshold proposals visible while offering no review controls', () => {
    const html = render({ evaluations: [evaluation({
      value: 'UNEVALUATED',
      confirmation: null,
      machineProposal: { value: 'UNEVALUATED', confidence: '0.42', rationale: 'Below threshold.' },
    })], pendingCount: 0 });
    expect(html).toContain('Below threshold.');
    expect(html).toContain('Unevaluated');
    expect(html).not.toContain('Confirm evaluation');
    expect(html).not.toContain('Reject evaluation');
    expect(html).not.toContain('Replacement value for rejection');
  });

  it('does not create controls for Rule-Classified evaluations', () => {
    const html = render({
      result: result({ outcome: 'PASS', sealed: true }),
      evaluations: [{
        observationId: OBSERVATION_ID,
        conditionId: 'C1',
        origin: 'RULE',
        value: 'COMPLIANT',
        confirmation: null,
        confidence: null,
        rationale: null,
        diagnostic: null,
        machineProposal: null,
        reviewDecision: null,
      }],
      pendingCount: 0,
    });
    expect(html).toBe('');
  });

  it('keeps a completed decision and its original proposal as read-only history', () => {
    const html = render({
      result: result({ outcome: 'PASS', sealed: true, version: 2 }),
      evaluations: [evaluation({
        value: 'EXCEPTION',
        confirmation: 'confirmed',
        reviewDecision: {
          action: 'confirm',
          actorId: 'auditor-1',
          decidedAt: '2026-09-06T00:00:00.000Z',
          rejectionRationale: null,
        },
      })],
      pendingCount: 0,
    });
    expect(html).toContain('Stored human review decision');
    expect(html).toContain('auditor-1');
    expect(html).toContain('2026-09-06T00:00:00.000Z');
    expect(html).toContain('Original Agent-Judged proposal');
    expect(html).not.toContain('Confirm evaluation');
    expect(html).not.toContain('Reject evaluation');
  });

  it('renders a sealed result read-only even if a stale payload still says pending', () => {
    const html = render({ result: result({ sealed: true }) });
    expect(html).toContain('The Result is sealed. Review history is read-only.');
    expect(html).not.toContain('Confirm evaluation');
    expect(html).not.toContain('Reject evaluation');
  });

  it('does not invent a count when the published result document was unreadable', () => {
    const html = render({ pendingCount: null });
    expect(html).toContain('Agent-Judged evaluations await confirmation; the count is unavailable');
    expect(html).not.toContain('1 Agent-Judged evaluations await confirmation');
  });
});
