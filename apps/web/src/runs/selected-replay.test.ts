import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReplayViewer, type ReplayFrameView } from './ReplayViewer';
import { SessionStage } from './LiveViewer';
import { effectiveFrameWorkItemId, replayInspectionHref, replayJumpTargets, replayRequest } from './replay';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const runId = '019823ab-0000-7000-8000-000000000001';
const workItemId = '019823ab-0000-7000-8000-000000000002';
const evidenceId = '019823ab-0000-7000-8000-000000000003';
const frame: ReplayFrameView = { evidenceId, globalOrdinal: 606, narration: 'Inspect E-LATE on LoanCore.',
  stepNarration: 'Inspect E-LATE on LoanCore.', workItemLabel: 'E-LATE · LoanCore', workItemId, subjectKey: 'E-LATE',
  sourceLocation: 'https://loancore.invalid/accounts/E-LATE', digest: 'a'.repeat(64), capturedAt: '2026-09-20T10:00:00Z',
  action: { action: 'read-attribute', method: 'GET', destination: 'https://loancore.invalid/accounts/E-LATE',
    outcome: 'performed', status: 200, denial: null, capture: 'PERMITTED', captureSuppression: null,
    startedAt: '2026-09-20T10:00:00Z' }, observations: 512 };
const props: React.ComponentProps<typeof ReplayViewer> = {
  runId, runState: 'COMPLETED', frames: [frame], framesTotal: 610, stateSentence: 'Session REPLAY. This Run ended: COMPLETED.',
  workspace: null, plannedSteps: null, stageNote: null, jumpTargets: [], jumpTotals: null, instructions: [], adapterSteps: [],
  window: { kind: 'inspection', workItemId, label: 'E-LATE · LoanCore', cursor: 100, total: 105,
    previousCursor: 0, nextCursor: null },
};
const render = (overrides: Partial<typeof props> = {}) => renderToStaticMarkup(React.createElement(ReplayViewer, { ...props, ...overrides }));

describe('selected Replay requests', () => {
  it('retains a strict, canonical inspection and page identity', () => {
    expect(replayRequest({}, 100)).toEqual({ kind: 'prefix' });
    expect(replayRequest({ workItem: workItemId.toUpperCase() }, 100)).toEqual({ kind: 'inspection', workItemId, cursor: 0 });
    expect(replayRequest({ workItem: workItemId, cursor: '100' }, 100)).toEqual({ kind: 'inspection', workItemId, cursor: 100 });
    expect(replayInspectionHref(runId, workItemId, 100)).toBe(`/runs/${runId}/replay?workItem=${workItemId}&cursor=100`);
  });
  it.each(['', '01', '-100', '1e2', '100.0', '50', '100 ', '2147483700', ['100', '100']])('refuses ambiguous/invalid cursor %j', cursor => {
    expect(replayRequest({ workItem: workItemId, cursor }, 100)).toEqual({ kind: 'unavailable' });
  });
  it('refuses duplicate identities and a cursor without an inspection', () => {
    expect(replayRequest({ workItem: [workItemId, workItemId] }, 100)).toEqual({ kind: 'unavailable' });
    expect(replayRequest({ cursor: '0' }, 100)).toEqual({ kind: 'unavailable' });
    expect(replayRequest({ workItem: 'bad' }, 100)).toEqual({ kind: 'unavailable' });
  });
  it('uses the same Step owner for narration and frame targeting', () => {
    expect(effectiveFrameWorkItemId({ workItemId: null }, { workItemId })).toBe(workItemId);
    expect(effectiveFrameWorkItemId({ workItemId }, null)).toBe(workItemId);
  });
});

describe('bounded selected inspection markup', () => {
  it('shows global positions, inspection bounds and protected late capture, paused', () => {
    const html = render();
    expect(html).toContain('Frame 606 of 610');
    expect(html).toContain('Inspection frames 101–101 of 105');
    expect(html).toContain('Selected inspection: E-LATE · LoanCore');
    expect(html).toContain(`/api/runs/${runId}/frames/${evidenceId}`);
    expect(html).toContain('512 Observations');
    expect(html).toContain('>Play<');
    expect(html).not.toContain('Showing the first');
    expect(html).toContain(`href="/runs/${runId}/replay?workItem=${workItemId}"`);
    expect(html).not.toContain('Next inspection frames');
  });
  it('offers the next bounded page retaining inspection identity', () => {
    expect(render({ window: { kind: 'inspection', workItemId, label: 'E-LATE', cursor: 0, total: 105,
      previousCursor: null, nextCursor: 100 } })).toContain(`href="/runs/${runId}/replay?workItem=${workItemId}&amp;cursor=100"`);
  });
  it('never substitutes another capture for an empty or invalid selection', () => {
    const invalid = render({ frames: [], window: { kind: 'unavailable' }, initialSelection: { kind: 'unavailable', frameIndex: null } });
    expect(invalid).toContain('requested inspection is not available');
    expect(invalid).not.toContain('<img');
    expect(invalid).not.toContain('No frames');
    const empty = render({ frames: [], window: { kind: 'inspection', workItemId, label: 'E-EMPTY', cursor: 0,
      total: 0, previousCursor: null, nextCursor: null } });
    expect(empty).toContain('No retained capture exists for this inspection: E-EMPTY');
    expect(empty).not.toContain('<img');
  });
  it('renders the real builder’s prefix-excluded work-item and Exception with their exact inspection identity', () => {
    const exceptionId = '019823ab-0000-7000-8000-000000000004';
    const targets = replayJumpTargets({ frames: [], framesTotal: 610,
      workItems: [{ workItemId, displayName: 'LoanCore', subjectKey: 'E-LATE' }],
      exceptions: [{ exceptionId, workItemId, populationRecordKey: 'E-LATE' }], waits: [] });
    const html = render({ window: undefined, jumpTargets: targets });
    expect(html.match(/Open inspection Replay/g)).toHaveLength(2);
    expect(html.match(new RegExp(`href="/runs/${runId}/replay\\?workItem=${workItemId}"`, 'g'))).toHaveLength(2);
    expect(html).not.toContain(`workItem=${exceptionId}`);
  });
  it('retains capture metadata and offers an announced same-frame retry without failed pixels', () => {
    const html = renderToStaticMarkup(React.createElement(SessionStage, { runId, frame,
      imageUnavailable: true, stageNote: 'This recorded frame could not be read.', onRetryFrame: () => {} }));
    expect(html).not.toContain('<img');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('Retry this frame');
    // Where and when the frame was captured, and its digest, are on the rail beside the
    // stage (UX-29: the stage holds the screen and nothing else), so a frame whose pixels
    // cannot be read still shows all three: the rail does not depend on the image.
    const rail = render();
    expect(rail).toContain(frame.sourceLocation); expect(rail).toContain(frame.digest);
    expect(rail).toContain('Captured');
  });
});
