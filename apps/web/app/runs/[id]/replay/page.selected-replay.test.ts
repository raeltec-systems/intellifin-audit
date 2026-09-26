import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ openRun: vi.fn(), read: vi.fn(), prefix: vi.fn(), plan: vi.fn(), names: vi.fn(), frames: vi.fn(), gaps: vi.fn() }));
vi.mock('@intellifin/infrastructure', () => ({
  REPLAY_INSPECTION_PAGE_SIZE: 100, REPLAY_PAGE_SIZE: 500, readRecordNames: calls.names, readReplayCaptureGaps: calls.gaps,
  DrizzleRunDetailRepository: class {
    readInspectionReplay = calls.read; readTimeline = calls.prefix; readFrames = calls.frames;
    readWaits = async () => []; readObservationDeltas = async () => []; readExceptions = async () => ({ rows: [] });
    readEvidenceItems = async () => [];
  },
  DrizzleFrozenExecutionReader: class { readFrozenExecution = calls.plan; },
}));
vi.mock('../../../../src/bootstrap', () => ({ getRuntime: async () => ({ db: {} }) }));
vi.mock('../../../../src/runs/detail', () => ({ openRun: calls.openRun,
  RunDenied: () => React.createElement('p', null, 'Run denied'), runTabHref: (id: string) => `/runs/${id}` }));
vi.mock('../../../../src/runs/ReplayViewer', () => ({ ReplayViewer: (props: unknown) => React.createElement('pre', null, JSON.stringify(props)) }));
import { ReplayViewer } from '../../../../src/runs/ReplayViewer';
import RunReplayPage from './page';

/** The key React gives the viewer in the page's tree: what decides whether it starts again. */
function viewerKey(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const child of node) { const key = viewerKey(child); if (key !== null) return key; }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  if (node.type === ReplayViewer) return node.key;
  return viewerKey((node.props as { readonly children?: unknown }).children);
}

const id = '019823ab-0000-7000-8000-000000000001';
const workItemId = '019823ab-0000-7000-8000-000000000002';
const view = (searchParams: { workItem?: string | string[]; cursor?: string | string[] }) =>
  RunReplayPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) });

beforeEach(() => {
  vi.clearAllMocks();
  calls.openRun.mockResolvedValue({ allowed: true, run: { runId: id, state: 'COMPLETED',
    procedureName: 'Selected Replay', versionId: 'version', procedureId: 'procedure' }, readAt: new Date('2026-09-20T00:00:00Z') });
  calls.plan.mockResolvedValue(null);
  calls.names.mockResolvedValue(new Map());
  calls.gaps.mockResolvedValue({ rows: [], total: 0, missing: 0, suppressed: 0 });
  calls.read.mockResolvedValue({ kind: 'inspection', workItem: { workItemId, subjectKey: 'E-LATE',
    displayName: 'LoanCore', registrationId: 'loancore' }, workspace: null, rows: [], total: 0, framesTotal: 600,
    cursor: 0, previousCursor: null, nextCursor: null });
});

describe('selected Replay route', () => {
  it('reauthorizes before any selected inspection read', async () => {
    calls.openRun.mockResolvedValue({ allowed: false, reason: 'forbidden' });
    expect(renderToStaticMarkup(await view({ workItem: workItemId }))).toContain('Run denied');
    expect(calls.read).not.toHaveBeenCalled(); expect(calls.plan).not.toHaveBeenCalled(); expect(calls.gaps).not.toHaveBeenCalled();
  });
  it('keeps active Runs on Live View without reading a replay', async () => {
    calls.openRun.mockResolvedValue({ allowed: true, run: { runId: id, state: 'RUNNING', procedureName: 'Active' }, readAt: new Date() });
    expect(renderToStaticMarkup(await view({ workItem: workItemId, cursor: '100' }))).toContain('Open Live View');
    expect(calls.read).not.toHaveBeenCalled(); expect(calls.prefix).not.toHaveBeenCalled();
  });
  it('loads the requested bounded page without any prefix timeline lookup', async () => {
    await view({ workItem: workItemId, cursor: '100' });
    expect(calls.openRun).toHaveBeenCalledWith(id);
    expect(calls.read).toHaveBeenCalledWith(id, workItemId, 100);
    expect(calls.prefix).not.toHaveBeenCalled();
    expect(calls.gaps).toHaveBeenCalledWith({}, id, workItemId);
  });
  it.each([{ workItem: [workItemId, workItemId] }, { workItem: workItemId, cursor: ['0', '0'] },
    { workItem: workItemId, cursor: '50' }, { cursor: '100' }])('does not query a capture for invalid request %j', async query => {
    const html = renderToStaticMarkup(await view(query));
    expect(html).toContain('unavailable'); expect(html).not.toContain('E-LATE');
    expect(calls.gaps).not.toHaveBeenCalled();
    expect(calls.read).not.toHaveBeenCalled(); expect(calls.prefix).not.toHaveBeenCalled();
  });
  it('uses the frozen target name and exact returned action/step facts for late narration', async () => {
    calls.plan.mockResolvedValue({ sessionSteps: [], targetSystems: [], inputs: { targets: [{ registrationId: 'loancore', displayName: 'Frozen LoanCore' }], instructions: [] } });
    const stored = { evidenceId: 'late-evidence', toolActionId: 'late-action', stepExecutionId: 'late-step', workItemId,
      action: 'read-attribute', digest: 'a'.repeat(64), size: 10, mediaType: 'image/png', sourceLocation: 'https://loancore.invalid/late',
      capturedAt: '2026-09-20T10:00:00Z', actionStartedAt: '2026-09-20T10:00:00Z' };
    calls.read.mockResolvedValue({ ...(await calls.read()), rows: [{ frame: stored, globalOrdinal: 506,
      inspectionOrdinal: 1, observations: 512, step: { action: 'inspect-record', planStepId: 'late-plan-step', startedAt: stored.actionStartedAt },
      action: { action: 'read-attribute', method: 'GET', startedAt: stored.actionStartedAt, diagnostic: 'PRIVATE_DIAGNOSTIC', downloads: 19, toolActionId: 'PRIVATE_TOOL_ID' } }], total: 105, nextCursor: 100 });
    calls.read.mockClear();
    const html = renderToStaticMarkup(await view({ workItem: workItemId }));
    // The narration is the returned action in audit words, on the frozen target's name; a
    // plan-step id is never narrated (UI cleanup 2026-09-22, UX-28).
    expect(html).toContain('Opening the record for E-LATE on Frozen LoanCore'); expect(html).not.toContain('late-plan-step');
    expect(html).toContain('512'); expect(html).toContain('506'); expect(html).toContain('late-evidence');
    expect(html).not.toContain('PRIVATE_DIAGNOSTIC'); expect(html).not.toContain('PRIVATE_TOOL_ID');
    expect(html).not.toContain('downloads'); expect(html).not.toContain('mediaType');
    expect(calls.prefix).not.toHaveBeenCalled();
  });
  it('names the selected record the way the record review does, and masks what the binding hides (UX-25)', async () => {
    const stored = { evidenceId: 'late-evidence', toolActionId: 'late-action', stepExecutionId: 'late-step', workItemId,
      action: 'read-attribute', digest: 'a'.repeat(64), size: 10, mediaType: 'image/png', sourceLocation: 'https://loancore.invalid/late',
      capturedAt: '2026-09-20T10:00:00Z', actionStartedAt: '2026-09-20T10:00:00Z' };
    calls.read.mockResolvedValue({ ...(await calls.read()), rows: [{ frame: stored, globalOrdinal: 506,
      inspectionOrdinal: 1, observations: 512, step: { action: 'inspect-record', planStepId: 'late-plan-step', startedAt: stored.actionStartedAt },
      action: { action: 'read-attribute', method: 'GET', startedAt: stored.actionStartedAt } }], total: 1 });
    const p1 = { sessionSteps: [], targetSystems: [], inputs: { templateId: 'P-1', instructions: [],
      targets: [{ registrationId: 'loancore', displayName: 'Frozen LoanCore' }] } };
    calls.plan.mockResolvedValue(p1);
    calls.names.mockResolvedValue(new Map([['E-LATE', 'Late Person']]));
    const named = renderToStaticMarkup(await view({ workItem: workItemId }));
    expect(named).toContain('E-LATE · Late Person');
    expect(calls.names).toHaveBeenCalledWith({}, id, p1, ['E-LATE']);

    // A key the frozen binding designates sensitive is never printed (FR-41).
    calls.plan.mockResolvedValue({ ...p1, inputs: { ...p1.inputs, sourceSnapshot: { contract: { sensitive_fields: ['employee_id', 'full_name'] } } } });
    const masked = renderToStaticMarkup(await view({ workItem: workItemId }));
    expect(masked).not.toContain('E-LATE');
    expect(masked).not.toContain('Late Person');
    expect(masked).toContain('••••');
  });
  it('keys the viewer by the request and never by the read, so a re-read keeps the reader\'s frame', async () => {
    // The shell's bell re-reads every page whenever any Run ends (BellLive). With the read
    // time in the key, each re-read restarted the viewer at its first frame under a reader
    // who was stepping through it (selected-replay.spec.ts found it on the live branch).
    const readAt = (iso: string) => calls.openRun.mockResolvedValue({ allowed: true, run: { runId: id, state: 'COMPLETED',
      procedureName: 'Selected Replay', versionId: 'version', procedureId: 'procedure' }, readAt: new Date(iso) });
    calls.prefix.mockResolvedValue({ workItems: [], stepExecutions: { rows: [] }, toolActions: { rows: [] }, sessionSteps: [], workspace: null });
    calls.frames.mockResolvedValue({ rows: [], total: 0 });
    for (const request of [{ workItem: workItemId, cursor: '100' }, {}, { workItem: [workItemId, workItemId] }]) {
      readAt('2026-09-20T00:00:00.000Z');
      const first = viewerKey(await view(request));
      readAt('2026-09-20T00:00:07.123Z');
      const reread = viewerKey(await view(request));
      expect(first).not.toBeNull();
      expect(reread).toBe(first);
    }
    // A different request still starts again at its own first frame: every page of an
    // inspection, the whole session and an unavailable request are distinct keys.
    const keys = await Promise.all([{ workItem: workItemId }, { workItem: workItemId, cursor: '100' }, {}, { cursor: '100' }]
      .map(async request => viewerKey(await view(request))));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

it('passes exact gap facts to session and selected inspection viewers', async () => {
  calls.prefix.mockResolvedValue({ workItems: [], stepExecutions: { rows: [] }, toolActions: { rows: [] }, sessionSteps: [], workspace: null });
  calls.frames.mockResolvedValue({ rows: [], total: 0 });
  calls.gaps.mockResolvedValue({ rows: [{ toolActionId: 'gap-action', kind: 'missing' }], total: 4, missing: 3, suppressed: 1 });
  for (const query of [{}, { workItem: workItemId }]) {
    const html = renderToStaticMarkup(await view(query));
    expect(html).toContain('gap-action'); expect(html).toContain('captureGaps');
    expect(html).toContain('&quot;missing&quot;:3');
  }
  expect(calls.gaps).toHaveBeenCalledWith({}, id);
  expect(calls.gaps).toHaveBeenCalledWith({}, id, workItemId);
});
