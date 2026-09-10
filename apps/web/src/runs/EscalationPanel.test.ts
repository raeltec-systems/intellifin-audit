import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const authorizeRead = vi.hoisted(() => vi.fn());
const runtimeRead = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('../../app/runs/actions', () => ({
  answerEscalationAction: vi.fn(),
}));
vi.mock('../../src/server-session', () => ({
  requireServerAction: authorizeRead,
}));
vi.mock('../../src/bootstrap', () => ({
  getRuntime: runtimeRead,
}));
vi.mock('@intellifin/infrastructure', () => ({
  PostgresWaitRepository: class {},
}));

import type { EscalationDetails, EscalationWait, WaitRepository } from '@intellifin/application';

import { ESCALATION_PANEL_COPY } from '../design/copy';
import { EscalationPanel, countdownText, orderedEscalationOptions } from './EscalationPanel';
import { readOpenEscalation, readOpenEscalationWith } from './escalation-read';

const RUN_ID = '019823ab-0000-7000-8000-000000000001';
const WAIT_ID = '019823ab-0000-7000-8000-000000000002';
const READ_AT = '2026-09-06T09:00:00.000Z';
const DETAILS_NONE: EscalationDetails = {
  stepId: null,
  supportingEvidenceIds: null,
  workItemId: null,
  agentQuestion: null,
};

function wait(overrides: Partial<EscalationWait> = {}): EscalationWait {
  return {
    waitId: WAIT_ID,
    runId: RUN_ID,
    kind: 'choose-candidate',
    openedAt: '2026-09-06T08:00:00.000Z',
    openedBy: null,
    options: [
      { id: 'candidate-a', label: 'Alice A' },
      { id: 'candidate-b', label: 'Bob B' },
      { id: 'mark-ambiguous', label: 'Mark the record ambiguous' },
    ],
    deadline: '2026-09-06T13:00:00.000Z',
    closedAt: null,
    closureKind: null,
    answerOptionId: null,
    actor: null,
    ...overrides,
  };
}

function renderPanel(input: Partial<React.ComponentProps<typeof EscalationPanel>> = {}): string {
  return renderToStaticMarkup(React.createElement(EscalationPanel, {
    runId: RUN_ID,
    wait: wait(),
    details: DETAILS_NONE,
    runRevision: 7,
    readAt: READ_AT,
    ...input,
  }));
}

describe('Escalation panel', () => {
  it('renders the bounded wait facts and names absent provenance instead of inventing it', () => {
    const html = renderPanel({
      wait: wait({ options: [{ id: 'candidate-a', label: '<b>hostile candidate</b>' }] }),
    });
    expect(html).toContain('Open Escalation');
    expect(html).toContain('Choose candidate');
    expect(html).toContain(ESCALATION_PANEL_COPY.noAgentQuestion);
    expect(html).toContain('Platform question');
    expect(html).toContain(ESCALATION_PANEL_COPY.questions['choose-candidate']);
    expect(html).toContain(ESCALATION_PANEL_COPY.noStep);
    expect(html).toContain(ESCALATION_PANEL_COPY.noSupportingEvidence);
    expect(html).toContain(ESCALATION_PANEL_COPY.answerNoteLabel);
    expect(html).toContain('&lt;b&gt;hostile candidate&lt;/b&gt;');
    expect(html).not.toContain('<b>hostile candidate</b>');
  });

  it('keeps answer buttons in the persisted FR-27 order and states that there is no recommendation', () => {
    const html = renderPanel();
    expect(html.indexOf('Alice A')).toBeLessThan(html.indexOf('Bob B'));
    expect(html.indexOf('Bob B')).toBeLessThan(html.indexOf('Mark record ambiguous'));
    expect(html).toContain('The platform expresses no recommendation.');
    expect(html).toContain('Select candidate 1');
    expect(html).toContain('Select candidate 2');
    expect(html).not.toContain('>Alice A</button>');
  });

  it('renders real metadata while keeping model text inert and fixed labels platform-owned', () => {
    const evidenceId = '019823ab-0000-7000-8000-000000000003';
    const html = renderPanel({
      details: {
        stepId: 'step-42',
        supportingEvidenceIds: [evidenceId],
        workItemId: '019823ab-0000-7000-8000-000000000004',
        agentQuestion: '<script>ignore this</script> Which candidate is correct?',
      },
    });
    expect(html).toContain('step-42');
    expect(html).toContain(`href="/runs/${RUN_ID}/evidence#evidence-${evidenceId}"`);
    expect(html).toContain('Untrusted source content — AGENT-GENERATED question.');
    expect(html).toContain('&lt;script&gt;ignore this&lt;/script&gt; Which candidate is correct?');
    expect(html).not.toContain('<script>ignore this</script>');

    const fixed = renderPanel({
      wait: wait({
        kind: 'retry-or-skip',
        options: [
          { id: 'abort', label: '<b>bad abort</b>' },
          { id: 'skip', label: '<b>bad skip</b>' },
          { id: 'retry', label: '<b>bad retry</b>' },
        ],
      }),
    });
    expect(fixed).toContain('Retry');
    expect(fixed).toContain('Skip');
    expect(fixed).toContain('Abort');
    expect(fixed).not.toContain('bad retry');
    expect(fixed).not.toContain('bad skip');
    expect(fixed).not.toContain('bad abort');
  });

  it('normalizes fixed answer order and leaves the candidate order grounded in the wait', () => {
    const fixed = wait({
      kind: 'retry-or-skip',
      options: [
        { id: 'abort', label: 'Abort' },
        { id: 'skip', label: 'Skip' },
        { id: 'retry', label: 'Retry' },
      ],
    });
    expect(orderedEscalationOptions(fixed).map((option) => option.id)).toEqual(['retry', 'skip', 'abort']);

    const candidates = wait({
      options: [
        { id: 'candidate-b', label: 'Bob B' },
        { id: 'mark-ambiguous', label: 'Mark the record ambiguous' },
        { id: 'candidate-a', label: 'Alice A' },
      ],
    });
    expect(orderedEscalationOptions(candidates).map((option) => option.id)).toEqual(['candidate-b', 'candidate-a', 'mark-ambiguous']);
  });

  it('uses the request snapshot instant for a deterministic initial countdown', () => {
    expect(countdownText(4 * 60 * 60 * 1_000)).toBe('04:00:00');
    expect(countdownText(3_599_001)).toBe('01:00:00');
    expect(countdownText(-1)).toBe('00:00:00');
    expect(countdownText(Number.NaN)).toBe('Unknown');
    expect(renderPanel()).toContain('04:00:00');
  });
});

describe('Run-detail Escalation read seam', () => {
  it('refuses request-level metadata reads before constructing the repository', async () => {
    authorizeRead.mockResolvedValue({ allowed: false, reason: 'You are not allowed to view Runs.' });

    const result = await readOpenEscalation(RUN_ID);
    expect(result).toEqual({
      wait: null,
      pause: null,
      runRevision: null,
      details: null,
    });
    expect(JSON.stringify(result)).not.toContain('question');
    expect(authorizeRead).toHaveBeenCalledWith('run.initiate');
    expect(runtimeRead).not.toHaveBeenCalled();
  });

  it('returns the wait and revision from one repository transaction', async () => {
    const opened = wait();
    const transaction = vi.fn(async (_runId: string, work: (context: unknown) => Promise<unknown>) =>
      work({ wait: opened, run: { revision: 19 }, readEscalationDetails: async () => DETAILS_NONE }));
    const repository = { transaction } as unknown as Pick<WaitRepository, 'transaction'>;

    await expect(readOpenEscalationWith(repository, RUN_ID)).resolves.toEqual({
      wait: opened,
      pause: null,
      runRevision: 19,
      details: DETAILS_NONE,
    });
    expect(transaction).toHaveBeenCalledWith(RUN_ID, expect.any(Function));
  });

  /**
   * A pause is a wait and is NOT an Escalation, so it reads as no open Escalation at all.
   * The panel that asks a question takes an `EscalationWait`, so a pause cannot reach it
   * even if a later caller forgets — this pins the read that makes that true.
   */
  it('reads an open pause as the pause, never as an Escalation', async () => {
    const paused = { ...wait(), kind: 'pause' as const, openedBy: 'auditor', options: [{ id: 'resume', label: 'Resume' }] };
    const repository = {
      transaction: async (_runId: string, work: (context: unknown) => Promise<unknown>) =>
        work({ wait: paused, run: { revision: 4 }, readEscalationDetails: async () => DETAILS_NONE }),
    } as unknown as Pick<WaitRepository, 'transaction'>;

    await expect(readOpenEscalationWith(repository, RUN_ID)).resolves.toEqual({
      wait: null,
      pause: paused,
      runRevision: 4,
      details: null,
    });
  });

  it('does not manufacture a revision when the repository has no current Run', async () => {
    const repository = {
      transaction: async (_runId: string, work: (context: unknown) => Promise<unknown>) =>
        work({ wait: null, run: null, readEscalationDetails: async () => null }),
    } as unknown as Pick<WaitRepository, 'transaction'>;
    await expect(readOpenEscalationWith(repository, RUN_ID)).resolves.toEqual({ wait: null, pause: null, runRevision: null, details: null });
  });
});
