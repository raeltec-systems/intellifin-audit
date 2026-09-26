import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ openRun: vi.fn(), read: vi.fn(), prefix: vi.fn(), plan: vi.fn(), frames: vi.fn(), waits: vi.fn() }));
vi.mock('@intellifin/infrastructure', () => ({
  REPLAY_INSPECTION_PAGE_SIZE: 100, REPLAY_PAGE_SIZE: 500, readRecordNames: async () => new Map(),
  DrizzleRunDetailRepository: class {
    readInspectionReplay = calls.read; readTimeline = calls.prefix; readFrames = calls.frames;
    readEscalations = calls.waits; readReplayExceptions = async () => ({ rows: [], total: 0 });
    readEvidenceItems = async () => []; readEvidenceItemsByIds = async () => [];
    readReplayGaps = async () => ({ missing: 0, suppressed: 0, rows: [] });
  },
  DrizzleFrozenExecutionReader: class { readFrozenExecution = calls.plan; },
}));
vi.mock('../../../../src/bootstrap', () => ({ getRuntime: async () => ({ db: {} }) }));
vi.mock('../../../../src/runs/detail', () => ({ openRun: calls.openRun,
  RunDenied: () => React.createElement('p', null, 'Run denied'), runTabHref: (id: string) => `/runs/${id}` }));
vi.mock('../../../../src/runs/ReplayViewer', () => ({ ReplayViewer: (props: unknown) => React.createElement('pre', null, JSON.stringify(props)) }));
import { ReplayViewer } from '../../../../src/runs/ReplayViewer';
import RunReplayPage from './page';

/**
 * The Replay route opened from a Timeline entry's "Open in Replay" (Story 10.10): the
 * whole session, at the named Escalation's own jump target, resolved against this Run's
 * stored targets only.
 */

const id = '019823ab-0000-7000-8000-000000000001';
const waitId = '019823ab-0000-7000-8000-0000000000e2';
const otherWait = '019823ab-0000-7000-8000-0000000000e9';
const at = (minute: number) => `2026-09-20T10:0${minute}:00.000Z`;
const frameRow = (minute: number) => ({ evidenceId: `019823ab-0000-7000-8000-00000000000${minute}`, toolActionId: `action-${minute}`,
  stepExecutionId: 'step', workItemId: null, action: 'read-attribute', digest: 'a'.repeat(64), size: 10, mediaType: 'image/png',
  sourceLocation: 'https://synthetic.invalid/page', capturedAt: at(minute), actionStartedAt: at(minute) });

function viewerProps(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) { const found = viewerProps(child); if (found !== null) return found; }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  if (node.type === ReplayViewer) return { ...(node.props as Record<string, unknown>), key: node.key };
  return viewerProps((node.props as { readonly children?: unknown }).children);
}

const view = (searchParams: Record<string, string | string[]>) =>
  RunReplayPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) });

beforeEach(() => {
  vi.clearAllMocks();
  calls.openRun.mockResolvedValue({ allowed: true, run: { runId: id, state: 'CANCELED',
    procedureName: 'Escalation Replay', versionId: 'version', procedureId: 'procedure' }, readAt: new Date('2026-09-20T11:00:00Z') });
  calls.plan.mockResolvedValue(null);
  calls.prefix.mockResolvedValue({ workItems: [], stepExecutions: { rows: [] }, toolActions: { rows: [] }, sessionSteps: [], workspace: null });
  calls.frames.mockResolvedValue({ rows: [frameRow(1), frameRow(2), frameRow(3)], total: 3 });
  // Raised after the second frame, so its jump target is that frame.
  calls.waits.mockResolvedValue({ rows: [{ waitId, kind: 'retry-or-skip', openedAt: '2026-09-20T10:02:30.000Z',
    closedAt: at(4), closureKind: 'answer', answerOptionId: 'abort', framesThrough: 2, landing: null }], total: 1 });
});

describe('Replay opened at an answered Escalation', () => {
  it('reads the whole session, never the inspection path, and opens at the Escalation’s jump target', async () => {
    const props = viewerProps(await view({ escalation: waitId }));
    expect(calls.read).not.toHaveBeenCalled();
    expect(calls.prefix).toHaveBeenCalled();
    expect(props?.['initialSelection']).toMatchObject({ kind: 'escalation', frameIndex: 1, target: { kind: 'escalation', id: waitId, label: 'Retry or skip' } });
  });

  it('says an Escalation it cannot resolve is unavailable, and opens no other screen', async () => {
    for (const escalation of [otherWait, 'not-a-uuid', [waitId, waitId]]) {
      const props = viewerProps(await view({ escalation }));
      expect(props?.['initialSelection']).toEqual({ kind: 'escalation-unavailable', frameIndex: null });
    }
  });

  it('keys the viewer by the Escalation, and the same Escalation re-read keeps its key', async () => {
    const plain = viewerProps(await view({}))?.['key'];
    const first = viewerProps(await view({ escalation: waitId }))?.['key'];
    const again = viewerProps(await view({ escalation: waitId }))?.['key'];
    const unavailable = viewerProps(await view({ escalation: otherWait }))?.['key'];
    expect(first).toBe(again);
    expect(new Set([plain, first, unavailable]).size).toBe(3);
    // Nothing asked for: Replay opens where it always did.
    expect(viewerProps(await view({}))?.['initialSelection']).toEqual({ kind: 'start', frameIndex: 0 });
  });

  it('leaves an inspection deep link to the inspection path, whatever else is in the query', async () => {
    calls.read.mockResolvedValue({ kind: 'unavailable' });
    await view({ workItem: '019823ab-0000-7000-8000-0000000000a1', escalation: waitId });
    expect(calls.read).toHaveBeenCalled();
    expect(calls.prefix).not.toHaveBeenCalled();
  });

  it('keeps an active Run on Live View', async () => {
    calls.openRun.mockResolvedValue({ allowed: true, run: { runId: id, state: 'RUNNING', procedureName: 'Active' }, readAt: new Date() });
    expect(renderToStaticMarkup(await view({ escalation: waitId }))).toContain('Open Live View');
    expect(calls.prefix).not.toHaveBeenCalled();
  });
});
