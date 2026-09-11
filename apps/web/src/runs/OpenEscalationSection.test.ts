import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: vi.fn() }));
vi.mock('../../app/runs/actions', () => ({
  answerEscalationAction: vi.fn(),
  cancelRunAction: vi.fn(),
  pauseRunAction: vi.fn(),
  resumeRunAction: vi.fn(),
  rerunRunAction: vi.fn(),
  flagRunFormAction: vi.fn(),
}));
vi.mock('../server-session', () => ({ requireServerAction: vi.fn() }));
vi.mock('../bootstrap', () => ({ getRuntime: vi.fn() }));
vi.mock('@intellifin/infrastructure', () => ({
  CryptoUuidV7Generator: class { next(): string { return '019823ab-0000-7000-8000-00000000000f'; } },
  DrizzleRunDetailRepository: class {},
  DrizzleRunRepository: class {},
  PostgresEvaluationReviewRepository: class {},
  PostgresWaitRepository: class {},
  readTimelineHead: vi.fn(),
}));

import type { EscalationWait, RunWait } from '@intellifin/application';
import type { RunRecord } from '@intellifin/domain';

import { ESCALATION_PANEL_COPY } from '../design/copy';
import { OpenEscalationSection } from './detail';
import type { OpenEscalationRead } from './escalation-read';

/**
 * The ONE Escalation mount, which Run Detail and Live View both use (Story 5.6).
 *
 * The branch table is what is tested, because it is what two copies would have diverged
 * on: a panel when the wait reads, a Banner when it does not, and nothing at all in a state
 * that holds no question. A surface that rendered nothing for an unreadable open wait would
 * tell a reader the Run is simply busy.
 */

const RUN_ID = '019823ab-0000-7000-8000-000000000001';
const READ_AT = new Date('2026-09-10T09:00:00.000Z');

const WAIT: EscalationWait = {
  waitId: '019823ab-0000-7000-8000-000000000002',
  runId: RUN_ID,
  kind: 'choose-candidate',
  openedAt: '2026-09-10T08:00:00.000Z',
  openedBy: null,
  options: [
    { id: 'candidate-a', label: 'Alice A' },
    { id: 'mark-ambiguous', label: 'Mark the record ambiguous' },
  ],
  deadline: '2026-09-10T13:00:00.000Z',
  closedAt: null,
  closureKind: null,
  answerOptionId: null,
  actor: null,
};

function run(state: RunRecord['state']): RunRecord {
  return {
    runId: RUN_ID,
    procedureId: '019823ab-0000-7000-8000-000000000003',
    versionId: '019823ab-0000-7000-8000-000000000004',
    versionNumber: 1,
    procedureName: 'Terminated users',
    periodFrom: '2026-10-01',
    periodTo: '2026-10-01',
    state,
    kind: 'STANDARD',
    initiatorId: '019823ab-0000-7000-8000-000000000005',
    initiatedAt: '2026-09-10T08:00:00.000Z',
    revision: 4,
    cancellation: null,
    pauseRequest: null,
    predecessorRunId: null,
  } as unknown as RunRecord;
}

function read(overrides: Partial<OpenEscalationRead> = {}): OpenEscalationRead {
  return { wait: WAIT, pause: null, runRevision: 4, details: null, ...overrides };
}

function render(state: RunRecord['state'], escalation: OpenEscalationRead | null): string {
  return renderToStaticMarkup(
    React.createElement(OpenEscalationSection, { run: run(state), escalation, readAt: READ_AT }),
  );
}

describe('the shared open-Escalation mount', () => {
  it('renders the panel when the wait and its revision read', () => {
    const html = render('AWAITING_AUDITOR', read());
    expect(html).toContain('Open Escalation');
    expect(html).toContain(ESCALATION_PANEL_COPY.skipLink);
    expect(html).toContain(ESCALATION_PANEL_COPY.questions['choose-candidate']);
  });

  it('says the wait could not be read rather than rendering nothing', () => {
    for (const unreadable of [read({ wait: null }), read({ runRevision: null })]) {
      const html = render('AWAITING_AUDITOR', unreadable);
      expect(html).toContain(ESCALATION_PANEL_COPY.unavailable);
      expect(html).not.toContain('Open Escalation');
    }
  });

  it('renders nothing in a state that holds no question, pause included', () => {
    const pause: RunWait = { ...WAIT, kind: 'pause', options: [] } as unknown as RunWait;
    expect(render('RUNNING', null)).toBe('');
    expect(render('PAUSED', read({ wait: null, pause }))).toBe('');
    // The read is made in the PAUSED state too, and a pause is not an Escalation: it must
    // not reach this mount even when the same read carried it.
    expect(render('PAUSED', read({ wait: null, pause }))).not.toContain(ESCALATION_PANEL_COPY.unavailable);
  });
});
