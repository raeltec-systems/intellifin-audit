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

import type { RunWait } from '@intellifin/application';
import type { RunRecord } from '@intellifin/domain';

import { PAUSE_COPY } from '../design/copy';
import { PauseBanners } from './detail';

/**
 * The Paused banner's branch table (Story 5.4), which had no test at all.
 *
 * It is `OpenEscalationSection`'s table one component along, and the case that matters is
 * the one the sibling was already fixed for: a `PAUSED` Run whose wait cannot be read must
 * SAY SO rather than render nothing. `readOpenEscalation` returns every field `null` when
 * its role check refuses, so this is a state a reader reaches.
 */

const RUN_ID = '019823ab-0000-7000-8000-000000000001';
const READ_AT = new Date('2026-09-10T09:00:00.000Z');

const PAUSE: RunWait = {
  waitId: '019823ab-0000-7000-8000-000000000002',
  runId: RUN_ID,
  kind: 'pause',
  openedAt: '2026-09-10T08:55:00.000Z',
  openedBy: 'Daniel Okonjo',
  options: [],
  deadline: '2026-09-10T09:25:00.000Z',
  closedAt: null,
  closureKind: null,
  answerOptionId: null,
  actor: null,
} as unknown as RunWait;

function run(state: RunRecord['state'], pauseRequest: RunRecord['pauseRequest'] = null): RunRecord {
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
    pauseRequest,
    predecessorRunId: null,
  } as unknown as RunRecord;
}

function render(state: RunRecord['state'], pause: RunWait | null, pauseRequest: RunRecord['pauseRequest'] = null): string {
  return renderToStaticMarkup(
    React.createElement(PauseBanners, { run: run(state, pauseRequest), pause, readAt: READ_AT }),
  );
}

describe('the Paused banner', () => {
  it('names who paused the Run, when, and when it ends', () => {
    const html = render('PAUSED', PAUSE);
    expect(html).toContain('Daniel Okonjo');
    expect(html).toContain('Resumes on your action');
    expect(html).not.toContain(PAUSE_COPY.unreadable);
  });

  it('shows a countdown, not only two absolute timestamps', () => {
    // EXPERIENCE.md asks for one in three places (115, 149, 292): "Paused (30 min) and
    // Awaiting Auditor (4 h) show a countdown". The pause opened at 08:55 with a 30-minute
    // window, and the server read at 09:00, so 25 minutes remain — counted from `readAt`
    // so the first client render matches the server's rather than reporting a hydration
    // mismatch on what is only a clock.
    //
    // It is a `role="timer"` and NOT a live region: one that announced itself would read
    // the time out once a second for the whole wait, which is the Story 4.8 defect.
    const html = render('PAUSED', PAUSE);
    expect(html).toContain('role="timer"');
    expect(html).toContain('00:25:00');
    expect(html).not.toContain('aria-live');
    // The absolute instants stay beside it: the countdown says how long, the stamps say
    // when, and an auditor reading a sealed record needs the second.
    expect(html).toContain('2026-09-10T09:25:00.000Z');
  });

  it('says a PAUSED Run whose wait cannot be read is paused, rather than rendering nothing', () => {
    // The whole point. `readOpenEscalation` answers all-nulls on an authorization denial,
    // and `pause` is null whenever the row is missing, closed, or not of kind `pause`.
    for (const unreadable of [null, { ...PAUSE, openedBy: null } as unknown as RunWait]) {
      const html = render('PAUSED', unreadable);
      expect(html).toContain(PAUSE_COPY.unreadable);
      expect(html).not.toBe('');
    }
  });

  it('shows the request while it is still unhonoured, and only while the Run is active', () => {
    const request = {
      requestedBy: 'Amara Chen',
      requestedAt: '2026-09-10T08:59:00.000Z',
      reason: null,
      sessionId: '019823ab-0000-7000-8000-000000000006',
    };
    expect(render('RUNNING', null, request as unknown as RunRecord['pauseRequest'])).toContain('Amara Chen');
    // A terminal Run carrying a leftover marker was never paused; the Timeline records it
    // as superseded, and repeating it here would assert a hold that never happened.
    expect(render('COMPLETED', null, request as unknown as RunRecord['pauseRequest'])).toBe('');
  });

  it('renders nothing in a state that holds no pause', () => {
    expect(render('RUNNING', null)).toBe('');
    expect(render('COMPLETED', null)).toBe('');
  });
});
