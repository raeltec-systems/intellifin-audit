import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Replay's gaps, through the PAGE's own read (Story 10.6, legacy 5.2).
 *
 * The platform recorded `failure.frame-missing` and counted missing frames on the Result,
 * and Replay said neither: a session with a gap looked complete. This renders the page with
 * only the database and the viewer stood in for, and reads back what it handed the viewer —
 * the exact counts, each gap in words, and a suppressed capture kept apart from a missing
 * frame. The browser proof is `tests/e2e/replay.spec.ts`.
 */

const calls = vi.hoisted(() => ({ openRun: vi.fn(), gaps: vi.fn(), timeline: vi.fn(), plan: vi.fn() }));
vi.mock('@intellifin/infrastructure', () => ({
  REPLAY_INSPECTION_PAGE_SIZE: 100, REPLAY_PAGE_SIZE: 500, readRecordNames: async () => new Map(),
  DrizzleRunDetailRepository: class {
    readTimeline = calls.timeline; readFrames = async () => ({ rows: [], total: 0 });
    readEscalations = async () => ({ rows: [], total: 0 }); readReplayExceptions = async () => ({ rows: [], total: 0 });
    readEvidenceItems = async () => []; readEvidenceItemsByIds = async () => [];
    readReplayGaps = calls.gaps;
    readInspectionReplay = async () => ({ kind: 'unavailable' });
  },
  DrizzleFrozenExecutionReader: class { readFrozenExecution = calls.plan; },
}));
vi.mock('../../../../src/bootstrap', () => ({ getRuntime: async () => ({ db: {} }) }));
vi.mock('../../../../src/runs/detail', () => ({ openRun: calls.openRun,
  RunDenied: () => React.createElement('p', null, 'Run denied'), runTabHref: (id: string) => `/runs/${id}` }));
vi.mock('../../../../src/runs/ReplayViewer', () => ({
  ReplayViewer: (props: { readonly gaps?: unknown }) => React.createElement('pre', { 'data-gaps': '' }, JSON.stringify(props.gaps ?? null)),
}));

import { captureSentence } from '../../../../src/runs/labels';
import { REPLAY_GAP_WORDS } from '../../../../src/runs/replay';
import RunReplayPage from './page';

const RUN_ID = '019823ab-0000-7000-8000-000000000071';
const WORK_ITEM = '019823ab-0000-7000-8000-000000000072';

async function gapsHandedToTheViewer(query: Record<string, string> = {}): Promise<unknown> {
  const html = renderToStaticMarkup(await RunReplayPage({ params: Promise.resolve({ id: RUN_ID }), searchParams: Promise.resolve(query) }));
  const json = html.match(/<pre data-gaps="">([\s\S]*?)<\/pre>/)?.[1];
  if (json === undefined) throw new Error('The page rendered no viewer.');
  return JSON.parse(json.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.openRun.mockResolvedValue({ allowed: true, readAt: new Date('2026-09-26T00:00:00Z'),
    run: { runId: RUN_ID, state: 'COMPLETED', procedureName: 'Replay gaps', versionId: 'version', procedureId: 'procedure' } });
  calls.plan.mockResolvedValue({ sessionSteps: [], targetSystems: [], inputs: { instructions: [],
    targets: [{ registrationId: 'loancore', displayName: 'LoanCore' }] } });
  calls.timeline.mockResolvedValue({ workspace: null, sessionSteps: [], stepExecutions: { rows: [], total: 0 },
    toolActions: { rows: [], total: 0 },
    workItems: [{ workItemId: WORK_ITEM, subjectKey: 'E-000102', displayName: 'LoanCore', registrationId: 'loancore',
      stepId: 'target-1', state: 'COMPLETED', attempts: 1, cycles: 1, observations: 1, diagnostic: null, evidenceId: null, ordinal: 1 }] });
  calls.gaps.mockResolvedValue({
    missing: 3,
    suppressed: 1,
    rows: [
      { toolActionId: 'sign-in', kind: 'suppressed', action: 'navigate', startedAt: '2026-09-26T00:00:01.000Z',
        stepExecutionId: 'step-1', workItemId: null, targetSystem: 'loancore', captureSuppression: 'credential-entry', framesBefore: 0 },
      { toolActionId: 'lost', kind: 'missing', action: 'open-record', startedAt: '2026-09-26T00:00:05.000Z',
        stepExecutionId: 'step-2', workItemId: WORK_ITEM, targetSystem: 'loancore', captureSuppression: null, framesBefore: 2 },
    ],
  });
});

describe('Replay’s gaps, through the page’s own read (Story 10.6, legacy 5.2)', () => {
  it('hands the viewer the exact counts and each gap in words, a suppressed capture in its own sentence', async () => {
    expect(await gapsHandedToTheViewer()).toEqual({
      // The EXACT counts, never the length of the bounded list of positions.
      missing: 3,
      suppressed: 1,
      rows: [
        { toolActionId: 'sign-in', kind: 'suppressed', mark: captureSentence('SUPPRESSED', 'credential-entry'),
          narration: 'Opening a page on LoanCore', framesBefore: 0 },
        { toolActionId: 'lost', kind: 'missing', mark: REPLAY_GAP_WORDS.missing,
          narration: 'Opening the record for E-000102 on LoanCore', framesBefore: 2 },
      ],
    });
    expect(calls.gaps).toHaveBeenCalledWith(RUN_ID);
  });

  it('reads no gaps for one record’s inspection page, which is not the whole session', async () => {
    expect(await gapsHandedToTheViewer({ workItem: WORK_ITEM })).toBeNull();
    expect(calls.gaps).not.toHaveBeenCalled();
  });
});
