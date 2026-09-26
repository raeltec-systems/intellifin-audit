import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Live View's adapter log, through the PAGE's own read path (Story 10.6, legacy 5.3 AC 2;
 * owner decision 2026-09-25).
 *
 * The page passed `digest: null` for every Adapter Session Step row, so an acquired step
 * said "No artifact registered." over the artifact the Run had registered, and the
 * component's own test could not see it: the component was right and the page starved it.
 * So this renders the page itself, with only the database and the client components
 * stood in for, and reads back what it handed the viewer in each of the three situations:
 * an acquired step with Evidence, a step with no artifact, and an unavailable read. The
 * browser proof of the first two is `tests/e2e/live-view.spec.ts`.
 */

const calls = vi.hoisted(() => ({
  openRun: vi.fn(),
  byIds: vi.fn(),
  overview: vi.fn(),
  timeline: vi.fn(),
}));

vi.mock('@intellifin/infrastructure', () => ({
  DrizzleActorNameReader: class { namesFor = async () => new Map(); },
  DrizzleFrozenExecutionReader: class { readFrozenExecution = async () => null; },
  DrizzleRunDetailRepository: class {
    readTimeline = calls.timeline;
    readLatestFrame = async () => null;
    readLatestStepExecution = async () => null;
    readAgentWorkPosition = async () => null;
    readEvidenceItems = calls.overview;
    readEvidenceItemsByIds = calls.byIds;
    readFlags = async () => [];
    readStepExecution = async () => null;
    readLogicalStepProgress = async () => ({ started: 0, units: 0, retries: 0 });
  },
  readRecordNames: async () => new Map(),
  readTimelineHead: async () => 0,
}));
vi.mock('../../../../src/bootstrap', () => ({ getRuntime: async () => ({ db: {} }) }));
vi.mock('../../../../src/runs/detail', () => ({
  openRun: calls.openRun,
  RunDenied: () => React.createElement('p', null, 'Run denied'),
  runTabHref: (id: string, tab: string) => `/runs/${id}${tab === '' ? '' : `/${tab}`}`,
  CancellationBanners: () => null,
  OpenEscalationSection: () => null,
  PauseBanners: () => null,
}));
vi.mock('../../../../src/runs/escalation-read', () => ({ readOpenEscalation: async () => null }));
// The Paused banner's hold (Story 10.6, legacy 5.4); `PauseBanners` itself is stood in for above.
vi.mock('../../../../src/runs/pause-read', () => ({ readPauseHold: async () => ({ kind: 'none' }) }));
vi.mock('../../../../src/runs/LiveGate', () => ({
  LiveGate: ({ children, header }: { readonly children?: React.ReactNode; readonly header?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, header, children),
}));
vi.mock('../../../../src/runs/SharedRunControl', () => ({
  SharedRunControl: ({ children }: { readonly children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock('../../../../src/runs/RunCancelControl', () => ({ RunCancelControl: () => null }));
vi.mock('../../../../src/runs/RunFlagControl', () => ({ RunFlagControl: () => null }));
vi.mock('../../../../src/runs/RunPauseControls', () => ({ RunPauseControls: () => null }));
vi.mock('../../../../src/runs/RunControllerLease', () => ({ RunControllerLease: () => null }));
vi.mock('../../../../src/runs/LiveViewer', () => ({
  LiveViewer: (props: { readonly adapterSteps: unknown }) =>
    React.createElement('pre', { 'data-adapter-steps': '' }, JSON.stringify(props.adapterSteps)),
}));

import RunLivePage from './page';

const RUN_ID = '019823ab-0000-7000-8000-000000000061';
const REGISTERED = '019823ab-0000-7000-8000-0000000000e1';
const RESERVED = '019823ab-0000-7000-8000-0000000000e2';
const DIGEST = 'f'.repeat(64);

function sessionStep(stepId: string, displayName: string, state: string, evidenceId: string | null) {
  return { stepId, ordinal: 2, displayName, action: 'extract-adapter', registrationId: displayName.toLowerCase(),
    state, attempts: 1, diagnostic: null, evidenceId };
}

/** What the page handed the viewer, read back out of the rendered HTML. */
async function adapterSteps(): Promise<readonly { readonly stepId: string; readonly artifact: Record<string, unknown> }[]> {
  const html = renderToStaticMarkup(await RunLivePage({ params: Promise.resolve({ id: RUN_ID }) }));
  const json = html.match(/<pre data-adapter-steps="">([\s\S]*?)<\/pre>/)?.[1];
  if (json === undefined) throw new Error('The page rendered no viewer.');
  return JSON.parse(json.replaceAll('&quot;', '"').replaceAll('&amp;', '&')) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.openRun.mockResolvedValue({
    allowed: true,
    readAt: new Date('2026-09-26T00:00:00Z'),
    run: { runId: RUN_ID, state: 'RUNNING', procedureName: 'Adapter log', versionId: 'version', procedureId: 'procedure',
      pauseRequest: null, cancellation: null, initiatedAt: '2026-09-26T00:00:00.000Z' },
  });
  calls.timeline.mockResolvedValue({
    workspace: null,
    sessionSteps: [
      sessionStep('session-2', 'RoleMatrix', 'ACQUIRED', REGISTERED),
      sessionStep('session-3', 'AccessGate', 'IN_PROGRESS', null),
      sessionStep('session-4', 'CoreDirectory', 'IN_PROGRESS', RESERVED),
    ],
    workItems: [],
    stepExecutions: { rows: [], total: 0 },
    toolActions: { rows: [], total: 0 },
  });
  calls.overview.mockResolvedValue([]);
  calls.byIds.mockResolvedValue([
    { evidenceId: REGISTERED, state: 'REGISTERED', digest: DIGEST },
    { evidenceId: RESERVED, state: 'RESERVED', digest: null },
  ]);
});

describe('Live View’s adapter log, through the page’s own read (Story 10.6, legacy 5.3)', () => {
  it('gives an acquired step the digest of the Evidence it registered, and a step with none no digest', async () => {
    const steps = await adapterSteps();
    expect(steps.map((step) => [step.stepId, step.artifact])).toEqual([
      ['session-2', { kind: 'registered', evidenceId: REGISTERED, digest: DIGEST }],
      ['session-3', { kind: 'none' }],
      // A reservation that was never registered: "No artifact registered." is true of it.
      ['session-4', { kind: 'none' }],
    ]);
  });

  it('reads the Evidence EXACTLY by the ids the steps name, never through the bounded overview', async () => {
    // The overview is a bounded sample ordered by kind; a Reference Source's artifact can
    // fall off its end. An overview that holds nothing must not change the answer.
    calls.overview.mockResolvedValue([]);
    await adapterSteps();
    expect(calls.byIds).toHaveBeenCalledTimes(1);
    expect(calls.byIds).toHaveBeenCalledWith(RUN_ID, [REGISTERED, RESERVED]);
  });

  it('says the record could not be read — not that there is none — when the Evidence read fails', async () => {
    calls.byIds.mockRejectedValue(new Error('connection reset'));
    const steps = await adapterSteps();
    expect(steps.map((step) => [step.stepId, step.artifact.kind])).toEqual([
      ['session-2', 'unavailable'],
      // A step that names no artifact needed no read, so the failure does not reach it.
      ['session-3', 'none'],
      ['session-4', 'unavailable'],
    ]);
  });
});
