import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Replay's bounded history, through the PAGE's own reads (Story 10.9).
 *
 * The default view read the first 500 waits, Observation registrations and Exceptions and
 * said nothing of the rest: the count beside a frame stopped growing after the 500th
 * registration, and the jump list read as every question and Exception the Run had. This
 * renders the page with the database and the viewer stood in for, and reads back what it
 * handed the viewer: the exact totals, each frame's exact count as the read gave it, and an
 * Escalation past the frames read sent to the inspection page that holds its frame. The
 * browser proof is `tests/e2e/replay-bounded-history.spec.ts`.
 */

const calls = vi.hoisted(() => ({
  openRun: vi.fn(), timeline: vi.fn(), frames: vi.fn(), escalations: vi.fn(), exceptions: vi.fn(), plan: vi.fn(),
}));
vi.mock('@intellifin/infrastructure', () => ({
  REPLAY_INSPECTION_PAGE_SIZE: 100, REPLAY_PAGE_SIZE: 500, readRecordNames: async () => new Map(),
  DrizzleRunDetailRepository: class {
    readTimeline = calls.timeline; readFrames = calls.frames;
    readEscalations = calls.escalations; readReplayExceptions = calls.exceptions;
    readEvidenceItems = async () => []; readEvidenceItemsByIds = async () => [];
    readReplayGaps = async () => ({ missing: 0, suppressed: 0, rows: [] });
    readInspectionReplay = async () => ({ kind: 'unavailable' });
  },
  DrizzleFrozenExecutionReader: class { readFrozenExecution = calls.plan; },
}));
vi.mock('../../../../src/bootstrap', () => ({ getRuntime: async () => ({ db: {} }) }));
vi.mock('../../../../src/runs/detail', () => ({ openRun: calls.openRun,
  RunDenied: () => React.createElement('p', null, 'Run denied'), runTabHref: (id: string) => `/runs/${id}` }));
vi.mock('../../../../src/runs/ReplayViewer', () => ({
  ReplayViewer: (props: unknown) => React.createElement('pre', { 'data-props': '' }, JSON.stringify(props)),
}));

import RunReplayPage from './page';

const RUN_ID = '019823ab-0000-7000-8000-000000000081';
const WORK_ITEM = '019823ab-0000-7000-8000-000000000082';
const STEP = '019823ab-0000-7000-8000-000000000083';
const ACTION = '019823ab-0000-7000-8000-000000000084';
const FRAME = '019823ab-0000-7000-8000-000000000085';
const AT = '2026-09-26T00:00:10.000Z';

interface Handed {
  readonly frames: readonly { readonly evidenceId: string; readonly observations: number }[];
  readonly jumpTargets: readonly Record<string, unknown>[];
  readonly jumpTotals: { readonly escalations: number; readonly exceptions: number } | null;
}

async function handedToTheViewer(): Promise<Handed> {
  const html = renderToStaticMarkup(await RunReplayPage({ params: Promise.resolve({ id: RUN_ID }), searchParams: Promise.resolve({}) }));
  const json = html.match(/<pre data-props="">([\s\S]*?)<\/pre>/)?.[1];
  if (json === undefined) throw new Error('The page rendered no viewer.');
  return JSON.parse(json.replaceAll('&quot;', '"').replaceAll('&#x27;', '\'').replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>').replaceAll('&amp;', '&')) as Handed;
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.openRun.mockResolvedValue({ allowed: true, readAt: new Date('2026-09-26T00:00:00Z'),
    run: { runId: RUN_ID, state: 'COMPLETED', procedureName: 'Replay bounds', versionId: 'version', procedureId: 'procedure' } });
  calls.plan.mockResolvedValue({ sessionSteps: [], targetSystems: [], inputs: { instructions: [],
    targets: [{ registrationId: 'prodconsole', displayName: 'ProdConsole' }] } });
  calls.timeline.mockResolvedValue({ workspace: null, sessionSteps: [],
    stepExecutions: { rows: [{ stepExecutionId: STEP, planStepId: 'target-1-1', workItemId: WORK_ITEM, action: 'inspect-record',
      state: 'SUCCEEDED', attempt: 1, startedAt: AT, completedAt: null, diagnostic: null }], total: 1 },
    toolActions: { rows: [{ toolActionId: ACTION, stepExecutionId: STEP, action: 'read-attribute', method: 'GET',
      destination: 'https://prodconsole.invalid/configuration', outcome: 'performed', status: 200, denial: null,
      capture: 'PERMITTED', captureSuppression: null, startedAt: AT }], total: 1 },
    workItems: [{ workItemId: WORK_ITEM, subjectKey: null, displayName: 'ProdConsole', registrationId: 'prodconsole',
      stepId: 'target-1-1', state: 'OBSERVED', attempts: 1, cycles: 0, observations: 612, diagnostic: null, evidenceId: null, ordinal: 1 }] });
  // One frame read of 900 the Run holds; the count beside it is the READ's, over the whole
  // registration history -- 1,000 is more than a page of 500 registration events could sum.
  calls.frames.mockResolvedValue({ total: 900, rows: [{ evidenceId: FRAME, toolActionId: ACTION, stepExecutionId: STEP,
    workItemId: WORK_ITEM, action: 'read-attribute', digest: 'a'.repeat(64), size: 10, mediaType: 'image/png',
    sourceLocation: 'https://prodconsole.invalid/configuration', capturedAt: AT, actionStartedAt: AT, observations: 1_000 }] });
  calls.escalations.mockResolvedValue({ total: 612, rows: [
    // At the frame read: it lands there.
    { waitId: 'w-read', kind: 'choose-candidate', openedAt: '2026-09-26T00:00:11.000Z', closedAt: '2026-09-26T00:00:12.000Z',
      closureKind: 'answer', answerOptionId: 'candidate-1', framesThrough: 1, landing: { workItemId: WORK_ITEM, cursor: 0 } },
    // Its frame is the 812th, which the page never read: the page that holds it is the ninth.
    { waitId: 'w-late', kind: 'unnamed-value', openedAt: '2026-09-26T02:00:00.000Z', closedAt: '2026-09-26T02:00:01.000Z',
      closureKind: 'answer', answerOptionId: 'unevaluated', framesThrough: 812, landing: { workItemId: WORK_ITEM, cursor: 800 } },
  ] });
  calls.exceptions.mockResolvedValue({ total: 1_204, rows: [
    { exceptionId: 'x-1', workItemId: WORK_ITEM, populationRecordKey: 'parameter-0001', raisedAt: AT },
  ] });
});

describe('Replay’s bounded history, through the page’s own reads (Story 10.9)', () => {
  it('reads the Escalations and the Exceptions WITH their totals, at Replay’s own bound', async () => {
    await handedToTheViewer();
    expect(calls.escalations).toHaveBeenCalledWith(RUN_ID, 500);
    expect(calls.exceptions).toHaveBeenCalledWith(RUN_ID, 500);
  });

  it('hands the viewer the EXACT totals beside the bounded pages', async () => {
    expect((await handedToTheViewer()).jumpTotals).toEqual({ escalations: 612, exceptions: 1_204 });
  });

  it('puts the read’s own exact count beside each frame, never a sum over a page of events', async () => {
    expect((await handedToTheViewer()).frames).toMatchObject([{ evidenceId: FRAME, observations: 1_000 }]);
  });

  it('lands an Escalation at the frame read, and sends one past it to the page that holds its frame', async () => {
    const targets = (await handedToTheViewer()).jumpTargets.filter((target) => target['kind'] === 'escalation');
    expect(targets).toEqual([
      expect.objectContaining({ id: 'w-read', frameIndex: 0, absence: null }),
      expect.objectContaining({ id: 'w-late', frameIndex: null, absence: 'not-read', workItemId: WORK_ITEM, inspectionCursor: 800 }),
    ]);
  });
});
